import type { Discipline } from '@/lib/hierarchy-store';

export type EngineeringRow = {
  id: string;
  type: 'Equipment' | 'Pipe Run' | 'OPC' | 'Instrument' | 'Valve';
  itemTag: string;
  tagPrefix: string;
  tagSequence: string;
  tagSuffix: string;
  equipmentClass: string;
  equipmentType: string;
  equipmentName: string;
  drawingRef: string;
  nominalDiameter: string;
  pipingMaterial: string;
  flow: string;
  heatTracing: string;
  insulation: string;
  opcDrawing: string;
  connection: string;
  description: string;
  x: number;
  y: number;
};
export type EngineeringDrawing = { id: string; name: string; revision: string; rows: EngineeringRow[] };

const rowFields = ['itemTag','tagPrefix','tagSequence','tagSuffix','equipmentClass','equipmentType','equipmentName','drawingRef','nominalDiameter','pipingMaterial','flow','heatTracing','insulation','opcDrawing','connection','description'] as const;
export type EngineeringField = typeof rowFields[number];
export const FIELD_LABELS: Record<EngineeringField, string> = {
  itemTag:'Item Tag',tagPrefix:'Tag Prefix',tagSequence:'Tag Sequence',tagSuffix:'Tag Suffix',
  equipmentClass:'Equipment Class',equipmentType:'Equipment Type',equipmentName:'Equipment Name',drawingRef:'Drawing Reference',
  nominalDiameter:'Nominal Diameter',pipingMaterial:'Piping Material',flow:'Flow',heatTracing:'Heat Tracing',
  insulation:'Insulation',opcDrawing:'OPC Drawing',connection:'Connection',description:'Description',
};
export const ENGINEERING_FIELDS = rowFields;
export const OBJECT_TYPES: EngineeringRow['type'][] = ['Equipment','Pipe Run','OPC','Instrument','Valve'];
const storageKey = (discipline: Discipline) => `pid-mapping-studio:engineering-workspace:v2:${discipline}`;

function validateDrawings(value: unknown): EngineeringDrawing[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid drawing catalog. Keep a backup and do not overwrite saved data.');
  const ids = new Set<string>();
  let total = 0;
  for (const drawing of value) {
    if (!drawing || typeof drawing !== 'object' || typeof drawing.id !== 'string' ||
        typeof drawing.name !== 'string' || !drawing.name.trim() || drawing.name.length > 160 ||
        typeof drawing.revision !== 'string' || drawing.revision.length > 80 || !Array.isArray(drawing.rows) || ids.has(drawing.id)) {
      throw new Error('The drawing catalog contains an invalid or duplicate drawing.');
    }
    ids.add(drawing.id);
    const tags = new Set<string>();
    const rowIds = new Set<string>();
    for (const row of drawing.rows) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || rowIds.has(row.id) ||
          !OBJECT_TYPES.includes(row.type) || ENGINEERING_FIELDS.some((field) => typeof row[field] !== 'string' || row[field].length > 2000) ||
          !row.itemTag.trim() || tags.has(row.itemTag.trim().toLowerCase())) {
        throw new Error('Each record needs a unique item tag, a valid object type, and text fields.');
      }
      if (typeof row.x !== 'number' || typeof row.y !== 'number' || !Number.isFinite(row.x) || !Number.isFinite(row.y)) {
        throw new Error('A record contains invalid coordinates.');
      }
      tags.add(row.itemTag.trim().toLowerCase());
      rowIds.add(row.id);
      total += 1;
    }
  }
  if (total > 20000) throw new Error('This local workspace supports up to 20,000 engineering records.');
  return value as EngineeringDrawing[];
}

export function getEngineeringDrawings(discipline: Discipline): EngineeringDrawing[] {
  const saved = window.localStorage.getItem(storageKey(discipline));
  return saved ? validateDrawings(JSON.parse(saved)) : [];
}

export function getEngineeringSavedText(discipline: Discipline) {
  return window.localStorage.getItem(storageKey(discipline));
}

