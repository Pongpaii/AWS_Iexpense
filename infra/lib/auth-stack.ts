import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import {
  AccountRecovery,
  FeaturePlan,
  Mfa,
  UserPool,
  UserPoolEmail,
} from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import { PROJECT } from './config';

export interface AuthStackProps extends StackProps {
  /** true = เก็บ User Pool ไว้เมื่อ destroy (กันผู้ใช้หายโดยไม่ตั้งใจ) */
  retainData: boolean;
}

/**
 * Cognito User Pool — Lite plan (ฟรี 10,000 MAU), admin สร้าง user เอง, ไม่มี Hosted UI
 * อีเมล (เชิญ/ลืมรหัสผ่าน) ส่งผ่าน Cognito default (ฟรี, จำกัด ~50 ฉบับ/วัน)
 */
export class AuthStack extends Stack {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${PROJECT}-users`,
      featurePlan: FeaturePlan.LITE,
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: false },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      keepOriginal: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      email: UserPoolEmail.withCognito(),
      mfa: Mfa.OFF,
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
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
