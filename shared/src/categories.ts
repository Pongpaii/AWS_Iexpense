export const EXPENSE_CATEGORIES = [
  'อาหาร',
  'เดินทาง',
  'ที่พัก',
  'บิล/สาธารณูปโภค',
  'ช้อปปิ้ง',
  'สุขภาพ',
  'บันเทิง',
  'การศึกษา',
  'อื่น ๆ',
] as const;

export const INCOME_CATEGORIES = ['เงินเดือน', 'รายได้เสริม', 'อื่น ๆ'] as const;

/** หมวดที่ต้องอยู่อันดับต้นในทุกมุมมองเกี่ยวกับงบ */
export const PRIORITY_CATEGORIES = ['อาหาร', 'เดินทาง'] as const;

/** ค่าที่ใช้แทน category = null ในการจัดกลุ่ม */
export const UNCATEGORIZED = 'ไม่ระบุหมวด';

/**
 * เรียง: อาหาร → เดินทาง → ที่เหลือตาม compare (default: ภาษาไทย)
 * stable และไม่แก้ array ต้นฉบับ
 */
export function sortByCategoryPriority<T>(
  items: readonly T[],
  getCategory: (item: T) => string | null,
  compare: (a: T, b: T) => number = (a, b) =>
    (getCategory(a) ?? UNCATEGORIZED).localeCompare(getCategory(b) ?? UNCATEGORIZED, 'th'),
): T[] {
  const rank = (item: T): number => {
    const idx = (PRIORITY_CATEGORIES as readonly string[]).indexOf(getCategory(item) ?? '');
    return idx === -1 ? PRIORITY_CATEGORIES.length : idx;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || compare(a, b));
}
