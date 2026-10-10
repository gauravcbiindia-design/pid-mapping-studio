export type CadSourceCategory =
  | 'needs-review'
  | 'company-standard'
  | 'project-example'
  | 'markup-reference'
  | 'ignore';

export type CadSourceDiscipline = 'PFD' | 'P&ID' | 'Shared';

export type LocalCadSource = {
  id: string;
  label: string;
  category: CadSourceCategory;
  discipline: CadSourceDiscipline;
  bytes: number;
  projectLabel?: string;
};

export type NewLocalCadSource = LocalCadSource & {
  content: Uint8Array;
};

type StoredCadSource = LocalCadSource & {
  content: ArrayBuffer;
  createdAt: string;
};

const DATABASE_NAME = 'pid-mapping-studio-local-cad-library';
const DATABASE_VERSION = 1;
const STORE_NAME = 'source-drawings';

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser does not support local drawing-library storage.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The local drawing library could not be opened.'));
    request.onblocked = () => reject(new Error('The local drawing library is busy in another browser tab. Close the other tab and try again.'));
  });
}

export async function listLocalCadSources(): Promise<LocalCadSource[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const records = request.result as StoredCadSource[];
        resolve(records
          .map(({ id, label, category, discipline, bytes, projectLabel }) => ({
            id, label, category, discipline: discipline ?? 'Shared', bytes,
            ...(projectLabel ? { projectLabel } : {}),
          }))
          .sort((left, right) => left.label.localeCompare(right.label)));
      };
      request.onerror = () => reject(request.error ?? new Error('The local drawing library could not be read.'));
    });
  } finally {
    database.close();
  }
}

export async function saveLocalCadSources(sources: NewLocalCadSource[]): Promise<void> {
  if (!sources.length) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      for (const source of sources) {
        const exactBuffer = source.content.slice().buffer;
        const { content: _content, ...metadata } = source;
        store.put({ ...metadata, content: exactBuffer, createdAt: new Date().toISOString() } satisfies StoredCadSource);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('The local drawing library could not be saved.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('The local drawing library save was cancelled.'));
    });
  } finally {
    database.close();
  }
}

export async function updateLocalCadSource(
  id: string,
  updates: Pick<LocalCadSource, 'category' | 'discipline' | 'projectLabel'>,
): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result as StoredCadSource | undefined;
        if (!current) {
          transaction.abort();
          reject(new Error('That source drawing is no longer in the local library.'));
          return;
        }
        store.put({
          ...current,
          ...updates,
          projectLabel: updates.projectLabel?.trim() || undefined,
        });
      };
      request.onerror = () => reject(request.error ?? new Error('The source drawing could not be updated.'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('The source drawing update failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('The source drawing update was cancelled.'));
    });
  } finally {
    database.close();
  }
}
