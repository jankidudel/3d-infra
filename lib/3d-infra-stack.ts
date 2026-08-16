import { CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { EventType } from 'aws-cdk-lib/aws-s3';
import { SqsDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';
import { ProcessingQueue } from './constructs/processing-queue';
import { ProcessorLambda } from './constructs/processor-lambda';
import { Storage, UPLOADS_PREFIX } from './constructs/storage';

export interface InfraStackProps extends StackProps {
  readonly stage: string;
  readonly artifactPath: string;
  readonly corsOrigin?: string;
  readonly processorMemory?: number;
  readonly processorEventSourceMaxConcurrency?: number;
  readonly budgetAlertEmail?: string;
  readonly monthlyBudgetUsd?: number;
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
      eventSourceMaxConcurrency: props.processorEventSourceMaxConcurrency,
      logRetention: RetentionDays.ONE_WEEK,
    });
    storage.bucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new SqsDestination(processing.queue),
      { prefix: UPLOADS_PREFIX },
    );
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
  }
}
