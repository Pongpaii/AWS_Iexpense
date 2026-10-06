import { Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { CfnAnomalyMonitor, CfnAnomalySubscription } from 'aws-cdk-lib/aws-ce';
import type { Construct } from 'constructs';
import {
  ANOMALY_IMPACT_THRESHOLD_USD,
  BUDGET_ACTUAL_THRESHOLDS_USD,
  BUDGET_FORECAST_THRESHOLD_USD,
  PROJECT,
  TAGS,
} from './config';

// Tags.of() ไม่ส่งต่อไปยัง AWS::Budgets::Budget จึงกำหนดเองให้ทุก resource ในไฟล์นี้
const resourceTags = Object.entries(TAGS).map(([key, value]) => ({ key, value }));

export interface BudgetStackProps extends StackProps {
  /** อีเมลรับแจ้งเตือนค่าใช้จ่าย */
  alertEmail: string;
  /**
   * ARN ของ Cost Anomaly Monitor ที่มีอยู่แล้ว (แต่ละบัญชีมี AWS-services monitor ได้ 1 ตัว)
   * ถ้าไม่ระบุ จะสร้าง monitor ใหม่ (ใช้ได้เฉพาะบัญชีที่ยังไม่มี)
   */
  existingAnomalyMonitorArn?: string;
}

/**
 * AWS Budgets + Cost Anomaly Detection (ทั้งคู่ฟรี)
 * Budget ครอบคลุมทั้งบัญชี (ไม่กรองด้วย tag) เพื่อจับค่าใช้จ่ายที่ไม่ได้ติด tag ด้วย
 */
export class BudgetStack extends Stack {
  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    super(scope, id, props);

    const subscriber = { subscriptionType: 'EMAIL', address: props.alertEmail };
    const notify = (notificationType: 'ACTUAL' | 'FORECASTED', threshold: number) => ({
      notification: {
        notificationType,
        comparisonOperator: 'GREATER_THAN',
        threshold,
        thresholdType: 'ABSOLUTE_VALUE',
      },
      subscribers: [subscriber],
    });

    new CfnBudget(this, 'MonthlyCostBudget', {
      resourceTags,
      budget: {
        budgetName: `${PROJECT}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: Math.max(...BUDGET_ACTUAL_THRESHOLDS_USD), unit: 'USD' },
        // ดูค่าใช้จ่ายจริงก่อนหักเครดิต เพื่อไม่ให้เครดิตบังการใช้งานเกิน free tier
        costTypes: { includeCredit: false, includeRefund: false },
      },
      notificationsWithSubscribers: [
        ...BUDGET_ACTUAL_THRESHOLDS_USD.map((t) => notify('ACTUAL', t)),
        notify('FORECASTED', BUDGET_FORECAST_THRESHOLD_USD),
      ],
    });

    const monitorArn =
      props.existingAnomalyMonitorArn ??
      new CfnAnomalyMonitor(this, 'ServiceMonitor', {
        monitorName: `${PROJECT}-services`,
        monitorType: 'DIMENSIONAL',
        monitorDimension: 'SERVICE',
        resourceTags,
      }).attrMonitorArn;

    new CfnAnomalySubscription(this, 'AnomalySubscription', {
      subscriptionName: `${PROJECT}-anomaly-alerts`,
      frequency: 'DAILY',
      resourceTags,
      monitorArnList: [monitorArn],
      subscribers: [{ type: 'EMAIL', address: props.alertEmail }],
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: [String(ANOMALY_IMPACT_THRESHOLD_USD)],
        },
      }),
    });
  }
}
