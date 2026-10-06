import { App, Aspects, Duration, Stack, Tags } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { CfnInstance, CfnNatGateway } from 'aws-cdk-lib/aws-ec2';
import { Architecture, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { describe, expect, it } from 'vitest';
import { AuthStack } from '../lib/auth-stack';
import { BudgetStack } from '../lib/budget-stack';
import { LAMBDA_DEFAULTS, TAGS } from '../lib/config';
import { CostGuardAspect } from '../lib/cost-guard';

const env = { account: '123456789012', region: 'ap-southeast-1' };
const EMAIL = 'alerts@example.com';

function newApp() {
  const app = new App();
  Tags.of(app).add('project', TAGS.project);
  Aspects.of(app).add(new CostGuardAspect());
  return app;
}

describe('BudgetStack', () => {
  const app = newApp();
  const stack = new BudgetStack(app, 'Budget', { env, alertEmail: EMAIL });
  const t = Template.fromStack(stack);

  it('budget รายเดือน: actual $1/$5/$20 + forecast $10 ไปที่อีเมล', () => {
    t.resourceCountIs('AWS::Budgets::Budget', 1);
    const budget = Object.values(t.findResources('AWS::Budgets::Budget'))[0]!;
    const notes = budget.Properties.NotificationsWithSubscribers as {
      Notification: { NotificationType: string; Threshold: number; ThresholdType: string };
      Subscribers: { Address: string; SubscriptionType: string }[];
    }[];
    expect(
      notes.map((n) => `${n.Notification.NotificationType}:${n.Notification.Threshold}`).sort(),
    ).toEqual(['ACTUAL:1', 'ACTUAL:20', 'ACTUAL:5', 'FORECASTED:10']);
    for (const n of notes) {
      expect(n.Notification.ThresholdType).toBe('ABSOLUTE_VALUE');
      expect(n.Subscribers).toEqual([{ SubscriptionType: 'EMAIL', Address: EMAIL }]);
    }
    expect(budget.Properties.Budget).toMatchObject({ BudgetType: 'COST', TimeUnit: 'MONTHLY' });
  });

  it('Cost Anomaly Detection: สร้าง monitor + subscription อีเมล', () => {
    t.resourceCountIs('AWS::CE::AnomalyMonitor', 1);
    t.hasResourceProperties('AWS::CE::AnomalySubscription', {
      Frequency: 'DAILY',
      Subscribers: [{ Type: 'EMAIL', Address: EMAIL }],
    });
  });

  it('ใช้ monitor เดิมได้ (บัญชีมี Default-Services-Monitor อยู่แล้ว)', () => {
    const arn = 'arn:aws:ce::123456789012:anomalymonitor/abc';
    const s = new BudgetStack(newApp(), 'Budget2', {
      env,
      alertEmail: EMAIL,
      existingAnomalyMonitorArn: arn,
    });
    const t2 = Template.fromStack(s);
    t2.resourceCountIs('AWS::CE::AnomalyMonitor', 0);
    t2.hasResourceProperties('AWS::CE::AnomalySubscription', { MonitorArnList: [arn] });
  });
});

describe('AuthStack', () => {
  const stack = new AuthStack(newApp(), 'Auth', { env, retainData: true });
  const t = Template.fromStack(stack);

  it('ปิด self sign-up, login ด้วย email, ลืมรหัสผ่านทางอีเมล, Lite plan', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
      AccountRecoverySetting: {
        RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }],
      },
      EmailConfiguration: { EmailSendingAccount: 'COGNITO_DEFAULT' },
      UserPoolTier: 'LITE',
      MfaConfiguration: 'OFF',
      DeletionProtection: 'ACTIVE',
    });
  });

  it('ไม่มี SMS (ไม่มีค่าใช้จ่าย SNS)', () => {
    const pool = Object.values(t.findResources('AWS::Cognito::UserPool'))[0]!;
    expect(pool.Properties.SmsConfiguration).toBeUndefined();
    t.resourceCountIs('AWS::IAM::Role', 0);
  });

  it('retainData=true → RETAIN', () => {
    t.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Retain' });
  });

  it('App client: public (ไม่มี secret), SRP เท่านั้น, ไม่มี OAuth/Hosted UI', () => {
    t.resourceCountIs('AWS::Cognito::UserPoolDomain', 0);
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      AllowedOAuthFlowsUserPoolClient: false,
    });
    const client = Object.values(t.findResources('AWS::Cognito::UserPoolClient'))[0]!;
    expect(client.Properties.CallbackURLs).toBeUndefined();
  });

  it('output ค่าที่ frontend ต้องใช้', () => {
    t.hasOutput('ViteCognitoUserPoolId', {});
    t.hasOutput('ViteCognitoClientId', {});
    t.hasOutput('ViteAwsRegion', {});
  });

  it('retainData=false → DESTROY และปิด deletion protection', () => {
    const t2 = Template.fromStack(new AuthStack(newApp(), 'Auth2', { env, retainData: false }));
    t2.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Delete' });
    t2.hasResourceProperties('AWS::Cognito::UserPool', { DeletionProtection: 'INACTIVE' });
  });
});

