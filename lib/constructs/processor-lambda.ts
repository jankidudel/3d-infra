import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  Runtime,
  LambdaInsightsVersion,
} from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { PROCESSOR_TIMEOUT_SECONDS } from './processing-queue';
import {
  JOB_INPUT_SUFFIX,
  JOB_REPORT_SUFFIX,
  JOBS_PREFIX,
  THREE_MF_JOB_INPUT_SUFFIX,
} from './storage';

export interface ProcessorLambdaProps {
  readonly stage: string;
  readonly bucket: Bucket;
  readonly queue: Queue;
  readonly artifactPath: string;
  readonly memorySize?: number;
  readonly logRetention?: RetentionDays;
}

export class ProcessorLambda extends Construct {
  public readonly function: LambdaFunction;
  public constructor(scope: Construct, id: string, props: ProcessorLambdaProps) {
    super(scope, id);
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
      environment: { STORAGE_BUCKET_NAME: props.bucket.bucketName, JOBS_PREFIX },
      logGroup,
      insightsVersion: LambdaInsightsVersion.VERSION_1_0_498_0,
    });
    props.bucket.grantRead(this.function, `${JOBS_PREFIX}*${JOB_INPUT_SUFFIX}`);
    props.bucket.grantRead(this.function, `${JOBS_PREFIX}*${THREE_MF_JOB_INPUT_SUFFIX}`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*${JOB_REPORT_SUFFIX}`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*/failure.json`);
    this.function.addEventSource(
      new SqsEventSource(props.queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
        maxConcurrency: 2,
      }),
    );
  }
}