export function saveEngineeringDrawings(discipline: Discipline, drawings: EngineeringDrawing[], expected: string | null) {
  validateDrawings(drawings);
  if (getEngineeringSavedText(discipline) !== expected) {
    throw new Error('This workspace changed in another tab. Reload before editing to avoid overwriting its records.');
  }
  const text = JSON.stringify(drawings);
  window.localStorage.setItem(storageKey(discipline), text);
  return text;
}

export function createEngineeringRow(type: EngineeringRow['type'], itemTag: string, drawingRef: string): EngineeringRow {
  return {
    ...Object.fromEntries(ENGINEERING_FIELDS.map((field) => [field, ''])),
    id: crypto.randomUUID(), type, itemTag: itemTag.trim(), drawingRef, x: 0, y: 0,
  } as EngineeringRow;
}

export function engineeringBackup(discipline: Discipline, drawings: EngineeringDrawing[]) {
  return JSON.stringify({ version: 2, discipline, drawings }, null, 2);
}

export function parseEngineeringBackup(text: string, discipline: Discipline): EngineeringDrawing[] {
  const parsed = JSON.parse(text);
  if (parsed?.version !== 2 || parsed?.discipline !== discipline) {
    throw new Error(`Choose a ${discipline.toUpperCase()} workspace backup. PFD and P&ID backups stay separate.`);
  }
  return validateDrawings(parsed.drawings);
}

export function downloadEngineeringFile(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function engineeringCsv(rows: EngineeringRow[]): string {
  return serializeEngineeringCsv(['Object type', ...ENGINEERING_FIELDS.map((field) => FIELD_LABELS[field])],
    rows.map((row) => [row.type, ...ENGINEERING_FIELDS.map((field) => row[field])]));
}

export function serializeEngineeringCsv(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const safeCell = (text: string) => {
    // Spreadsheet apps interpret these prefixes as formulas, even in quoted CSV.
    const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [headers, ...rows].map((row) => row.map((value) => safeCell(String(value))).join(',')).join('\r\n');
}

export function parseEngineeringCsv(text: string, drawingRef: string): EngineeringRow[] {
  const table: string[][] = [];
  let record: string[] = [], cell = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (!quoted && cell !== '') throw new Error('Invalid CSV quoting.');
      else quoted = !quoted;
    } else if (!quoted && ch === ',') { record.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      record.push(cell); if (record.some((v) => v.trim())) table.push(record);
      record = []; cell = ''; if (ch === '\r' && source[i + 1] === '\n') i++;
    } else cell += ch;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted cell.');
  record.push(cell); if (record.some((v) => v.trim())) table.push(record);
  const header = table.shift()?.map((v) => v.trim().toLowerCase()) ?? [];
  const typeIndex = header.findIndex((v) => v === 'object type' || v === 'type');
  const fieldIndexes = ENGINEERING_FIELDS.map((field) => header.findIndex((v) => v === field.toLowerCase() || v === FIELD_LABELS[field].toLowerCase()));
  if (typeIndex < 0 || fieldIndexes[0] < 0) throw new Error('CSV needs Object type and Item Tag columns. Download the template first.');
  if (!table.length) throw new Error('The CSV contains no records.');
  if (table.length > 20000) throw new Error('Import at most 20,000 records.');
  return table.map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
    const type = OBJECT_TYPES.find((value) => value.toLowerCase() === cells[typeIndex]?.trim().toLowerCase());
    if (!type) throw new Error(`CSV row ${index + 2} has an unsupported object type.`);
    const row = createEngineeringRow(type, cells[fieldIndexes[0]] ?? '', drawingRef);
    ENGINEERING_FIELDS.forEach((field, n) => {
      if (fieldIndexes[n] >= 0) row[field] = cells[fieldIndexes[n]].trim();
    });
    if (!row.drawingRef) row.drawingRef = drawingRef;
    return row;
  });
}
