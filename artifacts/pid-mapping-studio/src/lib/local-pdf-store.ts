export type Discipline = 'PFD' | 'P&ID';

export type PdfMeta = {
  id: string;
  discipline: Discipline;
  aliasNumber: number;
  alias: string;
  size: number;
  pageCount: number;
  hash: string;
  addedAt: number;
  analysisStatus?: 'queued' | 'extracting' | 'needs-review' | 'no-tags' | 'failed' | 'paused';
  analysisPagesDone?: number;
  analysisRecordCount?: number;
  analysisMessage?: string;
  autocadStatus?: 'not-connected' | 'waiting' | 'processing' | 'complete' | 'failed';
};

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

const DB_NAME = 'pid-studio-local-pdfs';
const META = 'meta';
const BYTES = 'bytes';

export class StoreError extends Error {
  code: 'too-large' | 'total-limit' | 'duplicate' | 'cancelled' | 'storage';
  constructor(code: StoreError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new StoreError('storage', 'This browser does not allow local file storage.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(META, { keyPath: 'id' }).createIndex('discipline', 'discipline');
        db.createObjectStore(BYTES);
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
        resolve(req.result);
      };
      req.onerror = () => { dbPromise = null; reject(new StoreError('storage', 'Local storage could not be opened.')); };
      req.onblocked = () => { dbPromise = null; reject(new StoreError('storage', 'Local file storage is busy in another tab. Close that tab and reload.')); };
    });
  }
  return dbPromise;
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new StoreError('storage', 'Local storage write was stopped.'));
  });
}

/** Serialises all writes so size limits cannot be bypassed by parallel tasks. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

export async function listPdfs(discipline: Discipline): Promise<PdfMeta[]> {
  const db = await openDb();
  const all = await reqDone(db.transaction(META).objectStore(META).index('discipline').getAll(discipline)) as PdfMeta[];
  return all.sort((a, b) => a.aliasNumber - b.aliasNumber);
}

export async function totalStoredBytes(): Promise<number> {
  const db = await openDb();
  const all = await reqDone(db.transaction(META).objectStore(META).getAll()) as PdfMeta[];
  return all.reduce((t, m) => t + m.size, 0);
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('hash-unsupported');
  const digest = await subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function savePdf(
  input: { discipline: Discipline; bytes: ArrayBuffer; pageCount: number; hash: string },
  shouldCommit: () => boolean,
): Promise<PdfMeta> {
  return serial(async () => {
    if (!shouldCommit()) throw new StoreError('cancelled', 'Cancelled.');
    const size = input.bytes.byteLength;
    if (size > MAX_FILE_BYTES) throw new StoreError('too-large', 'This PDF is larger than 100 MB.');
    const db = await openDb();
    const tx = db.transaction([META, BYTES], 'readwrite');
    const done = txDone(tx);
    done.catch(() => undefined);
    const store = tx.objectStore(META);
    const all = await reqDone(store.getAll()) as PdfMeta[];
    if (!shouldCommit()) { tx.abort(); throw new StoreError('cancelled', 'Cancelled.'); }
    if (all.some((m) => m.discipline === input.discipline && m.hash === input.hash)) {
      tx.abort();
      throw new StoreError('duplicate', 'This PDF has the same content as a saved file.');
    }
    const total = all.reduce((t, m) => t + m.size, 0);
    if (total + size > MAX_TOTAL_BYTES) {
      tx.abort();
      throw new StoreError('total-limit', 'Saved PDFs would pass the 500 MB total limit.');
    }
    const aliasNumber = all.filter((m) => m.discipline === input.discipline).reduce((n, m) => Math.max(n, m.aliasNumber), 0) + 1;
    const meta: PdfMeta = {
      id: globalThis.crypto?.randomUUID?.() ?? `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      discipline: input.discipline,
      aliasNumber,
      alias: `PDF ${aliasNumber}`,
      size,
      pageCount: input.pageCount,
      hash: input.hash,
      addedAt: Date.now(),
      analysisStatus: 'queued',
      analysisPagesDone: 0,
      analysisRecordCount: 0,
      autocadStatus: 'not-connected',
    };
    store.put(meta);
    tx.objectStore(BYTES).put(input.bytes, meta.id);
    try { await done; } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError('storage', 'The browser could not save this PDF. Storage may be full.');
    }
    return meta;
  });
}

export async function getPdfBytes(id: string): Promise<ArrayBuffer> {
  const db = await openDb();
  const bytes = await reqDone(db.transaction(BYTES).objectStore(BYTES).get(id)) as ArrayBuffer | undefined;
  if (!bytes) throw new StoreError('storage', 'Saved PDF data was not found.');
  return bytes;
}

export function updatePdfMeta(id: string, patch: Partial<Omit<PdfMeta, 'id' | 'discipline' | 'aliasNumber' | 'alias' | 'size' | 'pageCount' | 'hash' | 'addedAt'>>): Promise<PdfMeta> {
  return serial(async () => {
    const db = await openDb();
    const tx = db.transaction(META, 'readwrite');
    const done = txDone(tx);
    const store = tx.objectStore(META);
    const meta = await reqDone(store.get(id)) as PdfMeta | undefined;
    if (!meta) {
      tx.abort();
      throw new StoreError('storage', 'The saved PDF record could not be found.');
    }
    const updated = { ...meta, ...patch };
    store.put(updated);
    await done;
    return updated;
  });
}

export function deletePdfs(ids: string[]): Promise<void> {
  return serial(async () => {
    const db = await openDb();
    const tx = db.transaction([META, BYTES], 'readwrite');
    ids.forEach((id) => { tx.objectStore(META).delete(id); tx.objectStore(BYTES).delete(id); });
    await txDone(tx);
  });
}

export async function clearDiscipline(discipline: Discipline): Promise<void> {
  const items = await listPdfs(discipline);
  await deletePdfs(items.map((m) => m.id));
}
