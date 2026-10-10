import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Download, FilePlus2, FileText, HardDrive, Loader2, Trash2, X, Eye, Monitor,
} from 'lucide-react';
import PdfPagePreview from '@/components/pdf-page-preview';
import {
  MAX_FILE_BYTES, MAX_TOTAL_BYTES, StoreError, clearDiscipline, deletePdfs, getPdfBytes,
  listPdfs, savePdf, sha256Hex, totalStoredBytes, type PdfMeta,
} from '@/lib/local-pdf-store';
import './pdf-input-panel.css';

type Discipline = 'PFD' | 'P&ID';
type Note = { id: number; kind: 'error' | 'info'; text: string };
type Task = { id: number; file: File; cancelled: boolean; state: 'queued' | 'working' | 'done' | 'failed' };
type Progress = { total: number; done: number; pagesDone: number; active: number } | null;

const MB = 1024 * 1024;
function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}
function looksPdf(file: File): boolean {
  const t = file.type.trim().toLowerCase();
  return t === 'application/pdf' || (t === '' && file.name.toLowerCase().endsWith('.pdf'));
}

async function validatePdf(bytes: ArrayBuffer): Promise<number> {
  const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  const task = lib.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  try {
    const pdf = await task.promise;
    return pdf.numPages;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

export default function PdfInputPanel({ discipline }: { discipline: Discipline }) {
  const [saved, setSaved] = useState<PdfMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [usedBytes, setUsedBytes] = useState(0);
  const [notes, setNotes] = useState<Note[]>([]);
  const [progress, setProgress] = useState<Progress>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ type: 'one'; id: string } | { type: 'all' } | null>(null);
  const tasksRef = useRef<Task[]>([]);
  const mounted = useRef(true);
  const noteSeq = useRef(0);
  const disciplineRef = useRef(discipline);
  disciplineRef.current = discipline;

  const hashSupported = typeof globalThis.crypto?.subtle !== 'undefined';

  const addNote = useCallback((kind: Note['kind'], text: string) => {
    if (!mounted.current) return;
    noteSeq.current += 1;
    const id = noteSeq.current;
    setNotes((n) => [...n.slice(-5), { id, kind, text }]);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [items, total] = await Promise.all([listPdfs(discipline), totalStoredBytes()]);
      if (!mounted.current || disciplineRef.current !== discipline) return;
      setSaved(items);
      setUsedBytes(total);
      setLoadError('');
    } catch (e) {
      if (mounted.current) setLoadError(e instanceof Error ? e.message : 'Saved PDFs could not be loaded.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [discipline]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    setSelectedId(null);
    setPage(1);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      mounted.current = false;
      tasksRef.current.forEach((t) => { t.cancelled = true; });
      tasksRef.current = [];
    };
  }, [refresh]);

  const processTask = async (task: Task, counters: { done: number; pagesDone: number }, total: number) => {
    const taskDiscipline = discipline;
    const alive = () => !task.cancelled && mounted.current && disciplineRef.current === taskDiscipline;
    task.state = 'working';
    try {
      if (task.file.size > MAX_FILE_BYTES) throw new StoreError('too-large', 'A PDF is larger than 100 MB and was skipped.');
      const bytes = await task.file.arrayBuffer();
      if (!alive()) return;
      let pages: number;
      try {
        pages = await validatePdf(bytes);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        if (name === 'PasswordException') throw new Error('A PDF is password-protected. Remove the password and add it again.');
        if (name === 'InvalidPDFException' || name === 'FormatError') throw new Error('A file is not a valid PDF, or it is damaged.');
        throw new Error('A PDF could not be read. It may be damaged.');
      }
      if (!alive()) return;
      if (pages < 1) throw new Error('A PDF has no pages.');
      let hash: string;
      try {
        hash = await sha256Hex(bytes);
      } catch {
        throw new Error('Duplicate check is not supported in this browser, so the PDF was not saved.');
      }
      if (!alive()) return;
      await savePdf({ discipline: taskDiscipline, bytes, pageCount: pages, hash }, alive);
      task.state = 'done';
      counters.pagesDone += pages;
      if (mounted.current) await refresh();
    } catch (e) {
      task.state = 'failed';
      if (!(e instanceof StoreError && e.code === 'cancelled') && alive()) {
        addNote('error', e instanceof Error ? e.message : 'A PDF could not be added.');
      }
    } finally {
      counters.done += 1;
      if (mounted.current) {
        setProgress({ total, done: counters.done, pagesDone: counters.pagesDone, active: 0 });
      }
    }
  };

  const addFiles = (selected: File[]) => {
    if (progress || loading || loadError) return;
    if (!selected.length) return;
    const accepted = selected.filter(looksPdf);
    if (accepted.length < selected.length) addNote('error', `${selected.length - accepted.length} file(s) skipped. Choose PDF files only.`);
    if (!accepted.length) return;
    const tasks: Task[] = accepted.map((file) => ({ id: ++noteSeq.current, file, cancelled: false, state: 'queued' }));
    tasksRef.current = [...tasksRef.current, ...tasks];
    const counters = { done: 0, pagesDone: 0 };
    setProgress({ total: tasks.length, done: 0, pagesDone: 0, active: 0 });
    let next = 0;
    const worker = async () => {
      while (next < tasks.length && mounted.current) {
        const t = tasks[next++];
        if (t.cancelled) { counters.done += 1; continue; }
        await processTask(t, counters, tasks.length);
      }
    };
    void Promise.all([worker(), worker()]).then(() => {
      tasksRef.current = tasksRef.current.filter((t) => !tasks.includes(t));
      if (!mounted.current) return;
      const ok = tasks.filter((t) => t.state === 'done').length;
      if (ok) addNote('info', `${ok} PDF(s) saved on this device.`);
      setProgress(null);
    });
  };

  const cancelBatch = () => {
    tasksRef.current.forEach((t) => { if (t.state !== 'done') t.cancelled = true; });
    addNote('info', 'Remaining imports were cancelled. Finished files stay saved.');
  };

  const remove = async (id: string) => {
    setConfirm(null);
    try {
      await deletePdfs([id]);
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch { addNote('error', 'The PDF could not be deleted from local storage.'); }
  };

  const clearAll = async () => {
    setConfirm(null);
    tasksRef.current.forEach((t) => { t.cancelled = true; });
    try {
      await clearDiscipline(discipline);
      setSelectedId(null);
      await refresh();
    } catch { addNote('error', 'Saved PDFs could not be cleared.'); }
  };

  const download = async (meta: PdfMeta) => {
    try {
      const bytes = await getPdfBytes(meta.id);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `original-source-${discipline === 'PFD' ? 'pfd' : 'pid'}-pdf-${meta.aliasNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { addNote('error', 'The original PDF could not be read for download.'); }
  };

  const selected = useMemo(() => saved.find((m) => m.id === selectedId) ?? null, [saved, selectedId]);
  const totalPages = saved.reduce((t, m) => t + m.pageCount, 0);
  const busy = progress !== null;
  const pct = Math.min(100, (usedBytes / MAX_TOTAL_BYTES) * 100);

  return (
    <section className="pdf-workflow" aria-labelledby="pdf-workflow-title" data-testid="panel-pdf-workflow">
      <div className="pdf-panel-heading">
        <div>
          <div className="pdf-kicker">PDF INPUT · LOCAL SOURCE FILES · {discipline}</div>
          <h2 id="pdf-workflow-title">Source PDF files</h2>
          <p>Add the PDFs for this {discipline} workspace. They are saved privately in this browser and shown as PDF 1, PDF 2 and so on.</p>
        </div>
        <div className="pdf-actions">
          <label className="btn primary pdf-add-control" data-testid="label-add-pdfs">
            <FilePlus2 size={15} /> Add PDFs
            <input type="file" accept="application/pdf,.pdf" multiple aria-label="Add PDF files"
              disabled={busy || loading || !!loadError || !hashSupported}
              onChange={(e) => { addFiles(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = ''; }}
              data-testid="input-add-pdfs" />
          </label>
          <button className="btn subtle" type="button" onClick={() => setConfirm({ type: 'all' })}
            disabled={!saved.length} aria-label="Clear all saved PDFs" data-testid="button-clear-pdfs">
            <Trash2 size={14} /> Clear all
          </button>
        </div>
      </div>

      <div className="pdf-trust-note" data-testid="text-pdf-local-only">
        <HardDrive size={15} />
        <span>
          <strong>Saved on this device only.</strong> These PDFs stay in this browser. They are not uploaded, not backed up to any cloud, and not synced to other devices.
          Clearing browser data will remove them. Download an original if you need a copy. Original PDFs are unchanged; generic aliases hide filenames, not names or logos inside a PDF.
          {!hashSupported && ' Duplicate check needs a secure browser context, so new PDFs cannot be added here.'}
        </span>
      </div>

      <div className="pdf-storage-line" data-testid="text-pdf-storage">
        <span>{fmt(usedBytes)} of {fmt(MAX_TOTAL_BYTES)} used (all disciplines)</span>
        <span>Limit {fmt(MAX_FILE_BYTES)} per PDF</span>
      </div>
      <div className="pdf-meter" role="progressbar" aria-label="Local storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span style={{ width: `${pct}%` }} />
      </div>

      <div style={{ height: 12 }} />

      {progress && (
        <div className="pdf-progress" role="status" aria-live="polite" data-testid="status-pdf-progress">
          <div className="pdf-progress-top">
            <span><Loader2 size={12} className="pdf-spin" /> Checking and saving: {progress.done} of {progress.total} file(s) finished · {progress.pagesDone} page(s) verified</span>
            <button type="button" className="btn" onClick={cancelBatch} data-testid="button-cancel-import" aria-label="Cancel remaining imports">Cancel</button>
          </div>
          <div className="pdf-meter"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="pdf-notes" aria-live="polite" data-testid="list-pdf-notes">
          {notes.map((n) => (
            <li key={n.id} className={n.kind === 'info' ? 'info' : ''} role={n.kind === 'error' ? 'alert' : undefined} data-testid={`status-pdf-note-${n.id}`}>
              {n.kind === 'error' ? <AlertTriangle size={14} /> : <FileText size={14} />}
              <span>{n.text}</span>
              <button type="button" aria-label="Dismiss message" onClick={() => setNotes((l) => l.filter((x) => x.id !== n.id))}><X size={13} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="pdf-queue" aria-label="Saved PDF files">
        {confirm && (
          <div className="pdf-confirm" role="alertdialog" aria-label="Confirm delete" data-testid="dialog-confirm-delete">
            <span>
              {confirm.type === 'all'
                ? `Delete all ${saved.length} saved ${discipline} PDF(s) from this device? This cannot be undone.`
                : 'Delete this PDF from this device? This cannot be undone.'}
            </span>
            <button type="button" className="btn danger" data-testid="button-confirm-delete"
              onClick={() => (confirm.type === 'all' ? void clearAll() : void remove(confirm.id))}>Delete</button>
            <button type="button" className="btn" data-testid="button-cancel-delete" onClick={() => setConfirm(null)}>Keep</button>
          </div>
        )}
        {loading ? (
          <div className="pdf-queue-empty" role="status" data-testid="status-pdf-loading"><Loader2 size={16} className="pdf-spin" /> Loading saved PDFs</div>
        ) : loadError ? (
          <div className="pdf-queue-empty" role="alert" data-testid="status-pdf-load-error">
            <AlertTriangle size={16} /> {loadError}
            <button type="button" className="btn" onClick={() => { setLoading(true); void refresh(); }} data-testid="button-retry-load">Try again</button>
          </div>
        ) : saved.length ? saved.map((m) => (
          <div className={`pdf-file-row${m.id === selectedId ? ' is-selected' : ''}`} key={m.id} data-testid={`row-pdf-file-${m.id}`}>
            <button type="button" className="pdf-select" onClick={() => { setSelectedId(m.id); setPage(1); }}
              aria-label={`Preview ${m.alias}`} aria-pressed={m.id === selectedId} data-testid={`button-select-pdf-${m.id}`}>
              <span className="pdf-file-icon"><FileText size={17} /></span>
              <span className="pdf-file-details">
                <strong className="pdf-filename" data-testid={`text-pdf-name-${m.id}`}>{m.alias}</strong>
                <span className="pdf-file-meta">{m.pageCount} page(s) · {fmt(m.size)} · saved locally</span>
              </span>
            </button>
            <span className="pdf-row-actions">
              <button type="button" className="pdf-icon-btn" aria-label={`Preview ${m.alias}`} onClick={() => { setSelectedId(m.id); setPage(1); }} data-testid={`button-preview-pdf-${m.id}`}><Eye size={15} /></button>
              <button type="button" className="pdf-icon-btn" aria-label={`Download original source ${m.alias}`} onClick={() => void download(m)} data-testid={`button-download-pdf-${m.id}`}><Download size={15} /></button>
              <button type="button" className="pdf-icon-btn danger" aria-label={`Remove ${m.alias}`} onClick={() => setConfirm({ type: 'one', id: m.id })} data-testid={`button-remove-pdf-${m.id}`}><X size={15} /></button>
            </span>
          </div>
        )) : (
          <div className="pdf-queue-empty" data-testid="empty-pdf-queue">
            <FileText size={18} />
            <span>No saved PDFs for {discipline}</span>
            <small>Add PDFs to keep them on this device. You can add several at once.</small>
          </div>
        )}
      </div>

      <div className="pdf-page-summary" style={{ marginTop: 10 }} data-testid="text-pdf-page-summary">
        {saved.length ? `${saved.length} PDF(s) · ${totalPages} total page(s)` : busy ? 'Working on your files' : 'No readable PDFs saved yet'}
      </div>

      {selected && (
        <div className="pdf-source-box" data-testid="panel-source-page">
          <div className="pdf-page-select">
            <label htmlFor="pdf-page-picker">Source page</label>
            <select id="pdf-page-picker" value={page} onChange={(e) => setPage(Number(e.target.value))} data-testid="select-source-page" aria-label="Select source page">
              {Array.from({ length: selected.pageCount }, (_, i) => <option key={i + 1} value={i + 1}>Page {i + 1}</option>)}
            </select>
            <span>of {selected.pageCount} in {selected.alias}</span>
          </div>
          <PdfPagePreview fileId={selected.id} alias={selected.alias} pageCount={selected.pageCount}
            page={page} onPageChange={setPage} loadBytes={getPdfBytes} />
        </div>
      )}

      <div className="pdf-final-status" role="note" data-testid="text-conversion-unavailable">
        <strong><Monitor size={13} style={{ verticalAlign: '-2px' }} /> Windows AutoCAD is not connected.</strong>{' '}
        DWG conversion is unavailable here. This page only stores and previews your original PDFs. Nothing shown above is generated CAD.
      </div>
    </section>
  );
}
