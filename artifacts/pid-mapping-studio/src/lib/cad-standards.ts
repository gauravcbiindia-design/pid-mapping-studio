export type CadStandardCategory =
  | 'titleBlock'
  | 'layer'
  | 'textStyle'
  | 'linetype'
  | 'dimensionStyle'
  | 'symbol'
  | 'legend';

export type CadPurpose = 'PFD' | 'P&ID' | 'Data sheet';
export type CadSheetSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
export type CadReviewStatus = 'reviewed' | 'needs-review';
export type CadCandidateStatus = 'needs-review' | 'approved' | 'dismissed';
export type CadProposedScope = 'company' | 'project' | 'unclassified';
export type CadStandardScope = 'company' | 'project';
export type CadSourceKind = 'extracted-dwg' | 'approved-source-drawing' | 'synthetic-demo';

export interface CadLibraryField {
  label: string;
  value: string;
}

export interface CadLibraryItem {
  id: string;
  category: CadStandardCategory;
  name: string;
  summary: string;
  sourceFile: string;
  sourceKind: CadSourceKind;
  scope: CadStandardScope;
  reviewStatus: CadReviewStatus;
  projectId?: string;
  projectName?: string;
  sheetSize?: CadSheetSize;
  canPromote: boolean;
  fields: CadLibraryField[];
}

export interface CadReviewCandidate {
  id: string;
  item: CadLibraryItem;
  proposedScope: CadProposedScope;
  sourceGroup: string;
  projectId?: string;
  projectName?: string;
  status: CadCandidateStatus;
}

export interface CadAuditEntry {
  id: string;
  at: string;
  action: string;
  detail: string;
  projectName?: string;
}

export interface CadProjectLibrary {
  projectName: string;
  defaults: Partial<Record<CadPurpose, CadSheetSize>>;
  items: CadLibraryItem[];
}

export interface CadStandardsLibrary {
  schemaVersion: '1.0.0';
  companyDefaults: Record<CadPurpose, CadSheetSize>;
  companyItems: CadLibraryItem[];
  projects: Record<string, CadProjectLibrary>;
  reviewCandidates: CadReviewCandidate[];
  auditTrail: CadAuditEntry[];
}

export interface ApprovedCadMapping {
  id: string;
  name: string;
  category: 'symbol' | 'legend';
  summary: string;
  sourceFile: string;
  sourceKind: 'approved-source-drawing' | 'synthetic-demo';
  fields: CadLibraryField[];
  reviewStatus: CadReviewStatus;
}

export const CAD_PURPOSES: CadPurpose[] = ['PFD', 'P&ID', 'Data sheet'];
export const CAD_SHEET_SIZES: CadSheetSize[] = ['A0', 'A1', 'A2', 'A3', 'A4'];
export const CAD_STANDARDS_STORAGE_KEY = 'pid-mapping-studio:cad-standards:v1';

function createCompanySeed(): CadStandardsLibrary {
  return {
    schemaVersion: '1.0.0',
    companyDefaults: {
      PFD: 'A1',
      'P&ID': 'A1',
      'Data sheet': 'A4',
    },
    // Start empty until the user supplies and approves company CAD standards.
    companyItems: [],
    projects: {},
    reviewCandidates: [],
    auditTrail: [],
  };
}

export function createCadStandardsLibrarySeed(): CadStandardsLibrary {
  return createCompanySeed();
}

function newAuditEntry(
  action: string,
  detail: string,
  projectName?: string,
): CadAuditEntry {
  return {
    id: `audit-${globalThis.crypto.randomUUID()}`,
    at: new Date().toISOString(),
    action,
    detail,
    ...(projectName ? { projectName } : {}),
  };
}

function validItem(value: unknown): value is CadLibraryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CadLibraryItem>;
  return Boolean(
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.summary === 'string' &&
    typeof item.sourceFile === 'string' &&
    ['titleBlock', 'layer', 'textStyle', 'linetype', 'dimensionStyle', 'symbol', 'legend'].includes(String(item.category)) &&
    ['extracted-dwg', 'approved-source-drawing', 'synthetic-demo'].includes(String(item.sourceKind)) &&
    ['company', 'project'].includes(String(item.scope)) &&
    ['reviewed', 'needs-review'].includes(String(item.reviewStatus)) &&
    typeof item.canPromote === 'boolean' &&
    Array.isArray(item.fields) &&
    item.fields.every((field) => typeof field?.label === 'string' && typeof field?.value === 'string') &&
    (item.sheetSize === undefined || CAD_SHEET_SIZES.includes(item.sheetSize)) &&
    (item.scope !== 'project' || (typeof item.projectId === 'string' && typeof item.projectName === 'string')),
  );
}

