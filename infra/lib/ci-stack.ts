import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import {
  OidcProviderNative,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { PROJECT, webBucketName } from './config';

export interface CiStackProps extends StackProps {
  /** "owner/repo" บน GitHub */
  githubRepo: string;
  /** branch ที่ deploy ได้ */
  branch: string;
  /** ARN ของ GitHub OIDC provider ที่มีอยู่แล้ว (1 บัญชีมีได้ 1 ตัวต่อ URL) */
  existingOidcProviderArn?: string;
}

const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';

/**
 * GitHub Actions → AWS ผ่าน OIDC (ไม่มี access key เก็บใน GitHub)
 * แยกเป็น stack ของตัวเอง และ CI ไม่ deploy stack นี้ → workflow แก้สิทธิ์ของตัวเองไม่ได้
 *
 * สิทธิ์ของ role:
 * - assume เฉพาะ role ที่ `cdk bootstrap` สร้าง (cdk-hnb659fds-*) สำหรับ `cdk deploy`
 * - อ่าน output ของ stack MoneyFlow-*
 * - s3 sync ได้เฉพาะ bucket เว็บของแอปนี้, invalidate CloudFront ได้เฉพาะในบัญชีนี้
 */
export class CiStack extends Stack {
  readonly role: Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const providerArn =
      props.existingOidcProviderArn ??
      new OidcProviderNative(this, 'GithubOidc', {
        url: GITHUB_OIDC_URL,
        clientIds: ['sts.amazonaws.com'],
      }).oidcProviderArn;

    this.role = new Role(this, 'GithubDeployRole', {
      roleName: `${PROJECT}-github-deploy`,
      description: `GitHub Actions deploy role for ${props.githubRepo} (${props.branch})`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new WebIdentityPrincipal(providerArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          // ต้องเป็น repo + branch นี้เท่านั้น (PR จาก fork / branch อื่น assume ไม่ได้)
          'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:ref:refs/heads/${props.branch}`,
        },
      }),
    });

    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'ReadStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: [
          `arn:${this.partition}:cloudformation:${this.region}:${this.account}:stack/MoneyFlow-*/*`,
        ],
      }),
    );

    const bucketArn = `arn:${this.partition}:s3:::${webBucketName(this.account, this.region)}`;
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'SyncWebBucket',
        actions: ['s3:ListBucket'],
        resources: [bucketArn],
      }),
    );
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'WriteWebObjects',
        actions: ['s3:PutObject', 's3:DeleteObject', 's3:GetObject'],
        resources: [`${bucketArn}/*`],
      }),
    );
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'InvalidateCdn',
        actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
        // distribution id ยังไม่รู้ตอนสร้าง role; บัญชีนี้มีเฉพาะแอปนี้
        resources: [`arn:${this.partition}:cloudfront::${this.account}:distribution/*`],
      }),
    );
    new CfnOutput(this, 'RoleArn', {
      key: 'GithubDeployRoleArn',
      description: 'ใส่เป็น GitHub repository variable AWS_DEPLOY_ROLE_ARN',
      value: this.role.roleArn,
    });
  }
}
