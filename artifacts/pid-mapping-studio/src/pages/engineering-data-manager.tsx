import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Database, Download, FileText, HardDrive, Plus, Search, SlidersHorizontal, Trash2, Upload } from 'lucide-react';
import { Link } from 'wouter';
import type { Discipline } from '@/lib/hierarchy-store';
import { ENGINEERING_FIELDS, FIELD_LABELS, OBJECT_TYPES, createEngineeringRow, downloadEngineeringFile, engineeringBackup, engineeringCsv, getEngineeringDrawings, getEngineeringSavedText, parseEngineeringBackup, parseEngineeringCsv, saveEngineeringDrawings } from '@/lib/engineering-data';
import type { EngineeringDrawing, EngineeringField, EngineeringRow } from '@/lib/engineering-data';
import { EngineeringColumnPicker } from '@/components/engineering-column-picker';
import { engineeringGroupSummary, engineeringViewCsv, engineeringViewExcel } from '@/lib/engineering-table-export';
import type { EngineeringTableView } from '@/lib/engineering-table-export';
import './engineering-data-actions.css';

const objectTypes = ['All types','Equipment','Pipe Run','OPC','Instrument','Valve'];
export default function EngineeringDataManager({ discipline }: { discipline: Discipline }) {
  const [initial] = useState(() => {
    try { return { drawings: getEngineeringDrawings(discipline), raw: getEngineeringSavedText(discipline), error: '' }; }
    catch { return { drawings: [] as EngineeringDrawing[], raw: null, error: 'Saved engineering data could not be read. Editing is blocked to protect it. Export a raw backup before recovery.' }; }
  });
  const [drawings, setDrawings] = useState(initial.drawings);
  const drawingsRef = useRef(drawings);
  const mounted = useRef(true);
  const savedText = useRef(initial.raw);
  const [drawingId,setDrawingId] = useState(drawings[0]?.id ?? '');
  const drawing = drawings.find((item) => item.id === drawingId) ?? drawings[0] ?? { id: '', name: 'No drawing selected', revision: '', rows: [] };
  const rows = drawing.rows;
  const [selectedId,setSelectedId] = useState(rows[0]?.id ?? '');
  const [drawingName,setDrawingName] = useState('');
  const [drawingRevision,setDrawingRevision] = useState('Rev 0');
  const [newTag,setNewTag] = useState('');
  const [newType,setNewType] = useState<EngineeringRow['type']>('Equipment');
  const [search,setSearch] = useState('');
  const [catalogFilter,setCatalogFilter] = useState('');
  const [objectType,setObjectType] = useState('All types');
  const [page,setPage] = useState(0);
  const [pageSize,setPageSize] = useState(12);
  const [sort,setSort] = useState<{field: EngineeringField; direction: 1|-1}>({field:'itemTag',direction:1});
  const [groups,setGroups] = useState<EngineeringField[]>([]);
  const [columnOrder, setColumnOrder] = useState<EngineeringField[]>([...ENGINEERING_FIELDS]);
  const [hiddenColumns, setHiddenColumns] = useState<EngineeringField[]>([]);
  const tableFields = columnOrder.filter((field) => !hiddenColumns.includes(field));
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const [exportError, setExportError] = useState('');
  const [storageError,setStorageError] = useState(initial.error);
  useEffect(() => {
    mounted.current = true;
    const refresh = (event: StorageEvent) => {
      if (event.key !== `pid-mapping-studio:engineering-workspace:v2:${discipline}`) return;
      try {
        const next = getEngineeringDrawings(discipline);
        drawingsRef.current = next;
        setDrawings(next);
        savedText.current = getEngineeringSavedText(discipline);
        setStorageError('');
      } catch { setStorageError('Saved data changed and could not be read. Reload this page before editing.'); }
    };
    window.addEventListener('storage', refresh);
    return () => { mounted.current = false; window.removeEventListener('storage', refresh); };
  },[discipline]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const visibleRows = useMemo(() => {
    const q=search.trim().toLowerCase();
    return rows.filter((row) => (objectType==='All types'||row.type===objectType) &&
      (!q || Object.values(row).join(' ').toLowerCase().includes(q)));
  },[rows,search,objectType]);
  const sortedRows = useMemo(() => [...visibleRows].sort((a,b) => {
    for (const field of groups) {
      const grouped = String(a[field] || '—').localeCompare(String(b[field] || '—'),undefined,{numeric:true});
      if (grouped) return grouped;
    }
    return String(a[sort.field]).localeCompare(String(b[sort.field]),undefined,{numeric:true})*sort.direction;
  }),[visibleRows,sort,groups]);
  const pageCount=Math.max(1,Math.ceil(sortedRows.length/pageSize));
  const tableView: EngineeringTableView = { fields: tableFields, rows: sortedRows, groups };
  const groupSummaries = engineeringGroupSummary(tableView);
  const currentRows=sortedRows.slice(page*pageSize,(page+1)*pageSize);
  useEffect(()=>{
    if (currentRows.length && !currentRows.some((row)=>row.id===selectedId)) setSelectedId(currentRows[0].id);
    else if (!currentRows.length && selectedId) setSelectedId('');
  },[currentRows,selectedId]);
  useEffect(() => setPage((value) => Math.min(value, pageCount - 1)), [pageCount]);
  const commit = (next: EngineeringDrawing[]) => {
    if (initial.error) return false;
    try {
      savedText.current = saveEngineeringDrawings(discipline, next, savedText.current);
      drawingsRef.current = next;
      setDrawings(next); setStorageError('');
      return true;
    } catch (error) {
      setStorageError(error instanceof Error && error.name !== 'QuotaExceededError' ? error.message : 'Device storage is full or unavailable. This change was not saved. Download a backup and free space.');
      return false;
    }
  };
  const changeRows = (next: EngineeringRow[]) => commit(drawings.map((item) => item.id === drawing.id ? { ...item, rows: next } : item));
  const patchRow=(id:string,field:EngineeringField,value:string) => {
    changeRows(rows.map((row)=>row.id===id?{...row,[field]:value}:row));
  };
  const addDrawing = (event: React.FormEvent) => {
    event.preventDefault();
    const name = drawingName.trim();
    if (!name || drawings.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setStorageError('Enter a new, unique drawing reference.'); return;
    }
    const next = { id: crypto.randomUUID(), name, revision: drawingRevision.trim() || 'Rev 0', rows: [] };
    if (commit([...drawings, next])) { setDrawingId(next.id); setDrawingName(''); setPage(0); }
  };
  const addRecord = (event: React.FormEvent) => {
    event.preventDefault();
    if (!drawing.id) return;
    const row = createEngineeringRow(newType, newTag, drawing.name);
    if (changeRows([...rows, row])) {
      setNewTag(''); setSearch(''); setObjectType('All types'); setSort({field:'itemTag',direction:1}); setGroups([]);
      const index = [...rows, row].sort((a,b) => a.itemTag.localeCompare(b.itemTag,undefined,{numeric:true})).findIndex((item) => item.id === row.id);
      setPage(Math.floor(index/pageSize)); setSelectedId(row.id);
    }
  };
  const deleteRecord = () => {
    if (!selected || !window.confirm(`Delete record ${selected.itemTag}? This cannot be undone without a backup.`)) return;
    if (changeRows(rows.filter((row) => row.id !== selected.id))) setSelectedId('');
  };
  const importFile = async (file: File, kind: 'csv' | 'backup') => {
    if (file.size > 5 * 1024 * 1024) { setStorageError('Import a file smaller than 5 MB.'); return; }
    try {
      const targetId = drawing.id;
      const text = await file.text();
      if (!mounted.current) return;
      if (kind === 'csv') {
        const target = drawingsRef.current.find((item) => item.id === targetId);
        if (!target) throw new Error('The target drawing no longer exists. Choose a drawing and try again.');
        const imported = parseEngineeringCsv(text, target.name);
        if (commit(drawingsRef.current.map((item) => item.id === targetId ? { ...item, rows: [...item.rows, ...imported] } : item))) {
          setSearch(''); setObjectType('All types'); setPage(0);
        }
      } else {
        const imported = parseEngineeringBackup(text, discipline);
        if (commit([...drawingsRef.current, ...imported])) { setDrawingId(imported[0]?.id ?? drawing.id); setPage(0); }
      }
    } catch (error) { setStorageError(error instanceof Error ? error.message : 'This file could not be imported. No records were changed.'); }
  };
  const sortBy=(field:EngineeringField) => setSort((current)=>({field,direction:current.field===field?current.direction===1?-1:1:1}));
  const addGroup=(field:EngineeringField) => setGroups((current)=>current.includes(field)?current:[...current,field]);
  const dropGroup=(event:React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const field=event.dataTransfer.getData('text/engineering-field') as EngineeringField;
    if (ENGINEERING_FIELDS.includes(field)) addGroup(field);
  };
  const changePage=(nextPage:number)=>{
    const safePage=Math.max(0,Math.min(pageCount-1,nextPage));
    setPage(safePage);
    const firstVisible=sortedRows.slice(safePage*pageSize,(safePage+1)*pageSize)[0];
    if(firstVisible) setSelectedId(firstVisible.id);
  };
  const switchDrawing=(id:string)=>{setDrawingId(id);setSearch('');setPage(0);};
  const exportTable = async (format: 'csv' | 'xlsx', all = false) => {
    if (exportBusy) return;
    const view: EngineeringTableView = all
      ? { fields: ENGINEERING_FIELDS, rows: drawings.flatMap((item) => item.rows), groups: [] }
      : tableView;
    const scope = all ? 'all-records' : 'current-view';
    const context = {
      discipline: discipline === 'pid' ? 'P&ID' : 'PFD',
      drawing: all ? 'All drawings' : drawing.name,
      revision: all ? undefined : drawing.revision,
      filter: all ? 'All types' : objectType,
      search: all ? '' : search.trim(),
      sort: all ? 'Drawing order' : `${FIELD_LABELS[sort.field]} ${sort.direction === 1 ? 'ascending' : 'descending'}`,
    };
    setExportBusy(true); setExportNotice(''); setExportError('');
    try {
      const content = format === 'csv' ? engineeringViewCsv(view) : await engineeringViewExcel(view, context);
      downloadEngineeringFile(`engineering-${discipline}-${scope}.${format}`, content, format === 'csv'
        ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (mounted.current) setExportNotice(`Prepared ${format === 'csv' ? 'CSV' : 'Excel'}: ${view.rows.length} records · ${all ? 'all records' : 'current view'}.`);
    } catch (error) {
      if (mounted.current) setExportError(error instanceof Error ? error.message : 'Export could not be prepared. Your saved records have not changed.');
    } finally { if (mounted.current) setExportBusy(false); }
  };
  return <main className="edm-page">
    <header className="edm-topbar">
      <Link href={`/workspace/${discipline}`} className="edm-brand" data-testid="link-edm-workspace"><span className="edm-mark">ED</span><span>Engineering Data Manager<small>Mapping Studio / browser-local workspace</small></span></Link>
      <div className="edm-toplinks">
        <nav className="edm-disciplines" aria-label="Discipline navigation">
          <Link href="/workspace/pfd/engineering-data" className={discipline==='pfd'?'active':''} data-testid="link-edm-pfd">PFD</Link>
          <Link href="/workspace/pid/engineering-data" className={discipline==='pid'?'active':''} data-testid="link-edm-pid">P&amp;ID</Link>
        </nav>
        <span className="edm-local"><HardDrive size={13}/>Saved on this device</span>
        <Link href={`/workspace/${discipline}`} className="btn subtle" data-testid="link-back-workspace"><ArrowLeft size={13}/> Workspace</Link>
      </div>
    </header>
    <div className="edm-titlebar"><div><div className="edm-eyebrow">{discipline==='pfd'?'PROCESS FLOW DIAGRAM':'PIPING & INSTRUMENTATION' } / YOUR RECORDS</div><h1>Engineering data</h1><p>Add or import your records. PFD and P&amp;ID stay separate on this device.</p></div><div className="edm-object-select"><span>Object type</span><select value={objectType} onChange={(e)=>{setObjectType(e.target.value);setPage(0);}} aria-label="Object type filter" data-testid="select-object-type">{objectTypes.map((type)=><option key={type}>{type}</option>)}</select><ChevronDown size={14}/></div></div>
    <div className="edm-file-actions">
      <button className="btn" disabled={!drawings.length} onClick={() => downloadEngineeringFile(`engineering-${discipline}-backup.json`, engineeringBackup(discipline, drawings), 'application/json')} data-testid="button-backup-data"><Download size={14}/> Download backup</button>
      <label className="btn"><Upload size={14}/> Import backup<input type="file" accept=".json,application/json" aria-label="Import engineering backup" disabled={!!initial.error} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if(file) void importFile(file,'backup'); }}/></label>
      <button className="btn" disabled={exportBusy || !drawings.some((item)=>item.rows.length)} onClick={()=>void exportTable('csv',true)} data-testid="button-report-all">All records · CSV</button>
      <button className="btn" disabled={exportBusy || !drawings.some((item)=>item.rows.length)} onClick={()=>void exportTable('xlsx',true)} data-testid="button-report-all-excel">All records · Excel</button>
      {initial.error && <button className="btn" onClick={() => {
        try { const raw = getEngineeringSavedText(discipline); if(raw) downloadEngineeringFile(`engineering-${discipline}-raw.json`,raw,'application/json'); }
        catch { setStorageError('Device storage cannot be accessed. The saved data has not been changed.'); }
      }}>Export raw backup</button>}
      {initial.error && <button className="btn danger" onClick={() => {
        if(!window.confirm('Delete unreadable engineering data for this discipline? Download a raw backup first. This cannot be undone and does not delete PDFs or the old demo data.')) return;
        try { window.localStorage.removeItem(`pid-mapping-studio:engineering-workspace:v2:${discipline}`); window.location.reload(); }
        catch { setStorageError('Device storage cannot be cleared. The saved data has not been changed.'); }
      }}>Reset unreadable data</button>}
      <span>Local storage only · download backups regularly</span>
    </div>
    <div className="edm-workspace">
      <aside className="edm-catalog">
        <div className="edm-panel-head"><span><Database size={15}/> Catalog</span><span className="edm-counter">{drawings.length}</span></div>
        <div className="edm-catalog-search"><Search size={13}/><input aria-label="Filter drawings" placeholder="Filter drawings…" value={catalogFilter} onChange={(e)=>setCatalogFilter(e.target.value)} data-testid="input-catalog-filter"/></div>
        <div className="edm-catalog-label">DRAWINGS · {discipline.toUpperCase()}</div>
        <div className="edm-drawing-list">{drawings.filter((item)=>item.name.toLowerCase().includes(catalogFilter.toLowerCase())).map((item)=><button key={item.id} className={`edm-drawing-item ${drawing.id===item.id?'selected':''}`} onClick={()=>switchDrawing(item.id)} data-testid={`button-drawing-${item.id}`}><FileText size={15}/><span><strong>{item.name}</strong><small>{item.revision} · {item.rows.length} records</small></span></button>)}
          {!drawings.some((item)=>item.name.toLowerCase().includes(catalogFilter.toLowerCase()))&&<div className="edm-empty">No drawings match.</div>}
        </div>
        <form className="edm-create-drawing" onSubmit={addDrawing}>
          <label>Drawing reference<input value={drawingName} onChange={(e)=>setDrawingName(e.target.value)} maxLength={160} required placeholder="e.g. PID-001" aria-label="New drawing reference" data-testid="input-new-drawing"/></label>
          <label>Revision<input value={drawingRevision} onChange={(e)=>setDrawingRevision(e.target.value)} maxLength={80} aria-label="New drawing revision"/></label>
          <button className="btn primary" disabled={!!initial.error} data-testid="button-add-drawing"><Plus size={14}/> Add drawing</button>
        </form>
        {drawing.id && <button className="btn danger edm-delete-drawing" disabled={!!initial.error} onClick={() => {
          if(!window.confirm(`Delete drawing ${drawing.name} and its ${rows.length} records? Download a backup first. This does not delete source PDFs.`)) return;
          const next=drawings.filter((item)=>item.id!==drawing.id);
          if(commit(next)) { setDrawingId(next[0]?.id ?? ''); setSelectedId(''); setPage(0); }
        }} data-testid="button-delete-drawing"><Trash2 size={14}/> Delete drawing</button>}
        <div className="edm-catalog-foot">No invented sample records.<br/>Source PDFs stay in your workspace.</div>
      </aside>
      <section className="edm-main">
        <section className="edm-preview panel edm-source-summary">
          <header><div><span className="edm-section-kicker">ACTIVE DRAWING RECORD</span><strong data-testid="text-active-drawing">{drawing.name}</strong></div><span className="edm-revision">{drawing.revision}</span></header>
          <p>Records here are entered manually or imported from CSV. Automatic PDF extraction and drawing-to-record linking are not connected yet.</p>
          <Link href={`/workspace/${discipline}`} className="btn subtle"><FileText size={14}/> View original PDFs</Link>
        </section>
        <section className="edm-editor panel">
          <div className="edm-editor-title"><div><span className="edm-section-kicker">DATA WORKSPACE</span><h2>Engineering Data Editor</h2></div><div className="edm-type-chip">{objectType}</div></div>
          <form className="edm-add-record" onSubmit={addRecord}>
            <label>Object type<select value={newType} onChange={(event)=>setNewType(event.target.value as EngineeringRow['type'])} aria-label="New record type">{OBJECT_TYPES.map((type)=><option key={type}>{type}</option>)}</select></label>
            <label>Item tag<input value={newTag} onChange={(event)=>setNewTag(event.target.value)} maxLength={160} required placeholder="e.g. P-101" aria-label="New item tag" data-testid="input-new-tag"/></label>
            <button className="btn primary" disabled={!drawing.id || !!initial.error} data-testid="button-add-record"><Plus size={14}/> Add record</button>
          </form>
          <div className="edm-report-actions">
            <button className="btn" disabled={exportBusy || !sortedRows.length} onClick={()=>void exportTable('csv')} data-testid="button-export-report"><Download size={14}/> Current view · CSV</button>
            <button className="btn" disabled={exportBusy || !sortedRows.length} onClick={()=>void exportTable('xlsx')} data-testid="button-export-excel"><Download size={14}/> Current view · Excel</button>
            <label className="btn"><Upload size={14}/> Import CSV<input type="file" accept=".csv,text/csv" aria-label="Import engineering CSV" disabled={!drawing.id || !!initial.error} onChange={(event)=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file) void importFile(file,'csv');}}/></label>
            <button className="btn subtle" onClick={()=>downloadEngineeringFile('engineering-import-template.csv',engineeringCsv([]),'text/csv;charset=utf-8')} data-testid="button-csv-template">CSV template</button>
            <button className="btn danger" disabled={!selected || !!initial.error} onClick={deleteRecord} data-testid="button-delete-record"><Trash2 size={14}/> Delete selected</button>
          </div>
          <div className="edm-export-note" aria-live="polite">
            <span>Current view: shown columns, filters, sorting and all matching rows across pages. Excel also includes group summaries. CSV has no visual formatting.</span>
            {exportBusy && <strong role="status">Preparing export…</strong>}
            {exportNotice && <strong role="status">{exportNotice}</strong>}
            {exportError && <strong role="alert">{exportError}</strong>}
          </div>
          <EngineeringColumnPicker order={columnOrder} hidden={hiddenColumns} onChange={(order,hidden)=>{setColumnOrder(order);setHiddenColumns(hidden);}}/>
          <div className="edm-grid-toolbar"><label className="edm-global-search"><Search size={14}/><input placeholder="Search all fields…" aria-label="Search engineering data" value={search} onChange={(e)=>{setSearch(e.target.value);setPage(0);}} data-testid="input-engineering-search"/></label><span className="edm-result-total" data-testid="text-result-count">{visibleRows.length} records</span><button className="edm-toolbar-button" onClick={()=>{setSearch('');setObjectType('All types');setPage(0);}} data-testid="button-clear-filters"><SlidersHorizontal size={14}/> Clear filters</button></div>
          <div className="edm-groups" onDragOver={(e)=>e.preventDefault()} onDrop={dropGroup} data-testid="drop-column-group"><span>GROUP BY</span>{groups.length?groups.map((field)=><button key={field} onClick={()=>setGroups((current)=>current.filter((item)=>item!==field))} title="Remove group">{FIELD_LABELS[field]} <b>×</b></button>):<em>Drag a column header here to group records</em>}</div>
          <label className="edm-group-select">Add group<select value="" aria-label="Add group" onChange={(event)=>{if(event.target.value){addGroup(event.target.value as EngineeringField);setPage(0);}}}><option value="">Choose a column…</option>{ENGINEERING_FIELDS.filter((field)=>!groups.includes(field)).map((field)=><option value={field} key={field}>{FIELD_LABELS[field]}</option>)}</select></label>
          {groupSummaries.map((group)=><div className="edm-group-summary" key={group.field}><strong>{group.label}</strong>{group.values.map(({value,count})=><span key={value}>{value}<i>{count}</i></span>)}</div>)}
          <div className="edm-table-wrap"><table className="edm-table"><thead><tr><th className="edm-rownum">#</th><th>Object type</th>{tableFields.map((field)=><th key={field} draggable onDragStart={(e)=>e.dataTransfer.setData('text/engineering-field',field)}><button onClick={()=>sortBy(field)} data-testid={`button-sort-${field}`}>{FIELD_LABELS[field]}<span>{sort.field===field?(sort.direction===1?'↑':'↓'):'↕'}</span></button></th>)}</tr></thead>
          <tbody>{currentRows.map((row,index)=><tr key={row.id} className={selectedId===row.id?'selected':''} onClick={()=>setSelectedId(row.id)} data-testid={`row-engineering-${row.id}`}><td className="edm-rownum">{page*pageSize+index+1}</td><td><span className={`edm-type-badge ${row.type.toLowerCase().replace(' ','-')}`}>{row.type}</span></td>{tableFields.map((field)=><td key={field} className={field==='itemTag'?'mono':''}>{selectedId===row.id?<input aria-label={`${FIELD_LABELS[field]} for ${row.itemTag}`} value={row[field]} onClick={(e)=>e.stopPropagation()} onChange={(e)=>patchRow(row.id,field,e.target.value)} data-testid={`input-cell-${row.id}-${field}`}/>:<span>{row[field]||'—'}</span>}</td>)}</tr>)}
          {!currentRows.length&&<tr><td colSpan={tableFields.length+2}><div className="edm-empty">No records match these filters.</div></td></tr>}</tbody></table></div>
           <footer className="edm-pagination"><span>Showing <strong>{sortedRows.length? page*pageSize+1:0}–{Math.min((page+1)*pageSize,sortedRows.length)}</strong> of <strong>{sortedRows.length}</strong></span><label>Rows <select value={pageSize} onChange={(e)=>{setPageSize(Number(e.target.value));setPage(0);}} aria-label="Rows per page" data-testid="select-page-size">{[8,12,24,36].map((size)=><option key={size} value={size}>{size}</option>)}</select> per page</label><div className="edm-page-controls"><button disabled={page===0} onClick={()=>changePage(page-1)} aria-label="Previous page" data-testid="button-page-previous"><ChevronLeft size={15}/></button><span>Page {page+1} of {pageCount}</span><button disabled={page>=pageCount-1} onClick={()=>changePage(page+1)} aria-label="Next page" data-testid="button-page-next"><ChevronRight size={15}/></button></div></footer>
        </section>
      </section>
      <aside className="edm-properties panel">
        <div className="edm-panel-head"><span>Properties</span><span className="edm-counter">{selected?'EDIT':''}</span></div>
        {selected && <label className="edm-record-type">Object type<select value={selected.type} aria-label="Selected record type" disabled={!!initial.error} onChange={(event)=>changeRows(rows.map((row)=>row.id===selected.id?{...row,type:event.target.value as EngineeringRow['type']}:row))}>{OBJECT_TYPES.map((type)=><option key={type}>{type}</option>)}</select></label>}
        {selected?<><div className="edm-property-summary"><span className="edm-property-icon">{selected.type==='Equipment'?'EQ':selected.type==='Pipe Run'?'PR':selected.type==='OPC'?'OP':selected.type==='Valve'?'VL':'IN'}</span><div><strong data-testid="text-selected-tag">{selected.itemTag}</strong><small>{selected.type} · {drawing.revision}</small></div></div><div className="edm-property-scroll"><div className="edm-property-group">IDENTIFICATION</div>{(['itemTag','tagPrefix','tagSequence','tagSuffix','equipmentClass','equipmentType','equipmentName','drawingRef'] as EngineeringField[]).map((field)=><label className="edm-property-field" key={field}><span>{FIELD_LABELS[field]}</span><input value={selected[field]} onChange={(e)=>patchRow(selected.id,field,e.target.value)} data-testid={`property-${field}`}/></label>)}<div className="edm-property-group">PROCESS & CONNECTION</div>{(['nominalDiameter','pipingMaterial','flow','heatTracing','insulation','opcDrawing','connection','description'] as EngineeringField[]).map((field)=><label className="edm-property-field" key={field}><span>{FIELD_LABELS[field]}</span><input value={selected[field]} onChange={(e)=>patchRow(selected.id,field,e.target.value)} data-testid={`property-${field}`}/></label>)}</div><div className="edm-save-state" role="status" data-testid="status-local-save"><span/> Edits save automatically in this browser</div></>:<div className="edm-empty">Select a graphic or table row to inspect properties.</div>}
      </aside>
    </div>
    <footer className="edm-footnote"><span>© 2026 gaurav.cbiindia · DEVICE-LOCAL DATA</span><span>{rows.length} records · {drawing.name} · {discipline.toUpperCase()}-isolated browser storage</span></footer>
    {storageError&&<div className="edm-storage-error" role="alert" data-testid="status-storage-error">{storageError}</div>}
  </main>;
}
