import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnStage, HttpApi, HttpMethod, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Architecture, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
// import { LambdaInsightsVersion } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Metric, Stats } from 'aws-cdk-lib/aws-cloudwatch';
import { FilterPattern, LogGroup, MetricFilter, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import {
  JOB_INPUT_SUFFIX,
  JOB_METADATA_SUFFIX,
  JOBS_PREFIX,
  STL_REPAIR_INPUT_SUFFIX,
  STL_SPLIT_INPUT_SUFFIX,
  THREE_MF_REPAIR_INPUT_SUFFIX,
  THREE_MF_JOB_INPUT_SUFFIX,
} from './storage';
import { stages } from '../stages';

const CREATE_JOB_PATH = '/api/v1/jobs';

export interface ApiServiceProps {
  readonly stage: string;
  readonly bucket: Bucket;
  readonly queue: Queue;
  readonly artifactPath: string;
  readonly createJobBurstLimit?: number;
  readonly createJobRateLimit?: number;
  readonly rateLimitSecret: string;
  readonly contactEmail?: string;
  readonly turnstileSecret?: string;
}

export class ApiService extends Construct {
  public readonly function: LambdaFunction;
  public readonly api: HttpApi;
  public readonly stage: HttpStage;
  public readonly rateLimitTable: Table;
  public readonly applicationErrors: Metric;

  public constructor(scope: Construct, id: string, props: ApiServiceProps) {
    super(scope, id);
    const functionName = `3d-api-${props.stage}`;
    const logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    const isDev = props.stage === stages.development;
    this.rateLimitTable = new Table(this, 'RateLimitTable', {
      tableName: `3d-api-rate-limits-${props.stage}`,
      partitionKey: { name: 'windowKey', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });
    this.function = new LambdaFunction(this, 'Function', {
      functionName,
      runtime: Runtime.PROVIDED_AL2023,
      architecture: Architecture.X86_64,
      handler: 'bootstrap',
      code: Code.fromAsset(props.artifactPath),
      memorySize: 128,
      timeout: Duration.seconds(15),
      environment: {
        S3_BUCKET: props.bucket.bucketName,
        ENABLE_API_DOCUMENTATION: isDev ? 'true' : 'false',
        RATE_LIMIT_TABLE: this.rateLimitTable.tableName,
        RATE_LIMIT_SECRET: props.rateLimitSecret,
        PROCESSING_QUEUE_URL: props.queue.queueUrl,
        ...(props.contactEmail && props.turnstileSecret
          ? {
              CONTACT_EMAIL: props.contactEmail,
              TURNSTILE_SECRET: props.turnstileSecret,
            }
          : {}),
      },
      logGroup,
      // Re-enable Lambda Insights only after reviewing its custom-metric cost.
      // insightsVersion: LambdaInsightsVersion.VERSION_1_0_498_0,
    });
    const applicationErrors = new MetricFilter(this, 'ApplicationErrors', {
      logGroup,
      filterPattern: FilterPattern.literal('ERROR'),
      metricNamespace: '3DQuality/API',
      metricName: 'ApplicationErrors',
      metricValue: '1',
    });
    this.applicationErrors = applicationErrors.metric({
      statistic: Stats.SUM,
      period: Duration.minutes(5),
    });
    props.bucket.grantRead(this.function, `${JOBS_PREFIX}*`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*${JOB_INPUT_SUFFIX}`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*${THREE_MF_JOB_INPUT_SUFFIX}`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*${STL_REPAIR_INPUT_SUFFIX}`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*${STL_SPLIT_INPUT_SUFFIX}`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*${THREE_MF_REPAIR_INPUT_SUFFIX}`);
    props.bucket.grantPut(this.function, `${JOBS_PREFIX}*${JOB_METADATA_SUFFIX}`);
    props.queue.grantSendMessages(this.function);
    if (props.contactEmail) {
      this.function.addToRolePolicy(
        new PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [
            `arn:${Stack.of(this).partition}:ses:${Stack.of(this).region}:${Stack.of(this).account}:identity/${props.contactEmail}`,
          ],
        }),
      );
    }
    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [this.rateLimitTable.tableArn],
      }),
    );

    const integration = new HttpLambdaIntegration('LambdaIntegration', this.function);
    this.api = new HttpApi(this, 'HttpApi', {
      apiName: `3d-api-${props.stage}`,
      createDefaultStage: false,
      defaultIntegration: integration,
    });
    this.api.addRoutes({
      path: CREATE_JOB_PATH,
      methods: [HttpMethod.POST],
      integration,
    });
    const throttle = {
      burstLimit: props.createJobBurstLimit ?? (isDev ? 1 : 4), // @todo: increase to 10 once we have a better understanding of the load on the API
      rateLimit: props.createJobRateLimit ?? (isDev ? 1 : 2), // @todo: increase to 5 once we have a better understanding of the load on the API
    };
    this.stage = new HttpStage(this, 'DefaultStage', {
      httpApi: this.api,
      stageName: '$default',
      autoDeploy: true,
      throttle,
    });
    const cfnStage = this.stage.node.defaultChild as CfnStage;
    cfnStage.routeSettings = {};
  }
}