function validCandidate(value: unknown): value is CadReviewCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CadReviewCandidate>;
  return Boolean(
    typeof candidate.id === 'string' &&
    validItem(candidate.item) &&
    ['company', 'project', 'unclassified'].includes(String(candidate.proposedScope)) &&
    typeof candidate.sourceGroup === 'string' &&
    ['needs-review', 'approved', 'dismissed'].includes(String(candidate.status)) &&
    (candidate.proposedScope === 'company' ||
      (typeof candidate.projectId === 'string' && typeof candidate.projectName === 'string')),
  );
}

export function validateCadStandardsLibrary(input: unknown): input is CadStandardsLibrary {
  if (!input || typeof input !== 'object') return false;
  const library = input as Partial<CadStandardsLibrary>;
  if (
    library.schemaVersion !== '1.0.0' ||
    !library.companyDefaults ||
    !library.companyItems ||
    !Array.isArray(library.companyItems) ||
    !library.projects ||
    typeof library.projects !== 'object' ||
    (library.reviewCandidates !== undefined && !Array.isArray(library.reviewCandidates)) ||
    !Array.isArray(library.auditTrail)
  ) {
    return false;
  }

  if (
    !CAD_PURPOSES.every((purpose) => CAD_SHEET_SIZES.includes(library.companyDefaults![purpose])) ||
    !library.companyItems.every((item) => validItem(item) && item.scope === 'company') ||
    !(library.reviewCandidates ?? []).every((candidate) => validCandidate(candidate)) ||
    !library.auditTrail.every((entry) =>
      Boolean(
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.at === 'string' &&
        typeof entry.action === 'string' &&
        typeof entry.detail === 'string',
      ),
    )
  ) {
    return false;
  }

  return Object.entries(library.projects).every(([projectId, project]) =>
    Boolean(
      projectId &&
      project &&
      typeof project.projectName === 'string' &&
      project.defaults &&
      Object.entries(project.defaults).every(([purpose, size]) =>
        CAD_PURPOSES.includes(purpose as CadPurpose) && CAD_SHEET_SIZES.includes(size),
      ) &&
      Array.isArray(project.items) &&
      project.items.every((item) => validItem(item) && item.scope === 'project' && item.projectId === projectId),
    ),
  );
}

export function saveCadStandardsLibrary(library: CadStandardsLibrary): void {
  if (!validateCadStandardsLibrary(library)) {
    throw new Error('CAD standards could not be saved because the library data is invalid.');
  }
  try {
    window.localStorage.setItem(CAD_STANDARDS_STORAGE_KEY, JSON.stringify(library));
  } catch {
    throw new Error('This browser could not save the CAD standards locally. Export or back up the library before leaving this page.');
  }
}

export function loadCadStandardsLibrary(): CadStandardsLibrary {
  let serialized: string | null;
  try {
    serialized = window.localStorage.getItem(CAD_STANDARDS_STORAGE_KEY);
  } catch {
    throw new Error('This browser could not read its local CAD standards library.');
  }
  if (serialized === null) {
    const seed = createCompanySeed();
    saveCadStandardsLibrary(seed);
    return seed;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('The locally saved CAD standards library is not valid JSON. It was left unchanged.');
  }
  if (!validateCadStandardsLibrary(parsed)) {
    throw new Error('The locally saved CAD standards library has invalid fields. It was left unchanged.');
  }

  const normalized: CadStandardsLibrary = {
    ...parsed,
    reviewCandidates: parsed.reviewCandidates ?? [],
  };
  const seed = createCompanySeed();
  const missingSeedItems = seed.companyItems.filter(
    (seedItem) => !normalized.companyItems.some((item) => item.id === seedItem.id),
  );
  const existingCandidateIds = new Set(normalized.reviewCandidates.map((candidate) => candidate.id));
  const missingCandidates = seed.reviewCandidates.filter((candidate) => !existingCandidateIds.has(candidate.id));
  if (!missingSeedItems.length && !missingCandidates.length) return normalized;
  const merged: CadStandardsLibrary = {
    ...normalized,
    companyItems: [...normalized.companyItems, ...missingSeedItems],
    reviewCandidates: [...normalized.reviewCandidates, ...missingCandidates],
    auditTrail: [
      ...normalized.auditTrail,
      newAuditEntry(
        'Source mappings added to review queue',
        `${missingCandidates.length} anonymized source mappings were added as pending review. Existing approvals, dismissals, and project settings were preserved.`,
      ),
    ],
  };
  saveCadStandardsLibrary(merged);
  return merged;
}

