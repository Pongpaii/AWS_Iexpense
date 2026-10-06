import { App, Aspects, Tags } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { CiStack } from '../lib/ci-stack';
import { CostGuardAspect } from '../lib/cost-guard';
import { SPA_REWRITE_CODE, WebStack, buildCsp } from '../lib/web-stack';

const env = { account: '123456789012', region: 'ap-southeast-1' };
const API = 'https://abc123.execute-api.ap-southeast-1.amazonaws.com';

function newApp() {
  const app = new App();
  Tags.of(app).add('project', 'money-flow');
  Aspects.of(app).add(new CostGuardAspect());
  return app;
}

const webStack = new WebStack(newApp(), 'Web', { env, apiUrl: API });
const web = Template.fromStack(webStack);

describe('WebStack: S3', () => {
  it('bucket private ทั้งหมด + บังคับ SSL + ไม่มี website hosting', () => {
    web.resourceCountIs('AWS::S3::Bucket', 1);
    web.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'money-flow-web-123456789012-ap-southeast-1',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      WebsiteConfiguration: Match.absent(),
    });
    const policy = JSON.stringify(web.findResources('AWS::S3::BucketPolicy'));
    expect(policy).toContain('aws:SecureTransport');
    expect(policy).not.toContain('"Principal":"*","Effect":"Allow"');
  });

  it('อ่าน bucket ได้เฉพาะ CloudFront distribution นี้ (OAC)', () => {
    web.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    web.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
    const policy = JSON.stringify(web.findResources('AWS::S3::BucketPolicy'));
    expect(policy).toContain('cloudfront.amazonaws.com');
    expect(policy).toContain('AWS:SourceArn');
  });

  it('ไม่มี Lambda (ไม่ใช้ autoDeleteObjects / BucketDeployment)', () => {
    web.resourceCountIs('AWS::Lambda::Function', 0);
    web.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
  });
});

