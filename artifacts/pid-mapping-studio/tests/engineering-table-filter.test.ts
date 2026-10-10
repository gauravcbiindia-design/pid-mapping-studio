import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngineeringRow } from '../src/lib/engineering-data';
import { getEngineeringColumnFilterOptions, matchesEngineeringColumnFilters } from '../src/lib/engineering-table-filter';

function row(type: 'Equipment' | 'Pipe Run', tag: string, status: 'Needs review' | 'Reviewed', lineSpec: string, name: string) {
  const value = createEngineeringRow(type, tag, 'Drawing 1');
  value.reviewStatus = status;
  value.lineSpec = lineSpec;
  value.equipmentName = name;
  return value;
}

test('column filter values count distinct entries and include blanks', () => {
  const rows = [
    row('Equipment', 'P-101', 'Needs review', 'CS150', 'Transfer pump'),
    row('Pipe Run', 'L-101', 'Reviewed', 'CS150', ''),
    row('Equipment', 'P-102', 'Reviewed', '', 'Transfer pump'),
  ];

  assert.deepEqual(getEngineeringColumnFilterOptions(rows, 'lineSpec'), [
    { value: 'CS150', count: 2 },
    { value: '', count: 1 },
  ]);
  assert.deepEqual(getEngineeringColumnFilterOptions(rows, 'equipmentName'), [
    { value: 'Transfer pump', count: 2 },
    { value: '', count: 1 },
  ]);
  assert.deepEqual(getEngineeringColumnFilterOptions(rows, 'type'), [
    { value: 'Equipment', count: 2 },
    { value: 'Pipe Run', count: 1 },
  ]);
});

test('independent column filters combine, including a filter for blanks', () => {
  const rows = [
    row('Equipment', 'P-101', 'Needs review', 'CS150', 'Transfer pump'),
    row('Pipe Run', 'L-101', 'Reviewed', 'CS150', ''),
    row('Equipment', 'P-102', 'Reviewed', '', 'Transfer pump'),
  ];

  assert.deepEqual(
    rows.filter((record) => matchesEngineeringColumnFilters(record, {
      type: ['Equipment'],
      reviewStatus: ['Reviewed'],
      lineSpec: [''],
    })).map((record) => record.itemTag),
    ['P-102'],
  );
  assert.equal(matchesEngineeringColumnFilters(rows[0], { reviewStatus: [] }), false);
});