export function getProjectCadDefaults(
  library: CadStandardsLibrary,
  projectId: string,
): Partial<Record<CadPurpose, CadSheetSize>> {
  return library.projects[projectId]?.defaults ?? {};
}

export function getEffectiveCadDefault(
  library: CadStandardsLibrary,
  projectId: string,
  purpose: CadPurpose,
): CadSheetSize {
  return library.projects[projectId]?.defaults[purpose] ?? library.companyDefaults[purpose];
}

export function getCadLibraryItems(
  library: CadStandardsLibrary,
  projectId: string,
): CadLibraryItem[] {
  return [
    ...library.companyItems,
    ...(library.projects[projectId]?.items ?? []),
  ];
}

function hasReviewedTitleBlock(items: CadLibraryItem[], sheetSize: CadSheetSize): boolean {
  return items.some((item) =>
    item.category === 'titleBlock' &&
    item.reviewStatus === 'reviewed' &&
    (item.sheetSize === sheetSize || item.fields.some((field) =>
      field.label === 'Sheet size' && field.value === sheetSize,
    )),
  );
}

export function setCompanyCadDefault(
  library: CadStandardsLibrary,
  purpose: CadPurpose,
  sheetSize: CadSheetSize,
): CadStandardsLibrary {
  if (library.companyDefaults[purpose] === sheetSize) return library;
  if (!hasReviewedTitleBlock(library.companyItems, sheetSize)) {
    throw new Error(`Approve a company title-block mapping for ${sheetSize} before making it a company default.`);
  }
  return {
    ...library,
    companyDefaults: { ...library.companyDefaults, [purpose]: sheetSize },
    auditTrail: [
      newAuditEntry(
        'Company sheet-size default changed',
        `${purpose} changed to ${sheetSize} after an approved company title-block mapping was available.`,
      ),
      ...library.auditTrail,
    ],
  };
}

export function approveCadReviewCandidate(
  library: CadStandardsLibrary,
  candidateId: string,
  targetScope: 'company' | 'project',
  additionalFields: CadLibraryField[] = [],
): CadStandardsLibrary {
  const candidate = library.reviewCandidates.find((entry) => entry.id === candidateId);
  if (!candidate || candidate.status !== 'needs-review') {
    throw new Error('The selected source mapping is no longer awaiting review.');
  }
  if (targetScope === 'company' && candidate.proposedScope !== 'company') {
    throw new Error('Only a source classified for the Legends Library can be approved there.');
  }
  if (targetScope === 'project' && candidate.proposedScope === 'company') {
    throw new Error('Legends Library source mappings must be approved to the Legends Library.');
  }
  const fields = [
    ...candidate.item.fields.filter((field) =>
      !additionalFields.some((extra) => extra.label === field.label),
    ),
    ...additionalFields,
  ];
  if (
    candidate.item.category === 'symbol' &&
    candidate.item.sourceKind === 'extracted-dwg' &&
    (!fields.some((field) => field.label === 'Fallback category' && field.value.trim()) ||
      !fields.some((field) => field.label === 'Block asset ID' && field.value.trim()))
  ) {
    throw new Error('A fallback category and locally extracted block file are required before approving this symbol.');
  }

  const reviewed: CadLibraryItem = {
    ...candidate.item,
    fields,
    scope: targetScope,
    reviewStatus: 'reviewed',
    canPromote: false,
    ...(targetScope === 'project'
      ? { projectId: candidate.projectId, projectName: candidate.projectName }
      : { projectId: undefined, projectName: undefined }),
  };
  let companyItems = library.companyItems;
  let projects = library.projects;
  if (targetScope === 'company') {
    companyItems = [
      ...library.companyItems.filter((item) => item.id !== reviewed.id),
      reviewed,
    ];
  } else {
    const projectId = candidate.projectId;
    const projectName = candidate.projectName;
    if (!projectId || !projectName) throw new Error('The isolated project scope is not available for this mapping.');
    const existing = library.projects[projectId] ?? { projectName, defaults: {}, items: [] };
    projects = {
      ...library.projects,
      [projectId]: {
        ...existing,
        projectName,
        items: [...existing.items.filter((item) => item.id !== reviewed.id), reviewed],
      },
    };
  }

  const reviewCandidates = library.reviewCandidates.map((entry) =>
    entry.id === candidateId ? { ...entry, status: 'approved' as const } : entry,
  );
  const scopeLabel = targetScope === 'company' ? 'Legends Library' : `isolated ${candidate.projectName} library`;
  return {
    ...library,
    companyItems,
    projects,
    reviewCandidates,
    auditTrail: [
      newAuditEntry('Source mapping approved', `${candidate.item.category} mapping ${candidate.item.name} was approved to ${scopeLabel}.`, candidate.projectName),
      ...library.auditTrail,
    ],
  };
}

