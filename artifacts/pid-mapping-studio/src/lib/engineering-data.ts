import type { Discipline } from '@/lib/hierarchy-store';

export type PdfSourceLocation = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EngineeringRow = {
  id: string;
  type:
    | 'Equipment' | 'Equipment Component' | 'Equipment Heat Transfer' | 'Equipment Mechanical'
    | 'Equipment Other' | 'Equipment Vessel' | 'Hydraulic Circuit' | 'Instrument'
    | 'Instrument Loop' | 'Item Note' | 'Line Spec' | 'Nozzle' | 'OPC' | 'Package'
    | 'Pipe Run' | 'Valve';
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
  lineSpec: string;
  flow: string;
  heatTracing: string;
  insulation: string;
  opcDrawing: string;
  connection: string;
  description: string;
  sourcePage: string;
  reviewStatus: 'Manual' | 'Needs review' | 'Reviewed';
  sourcePdfId?: string;
  sourceLocations?: PdfSourceLocation[];
  x: number;
  y: number;
};
export type EngineeringDrawing = {
  id: string;
  name: string;
  revision: string;
  rows: EngineeringRow[];
  sourcePdfId?: string;
  sourceAlias?: string;
};

const rowFields = ['itemTag','tagPrefix','tagSequence','tagSuffix','equipmentClass','equipmentType','equipmentName','drawingRef','nominalDiameter','pipingMaterial','lineSpec','flow','heatTracing','insulation','opcDrawing','connection','description','sourcePage','reviewStatus'] as const;
export type EngineeringField = typeof rowFields[number];
export const FIELD_LABELS: Record<EngineeringField, string> = {
  itemTag:'Item Tag',tagPrefix:'Tag Prefix',tagSequence:'Tag Sequence',tagSuffix:'Tag Suffix',
  equipmentClass:'Equipment Class',equipmentType:'Equipment Type',equipmentName:'Equipment Name',drawingRef:'Drawing Reference',
  nominalDiameter:'Nominal Diameter',pipingMaterial:'Piping Material',lineSpec:'Line Spec',flow:'Flow',heatTracing:'Heat Tracing',
  insulation:'Insulation',opcDrawing:'OPC Drawing',connection:'Connection',description:'Description',
  sourcePage:'Source page',reviewStatus:'Review status',
};
export const ENGINEERING_FIELDS = rowFields;
export const FIELD_HELP: Record<EngineeringField, string> = {
  itemTag: 'The unique tag printed beside the equipment, line, valve, or instrument.',
  tagPrefix: 'The letter code at the start of the tag.',
  tagSequence: 'The main number in the tag.',
  tagSuffix: 'Extra letters or numbers after the main tag number.',
  equipmentClass: 'The approved class or family for this equipment.',
  equipmentType: 'What the equipment is, such as a pump or vessel, when the drawing states it.',
  equipmentName: 'The equipment name or service, only when the source clearly labels it.',
  drawingRef: 'The source drawing or PDF page reference.',
  nominalDiameter: 'The stated pipe or nozzle size, such as DN50 or 2 inch.',
  pipingMaterial: 'The stated pipe material or material code.',
  lineSpec: 'The piping line class/specification code. It is separate from the pipe run tag.',
  flow: 'The stated flow value or direction. A line arrow alone is not converted to a value.',
  heatTracing: 'The stated heat-tracing requirement or type.',
  insulation: 'The stated insulation requirement or code.',
  opcDrawing: 'The linked off-page connector drawing number, if shown.',
  connection: 'A stated connection or connected item; line geometry is not inferred here.',
  description: 'A short source-based note. Blank means no clear value was found.',
  sourcePage: 'The page in the original PDF where this candidate was found.',
  reviewStatus: 'Needs review means check the tag and fields before using them.',
};
export const OBJECT_TYPES: EngineeringRow['type'][] = [
  'Equipment', 'Equipment Component', 'Equipment Heat Transfer', 'Equipment Mechanical',
  'Equipment Other', 'Equipment Vessel', 'Hydraulic Circuit', 'Instrument', 'Instrument Loop',
  'Item Note', 'Line Spec', 'Nozzle', 'OPC', 'Package', 'Pipe Run', 'Valve',
];
const storageKey = (discipline: Discipline) => `pid-mapping-studio:engineering-workspace:v2:${discipline}`;

