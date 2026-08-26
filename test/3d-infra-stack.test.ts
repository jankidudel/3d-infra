import * as path from 'node:path';
import { test } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/3d-infra-stack';
import { productionDomain } from '../lib/production-domain';
import { stages, type Stage } from '../lib/stages';

const apiArtifactPath = path.join(process.cwd(), 'test', 'fixtures', 'api');
const frontendArtifactPath = path.join(process.cwd(), 'test', 'fixtures', 'frontend');

function template(stage: Stage = stages.development): Template {
  const stack = new InfraStack(new App(), 'TestStack', {
    stage,
    artifactPath: path.join(process.cwd(), 'test', 'fixtures', 'processor'),
    apiArtifactPath,
    frontendArtifactPath,
    corsOrigin:
      stage === stages.production ? productionDomain.canonicalUrl : 'http://localhost:4200',
    customDomain: stage === stages.production ? productionDomain : undefined,
    googleSiteVerification: stage === stages.production ? 'test-verification-token' : undefined,
    webAclArn:
      stage === stages.development
        ? 'arn:aws:wafv2:us-east-1:123456789012:global/webacl/dev/example'
        : undefined,
  });
  return Template.fromStack(stack);
}

void test('allows browser uploads from the local development frontend', () => {
  template().hasResourceProperties('AWS::S3::Bucket', {
    CorsConfiguration: {
      CorsRules: [
        {
          AllowedHeaders: ['*'],
          AllowedMethods: ['POST'],
          AllowedOrigins: ['http://localhost:4200'],
        },
      ],
    },
  });
});

void test('takes the rate-limit signing secret from a NoEcho deployment parameter', () => {
  const result = template();
  result.hasParameter('RateLimitSecret', { NoEcho: true, MinLength: 32 });
  result.resourceCountIs('AWS::SecretsManager::Secret', 0);
});

void test('retains the configured Web ACL on the CloudFront distribution', () => {
  template().hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      WebACLId: 'arn:aws:wafv2:us-east-1:123456789012:global/webacl/dev/example',
    },
  });
});

void test('configures an isolated production custom domain with strict upload CORS', () => {
  const result = template(stages.production);
  result.hasResourceProperties('AWS::S3::Bucket', {
    CorsConfiguration: {
      CorsRules: [Match.objectLike({ AllowedOrigins: ['https://www.inspectmesh.com'] })],
    },
  });
  result.hasResourceProperties('AWS::CertificateManager::Certificate', {
    DomainName: 'www.inspectmesh.com',
    SubjectAlternativeNames: ['inspectmesh.com'],
  });
  result.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Aliases: ['www.inspectmesh.com', 'inspectmesh.com'],
      DefaultCacheBehavior: Match.objectLike({
        FunctionAssociations: Match.arrayWith([
          Match.objectLike({ EventType: 'viewer-request', FunctionARN: Match.anyValue() }),
        ]),
      }),
      CacheBehaviors: Match.arrayWith([
        Match.objectLike({
          PathPattern: 'api/*',
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: 'viewer-request', FunctionARN: Match.anyValue() }),
          ]),
        }),
      ]),
    }),
  });
  result.hasResourceProperties('AWS::CloudFront::Function', {
    FunctionConfig: { Runtime: 'cloudfront-js-2.0' },
    FunctionCode: Match.stringLikeRegexp('request\\.rawQueryString\\(\\)'),
  });
  result.resourceCountIs('AWS::Route53::RecordSet', 5);
  result.hasResourceProperties('AWS::Route53::RecordSet', {
    Type: 'TXT',
    ResourceRecords: ['"google-site-verification=test-verification-token"'],
  });
});

void test('adds the local development frontend to a configured upload origin', () => {
  const stack = new InfraStack(new App(), 'CorsStack', {
    stage: stages.development,
    artifactPath: path.join(process.cwd(), 'test', 'fixtures', 'processor'),
    apiArtifactPath,
    frontendArtifactPath,
    corsOrigin: 'https://frontend.example.com',
  });

  Template.fromStack(stack).hasResourceProperties('AWS::S3::Bucket', {
    CorsConfiguration: {
      CorsRules: [
        Match.objectLike({
          AllowedMethods: ['POST'],
          AllowedOrigins: ['https://frontend.example.com', 'http://localhost:4200'],
        }),
      ],
    },
  });
});

void test('deletes newly created logs on rollback and otherwise retains them', () => {
  template(stages.development).hasResource('AWS::Logs::LogGroup', {
    DeletionPolicy: 'RetainExceptOnCreate',
    UpdateReplacePolicy: 'Retain',
  });
});

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
        Match.objectLike({ Prefix: 'jobs/', ExpirationInDays: 1, Status: 'Enabled' }),
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
    // ReservedConcurrentExecutions: 1,
    Environment: {
      Variables: {
        STORAGE_BUCKET_NAME: Match.anyValue(),
        JOBS_PREFIX: 'jobs/',
      },
    },
  });
  result.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
    BatchSize: 1,
    FunctionResponseTypes: ['ReportBatchItemFailures'],
    ScalingConfig: { MaximumConcurrency: 2 },
  });
  result.hasResourceProperties('AWS::Lambda::Function', {
    ReservedConcurrentExecutions: Match.absent(),
  });
});
void test('creates an email-notified monthly budget when configured', () => {
  const stack = new InfraStack(new App(), 'BudgetStack', {
    stage: stages.development,
    artifactPath: path.join(process.cwd(), 'test', 'fixtures', 'processor'),
    apiArtifactPath,
    frontendArtifactPath,
    budgetAlertEmail: 'owner@example.com',
    monthlyBudgetUsd: 15,
  });

  Template.fromStack(stack).hasResourceProperties('AWS::Budgets::Budget', {
    Budget: {
      BudgetLimit: { Amount: 15, Unit: 'USD' },
      BudgetType: 'COST',
      TimeUnit: 'MONTHLY',
    },
    NotificationsWithSubscribers: Match.arrayWith([
      Match.objectLike({
        Notification: Match.objectLike({ Threshold: 80, NotificationType: 'ACTUAL' }),
        Subscribers: [{ Address: 'owner@example.com', SubscriptionType: 'EMAIL' }],
      }),
    ]),
  });
});

