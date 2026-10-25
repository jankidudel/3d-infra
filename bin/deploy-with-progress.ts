import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { stages } from '../lib/stages';

class DeploymentError extends Error {}

const runFile = promisify(execFile);
const intervalSeconds = Number(process.env.DEPLOY_PROGRESS_INTERVAL_SECONDS ?? 60);
const stage = process.env.STAGE;
const region = process.env.AWS_REGION;
const stackName = `three-d-infra-${stage}`;
const warningAfterMs = 10 * 60 * 1000;

async function aws(args: string[]): Promise<string> {
  const { stdout } = await runFile(
    'aws',
    [...args, '--region', region!, '--cli-connect-timeout', '5', '--cli-read-timeout', '10'],
    {
      env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '' },
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout.trim();
}

async function stackStatus(): Promise<string> {
  return aws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    stackName,
    '--query',
    'Stacks[0].StackStatus',
    '--output',
    'text',
  ]);
}

async function assertStackIdle(): Promise<void> {
  let status: string;
  try {
    status = await stackStatus();
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (/ValidationError/.test(stderr) && /does not exist/.test(stderr)) {
      console.log(`${stackName}: no existing stack; initial deployment can proceed.`);
      return;
    }
    throw new DeploymentError(
      'Cannot read stack status. Check AWS credentials, region and CloudFormation read permissions before retrying.',
    );
  }
  if (status.endsWith('_IN_PROGRESS')) {
    throw new DeploymentError(
      `${stackName} is already ${status}. Wait for that AWS operation to finish; cancelling a GitHub run does not cancel CloudFormation.`,
    );
  }
  console.log(`${stackName}: pre-deployment status ${status}.`);
}

function diagnosticReason(error: unknown): string {
  // Report only known error categories, never raw stderr or command arguments.
  const failure = error as { stderr?: string; killed?: boolean; code?: string };
  const known = failure.stderr?.match(
    /\b(AccessDenied(?:Exception)?|UnauthorizedOperation|ExpiredToken(?:Exception)?|InvalidClientTokenId|Throttling(?:Exception)?|ValidationError)\b/,
  );
  if (known) {
    return known[1]!;
  }
  if (failure.killed) {
    return 'request timed out';
  }
  return 'request failed; check AWS access and connectivity';
}

async function diagnosticRead(operation: string, args: string[]): Promise<string | undefined> {
  try {
    return await aws(['cloudformation', operation, '--stack-name', stackName, ...args]);
  } catch (error: unknown) {
    console.log(
      `::warning::Could not refresh AWS deployment diagnostics (${operation}: ${diagnosticReason(error)}). CDK continues running.`,
    );
    return undefined;
  }
}

async function reportProgress(startedAt: number): Promise<void> {
  const elapsedMinutes = Math.floor((Date.now() - startedAt) / 60_000);
  console.log(
    `[${new Date().toISOString()}] ${stackName}: deployment still running (${elapsedMinutes} min).`,
  );
  const status = await diagnosticRead('describe-stacks', [
    '--query',
    'Stacks[0].StackStatus',
    '--output',
    'text',
  ]);
  if (status) {
    console.log(`CloudFormation status: ${status}`);
  }
  // Independent reads: denied event access must not suppress later diagnostics.
  const events = await diagnosticRead('describe-stack-events', [
    '--query',
    'StackEvents[0:5].[Timestamp,LogicalResourceId,ResourceStatus]',
    '--output',
    'json',
    '--no-paginate',
  ]);
  if (events) {
    console.log(events);
  }
  if (Date.now() - startedAt >= warningAfterMs) {
    console.log(
      '::warning::Deployment has been running for at least 10 minutes. Check the latest AWS events; elapsed time alone does not prove a failure. Cancelling GitHub does not stop AWS.',
    );
    // Locate the legacy uploader during the one-time migration away from CDK uploads.
    const helpers = await diagnosticRead('describe-stack-resources', [
      '--query',
      "StackResources[?ResourceType=='AWS::Lambda::Function' && starts_with(LogicalResourceId, 'CustomCDKBucketDeployment')].PhysicalResourceId",
      '--output',
      'json',
    ]);
    if (helpers) {
      try {
        const names: unknown = JSON.parse(helpers);
        if (Array.isArray(names)) {
          for (const name of names) {
            if (typeof name === 'string' && /^[A-Za-z0-9_-]+$/.test(name)) {
              console.log(`Legacy frontend upload helper logs: /aws/lambda/${name}`);
            }
          }
        }
      } catch {
        console.log('::warning::AWS returned an unreadable legacy helper resource list.');
      }
    }
  }
}

async function main(): Promise<void> {
  if (stage !== stages.production || !region) {
    throw new DeploymentError(
      'Hosted development is disabled. STAGE must be prod and AWS_REGION must be set.',
    );
  }
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 300) {
    throw new DeploymentError('DEPLOY_PROGRESS_INTERVAL_SECONDS must be between 1 and 300.');
  }
  await assertStackIdle();
  console.log(
    `Deployment events and a ${intervalSeconds}-second heartbeat will be shown. AWS can continue updating after this process is cancelled.`,
  );
  // Do not echo arguments: CloudFormation parameter arguments contain deployment secrets.
  const deployment = spawn(
    'npx',
    ['cdk', 'deploy', '--progress', 'events', ...process.argv.slice(2)],
    {
      stdio: 'inherit',
    },
  );
  const startedAt = Date.now();
  let reporting = false;
  const timer = setInterval(() => {
    if (!reporting) {
      reporting = true;
      void reportProgress(startedAt).finally(() => {
        reporting = false;
      });
    }
  }, intervalSeconds * 1000);
  const cancel = () => {
    console.error(
      'Deployment client interrupted. CloudFormation may still be updating; inspect the stack before retrying. No AWS cancellation was requested.',
    );
    deployment.kill('SIGTERM');
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      deployment.once('error', reject);
      deployment.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    clearInterval(timer);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

void main().catch((error: unknown) => {
  // Avoid exposing child-process command lines, environment variables or secrets.
  console.error(
    `::error::${error instanceof DeploymentError ? error.message : 'Deployment could not start or finish. Check the stack status and AWS access.'}`,
  );
  process.exitCode = 1;
});
