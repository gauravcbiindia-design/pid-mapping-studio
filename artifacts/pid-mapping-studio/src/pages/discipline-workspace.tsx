import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Folder, GitBranch,
  Database, HardDrive, Info, Layers, Plus, Settings2, Trash2,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  countGroups, emptyHierarchy, HIERARCHY_STORAGE_KEY, loadHierarchy,
  MAX_GROUP_NAME_LENGTH, removeGroupTree, subtreeContains, updateGroupTree,
  writeHierarchy,
} from '@/lib/hierarchy-store';
import type { Discipline, GroupNode, HierarchyStore } from '@/lib/hierarchy-store';
import { HierarchyLoadError } from '@/lib/hierarchy-store';
import PdfInputPanel from '@/pages/pdf-input-panel';

type RecoveryState = { message: string; rawValue: string | null };

export default function DisciplineWorkspace({ discipline }: { discipline: Discipline }) {
  const [initial] = useState(() => {
    try {
      return { hierarchy: loadHierarchy(), recovery: null as RecoveryState | null };
    } catch (error) {
      const loadError = error instanceof HierarchyLoadError
        ? error
        : new HierarchyLoadError('Saved groups could not be loaded from this browser.');
      return {
        hierarchy: emptyHierarchy(),
        recovery: { message: loadError.message, rawValue: loadError.rawValue },
      };
    }
  });
  const [hierarchy, setHierarchy] = useState<HierarchyStore>(initial.hierarchy);
  const [recovery, setRecovery] = useState<RecoveryState | null>(initial.recovery);
  const [storageError, setStorageError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const groups = hierarchy[discipline];
  const title = discipline === 'pfd' ? 'PFD' : 'P&ID';

  useEffect(() => {
    if (recovery) return;
    try {
      writeHierarchy(hierarchy);
      setStorageError('');
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Groups could not be saved in this browser.');
    }
  }, [hierarchy, recovery]);

  const createGroup = (name: string): GroupNode => ({
    id: globalThis.crypto?.randomUUID?.() ?? `group-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name, expanded: true, children: [],
  });
  const beginRename = (id: string, name: string) => {
    setEditName(name);
    setEditingId(id);
  };
  const addRoot = () => {
    const group = createGroup('New group');
    setHierarchy((current) => ({ ...current, [discipline]: [...current[discipline], group] }));
    beginRename(group.id, group.name);
    setSelectedId(group.id);
  };
  const addChild = (parentId: string) => {
    const child = createGroup('New group');
    setHierarchy((current) => ({
      ...current,
      [discipline]: updateGroupTree(current[discipline], parentId, (node) => ({
        ...node, expanded: true, children: [...node.children, child],
      })),
    }));
    beginRename(child.id, child.name);
    setSelectedId(child.id);
  };
  const commitRename = (id: string) => {
    const cleanName = editName.trim();
    if (!cleanName || cleanName.length > MAX_GROUP_NAME_LENGTH) {
      setStorageError(`Group names must be 1–${MAX_GROUP_NAME_LENGTH} characters.`);
      setEditingId(null);
      return;
    }
    setHierarchy((current) => ({
      ...current,
      [discipline]: updateGroupTree(current[discipline], id, (node) => ({ ...node, name: cleanName })),
    }));
    setEditingId(null);
    setStorageError('');
  };
  const cancelRename = () => setEditingId(null);
  const toggleExpanded = (id: string) => setHierarchy((current) => ({
    ...current,
    [discipline]: updateGroupTree(current[discipline], id, (node) => ({ ...node, expanded: !node.expanded })),
  }));
  const deleteGroup = (node: GroupNode) => {
    if (!window.confirm(`Delete “${node.name}” and all groups inside it?`)) return;
    if (subtreeContains(node, selectedId)) setSelectedId(null);
    if (nodeContains(node, editingId)) setEditingId(null);
    setHierarchy((current) => ({ ...current, [discipline]: removeGroupTree(current[discipline], node.id) }));
  };

  const downloadRawBackup = () => {
    if (recovery?.rawValue === null || recovery?.rawValue === undefined) return;
    const blob = new Blob([recovery.rawValue], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'mapping-studio-hierarchy-backup.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const clearSavedHierarchy = () => {
    if (!window.confirm('Clear the unreadable hierarchy saved in this browser? This cannot be undone. Download a backup first if you may need the saved data.')) return;
    try {
      window.localStorage.removeItem(HIERARCHY_STORAGE_KEY);
      setHierarchy(emptyHierarchy());
      setRecovery(null);
      setStorageError('');
    } catch {
      setStorageError('Browser storage could not be cleared. The saved hierarchy remains locked and unchanged.');
    }
  };

  return (
    <main className="hierarchy-page">
      <header className="hierarchy-topbar">
        <Link href="/" className="studio-wordmark" data-testid="link-home"><span className="wordmark-icon">PM</span> Mapping Studio</Link>
        <div className="hierarchy-top-actions">
          <span className="local-chip"><span className="local-dot" />Browser-local · not shared</span>
          <Link href="/" className="btn subtle" data-testid="link-discipline-selection"><ArrowLeft size={14} /> Disciplines</Link>
        </div>
      </header>
      <div className="hierarchy-frame">
        <aside className="hierarchy-sidebar">
          <div className="sidebar-label">DISCIPLINES</div>
          <Link href="/workspace/pfd" className={`discipline-nav ${discipline === 'pfd' ? 'active' : ''}`} data-testid="nav-pfd"><GitBranch size={16} /> PFD</Link>
          <Link href="/workspace/pid" className={`discipline-nav ${discipline === 'pid' ? 'active' : ''}`} data-testid="nav-pid"><Layers size={16} /> P&amp;ID</Link>
          <div className="sidebar-local-note"><HardDrive size={14} /><span>Groups are saved on this device only.</span></div>
        </aside>
        <section className="hierarchy-main" aria-label={`${title} workspace`}>
          <div className="hierarchy-heading">
            <div>
              <div className="eyebrow">Discipline workspace / browser-local</div>
              <h1>{title}</h1>
                <p>Keep {title} groups separate and review source files before adding engineering records.</p>
            </div>
            <div className="hierarchy-heading-actions">
              <Link href={`/workspace/${discipline}/engineering-data`} className="btn edm-entry-link" data-testid={`link-engineering-data-${discipline}`}><Database size={14} /> Engineering data</Link>
              <button className="btn primary" onClick={addRoot} disabled={!!recovery} data-testid="button-add-group"><Plus size={15} /> New group</button>
            </div>
          </div>
          <PdfInputPanel key={discipline} discipline={discipline === 'pfd' ? 'PFD' : 'P&ID'} />
          {recovery && (
            <div className="hierarchy-recovery" role="alert" data-testid="status-hierarchy-recovery">
              <div className="recovery-title"><AlertTriangle size={17} /><strong>Saved groups need recovery</strong></div>
              <p>{recovery.message} Editing is disabled to protect the saved data.</p>
              {recovery.rawValue !== null
                ? <button className="btn" onClick={downloadRawBackup} data-testid="button-download-hierarchy-backup">Download raw backup</button>
                : <p className="recovery-unavailable">A raw backup is unavailable because browser storage could not be read.</p>}
              <button className="btn danger" onClick={clearSavedHierarchy} data-testid="button-clear-hierarchy-storage">Clear saved data and start over</button>
            </div>
          )}
          {storageError && !recovery && <div className="storage-banner" role="alert" data-testid="status-hierarchy-storage"><AlertTriangle size={15} />{storageError}</div>}
          <div className="hierarchy-panel">
            <div className="tree-head"><span>GROUPS</span><span data-testid="text-group-count">{countGroups(groups)} {countGroups(groups) === 1 ? 'group' : 'groups'}</span></div>
            {groups.length === 0 ? (
              <div className="hierarchy-empty" data-testid="empty-hierarchy">
                <div className="empty-folder"><Folder size={23} /></div>
                <strong>{recovery ? 'Groups are locked' : 'No groups yet'}</strong>
                <p>{recovery ? 'Recover or clear the saved data to continue.' : 'Create a group to begin organizing this discipline.'}</p>
                {!recovery && <button className="btn" onClick={addRoot} data-testid="button-create-first-group"><Plus size={14} /> Create first group</button>}
              </div>
            ) : (
              <div className="tree-list" role="tree" aria-label={`${title} groups`}>
                {groups.map((node) => (
                  <GroupRow key={node.id} node={node} depth={0} selectedId={selectedId} editingId={editingId}
                    editName={editName} setEditName={setEditName} onSelect={setSelectedId}
                    onToggle={toggleExpanded} onAdd={addChild} onRename={beginRename}
                    onCommit={commitRename} onCancel={cancelRename} onDelete={deleteGroup} disabled={!!recovery} />
                ))}
              </div>
            )}
          </div>
          <div className="hierarchy-footnote"><HardDrive size={14} /><span>Saved in this browser. This group structure is separate from the other discipline.</span></div>
        </section>
      </div>
    </main>
  );
}

function nodeContains(node: GroupNode, id: string | null): boolean {
  return id !== null && (node.id === id || node.children.some((child) => nodeContains(child, id)));
}

function GroupRow({ node, depth, selectedId, editingId, editName, setEditName, onSelect, onToggle, onAdd, onRename, onCommit, onCancel, onDelete, disabled }: {
  node: GroupNode; depth: number; selectedId: string | null; editingId: string | null; editName: string;
  setEditName: (value: string) => void; onSelect: (id: string) => void; onToggle: (id: string) => void;
  onAdd: (id: string) => void; onRename: (id: string, name: string) => void; onCommit: (id: string) => void;
  onCancel: () => void; onDelete: (node: GroupNode) => void; disabled: boolean;
}) {
  const isEditing = editingId === node.id;
  const finishedForId = useRef<string | null>(null);
  const finish = () => {
    if (finishedForId.current === node.id) return;
    finishedForId.current = node.id;
    onCommit(node.id);
  };
  const cancel = () => {
    if (finishedForId.current === node.id) return;
    finishedForId.current = node.id;
    onCancel();
  };

  return (
    <>
      <div className={`tree-row ${selectedId === node.id ? 'selected' : ''}`} role="treeitem" aria-expanded={node.children.length ? node.expanded : undefined} aria-level={depth + 1}
        style={{ '--tree-depth': depth } as CSSProperties} data-testid={`tree-group-${node.id}`}>
        <button className="tree-toggle" aria-label={`${node.expanded ? 'Collapse' : 'Expand'} ${node.name}`} disabled={disabled} onClick={() => onToggle(node.id)} data-testid={`button-toggle-group-${node.id}`}>
          {node.expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <Folder className="tree-folder" size={16} />
        {isEditing ? (
          <input autoFocus maxLength={MAX_GROUP_NAME_LENGTH} className="tree-rename-input" aria-label="Group name" value={editName} disabled={disabled}
            onChange={(event) => setEditName(event.target.value)} onFocus={() => { finishedForId.current = null; }} onBlur={finish}
            onKeyDown={(event) => { if (event.key === 'Enter') finish(); if (event.key === 'Escape') { event.preventDefault(); cancel(); } }}
            data-testid={`input-rename-group-${node.id}`} />
        ) : (
          <button className="tree-name" disabled={disabled} onClick={() => onSelect(node.id)} onDoubleClick={() => onRename(node.id, node.name)} title="Select group; double-click to rename" data-testid={`button-select-group-${node.id}`}>{node.name}</button>
        )}
        <span className="tree-actions">
          <button aria-label={`Add subgroup under ${node.name}`} title="Add subgroup" disabled={disabled} onClick={() => onAdd(node.id)} data-testid={`button-add-subgroup-${node.id}`}><Plus size={14} /></button>
          <button aria-label={`Rename ${node.name}`} title="Rename group" disabled={disabled} onClick={() => onRename(node.id, node.name)} data-testid={`button-rename-group-${node.id}`}><Settings2 size={13} /></button>
          <button aria-label={`Delete ${node.name}`} title="Delete group" disabled={disabled} onClick={() => onDelete(node)} data-testid={`button-delete-group-${node.id}`}><Trash2 size={13} /></button>
        </span>
      </div>
      {node.expanded && node.children.map((child) => (
        <GroupRow key={child.id} node={child} depth={depth + 1} selectedId={selectedId} editingId={editingId}
          editName={editName} setEditName={setEditName} onSelect={onSelect} onToggle={onToggle} onAdd={onAdd}
          onRename={onRename} onCommit={onCommit} onCancel={onCancel} onDelete={onDelete} disabled={disabled} />
      ))}
    </>
  );
}
