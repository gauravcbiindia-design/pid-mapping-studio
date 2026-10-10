import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, Check, CheckCircle2, ChevronDown, FileCheck2,
  HardDrive, Layers3, Search, ShieldCheck, SlidersHorizontal,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  CAD_PURPOSES, CAD_SHEET_SIZES,
} from '@/lib/cad-standards';
import type {
  CadPurpose, CadReviewCandidate, CadSheetSize, CadStandardCategory, CadStandardsLibrary,
} from '@/lib/cad-standards';
import './standards-library-page.css';

type Props = {
  library: CadStandardsLibrary;
  reviewCandidates: CadReviewCandidate[];
  onApproveCompany(candidateId: string): void;
  onApproveProject(candidateId: string): void;
  onDismiss(candidateId: string): void;
  onSetCompanyDefault(purpose: CadPurpose, size: CadSheetSize): void;
  onSetProjectDefault(projectId: string, purpose: CadPurpose, size: CadSheetSize): void;
  storageNotice?: string;
  readOnly?: boolean;
};

type LibraryTab = 'company' | 'projects';

const categoryNames: Record<CadStandardCategory, string> = {
  titleBlock: 'Title block',
  layer: 'Layer',
  textStyle: 'Text style',
  linetype: 'Linetype',
  dimensionStyle: 'Dimension style',
  symbol: 'Symbol',
  legend: 'Legend',
};

function categoryAlias(category: CadStandardCategory) {
  return categoryNames[category] ?? 'CAD standard';
}

function sourceAlias(candidate: CadReviewCandidate, candidates: CadReviewCandidate[]) {
  if (candidate.proposedScope === 'project' && candidate.projectId) {
    const projectIds = [...new Set(candidates
      .filter((item) => item.proposedScope === 'project' && item.projectId)
      .map((item) => item.projectId as string))].sort();
    return `Project ${String(projectIds.indexOf(candidate.projectId) + 1).padStart(2, '0')}`;
  }
  if (candidate.proposedScope === 'company') {
    const groups = [...new Set(candidates
      .filter((item) => item.proposedScope === 'company')
      .map((item) => item.sourceGroup))].sort();
    return `Company source ${String(groups.indexOf(candidate.sourceGroup) + 1).padStart(2, '0')}`;
  }
  return 'Unclassified source';
}

function projectAlias(projectId: string, projectIds: string[]) {
  return `Project ${String(projectIds.indexOf(projectId) + 1).padStart(2, '0')}`;
}

