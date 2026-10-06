import { describe, expect, it } from 'vitest';
import { authErrorMessage, passwordProblems } from '../src/auth/auth';
import { currentMonth, monthRange, shiftMonth, todayLocal } from '../src/lib/date';

describe('date helpers', () => {
  it('todayLocal ใช้เวลาเครื่อง ไม่ใช่ UTC', () => {
    const d = new Date(2026, 9, 6, 23, 30); // 23:30 local
    expect(todayLocal(d)).toBe('2026-10-06');
    expect(currentMonth(d)).toBe('2026-10');
  });
  it('monthRange รวมวันสุดท้ายของเดือน (ปีอธิกสุรทิน)', () => {
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
  it('shiftMonth ข้ามปี', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});

describe('auth helpers', () => {
  it('password policy ตรงกับ Cognito', () => {
    expect(passwordProblems('Abcdefghi1')).toEqual([]);
    expect(passwordProblems('abc')).toHaveLength(3);
  });
  it('error ของ Cognito → ภาษาไทย', () => {
    expect(authErrorMessage({ name: 'CodeMismatchException' })).toBe('รหัสยืนยันไม่ถูกต้อง');
    expect(authErrorMessage({ name: 'LimitExceededException' })).toContain('รอสักครู่');
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toContain('เครือข่าย');
  });
});
