import { Annotations, CfnResource, Token, type IAspect } from 'aws-cdk-lib';
import { CfnFunction } from 'aws-cdk-lib/aws-lambda';
import { CfnLogGroup } from 'aws-cdk-lib/aws-logs';
import { CfnTable } from 'aws-cdk-lib/aws-dynamodb';
import type { IConstruct } from 'constructs';
import { LAMBDA_DEFAULTS, LOG_RETENTION } from './config';

/** resource ที่ห้ามใช้ (มีค่าใช้จ่ายรายชั่วโมงหรือเกิน free tier ง่าย) */
export const FORBIDDEN_RESOURCE_PREFIXES = [
  'AWS::RDS::',
  'AWS::EC2::Instance',
  'AWS::EC2::NatGateway',
  'AWS::EC2::EIP',
  'AWS::ElasticLoadBalancing::',
  'AWS::ElasticLoadBalancingV2::',
  'AWS::ElastiCache::',
  'AWS::OpenSearchService::',
  'AWS::Elasticsearch::',
  'AWS::WAFv2::',
  'AWS::WAF::',
  'AWS::KMS::Key',
  'AWS::SecretsManager::',
  'AWS::RUM::',
] as const;

/**
 * ตรวจทุก resource ตอน synth — ถ้าผิดกฎค่าใช้จ่าย synth/deploy จะล้มทันที
 * (ด่านแรกก่อน CDK assertion tests)
 */
export class CostGuardAspect implements IAspect {
  visit(node: IConstruct): void {
    if (!(node instanceof CfnResource)) return;
    const type = node.cfnResourceType;
    const fail = (msg: string) => Annotations.of(node).addError(`[cost-guard] ${msg}`);

    if (FORBIDDEN_RESOURCE_PREFIXES.some((p) => type.startsWith(p))) {
      fail(`ห้ามใช้ ${type} (เกิน free tier / มีค่าใช้จ่ายคงที่)`);
    }

    if (node instanceof CfnFunction) {
      if (node.vpcConfig !== undefined) fail('Lambda ห้ามอยู่ใน VPC');
      const archs = node.architectures;
      if (!Array.isArray(archs) || archs.length !== 1 || archs[0] !== 'arm64') {
        fail('Lambda ต้องเป็น arm64');
      }
      if (node.memorySize !== LAMBDA_DEFAULTS.memorySize) fail('Lambda memory ต้องเป็น 256MB');
      if (typeof node.timeout !== 'number' || node.timeout > 10) fail('Lambda timeout ต้อง ≤ 10s');
      // custom resource provider ของ CDK เองใช้ runtime อื่นได้ จึงตรวจเฉพาะ function ของเรา
      if (node.runtime !== undefined && !Token.isUnresolved(node.runtime)) {
        if (!String(node.runtime).startsWith('nodejs22')) fail('Lambda ต้องเป็น Node.js 22');
      }
    }

    if (node instanceof CfnLogGroup && node.retentionInDays !== LOG_RETENTION) {
      fail(`Log group ต้อง retention ${LOG_RETENTION} วัน`);
    }

    if (node instanceof CfnTable && node.billingMode !== 'PAY_PER_REQUEST') {
      fail('DynamoDB ต้องเป็น on-demand (PAY_PER_REQUEST)');
    }
  }
}
