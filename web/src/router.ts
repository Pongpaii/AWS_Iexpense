import { createRouter, createWebHistory, type Router } from 'vue-router';
import { restoreSession, startDemo } from './app-context';
import { hasAccess, session } from './stores/session';

declare module 'vue-router' {
  interface RouteMeta {
    title: string;
    requiresAuth?: boolean;
    /** demo mode เข้าไม่ได้ (เช่น หน้าที่มีแต่การเขียนข้อมูล) */
    noDemo?: boolean;
  }
}

export function createAppRouter(): Router {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: '/',
        name: 'home',
        component: () => import('./views/DashboardView.vue'),
        meta: { title: 'ภาพรวม', requiresAuth: true },
      },
      {
        path: '/analytics',
        name: 'analytics',
        component: () => import('./views/AnalyticsView.vue'),
        meta: { title: 'วิเคราะห์', requiresAuth: true },
      },
      {
        path: '/achievements',
        name: 'achievements',
        component: () => import('./views/AchievementsView.vue'),
        meta: { title: 'ความสำเร็จ', requiresAuth: true },
      },
      {
        path: '/settings',
        name: 'settings',
        component: () => import('./views/SettingsView.vue'),
        meta: { title: 'ตั้งค่า', requiresAuth: true },
      },
      {
        path: '/login',
        name: 'login',
        component: () => import('./views/LoginView.vue'),
        meta: { title: 'เข้าสู่ระบบ' },
      },
      {
        path: '/demo',
        name: 'demo',
        // ไม่มี component จริง: guard จะเริ่ม demo แล้ว redirect ไปหน้าแรก
        component: () => import('./views/NotFoundView.vue'),
        meta: { title: 'โหมดทดลอง' },
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: () => import('./views/NotFoundView.vue'),
        meta: { title: 'ไม่พบหน้า' },
      },
    ],
    scrollBehavior: () => ({ top: 0 }),
  });

  router.beforeEach(async (to) => {
    if (session.status === 'unknown') await restoreSession();
    if (to.name === 'demo') {
      if (session.status !== 'signedIn') await startDemo();
      return { name: 'home' };
    }
    if (to.meta.requiresAuth && !hasAccess()) {
      return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
    }
    if (to.name === 'login' && session.status === 'signedIn') return { name: 'home' };
    return true;
  });

  router.afterEach((to) => {
    document.title = `${to.meta.title} · Money Flow`;
  });

  return router;
}
