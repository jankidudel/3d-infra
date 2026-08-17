import { CfnOutput, Duration, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { EventType } from 'aws-cdk-lib/aws-s3';
import { SqsDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { ProcessingQueue, PROCESSOR_TIMEOUT_SECONDS } from './constructs/processing-queue';
import { ProcessorLambda } from './constructs/processor-lambda';
import { JOB_INPUT_SUFFIX, JOBS_PREFIX, Storage } from './constructs/storage';
import { ApiService } from './constructs/api-service';
import { FrontendHosting } from './constructs/frontend-hosting';

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
}

export class InfraStack extends Stack {
  public constructor(scope: Construct, id: string, props: InfraStackProps) {
    super(scope, id, props);
    const storage = new Storage(this, 'Storage', {
      stage: props.stage,
      corsOrigin: props.corsOrigin,
    });
    const processing = new ProcessingQueue(this, 'Processing', { stage: props.stage });
    const processor = new ProcessorLambda(this, 'Processor', {
      stage: props.stage,
      bucket: storage.bucket,
      queue: processing.queue,
      artifactPath: props.artifactPath,
      memorySize: props.processorMemory,
      logRetention: RetentionDays.ONE_WEEK,
    });
    storage.bucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new SqsDestination(processing.queue),
      { prefix: JOBS_PREFIX, suffix: JOB_INPUT_SUFFIX },
    );
    const api = new ApiService(this, 'Api', {
      stage: props.stage,
      bucket: storage.bucket,
      artifactPath: props.apiArtifactPath,
      createJobBurstLimit: props.createJobBurstLimit,
      createJobRateLimit: props.createJobRateLimit,
    });
    const frontend = new FrontendHosting(this, 'Frontend', {
      stage: props.stage,
      artifactPath: props.frontendArtifactPath,
      api,
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
      new Alarm(this, 'ProcessorThrottlesAlarm', {
        alarmName: `3d-processor-throttles-${props.stage}`,
        metric: processor.function.metricThrottles({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }),
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
    ];
    if (alarmTopic) {
      const alarmAction = new SnsAction(alarmTopic);
      for (const alarm of alarms) {
        alarm.addAlarmAction(alarmAction);
      }
    }
    Tags.of(this).add('Project', '3d-quality');
    Tags.of(this).add('Environment', props.stage);
    Tags.of(this).add('ManagedBy', 'CDK');
    if (props.budgetAlertEmail) {
      new CfnBudget(this, 'MonthlyCostBudget', {
        budget: {
          budgetName: `3d-quality-${props.stage}-monthly`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: props.monthlyBudgetUsd ?? 10, unit: 'USD' },
          costFilters: { TagKeyValue: [`user:Project$3d-quality`] },
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
    new CfnOutput(this, 'ProcessingQueueUrl', { value: processing.queue.queueUrl });
    new CfnOutput(this, 'ProcessingDeadLetterQueueUrl', {
      value: processing.deadLetterQueue.queueUrl,
    });
    new CfnOutput(this, 'ProcessorFunctionName', { value: processor.function.functionName });
    new CfnOutput(this, 'ApiUrl', { value: api.stage.url });
    new CfnOutput(this, 'FrontendUrl', {
      value: `https://${frontend.distribution.distributionDomainName}`,
    });
    if (alarmTopic) {
      new CfnOutput(this, 'OperationsAlarmTopicArn', { value: alarmTopic.topicArn });
    }
  }
}
