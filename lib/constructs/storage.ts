import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export const UPLOADS_PREFIX = 'uploads/';
export const REPORTS_PREFIX = 'reports/';

export interface StorageProps {
  readonly stage: string;
  readonly corsOrigin?: string;
  readonly uploadsRetentionDays?: number;
  readonly reportsRetentionDays?: number;
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
        { id: 'ExpireUploads', prefix: UPLOADS_PREFIX, expiration: Duration.days(props.uploadsRetentionDays ?? 1) },
        { id: 'ExpireReports', prefix: REPORTS_PREFIX, expiration: Duration.days(props.reportsRetentionDays ?? 7) },
      ],
      cors: props.corsOrigin ? [{
        allowedMethods: [HttpMethods.PUT],
        allowedOrigins: [props.corsOrigin],
        allowedHeaders: ['*'],
      }] : undefined,
    });
  }
}
