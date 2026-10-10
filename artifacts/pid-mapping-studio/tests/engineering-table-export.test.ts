import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { createEngineeringRow, parseEngineeringCsv } from '../src/lib/engineering-data';
import { engineeringGroupSummary, engineeringTableValues, engineeringViewCsv, engineeringViewExcel } from '../src/lib/engineering-table-export';
import type { EngineeringTableView } from '../src/lib/engineering-table-export';

function view(): EngineeringTableView {
  const valve = createEngineeringRow('Valve', 'XV-20', 'PID-001');
  const pump = createEngineeringRow('Equipment', 'P-10', 'PID-001');
  valve.description = 'Valve, "manual"\nsecond line';
  pump.description = '=HYPERLINK("https://example.com")';
  valve.pipingMaterial = pump.pipingMaterial = 'A1';
  return { fields: ['description', 'itemTag'], rows: [valve, pump], groups: ['pipingMaterial'] };
}

test('current table columns, order and rows are reused without re-sorting or leaking hidden fields', () => {
  const table = engineeringTableValues(view());
  assert.deepEqual(table.headers, ['#', 'Object type', 'Description', 'Item Tag']);
  assert.equal(table.rows[0][3], 'XV-20');
  assert.equal(table.rows[1][3], 'P-10');
  assert.equal(table.rows[1][0], 2);
  assert.equal(table.rows[0].length, 4);
});

test('CSV retains table schema and multiline text while guarding spreadsheet formulas', () => {
  const source = view();
  const csv = engineeringViewCsv(source);
  assert.match(csv, /^\uFEFF"#","Object type","Description","Item Tag"/);
  const imported = parseEngineeringCsv(csv, 'PID-001');
  assert.equal(imported[0].description, source.rows[0].description);
  assert.equal(imported[1].description, "'" + source.rows[1].description);
  assert.equal(imported.length, 2);
});

test('group counts use only the rows in the filtered snapshot', () => {
  const source = view();
  assert.deepEqual(engineeringGroupSummary(source)[0].values, [{ value: 'A1', count: 2 }]);
  assert.deepEqual(engineeringGroupSummary({ ...source, rows: source.rows.slice(0, 1) })[0].values, [{ value: 'A1', count: 1 }]);
});

test('real XLSX round-trips schema, ordered data, style, filters and grouping', async () => {
  const source = view();
  const bytes = await engineeringViewExcel(source, {
    discipline: 'P&ID', drawing: 'PID-001', revision: 'Rev 0', filter: 'All types', search: '', sort: 'Item Tag descending',
  });
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes.buffer);
  const sheet = book.getWorksheet('Engineering data')!;
  assert.deepEqual(sheet.getRow(5).values.slice(1), ['#', 'Object type', 'Description', 'Item Tag']);
  assert.equal(sheet.getCell('D6').value, 'XV-20');
  assert.equal(sheet.getCell('C6').value, source.rows[0].description);
  assert.equal(sheet.getCell('C7').value, source.rows[1].description);
  assert.equal(sheet.getRow(5).getCell(1).font.bold, true);
  assert.equal(sheet.getColumn(3).width, 38);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 5);
  assert.equal(sheet.autoFilter, 'A5:D7');
  assert.deepEqual(book.getWorksheet('Group summaries')!.getRow(2).values.slice(1), ['Piping Material', 'A1', 2]);
});

test('exports include every matching row across table pagination', () => {
  const rows = Array.from({ length: 27 }, (_, index) => createEngineeringRow('Equipment', `P-${index + 1}`, 'PID-001'));
  const table = engineeringTableValues({ fields: ['itemTag'], rows, groups: [] });
  assert.equal(table.rows.length, 27);
  assert.deepEqual(table.rows[26], [27, 'Equipment', 'P-27']);
});
