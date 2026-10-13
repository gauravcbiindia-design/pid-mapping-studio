import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowLeft, Check, CheckCircle2, ChevronDown,
  CircleDot, ClipboardCheck, FileDown, Gauge, GitBranch, Info, Layers, Hand,
  ListFilter, LockKeyhole, MousePointer2, PanelLeft, RotateCcw, Search, Settings2,
  ShieldAlert, ShieldCheck, SlidersHorizontal, Tag, ZoomIn, ZoomOut,
} from 'lucide-react';
import { Link, Redirect, Route, Router, Switch, useLocation } from 'wouter';
import { ClerkProvider, SignIn, SignUp, UserButton, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { DisciplineChooser, WorkspaceNotFound } from '@/pages/discipline-chooser';
import DisciplineWorkspace from '@/pages/discipline-workspace';
import EngineeringDataManager from '@/pages/engineering-data-manager';
import StandardsLibraryPage from '@/pages/standards-library-page';
import AdminLibraryPage from '@/pages/admin-library-page';
import {
  buildAutoCadPackage, createDemoMapping, loadMapping, saveMapping,
} from '@/lib/pid-domain';
import {
  approveCadReviewCandidate, createCadStandardsLibrarySeed, dismissCadReviewCandidate,
  loadCadStandardsLibrary, saveCadStandardsLibrary, saveProjectCadDefault, setCompanyCadDefault,
} from '@/lib/cad-standards';
import type {
  DrawingMapping, EngineeringRecord, EntityKind, MappedEntity, ReviewStatus,
} from '@/lib/pid-domain';
import type { CadPurpose, CadSheetSize, CadStandardsLibrary } from '@/lib/cad-standards';

type ListMode = 'entities' | 'records';
type CanvasMode = 'select' | 'pan';

const kindLabel: Record<EntityKind, string> = {
  equipment: 'Equipment', line: 'Process line', valve: 'Valve',
  instrument: 'Instrument', label: 'Native text',
};
const statusLabel: Record<ReviewStatus, string> = {
  draft: 'Needs review', reviewed: 'Reviewed', unresolved: 'Unresolved',
};

function formatKind(kind: EntityKind) {
  return kindLabel[kind] ?? kind;
}

function entityDisplayName(entity: MappedEntity) {
  return entity.tag || entity.label || 'Untitled mapping';
}

function ReviewWorkspace() {
  const [initialWorkspace] = useState(() => {
    try {
      return { mapping: loadMapping(), loadError: null as string | null };
    } catch (error) {
      return {
        mapping: createDemoMapping(),
        loadError: error instanceof Error
          ? error.message
          : 'Saved browser data could not be read.',
      };
    }
  });
  const [mapping, setMapping] = useState<DrawingMapping>(() => initialWorkspace.mapping);
  const [canSaveLocally, setCanSaveLocally] = useState(() => initialWorkspace.loadError === null);
  const [storageNotice, setStorageNotice] = useState<string | null>(() => initialWorkspace.loadError);
  const [mode, setMode] = useState<ListMode>('entities');
  const [search, setSearch] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(() => mapping.entities[0]?.id ?? null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(() => {
    const firstEntityId = mapping.entities[0]?.id;
    return mapping.records.find((record) => record.graphicalEntityIds.includes(firstEntityId ?? ''))?.id ?? null;
  });
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('select');
  const [showLayers, setShowLayers] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [fitRequest, setFitRequest] = useState(0);
  const [packageMessage, setPackageMessage] = useState('');
  const [isPackaging, setIsPackaging] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!canSaveLocally) return;
    try {
      saveMapping(mapping);
      setStorageNotice(null);
    } catch (error) {
      setStorageNotice(error instanceof Error ? error.message : 'Could not save locally.');
      setCanSaveLocally(false);
    }
  }, [mapping, canSaveLocally]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedEntity = mapping.entities.find((item) => item.id === selectedEntityId) ?? null;
  const selectedRecord = mapping.records.find((item) => item.id === selectedRecordId) ?? null;
  const visibleEntities = useMemo(() => {
    const query = search.toLowerCase().trim();
    return mapping.entities.filter((item) => !query || [
      item.tag, item.label, item.kind, item.layerId, item.blockName ?? '',
    ].join(' ').toLowerCase().includes(query));
  }, [mapping.entities, search]);
  const visibleRecords = useMemo(() => {
    const query = search.toLowerCase().trim();
    return mapping.records.filter((item) => !query || [
      item.tag, item.description, item.kind, item.sourceText,
      ...Object.values(item.properties),
    ].join(' ').toLowerCase().includes(query));
  }, [mapping.records, search]);
  const reviewedCount = mapping.entities.filter((entity) => entity.reviewStatus === 'reviewed').length;
  const itemCount = mapping.entities.length + mapping.records.length;

  const patchMapping = (mutate: (draft: DrawingMapping) => void) => {
    setMapping((current) => {
      const next = structuredClone(current);
      mutate(next);
      return next;
    });
    setPackageMessage('');
  };

  const pickEntity = (entity: MappedEntity) => {
    setSelectedEntityId(entity.id);
    const record = mapping.records.find((item) => item.graphicalEntityIds.includes(entity.id));
    if (record) setSelectedRecordId(record.id);
  };

  const pickRecord = (record: EngineeringRecord) => {
    setSelectedRecordId(record.id);
    const entity = mapping.entities.find((item) => record.graphicalEntityIds.includes(item.id));
    if (entity) setSelectedEntityId(entity.id);
  };

  const patchEntity = (id: string, updates: Partial<MappedEntity>) => {
    patchMapping((draft) => {
      const entity = draft.entities.find((item) => item.id === id);
      if (entity) Object.assign(entity, updates);
    });
  };

  const patchRecord = (id: string, updates: Partial<EngineeringRecord>) => {
    patchMapping((draft) => {
      const record = draft.records.find((item) => item.id === id);
      if (record) Object.assign(record, updates);
    });
  };

  const markReviewed = () => {
    if (mode === 'records' && selectedRecord) {
      patchRecord(selectedRecord.id, { reviewStatus: 'reviewed' });
      setToast(`${selectedRecord.tag || 'Engineering record'} marked reviewed`);
      return;
    }
    if (selectedEntity) {
      patchEntity(selectedEntity.id, { reviewStatus: 'reviewed' });
      setToast(`${entityDisplayName(selectedEntity)} marked reviewed`);
    }
  };

  const resetExample = () => {
    if (!window.confirm('Reset this browser-local workspace to the synthetic sample? Current edits will be replaced.')) return;
    const fresh = createDemoMapping();
    setCanSaveLocally(true);
    setMapping(fresh);
    setSelectedEntityId(fresh.entities[0]?.id ?? null);
    setSelectedRecordId(fresh.records[0]?.id ?? null);
    setSearch('');
    setMode('entities');
    setZoom(100);
    setPackageMessage('');
    setToast('Synthetic example restored');
  };

  const downloadPackage = async () => {
    setIsPackaging(true);
    try {
      const blob = await buildAutoCadPackage(mapping);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${mapping.drawing.name.replace(/[^a-z0-9-_]+/gi, '-')}-review-package.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPackageMessage('Package prepared · not run in AutoCAD');
    } catch (error) {
      setPackageMessage(
        error instanceof Error
          ? error.message
          : 'Package could not be prepared. Your local mapping is unchanged.',
      );
    } finally {
      setIsPackaging(false);
    }
  };

  const activeStatus = mode === 'records' ? selectedRecord?.reviewStatus : selectedEntity?.reviewStatus;

  return (
    <div className="studio-shell">
      <aside className="rail" aria-label="Workspace navigation">
        <Link href="/" className="brand-mark" aria-label="Return to discipline selection" data-testid="link-home"><span>PM</span></Link>
        <div className="rail-rule" />
        <button className="rail-icon active" title="Mapping workspace" aria-label="Mapping workspace" data-testid="nav-mapping">
          <PanelLeft size={17} />
        </button>
        <button className="rail-icon" title="Review status" aria-label="Review status" onClick={() => setMode('records')} data-testid="nav-review">
          <ClipboardCheck size={17} />
        </button>
        <button className={`rail-icon ${showLayers ? 'active' : ''}`} title="Show or hide mapped layers" aria-label="Show or hide mapped layers" aria-pressed={showLayers} onClick={() => setShowLayers((value) => !value)} data-testid="nav-layers">
          <Layers size={17} />
        </button>
        <div style={{ flex: 1 }} />
        <button className="rail-icon" title="Reset sample" aria-label="Reset sample" onClick={resetExample} data-testid="button-reset-rail">
          <RotateCcw size={16} />
        </button>
      </aside>

      <main className="studio-main">
        <header className="topbar">
          <div className="crumb"><strong>Mapping Studio</strong><span> / </span>{mapping.drawing.name}</div>
          <div className="top-actions">
            <div className="local-chip"><span className="local-dot" />Browser-local · not shared</div>
            <Link href="/" className="btn subtle" data-testid="link-discipline-selection"><ArrowLeft size={13} /> Disciplines</Link>
            <button className="btn subtle" onClick={resetExample} data-testid="button-reset-example">
              <RotateCcw size={13} /> Reset example
            </button>
            <button className="btn primary" onClick={downloadPackage} disabled={isPackaging} data-testid="button-download-package">
              <FileDown size={14} /> {isPackaging ? 'Preparing…' : 'Download package'}
            </button>
          </div>
        </header>

        <div className="page-wrap">
          <div className="page-heading">
            <div>
              <div className="eyebrow">Engineering review workspace · synthetic example</div>
              <h1>{mapping.drawing.name}</h1>
              <p className="heading-sub">Review graphical mappings against separate engineering records. Nothing is guessed or sent elsewhere.</p>
            </div>
            <div className="revision-chip">{mapping.drawing.revision} <span aria-hidden="true">·</span> {mapping.drawing.units} <span aria-hidden="true">·</span> {mapping.drawing.mappingStatus}</div>
          </div>

          <div className="warning-banner" data-testid="warning-synthetic-data">
            <AlertTriangle size={16} />
            <div><strong>Synthetic, unverified example.</strong> The sample, symbols, and layers are synthetic/unverified. AutoCAD did not run and no DWG was verified. Company layer and block names require human confirmation.</div>
          </div>
          {storageNotice && (
            <div className="storage-banner" role="alert" data-testid="status-storage">
              <AlertTriangle size={15} />
              <span><strong>Browser-local storage needs attention.</strong> {storageNotice} Reset the synthetic example to replace saved browser data.</span>
            </div>
          )}

          <div className="workspace-grid">
            <section className="panel object-panel" aria-label="Mapped objects and engineering records">
              <div className="panel-head">
                <div className="panel-title"><ListFilter size={15} /> Review items</div>
                <span className="count" data-testid="text-item-count">{itemCount}</span>
              </div>
              <div className="search-wrap">
                <Search size={14} />
                <input className="search-input" aria-label="Search mappings and records" placeholder="Search tag, layer, description…" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-items" />
              </div>
              <div className="tabs" role="tablist" aria-label="Review item type">
                <button role="tab" aria-selected={mode === 'entities'} className={`tab ${mode === 'entities' ? 'active' : ''}`} onClick={() => setMode('entities')} data-testid="tab-entities">
                  Drawing entities <span className="count">{mapping.entities.length}</span>
                </button>
                <button role="tab" aria-selected={mode === 'records'} className={`tab ${mode === 'records' ? 'active' : ''}`} onClick={() => setMode('records')} data-testid="tab-records">
                  Records <span className="count">{mapping.records.length}</span>
                </button>
              </div>
              {mode === 'entities' ? (
                <div className="object-list">
                  {visibleEntities.map((entity) => (
                    <button key={entity.id} className={`object-row ${selectedEntity?.id === entity.id ? 'selected' : ''}`} onClick={() => pickEntity(entity)} data-testid={`entity-row-${entity.id}`}>
                      <span className="object-glyph"><EntityGlyph kind={entity.kind} /></span>
                      <span className="object-copy">
                        <span className="object-tag">{entityDisplayName(entity)}</span>
                        <span className="object-sub">{formatKind(entity.kind)} · {entity.layerId}</span>
                      </span>
                      <span className={`status-dot ${entity.reviewStatus}`} title={statusLabel[entity.reviewStatus]} />
                    </button>
                  ))}
                  {!visibleEntities.length && <div className="empty-state"><Search size={18} /><div>No drawing entities match this search.</div></div>}
                </div>
              ) : (
                <div className="object-list">
                  {visibleRecords.map((record) => (
                    <button key={record.id} className={`object-row ${selectedRecord?.id === record.id ? 'selected' : ''}`} onClick={() => pickRecord(record)} data-testid={`record-row-${record.id}`}>
                      <span className="object-glyph"><ClipboardCheck size={15} /></span>
                      <span className="object-copy">
                        <span className="object-tag">{record.tag || 'Untitled record'}</span>
                        <span className="object-sub">{formatKind(record.kind)} · {record.graphicalEntityIds.length} linked graphic{record.graphicalEntityIds.length === 1 ? '' : 's'}</span>
                      </span>
                      <span className={`status-dot ${record.reviewStatus}`} title={statusLabel[record.reviewStatus]} />
                    </button>
                  ))}
                  {!visibleRecords.length && <div className="empty-state"><Search size={18} /><div>No engineering records match this search.</div></div>}
                </div>
              )}
              <div className="list-foot"><span className="status-dot reviewed" /> {reviewedCount} of {mapping.entities.length} graphics reviewed <span style={{ float: 'right' }}>Saved in this browser</span></div>
            </section>

            <section className="panel canvas-panel" aria-label="Synthetic P and ID drawing canvas">
              <div className="panel-head">
                <div className="canvas-head-left"><div className="panel-title">Drawing view <span className="panel-kicker">Schematic · synthetic</span></div></div>
                <button className="btn subtle" onClick={() => { setSelectedEntityId(null); setSelectedRecordId(null); }} data-testid="button-clear-selection">
                  Clear selection
                </button>
              </div>
              <div className="canvas-toolbar">
                <div className="tool-set">
                  <button className={`tool-btn ${canvasMode === 'select' ? 'selected' : ''}`} title="Select entities" aria-label="Select entities" onClick={() => setCanvasMode('select')} data-testid="tool-select"><MousePointer2 size={15} /></button>
                  <button className={`tool-btn ${canvasMode === 'pan' ? 'selected' : ''}`} title="Pan drawing" aria-label="Pan drawing" onClick={() => setCanvasMode('pan')} data-testid="tool-pan"><Hand size={15} /></button>
                  <span style={{ width: 1, height: 19, background: '#dfe3dc', margin: '0 3px' }} />
                  <button className="tool-btn" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(60, value - 10))} data-testid="tool-zoom-out"><ZoomOut size={15} /></button>
                  <button className="tool-btn" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(150, value + 10))} data-testid="tool-zoom-in"><ZoomIn size={15} /></button>
                  <button className="tool-btn" title="Fit drawing" aria-label="Fit drawing" onClick={() => { setZoom(100); setFitRequest((value) => value + 1); }} data-testid="tool-fit"><SlidersHorizontal size={14} /></button>
                </div>
                <span className="canvas-scale" data-testid="text-zoom">{zoom}%</span>
              </div>
              <div className="canvas-body">
                <PidCanvas
                  mapping={mapping}
                  selectedId={selectedEntity?.id ?? null}
                  onSelect={pickEntity}
                  zoom={zoom}
                  fitRequest={fitRequest}
                  showLayers={showLayers}
                  panMode={canvasMode === 'pan'}
                />
              </div>
              <div className="canvas-foot">
                <span><i className="legend-line" /> Process line</span>
                <span><CircleDot size={13} /> Instrument / equipment symbol</span>
                <span><span className="status-dot" /> Needs human review</span>
              </div>
            </section>

            <section className="panel detail-panel" aria-label="Selected item details">
              <div className="panel-head">
                <div className="panel-title"><Settings2 size={15} /> {mode === 'records' ? 'Engineering record' : 'Selected mapping'}</div>
                {activeStatus && <span className={`status-pill ${activeStatus}`}><span className={`status-dot ${activeStatus}`} />{statusLabel[activeStatus]}</span>}
              </div>
              {selectedEntity && !(mode === 'records' && selectedRecord) ? (
                <>
                  <div className="detail-content">
                    <div className="detail-kicker">Graphical entity · {formatKind(selectedEntity.kind)}</div>
                    <div className="detail-tag">{entityDisplayName(selectedEntity)}</div>
                    <div className="detail-type">Graphic identity is separate from the linked record.</div>
                    <label className="field">
                      <span className="field-label">Tag / identifier</span>
                      <input className="field-input mono" value={selectedEntity.tag} onChange={(event) => patchEntity(selectedEntity.id, { tag: event.target.value })} data-testid="input-entity-tag" />
                    </label>
                    <label className="field">
                      <span className="field-label">Drawing label</span>
                      <input className="field-input" value={selectedEntity.label} onChange={(event) => patchEntity(selectedEntity.id, { label: event.target.value })} data-testid="input-entity-label" />
                    </label>
                    <label className="field">
                      <span className="field-label">Mapped layer</span>
                      <select className="field-select" value={selectedEntity.layerId} onChange={(event) => patchEntity(selectedEntity.id, { layerId: event.target.value })} data-testid="select-entity-layer">
                        {mapping.layers.map((layer) => <option value={layer.id} key={layer.id}>{layer.name}{layer.verified ? '' : ' · unverified'}</option>)}
                        {!mapping.layers.some((layer) => layer.id === selectedEntity.layerId) && <option value={selectedEntity.layerId}>{selectedEntity.layerId}</option>}
                      </select>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                      <label className="field">
                        <span className="field-label">Scale</span>
                        <input className="field-input mono" type="number" min="0.01" step="0.1" value={selectedEntity.scale} onChange={(event) => patchEntity(selectedEntity.id, { scale: Number(event.target.value) || 1 })} data-testid="input-entity-scale" />
                      </label>
                      <label className="field">
                        <span className="field-label">Rotation °</span>
                        <input className="field-input mono" type="number" step="1" value={selectedEntity.rotation} onChange={(event) => patchEntity(selectedEntity.id, { rotation: Number(event.target.value) || 0 })} data-testid="input-entity-rotation" />
                      </label>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                      <label className="field">
                        <span className="field-label">Placement X</span>
                        <input className="field-input mono" type="number" step="0.1" value={selectedEntity.geometry.x} onChange={(event) => patchEntity(selectedEntity.id, { geometry: { ...selectedEntity.geometry, x: Number(event.target.value) || 0 } })} data-testid="input-placement-x" />
                      </label>
                      <label className="field">
                        <span className="field-label">Placement Y</span>
                        <input className="field-input mono" type="number" step="0.1" value={selectedEntity.geometry.y} onChange={(event) => patchEntity(selectedEntity.id, { geometry: { ...selectedEntity.geometry, y: Number(event.target.value) || 0 } })} data-testid="input-placement-y" />
                      </label>
                    </div>
                    <button className="btn primary review-action" onClick={markReviewed} disabled={selectedEntity.reviewStatus === 'reviewed'} data-testid="button-mark-reviewed">
                      {selectedEntity.reviewStatus === 'reviewed' ? <><Check size={14} /> Reviewed</> : <><CheckCircle2 size={14} /> Mark mapping reviewed</>}
                    </button>
                  </div>
                  <div className="detail-section">
                    <div className="detail-section-title">Source & placement</div>
                    <div className="meta-row"><span>Region / page</span><span>{selectedEntity.source.region} · p.{selectedEntity.source.page}</span></div>
                    <div className="meta-row"><span>Confidence</span><span>{selectedEntity.source.confidence}</span></div>
                    <div className="meta-row"><span>Block reference</span><span>{selectedEntity.blockName || 'Native geometry'}</span></div>
                    <div className="meta-row"><span>Placement</span><span>{selectedEntity.geometry.x}, {selectedEntity.geometry.y}</span></div>
                    <label className="field">
                      <span className="field-label">Source text</span>
                      <textarea className="field-textarea" value={selectedEntity.source.rawText} onChange={(event) => patchEntity(selectedEntity.id, { source: { ...selectedEntity.source, rawText: event.target.value } })} data-testid="input-entity-source-text" />
                    </label>
                    {!selectedEntity.blockName && <div className="linked-row"><Info size={13} /> Native geometry; no company block verified.</div>}
                  </div>
                  <div className="detail-section">
                    <div className="detail-section-title">Linked engineering record</div>
                    {selectedRecord ? (
                      <>
                        <div className="linked-row"><Tag size={13} /><span><strong>{selectedRecord.tag}</strong> · independent record ID</span></div>
                        <label className="field">
                          <span className="field-label">Record description</span>
                          <textarea className="field-textarea" value={selectedRecord.description} onChange={(event) => patchRecord(selectedRecord.id, { description: event.target.value })} data-testid="input-record-description" />
                        </label>
                        <label className="field">
                          <span className="field-label">Record source text</span>
                          <textarea className="field-textarea" value={selectedRecord.sourceText} onChange={(event) => patchRecord(selectedRecord.id, { sourceText: event.target.value })} data-testid="input-record-source-text" />
                        </label>
                        <div className="meta-row"><span>Record ID</span><span>{selectedRecord.id}</span></div>
                        <div className="meta-row"><span>Graphic links</span><span>{selectedRecord.graphicalEntityIds.length}</span></div>
                      </>
                    ) : <div className="linked-row"><Info size={13} /> No linked record. Linkage is never inferred from visual proximity.</div>}
                  </div>
                </>
              ) : selectedRecord ? (
                <div className="detail-content">
                  <div className="detail-kicker">Independent record · {formatKind(selectedRecord.kind)}</div>
                  <div className="detail-tag">{selectedRecord.tag || 'Untitled record'}</div>
                  <div className="detail-type">Engineering data remains distinct from its drawing graphics.</div>
                  <label className="field"><span className="field-label">Record tag</span><input className="field-input mono" value={selectedRecord.tag} onChange={(event) => patchRecord(selectedRecord.id, { tag: event.target.value })} data-testid="input-record-tag" /></label>
                  <label className="field"><span className="field-label">Description</span><textarea className="field-textarea" value={selectedRecord.description} onChange={(event) => patchRecord(selectedRecord.id, { description: event.target.value })} data-testid="input-record-description" /></label>
                  <label className="field"><span className="field-label">Source text</span><textarea className="field-textarea" value={selectedRecord.sourceText} onChange={(event) => patchRecord(selectedRecord.id, { sourceText: event.target.value })} data-testid="input-record-source-text" /></label>
                  <div className="detail-section" style={{ padding: '13px 0', marginTop: 14 }}>
                    <div className="detail-section-title">Record properties</div>
                    {Object.entries(selectedRecord.properties).map(([key, value]) => (
                      <label className="field" key={key}><span className="field-label">{key}</span><input className="field-input" value={value} onChange={(event) => patchRecord(selectedRecord.id, { properties: { ...selectedRecord.properties, [key]: event.target.value } })} data-testid={`input-record-property-${key}`} /></label>
                    ))}
                    <div className="meta-row"><span>Stable record ID</span><span>{selectedRecord.id}</span></div>
                    <div className="meta-row"><span>Source region / page</span><span>{selectedRecord.sourceRegion} · p.{selectedRecord.sourcePage}</span></div>
                    <div className="meta-row"><span>Linked graphic IDs</span><span>{selectedRecord.graphicalEntityIds.length ? selectedRecord.graphicalEntityIds.join(', ') : 'None'}</span></div>
                  </div>
                  <button className="btn primary review-action" onClick={markReviewed} disabled={selectedRecord.reviewStatus === 'reviewed'} data-testid="button-mark-reviewed">
                    {selectedRecord.reviewStatus === 'reviewed' ? <><Check size={14} /> Reviewed</> : <><CheckCircle2 size={14} /> Mark record reviewed</>}
                  </button>
                </div>
              ) : (
                <div className="empty-state"><MousePointer2 size={19} /><div>Select a drawing entity or record to inspect its mapping.</div></div>
              )}
            </section>
          </div>

          <section className="warning-section" aria-label="Company asset verification warnings">
            <div className="panel-head">
              <div className="panel-title"><ShieldAlert size={15} /> Company-asset verification <span className="count">{mapping.unresolvedItems.length + mapping.layers.filter((layer) => !layer.verified).length}</span></div>
              <span className="panel-kicker">Human review required</span>
            </div>
            {mapping.layers.filter((layer) => !layer.verified).map((layer) => (
              <div className="warning-item" key={layer.id} data-testid={`warning-layer-${layer.id}`}>
                <AlertTriangle size={14} />
                <div className="warning-copy"><div className="warning-title">Layer “{layer.name}” is unverified</div><div className="warning-detail">{layer.verificationNote || 'Company layer mapping has not been verified. Confirm against approved drafting standards.'}</div></div>
              </div>
            ))}
            {mapping.unresolvedItems.map((item) => (
              <div className="warning-item" key={item.id} data-testid={`warning-item-${item.id}`}>
                {item.severity === 'blocked' ? <LockKeyhole size={14} /> : <AlertTriangle size={14} />}
                <div className="warning-copy"><div className="warning-title">{item.title}</div><div className="warning-detail">{item.detail}</div></div>
              </div>
            ))}
            {!mapping.unresolvedItems.length && !mapping.layers.some((layer) => !layer.verified) && <div className="warning-item"><CheckCircle2 size={14} /><div className="warning-copy"><div className="warning-title">No unresolved company assets</div></div></div>}
          </section>

          <div className="bottom-strip">
            <div className="bottom-note"><Info size={15} /><span><strong>Review before use.</strong> This sample, its symbols, and layers are synthetic and unverified. Relationship links are explicitly recorded, not inferred from visual proximity. AutoCAD did not run and no DWG was verified.</span></div>
            <div>
              {packageMessage && <span className="package-status" role="status" data-testid="status-package">{packageMessage}</span>}
              <button className="btn" onClick={downloadPackage} disabled={isPackaging} data-testid="button-download-package-footer"><ArrowDownToLine size={13} /> {isPackaging ? 'Preparing…' : 'Download review package'}</button>
            </div>
          </div>
        </div>
      </main>
      {toast && <div className="toast-msg" role="status" data-testid="status-toast">{toast}</div>}
    </div>
  );
}