export function dismissCadReviewCandidate(
  library: CadStandardsLibrary,
  candidateId: string,
): CadStandardsLibrary {
  const candidate = library.reviewCandidates.find((entry) => entry.id === candidateId);
  if (!candidate || candidate.status !== 'needs-review') {
    throw new Error('The selected source mapping is no longer awaiting review.');
  }
  return {
    ...library,
    reviewCandidates: library.reviewCandidates.map((entry) =>
      entry.id === candidateId ? { ...entry, status: 'dismissed' as const } : entry,
    ),
    auditTrail: [
      newAuditEntry('Source mapping dismissed', `${candidate.item.category} mapping ${candidate.item.name} was dismissed from the review queue.`, candidate.projectName),
      ...library.auditTrail,
    ],
  };
}

export function saveProjectCadDefault(
  library: CadStandardsLibrary,
  projectId: string,
  projectName: string,
  purpose: CadPurpose,
  sheetSize: CadSheetSize,
): CadStandardsLibrary {
  if (!projectId.trim() || !projectName.trim()) {
    throw new Error('Choose a project before saving its title-block override.');
  }
  const existing = library.projects[projectId] ?? {
    projectName,
    defaults: {},
    items: [],
  };
  const defaults = { ...existing.defaults, [purpose]: sheetSize };
  const sourceItem = [
    ...(library.projects[projectId]?.items ?? []),
    ...library.companyItems,
  ].find((item) =>
    item.category === 'titleBlock' &&
    item.reviewStatus === 'reviewed' &&
    (item.sheetSize === sheetSize || item.fields.some((field) =>
      field.label === 'Sheet size' && field.value === sheetSize,
    )),
  );
  if (!sourceItem) throw new Error(`Approve a title-block mapping for ${sheetSize} before saving this project default.`);

  const overrideId = `project-default-${purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const overrideItem: CadLibraryItem = {
    ...sourceItem,
    id: overrideId,
    name: `${sheetSize} · ${purpose} project default`,
    summary: `Project-only choice for ${purpose}. The company default remains ${library.companyDefaults[purpose]}.`,
    scope: 'project',
    projectId,
    projectName,
    canPromote: false,
    fields: [
      ...sourceItem.fields,
      { label: 'Override purpose', value: purpose },
      { label: 'Project choice', value: sheetSize },
      { label: 'Company default', value: library.companyDefaults[purpose] },
    ],
  };
  const next: CadStandardsLibrary = {
    ...library,
    projects: {
      ...library.projects,
      [projectId]: {
        projectName,
        defaults,
        items: [
          ...existing.items.filter((item) => item.id !== overrideId),
          overrideItem,
        ],
      },
    },
    auditTrail: [
      newAuditEntry(
        'Project title-block override saved',
        `${purpose} set to ${sheetSize}; company default remains ${library.companyDefaults[purpose]}. Other project libraries are unchanged.`,
        projectName,
      ),
      ...library.auditTrail,
    ],
  };
  return next;
}

export function promoteProjectCadDefault(
  library: CadStandardsLibrary,
  projectId: string,
  purpose: CadPurpose,
): CadStandardsLibrary {
  const project = library.projects[projectId];
  const sheetSize = project?.defaults[purpose];
  if (!project || !sheetSize) {
    throw new Error(`There is no ${purpose} override to promote from this project.`);
  }
  const projects = { ...library.projects };
  const defaults = { ...project.defaults };
  delete defaults[purpose];
  projects[projectId] = {
    ...project,
    defaults,
    items: project.items.filter(
      (item) => item.id !== `project-default-${purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    ),
  };
  return {
    ...library,
    companyDefaults: { ...library.companyDefaults, [purpose]: sheetSize },
    projects,
    auditTrail: [
      newAuditEntry(
        'Project default explicitly promoted to company',
        `${project.projectName} ${purpose} choice ${sheetSize} is now the company default. The originating project returned to inheritance.`,
        project.projectName,
      ),
      ...library.auditTrail,
    ],
  };
}

