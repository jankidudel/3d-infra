import { CfnOutput, CfnParameter, Duration, Fn, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { CfnEmailIdentity } from 'aws-cdk-lib/aws-ses';
import { CfnGroup } from 'aws-cdk-lib/aws-resourcegroups';
import { Construct } from 'constructs';
import { ProcessingQueue, PROCESSOR_TIMEOUT_SECONDS } from './constructs/processing-queue';
import { ProcessorLambda } from './constructs/processor-lambda';
import { Storage } from './constructs/storage';
import { ApiService } from './constructs/api-service';
import { CloudFrontWebAcl } from './constructs/cloudfront-web-acl';
import { FrontendHosting } from './constructs/frontend-hosting';
import { productionDomain } from './production-domain';
import { stages } from './stages';

export interface InfraStackProps extends StackProps {
  readonly stage: string;
  readonly artifactPath: string;
  readonly apiArtifactPath: string;
  readonly frontendArtifactPath: string;
  readonly corsOrigin?: string;
  readonly processorMemory?: number;
  readonly budgetAlertEmail?: string;
  readonly monthlyBudgetUsd?: number;
  readonly operationsAlertEmail?: string;
  readonly createJobBurstLimit?: number;
  readonly createJobRateLimit?: number;
  readonly customDomain?: typeof productionDomain;
  readonly googleSiteVerification?: string;
}

export class InfraStack extends Stack {
  public constructor(scope: Construct, id: string, props: InfraStackProps) {
    super(scope, id, props);
    Tags.of(this).add('Project', 'InspectMesh');
    Tags.of(this).add('Environment', props.stage);
    Tags.of(this).add('ManagedBy', 'CDK');
    Tags.of(this).add('Component', 'infra');
    const cloudFrontWebAcl =
      props.stage === stages.production
        ? new CloudFrontWebAcl(this, 'ProductionWebAcl', { stage: props.stage })
        : undefined;
    const storage = new Storage(this, 'Storage', {
      stage: props.stage,
      corsOrigin: props.corsOrigin,
    });
    Tags.of(storage).add('Component', 'infra');
    const rateLimitSecret = new CfnParameter(this, 'RateLimitSecret', {
      type: 'String',
      noEcho: true,
      minLength: 32,
      description: 'Random rate-limit signing secret supplied by the protected GitHub Environment.',
    });
    const contactEmail = props.stage === stages.production ? 'hello@inspectmesh.com' : undefined;
    const turnstileSecret =
      props.stage === stages.production
        ? new CfnParameter(this, 'TurnstileSecret', {
            type: 'String',
            noEcho: true,
            minLength: 1,
            description:
              'Cloudflare Turnstile secret key for the InspectMesh contact form, supplied by the protected GitHub Environment.',
          })
        : undefined;
    if (contactEmail) {
      new CfnEmailIdentity(this, 'ContactEmailIdentity', {
        emailIdentity: contactEmail,
      });
    }
    const devBasicAuthAuthorization =
      props.stage === stages.development
        ? new CfnParameter(this, 'DevBasicAuthAuthorization', {
            type: 'String',
            noEcho: true,
            minLength: 12,
            description:
              'Complete HTTP Basic Authorization header protecting the development CloudFront distribution.',
          })
        : undefined;
    const processing = new ProcessingQueue(this, 'Processing', { stage: props.stage });
    Tags.of(processing).add('Component', 'infra');
    const processor = new ProcessorLambda(this, 'Processor', {
      stage: props.stage,
      bucket: storage.bucket,
      queue: processing.queue,
      artifactPath: props.artifactPath,
      memorySize: props.processorMemory,
      logRetention: RetentionDays.ONE_WEEK,
    });
    Tags.of(processor).add('Component', 'processor');
    const api = new ApiService(this, 'Api', {
      stage: props.stage,
      bucket: storage.bucket,
      queue: processing.queue,
      artifactPath: props.apiArtifactPath,
      createJobBurstLimit: props.createJobBurstLimit,
      createJobRateLimit: props.createJobRateLimit,
      rateLimitSecret: rateLimitSecret.valueAsString,
      contactEmail,
      turnstileSecret: turnstileSecret?.valueAsString,
    });
    Tags.of(api).add('Component', 'api');
    const frontend = new FrontendHosting(this, 'Frontend', {
      stage: props.stage,
      artifactPath: props.frontendArtifactPath,
      api,
      customDomain: props.customDomain,
      googleSiteVerification: props.googleSiteVerification,
      webAclArn: cloudFrontWebAcl?.arn,
      basicAuthAuthorization: devBasicAuthAuthorization?.valueAsString,
    });
    Tags.of(frontend).add('Component', 'frontend');
    if (cloudFrontWebAcl) {
      Tags.of(cloudFrontWebAcl).add('Component', 'infra');
    }
    new CfnGroup(this, 'InspectMeshResourceGroup', {
      name: `inspectmesh-${props.stage}-resources`,
      description: 'All InspectMesh resources discovered from Project InspectMesh tags.',
      resourceQuery: {
        type: 'TAG_FILTERS_1_0',
        query: {
          resourceTypeFilters: ['AWS::AllSupported'],
          tagFilters: [{ key: 'Project', values: ['InspectMesh'] }],
        },
      },
    });
    const alarmTopic = props.operationsAlertEmail
      ? new Topic(this, 'OperationsAlarmTopic', {
          topicName: `3d-quality-operations-${props.stage}`,
        })
      : undefined;
    if (alarmTopic && props.operationsAlertEmail) {
      alarmTopic.addSubscription(new EmailSubscription(props.operationsAlertEmail));
    }
    const alarms = [
      new Alarm(this, 'ProcessorErrorsAlarm', {
        alarmName: `3d-processor-errors-${props.stage}`,
        metric: processor.function.metricErrors({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
      /* Disabled to keep dev and prod within the shared 10-alarm free allowance.
      new Alarm(this, 'ProcessorThrottlesAlarm', {
        alarmName: `3d-processor-throttles-${props.stage}`,
        metric: processor.function.metricThrottles({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
      */
      new Alarm(this, 'ProcessorApplicationErrorsAlarm', {
        alarmName: `3d-processor-application-errors-${props.stage}`,
        metric: processor.applicationErrors,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
      /* Disabled to keep dev and prod within the shared 10-alarm free allowance.
      new Alarm(this, 'ProcessorDurationAlarm', {
        alarmName: `3d-processor-duration-${props.stage}`,
        metric: processor.function.metricDuration({
          period: Duration.minutes(5),
          statistic: 'Maximum',
        }),
        threshold: PROCESSOR_TIMEOUT_SECONDS * 1000 * 0.9,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
      */
      new Alarm(this, 'ProcessingQueueAgeAlarm', {
        alarmName: `3d-processing-queue-age-${props.stage}`,
        metric: processing.queue.metricApproximateAgeOfOldestMessage({
          period: Duration.minutes(5),
        }),
        threshold: PROCESSOR_TIMEOUT_SECONDS * 5,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
      new Alarm(this, 'ProcessingDeadLetterQueueAlarm', {
        alarmName: `3d-processing-dlq-messages-${props.stage}`,
        metric: processing.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
      /* Disabled to keep dev and prod within the shared 10-alarm free allowance.
      new Alarm(this, 'ApiErrorsAlarm', {
        alarmName: `3d-api-errors-${props.stage}`,
        metric: api.function.metricErrors({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
      new Alarm(this, 'ApiGatewayServerErrorsAlarm', {
        alarmName: `3d-api-gateway-5xx-${props.stage}`,
        metric: api.stage.metricServerError({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
      */
      new Alarm(this, 'ApiApplicationErrorsAlarm', {
        alarmName: `3d-api-application-errors-${props.stage}`,
        metric: api.applicationErrors,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
    ];
    if (alarmTopic) {
      const alarmAction = new SnsAction(alarmTopic);
      for (const alarm of alarms) {
        alarm.addAlarmAction(alarmAction);
      }
    }
    new Dashboard(this, 'ApiMonitoringDashboard', {
      dashboardName: `3d-api-${props.stage}`,
      widgets: [
        [
          new GraphWidget({
            title: '3D API failures',
            left: [
              api.function.metricErrors({ period: Duration.minutes(5), label: 'Lambda Errors' }),
              api.stage.metricServerError({
                period: Duration.minutes(5),
                label: 'API Gateway 5XX Errors',
              }),
              api.applicationErrors.with({ label: 'Application Errors' }),
            ],
          }),
        ],
        [
          new GraphWidget({
            title: '3D processor failures',
            left: [
              processor.function.metricErrors({
                period: Duration.minutes(5),
                label: 'Lambda Errors',
              }),
              processor.applicationErrors.with({ label: 'Application Errors' }),
            ],
          }),
        ],
      ],
    });
    if (props.budgetAlertEmail) {
      new CfnBudget(this, 'MonthlyCostBudget', {
        budget: {
          budgetName: `3d-quality-${props.stage}-monthly`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: props.monthlyBudgetUsd ?? 10, unit: 'USD' },
          costFilters: { TagKeyValue: [`user:Project$InspectMesh`] },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              comparisonOperator: 'GREATER_THAN',
              notificationType: 'FORECASTED',
              threshold: 50,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ address: props.budgetAlertEmail, subscriptionType: 'EMAIL' }],
          },
          {
            notification: {
              comparisonOperator: 'GREATER_THAN',
              notificationType: 'ACTUAL',
              threshold: 80,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ address: props.budgetAlertEmail, subscriptionType: 'EMAIL' }],
          },
          {
            notification: {
              comparisonOperator: 'GREATER_THAN',
              notificationType: 'ACTUAL',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ address: props.budgetAlertEmail, subscriptionType: 'EMAIL' }],
          },
        ],
      });
    }
    new CfnOutput(this, 'StorageBucketName', { value: storage.bucket.bucketName });
    new CfnOutput(this, 'FrontendBucketName', { value: frontend.bucket.bucketName });
    new CfnOutput(this, 'ProcessingQueueUrl', { value: processing.queue.queueUrl });
    new CfnOutput(this, 'ProcessingDeadLetterQueueUrl', {
      value: processing.deadLetterQueue.queueUrl,
    });
    new CfnOutput(this, 'ProcessorFunctionName', { value: processor.function.functionName });
    new CfnOutput(this, 'ApiUrl', { value: api.stage.url });
    new CfnOutput(this, 'FrontendUrl', {
      value: `https://${frontend.distribution.distributionDomainName}`,
    });
    new CfnOutput(this, 'FrontendDistributionId', { value: frontend.distribution.distributionId });
    if (frontend.hostedZone) {
      new CfnOutput(this, 'ProductionHostedZoneId', { value: frontend.hostedZone.hostedZoneId });
      new CfnOutput(this, 'ProductionHostedZoneNameServers', {
        value: Fn.join(', ', frontend.hostedZone.hostedZoneNameServers!),
      });
    }
    if (alarmTopic) {
      new CfnOutput(this, 'OperationsAlarmTopicArn', { value: alarmTopic.topicArn });
    }
  }
}
