import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import {
  AccountRecovery,
  CfnUserPoolGroup,
  FeaturePlan,
  Mfa,
  UserPool,
  UserPoolEmail,
  UserPoolOperation,
} from 'aws-cdk-lib/aws-cognito';
import { Code, Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { LAMBDA_DEFAULTS, LOG_RETENTION, PROJECT } from './config';

/** ชื่อ Cognito group ของบัญชีทดลองที่ใช้ร่วมกัน (API ห้ามลบบัญชีใน group นี้) */
export const DEMO_GROUP = 'demo';

/**
 * Pre sign-up trigger: ยืนยันบัญชีให้อัตโนมัติ → สมัครแล้วเข้าใช้ได้ทันที ไม่ต้องกรอกรหัสจากอีเมล
 * ไม่ auto-verify อีเมล เพื่อไม่ให้ใครใช้ "ลืมรหัสผ่าน" ส่งอีเมลไปหาที่อยู่ที่ไม่ใช่ของตัวเอง
 */
const PRE_SIGN_UP_CODE = `
exports.handler = async (event) => {
  if (event.triggerSource === 'PreSignUp_SignUp') {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = false;
  }
  return event;
};
`;

export interface AuthStackProps extends StackProps {
  /** true = เก็บ User Pool ไว้เมื่อ destroy (กันผู้ใช้หายโดยไม่ตั้งใจ) */
  retainData: boolean;
}

/**
 * Cognito User Pool — Lite plan (ฟรี 10,000 MAU), เปิดให้สมัครเองด้วยอีเมล (ยืนยันอัตโนมัติ ไม่ต้องกรอกรหัส),
 * admin ยังสร้าง user ให้ได้, ไม่มี Hosted UI
 * อีเมล (ยืนยันการสมัคร/เชิญ/ลืมรหัสผ่าน) ส่งผ่าน Cognito default (ฟรี, จำกัด ~50 ฉบับ/วัน)
 */
export class AuthStack extends Stack {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${PROJECT}-users`,
      featurePlan: FeaturePlan.LITE,
      // สมัครเองได้: PreSignUp trigger ด้านล่างยืนยันบัญชีให้อัตโนมัติ
      selfSignUpEnabled: true,
      signInAliases: { email: true, username: false },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      keepOriginal: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      email: UserPoolEmail.withCognito(),
      mfa: Mfa.OFF,
      // แอป demo/Portfolio: ให้บัญชีทดลองใช้รหัสง่าย ๆ ได้ (6 คือขั้นต่ำที่ Cognito ยอม)
      passwordPolicy: {
        minLength: 6,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(7),
      },
      userInvitation: {
        emailSubject: 'เชิญเข้าใช้งาน Money Flow',
        emailBody:
          'สวัสดีครับ คุณได้รับเชิญให้ใช้งาน Money Flow<br/>' +
          'อีเมล: {username}<br/>รหัสผ่านชั่วคราว: {####}<br/>' +
          'กรุณาเข้าสู่ระบบและตั้งรหัสผ่านใหม่ภายใน 7 วัน',
      },
      userVerification: {
        emailSubject: 'รหัสยืนยัน Money Flow',
        emailBody: 'รหัสยืนยันของคุณคือ {####} (ใช้ได้ภายในเวลาจำกัด)',
      },
      deletionProtection: props.retainData,
      removalPolicy: props.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Demo/Portfolio: สมัครเองโดยไม่ต้องยืนยันอีเมล (ไม่มี dependency → inline code, ไม่ต้อง bundle)
    const preSignUpFn = new LambdaFunction(this, 'PreSignUpFn', {
      ...LAMBDA_DEFAULTS,
      functionName: `${PROJECT}-presignup`,
      handler: 'index.handler',
      code: Code.fromInline(PRE_SIGN_UP_CODE),
      logGroup: new LogGroup(this, 'PreSignUpLogs', {
        logGroupName: `/aws/lambda/${PROJECT}-presignup`,
        retention: LOG_RETENTION,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    this.userPool.addTrigger(UserPoolOperation.PRE_SIGN_UP, preSignUpFn);

    new CfnUserPoolGroup(this, 'DemoGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: DEMO_GROUP,
      description: 'บัญชีทดลองที่ใช้ร่วมกัน (ห้ามลบบัญชี)',
    });

    // Public client สำหรับ SPA/Capacitor: ไม่มี secret, ใช้ SRP ผ่าน aws-amplify, ไม่มี OAuth/Hosted UI
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${PROJECT}-web`,
      generateSecret: false,
      authFlows: { userSrp: true, user: false, userPassword: false, adminUserPassword: false },
      disableOAuth: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      authSessionValidity: Duration.minutes(5),
    });

    new CfnOutput(this, 'UserPoolId', {
      key: 'ViteCognitoUserPoolId',
      description: 'VITE_COGNITO_USER_POOL_ID',
      value: this.userPool.userPoolId,
    });
    new CfnOutput(this, 'UserPoolClientId', {
      key: 'ViteCognitoClientId',
      description: 'VITE_COGNITO_CLIENT_ID',
      value: this.userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, 'Region', {
      key: 'ViteAwsRegion',
      description: 'VITE_AWS_REGION',
      value: this.region,
    });
  }
}
