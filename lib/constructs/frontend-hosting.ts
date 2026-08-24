import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginRequestPolicy,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
  Function as CfFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { ARecord, AaaaRecord, PublicHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { ApiService } from './api-service';
import { productionDomain } from '../production-domain';
import { spaRewriteFunctionCode } from './spa-rewrite-function';

export interface FrontendHostingProps {
  readonly stage: string;
  readonly artifactPath: string;
  readonly api: ApiService;
  readonly customDomain?: typeof productionDomain;
  readonly webAclArn?: string;
}

export class FrontendHosting extends Construct {
  public readonly bucket: Bucket;
  public readonly distribution: Distribution;
  public readonly hostedZone?: PublicHostedZone;

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
    const hostedZone = props.customDomain
      ? new PublicHostedZone(this, 'HostedZone', { zoneName: props.customDomain.apexDomain })
      : undefined;
    this.hostedZone = hostedZone;
    const certificate =
      hostedZone && props.customDomain
        ? new Certificate(this, 'Certificate', {
            domainName: props.customDomain.canonicalDomain,
            subjectAlternativeNames: [props.customDomain.apexDomain],
            validation: CertificateValidation.fromDns(hostedZone),
          })
        : undefined;

    // Resolve clean URLs to Angular's prerendered HTML. Production also redirects
    // the apex hostname before rewriting, using the raw query string verbatim.
    const spaRewrite = new CfFunction(this, 'SpaRewriteFunction', {
      code: FunctionCode.fromInline(spaRewriteFunctionCode(props.customDomain)),
      runtime: props.customDomain ? FunctionRuntime.JS_2_0 : FunctionRuntime.JS_1_0,
    });
    const apexRedirectAssociation = props.customDomain
      ? [{ eventType: FunctionEventType.VIEWER_REQUEST, function: spaRewrite }]
      : undefined;

    const frontendOrigin = S3BucketOrigin.withOriginAccessControl(this.bucket);
    // Free CloudFront pricing plans permit managed, but not custom, response-header policies.
    const responseHeadersPolicy = ResponseHeadersPolicy.SECURITY_HEADERS;
    this.distribution = new Distribution(this, 'Distribution', {
      certificate,
      domainNames: props.customDomain
        ? [props.customDomain.canonicalDomain, props.customDomain.apexDomain]
        : undefined,
      webAclId: props.webAclArn,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: frontendOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy,
        functionAssociations: [
          { eventType: FunctionEventType.VIEWER_REQUEST, function: spaRewrite },
        ],
      },
      additionalBehaviors: {
        '*.js': {
          origin: frontendOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy,
          functionAssociations: apexRedirectAssociation,
        },
        '*.css': {
          origin: frontendOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy,
          functionAssociations: apexRedirectAssociation,
        },
        'api/*': {
          origin: new HttpOrigin(apiDomain),
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy,
          functionAssociations: apexRedirectAssociation,
        },
      },
    });
    if (hostedZone && props.customDomain) {
      const target = RecordTarget.fromAlias(new CloudFrontTarget(this.distribution));
      new ARecord(this, 'ApexAliasRecord', { zone: hostedZone, target });
      new AaaaRecord(this, 'ApexAliasIpv6Record', { zone: hostedZone, target });
      new ARecord(this, 'CanonicalAliasRecord', {
        zone: hostedZone,
        recordName: 'www',
        target,
      });
      new AaaaRecord(this, 'CanonicalAliasIpv6Record', {
        zone: hostedZone,
        recordName: 'www',
        target,
      });
    }
    new BucketDeployment(this, 'Deployment', {
      destinationBucket: this.bucket,
      sources: [Source.asset(props.artifactPath)],
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
    });
  }
}
