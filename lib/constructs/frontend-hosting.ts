import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
  Function as CfFunction,
  FunctionCode,
  FunctionEventType,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { ApiService } from './api-service';

export interface FrontendHostingProps {
  readonly stage: string;
  readonly artifactPath: string;
  readonly api: ApiService;
}

export class FrontendHosting extends Construct {
  public readonly bucket: Bucket;
  public readonly distribution: Distribution;

  public constructor(scope: Construct, id: string, props: FrontendHostingProps) {
    super(scope, id);
    const isDev = props.stage === 'dev';
    this.bucket = new Bucket(this, 'Bucket', {
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
    });
    const stack = Stack.of(this);
    const apiDomain = `${props.api.api.apiId}.execute-api.${stack.region}.${stack.urlSuffix}`;

    // Resolve clean URLs to Angular's prerendered HTML. The default behavior is
    // deliberately uncached, so rewritten HTML never inherits the asset policy.
    const spaRewrite = new CfFunction(this, 'SpaRewriteFunction', {
      code: FunctionCode.fromInline(`function handler(event) {
        var request = event.request;
        var uri = request.uri;
        if (uri.includes('.')) { return request; }
        if (uri === '/') { request.uri = '/index.html'; return request; }
        if (uri.endsWith('/')) { uri = uri.slice(0, -1); }
        request.uri = uri + '/index.html';
        return request;
      }`),
    });

    const frontendOrigin = S3BucketOrigin.withOriginAccessControl(this.bucket);
    this.distribution = new Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: frontendOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        functionAssociations: [
          { eventType: FunctionEventType.VIEWER_REQUEST, function: spaRewrite },
        ],
      },
      additionalBehaviors: {
        '*.js': {
          origin: frontendOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        },
        '*.css': {
          origin: frontendOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        },
        'api/*': {
          origin: new HttpOrigin(apiDomain),
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });
    new BucketDeployment(this, 'Deployment', {
      destinationBucket: this.bucket,
      sources: [Source.asset(props.artifactPath)],
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
    });
  }
}
