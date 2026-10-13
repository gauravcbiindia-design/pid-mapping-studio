import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  createEngineeringRow, engineeringBackup, engineeringCsv, getEngineeringDrawings, getEngineeringPlacementStatus,
  parseEngineeringBackup, parseEngineeringCsv, saveEngineeringDrawings, savePdfExtraction,
} from '../src/lib/engineering-data';

const storage = new Map<string, string>();
let failNextStorageWrite = false;
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failNextStorageWrite) {
        failNextStorageWrite = false;
        throw new Error('Storage full');
      }
      storage.set(key, value);
    },
  } },
});
beforeEach(() => { storage.clear(); failNextStorageWrite = false; });
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

test('CAD placement status uses its own reference and never the source PDF reference', () => {
  const row = createEngineeringRow('Equipment', 'P-101', 'PDF 1 · Page 1');
  const activeDrawing = { id: 'drawing-1', name: 'PID-001', revision: 'Rev 0', rows: [] };
  assert.equal(getEngineeringPlacementStatus(row, activeDrawing), 'available');
  row.placementDrawingRef = 'pid-001';
  assert.equal(getEngineeringPlacementStatus(row, activeDrawing), 'current');
  row.placementDrawingRef = 'PID-002';
  assert.equal(getEngineeringPlacementStatus(row, activeDrawing), 'another');
});

test('duplicate non-pipe tags fail without overwriting saved data', () => {
  const data = [drawing()];
  const saved = saveEngineeringDrawings('pid', data, null);
  const invalid = [{ ...data[0], rows: [...data[0].rows, createEngineeringRow('Valve', 'p-101', 'PID-001')] }];
  assert.throws(() => saveEngineeringDrawings('pid', invalid, saved), /tag is already used/);
  assert.deepEqual(getEngineeringDrawings('pid'), data);
});

test('Stable IDs are 32 uppercase hex characters, independent of the object tag', () => {
  const row = createEngineeringRow('Equipment', 'P-101', 'PID-001');
  const stableId = row.id;
  assert.match(stableId, /^[0-9A-F]{32}$/);
  row.itemTag = 'P-202';
  assert.equal(row.id, stableId);
});

test('same-tag Pipe Runs are allowed only when line-defining data identifies a different run', () => {
  const first = createEngineeringRow('Pipe Run', 'L-100', 'PID-001');
  first.lineSpec = 'A1';
  first.nominalDiameter = '2 IN';
  const second = createEngineeringRow('Pipe Run', 'L-100', 'PID-001');
  second.lineSpec = 'B2';
  second.nominalDiameter = '2 IN';
  const data = [{ ...drawing(), rows: [first, second] }];
  const saved = saveEngineeringDrawings('pid', data, null);
  assert.equal(getEngineeringDrawings('pid')[0].rows.length, 2);

  const duplicate = createEngineeringRow('Pipe Run', 'L-100', 'PID-001');
  duplicate.lineSpec = 'A1';
  duplicate.nominalDiameter = '2 IN';
  assert.throws(() => saveEngineeringDrawings('pid', [{ ...data[0], rows: [...data[0].rows, duplicate] }], saved), /different line-defining data/);
});

test('Pipe Run group status only accepts the agreed EDE values', () => {
  const row = createEngineeringRow('Pipe Run', 'L-100', 'PID-001');
  row.groupStatus = 'Branch';
  saveEngineeringDrawings('pid', [{ ...drawing(), rows: [row] }], null);
  assert.throws(() => saveEngineeringDrawings('pid', [{ ...drawing(), rows: [{ ...row, groupStatus: 'Branch-2' }] }], null), /Pipe Run group status/);
});

test('Stable IDs are unique across drawings, even when tags differ', () => {
  const first = createEngineeringRow('Equipment', 'P-101', 'PID-001');
  const second = { ...createEngineeringRow('Equipment', 'P-102', 'PID-002'), id: first.id };
  const data = [
    { id: 'drawing-1', name: 'PID-001', revision: 'Rev 0', rows: [first] },
    { id: 'drawing-2', name: 'PID-002', revision: 'Rev 0', rows: [second] },
  ];
  assert.throws(() => saveEngineeringDrawings('pid', data, null), /valid Stable ID/);
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
  row.notes = 'Line 1\nLine 2: keep the note';
  row.connection = '=HYPERLINK("https://example.com")';
  const csv = engineeringCsv([row]);
  const result = parseEngineeringCsv(csv, 'PID-001');
  assert.equal(result[0].description, row.description);
  assert.equal(result[0].notes, row.notes);
  assert.equal(result[0].connection, "'" + row.connection);
  assert.equal(result[0].type, 'Pipe Run');
  assert.equal(result[0].id, row.id);
  assert.throws(() => parseEngineeringCsv('Object type,Item Tag\nUnclear,A-1', 'PID-001'), /unsupported object type/);
});

test('backup round-trips and rejects the other discipline', () => {
  const data = [drawing()];
  const backup = engineeringBackup('pid', data);
  assert.deepEqual(parseEngineeringBackup(backup, 'pid'), data);
  assert.throws(() => parseEngineeringBackup(backup, 'pfd'), /stay separate/);
});