describe('ทุก resource ติด tag project=money-flow', () => {
  it.each([
    ['Budget', (app: App) => new BudgetStack(app, 'B', { env, alertEmail: EMAIL })],
    ['Auth', (app: App) => new AuthStack(app, 'A', { env, retainData: true })],
  ])('%s', (_, make) => {
    const t = Template.fromStack(make(newApp()));
    // Cognito ใช้ UserPoolTags (map), resource อื่นใช้ Tags (list) — Budgets/CE ใช้ ResourceTags
    const tagged = Object.values(
      t.toJSON().Resources as Record<
        string,
        { Type: string; Properties?: Record<string, unknown> }
      >,
    ).filter((r) => !['AWS::Cognito::UserPoolClient', 'AWS::CDK::Metadata'].includes(r.Type));
    for (const r of tagged) {
      const p = r.Properties ?? {};
      const tags = (p.Tags ?? p.UserPoolTags ?? p.ResourceTags) as unknown;
      expect(JSON.stringify(tags), r.Type).toContain('money-flow');
    }
  });
});

describe('CostGuardAspect', () => {
  function errorsOf(build: (s: Stack) => void): string[] {
    const app = newApp();
    const s = new Stack(app, 'Guard', { env });
    build(s);
    app.synth({ validateOnSynthesis: false });
    return Annotations.fromStack(s)
      .findError('*', Match.stringLikeRegexp('cost-guard'))
      .map((e) => String(e.entry.data));
  }

  it('ห้าม NAT Gateway / EC2', () => {
    const errs = errorsOf((s) => {
      new CfnNatGateway(s, 'Nat', { subnetId: 'subnet-1' });
      new CfnInstance(s, 'Ec2', { imageId: 'ami-1' });
    });
    expect(errs.join('\n')).toContain('AWS::EC2::NatGateway');
    expect(errs.join('\n')).toContain('AWS::EC2::Instance');
  });

  it('Lambda ผิดสเปก (x86, 1024MB, 30s) ถูกจับ', () => {
    const errs = errorsOf((s) => {
      new LambdaFunction(s, 'Fn', {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.X86_64,
        memorySize: 1024,
        timeout: Duration.seconds(30),
        handler: 'index.handler',
        code: Code.fromInline('exports.handler=async()=>{}'),
        logGroup: new LogGroup(s, 'L', { retention: RetentionDays.ONE_WEEK }),
      });
    });
    expect(errs.some((e) => e.includes('arm64'))).toBe(true);
    expect(errs.some((e) => e.includes('256MB'))).toBe(true);
    expect(errs.some((e) => e.includes('timeout'))).toBe(true);
  });

  it('Lambda ตามสเปก + log 7 วัน ผ่าน', () => {
    const errs = errorsOf((s) => {
      new LambdaFunction(s, 'Fn', {
        ...LAMBDA_DEFAULTS,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler=async()=>{}'),
        logGroup: new LogGroup(s, 'L', { retention: RetentionDays.ONE_WEEK }),
      });
    });
    expect(errs).toEqual([]);
  });

  it('log group retention ไม่ใช่ 7 วัน ถูกจับ', () => {
    const errs = errorsOf((s) => new LogGroup(s, 'L', { retention: RetentionDays.ONE_MONTH }));
    expect(errs.some((e) => e.includes('retention'))).toBe(true);
  });
});
