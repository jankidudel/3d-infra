import * as path from 'node:path';
import { test } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/3d-infra-stack';

function template(): Template {
  const stack = new InfraStack(new App(), 'TestStack', {
    stage: 'dev',
    artifactPath: path.join(process.cwd(), 'test', 'fixtures', 'processor'),
    corsOrigin: 'http://localhost:4200',
  });
  return Template.fromStack(stack);
}

void test('creates secure storage with lifecycle policies', () => {
  template().hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }),
      ],
    },
    LifecycleConfiguration: {
      Rules: Match.arrayWith([
        Match.objectLike({ Prefix: 'uploads/', ExpirationInDays: 1, Status: 'Enabled' }),
        Match.objectLike({ Prefix: 'reports/', ExpirationInDays: 7, Status: 'Enabled' }),
      ]),
    },
  });
});

void test('creates standard processing and dead-letter queues', () => {
  const result = template();
  result.resourceCountIs('AWS::SQS::Queue', 2);
  result.hasResourceProperties('AWS::SQS::Queue', {
    QueueName: '3d-processing-dev',
    VisibilityTimeout: 720,
    RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
  });
  result.hasResourceProperties('AWS::SQS::Queue', {
    QueueName: '3d-processing-dlq-dev',
    MessageRetentionPeriod: 1209600,
  });
});

void test('creates the configured .NET processor and event mapping', () => {
  const result = template();
  result.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'dotnet10',
    Handler: 'Processor::Processor.Function::FunctionHandler',
    Architectures: ['x86_64'],
    MemorySize: 256,
    Timeout: 120,
    ReservedConcurrentExecutions: 1,
    Environment: {
      Variables: {
        STORAGE_BUCKET_NAME: Match.anyValue(),
        UPLOADS_PREFIX: 'uploads/',
        REPORTS_PREFIX: 'reports/',
      },
    },
  });
  result.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
    BatchSize: 1,
    FunctionResponseTypes: ['ReportBatchItemFailures'],
  });
});

void test('routes only uploads object-created events to SQS', () => {
  template().hasResourceProperties('Custom::S3BucketNotifications', {
    NotificationConfiguration: {
      QueueConfigurations: [
        Match.objectLike({
          Events: ['s3:ObjectCreated:*'],
          Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'uploads/' }] } },
          QueueArn: Match.anyValue(),
        }),
      ],
    },
  });
});