function normalizeDrawings(value: unknown): EngineeringDrawing[] {
  if (!Array.isArray(value)) return validateDrawings(value);
  const normalized = value.map((drawing) => {
    if (!drawing || typeof drawing !== 'object' || !Array.isArray(drawing.rows)) return drawing;
    return {
      ...drawing,
      rows: drawing.rows.map((row: Record<string, unknown>) => {
        if (!row || typeof row !== 'object') return row;
        return {
          ...row,
          sourcePage: typeof row.sourcePage === 'string' ? row.sourcePage : '',
          lineSpec: typeof row.lineSpec === 'string' ? row.lineSpec : '',
          ...(row.sourceLocations === undefined ? {} : { sourceLocations: row.sourceLocations }),
          reviewStatus: row.reviewStatus === 'Needs review' || row.reviewStatus === 'Reviewed' ? row.reviewStatus : 'Manual',
        };
      }),
    };
  });
  return validateDrawings(normalized);
}

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
          !['Manual', 'Needs review', 'Reviewed'].includes(row.reviewStatus) ||
          (row.sourcePdfId !== undefined && typeof row.sourcePdfId !== 'string') ||
          (row.sourceLocations !== undefined && (
            !Array.isArray(row.sourceLocations) || row.sourceLocations.length > 500 ||
            row.sourceLocations.some((location: unknown) => {
              if (!location || typeof location !== 'object') return true;
              const item = location as Record<string, unknown>;
              return !Number.isInteger(item.pageNumber) || (item.pageNumber as number) < 1 ||
                !['x', 'y', 'width', 'height'].every((key) => typeof item[key] === 'number' && Number.isFinite(item[key])) ||
                (item.x as number) < 0 || (item.y as number) < 0 ||
                (item.width as number) <= 0 || (item.height as number) <= 0 ||
                (item.x as number) > 1 || (item.y as number) > 1 ||
                (item.x as number) + (item.width as number) > 1.02 ||
                (item.y as number) + (item.height as number) > 1.02;
            })
          )) ||
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
  return saved ? normalizeDrawings(JSON.parse(saved)) : [];
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
    id: crypto.randomUUID(), type, itemTag: itemTag.trim(), drawingRef, reviewStatus: 'Manual', x: 0, y: 0,
  } as EngineeringRow;
}

export function engineeringBackup(discipline: Discipline, drawings: EngineeringDrawing[]) {
  return JSON.stringify({ version: 3, discipline, drawings }, null, 2);
}

export function parseEngineeringBackup(text: string, discipline: Discipline): EngineeringDrawing[] {
  const parsed = JSON.parse(text);
  if (![2, 3].includes(parsed?.version) || parsed?.discipline !== discipline) {
    throw new Error(`Choose a ${discipline.toUpperCase()} workspace backup. PFD and P&ID backups stay separate.`);
  }
  return normalizeDrawings(parsed.drawings);
}

export type PdfTagCandidate = {
  tag: string;
  type: EngineeringRow['type'];
  tagPrefix: string;
  tagSequence: string;
  tagSuffix: string;
  pageNumber: number;
  nominalDiameter?: string;
  pipingMaterial?: string;
  lineSpec?: string;
  flow?: string;
  heatTracing?: string;
  insulation?: string;
  equipmentType?: string;
  equipmentName?: string;
  equipmentClass?: string;
  opcDrawing?: string;
  connection?: string;
  sourceLocations?: PdfSourceLocation[];
};

function mergePdfSourceLocations(
  current: PdfSourceLocation[] | undefined,
  additions: PdfSourceLocation[] | undefined,
): PdfSourceLocation[] {
  const locations = new Map<string, PdfSourceLocation>();
  for (const location of [...(current ?? []), ...(additions ?? [])]) {
    const key = [
      location.pageNumber,
      location.x.toFixed(4),
      location.y.toFixed(4),
      location.width.toFixed(4),
      location.height.toFixed(4),
    ].join(':');
    if (!locations.has(key) && locations.size < 500) locations.set(key, location);
  }
  return [...locations.values()];
}

