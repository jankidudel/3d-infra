#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { InfraStack } from '../lib/3d-infra-stack';
import { MIN_EVENT_SOURCE_MAX_CONCURRENCY } from '../lib/constructs/processor-lambda';

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
  processorEventSourceMaxConcurrency:
    optionalNumber(
      'processorEventSourceMaxConcurrency',
      'PROCESSOR_EVENT_SOURCE_MAX_CONCURRENCY',
    ) ?? MIN_EVENT_SOURCE_MAX_CONCURRENCY, // @todo: move to env setting.
  budgetAlertEmail:
    String(app.node.tryGetContext('budgetAlertEmail') ?? process.env.BUDGET_ALERT_EMAIL ?? '') ||
    undefined,
  monthlyBudgetUsd: optionalNumber('monthlyBudgetUsd', 'MONTHLY_BUDGET_USD'),
  corsOrigin:
    String(
      app.node.tryGetContext('corsOrigin') ??
        process.env.CORS_ORIGIN ??
        (stage === 'dev' ? 'http://localhost:4200' : ''),
    ) || undefined,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});
