import { z } from 'zod';

/**
 * ค่า config ฝั่ง client — ทั้งหมดเป็นค่า public (ไม่มี secret)
 * Cognito App Client ต้องเป็น public client (ไม่มี client secret)
 */
const configSchema = z.object({
  VITE_API_URL: z
    .url({ protocol: /^https?$/, error: 'VITE_API_URL ต้องเป็น URL' })
    .transform((u) => u.replace(/\/+$/, '')),
  VITE_COGNITO_USER_POOL_ID: z
    .string({ error: 'ไม่พบ VITE_COGNITO_USER_POOL_ID' })
    .regex(/^[a-z]{2}(-[a-z]+)+-\d_[A-Za-z0-9]+$/, {
      error: 'VITE_COGNITO_USER_POOL_ID ไม่ถูกต้อง',
    }),
  VITE_COGNITO_CLIENT_ID: z
    .string({ error: 'ไม่พบ VITE_COGNITO_CLIENT_ID' })
    .regex(/^[a-z0-9]{20,128}$/, { error: 'VITE_COGNITO_CLIENT_ID ไม่ถูกต้อง' }),
  VITE_AWS_REGION: z
    .string({ error: 'ไม่พบ VITE_AWS_REGION' })
    .regex(/^[a-z]{2}(-[a-z]+)+-\d$/, { error: 'VITE_AWS_REGION ไม่ถูกต้อง' }),
});

export interface AppConfig {
  apiUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  region: string;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; message: string };

/** อ่าน config; ถ้าไม่ครบ แอปยังเปิดได้ใน Demo mode */
export function loadConfig(env: Record<string, unknown> = import.meta.env): ConfigResult {
  const r = configSchema.safeParse(env);
  if (!r.success) {
    return { ok: false, message: r.error.issues[0]?.message ?? 'การตั้งค่าไม่ครบถ้วน' };
  }
  return {
    ok: true,
    config: {
      apiUrl: r.data.VITE_API_URL,
      userPoolId: r.data.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: r.data.VITE_COGNITO_CLIENT_ID,
      region: r.data.VITE_AWS_REGION,
    },
  };
}
