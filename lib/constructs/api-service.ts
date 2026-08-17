import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { HttpApi, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Architecture, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { JOB_INPUT_SUFFIX, JOB_METADATA_SUFFIX, JOBS_PREFIX } from './storage';

export interface ApiServiceProps {
  readonly stage: string;
  readonly bucket: Bucket;
  readonly artifactPath: string;
}

export class ApiService extends Construct {
  public readonly function: LambdaFunction;
  public readonly api: HttpApi;
  public readonly stage: HttpStage;

  public constructor(scope: Construct, id: string, props: ApiServiceProps) {
    super(scope, id);
    const functionName = `3d-api-${props.stage}`;
    const logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    this.function = new LambdaFunction(this, 'Function', {
      functionName,
      runtime: Runtime.PROVIDED_AL2023,
      architecture: Architecture.X86_64,
      handler: 'bootstrap',
      code: Code.fromAsset(props.artifactPath),
      memorySize: 128,
      timeout: Duration.seconds(15),
      environment: { S3_BUCKET: props.bucket.bucketName },
      logGroup,
    });
    props.bucket.grantRead(this.function, `${JOBS_PREFIX}*`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*${JOB_INPUT_SUFFIX}`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*${JOB_METADATA_SUFFIX}`);

    this.api = new HttpApi(this, 'HttpApi', {
      apiName: `3d-api-${props.stage}`,
      createDefaultStage: false,
      defaultIntegration: new HttpLambdaIntegration('LambdaIntegration', this.function),
    });
    this.stage = new HttpStage(this, 'DefaultStage', {
      httpApi: this.api,
      stageName: '$default',
      autoDeploy: true,
      throttle: { burstLimit: 10, rateLimit: 5 },
    });
  }
}