test('older local records migrate to manual review status without losing their fields', () => {
  const legacy = drawing();
  const legacyRow = { ...legacy.rows[0] } as Record<string, unknown>;
  delete legacyRow.sourcePage;
  delete legacyRow.reviewStatus;
  storage.set('pid-mapping-studio:engineering-workspace:v2:pid', JSON.stringify([{
    ...legacy,
    rows: [legacyRow],
  }]));

  const migrated = getEngineeringDrawings('pid')[0].rows[0];
  assert.equal(migrated.itemTag, 'P-101');
  assert.equal(migrated.sourcePage, '');
  assert.equal(migrated.lineSpec, '');
  assert.equal(migrated.reviewStatus, 'Manual');
});

test('legacy Item Note description is moved to Notes during migration without losing the note text', () => {
  const legacy = drawing();
  const oldNote = {
    ...createEngineeringRow('Item Note', 'NOTE-P2-1', 'PDF 1 · Page 2'),
    description: 'PDF text note — review against source: Keep the bypass valve accessible.',
  } as Record<string, unknown>;
  delete oldNote.notes;
  storage.set('pid-mapping-studio:engineering-workspace:v2:pid', JSON.stringify([{
    ...legacy, rows: [oldNote],
  }]));

  const migrated = getEngineeringDrawings('pid')[0].rows[0];
  assert.equal(migrated.notes, 'Keep the bypass valve accessible.');
  assert.equal(migrated.description, 'Drawing note extracted from PDF; check the source page.');
  const stored = JSON.parse(storage.get('pid-mapping-studio:engineering-workspace:v2:pid') as string);
  assert.equal(stored[0].rows[0].notes, migrated.notes);
});

test('legacy UUID row IDs migrate in place to stable 32-character IDs without losing saved fields', () => {
  const legacy = drawing();
  const legacyRow = { ...legacy.rows[0], id: 'a1b2c3d4-e5f6-4789-a123-b4567890cdef', itemTag: 'P-101' };
  const storageKey = 'pid-mapping-studio:engineering-workspace:v2:pid';
  storage.set(storageKey, JSON.stringify([{ ...legacy, rows: [legacyRow] }]));

  const migrated = getEngineeringDrawings('pid')[0].rows[0];
  assert.equal(migrated.id, 'A1B2C3D4E5F64789A123B4567890CDEF');
  assert.equal(migrated.itemTag, 'P-101');
  assert.equal(migrated.reviewStatus, 'Manual');
  assert.equal(JSON.parse(storage.get(storageKey) as string)[0].rows[0].id, migrated.id);
});

test('a failed Stable ID migration leaves the original saved data untouched', () => {
  const legacy = drawing();
  const original = JSON.stringify([{ ...legacy, rows: [{ ...legacy.rows[0], id: 'legacy-row-key' }] }]);
  const storageKey = 'pid-mapping-studio:engineering-workspace:v2:pid';
  storage.set(storageKey, original);
  failNextStorageWrite = true;

  assert.throws(() => getEngineeringDrawings('pid'), /original saved data was not overwritten/);
  assert.equal(storage.get(storageKey), original);
});

test('PDF extraction creates review-required EDE rows with source page and does not duplicate them', () => {
  const source = { id: 'pdf-local-id', alias: 'PDF 2' };
  const candidates = [{
    tag: 'P-418-6113-A21PB', type: 'Pipe Run' as const, tagPrefix: 'P',
    tagSequence: '418', tagSuffix: '6113-A21PB', lineSpec: 'A21PB',
    nominalDiameter: '2 IN', pageNumber: 4,
  }];
  const result = savePdfExtraction('pid', source, candidates);
  const rows = getEngineeringDrawings('pid')[0].rows;

  assert.equal(result.recordCount, 1);
  assert.equal(rows[0].reviewStatus, 'Needs review');
  assert.equal(rows[0].sourcePage, '4');
  assert.equal(rows[0].sourcePdfId, source.id);
  assert.equal(rows[0].lineSpec, 'A21PB');
  assert.equal(rows[0].nominalDiameter, '2 IN');
  assert.deepEqual(savePdfExtraction('pid', source, candidates), result);
  assert.equal(getEngineeringDrawings('pid').length, 1);
});

test('PDF note extraction saves page-linked Item Note rows for review without duplicating them', () => {
  const source = { id: 'pdf-notes-id', alias: 'PDF 3' };
  const note = {
    tag: 'NOTE-P2-1', type: 'Item Note' as const, tagPrefix: 'NOTE',
    tagSequence: '1', tagSuffix: 'P2', pageNumber: 2,
    description: 'PDF text note — review against source: Verify the equipment connection before issuing this drawing.',
  };

  const result = savePdfExtraction('pid', source, [note]);
  const row = getEngineeringDrawings('pid')[0].rows[0];

  assert.equal(result.recordCount, 1);
  assert.equal(row.type, 'Item Note');
  assert.equal(row.sourcePage, '2');
  assert.equal(row.sourcePdfId, source.id);
  assert.equal(row.reviewStatus, 'Needs review');
  assert.match(row.notes, /Verify the equipment connection/);
  assert.match(row.description, /check the source page/);
  assert.deepEqual(savePdfExtraction('pid', source, [note]), result);
});

test('Line Spec is an accepted EDE category and is retained in CSV exports', () => {
  const row = createEngineeringRow('Line Spec', 'A21PB', 'PID-001');
  row.lineSpec = 'A21PB';
  const imported = parseEngineeringCsv(engineeringCsv([row]), 'PID-001');

  assert.equal(imported[0].type, 'Line Spec');
  assert.equal(imported[0].lineSpec, 'A21PB');
  assert.equal(imported[0].id, row.id);
});
