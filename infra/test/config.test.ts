import { describe, expect, it } from 'vitest';
import { Duration } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { LAMBDA_DEFAULTS, LOG_RETENTION, REGION, TAGS } from '../lib/config';

describe('cost guardrail config', () => {
  it('Lambda defaults: Node 22, arm64, 256MB, ≤ 10s', () => {
    expect(LAMBDA_DEFAULTS.runtime.name).toBe('nodejs22.x');
    expect(LAMBDA_DEFAULTS.architecture.name).toBe('arm64');
    expect(LAMBDA_DEFAULTS.memorySize).toBe(256);
    expect(LAMBDA_DEFAULTS.timeout.toSeconds()).toBeLessThanOrEqual(
      Duration.seconds(10).toSeconds(),
    );
  });

  it('log retention 7 วัน, region ap-southeast-1, tag project', () => {
    expect(LOG_RETENTION).toBe(RetentionDays.ONE_WEEK);
    expect(REGION).toBe('ap-southeast-1');
    expect(TAGS).toEqual({ project: 'money-flow' });
  });
});