function createPdfRow(candidate: PdfTagCandidate, source: { id: string; alias: string }): EngineeringRow {
  const row = createEngineeringRow(
    candidate.type,
    candidate.tag,
    `${source.alias} · Page ${candidate.pageNumber}`,
  );
  row.tagPrefix = candidate.tagPrefix ?? '';
  row.tagSequence = candidate.tagSequence ?? '';
  row.tagSuffix = candidate.tagSuffix ?? '';
  for (const field of [
    'nominalDiameter', 'pipingMaterial', 'lineSpec', 'flow', 'heatTracing', 'insulation',
    'equipmentType', 'equipmentName', 'equipmentClass', 'opcDrawing', 'connection',
  ] as const) {
    row[field] = candidate[field] ?? '';
  }
  row.sourcePage = String(candidate.pageNumber);
  row.sourcePdfId = source.id;
  row.sourceLocations = candidate.sourceLocations?.slice(0, 500);
  row.reviewStatus = 'Needs review';
  row.description = 'Tag candidate found in the PDF. Confirm the object type and details before using it.';
  return row;
}

/** Adds PDF-derived candidates to the device-local EDE. Existing source records are never overwritten. */
export function savePdfExtraction(
  discipline: Discipline,
  source: { id: string; alias: string },
  candidates: PdfTagCandidate[],
): { drawingId: string; recordCount: number } {
  const drawings = getEngineeringDrawings(discipline);
  const existing = drawings.find((drawing) => drawing.sourcePdfId === source.id);
  if (existing) {
    const candidatesByTag = new Map(candidates.map((candidate) => [candidate.tag.trim().toLowerCase(), candidate]));
    const existingTags = new Set(existing.rows.map((row) => row.itemTag.trim().toLowerCase()));
    let changed = false;
    const rows = existing.rows.map((row) => {
      const candidate = candidatesByTag.get(row.itemTag.trim().toLowerCase());
      if (!candidate) return row;
      const sourceLocations = mergePdfSourceLocations(row.sourceLocations, candidate.sourceLocations);
      const sourcePage = row.sourcePage || String(candidate.pageNumber);
      if (sourceLocations.length === (row.sourceLocations?.length ?? 0) && sourcePage === row.sourcePage) return row;
      changed = true;
      return { ...row, sourcePage, sourceLocations };
    });
    const addedRows = candidates.flatMap((candidate) => {
      const tag = candidate.tag.trim().toLowerCase();
      if (!tag || existingTags.has(tag)) return [];
      existingTags.add(tag);
      changed = true;
      return [createPdfRow(candidate, source)];
    });
    if (changed) {
      const next = drawings.map((drawing) => drawing.id === existing.id
        ? { ...drawing, rows: [...rows, ...addedRows] }
        : drawing);
      saveEngineeringDrawings(discipline, next, getEngineeringSavedText(discipline));
    }
    return { drawingId: existing.id, recordCount: rows.length + addedRows.length };
  }

  const names = new Set(drawings.map((drawing) => drawing.name.toLowerCase()));
  const baseName = `${source.alias} · Extracted data`;
  let name = baseName;
  let suffix = 2;
  while (names.has(name.toLowerCase())) name = `${baseName} (${suffix++})`;

  const seen = new Set<string>();
  const rows = candidates.flatMap((candidate) => {
    const key = candidate.tag.trim().toLowerCase();
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [createPdfRow(candidate, source)];
  });
  const drawing: EngineeringDrawing = {
    id: crypto.randomUUID(),
    name,
    revision: 'Local PDF extraction · review required',
    sourcePdfId: source.id,
    sourceAlias: source.alias,
    rows,
  };
  const expected = getEngineeringSavedText(discipline);
  saveEngineeringDrawings(discipline, [...drawings, drawing], expected);
  return { drawingId: drawing.id, recordCount: rows.length };
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
      if (fieldIndexes[n] < 0) return;
      const value = cells[fieldIndexes[n]].trim();
      if (field === 'reviewStatus') {
        row.reviewStatus = ['Needs review', 'Reviewed', 'Manual'].includes(value) ? value as EngineeringRow['reviewStatus'] : 'Manual';
      } else {
        row[field] = value;
      }
    });
    if (!row.drawingRef) row.drawingRef = drawingRef;
    return row;
  });
}
