import type { Stack } from 'aws-cdk-lib';
import { App, Aspects, Tags } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { BudgetStack } from '../lib/budget-stack';
import { CiStack } from '../lib/ci-stack';
import { WebStack } from '../lib/web-stack';
import { FORBIDDEN_RESOURCE_PREFIXES, CostGuardAspect } from '../lib/cost-guard';
import { DataStack } from '../lib/data-stack';

const env = { account: '123456789012', region: 'ap-southeast-1' };
const WEB = 'https://d111111abcdef8.cloudfront.net';

let stacks: Stack[];
let data: Template;
let api: Template;

beforeAll(() => {
  const app = new App();
  Tags.of(app).add('project', 'money-flow');
  Aspects.of(app).add(new CostGuardAspect());
  const budget = new BudgetStack(app, 'Budget', { env, alertEmail: 'a@example.com' });
  const auth = new AuthStack(app, 'Auth', { env, retainData: true });
  const d = new DataStack(app, 'Data', { env, retainData: true, enablePitr: false });
  const a = new ApiStack(app, 'Api', {
    env,
    table: d.table,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    webOrigin: WEB,
  });
  const web = new WebStack(app, 'Web', { env, apiUrl: a.api.apiEndpoint });
  const ci = new CiStack(app, 'Ci', { env, githubRepo: 'o/r', branch: 'main' });
  stacks = [budget, auth, d, a, web, ci];
  data = Template.fromStack(d);
  api = Template.fromStack(a); // bundle Lambda ด้วย esbuild จริง
}, 120_000);

describe('ทั้ง app: กฎค่าใช้จ่าย', () => {
  it('ไม่มี NAT / RDS / EC2 / ELB / ElastiCache / OpenSearch / WAF / KMS / Secrets / RUM / EIP', () => {
    for (const s of stacks) {
      const types = Object.values(Template.fromStack(s).toJSON().Resources ?? {}).map(
        (r) => (r as { Type: string }).Type,
      );
      for (const t of types) {
        expect(
          FORBIDDEN_RESOURCE_PREFIXES.some((p) => t.startsWith(p)),
          `${s.stackName}: ${t}`,
        ).toBe(false);
      }
      expect(types).not.toContain('AWS::EC2::VPC');
    }
  });

  it('cost guard ไม่มี error', () => {
    for (const s of stacks) {
      expect(Annotations.fromStack(s).findError('*', Match.anyValue())).toEqual([]);
    }
  });

  it('ทุก log group retention 7 วัน', () => {
    let count = 0;
    for (const s of stacks) {
      const groups = Template.fromStack(s).findResources('AWS::Logs::LogGroup');
      for (const g of Object.values(groups)) {
        expect(g.Properties.RetentionInDays).toBe(7);
        count++;
      }
    }
    expect(count).toBe(3); // api, account, access logs
  });

  it('S3 bucket ทุกตัวต้อง block public access ทั้งหมด', () => {
    let buckets = 0;
    for (const s of stacks) {
      const found = Template.fromStack(s).findResources('AWS::S3::Bucket');
      for (const b of Object.values(found)) {
        buckets++;
        expect(b.Properties.PublicAccessBlockConfiguration).toEqual({
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        });
      }
    }
    expect(buckets).toBe(1); // เว็บ bucket
  });
});

describe('DataStack', () => {
  it('ตาราง MoneyFlow: PK/SK, on-demand, PITR ปิด, ไม่มี GSI, ไม่ใช้ KMS CMK', () => {
    data.resourceCountIs('AWS::DynamoDB::Table', 1);
    data.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'MoneyFlow',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
      DeletionProtectionEnabled: true,
      GlobalSecondaryIndexes: Match.absent(),
    });
    data.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
    // AWS-owned key (ฟรี): ไม่มี SSEType KMS และไม่มี KMSMasterKeyId
    const table = Object.values(data.findResources('AWS::DynamoDB::Table'))[0]!;
    expect(table.Properties.SSESpecification?.SSEType).toBeUndefined();
    expect(table.Properties.SSESpecification?.KMSMasterKeyId).toBeUndefined();
  });

  it('เปิด PITR เป็น option ได้', () => {
    const t = Template.fromStack(
      new DataStack(new App(), 'D2', { env, retainData: false, enablePitr: true }),
    );
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });
});

