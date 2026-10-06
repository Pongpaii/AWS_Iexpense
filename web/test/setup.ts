import 'fake-indexeddb/auto';
import { enableAutoUnmount } from '@vue/test-utils';
import { afterEach } from 'vitest';

// ถอด component ทุกตัวหลังแต่ละ test (กัน watcher ค้างข้าม test)
enableAutoUnmount(afterEach);
