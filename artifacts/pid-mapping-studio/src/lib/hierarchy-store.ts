export type Discipline = 'pfd' | 'pid';
export type GroupNode = {
  id: string;
  name: string;
  expanded: boolean;
  children: GroupNode[];
};
export type HierarchyStore = { version: 1; pfd: GroupNode[]; pid: GroupNode[] };

export const HIERARCHY_STORAGE_KEY = 'pid-mapping-studio:hierarchies:v1';
export const MAX_GROUP_NAME_LENGTH = 80;
const MAX_GROUP_ID_LENGTH = 128;
const MAX_GROUP_COUNT = 5000;
const MAX_TREE_DEPTH = 64;

export class HierarchyLoadError extends Error {
  readonly rawValue: string | null;
  constructor(message: string, rawValue: string | null = null) {
    super(message);
    this.name = 'HierarchyLoadError';
    this.rawValue = rawValue;
  }
}

export function emptyHierarchy(): HierarchyStore {
  return { version: 1, pfd: [], pid: [] };
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function isValidHierarchy(value: unknown): value is HierarchyStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const store = value as Record<string, unknown>;
  if (!hasExactKeys(store, ['version', 'pfd', 'pid']) || store.version !== 1 ||
      !Array.isArray(store.pfd) || !Array.isArray(store.pid)) return false;

  const ids = new Set<string>();
  let nodeCount = 0;
  const validateNodes = (nodes: unknown[], depth: number): boolean => {
    if (depth > MAX_TREE_DEPTH) return false;
    for (const candidate of nodes) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      const node = candidate as Record<string, unknown>;
      if (!hasExactKeys(node, ['id', 'name', 'expanded', 'children']) ||
          typeof node.id !== 'string' || node.id.length === 0 || node.id.length > MAX_GROUP_ID_LENGTH ||
          typeof node.name !== 'string' || node.name.trim().length === 0 ||
          node.name !== node.name.trim() || node.name.length > MAX_GROUP_NAME_LENGTH ||
          typeof node.expanded !== 'boolean' || !Array.isArray(node.children) || ids.has(node.id)) return false;
      ids.add(node.id);
      nodeCount += 1;
      if (nodeCount > MAX_GROUP_COUNT || !validateNodes(node.children, depth + 1)) return false;
    }
    return true;
  };
  return validateNodes(store.pfd, 0) && validateNodes(store.pid, 0);
}

export function loadHierarchy(): HierarchyStore {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(HIERARCHY_STORAGE_KEY);
  } catch {
    throw new HierarchyLoadError('Saved groups could not be read from browser storage.');
  }
  if (raw === null) return emptyHierarchy();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HierarchyLoadError('Saved group data is not valid JSON.', raw);
  }
  if (!isValidHierarchy(parsed)) {
    throw new HierarchyLoadError('Saved group data is malformed or uses an unsupported format.', raw);
  }
  return parsed;
}

export function writeHierarchy(store: HierarchyStore): void {
  if (!isValidHierarchy(store)) throw new Error('Groups could not be saved because the hierarchy is invalid.');
  window.localStorage.setItem(HIERARCHY_STORAGE_KEY, JSON.stringify(store));
}

export function updateGroupTree(
  nodes: GroupNode[],
  id: string,
  update: (node: GroupNode) => GroupNode,
): GroupNode[] {
  return nodes.map((node) => node.id === id
    ? update(node)
    : { ...node, children: updateGroupTree(node.children, id, update) });
}

export function removeGroupTree(nodes: GroupNode[], id: string): GroupNode[] {
  return nodes.filter((node) => node.id !== id)
    .map((node) => ({ ...node, children: removeGroupTree(node.children, id) }));
}

export function subtreeContains(node: GroupNode, id: string | null): boolean {
  if (!id) return false;
  return node.id === id || node.children.some((child) => subtreeContains(child, id));
}

export function countGroups(nodes: GroupNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countGroups(node.children), 0);
}