export function saveApprovedCadMapping(
  library: CadStandardsLibrary,
  projectId: string,
  projectName: string,
  mapping: ApprovedCadMapping,
): CadStandardsLibrary {
  if (mapping.reviewStatus !== 'reviewed') {
    throw new Error('Only a human-reviewed mapping can be saved to a project library.');
  }
  if (!projectId.trim() || !projectName.trim() || !mapping.id.trim() || !mapping.sourceFile.trim()) {
    throw new Error('Project, mapping, and source identifiers are required.');
  }
  const existing = library.projects[projectId] ?? {
    projectName,
    defaults: {},
    items: [],
  };
  const item: CadLibraryItem = {
    id: mapping.id,
    category: mapping.category,
    name: mapping.name,
    summary: mapping.summary,
    sourceFile: mapping.sourceFile,
    sourceKind: mapping.sourceKind,
    scope: 'project',
    reviewStatus: mapping.reviewStatus,
    projectId,
    projectName,
    canPromote: mapping.sourceKind === 'approved-source-drawing',
    fields: mapping.fields,
  };
  return {
    ...library,
    projects: {
      ...library.projects,
      [projectId]: {
        ...existing,
        projectName,
        items: [...existing.items.filter((entry) => entry.id !== item.id), item],
      },
    },
    auditTrail: [
      newAuditEntry(
        'Reviewed mapping saved to project library',
        `${mapping.name} saved in ${projectName}; the Legends Library and other projects were not changed${mapping.sourceKind === 'synthetic-demo' ? ' (synthetic preview item; Legends Library promotion disabled)' : ''}.`,
        projectName,
      ),
      ...library.auditTrail,
    ],
  };
}

export function promoteProjectCadItem(
  library: CadStandardsLibrary,
  projectId: string,
  itemId: string,
): CadStandardsLibrary {
  const project = library.projects[projectId];
  const item = project?.items.find((entry) => entry.id === itemId);
  if (!project || !item) throw new Error('The selected project library item no longer exists.');
  if (
    !item.canPromote ||
    item.reviewStatus !== 'reviewed' ||
    item.sourceKind !== 'approved-source-drawing' ||
    !['symbol', 'legend'].includes(item.category)
  ) {
    throw new Error('Only a human-reviewed symbol or legend mapped from a real source drawing can be promoted to the Legends Library.');
  }
  const promotedId = `company-${item.id}`;
  if (library.companyItems.some((entry) => entry.id === promotedId)) {
    throw new Error('This mapping is already present in the Legends Library.');
  }
  const promoted: CadLibraryItem = {
    ...item,
    id: promotedId,
    scope: 'company',
    projectId: undefined,
    projectName: undefined,
    canPromote: false,
  };
  return {
    ...library,
    companyItems: [...library.companyItems, promoted],
    auditTrail: [
      newAuditEntry(
        'Reviewed project mapping promoted to company',
        `${item.name} from ${project.projectName} was explicitly promoted to the Legends Library from ${item.sourceFile}.`,
        project.projectName,
      ),
      ...library.auditTrail,
    ],
  };
}
