import { buildAutoCadPackage } from '@/lib/local-package';

export type EntityKind =
  | 'equipment'
  | 'line'
  | 'valve'
  | 'instrument'
  | 'label';

export type ReviewStatus = 'draft' | 'reviewed' | 'unresolved';

export interface Point {
  x: number;
  y: number;
}

export interface LayerDefinition {
  id: string;
  name: string;
  color: string;
  aciColor: number;
  linetype: string;
  lineweight: number;
  verified: boolean;
  verificationNote: string;
}

export interface MappedEntity {
  id: string;
  kind: EntityKind;
  tag: string;
  label: string;
  layerId: string;
  blockName: string | null;
  geometry: {
    kind: 'pump' | 'valve' | 'instrument' | 'polyline' | 'text';
    x: number;
    y: number;
    width: number;
    height: number;
    points: Point[];
  };
  scale: number;
  rotation: number;
  source: {
    page: number;
    region: string;
    rawText: string;
    confidence: 'high' | 'medium' | 'low' | 'not-applicable';
  };
  reviewStatus: ReviewStatus;
}

export interface EngineeringRecord {
  id: string;
  kind: Exclude<EntityKind, 'label'>;
  tag: string;
  description: string;
  properties: Record<string, string>;
  graphicalEntityIds: string[];
  relatedRecordIds: string[];
  sourceText: string;
  sourcePage: number;
  sourceRegion: string;
  reviewStatus: ReviewStatus;
}

export interface EngineeringRelationship {
  id: string;
  kind: 'connects' | 'measures' | 'labels';
  fromRecordId: string;
  toRecordId: string;
  reviewed: boolean;
}

export interface UnresolvedItem {
  id: string;
  title: string;
  detail: string;
  severity: 'warning' | 'blocked';
}

export interface DrawingMapping {
  schemaVersion: '1.0.0';
  drawing: {
    id: string;
    name: string;
    revision: string;
    units: string;
    sourceKind: 'synthetic-demo';
    mappingStatus: ReviewStatus;
    coordinateTransform: {
      scale: number;
      origin: Point;
      yAxis: 'up' | 'down';
    };
  };
  layers: LayerDefinition[];
  entities: MappedEntity[];
  records: EngineeringRecord[];
  relationships: EngineeringRelationship[];
  unresolvedItems: UnresolvedItem[];
}

const STORAGE_KEY = 'pid-mapping-studio:drawing-mapping:v1';

const SYNTHETIC_SOURCE = {
  page: 1,
  rawText: 'Synthetic demonstration only; not interpreted from a reference PDF.',
  confidence: 'not-applicable' as const,
};

/**
 * This is a fictional schematic, not a company drawing or a plant design.
 * The separate standards library contains title-block data from supplied
 * DWGs; these demo process layers and symbol blocks remain unverified.
 */
