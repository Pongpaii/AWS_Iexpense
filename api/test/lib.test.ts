import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/lib/export';
import { decodeCursor, encodeCursor } from '../src/lib/cursor';
import { deltasFor, toAddUpdate } from '../src/lib/summary';

describe('summary deltas', () => {
  const c = {
    type: 'expense' as const,
    amount: 100,
    category: 'อาหาร',
    transactionDate: '2026-10-01',
  };

  it('เพิ่มรายการ → ADD ทั้ง SUM#month และ SUM#ALL', () => {
    const d = deltasFor([{ contribution: c, sign: 1 }]);
    expect(Object.fromEntries(d.get('SUM#2026-10')!)).toEqual({
      expense: 100,
      count: 1,
      'cat|expense|อาหาร': 100,
      'cnt|expense|อาหาร': 1,
    });
    expect(Object.fromEntries(d.get('SUM#ALL')!)).toEqual({ expense: 100, count: 1 });
  });

  it('แก้ที่ไม่กระทบยอด → ไม่มี update', () => {
    expect(
      deltasFor([
        { contribution: c, sign: -1 },
        { contribution: c, sign: 1 },
      ]).size,
    ).toBe(0);
  });

  it('UpdateExpression ใช้ placeholder ทั้งหมด (ชื่อหมวดภาษาไทยปลอดภัย)', () => {
    const u = toAddUpdate(new Map([['cat|expense|อาหาร', 5]]));
    expect(u.UpdateExpression).toBe('ADD #a0 :v0');
    expect(u.ExpressionAttributeNames).toEqual({ '#a0': 'cat|expense|อาหาร' });
  });
});

describe('cursor', () => {
  it('round-trip และไม่รับ SK ที่ไม่ใช่ TX', () => {
    const sk = 'TX#2026-10-01#01J9Z8X7W6V5T4S3R2Q1P0N9M8';
    expect(decodeCursor(encodeCursor(sk))).toBe(sk);
    expect(() => decodeCursor(encodeCursor('SETTINGS'))).toThrow();
    expect(() => decodeCursor(encodeCursor('IDEMP#x'))).toThrow();
  });
});

describe('csv', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+66', "'+66"],
    ['-x', "'-x"],
    ['@SUM', "'@SUM"],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['ปกติ', 'ปกติ'],
  ])('csvCell(%j) = %j', (input, out) => {
    expect(csvCell(input)).toBe(out);
  });

  it('ตัวเลขติดลบไม่ถูกนำหน้าด้วย quote', () => {
    expect(csvCell(-5)).toBe('-5');
  });

  it('header ภาษาไทย + CRLF', () => {
    expect(toCsv([])).toBe(
      '\uFEFFวันที่,รายละเอียด,ประเภท,หมวดหมู่,จำนวนเงิน (บาท),สร้างเมื่อ,id\r\n',
    );
  });
});
