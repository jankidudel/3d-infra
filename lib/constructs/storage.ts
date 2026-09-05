import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { stages } from '../stages';

export const JOBS_PREFIX = 'jobs/';
export const INPUT_FOLDER = 'input';
export const OUTPUT_FOLDER = 'output';
export const JOB_INPUT_SUFFIX = `/${INPUT_FOLDER}/input.stl`;
export const THREE_MF_JOB_INPUT_SUFFIX = `/${INPUT_FOLDER}/input.3mf`;
export const STL_REPAIR_INPUT_SUFFIX = `/${INPUT_FOLDER}/repair.stl`;
export const STL_SPLIT_INPUT_SUFFIX = `/${INPUT_FOLDER}/split.stl`;
export const THREE_MF_REPAIR_INPUT_SUFFIX = `/${INPUT_FOLDER}/repair.3mf`;
export const CLEANED_STL_SUFFIX = `/${OUTPUT_FOLDER}/cleaned.stl`;
export const STL_SPLIT_PART_A_SUFFIX = `/${OUTPUT_FOLDER}/part-a.stl`;
export const STL_SPLIT_PART_B_SUFFIX = `/${OUTPUT_FOLDER}/part-b.stl`;
export const CLEANED_THREE_MF_SUFFIX = `/${OUTPUT_FOLDER}/cleaned.3mf`;
export const JOB_METADATA_SUFFIX = '/metadata.json';
export const JOB_REPORT_SUFFIX = `/${OUTPUT_FOLDER}/report.json`;

export interface StorageProps {
  readonly stage: string;
  readonly corsOrigin?: string;
  readonly jobsRetentionDays?: number;
}

export class Storage extends Construct {
  public readonly bucket: Bucket;

  public constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);
    const isDev = props.stage === stages.development;
    const allowedOrigins = [
      ...(props.corsOrigin ? [props.corsOrigin] : []),
      ...(isDev && props.corsOrigin !== '*' ? ['http://localhost:4200'] : []),
    ];
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
      cors:
        allowedOrigins.length > 0
          ? [
              {
                allowedMethods: [HttpMethods.POST],
                allowedOrigins: [...new Set(allowedOrigins)],
                allowedHeaders: ['*'],
              },
            ]
          : undefined,
    });
  }
}
