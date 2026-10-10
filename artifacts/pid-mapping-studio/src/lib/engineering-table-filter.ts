import type { EngineeringField, EngineeringRow } from '@/lib/engineering-data';

export type EngineeringFilterColumn = EngineeringField | 'type';
export type EngineeringColumnFilters = Partial<Record<EngineeringFilterColumn, string[]>>;
export type EngineeringColumnFilterOption = { value: string; count: number };

export function engineeringFilterValue(row: EngineeringRow, field: EngineeringFilterColumn): string {
  const value = String(field === 'type' ? row.type : row[field] ?? '');
  return value.trim() ? value : '';
}

export function getEngineeringColumnFilterOptions(
  rows: readonly EngineeringRow[],
  field: EngineeringFilterColumn,
): EngineeringColumnFilterOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = engineeringFilterValue(row, field);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      if (a.value === '') return b.value === '' ? 0 : 1;
      if (b.value === '') return -1;
      return a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: 'base' });
    });
}

export function matchesEngineeringColumnFilters(
  row: EngineeringRow,
  filters: EngineeringColumnFilters,
): boolean {
  return Object.entries(filters).every(([field, selected]) =>
    selected === undefined ||
    selected.includes(engineeringFilterValue(row, field as EngineeringFilterColumn)),
  );
}
