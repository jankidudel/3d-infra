import { CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
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
  readonly processorConcurrency?: number;
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
      reservedConcurrency: props.processorConcurrency,
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
    new CfnOutput(this, 'StorageBucketName', { value: storage.bucket.bucketName });
    new CfnOutput(this, 'ProcessingQueueUrl', { value: processing.queue.queueUrl });
    new CfnOutput(this, 'ProcessingDeadLetterQueueUrl', {
      value: processing.deadLetterQueue.queueUrl,
    });
    new CfnOutput(this, 'ProcessorFunctionName', { value: processor.function.functionName });
  }
}
