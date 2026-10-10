import { useEffect, useMemo, useState } from 'react';
import { unzipSync } from 'fflate';
import { AlertTriangle, Archive, Check, Database, FileText, HardDrive, Loader2, Save, Upload } from 'lucide-react';
import {
  listLocalCadSources,
  saveLocalCadSources,
  updateLocalCadSource,
} from '@/lib/local-cad-sources';
import type {
  CadSourceCategory,
  CadSourceDiscipline,
  LocalCadSource,
  NewLocalCadSource,
} from '@/lib/local-cad-sources';

type StagedDrawing = NewLocalCadSource;

type StagedPdf = {
  id: string;
  label: string;
  file: File;
};

type SourceEdit = Pick<LocalCadSource, 'category' | 'discipline' | 'projectLabel'>;

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_SOURCE_BYTES = 500 * 1024 * 1024;

const CATEGORY_LABELS: Record<CadSourceCategory, string> = {
  'needs-review': 'Needs review',
  'company-standard': 'Company standard',
  'project-example': 'Project example',
  'markup-reference': 'Markup reference',
  ignore: 'Do not use',
};

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `source-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function LocalCadLibraryPanel({
  onAddPdfs,
  discipline,
}: {
  onAddPdfs: (files: File[]) => void;
  discipline: Exclude<CadSourceDiscipline, 'Shared'>;
}) {
  const [sources, setSources] = useState<LocalCadSource[]>([]);
  const [sourceEdits, setSourceEdits] = useState<Record<string, SourceEdit>>({});
  const [stagedDrawings, setStagedDrawings] = useState<StagedDrawing[]>([]);
  const [stagedPdfs, setStagedPdfs] = useState<StagedPdf[]>([]);
  const [archiveSummary, setArchiveSummary] = useState('');
  const [archiveMessage, setArchiveMessage] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [pdfsAdded, setPdfsAdded] = useState(false);

  useEffect(() => {
    void listLocalCadSources()
      .then((loaded) => {
        setSources(loaded);
        setSourceEdits(Object.fromEntries(loaded.map((source) => [source.id, {
          category: source.category,
          discipline: source.discipline,
          projectLabel: source.projectLabel,
        }])));
      })
      .catch((error: unknown) => {
        setStorageError(error instanceof Error ? error.message : 'The local CAD library could not be opened.');
      });
  }, []);

  const visibleSources = useMemo(() => sources.filter((source) =>
    source.discipline === discipline || source.discipline === 'Shared',
  ), [sources, discipline]);
  const categoryCounts = useMemo(() => visibleSources.reduce<Record<CadSourceCategory, number>>((counts, source) => {
    counts[source.category] += 1;
    return counts;
  }, {
    'needs-review': 0,
    'company-standard': 0,
    'project-example': 0,
    'markup-reference': 0,
    ignore: 0,
  }), [visibleSources]);

  const readArchive = async (file: File) => {
    setIsReading(true);
    setArchiveMessage('');
    setStorageError('');
    setArchiveSummary('');
    setPdfsAdded(false);
    setStagedDrawings([]);
    setStagedPdfs([]);
    try {
      if (file.size > MAX_ARCHIVE_BYTES) {
        throw new Error('The archive is larger than the 250 MB limit for this local test.');
      }
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const allFiles = Object.entries(entries).filter(([path]) => !path.endsWith('/'));
      const drawingEntries = allFiles.filter(([path]) => /\.dwg$/i.test(path));
      const pdfEntries = allFiles.filter(([path]) => /\.pdf$/i.test(path));
      const backupCount = allFiles.filter(([path]) => /\.bak$/i.test(path)).length;
      const totalSourceBytes = [...drawingEntries, ...pdfEntries]
        .reduce((total, [, bytes]) => total + bytes.byteLength, 0);
      if (totalSourceBytes > MAX_SOURCE_BYTES) {
        throw new Error('The PDF and DWG source files together exceed the 500 MB local test limit.');
      }
      if (drawingEntries.length === 0 && pdfEntries.length === 0) {
        throw new Error('No PDF or DWG files were found in this ZIP. Other file types were left untouched.');
      }

      const nextDrawings = drawingEntries.map(([, bytes], index) => ({
        id: makeId(),
        label: `Source DWG ${String(sources.length + index + 1).padStart(3, '0')}`,
        category: 'needs-review' as const,
        discipline,
        projectLabel: '',
        bytes: bytes.byteLength,
        content: bytes,
      }));
      const nextPdfs = pdfEntries.map(([, bytes], index) => ({
        id: makeId(),
        label: `PDF ${String(index + 1).padStart(2, '0')}`,
        file: new File([bytes], `SOURCE_${String(index + 1).padStart(2, '0')}.pdf`, { type: 'application/pdf' }),
      }));

      setStagedDrawings(nextDrawings);
      setStagedPdfs(nextPdfs);
      setArchiveSummary(
        `Found ${drawingEntries.length} DWG file(s) and ${pdfEntries.length} PDF file(s). ${backupCount} backup file(s) ignored.`,
      );
      if (drawingEntries.length) {
        setArchiveMessage('Assign a use to each DWG before saving it in the local library. Source filenames are not shown or stored.');
      } else {
        setArchiveMessage('No DWG files to add. You can add the extracted PDF to the conversion queue.');
      }
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'The ZIP could not be read. Check that it is not damaged or password-protected.');
    } finally {
      setIsReading(false);
    }
  };

  const saveStagedDrawings = async () => {
    if (stagedDrawings.some((drawing) => drawing.category === 'needs-review')) {
      setStorageError('Choose a category for every DWG before saving the library.');
      return;
    }
    if (stagedDrawings.some((drawing) =>
      ['project-example', 'markup-reference'].includes(drawing.category) && !drawing.projectLabel?.trim(),
    )) {
      setStorageError('Enter a neutral project code for every project example and markup reference.');
      return;
    }
    setIsSaving(true);
    setStorageError('');
    try {
      const toSave = stagedDrawings.filter((drawing) => drawing.category !== 'ignore');
      await saveLocalCadSources(toSave);
      const updated = await listLocalCadSources();
      setSources(updated);
      setSourceEdits(Object.fromEntries(updated.map((source) => [source.id, {
        category: source.category,
        discipline: source.discipline,
        projectLabel: source.projectLabel,
      }])));
      const ignored = stagedDrawings.length - toSave.length;
      setStagedDrawings([]);
      setArchiveMessage(
        `${toSave.length} source DWG file(s) saved in this browser's local library. ${ignored} marked “Do not use”.`,
      );
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'The DWG sources could not be saved locally.');
    } finally {
      setIsSaving(false);
    }
  };

  const patchSavedSource = (source: LocalCadSource, updates: Partial<SourceEdit>) => {
    setSourceEdits((current) => ({
      ...current,
      [source.id]: { ...source, ...current[source.id], ...updates },
    }));
  };

  const saveSavedSource = async (source: LocalCadSource) => {
    const updates = sourceEdits[source.id] ?? {
      category: source.category,
      discipline: source.discipline,
      projectLabel: source.projectLabel,
    };
    if (['project-example', 'markup-reference'].includes(updates.category) && !updates.projectLabel?.trim()) {
      setStorageError('Enter a neutral project code before saving this project-specific source.');
      return;
    }
    setStorageError('');
    try {
      await updateLocalCadSource(source.id, updates);
      setSources((current) => current.map((item) => item.id === source.id
        ? { ...item, ...updates, ...(updates.projectLabel?.trim() ? { projectLabel: updates.projectLabel.trim() } : { projectLabel: undefined }) }
        : item));
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'The source drawing category could not be changed.');
    }
  };

  return (
    <section className="local-cad-library" aria-labelledby="local-library-title" data-testid="panel-local-cad-library">
      <div className="local-library-heading">
        <div className="local-library-icon"><Database size={17} /></div>
        <div className="local-library-title">
          <div className="pdf-kicker">SOURCE DRAWINGS · LOCAL ONLY</div>
          <h3 id="local-library-title">CAD source library</h3>
          <p>Read your ZIP in this browser, sort each DWG by project and discipline, and keep source files on this device.</p>
        </div>
        <label className="btn pdf-add-control" data-testid="label-add-cad-archive">
          {isReading ? <Loader2 size={14} className="pdf-spin" /> : <Archive size={14} />}
          {isReading ? 'Reading ZIP…' : 'Add ZIP'}
          <input
            type="file"
            accept=".zip,application/zip"
            aria-label="Add a ZIP with PDF and DWG source files"
            disabled={isReading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void readArchive(file);
              event.currentTarget.value = '';
            }}
            data-testid="input-add-cad-archive"
          />
        </label>
      </div>

      <div className="local-library-privacy">
        <HardDrive size={14} />
        <span><strong>Files stay in this browser.</strong> DWGs are stored locally and separated into PFD, P&amp;ID, company-standard, and project-reference groups.</span>
      </div>

      <div className="local-library-summary" aria-label="Local library totals">
        <span><strong>{visibleSources.length}</strong> saved DWGs for {discipline}</span>
        <span><strong>{categoryCounts['company-standard']}</strong> company source DWGs</span>
        <span><strong>{categoryCounts['project-example'] + categoryCounts['markup-reference']}</strong> reference drawings</span>
        {categoryCounts['needs-review'] > 0 && <span className="local-library-review-count"><strong>{categoryCounts['needs-review']}</strong> need review</span>}
      </div>

      {storageError && (
        <div className="pdf-validation" role="alert" data-testid="status-cad-library-error">
          <AlertTriangle size={15} /><span>{storageError}</span>
        </div>
      )}
      {archiveSummary && <div className="local-library-archive-summary" role="status">{archiveSummary}</div>}
      {archiveMessage && <p className="local-library-message">{archiveMessage}</p>}

      {stagedPdfs.length > 0 && (
        <div className="local-library-pdf-list" aria-label="PDF files found in ZIP">
          {stagedPdfs.map((pdf) => (
            <div className="local-library-pdf-row" key={pdf.id}>
              <FileText size={15} />
              <span>{pdf.label}</span>
              <span className="pdf-file-meta">{formatBytes(pdf.file.size)}</span>
            </div>
          ))}
          <button className="btn subtle" type="button" disabled={pdfsAdded}
            onClick={() => {
              onAddPdfs(stagedPdfs.map(({ file }) => file));
              setPdfsAdded(true);
            }}
            data-testid="button-add-archive-pdfs">
            {pdfsAdded ? <Check size={14} /> : <Upload size={14} />}
            {pdfsAdded ? 'PDFs added to queue' : 'Add PDF(s) to conversion queue'}
          </button>
        </div>
      )}

      {stagedDrawings.length > 0 && (
        <div className="local-library-staging">
          <div className="local-library-staging-title">
            <strong>Choose what each DWG is for</strong>
            <span>Unmarked files will not be saved.</span>
          </div>
          {stagedDrawings.map((drawing) => (
            <label className="local-library-source-row" key={drawing.id}>
              <span className="local-library-source-id">{drawing.label}</span>
              <span className="pdf-file-meta">{formatBytes(drawing.bytes)}</span>
              <div className="local-library-row-controls">
                <select
                  aria-label={`Category for ${drawing.label}`}
                  value={drawing.category}
                  onChange={(event) => {
                    const category = event.target.value as CadSourceCategory;
                    setStagedDrawings((current) => current.map((item) =>
                      item.id === drawing.id ? { ...item, category } : item,
                    ));
                  }}
                  data-testid={`select-category-${drawing.id}`}
                >
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <select
                  aria-label={`Discipline for ${drawing.label}`}
                  value={drawing.discipline}
                  onChange={(event) => {
                    const itemDiscipline = event.target.value as CadSourceDiscipline;
                    setStagedDrawings((current) => current.map((item) =>
                      item.id === drawing.id ? { ...item, discipline: itemDiscipline } : item,
                    ));
                  }}
                  data-testid={`select-discipline-${drawing.id}`}
                >
                  {(['PFD', 'P&ID', 'Shared'] as const).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                {['project-example', 'markup-reference'].includes(drawing.category) && (
                  <input
                    aria-label={`Project code for ${drawing.label}`}
                    placeholder="Neutral project code"
                    value={drawing.projectLabel}
                    onChange={(event) => setStagedDrawings((current) => current.map((item) =>
                      item.id === drawing.id ? { ...item, projectLabel: event.target.value } : item,
                    ))}
                    data-testid={`input-project-${drawing.id}`}
                  />
                )}
              </div>
            </label>
          ))}
          <button className="btn primary local-library-save" type="button" disabled={isSaving ||
              stagedDrawings.some((drawing) => drawing.category === 'needs-review' ||
                (['project-example', 'markup-reference'].includes(drawing.category) && !drawing.projectLabel?.trim()))}
            onClick={() => void saveStagedDrawings()} data-testid="button-save-local-library">
            {isSaving ? <Loader2 size={14} className="pdf-spin" /> : <Save size={14} />}
            {isSaving ? 'Saving locally…' : 'Save reviewed DWGs to library'}
          </button>
        </div>
      )}

      {visibleSources.length > 0 && (
        <details className="local-library-saved-list">
          <summary>Saved source drawings for {discipline} ({visibleSources.length})</summary>
          <div className="local-library-saved-items">
            {visibleSources.map((source) => (
              <div className="local-library-source-row" key={source.id}>
                <span className="local-library-source-id">{source.label}{source.projectLabel ? ` · ${source.projectLabel}` : ''}</span>
                <span className="pdf-file-meta">{formatBytes(source.bytes)}</span>
                <div className="local-library-row-controls">
                  <select
                    aria-label={`Change category for ${source.label}`}
                    value={(sourceEdits[source.id] ?? source).category}
                    onChange={(event) => patchSavedSource(source, { category: event.target.value as CadSourceCategory })}
                    data-testid={`saved-category-${source.id}`}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select
                    aria-label={`Change discipline for ${source.label}`}
                    value={(sourceEdits[source.id] ?? source).discipline}
                    onChange={(event) => patchSavedSource(source, { discipline: event.target.value as CadSourceDiscipline })}
                    data-testid={`saved-discipline-${source.id}`}
                  >
                    {(['PFD', 'P&ID', 'Shared'] as const).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  {['project-example', 'markup-reference'].includes((sourceEdits[source.id] ?? source).category) && (
                    <input
                      aria-label={`Neutral project code for ${source.label}`}
                      placeholder="Neutral project code"
                      value={(sourceEdits[source.id] ?? source).projectLabel ?? ''}
                      onChange={(event) => patchSavedSource(source, { projectLabel: event.target.value })}
                      data-testid={`saved-project-${source.id}`}
                    />
                  )}
                  <button className="btn subtle local-library-save-row" type="button"
                    onClick={() => void saveSavedSource(source)} data-testid={`button-save-source-${source.id}`}>
                    <Save size={12} /> Save
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="local-library-limit">
        Uploaded DWGs are stored and categorized, but their own blocks and layers are not extracted yet.
      </p>
    </section>
  );
}
