import { RemovalPolicy } from 'aws-cdk-lib';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export class ProductionWebAcl extends Construct {
  public readonly arn: string;

  public constructor(scope: Construct, id: string) {
    super(scope, id);
    const webAcl = new CfnWebACL(this, 'WebAcl', {
      name: '3d-prod-cloudfront',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: '3dProdCloudFrontWebAcl',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'BlockExcessiveApiRequestsBySourceIp',
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              evaluationWindowSec: 300,
              limit: 150,
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: 'STARTS_WITH',
                  searchString: '/api/',
                  textTransformations: [{ priority: 0, type: 'NONE' }],
                },
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: '3dProdBlockExcessiveApiRequestsBySourceIp',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
    webAcl.applyRemovalPolicy(RemovalPolicy.RETAIN);
    this.arn = webAcl.attrArn;
  }
}
