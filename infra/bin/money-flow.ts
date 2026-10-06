import { App, Aspects, Tags } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { BudgetStack } from '../lib/budget-stack';
import { REGION, TAGS } from '../lib/config';
import { CostGuardAspect } from '../lib/cost-guard';
import { DataStack } from '../lib/data-stack';

const app = new App();

// ทุก resource ใน app นี้ติด tag project=money-flow และผ่าน cost guard
for (const [key, value] of Object.entries(TAGS)) Tags.of(app).add(key, value);
Aspects.of(app).add(new CostGuardAspect());

/**
 * ค่าที่ไม่ควร commit ลง repo สาธารณะ — ส่งผ่าน context หรือ env:
 *   npx cdk deploy -c alertEmail=you@example.com -c anomalyMonitorArn=arn:aws:ce::...
 *   (หรือ ALERT_EMAIL / ANOMALY_MONITOR_ARN)
 */
function ctx(key: string, envKey: string): string | undefined {
  const v = app.node.tryGetContext(key) ?? process.env[envKey];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

const alertEmail = ctx('alertEmail', 'ALERT_EMAIL');
if (!alertEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail)) {
  throw new Error('ต้องระบุอีเมลแจ้งเตือน: -c alertEmail=you@example.com หรือ env ALERT_EMAIL');
}
const retainData = ctx('retainData', 'RETAIN_DATA') !== 'false';
const enablePitr = ctx('enablePitr', 'ENABLE_PITR') === 'true';
const webOrigin = ctx('webOrigin', 'WEB_ORIGIN');
if (webOrigin && !/^https:\/\/[a-z0-9.-]+$/.test(webOrigin)) {
  throw new Error('webOrigin ต้องเป็น https://<domain> (ไม่มี / ท้าย)');
}

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

new BudgetStack(app, 'MoneyFlow-BudgetStack', {
  env,
  description: 'Money Flow - AWS Budgets + Cost Anomaly Detection',
  alertEmail,
  existingAnomalyMonitorArn: ctx('anomalyMonitorArn', 'ANOMALY_MONITOR_ARN'),
});

const auth = new AuthStack(app, 'MoneyFlow-AuthStack', {
  env,
  description: 'Money Flow - Cognito User Pool',
  retainData,
});

const data = new DataStack(app, 'MoneyFlow-DataStack', {
  env,
  description: 'Money Flow - DynamoDB single table',
  retainData,
  enablePitr,
});

new ApiStack(app, 'MoneyFlow-ApiStack', {
  env,
  description: 'Money Flow - HTTP API + Lambda',
  table: data.table,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  webOrigin,
});

// Phase 6: WebStack

app.synth();
