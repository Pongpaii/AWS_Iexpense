import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CfFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { PROJECT, REGION, webBucketName } from './config';

export interface WebStackProps extends StackProps {
  /** URL ของ HTTP API (ใส่ใน CSP connect-src) */
  apiUrl: string;
}

/** SPA route (path ที่ไม่มีนามสกุลไฟล์) → /index.html — ทำที่ edge จึงไม่ต้องใช้ error page 403/404 */
export const SPA_REWRITE_CODE = `function handler(event) {
  var request = event.request;
  var last = request.uri.split('/').pop();
  if (last.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`;

/** Content-Security-Policy: โหลดเฉพาะจากโดเมนตัวเอง + API + Cognito */
export function buildCsp(apiUrl: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Vue :style binding สร้าง inline style attribute
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiUrl} https://cognito-idp.${REGION}.amazonaws.com`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/**
 * Frontend: S3 (private, Block Public Access) + CloudFront ผ่าน Origin Access Control
 * - default behavior (index.html, sw.js, route ต่าง ๆ): no-cache
 * - /assets/*: cache 1 ปี immutable (ชื่อไฟล์มี hash)
 * ไม่เปิด access log / WAF (มีค่าใช้จ่าย)
 */
export class WebStack extends Stack {
  readonly bucket: Bucket;
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    this.bucket = new Bucket(this, 'SiteBucket', {
      bucketName: webBucketName(this.account, this.region),
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      // ไม่ใช้ autoDeleteObjects (สร้าง Lambda เพิ่ม) — ตอน destroy ให้ลบไฟล์ก่อน (ดู README)
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const spaRewrite = new CfFunction(this, 'SpaRewrite', {
      functionName: `${PROJECT}-spa-rewrite`,
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(SPA_REWRITE_CODE),
      comment: 'Rewrite SPA routes to /index.html',
    });

    const security = (name: string, cacheControl: string) =>
      new ResponseHeadersPolicy(this, name, {
        responseHeadersPolicyName: `${PROJECT}-${name.toLowerCase()}`,
        securityHeadersBehavior: {
          contentSecurityPolicy: { contentSecurityPolicy: buildCsp(props.apiUrl), override: true },
          strictTransportSecurity: {
            accessControlMaxAge: Duration.days(365),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
          contentTypeOptions: { override: true },
          frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
          referrerPolicy: {
            referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
        },
        customHeadersBehavior: {
          customHeaders: [
            {
              header: 'Permissions-Policy',
              value:
                'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
              override: true,
            },
            { header: 'Cross-Origin-Opener-Policy', value: 'same-origin', override: true },
            { header: 'Cache-Control', value: cacheControl, override: true },
          ],
        },
      });

    const origin = S3BucketOrigin.withOriginAccessControl(this.bucket);

    this.distribution = new Distribution(this, 'Distribution', {
      comment: `${PROJECT} web`,
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_200,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      enableIpv6: true,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
        // index.html / sw.js / registerSW.js / SPA routes: ต้องได้เวอร์ชันล่าสุดเสมอ
        cachePolicy: CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: security('NoCacheHeaders', 'no-cache'),
        functionAssociations: [
          { function: spaRewrite, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/assets/*': {
          origin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
          compress: true,
          cachePolicy: new CachePolicy(this, 'ImmutableAssets', {
            cachePolicyName: `${PROJECT}-immutable-assets`,
            minTtl: Duration.days(365),
            defaultTtl: Duration.days(365),
            maxTtl: Duration.days(365),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
          }),
          responseHeadersPolicy: security(
            'ImmutableHeaders',
            'public, max-age=31536000, immutable',
          ),
        },
      },
    });

    new CfnOutput(this, 'WebUrl', {
      key: 'WebUrl',
      description: 'URL ของเว็บ (ใช้เป็น webOrigin ของ ApiStack)',
      value: `https://${this.distribution.distributionDomainName}`,
    });
    new CfnOutput(this, 'BucketName', { key: 'WebBucketName', value: this.bucket.bucketName });
    new CfnOutput(this, 'DistributionId', {
      key: 'WebDistributionId',
      value: this.distribution.distributionId,
    });
  }
}