function CadStandardsLibraryRoute() {
  const [initial] = useState(() => {
    try {
      return { library: loadCadStandardsLibrary(), canSave: true, error: '' };
    } catch (error) {
      return {
        library: createCadStandardsLibrarySeed(),
        canSave: false,
        error: error instanceof Error ? error.message : 'The local standards library could not be loaded.',
      };
    }
  });
  const [library, setLibrary] = useState<CadStandardsLibrary>(initial.library);
  const libraryRef = useRef(initial.library);
  const [canSave, setCanSave] = useState(initial.canSave);
  const [storageNotice, setStorageNotice] = useState(initial.error);

  const commit = (mutate: (current: CadStandardsLibrary) => CadStandardsLibrary) => {
    if (!canSave) {
      setStorageNotice('The local library could not be read safely. Its saved contents were left unchanged.');
      return;
    }
    try {
      const next = mutate(libraryRef.current);
      saveCadStandardsLibrary(next);
      libraryRef.current = next;
      setLibrary(next);
      setStorageNotice('');
    } catch (error) {
      setCanSave(false);
      setStorageNotice(error instanceof Error ? error.message : 'The standards change could not be saved locally.');
    }
  };

  const approveCompany = (candidateId: string, additionalFields?: { label: string; value: string }[]) =>
    commit((current) => approveCadReviewCandidate(current, candidateId, 'company', additionalFields));
  const approveProject = (candidateId: string, additionalFields?: { label: string; value: string }[]) =>
    commit((current) => approveCadReviewCandidate(current, candidateId, 'project', additionalFields));
  const dismiss = (candidateId: string) =>
    commit((current) => dismissCadReviewCandidate(current, candidateId));
  const setCompanyDefault = (purpose: CadPurpose, size: CadSheetSize) =>
    commit((current) => setCompanyCadDefault(current, purpose, size));
  const setProjectDefault = (projectId: string, purpose: CadPurpose, size: CadSheetSize) => {
    const projectName = libraryRef.current.projects[projectId]?.projectName
      ?? `Project ${String(Object.keys(libraryRef.current.projects).sort().indexOf(projectId) + 1).padStart(2, '0')}`;
    commit((current) => saveProjectCadDefault(current, projectId, projectName, purpose, size));
  };

  return (
    <StandardsLibraryPage
      library={library}
      reviewCandidates={library.reviewCandidates}
      onApproveCompany={approveCompany}
      onApproveProject={approveProject}
      onDismiss={dismiss}
      onSetCompanyDefault={setCompanyDefault}
      onSetProjectDefault={setProjectDefault}
      storageNotice={storageNotice}
      readOnly={!canSave}
    />
  );
}