describe('ApiStack', () => {
  it('Lambda ทุกตัว: nodejs22.x, arm64, 256MB, ≤ 10s, ไม่อยู่ใน VPC', () => {
    const fns = api.findResources('AWS::Lambda::Function');
    expect(Object.keys(fns)).toHaveLength(2);
    for (const f of Object.values(fns)) {
      expect(f.Properties).toMatchObject({
        Runtime: 'nodejs22.x',
        Architectures: ['arm64'],
        MemorySize: 256,
      });
      expect(f.Properties.Timeout).toBeLessThanOrEqual(10);
      expect(f.Properties.VpcConfig).toBeUndefined();
    }
  });

  it('HTTP API: JWT authorizer (Cognito) บังคับทุก route', () => {
    api.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
    });
    const routes = api.findResources('AWS::ApiGatewayV2::Route');
    const keys = Object.values(routes).map((r) => r.Properties.RouteKey as string);
    expect(keys.sort()).toEqual(
      [
        'DELETE /account',
        'DELETE /achievements',
        'DELETE /transactions/{id}',
        'GET /achievements',
        'GET /export',
        'GET /settings',
        'GET /summary/balance',
        'GET /summary/monthly',
        'GET /transactions',
        'PATCH /transactions/{id}',
        'POST /achievements',
        'POST /transactions',
        'POST /transactions/bulk-delete',
        'POST /transactions/{id}/restore',
        'PUT /settings',
      ].sort(),
    );
    for (const r of Object.values(routes)) {
      expect(r.Properties.AuthorizationType, r.Properties.RouteKey).toBe('JWT');
    }
  });

  it('throttling 20 rps / burst 40 และ access log', () => {
    api.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
      AccessLogSettings: Match.objectLike({ DestinationArn: Match.anyValue() }),
    });
  });

  it('CORS เฉพาะ CloudFront + localhost:5173 + Capacitor Android (https://localhost)', () => {
    api.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      CorsConfiguration: Match.objectLike({
        AllowOrigins: [WEB, 'http://localhost:5173', 'https://localhost'],
        AllowHeaders: ['authorization', 'content-type'],
      }),
    });
    const apiRes = Object.values(api.findResources('AWS::ApiGatewayV2::Api'))[0]!;
    // HTTP API รับเฉพาะ origin http(s) — origin แบบอื่นทำให้ deploy ล้ม
    for (const o of apiRes.Properties.CorsConfiguration.AllowOrigins as string[]) {
      expect(o).toMatch(/^https?:\/\/[^/]+$/);
    }
    expect(apiRes.Properties.CorsConfiguration.AllowOrigins).not.toContain('*');
    expect(apiRes.Properties.CorsConfiguration.AllowCredentials).toBeUndefined();
  });

  it('สิทธิ์ AdminDeleteUser มีเฉพาะ Lambda account และจำกัดที่ user pool เดียว', () => {
    const policies = Object.values(api.findResources('AWS::IAM::Policy'));
    const withCognito = policies.filter((p) =>
      JSON.stringify(p.Properties.PolicyDocument).includes('cognito-idp'),
    );
    expect(withCognito).toHaveLength(1);
    const stmt = (
      withCognito[0]!.Properties.PolicyDocument.Statement as {
        Action: string;
        Resource: unknown;
      }[]
    ).find((s) => s.Action === 'cognito-idp:AdminDeleteUser');
    expect(stmt).toBeDefined();
    expect(JSON.stringify(stmt!.Resource)).not.toContain('*');
  });

  it('output VITE_API_URL', () => {
    api.hasOutput('ViteApiUrl', {});
  });
});