describe('WebStack: CloudFront', () => {
  it('CloudFront Function rewrite SPA route → /index.html (ไฟล์จริงไม่ถูกแตะ)', () => {
    const handler = new Function(`${SPA_REWRITE_CODE}; return handler;`)() as (e: {
      request: { uri: string };
    }) => { uri: string };
    const uri = (u: string) => handler({ request: { uri: u } }).uri;
    expect(uri('/')).toBe('/index.html');
    expect(uri('/analytics')).toBe('/index.html');
    expect(uri('/settings/')).toBe('/index.html');
    expect(uri('/assets/index-abc.js')).toBe('/assets/index-abc.js');
    expect(uri('/sw.js')).toBe('/sw.js');
    expect(uri('/manifest.webmanifest')).toBe('/manifest.webmanifest');
    web.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-2.0' }),
    });
  });

  it('default behavior: no-cache + SPA function + HTTPS', () => {
    const dist = Object.values(web.findResources('AWS::CloudFront::Distribution'))[0]!;
    const cfg = dist.Properties.DistributionConfig;
    expect(cfg.DefaultRootObject).toBe('index.html');
    expect(cfg.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    // CachingDisabled (AWS managed)
    expect(cfg.DefaultCacheBehavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    expect(cfg.DefaultCacheBehavior.FunctionAssociations[0].EventType).toBe('viewer-request');
    expect(cfg.Logging).toBeUndefined();
    expect(cfg.WebACLId).toBeUndefined();
  });

  it('/assets/* cache 1 ปี immutable', () => {
    web.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        MinTTL: 31536000,
        DefaultTTL: 31536000,
        MaxTTL: 31536000,
      }),
    });
    const dist = Object.values(web.findResources('AWS::CloudFront::Distribution'))[0]!;
    const assets = dist.Properties.DistributionConfig.CacheBehaviors.find(
      (b: { PathPattern: string }) => b.PathPattern === '/assets/*',
    );
    expect(assets).toBeDefined();
    const policies = Object.values(web.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
    const cacheValues = policies.map(
      (p) =>
        p.Properties.ResponseHeadersPolicyConfig.CustomHeadersConfig.Items.find(
          (h: { Header: string }) => h.Header === 'Cache-Control',
        ).Value,
    );
    expect(cacheValues.sort()).toEqual(['no-cache', 'public, max-age=31536000, immutable']);
  });

  it('security headers: CSP, HSTS, nosniff, X-Frame-Options DENY, Referrer, Permissions, COOP', () => {
    const policies = Object.values(web.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
    expect(policies).toHaveLength(2);
    for (const p of policies) {
      const cfg = p.Properties.ResponseHeadersPolicyConfig;
      const sec = cfg.SecurityHeadersConfig;
      expect(sec.ContentSecurityPolicy.ContentSecurityPolicy).toBe(buildCsp(API));
      expect(sec.StrictTransportSecurity).toMatchObject({
        AccessControlMaxAgeSec: 31536000,
        IncludeSubdomains: true,
      });
      expect(sec.ContentTypeOptions.Override).toBe(true);
      expect(sec.FrameOptions.FrameOption).toBe('DENY');
      expect(sec.ReferrerPolicy.ReferrerPolicy).toBe('strict-origin-when-cross-origin');
      const headers = cfg.CustomHeadersConfig.Items.map((h: { Header: string }) => h.Header);
      expect(headers).toEqual(
        expect.arrayContaining(['Permissions-Policy', 'Cross-Origin-Opener-Policy']),
      );
    }
  });

  it('CSP: ไม่มี unsafe-eval / inline script, อนุญาตเฉพาะ API + Cognito', () => {
    const csp = buildCsp(API);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain(
      `connect-src 'self' ${API} https://cognito-idp.ap-southeast-1.amazonaws.com`,
    );
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('outputs สำหรับ deploy', () => {
    web.hasOutput('WebUrl', {});
    web.hasOutput('WebBucketName', {});
    web.hasOutput('WebDistributionId', {});
  });

  it('cost guard ผ่าน + ติด tag', () => {
    expect(Annotations.fromStack(webStack).findError('*', Match.anyValue())).toEqual([]);
    web.hasResourceProperties('AWS::S3::Bucket', {
      Tags: Match.arrayWith([{ Key: 'project', Value: 'money-flow' }]),
    });
  });
});

describe('CiStack (GitHub OIDC)', () => {
  const ci = Template.fromStack(
    new CiStack(newApp(), 'Ci', { env, githubRepo: 'Pongpaii/AWS_Iexpense', branch: 'main' }),
  );

  it('สร้าง OIDC provider แบบ native (ไม่มี custom resource Lambda)', () => {
    ci.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
    ci.resourceCountIs('AWS::Lambda::Function', 0);
  });

  it('trust policy: เฉพาะ repo + branch main และ audience sts', () => {
    const role = Object.values(ci.findResources('AWS::IAM::Role'))[0]!;
    const stmt = role.Properties.AssumeRolePolicyDocument.Statement[0];
    expect(stmt.Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(stmt.Condition.StringEquals).toEqual({
      'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      'token.actions.githubusercontent.com:sub': 'repo:Pongpaii/AWS_Iexpense:ref:refs/heads/main',
    });
    expect(JSON.stringify(stmt.Condition)).not.toContain('*');
    expect(role.Properties.MaxSessionDuration).toBe(3600);
  });

  it('ไม่มี access key / user และไม่มีสิทธิ์ wildcard แบบ "*"', () => {
    ci.resourceCountIs('AWS::IAM::User', 0);
    ci.resourceCountIs('AWS::IAM::AccessKey', 0);
    const policy = Object.values(ci.findResources('AWS::IAM::Policy'))[0]!;
    const statements = policy.Properties.PolicyDocument.Statement as {
      Sid: string;
      Action: string | string[];
      Resource: unknown;
    }[];
    expect(statements.map((s) => s.Sid).sort()).toEqual(
      [
        'AssumeCdkBootstrapRoles',
        'InvalidateCdn',
        'ReadStackOutputs',
        'SyncWebBucket',
        'WriteWebObjects',
      ].sort(),
    );
    for (const s of statements) {
      expect([s.Action].flat()).not.toContain('*');
      expect(s.Resource).not.toBe('*');
    }
    const assume = statements.find((s) => s.Sid === 'AssumeCdkBootstrapRoles')!;
    expect(JSON.stringify(assume.Resource)).toContain('role/cdk-hnb659fds-*');
  });

  it('ใช้ OIDC provider เดิมได้', () => {
    const t = Template.fromStack(
      new CiStack(newApp(), 'Ci2', {
        env,
        githubRepo: 'a/b',
        branch: 'main',
        existingOidcProviderArn:
          'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
      }),
    );
    t.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });
});
