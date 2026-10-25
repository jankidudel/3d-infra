import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { deploymentStage } from '../lib/stages';

const runFile = promisify(execFile);
const runner = resolve('dist/bin/deploy-with-progress.js');

async function simulate(overrides: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'inspectmesh-deploy-progress-'));
  try {
    await mkdir(join(directory, 'bin'));
    const aws = join(directory, 'bin', 'aws');
    const npx = join(directory, 'bin', 'npx');
    const log = join(directory, 'commands.jsonl');
    await writeFile(
      aws,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify(['aws', ...args]) + '\\n');
const statusCalls = fs.readFileSync(process.env.COMMAND_LOG, 'utf8').split('\\n').filter(line => line.includes('describe-stacks')).length;
if (process.env.SCENARIO === 'denied' || (process.env.SCENARIO === 'diagnostics-fail' && statusCalls > 1) || (process.env.SCENARIO === 'events-denied' && args.includes('describe-stack-events'))) {
  console.error('AccessDenied secret-must-not-leak'); process.exit(1);
}
if (process.env.SCENARIO === 'missing' && args.includes('describe-stacks')) {
  console.error('An error occurred (ValidationError): Stack does not exist'); process.exit(1);
}
if (args.includes('describe-stacks')) {
  console.log(process.env.SCENARIO === 'busy' ? 'UPDATE_IN_PROGRESS' : 'UPDATE_COMPLETE');
} else if (args.includes('describe-stack-events')) {
  console.log('2026-10-25 FrontendDeploymentCustomResource UPDATE_IN_PROGRESS');
} else {
  console.log('[]');
}
`,
    );
    await writeFile(
      npx,
      `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.COMMAND_LOG, JSON.stringify(['npx', ...process.argv.slice(2)]) + '\\n');
console.log('CDK active');
setTimeout(() => process.exit(Number(process.env.CDK_EXIT ?? 0)), Number(process.env.CDK_DELAY ?? 0));
`,
    );
    await Promise.all([chmod(aws, 0o755), chmod(npx, 0o755)]);
    const env = {
      ...process.env,
      STAGE: 'prod',
      AWS_REGION: 'us-east-1',
      DEPLOY_PROGRESS_INTERVAL_SECONDS: '1',
      COMMAND_LOG: log,
      PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      ...overrides,
    };
    let result;
    try {
      result = {
        ...(await runFile(
          process.execPath,
          [runner, '-c', 'stage=prod', '--parameters', 'RateLimitSecret=secret-must-not-leak'],
          { env, timeout: 10_000 },
        )),
        code: 0,
      };
    } catch (error: unknown) {
      result = error as { stdout: string; stderr: string; code: number };
    }
    const calls = (await readFile(log, 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-must-not-leak/);
    return { ...result, calls };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test('prints independent AWS status while CDK is quiet and preserves deployment arguments', async () => {
  const result = await simulate({ CDK_DELAY: '1600' });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /deployment still running/);
  assert.match(result.stdout, /FrontendDeploymentCustomResource UPDATE_IN_PROGRESS/);
  const command = result.calls.find((call) => call[0] === 'npx');
  assert.deepEqual(command, [
    'npx',
    'cdk',
    'deploy',
    '--progress',
    'events',
    '-c',
    'stage=prod',
    '--parameters',
    'RateLimitSecret=secret-must-not-leak',
  ]);
});

void test('refuses an already active AWS update even after a previous runner was cancelled', async () => {
  const result = await simulate({ SCENARIO: 'busy' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /already UPDATE_IN_PROGRESS/);
  assert.ok(!result.calls.some((call) => call[0] === 'npx'));
});

void test('does not treat denied AWS access as a missing stack', async () => {
  const result = await simulate({ SCENARIO: 'denied' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Cannot read stack status/);
  assert.ok(!result.calls.some((call) => call[0] === 'npx'));
});

void test('permits a genuine initial deployment and preserves CDK failures', async () => {
  const result = await simulate({ SCENARIO: 'missing', CDK_EXIT: '7' });
  assert.equal(result.code, 7);
  assert.match(result.stdout, /initial deployment can proceed/);
});

void test('a failed diagnostic refresh does not cancel the running deployment', async () => {
  const result = await simulate({ SCENARIO: 'diagnostics-fail', CDK_DELAY: '1600' });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Could not refresh AWS deployment diagnostics/);
  assert.ok(result.calls.every((call) => !call.includes('cancel-update-stack')));
});

void test('rejects disabled dev deployment before invoking AWS or CDK', async () => {
  const result = await simulate({ STAGE: 'dev' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Hosted development is disabled/);
  assert.deepEqual(result.calls, []);
  assert.equal(deploymentStage(), 'prod');
  assert.equal(deploymentStage('prod'), 'prod');
  for (const stage of ['dev', '', 'preview', null]) {
    assert.throws(() => deploymentStage(stage), /Only the prod deployment stage/);
  }
});

void test('rejects invalid progress intervals before invoking AWS or CDK', async () => {
  for (const interval of ['0', '-1', '301', 'NaN', 'Infinity']) {
    const result = await simulate({ DEPLOY_PROGRESS_INTERVAL_SECONDS: interval });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /must be between 1 and 300/);
    assert.deepEqual(result.calls, []);
  }
});

void test('both production infrastructure workflows share a non-cancelling queue and use the status wrapper', async () => {
  for (const file of ['deploy.yml', 'deploy-infra.yml']) {
    const workflow = await readFile(`.github/workflows/${file}`, 'utf8');
    assert.match(workflow, /group: infrastructure\n\s+cancel-in-progress: false\n\s+queue: max/);
    assert.match(workflow, /npx ts-node bin\/deploy-with-progress.ts/);
    assert.doesNotMatch(workflow, /npx cdk deploy/);
    assert.match(workflow, /environment: prod/);
    assert.match(workflow, /STAGE: prod/);
    assert.doesNotMatch(workflow, /inputs.environment|DEV_BASIC_AUTHORIZATION/);
  }
});

void test('identifies denied event reads while preserving stack status and deployment success', async () => {
  const result = await simulate({ SCENARIO: 'events-denied', CDK_DELAY: '1600' });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /CloudFormation status: UPDATE_COMPLETE/);
  assert.match(result.stdout, /describe-stack-events: AccessDenied/);
  assert.doesNotMatch(result.stdout, /secret-must-not-leak/);
});