export function createDemoMapping(): DrawingMapping {
  return {
    schemaVersion: '1.0.0',
    drawing: {
      id: 'drawing-synthetic-transfer-001',
      name: 'Transfer loop · synthetic sample',
      revision: 'DEMO-01',
      units: 'mm',
      sourceKind: 'synthetic-demo',
      mappingStatus: 'draft',
      coordinateTransform: {
        scale: 1,
        origin: { x: 0, y: 0 },
        yAxis: 'up',
      },
    },
    layers: [
      {
        id: 'layer-process',
        name: 'DEMO-PROCESS',
        color: '#66b8c9',
        aciColor: 4,
        linetype: 'CONTINUOUS',
        lineweight: 25,
        verified: false,
        verificationNote: 'Demonstration layer only; company standards were not supplied.',
      },
      {
        id: 'layer-equipment',
        name: 'DEMO-EQUIPMENT',
        color: '#73c8a6',
        aciColor: 3,
        linetype: 'CONTINUOUS',
        lineweight: 25,
        verified: false,
        verificationNote: 'Demonstration layer only; company standards were not supplied.',
      },
      {
        id: 'layer-valve',
        name: 'DEMO-VALVES',
        color: '#e6ac62',
        aciColor: 2,
        linetype: 'CONTINUOUS',
        lineweight: 25,
        verified: false,
        verificationNote: 'Demonstration layer only; company standards were not supplied.',
      },
      {
        id: 'layer-instrument',
        name: 'DEMO-INSTRUMENTS',
        color: '#d393bb',
        aciColor: 6,
        linetype: 'CONTINUOUS',
        lineweight: 18,
        verified: false,
        verificationNote: 'Demonstration layer only; company standards were not supplied.',
      },
      {
        id: 'layer-text',
        name: 'DEMO-TEXT',
        color: '#536b62',
        aciColor: 7,
        linetype: 'CONTINUOUS',
        lineweight: 13,
        verified: false,
        verificationNote: 'Demonstration layer only; company standards were not supplied.',
      },
    ],
    entities: [
      {
        id: 'geo-process-upstream',
        kind: 'line',
        tag: 'LINE-TRANSFER-01',
        label: 'Upstream process segment',
        layerId: 'layer-process',
        blockName: null,
        geometry: {
          kind: 'polyline',
          x: 72,
          y: 320,
          width: 190,
          height: 0,
          points: [
            { x: 0, y: 0 },
            { x: 190, y: 0 },
          ],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R01',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-pump-p101',
        kind: 'equipment',
        tag: 'P-101',
        label: 'Process transfer pump',
        layerId: 'layer-equipment',
        blockName: 'DEMO_PUMP',
        geometry: {
          kind: 'pump',
          x: 330,
          y: 320,
          width: 96,
          height: 78,
          points: [],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R02',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-process-midstream',
        kind: 'line',
        tag: 'LINE-TRANSFER-01',
        label: 'Transfer line, segment 2',
        layerId: 'layer-process',
        blockName: null,
        geometry: {
          kind: 'polyline',
          x: 378,
          y: 320,
          width: 178,
          height: 0,
          points: [
            { x: 0, y: 0 },
            { x: 178, y: 0 },
          ],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R03',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-valve-hv101',
        kind: 'valve',
        tag: 'HV-101',
        label: 'Manual isolation valve',
        layerId: 'layer-valve',
        blockName: 'DEMO_VALVE',
        geometry: {
          kind: 'valve',
          x: 600,
          y: 320,
          width: 76,
          height: 64,
          points: [],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R04',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-process-downstream',
        kind: 'line',
        tag: 'LINE-TRANSFER-01',
        label: 'Downstream process segment',
        layerId: 'layer-process',
        blockName: null,
        geometry: {
          kind: 'polyline',
          x: 642,
          y: 320,
          width: 288,
          height: 0,
          points: [
            { x: 0, y: 0 },
            { x: 288, y: 0 },
          ],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R05',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-process-instrument-branch',
        kind: 'line',
        tag: 'LINE-TRANSFER-01',
        label: 'Instrument connection',
        layerId: 'layer-process',
        blockName: null,
        geometry: {
          kind: 'polyline',
          x: 790,
          y: 320,
          width: 0,
          height: 154,
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 154 },
          ],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R06',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-instrument-pi101',
        kind: 'instrument',
        tag: 'PI-101',
        label: 'Pressure indicator',
        layerId: 'layer-instrument',
        blockName: 'DEMO_PI',
        geometry: {
          kind: 'instrument',
          x: 790,
          y: 510,
          width: 58,
          height: 58,
          points: [],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R07',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-label-p101',
        kind: 'label',
        tag: 'P-101',
        label: 'P-101',
        layerId: 'layer-text',
        blockName: null,
        geometry: {
          kind: 'text',
          x: 330,
          y: 214,
          width: 110,
          height: 18,
          points: [],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R08',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-label-line',
        kind: 'label',
        tag: '6"-P-101-CS150',
        label: '6"-P-101-CS150',
        layerId: 'layer-text',
        blockName: null,
        geometry: {
          kind: 'text',
          x: 456,
          y: 370,
          width: 180,
          height: 17,
          points: [],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R09',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-label-hv101',
        kind: 'label',
        tag: 'HV-101',
        label: 'HV-101',
        layerId: 'layer-text',
        blockName: null,
        geometry: {
          kind: 'text',
          x: 600,
          y: 214,
          width: 100,
          height: 18,
          points: [],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R10',
        },
        reviewStatus: 'draft',
      },
      {
        id: 'geo-label-pi101',
        kind: 'label',
        tag: 'PI-101',
        label: 'PI-101',
        layerId: 'layer-text',
        blockName: null,
        geometry: {
          kind: 'text',
          x: 790,
          y: 429,
          width: 96,
          height: 18,
          points: [],
        },
        scale: 1,
        rotation: 0,
        source: {
          ...SYNTHETIC_SOURCE,
          region: 'DEMO-R11',
        },
        reviewStatus: 'draft',
      },
    ],
    records: [
      {
        id: 'record-p101',
        kind: 'equipment',
        tag: 'P-101',
        description: 'Synthetic process transfer pump',
        properties: {
          category: 'Centrifugal pump',
          duty: 'Process transfer · demonstration',
        },
        graphicalEntityIds: ['geo-pump-p101', 'geo-label-p101'],
        relatedRecordIds: ['record-line-transfer-01'],
        sourceText: 'Synthetic value; no reference PDF was supplied.',
        sourcePage: 1,
        sourceRegion: 'DEMO-R02',
        reviewStatus: 'draft',
      },
      {
        id: 'record-line-transfer-01',
        kind: 'line',
        tag: '6"-P-101-CS150',
        description: 'Synthetic process transfer line group; four separate drawing entities.',
        properties: {
          nominalSize: '6 in',
          specification: 'CS150 · demonstration value',
          insulation: 'Unknown',
          tracing: 'Unknown',
        },
        graphicalEntityIds: [
          'geo-process-upstream',
          'geo-process-midstream',
          'geo-process-downstream',
          'geo-process-instrument-branch',
          'geo-label-line',
        ],
        relatedRecordIds: [
          'record-p101',
          'record-hv101',
          'record-pi101',
        ],
        sourceText: 'Synthetic value; connectivity is an explicit demonstration relationship.',
        sourcePage: 1,
        sourceRegion: 'DEMO-R01, DEMO-R03, DEMO-R05, DEMO-R06, DEMO-R09',
        reviewStatus: 'draft',
      },
      {
        id: 'record-hv101',
        kind: 'valve',
        tag: 'HV-101',
        description: 'Synthetic manual isolation valve',
        properties: {
          valveType: 'Manual isolation · demonstration value',
          size: '6 in',
        },
        graphicalEntityIds: ['geo-valve-hv101', 'geo-label-hv101'],
        relatedRecordIds: ['record-line-transfer-01'],
        sourceText: 'Synthetic value; not assigned to a company block.',
        sourcePage: 1,
        sourceRegion: 'DEMO-R04',
        reviewStatus: 'draft',
      },
      {
        id: 'record-pi101',
        kind: 'instrument',
        tag: 'PI-101',
        description: 'Synthetic pressure indicator',
        properties: {
          instrumentType: 'Pressure indicator · demonstration value',
          instrumentNumber: '101',
          fullTag: 'PI-101',
        },
        graphicalEntityIds: ['geo-instrument-pi101', 'geo-label-pi101'],
        relatedRecordIds: ['record-line-transfer-01'],
        sourceText: 'Synthetic value; the recorded measurement relationship is reviewed explicitly.',
        sourcePage: 1,
        sourceRegion: 'DEMO-R07',
        reviewStatus: 'draft',
      },
    ],
    relationships: [
      {
        id: 'relationship-pump-line',
        kind: 'connects',
        fromRecordId: 'record-p101',
        toRecordId: 'record-line-transfer-01',
        reviewed: true,
      },
      {
        id: 'relationship-line-valve',
        kind: 'connects',
        fromRecordId: 'record-line-transfer-01',
        toRecordId: 'record-hv101',
        reviewed: true,
      },
      {
        id: 'relationship-instrument-line',
        kind: 'measures',
        fromRecordId: 'record-pi101',
        toRecordId: 'record-line-transfer-01',
        reviewed: true,
      },
    ],
    unresolvedItems: [
      {
        id: 'unresolved-source',
        title: 'Reference PDF not supplied',
        detail:
          'The drawing and raw text are synthetic. No interpretation from a source page has been verified.',
        severity: 'warning',
      },
      {
        id: 'unresolved-blocks',
        title: 'Company symbol blocks not supplied',
        detail:
          'DEMO_PUMP, DEMO_VALVE, and DEMO_PI are visible examples only, not approved company blocks.',
        severity: 'warning',
      },
      {
        id: 'unresolved-layers',
        title: 'Process-layer standards need review',
        detail:
          'The supplied DWGs contain title-block layer tables, but no approved P&ID process-layer standard. DEMO- layers remain synthetic and unverified.',
        severity: 'warning',
      },
    ],
  };
}

export function createStableId(prefix: string): string {
  const safePrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `${safePrefix || 'item'}-${globalThis.crypto.randomUUID()}`;
}

/**
 * Verify the imported/stored document before handing it to UI or local tools.
 * Identity and references are checked explicitly to avoid persisting broken
 * record-to-drawing links.
 */
export function validateMapping(
  input: unknown,
): input is DrawingMapping {
  if (!input || typeof input !== 'object') return false;

  const mapping = input as Partial<DrawingMapping>;
  if (
    mapping.schemaVersion !== '1.0.0' ||
    !mapping.drawing ||
    !Array.isArray(mapping.layers) ||
    !Array.isArray(mapping.entities) ||
    !Array.isArray(mapping.records) ||
    !Array.isArray(mapping.relationships) ||
    !Array.isArray(mapping.unresolvedItems)
  ) {
    return false;
  }

  if (
    !mapping.drawing.id ||
    !mapping.drawing.name ||
    mapping.drawing.sourceKind !== 'synthetic-demo' ||
    !mapping.drawing.coordinateTransform ||
    !Number.isFinite(mapping.drawing.coordinateTransform.scale) ||
    mapping.drawing.coordinateTransform.scale <= 0
  ) {
    return false;
  }

  const layerIds = new Set(mapping.layers.map((layer) => layer.id));
  const recordIds = new Set(mapping.records.map((record) => record.id));
  const entityIds = new Set(mapping.entities.map((entity) => entity.id));

  if (
    layerIds.size !== mapping.layers.length ||
    recordIds.size !== mapping.records.length ||
    entityIds.size !== mapping.entities.length
  ) {
    return false;
  }

  for (const entity of mapping.entities) {
    if (
      !entity.id ||
      typeof entity.tag !== 'string' ||
      typeof entity.label !== 'string' ||
      !Number.isFinite(entity.scale) ||
      entity.scale <= 0 ||
      entity.scale > 100 ||
      !Number.isFinite(entity.rotation) ||
      !Number.isFinite(entity.geometry.x) ||
      !Number.isFinite(entity.geometry.y) ||
      !Number.isFinite(entity.geometry.width) ||
      !Number.isFinite(entity.geometry.height) ||
      !layerIds.has(entity.layerId)
    ) {
      return false;
    }
    if (
      !entity.geometry.points.every(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          Math.abs(point.x) <= 10_000_000 &&
          Math.abs(point.y) <= 10_000_000,
      )
    ) {
      return false;
    }
  }

  for (const record of mapping.records) {
    if (
      !record.id ||
      typeof record.tag !== 'string' ||
      typeof record.description !== 'string' ||
      !record.graphicalEntityIds.every((id) => entityIds.has(id)) ||
      !record.relatedRecordIds.every((id) => recordIds.has(id))
    ) {
      return false;
    }
  }

  const entities = mapping.entities;
  const records = mapping.records;
  if (
    !entities.every((entity) =>
      records.some((record) => record.graphicalEntityIds.includes(entity.id)),
    )
  ) {
    return false;
  }

  return mapping.relationships.every(
    (relationship) =>
      recordIds.has(relationship.fromRecordId) &&
      recordIds.has(relationship.toRecordId),
  );
}

export function loadMapping(): DrawingMapping {
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY);
    if (serialized === null) return createDemoMapping();

    const parsed: unknown = JSON.parse(serialized);
    if (!validateMapping(parsed)) {
      throw new Error(
        'Saved mapping has invalid fields or broken record-to-entity links. Export a backup or reset the synthetic example before continuing.',
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        'Saved mapping could not be read as JSON. Export a backup or reset the synthetic example before continuing.',
      );
    }

    throw error instanceof Error
      ? error
      : new Error('Could not load the saved mapping from this browser.');
  }
}

export function saveMapping(mapping: DrawingMapping): void {
  if (!validateMapping(mapping)) {
    throw new Error(
      'Mapping cannot be saved because one or more record, entity, layer, or geometry references are invalid.',
    );
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mapping));
  } catch {
    throw new Error(
      'The current browser could not save the mapping locally. Export the mapping JSON before leaving this page.',
    );
  }
}

export { buildAutoCadPackage };
export * from '@/lib/cad-standards';
