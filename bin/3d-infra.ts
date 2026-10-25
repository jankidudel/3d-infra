#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { InfraStack } from '../lib/3d-infra-stack';
import { productionDomain } from '../lib/production-domain';
import { deploymentStage, stages } from '../lib/stages';

const app = new App();
const stage = deploymentStage(app.node.tryGetContext('stage') ?? process.env.STAGE);
const configuredCorsOrigin = String(
  app.node.tryGetContext('corsOrigin') ?? process.env.CORS_ORIGIN ?? '',
).trim();
const googleSiteVerification = String(
  app.node.tryGetContext('googleSiteVerification') ?? process.env.GOOGLE_SITE_VERIFICATION ?? '',
).trim();
if (
  stage === stages.production &&
  configuredCorsOrigin &&
  configuredCorsOrigin !== productionDomain.canonicalUrl
) {
  throw new Error(`Production CORS origin must be ${productionDomain.canonicalUrl}.`);
}
if (stage === stages.production && !googleSiteVerification) {
  throw new Error(
    'GOOGLE_SITE_VERIFICATION is required for production. Add it as a variable in the prod GitHub Environment.',
  );
}
const artifactPath = String(
  app.node.tryGetContext('processorArtifactPath') ?? process.env.PROCESSOR_ARTIFACT_PATH ?? '',
);
if (!artifactPath) {
  throw new Error('Set PROCESSOR_ARTIFACT_PATH or -c processorArtifactPath=...');
}

function requiredArtifact(contextKey: string, environmentKey: string): string {
  const value = String(app.node.tryGetContext(contextKey) ?? process.env[environmentKey] ?? '');
  if (!value) {
    throw new Error(`Set ${environmentKey} or -c ${contextKey}=...`);
  }
  return value;
}

function optionalNumber(
  contextKey: string,
  environmentKey: string,
  options: { integer?: boolean } = { integer: true },
): number | undefined {
  const contextValue: unknown = app.node.tryGetContext(contextKey);
  const raw = contextValue ?? process.env[environmentKey];
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (options.integer && !Number.isInteger(value))) {
    throw new Error(`${contextKey} must be a positive ${options.integer ? 'integer' : 'number'}`);
  }
  return value;
}

new InfraStack(app, `ThreeDInfra${stage}`, {
  stackName: `three-d-infra-${stage}`,
  stage,
  artifactPath,
  apiArtifactPath: requiredArtifact('apiArtifactPath', 'API_ARTIFACT_PATH'),
  frontendArtifactPath: requiredArtifact('frontendArtifactPath', 'FRONTEND_ARTIFACT_PATH'),
  processorMemory: optionalNumber('processorMemory', 'PROCESSOR_MEMORY_MB'),
  budgetAlertEmail:
    String(app.node.tryGetContext('budgetAlertEmail') ?? process.env.BUDGET_ALERT_EMAIL ?? '') ||
    undefined,
  monthlyBudgetUsd: optionalNumber('monthlyBudgetUsd', 'MONTHLY_BUDGET_USD'),
  operationsAlertEmail:
    String(
      app.node.tryGetContext('operationsAlertEmail') ?? process.env.OPERATIONS_ALERT_EMAIL ?? '',
    ) || undefined,
  createJobBurstLimit: optionalNumber('createJobBurstLimit', 'CREATE_JOB_BURST_LIMIT'),
  createJobRateLimit: optionalNumber('createJobRateLimit', 'CREATE_JOB_RATE_LIMIT', {
    integer: false,
  }),
  corsOrigin:
    stage === stages.production
      ? productionDomain.canonicalUrl
      : configuredCorsOrigin || 'http://localhost:4200',
  customDomain: stage === stages.production ? productionDomain : undefined,
  googleSiteVerification: stage === stages.production ? googleSiteVerification : undefined,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});
