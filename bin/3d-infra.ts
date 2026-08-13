#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { InfraStack } from '../lib/3d-infra-stack';

const app = new App();
const stage = String(app.node.tryGetContext('stage') ?? process.env.STAGE ?? 'dev');
if (!/^[a-z][a-z0-9-]*$/.test(stage)) throw new Error(`Invalid stage "${stage}"`);
const artifactPath = String(
  app.node.tryGetContext('processorArtifactPath') ?? process.env.PROCESSOR_ARTIFACT_PATH ?? '',
);
if (!artifactPath) throw new Error('Set PROCESSOR_ARTIFACT_PATH or -c processorArtifactPath=...');

function optionalNumber(contextKey: string, environmentKey: string): number | undefined {
  const contextValue: unknown = app.node.tryGetContext(contextKey);
  const raw = contextValue ?? process.env[environmentKey];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${contextKey} must be a positive integer`);
  return value;
}

new InfraStack(app, `ThreeDInfra${stage}`, {
  stackName: `three-d-infra-${stage}`,
  stage,
  artifactPath,
  processorMemory: optionalNumber('processorMemory', 'PROCESSOR_MEMORY_MB'),
  processorConcurrency:
    optionalNumber('processorConcurrency', 'PROCESSOR_RESERVED_CONCURRENCY') ?? 1,
  corsOrigin:
    String(
      app.node.tryGetContext('corsOrigin') ??
        process.env.CORS_ORIGIN ??
        (stage === 'dev' ? 'http://localhost:4200' : ''),
    ) || undefined,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-west-2' },
});
