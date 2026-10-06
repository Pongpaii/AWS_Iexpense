// ขอ access token จาก Cognito (SRP ผ่าน aws-amplify) สำหรับทดสอบ API ด้วย curl
//
//   node scripts/get-token.mjs <email>
//   (รหัสผ่านอ่านจาก env MF_PASSWORD หรือถามทาง stdin — ไม่รับจาก argument เพื่อไม่ให้ค้างใน history)
//
// ค่า pool/client อ่านจาก web/.env.local
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signIn, signOut } from 'aws-amplify/auth';

const env = Object.fromEntries(
  readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^VITE_\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const email = process.argv[2];
if (!email) {
  console.error('usage: node scripts/get-token.mjs <email>');
  process.exit(1);
}
let password = process.env.MF_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  password = await rl.question('Password: ');
  rl.close();
}

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: env.VITE_COGNITO_CLIENT_ID,
    },
  },
});

const res = await signIn({ username: email, password });
if (!res.isSignedIn) {
  console.error(`ยัง login ไม่สำเร็จ: ${res.nextStep.signInStep} (ตั้งรหัสผ่านใหม่ผ่านแอปก่อน)`);
  process.exit(2);
}
const { tokens } = await fetchAuthSession();
process.stdout.write(String(tokens?.accessToken));
await signOut();
