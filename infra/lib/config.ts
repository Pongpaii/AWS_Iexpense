import { Duration } from 'aws-cdk-lib';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

/** ค่าคงที่ของโปรเจกต์ — ทุก stack ต้องอ้างจากที่นี่ */
export const PROJECT = 'money-flow';
export const REGION = 'ap-southeast-1';
export const TAGS = { project: PROJECT } as const;

/** ทุก log group: 7 วัน */
export const LOG_RETENTION = RetentionDays.ONE_WEEK;

/** ทุก Lambda: Node.js 22, arm64, 256MB, timeout ≤ 10s, ไม่อยู่ใน VPC */
export const LAMBDA_DEFAULTS = {
  runtime: Runtime.NODEJS_22_X,
  architecture: Architecture.ARM_64,
  memorySize: 256,
  timeout: Duration.seconds(10),
} as const;

/** API Gateway throttling */
export const API_THROTTLE = { rateLimit: 20, burstLimit: 40 } as const;

/**
 * origin ที่อนุญาตเพิ่มเติมจากโดเมน CloudFront (dev + Capacitor Android)
 * หมายเหตุ: API Gateway HTTP API รับเฉพาะ origin แบบ http/https จึงใส่ `capacitor://localhost`
 * (scheme ของ iOS) ไม่ได้ — Android ใช้ `https://localhost` (androidScheme ค่าเริ่มต้นของ Capacitor ≥ 6)
 */
export const EXTRA_CORS_ORIGINS = ['http://localhost:5173', 'https://localhost'] as const;

/** เกณฑ์ AWS Budgets (USD) */
export const BUDGET_ACTUAL_THRESHOLDS_USD = [1, 5, 20] as const;
export const BUDGET_FORECAST_THRESHOLD_USD = 10;
/** แจ้งเตือน anomaly เมื่อผลกระทบรวม ≥ $1 */
export const ANOMALY_IMPACT_THRESHOLD_USD = 1;

/** ชื่อ bucket เว็บแบบกำหนดได้ล่วงหน้า → CiStack ให้สิทธิ์ได้โดยไม่ต้องอ้างอิงข้าม stack */
export const webBucketName = (account: string, region: string) =>
  `${PROJECT}-web-${account}-${region}`;
