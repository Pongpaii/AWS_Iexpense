import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../src/App.vue';
import { loadConfig } from '../src/config';

const validEnv = {
  VITE_API_URL: 'https://abc123.execute-api.ap-southeast-1.amazonaws.com/',
  VITE_COGNITO_USER_POOL_ID: 'ap-southeast-1_AbCdEf123',
  VITE_COGNITO_CLIENT_ID: '1a2b3c4d5e6f7g8h9i0j1k2l3m',
  VITE_AWS_REGION: 'ap-southeast-1',
};

describe('loadConfig', () => {
  it('อ่านค่าครบและตัด / ท้าย URL', () => {
    const r = loadConfig(validEnv);
    expect(r).toEqual({
      ok: true,
      config: {
        apiUrl: 'https://abc123.execute-api.ap-southeast-1.amazonaws.com',
        userPoolId: 'ap-southeast-1_AbCdEf123',
        userPoolClientId: '1a2b3c4d5e6f7g8h9i0j1k2l3m',
        region: 'ap-southeast-1',
      },
    });
  });

  it('ค่าไม่ครบ → ok: false พร้อมข้อความไทย', () => {
    const r = loadConfig({ ...validEnv, VITE_COGNITO_CLIENT_ID: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('VITE_COGNITO_CLIENT_ID');
  });

  it('ไม่รับ URL ที่ไม่ใช่ http(s)', () => {
    expect(loadConfig({ ...validEnv, VITE_API_URL: 'javascript:alert(1)' }).ok).toBe(false);
  });
});

describe('App', () => {
  it('render หัวข้อภาษาไทยและแจ้งเตือนเมื่อยังไม่ตั้งค่า', () => {
    const wrapper = mount(App);
    expect(wrapper.find('h1').text()).toBe('Money Flow');
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });
});
