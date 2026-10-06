// สรุปค่าใช้จ่ายก่อน deploy: อ่าน template ใน infra/cdk.out แล้วบอกว่า resource ไหน "อาจมีค่าใช้จ่ายนอก free tier"
//   npx cdk synth -c alertEmail=... && node scripts/cost-report.mjs
// ใน GitHub Actions จะเขียนลง Job Summary ด้วย; exit 1 ถ้าพบ resource ต้องห้าม
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../infra/cdk.out/', import.meta.url));

/** [หมวดค่าใช้จ่าย, คำอธิบาย] — 'free' | 'watch' (อาจมีค่าใช้จ่ายเมื่อเกิน/หลัง 12 เดือน) */
const RULES = [
  [/^AWS::Lambda::Function$/, 'free', 'Always Free: 1M requests + 400,000 GB-s ต่อเดือน'],
  [/^AWS::Lambda::Permission$/, 'free', 'ฟรี'],
  [
    /^AWS::DynamoDB::Table$/,
    'watch',
    'On-demand ไม่อยู่ใน free tier ของ RCU/WCU — คิดตามจำนวน request (หลักสตางค์ที่การใช้ส่วนตัว); storage 25GB ฟรี',
  ],
  [
    /^AWS::ApiGatewayV2::Api$/,
    'watch',
    'Free tier 1M calls/เดือน เฉพาะ 12 เดือนแรก จากนั้นราว $1.27/ล้าน calls',
  ],
  [/^AWS::ApiGatewayV2::/, 'free', 'ส่วนประกอบของ HTTP API (ไม่คิดแยก)'],
  [/^AWS::CloudFront::Distribution$/, 'free', 'Always Free: 1TB transfer + 10M requests ต่อเดือน'],
  [/^AWS::CloudFront::Function$/, 'free', 'Always Free: 2M invocations ต่อเดือน'],
  [/^AWS::CloudFront::/, 'free', 'ฟรี (policy/OAC)'],
  [
    /^AWS::S3::Bucket$/,
    'watch',
    'Free tier 5GB เฉพาะ 12 เดือนแรก จากนั้นราว $0.025/GB-เดือน (เว็บนี้ < 5MB)',
  ],
  [/^AWS::S3::BucketPolicy$/, 'free', 'ฟรี'],
  [/^AWS::Logs::LogGroup$/, 'watch', 'ingest 5GB/เดือนฟรี เกินจากนั้น ~$0.70/GB; เก็บ 7 วัน'],
  [/^AWS::Cognito::UserPool$/, 'free', 'Lite plan: ฟรี 10,000 MAU'],
  [/^AWS::Cognito::/, 'free', 'ฟรี'],
  [/^AWS::Budgets::Budget$/, 'free', 'ฟรี (ไม่มี budget action)'],
  [/^AWS::CE::/, 'free', 'Cost Anomaly Detection ฟรี'],
  [/^AWS::IAM::/, 'free', 'ฟรี'],
  [/^AWS::CDK::Metadata$/, 'free', 'metadata ของ CDK'],
];

const FORBIDDEN = [
  /^AWS::RDS::/,
  /^AWS::EC2::(Instance|NatGateway|EIP)$/,
  /^AWS::ElasticLoadBalancing(V2)?::/,
  /^AWS::ElastiCache::/,
  /^AWS::(OpenSearchService|Elasticsearch)::/,
  /^AWS::WAF(v2)?::/,
  /^AWS::KMS::Key$/,
  /^AWS::SecretsManager::/,
  /^AWS::RUM::/,
];

if (!existsSync(OUT)) {
  console.error('ไม่พบ infra/cdk.out — รัน `npx cdk synth` ก่อน');
  process.exit(2);
}

const rows = [];
let forbidden = 0;
for (const file of readdirSync(OUT)
  .filter((f) => f.endsWith('.template.json'))
  .sort()) {
  const stack = file.replace('.template.json', '');
  const tpl = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
  const counts = new Map();
  for (const r of Object.values(tpl.Resources ?? {}))
    counts.set(r.Type, (counts.get(r.Type) ?? 0) + 1);
  for (const [type, n] of [...counts].sort()) {
    const bad = FORBIDDEN.some((re) => re.test(type));
    const rule = RULES.find(([re]) => re.test(type));
    const level = bad ? 'forbidden' : (rule?.[1] ?? 'unknown');
    if (bad) forbidden++;
    rows.push({
      stack,
      type,
      n,
      level,
      note: bad ? 'ห้ามใช้ตามข้อกำหนด' : (rule?.[2] ?? 'ไม่รู้จัก — ตรวจสอบราคาก่อน deploy'),
    });
  }
}

const ICON = { free: '🟢', watch: '🟡', unknown: '🟠', forbidden: '🔴' };
const watch = rows.filter((r) => r.level !== 'free');
const lines = [
  '## สรุปค่าใช้จ่ายก่อน deploy',
  '',
  watch.length
    ? `**อาจมีค่าใช้จ่ายนอก free tier (${watch.length} รายการ):**`
    : '**ไม่มี resource ที่มีค่าใช้จ่ายนอก free tier**',
  '',
  ...watch.map((r) => `- ${ICON[r.level]} \`${r.stack}\` ${r.type} ×${r.n} — ${r.note}`),
  '',
  'ประมาณการที่ผู้ใช้ 1–10 คน: **< $0.10/เดือน** (budget แจ้งเตือนที่ $1 / $5 / $20 และ forecast $10)',
  '',
  '<details><summary>resource ทั้งหมด</summary>',
  '',
  '| | Stack | Resource | จำนวน | หมายเหตุ |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${ICON[r.level]} | ${r.stack} | ${r.type} | ${r.n} | ${r.note} |`),
  '',
  '</details>',
];
const md = lines.join('\n');
console.info(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
if (forbidden) {
  console.error(`พบ resource ต้องห้าม ${forbidden} รายการ`);
  process.exit(1);
}
