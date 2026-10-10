import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  createEngineeringRow, engineeringBackup, engineeringCsv, getEngineeringDrawings,
  parseEngineeringBackup, parseEngineeringCsv, saveEngineeringDrawings,
} from '../src/lib/engineering-data';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } },
});
beforeEach(() => storage.clear());
const drawing = () => ({
  id: 'drawing-1', name: 'PID-001', revision: 'Rev 0',
  rows: [createEngineeringRow('Equipment', 'P-101', 'PID-001')],
});

test('new workspaces are empty and disciplines stay isolated', () => {
  assert.deepEqual(getEngineeringDrawings('pid'), []);
  const data = [drawing()];
  saveEngineeringDrawings('pid', data, null);
  assert.deepEqual(getEngineeringDrawings('pid'), data);
  assert.deepEqual(getEngineeringDrawings('pfd'), []);
});

test('duplicate item tags fail without overwriting saved data', () => {
  const data = [drawing()];
  const saved = saveEngineeringDrawings('pid', data, null);
  const invalid = [{ ...data[0], rows: [...data[0].rows, createEngineeringRow('Valve', 'p-101', 'PID-001')] }];
  assert.throws(() => saveEngineeringDrawings('pid', invalid, saved), /unique item tag/);
  assert.deepEqual(getEngineeringDrawings('pid'), data);
});

test('stale edits cannot overwrite another tab', () => {
  const data = [drawing()];
  saveEngineeringDrawings('pid', data, null);
  assert.throws(() => saveEngineeringDrawings('pid', [], null), /another tab/);
  assert.deepEqual(getEngineeringDrawings('pid'), data);
});

test('damaged saved data raises an error instead of silently loading fake records', () => {
  storage.set('pid-mapping-studio:engineering-workspace:v2:pid', '{bad');
  assert.throws(() => getEngineeringDrawings('pid'));
});

test('CSV handles quotes, commas, newlines and neutralizes spreadsheet formulas', () => {
  const row = createEngineeringRow('Pipe Run', 'L-01', 'PID-001');
  row.description = 'quoted "text", next\nline';
  row.connection = '=HYPERLINK("https://example.com")';
  const csv = engineeringCsv([row]);
  const result = parseEngineeringCsv(csv, 'PID-001');
  assert.equal(result[0].description, row.description);
  assert.equal(result[0].connection, "'" + row.connection);
  assert.equal(result[0].type, 'Pipe Run');
  assert.throws(() => parseEngineeringCsv('Object type,Item Tag\nUnclear,A-1', 'PID-001'), /unsupported object type/);
});

test('backup round-trips and rejects the other discipline', () => {
  const data = [drawing()];
  const backup = engineeringBackup('pid', data);
  assert.deepEqual(parseEngineeringBackup(backup, 'pid'), data);
  assert.throws(() => parseEngineeringBackup(backup, 'pfd'), /stay separate/);
});