export default function StandardsLibraryPage({
  library, reviewCandidates, onApproveCompany, onApproveProject, onDismiss,
  onSetCompanyDefault, onSetProjectDefault, storageNotice = '', readOnly = false,
}: Props) {
  const [tab, setTab] = useState<LibraryTab>('company');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CadStandardCategory | 'all'>('all');
  const [activeProjectId, setActiveProjectId] = useState('');
  const [candidatePage, setCandidatePage] = useState(0);
  const [actionMessage, setActionMessage] = useState('');
  const pageSize = 20;
  const projectIds = useMemo(() => Object.keys(library.projects).sort(), [library.projects]);
  const selectedProjectId = projectIds.includes(activeProjectId) ? activeProjectId : (projectIds[0] ?? '');
  const pending = reviewCandidates.filter((candidate) => candidate.status === 'needs-review');
  const approvedCount = reviewCandidates.filter((candidate) => candidate.status === 'approved').length;
  const dismissedCount = reviewCandidates.filter((candidate) => candidate.status === 'dismissed').length;

  const filteredCandidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pending.filter((candidate) => {
      const categoryMatches = categoryFilter === 'all' || candidate.item.category === categoryFilter;
      const fieldsMatch = candidate.item.fields.some((field) =>
        `${field.label} ${field.value}`.toLowerCase().includes(needle));
      return categoryMatches && (!needle || fieldsMatch || categoryAlias(candidate.item.category).toLowerCase().includes(needle));
    });
  }, [pending, query, categoryFilter]);
  const candidatePageCount = Math.max(1, Math.ceil(filteredCandidates.length / pageSize));
  const safeCandidatePage = Math.min(candidatePage, candidatePageCount - 1);
  const visibleCandidates = filteredCandidates.slice(safeCandidatePage * pageSize, (safeCandidatePage + 1) * pageSize);
  useEffect(() => setCandidatePage(0), [query, categoryFilter]);

  const libraryItems = tab === 'company'
    ? library.companyItems
    : (library.projects[selectedProjectId]?.items ?? []);
  const visibleItems = libraryItems.filter((item) => {
    const needle = query.trim().toLowerCase();
    const categoryMatches = categoryFilter === 'all' || item.category === categoryFilter;
    const fieldsMatch = item.fields.some((field) => `${field.label} ${field.value}`.toLowerCase().includes(needle));
    return categoryMatches && (!needle || fieldsMatch || categoryAlias(item.category).toLowerCase().includes(needle));
  });

  const updateCompanyDefault = (purpose: CadPurpose, size: string) => {
    if (!CAD_SHEET_SIZES.includes(size as CadSheetSize)) return;
    const selectedSize = size as CadSheetSize;
    const hasMapping = library.companyItems.some((item) =>
      item.category === 'titleBlock' &&
      item.reviewStatus === 'reviewed' &&
      (item.sheetSize === selectedSize || item.fields.some((field) =>
        field.label === 'Sheet size' && field.value === selectedSize,
      )),
    );
    if (selectedSize !== library.companyDefaults[purpose] && !hasMapping) {
      setActionMessage(`Approve a company title-block mapping for ${selectedSize} before changing this default.`);
      return;
    }
    setActionMessage('');
    onSetCompanyDefault(purpose, selectedSize);
  };
  const updateProjectDefault = (projectId: string, purpose: CadPurpose, size: string) => {
    if (!CAD_SHEET_SIZES.includes(size as CadSheetSize)) return;
    const selectedSize = size as CadSheetSize;
    const projectItems = library.projects[projectId]?.items ?? [];
    const hasMapping = [...projectItems, ...library.companyItems].some((item) =>
      item.category === 'titleBlock' &&
      item.reviewStatus === 'reviewed' &&
      (item.sheetSize === selectedSize || item.fields.some((field) =>
        field.label === 'Sheet size' && field.value === selectedSize,
      )),
    );
    if (!hasMapping) {
      setActionMessage(`Approve a title-block mapping for ${selectedSize} before saving this project default.`);
      return;
    }
    setActionMessage('');
    onSetProjectDefault(projectId, purpose, selectedSize);
  };

  return (
    <main className="standards-page">
      <header className="standards-topbar">
        <Link href="/" className="standards-brand" data-testid="link-standards-home"><span className="standards-mark">PM</span><span>Mapping Studio<small>Drafting standards / browser-local</small></span></Link>
         <div className="standards-top-meta"><span className="standards-local"><i />{readOnly ? 'Read only · storage issue' : 'Browser-local'}</span><span className="standards-version">LIBRARY · 1.0</span></div>
      </header>

      <div className="standards-content">
        <section className="standards-intro">
          <div>
            <div className="standards-eyebrow">Standards library <span>/</span> human review</div>
            <h1>Drafting standards</h1>
            <p>Inspect source-derived CAD values before they become defaults. Project choices stay separate from company standards.</p>
          </div>
          <div className="standards-local-seal"><HardDrive size={15} /><span>LOCAL ONLY<small>Nothing is uploaded or shared</small></span></div>
        </section>

        <div className="standards-trust-note">
          <ShieldCheck size={16} />
          <span><strong>Review before use.</strong> Source-derived values remain unapproved until you choose a scope. Company/client identifiers and source file names are hidden here.</span>
          <span className="standards-schema">SCHEMA {library.schemaVersion}</span>
        </div>
        {storageNotice && <div className="standards-storage-banner" role="alert">{storageNotice}</div>}

        <section className="standards-metrics" aria-label="Review summary">
          <div className="standards-metric metric-pending"><span className="metric-icon"><AlertTriangle size={16} /></span><span><small>Awaiting review</small><strong>{pending.length.toString().padStart(2, '0')}</strong></span><span className="metric-note">SOURCE MAPPINGS</span></div>
          <div className="standards-metric"><span className="metric-icon"><CheckCircle2 size={16} /></span><span><small>Approved from queue</small><strong>{approvedCount.toString().padStart(2, '0')}</strong></span><span className="metric-note">HUMAN CONFIRMED</span></div>
          <div className="standards-metric"><span className="metric-icon"><Archive size={16} /></span><span><small>Dismissed</small><strong>{dismissedCount.toString().padStart(2, '0')}</strong></span><span className="metric-note">NOT IN LIBRARY</span></div>
        </section>

        <div className="standards-layout">
          <section className="standards-review panel">
            <div className="standards-panel-head">
              <div><span className="standards-kicker">INBOX / SOURCE-DERIVED</span><h2><FileCheck2 size={17} />Review queue</h2></div>
              <span className="standards-count">{pending.length} pending</span>
            </div>
            <div className="standards-controls">
              <label className="standards-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search CAD field values…" aria-label="Search standards" /></label>
              <label className="standards-filter"><SlidersHorizontal size={13} /><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as CadStandardCategory | 'all')}><option value="all">All categories</option>{Object.entries(categoryNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={13} /></label>
            </div>
            <div className="standards-candidate-list">
              {visibleCandidates.map((candidate) => (
                <article className="candidate-card" key={candidate.id} data-testid={`candidate-${candidate.id}`}>
                  <div className="candidate-top">
                    <div className="candidate-category"><span className="candidate-glyph"><Layers3 size={15} /></span><span><strong>{categoryAlias(candidate.item.category)}</strong><small>{sourceAlias(candidate, reviewCandidates)} · {candidate.proposedScope === 'project' ? 'Project proposal' : candidate.proposedScope === 'company' ? 'Company proposal' : 'Scope not classified'}</small></span></div>
                    <span className="candidate-status"><i />Needs review</span>
                  </div>
                  <div className="candidate-fields" aria-label={`${categoryAlias(candidate.item.category)} CAD standard values`}>
                    {candidate.item.fields.map((field, index) => <div className="candidate-field" key={`${field.label}-${index}`}><span>{field.label}</span><strong>{field.value || '—'}</strong></div>)}
                  </div>
                  <div className="candidate-actions">
                     <span className="candidate-scope-note">{candidate.proposedScope === 'project' ? 'Approve into isolated project library' : candidate.proposedScope === 'company' ? 'Approve as company standard' : 'Unclassified source · project-only approval'}</span>
                     {candidate.proposedScope === 'company' ? (
                       <button className="btn primary" onClick={() => onApproveCompany(candidate.id)} disabled={readOnly} data-testid={`button-approve-company-${candidate.id}`}><Check size={14} />Approve company</button>
                     ) : (
                       <button className="btn primary" onClick={() => onApproveProject(candidate.id)} disabled={readOnly} data-testid={`button-approve-project-${candidate.id}`}><Check size={14} />Approve to project</button>
                     )}
                     <button className="btn subtle" onClick={() => onDismiss(candidate.id)} disabled={readOnly} data-testid={`button-dismiss-${candidate.id}`}>Dismiss</button>
                  </div>
                </article>
              ))}
              {!visibleCandidates.length && (
                <div className="standards-empty">
                  <span className="empty-seal">{pending.length ? <Search size={20} /> : <CheckCircle2 size={20} />}</span>
                  <strong>{pending.length ? 'No source mappings match' : 'Review queue is clear'}</strong>
                  <p>{pending.length ? 'Try another field value or category.' : 'New source-derived standards will appear here for human review.'}</p>
                  {query || categoryFilter !== 'all' ? <button className="btn subtle" onClick={() => { setQuery(''); setCategoryFilter('all'); }}>Clear filters</button> : null}
                </div>
              )}
            </div>
            {filteredCandidates.length > pageSize && <div className="candidate-pagination">
              <span>Showing {safeCandidatePage * pageSize + 1}–{Math.min((safeCandidatePage + 1) * pageSize, filteredCandidates.length)} of {filteredCandidates.length} matching mappings</span>
              <div>
                <button className="btn subtle" onClick={() => setCandidatePage((page) => Math.max(0, page - 1))} disabled={safeCandidatePage === 0}>Previous</button>
                <span>Page {safeCandidatePage + 1} of {candidatePageCount}</span>
                <button className="btn subtle" onClick={() => setCandidatePage((page) => Math.min(candidatePageCount - 1, page + 1))} disabled={safeCandidatePage >= candidatePageCount - 1}>Next</button>
              </div>
            </div>}
            <footer className="standards-list-foot"><span>CAD field values only</span><span>Source labels anonymized</span></footer>
          </section>

          <aside className="standards-side">
            <section className="defaults-panel panel">
              <div className="standards-panel-head">
                <div><span className="standards-kicker">ACTIVE CONFIGURATION</span><h2><SlidersHorizontal size={16} />Sheet-size defaults</h2></div>
              </div>
              <div className="default-scope-tabs" role="tablist" aria-label="Defaults scope">
                <button role="tab" aria-selected={tab === 'company'} className={tab === 'company' ? 'selected' : ''} onClick={() => setTab('company')}>Company</button>
                <button role="tab" aria-selected={tab === 'projects'} className={tab === 'projects' ? 'selected' : ''} onClick={() => setTab('projects')}>Projects <span>{projectIds.length}</span></button>
              </div>
              {tab === 'projects' && (
                <div className="project-picker">
                  {projectIds.length ? (
                    <label><span>PROJECT LIBRARY</span><div><select value={selectedProjectId} onChange={(event) => setActiveProjectId(event.target.value)} aria-label="Select project library">{projectIds.map((id) => <option value={id} key={id}>{projectAlias(id, projectIds)}</option>)}</select><ChevronDown size={14} /></div></label>
                  ) : <div className="project-none"><span className="empty-seal"><Layers3 size={17} /></span><strong>No project overrides yet</strong><small>Project-specific standards will appear here once available.</small></div>}
                </div>
              )}
              <div className="default-table">
                <div className="default-table-head"><span>DRAWING PURPOSE</span><span>SIZE</span></div>
                {CAD_PURPOSES.map((purpose) => {
                  const override = tab === 'projects' && selectedProjectId ? library.projects[selectedProjectId]?.defaults[purpose] : undefined;
                  const effectiveSize = override ?? library.companyDefaults[purpose];
                  return <div className="default-row" key={purpose}>
                    <div><strong>{purpose}</strong>{tab === 'projects' && <small>{override ? 'Project override' : 'Inherited company default'}</small>}</div>
                     {tab === 'company' ? (
                       <label className="size-select"><select aria-label={`${purpose} company sheet size`} value={library.companyDefaults[purpose]} onChange={(event) => updateCompanyDefault(purpose, event.target.value)} disabled={readOnly}>{CAD_SHEET_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select><ChevronDown size={13} /></label>
                    ) : selectedProjectId ? (
                       <label className={`size-select ${override ? 'override' : ''}`}><select aria-label={`${purpose} project sheet size`} value={effectiveSize} onChange={(event) => updateProjectDefault(selectedProjectId, purpose, event.target.value)} disabled={readOnly}>{CAD_SHEET_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select><ChevronDown size={13} /></label>
                    ) : <span className="default-value">—</span>}
                  </div>;
                })}
              </div>
              {actionMessage && <div className="standards-action-note" role="status">{actionMessage}</div>}
              <div className="defaults-note"><ShieldCheck size={14} /><span>Project selections change only that project. Company defaults remain unchanged.</span></div>
            </section>

            <section className="library-panel panel">
              <div className="standards-panel-head">
                <div><span className="standards-kicker">APPROVED STANDARDS</span><h2><Layers3 size={16} />{tab === 'company' ? 'Company library' : 'Project library'}</h2></div>
                <span className="standards-count">{visibleItems.length}</span>
              </div>
              <div className="approved-list">
                {visibleItems.map((item) => <article className="approved-item" key={item.id}>
                  <div className="approved-item-head"><span className="approved-glyph"><Check size={13} /></span><div><strong>{categoryAlias(item.category)}</strong><small>{tab === 'company' ? 'Company standard' : `${projectAlias(selectedProjectId, projectIds)} · project-only`}</small></div></div>
                  <div className="approved-fields">{item.fields.map((field, index) => <div key={`${field.label}-${index}`}><span>{field.label}</span><strong>{field.value || '—'}</strong></div>)}</div>
                </article>)}
                {!visibleItems.length && <div className="approved-empty"><span className="empty-seal"><Layers3 size={18} /></span><strong>{tab === 'company' ? 'No approved company standards' : 'No standards in this project'}</strong><small>{tab === 'company' ? 'Review and approve source mappings to build the company library.' : 'Project-approved standards remain isolated from company defaults.'}</small></div>}
              </div>
              <footer className="library-foot"><span>Visible values are standards fields</span><span>Descriptions hidden</span></footer>
            </section>
          </aside>
        </div>
        <footer className="standards-page-foot"><span>LOCAL-FIRST ENGINEERING WORKSPACE</span><span>Company and project standards are reviewed separately</span></footer>
      </div>
    </main>
  );
}