void test('routes only job input object-created events to SQS', () => {
  template().hasResourceProperties('Custom::S3BucketNotifications', {
    NotificationConfiguration: {
      QueueConfigurations: Match.arrayWith([
        Match.objectLike({
          Events: ['s3:ObjectCreated:*'],
          Filter: {
            Key: {
              FilterRules: [
                { Name: 'suffix', Value: '/input.stl' },
                { Name: 'prefix', Value: 'jobs/' },
              ],
            },
          },
          QueueArn: Match.anyValue(),
        }),
        Match.objectLike({
          Events: ['s3:ObjectCreated:*'],
          Filter: {
            Key: {
              FilterRules: [
                { Name: 'suffix', Value: '/input.3mf' },
                { Name: 'prefix', Value: 'jobs/' },
              ],
            },
          },
          QueueArn: Match.anyValue(),
        }),
      ]),
    },
  });
});

void test('creates API failure monitoring alarms and optional email notifications', () => {
  const stack = new InfraStack(new App(), 'AlarmStack', {
    stage: stages.development,
    artifactPath: path.join(process.cwd(), 'test', 'fixtures', 'processor'),
    apiArtifactPath,
    frontendArtifactPath,
    operationsAlertEmail: 'operations@example.com',
  });
  const result = Template.fromStack(stack);

  result.resourceCountIs('AWS::CloudWatch::Alarm', 8);
  result.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: '3d-processing-dlq-messages-dev',
    Threshold: 1,
    TreatMissingData: 'notBreaching',
  });
  result.hasResourceProperties('AWS::SNS::Subscription', {
    Protocol: 'email',
    Endpoint: 'operations@example.com',
  });
  result.hasResourceProperties('AWS::Logs::MetricFilter', {
    FilterPattern: 'ERROR',
    MetricTransformations: [
      { MetricNamespace: '3DQuality/API', MetricName: 'ApplicationErrors', MetricValue: '1' },
    ],
  });
  result.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: '3d-api-application-errors-dev',
    Threshold: 1,
  });
  result.hasResourceProperties('AWS::CloudWatch::Dashboard', {
    DashboardName: '3d-api-dev',
  });
});

void test('creates a throttled HTTP API Lambda with scoped storage access', () => {
  const result = template();
  result.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: '3d-api-dev',
    Runtime: 'provided.al2023',
    Handler: 'bootstrap',
    MemorySize: 128,
    Timeout: 15,
    Environment: { Variables: { S3_BUCKET: Match.anyValue() } },
  });
  result.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: '3d-api-dev',
    ReservedConcurrentExecutions: Match.absent(),
  });
  result.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
    StageName: '$default',
    AutoDeploy: true,
    DefaultRouteSettings: {
      ThrottlingBurstLimit: 1,
      ThrottlingRateLimit: 1,
    },
  });
  result.hasResourceProperties('AWS::ApiGatewayV2::Route', {
    RouteKey: 'POST /api/v1/jobs',
  });
});

void test('creates TTL rate-limit storage and grants conditional read/write access to the API', () => {
  const result = template();
  result.hasResourceProperties('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [{ AttributeName: 'windowKey', KeyType: 'HASH' }],
    TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    PointInTimeRecoverySpecification: Match.absent(),
  });
  result.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
          Effect: 'Allow',
        }),
      ]),
    }),
  });
});

void test('uses a higher API throttle in production', () => {
  template(stages.production).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
    StageName: '$default',
    AutoDeploy: true,
    DefaultRouteSettings: {
      ThrottlingBurstLimit: 4,
      ThrottlingRateLimit: 2,
    },
  });
});

void test('allows the API throttle defaults to be overridden', () => {
  const stack = new InfraStack(new App(), 'RateLimitStack', {
    stage: stages.development,
    artifactPath: path.join(process.cwd(), 'test', 'fixtures', 'processor'),
    apiArtifactPath,
    frontendArtifactPath,
    createJobBurstLimit: 4,
    createJobRateLimit: 0.5,
  });

  Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
    DefaultRouteSettings: {
      ThrottlingBurstLimit: 4,
      ThrottlingRateLimit: 0.5,
    },
  });
});

void test('creates private static hosting behind CloudFront with API routing', () => {
  const result = template();
  result.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      DefaultRootObject: 'index.html',
      DefaultCacheBehavior: Match.objectLike({
        CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
        FunctionAssociations: [
          Match.objectLike({ EventType: 'viewer-request', FunctionARN: Match.anyValue() }),
        ],
      }),
      CacheBehaviors: Match.arrayWith([
        Match.objectLike({ PathPattern: '*.js', ViewerProtocolPolicy: 'redirect-to-https' }),
        Match.objectLike({ PathPattern: '*.css', ViewerProtocolPolicy: 'redirect-to-https' }),
        Match.objectLike({ PathPattern: 'api/*', ViewerProtocolPolicy: 'https-only' }),
      ]),
    }),
  });
  result.hasResourceProperties('AWS::CloudFront::Function', {
    FunctionCode: Match.stringLikeRegexp("request.uri = uri \\+ '/index.html'"),
  });
  result.resourceCountIs('AWS::CloudFront::CachePolicy', 0);
  result.hasOutput('FrontendDistributionId', {});
  result.hasOutput('FrontendUrl', {});
});
