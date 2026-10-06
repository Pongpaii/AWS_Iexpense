import { createApp } from 'vue';
import App from './App.vue';
import { ApiClientError } from './api/client';
import { attachRouter } from './app-context';
import { createAppRouter } from './router';
import { showToast } from './stores/toast';
import './styles/main.css';

const app = createApp(App);
const router = createAppRouter();
attachRouter(router);
app.use(router);

/** global error handler: error ที่ไม่มีใครจับ → แจ้งผู้ใช้ (ไม่โชว์รายละเอียดภายใน) */
function report(err: unknown) {
  console.error(err);
  const message =
    err instanceof ApiClientError ? err.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่';
  showToast(message, { kind: 'error' });
}
app.config.errorHandler = (err) => report(err);
window.addEventListener('unhandledrejection', (e) => report(e.reason));

// โหลด chunk ใหม่ไม่ได้ (เช่น deploy เวอร์ชันใหม่ระหว่างใช้งาน) → โหลดหน้าใหม่
router.onError((err, to) => {
  if (
    /Failed to fetch dynamically imported module|Importing a module script failed/i.test(
      String(err),
    )
  ) {
    window.location.assign(to.fullPath);
  } else report(err);
});

app.mount('#app');

if (import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
