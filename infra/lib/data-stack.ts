import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

export interface DataStackProps extends StackProps {
  /** true = เก็บตารางไว้เมื่อ destroy + เปิด deletion protection */
  retainData: boolean;
  /** Point-in-time recovery (มีค่าใช้จ่ายตามขนาดข้อมูล) — ปิดเป็นค่าเริ่มต้น */
  enablePitr: boolean;
}

/**
 * DynamoDB single-table `MoneyFlow` (on-demand)
 *   PK = USER#<sub>
 *   SK = TX#<date>#<ulid> | TXID#<ulid> | IDEMP#<uuid> | SUM#<yyyy-mm> | SUM#ALL | SETTINGS | BADGE#<id>
 * ไม่มี GSI (ทุก access pattern อยู่ใน partition ของ user) → ไม่มีค่า write เพิ่ม
 */
export class DataStack extends Stack {
  readonly table: Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.table = new Table(this, 'Table', {
      tableName: 'MoneyFlow',
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // AWS-owned key: ฟรี (ไม่ใช้ customer-managed KMS key)
      encryption: TableEncryption.DEFAULT,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.enablePitr },
      deletionProtection: props.retainData,
      removalPolicy: props.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    new CfnOutput(this, 'TableName', { value: this.table.tableName });
  }
}