function EntityGlyph({ kind }: { kind: EntityKind }) {
  if (kind === 'equipment') return <CircleDot size={15} />;
  if (kind === 'line') return <GitBranch size={15} />;
  if (kind === 'instrument') return <Gauge size={15} />;
  if (kind === 'valve') return <ChevronDown size={15} />;
  return <Tag size={14} />;
}

function PidCanvas({
  mapping, selectedId, onSelect, zoom, fitRequest, showLayers, panMode,
}: {
  mapping: DrawingMapping;
  selectedId: string | null;
  onSelect: (entity: MappedEntity) => void;
  zoom: number;
  fitRequest: number;
  showLayers: boolean;
  panMode: boolean;
}) {
  const pan = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => setOffset({ x: 0, y: 0 }), [fitRequest]);
  const select = (entity: MappedEntity) => {
    if (!panMode) onSelect(entity);
  };
  const startPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!panMode) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
  };
  const movePan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!panMode || pan.current.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setOffset({
      x: pan.current.offsetX + ((event.clientX - pan.current.startX) * 1000) / bounds.width,
      y: pan.current.offsetY + ((event.clientY - pan.current.startY) * 620) / bounds.height,
    });
  };
  const endPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (pan.current.pointerId !== event.pointerId) return;
    pan.current.pointerId = -1;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <svg
      className={`canvas-svg ${panMode ? 'pan-mode' : ''}`}
      viewBox="0 0 1000 620"
      role="group"
      aria-label="Synthetic process and instrumentation diagram showing editable mapped objects"
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      data-testid="canvas-pid-diagram"
    >
      <g transform={`translate(${500 + offset.x} ${310 + offset.y}) scale(${zoom / 100}) translate(-500 -310)`}>
        <text x="36" y="35" className="drawing-stamp">{mapping.drawing.name}</text>
        <text x="962" y="35" textAnchor="end" className="drawing-stamp">SYNTHETIC · UNVERIFIED</text>
        <path d="M44 570 H956 M54 56 V566 M946 56 V566" stroke="#dce1d9" strokeWidth="1" strokeDasharray="3 6" />
        {showLayers ? mapping.entities.map((entity) => (
          <MappedGraphic
            key={entity.id}
            entity={entity}
            mapping={mapping}
            selected={selectedId === entity.id}
            panMode={panMode}
            onSelect={() => select(entity)}
          />
        )) : (
          <text x="500" y="300" textAnchor="middle" className="drawing-stamp">MAPPED LAYERS HIDDEN</text>
        )}
        <g transform="translate(72 550)">
          <path d="M0 0 H40 M0 0 V-34" stroke="#82958c" strokeWidth="1.2" />
          <path d="M36 -3 L40 0 L36 3 M-3 -30 L0 -34 L3 -30" fill="none" stroke="#82958c" strokeWidth="1" />
          <text x="45" y="4" className="drawing-stamp">X</text>
          <text x="-2" y="-40" className="drawing-stamp">Y</text>
        </g>
        <text x="925" y="550" textAnchor="end" className="drawing-stamp">
          {panMode ? 'DRAG TO PAN' : 'SELECT OBJECT TO INSPECT'}
        </text>
      </g>
    </svg>
  );
}

