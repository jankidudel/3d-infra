import { Duration } from 'aws-cdk-lib';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export const PROCESSOR_TIMEOUT_SECONDS = 120;
export const VISIBILITY_TIMEOUT_MULTIPLIER = 6;

export class ProcessingQueue extends Construct {
  public readonly queue: Queue;
  public readonly deadLetterQueue: Queue;

  public constructor(scope: Construct, id: string, props: { readonly stage: string }) {
    super(scope, id);
    this.deadLetterQueue = new Queue(this, 'DeadLetterQueue', {
      queueName: `3d-processing-dlq-${props.stage}`,
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
    });
    this.queue = new Queue(this, 'Queue', {
      queueName: `3d-processing-${props.stage}`,
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(4),
      visibilityTimeout: Duration.seconds(
        PROCESSOR_TIMEOUT_SECONDS * VISIBILITY_TIMEOUT_MULTIPLIER,
      ),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
    });
  }
}
