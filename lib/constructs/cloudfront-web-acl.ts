import { RemovalPolicy } from 'aws-cdk-lib';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export const CLOUD_FRONT_IP_RATE_LIMIT = 3_000;
export const CLOUD_FRONT_IP_RATE_LIMIT_WINDOW_SECONDS = 300;

export interface CloudFrontWebAclProps {
  readonly stage: string;
}

/**
 * The Web ACL attached to a CloudFront distribution for a protected stage.
 *
 * The rule intentionally has no scope-down statement: CloudFront's Free plan
 * supports an IP rate limit but not URI byte-match filtering.
 */
export class CloudFrontWebAcl extends Construct {
  public readonly arn: string;

  public constructor(scope: Construct, id: string, props: CloudFrontWebAclProps) {
    super(scope, id);
    const webAcl = new CfnWebACL(this, 'WebAcl', {
      name: `3d-${props.stage}-cloudfront`,
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `3d${props.stage}CloudFrontWebAcl`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          // Keep the existing production rule name while it is imported into
          // CloudFormation. The name can be changed in a later normal deploy.
          name: 'BlockExcessiveApiRequestsBySourceIp',
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              evaluationWindowSec: CLOUD_FRONT_IP_RATE_LIMIT_WINDOW_SECONDS,
              limit: CLOUD_FRONT_IP_RATE_LIMIT,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `3d${props.stage}BlockExcessiveApiRequestsBySourceIp`,
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
    webAcl.applyRemovalPolicy(RemovalPolicy.RETAIN);
    this.arn = webAcl.attrArn;
  }
}