function MappedGraphic({
  entity,
  mapping,
  selected,
  panMode,
  onSelect,
}: {
  entity: MappedEntity;
  mapping: DrawingMapping;
  selected: boolean;
  panMode: boolean;
  onSelect: () => void;
}) {
  const geometry = entity.geometry;
  const transform = mapping.drawing.coordinateTransform;
  const factor = transform.scale * entity.scale;
  const ySign = transform.yAxis === 'up' ? 1 : -1;
  const angle = (entity.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const matrixA = factor * cos;
  const matrixB = -ySign * factor * sin;
  const matrixC = -factor * sin;
  const matrixD = -ySign * factor * cos;
  const originX = transform.origin.x;
  const originY = transform.origin.y;
  const screenX = originX + transform.scale * geometry.x;
  const screenY = 620 - originY - ySign * transform.scale * geometry.y;
  const matrix = `matrix(${matrixA} ${matrixB} ${matrixC} ${matrixD} ${screenX} ${screenY})`;
  const layerColor = mapping.layers.find((layer) => layer.id === entity.layerId)?.color ?? '#5a7770';
  const shapeClass = `entity-shape${selected ? ' selected' : ''}`;
  const labelClass = `canvas-object-label${selected ? ' selected' : ''}`;
  const width = Math.max(16, geometry.width);
  const height = Math.max(16, geometry.height);

  const activate = (event: React.KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <g
      className={`entity-hit${panMode ? ' pan-hit' : ''}`}
      transform={matrix}
      onClick={onSelect}
      onKeyDown={activate}
      role="button"
      tabIndex={panMode ? -1 : 0}
      aria-label={`${entity.kind}: ${entity.tag || entity.label}`}
      data-testid={`canvas-entity-${entity.id}`}
    >
      {entity.kind === 'line' && (
        <g>
          <polyline
            points={geometry.points.map((point) => `${point.x},${point.y}`).join(' ')}
            stroke="transparent"
            strokeWidth="18"
            fill="none"
          />
          <polyline
            points={geometry.points.map((point) => `${point.x},${point.y}`).join(' ')}
            stroke={selected ? '#c9812e' : layerColor}
            strokeWidth={selected ? '3.3' : '2.5'}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
      {geometry.kind === 'pump' && (
        <g>
          <circle r={Math.min(width, height) * 0.32} className={shapeClass} style={{ stroke: layerColor }} />
          <path
            d={`M${-width * 0.19} ${-height * 0.2} L${width * 0.2} 0 L${-width * 0.19} ${height * 0.2} Z`}
            fill="none"
            stroke={selected ? '#c9812e' : layerColor}
            strokeWidth="2.2"
            vectorEffect="non-scaling-stroke"
          />
          <path d={`M${-width * 0.4} ${height * 0.44} H${width * 0.4}`} stroke={layerColor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d={`M${-width * 0.3} ${height * 0.36} V${height * 0.44} M${width * 0.3} ${height * 0.36} V${height * 0.44}`} stroke={layerColor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </g>
      )}
      {geometry.kind === 'valve' && (
        <g>
          <path
            d={`M${-width * 0.42} ${-height * 0.27} L0 0 L${-width * 0.42} ${height * 0.27} Z M${width * 0.42} ${-height * 0.27} L0 0 L${width * 0.42} ${height * 0.27} Z`}
            className={shapeClass}
            style={{ stroke: layerColor }}
          />
          <path d={`M0 0 V${-height * 0.42} M${-width * 0.15} ${-height * 0.42} H${width * 0.15}`} fill="none" stroke={layerColor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </g>
      )}
      {geometry.kind === 'instrument' && (
        <g>
          <circle r={Math.min(width, height) * 0.39} className={`instrument-bubble${selected ? ' selected' : ''}`} style={{ stroke: layerColor }} />
          <text className="instrument-code" textAnchor="middle" y="4" transform="scale(1 -1)">PI</text>
        </g>
      )}
      {geometry.kind === 'text' && (
        <g>
          <rect
            x={-width / 2}
            y={-height / 2}
            width={width}
            height={height}
            className={selected ? 'label-highlight' : 'label-hit'}
            pointerEvents="all"
          />
          <text
            className={labelClass}
            textAnchor="middle"
            y="4"
            transform="scale(1 -1)"
            style={{ fill: selected ? '#87581f' : layerColor, fontSize: `${height}px` }}
          >
            {entity.label || entity.tag}
          </text>
        </g>
      )}
    </g>
  );
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const singleComputerMode = import.meta.env.VITE_SINGLE_COMPUTER_MODE === 'true';
const clerkPubKey = singleComputerMode
  ? undefined
  : publishableKeyFromHost(
      window.location.hostname,
      import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    );
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey && !singleComputerMode) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY for secure sign-in.');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#0f766e',
    colorForeground: '#152a28',
    colorMutedForeground: '#5b6d68',
    colorDanger: '#b42318',
    colorBackground: '#ffffff',
    colorInput: '#ffffff',
    colorInputForeground: '#152a28',
    colorNeutral: '#cbd5d1',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    borderRadius: '0.75rem',
  },
};

function AuthPages({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { isLoaded, isSignedIn } = useAuth();
  const signInPath = `${basePath}/sign-in`;
  const signUpPath = `${basePath}/sign-up`;
  const portalPath = `${basePath}/portal`;

  if (!isLoaded) {
    return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm font-semibold text-slate-600">Loading secure sign-in…</div>;
  }
  if (isSignedIn) return <Redirect to="/portal" />;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f7f7] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
        <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-teal-800">
          <ArrowLeft size={16} /> Back to workspace
        </Link>
        <div className="mb-6">
          <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-teal-800 text-white">
            <LockKeyhole size={20} />
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-800">Private company access</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {mode === 'sign-up' ? 'Create your account' : 'Sign in'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Only an approved company admin can open private standards.
          </p>
        </div>
        {mode === 'sign-up' ? (
          <SignUp
            routing="path"
            path={signUpPath}
            signInUrl={signInPath}
            fallbackRedirectUrl={portalPath}
          />
        ) : (
          <SignIn
            routing="path"
            path={signInPath}
            signUpUrl={signUpPath}
            fallbackRedirectUrl={portalPath}
          />
        )}
        <p className="mt-6 text-center text-xs text-slate-400">© 2026 gaurav.cbiindia</p>
      </div>
    </main>
  );
}

function HomePage() {
  const { isSignedIn } = useAuth();
  return (
    <>
      <div className="app-auth-actions fixed right-4 top-4 z-50 flex items-center gap-2">
        {isSignedIn ? (
          <>
            <Link
              href="/admin/library"
              className="app-auth-action inline-flex min-h-10 items-center gap-2 rounded-xl border border-teal-900/10 bg-white/95 px-3.5 text-sm font-bold text-teal-900 shadow-lg shadow-slate-900/10 backdrop-blur hover:bg-teal-50"
            >
              <ShieldCheck size={16} /> Admin library
            </Link>
            <UserButton />
          </>
        ) : (
          <Link
            href="/sign-in"
            className="app-auth-action inline-flex min-h-10 items-center gap-2 rounded-xl border border-teal-900/10 bg-white/95 px-3.5 text-sm font-bold text-teal-900 shadow-lg shadow-slate-900/10 backdrop-blur hover:bg-teal-50"
          >
            <LockKeyhole size={15} /> Admin sign in
          </Link>
        )}
      </div>
      <DisciplineChooser showLocalChip={false} />
    </>
  );
}

function AppMainRoutes() {
  const [location] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  if (location === '/admin/library') {
    if (!isLoaded) return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-600">Loading secure workspace…</div>;
    if (!isSignedIn) return <Redirect to="/sign-in" />;
    return <AdminLibraryPage />;
  }
  if (location === '/review') return <WorkspaceNotFound />;
  if (location === '/library') return <HomePage />;
  if (location === '/workspace/pfd') return <DisciplineWorkspace discipline="pfd" />;
  if (location === '/workspace/pid') return <DisciplineWorkspace discipline="pid" />;
  if (location === '/workspace/pfd/engineering-data') return <EngineeringDataManager key="pfd" discipline="pfd" />;
  if (location === '/workspace/pid/engineering-data') return <EngineeringDataManager key="pid" discipline="pid" />;
  if (location === '/portal') {
    if (!isLoaded) return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-600">Loading your workspace…</div>;
    return isSignedIn ? <HomePage /> : <Redirect to="/" />;
  }
  if (location === '/') {
    return isLoaded && isSignedIn ? <Redirect to="/portal" /> : <HomePage />;
  }
  return <WorkspaceNotFound />;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={() => <AuthPages mode="sign-in" />} />
      <Route path="/sign-up/*?" component={() => <AuthPages mode="sign-up" />} />
      <Route component={AppMainRoutes} />
    </Switch>
  );
}

function SingleComputerRoutes() {
  const [location] = useLocation();

  if (location === '/admin/library' || location.startsWith('/sign-in') || location.startsWith('/sign-up')) {
    return <Redirect to="/" />;
  }
  if (location === '/portal' || location === '/library' || location === '/') {
    return <DisciplineChooser />;
  }
  if (location === '/workspace/pfd') return <DisciplineWorkspace discipline="pfd" />;
  if (location === '/workspace/pid') return <DisciplineWorkspace discipline="pid" />;
  if (location === '/workspace/pfd/engineering-data') {
    return <EngineeringDataManager discipline="pfd" />;
  }
  if (location === '/workspace/pid/engineering-data') {
    return <EngineeringDataManager discipline="pid" />;
  }
  return <WorkspaceNotFound />;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in with your company account.' } },
        signUp: { start: { title: 'Create your account', subtitle: 'Use your company email address.' } },
      }}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(path) => setLocation(stripBase(path))}
      routerReplace={(path) => setLocation(stripBase(path), { replace: true })}
    >
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    </ClerkProvider>
  );
}

function App() {
  return (
    <Router base={basePath}>
      {singleComputerMode ? (
        <ErrorBoundary>
          <SingleComputerRoutes />
        </ErrorBoundary>
      ) : (
        <ClerkProviderWithRoutes />
      )}
    </Router>
  );
}

export default App;
