export type ExtractionStage = 'PDF text' | 'OCR startup' | 'page image' | 'OCR reading';

export class PdfExtractionError extends Error {
  constructor(
    public readonly page: number,
    public readonly stage: ExtractionStage,
    cause: unknown,
  ) {
    super(`Page ${page}: ${stage} failed.`, { cause });
    this.name = 'PdfExtractionError';
  }
}

/** Only processing diagnostics are stored here; never include PDF contents or filenames. */
export function extractionFailureMessage(error: unknown): string {
  const cause = error instanceof PdfExtractionError ? error.cause : error;
  const name = cause instanceof Error ? cause.name : '';
  const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const context = error instanceof PdfExtractionError
    ? `Page ${error.page} stopped during ${error.stage}. `
    : 'EDE extraction stopped. ';
  if (name === 'QuotaExceededError') {
    return `${context}Browser storage is full. Back up your records before freeing space, then retry EDE. Your PDF remains saved.`;
  }
  if (/memory|allocation|out of bounds/i.test(detail)) {
    return `${context}The browser ran out of processing memory. Close other tabs and retry, or use a desktop browser. Your PDF remains saved.`;
  }
  if (/fetch|network|importscripts|load.*(worker|core|language)|failed to load/i.test(detail) ||
      (error instanceof PdfExtractionError && error.stage === 'OCR startup')) {
    return `${context}The OCR engine could not start. Check internet access to the OCR downloads, then retry EDE. Your PDF remains saved.`;
  }
  // Avoid persisting arbitrary library messages, which could include source details.
  return `${context}The PDF could not be processed${name ? ` (${name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 60)})` : ''}. Retry EDE; if it repeats, report this message. Your PDF remains saved.`;
}
