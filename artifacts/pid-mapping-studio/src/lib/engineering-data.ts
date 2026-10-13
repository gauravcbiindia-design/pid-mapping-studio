import type { Discipline } from '@/lib/hierarchy-store';

export type PdfSourceLocation = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EngineeringRow = {
  /** Permanent StableID for this engineering object; never a tag, coordinate or CAD handle. */
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
  /** Drawing where the object is recorded as placed; blank means available/not placed. */
  placementDrawingRef: string;
  nominalDiameter: string;
  plantGroup: string;
  fluidService: string;
  pipingMaterial: string;
  lineSpec: string;
  flow: string;
  flowDirection: string;
  heatTracing: string;
  insulation: string;
  fromTag: string;
  toTag: string;
  groupStatus: string;
  opcDrawing: string;
  connection: string;
  description: string;
  notes: string;
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

const rowFields = ['itemTag','tagPrefix','tagSequence','tagSuffix','equipmentClass','equipmentType','equipmentName','drawingRef','placementDrawingRef','nominalDiameter','plantGroup','fluidService','pipingMaterial','lineSpec','flow','flowDirection','heatTracing','insulation','fromTag','toTag','groupStatus','opcDrawing','connection','description','notes','sourcePage','reviewStatus'] as const;
export type EngineeringField = typeof rowFields[number];
export type EngineeringTableField = EngineeringField | 'stableId';
export type EngineeringPlacementStatus = 'current' | 'another' | 'available';
export const ENGINEERING_TABLE_FIELDS: EngineeringTableField[] = [...rowFields, 'stableId'];
export type StableId = string;
export const STABLE_ID_PATTERN = /^[0-9A-F]{32}$/;
const LEGACY_UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PIPE_RUN_BOUNDARY_FIELDS: readonly EngineeringField[] = [
  'plantGroup', 'fluidService', 'nominalDiameter', 'pipingMaterial', 'lineSpec',
  'insulation', 'heatTracing', 'groupStatus',
];
const VALID_PIPE_RUN_GROUP_STATUSES = ['', 'Start', 'Continue', 'Branch', 'Merge', 'End-of-Group'] as const;

export function createStableId(): StableId {
  return crypto.randomUUID().replaceAll('-', '').toUpperCase();
}

/** Converts legacy UUID row IDs to their compact permanent StableID without breaking their identity. */
export function normalizeStableId(value: string): StableId {
  const upper = value.toUpperCase();
  if (STABLE_ID_PATTERN.test(upper)) return upper;
  if (LEGACY_UUID_PATTERN.test(value)) return upper.replaceAll('-', '');
  throw new Error('A Stable ID must contain exactly 32 letters or numbers (A–F, 0–9).');
}

export function getEngineeringTableValue(row: EngineeringRow, field: EngineeringTableField): string {
  return field === 'stableId' ? row.id : row[field];
}

/** Placement is explicit metadata, separate from the source PDF/drawing reference. */
export function getEngineeringPlacementStatus(
  row: Pick<EngineeringRow, 'placementDrawingRef'>,
  drawing: Pick<EngineeringDrawing, 'id' | 'name'>,
): EngineeringPlacementStatus {
  const placement = row.placementDrawingRef.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
  if (!placement) return 'available';
  const currentReferences = [drawing.id, drawing.name]
    .map((reference) => reference.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase());
  return currentReferences.includes(placement) ? 'current' : 'another';
}

export const FIELD_LABELS: Record<EngineeringTableField, string> = {
  itemTag:'Item Tag',tagPrefix:'Tag Prefix',tagSequence:'Tag Sequence',tagSuffix:'Tag Suffix',
  equipmentClass:'Equipment Class',equipmentType:'Equipment Type',equipmentName:'Equipment Name',drawingRef:'Source Drawing / Page',
  placementDrawingRef:'Placed on Drawing',
  nominalDiameter:'Nominal Diameter',plantGroup:'Plant Group',fluidService:'Fluid / Service',
  pipingMaterial:'Piping Material Class',lineSpec:'Line Spec',flow:'Flow',flowDirection:'Flow Direction',
  heatTracing:'Heat Tracing',insulation:'Insulation',fromTag:'From',toTag:'To',groupStatus:'Group Status',
  opcDrawing:'OPC Drawing',connection:'Connection',description:'Description',notes:'Notes',
  sourcePage:'Source page',reviewStatus:'Review status',stableId:'Stable ID',
};
export const ENGINEERING_FIELDS = rowFields;
export const FIELD_HELP: Record<EngineeringTableField, string> = {
  itemTag: 'The tag printed beside the equipment, line, valve, or instrument. A repeated Pipe Run tag needs different line data.',
  tagPrefix: 'The letter code at the start of the tag.',
  tagSequence: 'The main number in the tag.',
  tagSuffix: 'Extra letters or numbers after the main tag number.',
  equipmentClass: 'The approved class or family for this equipment.',
  equipmentType: 'What the equipment is, such as a pump or vessel, when the drawing states it.',
  equipmentName: 'The equipment name or service, only when the source clearly labels it.',
  drawingRef: 'The source drawing or PDF page where this record came from.',
  placementDrawingRef: 'The CAD drawing that contains this object. Blank means available or not placed. This is a reference only; it does not place or move CAD entities.',
  nominalDiameter: 'The stated pipe or nozzle size, such as DN50 or 2 inch.',
  plantGroup: 'The plant, unit, or area group, if stated.',
  fluidService: 'The stated fluid or process service for this line.',
  pipingMaterial: 'The approved piping material class or code.',
  lineSpec: 'The piping line class/specification code. It is separate from the pipe run tag.',
  flow: 'The stated flow value or direction. A line arrow alone is not converted to a value.',
  flowDirection: 'The confirmed upstream/downstream flow direction.',
  heatTracing: 'The stated heat-tracing requirement or type.',
  insulation: 'The stated insulation requirement or code.',
  fromTag: 'The connected source tag or point shown for this pipe run.',
  toTag: 'The connected destination tag or point shown for this pipe run.',
  groupStatus: 'Start, Continue, Branch, Merge, or End-of-Group for the pipe run.',
  opcDrawing: 'The linked off-page connector drawing number, if shown.',
  connection: 'A stated connection or connected item; line geometry is not inferred here.',
  description: 'A short object description from the source. Blank means no clear value was found.',
  notes: 'Drawing notes or additional comments associated with this record.',
  sourcePage: 'The page in the original PDF where this candidate was found.',
  reviewStatus: 'Needs review means check the tag and fields before using them.',
  stableId: 'Permanent object identity. It stays the same when the tag, drawing, size, or geometry changes.',
};
export const OBJECT_TYPES: EngineeringRow['type'][] = [
  'Equipment', 'Equipment Component', 'Equipment Heat Transfer', 'Equipment Mechanical',
  'Equipment Other', 'Equipment Vessel', 'Hydraulic Circuit', 'Instrument', 'Instrument Loop',
  'Item Note', 'Line Spec', 'Nozzle', 'OPC', 'Package', 'Pipe Run', 'Valve',
];
const storageKey = (discipline: Discipline) => `pid-mapping-studio:engineering-workspace:v2:${discipline}`;

function normalizeDrawings(value: unknown, onMigration?: () => void): EngineeringDrawing[] {
  if (!Array.isArray(value)) return validateDrawings(value);
  const normalized = value.map((drawing) => {
    if (!drawing || typeof drawing !== 'object' || !Array.isArray(drawing.rows)) return drawing;
    return {
      ...drawing,
      rows: drawing.rows.map((row: Record<string, unknown>) => {
        if (!row || typeof row !== 'object') return row;
        const legacyId = typeof row.id === 'string' ? row.id : '';
        let stableId: string;
        try {
          stableId = normalizeStableId(legacyId);
        } catch {
          stableId = createStableId();
        }
        if (stableId !== row.id) onMigration?.();
        const description = typeof row.description === 'string' ? row.description : '';
        const hasNotes = typeof row.notes === 'string';
        const notePrefix = /^(?:PDF text|OCR text) note — review against source:\s*/iu;
        const notes = hasNotes
          ? row.notes as string
          : row.type === 'Item Note'
            ? description.replace(notePrefix, '')
            : '';
        const normalizedDescription = !hasNotes && row.type === 'Item Note' && description
          ? (notePrefix.test(description) ? 'Drawing note extracted from PDF; check the source page.' : '')
          : description;
        if (!hasNotes || normalizedDescription !== description) onMigration?.();
        return {
          ...row,
          id: stableId,
          description: normalizedDescription,
          notes,
          sourcePage: typeof row.sourcePage === 'string' ? row.sourcePage : '',
          placementDrawingRef: typeof row.placementDrawingRef === 'string' ? row.placementDrawingRef : '',
          lineSpec: typeof row.lineSpec === 'string' ? row.lineSpec : '',
          plantGroup: typeof row.plantGroup === 'string' ? row.plantGroup : '',
          fluidService: typeof row.fluidService === 'string' ? row.fluidService : '',
          flowDirection: typeof row.flowDirection === 'string' ? row.flowDirection : '',
          fromTag: typeof row.fromTag === 'string' ? row.fromTag : '',
          toTag: typeof row.toTag === 'string' ? row.toTag : '',
          groupStatus: typeof row.groupStatus === 'string' ? row.groupStatus : '',
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
  const rowIds = new Set<string>();
  let total = 0;
  for (const drawing of value) {
    if (!drawing || typeof drawing !== 'object' || typeof drawing.id !== 'string' ||
        typeof drawing.name !== 'string' || !drawing.name.trim() || drawing.name.length > 160 ||
        typeof drawing.revision !== 'string' || drawing.revision.length > 80 || !Array.isArray(drawing.rows) || ids.has(drawing.id)) {
      throw new Error('The drawing catalog contains an invalid or duplicate drawing.');
    }
    ids.add(drawing.id);
    const tags = new Map<string, EngineeringRow[]>();
    for (const row of drawing.rows) {
      if (row?.type === 'Pipe Run' && !VALID_PIPE_RUN_GROUP_STATUSES.includes(row.groupStatus as typeof VALID_PIPE_RUN_GROUP_STATUSES[number])) {
        throw new Error('Pipe Run group status must be Start, Continue, Branch, Merge, or End-of-Group.');
      }
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !STABLE_ID_PATTERN.test(row.id) || rowIds.has(row.id) ||
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
          !row.itemTag.trim()) {
        throw new Error('Each record needs a valid Stable ID, object type, and text fields.');
      }
      const key = row.itemTag.trim().toLowerCase();
      const sameTag = tags.get(key) ?? [];
      if (sameTag.length && (
        row.type !== 'Pipe Run' ||
        sameTag.some((prior) => prior.type !== 'Pipe Run' ||
          !PIPE_RUN_BOUNDARY_FIELDS.some((field) => prior[field] !== row[field]))
      )) {
        throw new Error('This tag is already used. Repeated Pipe Run tags need different line-defining data.');
      }
      if (typeof row.x !== 'number' || typeof row.y !== 'number' || !Number.isFinite(row.x) || !Number.isFinite(row.y)) {
        throw new Error('A record contains invalid coordinates.');
      }
      tags.set(key, [...sameTag, row]);
      rowIds.add(row.id);
      total += 1;
    }
  }
  if (total > 20000) throw new Error('This local workspace supports up to 20,000 engineering records.');
  return value as EngineeringDrawing[];
}

export function getEngineeringDrawings(discipline: Discipline): EngineeringDrawing[] {
  const saved = window.localStorage.getItem(storageKey(discipline));
  if (!saved) return [];
  let needsMigration = false;
  const drawings = normalizeDrawings(JSON.parse(saved), () => { needsMigration = true; });
  if (needsMigration) {
    try {
      window.localStorage.setItem(storageKey(discipline), JSON.stringify(drawings));
    } catch {
      throw new Error('Saved records were read, but the data-format update could not be saved because browser storage is full. The original saved data was not overwritten; download a backup before freeing space.');
    }
  }
  return drawings;
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
    id: createStableId(), type, itemTag: itemTag.trim(), drawingRef, reviewStatus: 'Manual', x: 0, y: 0,
  } as EngineeringRow;
}

export function engineeringBackup(discipline: Discipline, drawings: EngineeringDrawing[]) {
  return JSON.stringify({ version: 5, discipline, drawings }, null, 2);
}

export function parseEngineeringBackup(text: string, discipline: Discipline): EngineeringDrawing[] {
  const parsed = JSON.parse(text);
  if (![2, 3, 4, 5].includes(parsed?.version) || parsed?.discipline !== discipline) {
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
  description?: string;
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
  if (candidate.type === 'Item Note') {
    row.notes = (candidate.description ?? '')
      .replace(/^(?:PDF text|OCR text) note — review against source:\s*/iu, '');
    row.description = 'Drawing note extracted from PDF; check the source page.';
  } else {
    row.description = candidate.description
      ?? 'Tag candidate found in the PDF. Confirm the object type and details before using it.';
  }
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
  return serializeEngineeringCsv(['Object type', ...ENGINEERING_TABLE_FIELDS.map((field) => FIELD_LABELS[field])],
    rows.map((row) => [row.type, ...ENGINEERING_TABLE_FIELDS.map((field) => getEngineeringTableValue(row, field))]));
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
  const stableIdIndex = header.findIndex((value) => value === 'stableid' || value === FIELD_LABELS.stableId.toLowerCase());
  if (typeIndex < 0 || fieldIndexes[0] < 0) throw new Error('CSV needs Object type and Item Tag columns. Download the template first.');
  if (!table.length) throw new Error('The CSV contains no records.');
  if (table.length > 20000) throw new Error('Import at most 20,000 records.');
  const rowIds = new Set<string>();
  return table.map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
    const type = OBJECT_TYPES.find((value) => value.toLowerCase() === cells[typeIndex]?.trim().toLowerCase());
    if (!type) throw new Error(`CSV row ${index + 2} has an unsupported object type.`);
    const row = createEngineeringRow(type, cells[fieldIndexes[0]] ?? '', drawingRef);
    if (stableIdIndex >= 0 && cells[stableIdIndex]?.trim()) {
      try {
        row.id = normalizeStableId(cells[stableIdIndex].trim());
      } catch {
        throw new Error(`CSV row ${index + 2} has an invalid Stable ID.`);
      }
    }
    if (rowIds.has(row.id)) throw new Error(`CSV row ${index + 2} repeats a Stable ID.`);
    rowIds.add(row.id);
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
