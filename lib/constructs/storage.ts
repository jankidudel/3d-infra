import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export const JOBS_PREFIX = 'jobs/';
export const JOB_INPUT_SUFFIX = '/input.stl';
export const JOB_METADATA_SUFFIX = '/metadata.json';
export const JOB_REPORT_SUFFIX = '/report.json';

export interface StorageProps {
  readonly stage: string;
  readonly corsOrigin?: string;
  readonly jobsRetentionDays?: number;
}

export class Storage extends Construct {
  public readonly bucket: Bucket;

  public constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);
    const isDev = props.stage === 'dev';
    this.bucket = new Bucket(this, 'Bucket', {
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
      lifecycleRules: [
        {
          id: 'ExpireJobs',
          prefix: JOBS_PREFIX,
          expiration: Duration.days(props.jobsRetentionDays ?? 1),
        },
      ],
      cors: props.corsOrigin
        ? [
            {
              allowedMethods: [HttpMethods.POST],
              allowedOrigins: [props.corsOrigin],
              allowedHeaders: ['*'],
            },
          ]
        : undefined,
    });
  }
}
