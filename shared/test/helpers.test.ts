import { describe, expect, it } from 'vitest';
import { formatBaht, isWholeBaht } from '../src/money';
import { charLength, sanitizeText } from '../src/text';
import { isValidIsoDate, isValidTimeZone, maxTransactionDate } from '../src/date';
import { sortByCategoryPriority } from '../src/categories';

describe('money (บาทจำนวนเต็ม)', () => {
  it('isWholeBaht', () => {
    expect(isWholeBaht(1, 10)).toBe(true);
    expect(isWholeBaht(10, 10)).toBe(true);
    expect(isWholeBaht(11, 10)).toBe(false);
    expect(isWholeBaht(0, 10)).toBe(false);
    expect(isWholeBaht(1.5, 10)).toBe(false);
    expect(isWholeBaht(Number.NaN, 10)).toBe(false);
  });
  it('formatBaht ไม่มีทศนิยม', () => {
    expect(formatBaht(1234)).toContain('1,234');
    expect(formatBaht(1234)).not.toContain('.');
  });
});

describe('sanitizeText', () => {
  it('ลบ control chars และ bidi override แล้ว trim', () => {
    expect(sanitizeText('  ข้าว\u0000มัน\u0007ไก่\n\t ')).toBe('ข้าวมันไก่');
    expect(sanitizeText('a\u202Eb\u2066c')).toBe('abc');
  });
  it('นับ emoji เป็น 1 ตัวอักษร', () => {
    expect(charLength('🍜🍜')).toBe(2);
  });
});

describe('date helpers', () => {
  it('ตรวจวันที่ในปฏิทินจริง', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2025-02-29')).toBe(false);
    expect(isValidIsoDate('2025-13-01')).toBe(false);
    expect(isValidIsoDate('2025-1-01')).toBe(false);
  });
  it('maxTransactionDate = วันนี้ + 1 ปี (UTC)', () => {
    expect(maxTransactionDate(new Date('2026-10-06T23:30:00Z'))).toBe('2027-10-06');
  });
  it('ตรวจ IANA timezone', () => {
    expect(isValidTimeZone('Asia/Bangkok')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('+07:00')).toBe(false);
  });
});

describe('sortByCategoryPriority', () => {
  it('อาหาร และ เดินทาง อยู่อันดับต้นเสมอ', () => {
    const sorted = sortByCategoryPriority(
      ['ช้อปปิ้ง', 'เดินทาง', 'บันเทิง', 'อาหาร', null],
      (c) => c,
    );
    expect(sorted.slice(0, 2)).toEqual(['อาหาร', 'เดินทาง']);
    expect(sorted).toHaveLength(5);
  });
});
