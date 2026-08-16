import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { PROCESSOR_TIMEOUT_SECONDS } from './processing-queue';
import { REPORTS_PREFIX, UPLOADS_PREFIX } from './storage';

export interface ProcessorLambdaProps {
  readonly stage: string;
  readonly bucket: Bucket;
  readonly queue: Queue;
  readonly artifactPath: string;
  readonly memorySize?: number;
  readonly eventSourceMaxConcurrency?: number;
  readonly logRetention?: RetentionDays;
}

export const MIN_EVENT_SOURCE_MAX_CONCURRENCY = 2;
const MAX_EVENT_SOURCE_MAX_CONCURRENCY = 1000;

export class ProcessorLambda extends Construct {
  public readonly function: LambdaFunction;
  public constructor(scope: Construct, id: string, props: ProcessorLambdaProps) {
    super(scope, id);
    const eventSourceMaxConcurrency = props.eventSourceMaxConcurrency ?? 2;
    if (
      eventSourceMaxConcurrency < MIN_EVENT_SOURCE_MAX_CONCURRENCY ||
      eventSourceMaxConcurrency > MAX_EVENT_SOURCE_MAX_CONCURRENCY
    ) {
      throw new Error(
        `Processor event-source maximum concurrency must be between ${MIN_EVENT_SOURCE_MAX_CONCURRENCY} and ${MAX_EVENT_SOURCE_MAX_CONCURRENCY}`,
      );
    }
    const functionName = `3d-processor-${props.stage}`;
    const logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: props.logRetention ?? RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    this.function = new LambdaFunction(this, 'Function', {
      functionName,
      runtime: Runtime.DOTNET_10,
      architecture: Architecture.X86_64,
      handler: 'Processor::Processor.Function::FunctionHandler',
      code: Code.fromAsset(props.artifactPath),
      memorySize: props.memorySize ?? 256,
      timeout: Duration.seconds(PROCESSOR_TIMEOUT_SECONDS),
      environment: { STORAGE_BUCKET_NAME: props.bucket.bucketName, UPLOADS_PREFIX, REPORTS_PREFIX },
      logGroup,
    });
    props.bucket.grantRead(this.function, `${UPLOADS_PREFIX}*`);
    props.bucket.grantPut(this.function, `${REPORTS_PREFIX}*`);
    this.function.addEventSource(
      new SqsEventSource(props.queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
        maxConcurrency: eventSourceMaxConcurrency,
      }),
    );
  }
}
