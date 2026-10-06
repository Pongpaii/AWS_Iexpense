import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: {
      TABLE_NAME: 'MoneyFlow-test',
      USER_POOL_ID: 'ap-southeast-1_TEST',
      AWS_REGION: 'ap-southeast-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
    },
  },
});
