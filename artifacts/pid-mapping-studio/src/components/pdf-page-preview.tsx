import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { PdfSourceLocation } from '@/lib/engineering-data';

export type PdfPreviewMarker = {
  id: string;
  label: string;
  location: PdfSourceLocation;
};

type Props = {
  fileId: string;
  alias: string;
  pageCount: number;
  page: number;
  onPageChange: (page: number) => void;
  loadBytes: (id: string) => Promise<ArrayBuffer>;
  markers?: PdfPreviewMarker[];
  onMarkerClick?: (id: string) => void;
};

async function loadPdfjs() {
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}

export default function PdfPagePreview({
  fileId,
  alias,
  pageCount,
  page,
  onPageChange,
  loadBytes,
  markers = [],
  onMarkerClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const loadBytesRef = useRef(loadBytes);
  loadBytesRef.current = loadBytes;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth / 24) * 24));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let task: { promise: Promise<any>; destroy: () => Promise<void> } | null = null;
    setState('loading');
    (async () => {
      try {
        const [lib, bytes] = await Promise.all([loadPdfjs(), loadBytesRef.current(fileId)]);
        if (cancelled) return;
        task = lib.getDocument({ data: new Uint8Array(bytes.slice(0)) });
        const pdf = await task!.promise;
        if (cancelled) return;
        const pg = await pdf.getPage(Math.min(Math.max(page, 1), pdf.numPages));
        const base = pg.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scale = (width / base.width) * dpr;
        const viewport = pg.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '100%';
        const rt = pg.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport });
        renderTask = rt;
        await rt.promise;
        if (!cancelled) setState('ready');
      } catch (e) {
        if (cancelled || (e as { name?: string })?.name === 'RenderingCancelledException') return;
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      void task?.destroy().catch(() => undefined);
    };
  }, [fileId, page, width, retry]);

  return (
    <div className="ppv" data-testid="panel-source-preview">
      <div className="ppv-bar">
        <span className="ppv-label" data-testid="text-preview-label">Original source PDF · not generated CAD</span>
        <div className="ppv-nav">
          <button type="button" className="ppv-btn" aria-label="Previous page" disabled={page <= 1}
            onClick={() => onPageChange(page - 1)} data-testid="button-preview-prev"><ChevronLeft size={15} /></button>
          <span data-testid="text-preview-page" aria-live="polite">{alias} · page {page} of {pageCount}</span>
          <button type="button" className="ppv-btn" aria-label="Next page" disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)} data-testid="button-preview-next"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="ppv-stage" ref={boxRef}>
        <div className="ppv-canvas-wrap" style={{ visibility: state === 'ready' ? 'visible' : 'hidden' }}>
          <canvas ref={canvasRef} aria-label={`Original source page ${page} of ${alias}`} data-testid="canvas-source-preview" />
          {state === 'ready' && markers.length > 0 && (
            <div className="ppv-markers" aria-label="Extracted tag source locations">
              {markers.map((marker, index) => (
                <button
                  className="ppv-marker"
                  key={`${marker.id}-${marker.location.pageNumber}-${index}`}
                  type="button"
                  style={{
                    left: `${marker.location.x * 100}%`,
                    top: `${marker.location.y * 100}%`,
                    width: `${Math.max(marker.location.width * 100, 1.1)}%`,
                    height: `${Math.max(marker.location.height * 100, 1.2)}%`,
                  }}
                  aria-label={`OCR location for ${marker.label}; verify against the PDF`}
                  title={`${marker.label} · OCR candidate location`}
                  onClick={() => onMarkerClick?.(marker.id)}
                  data-testid={`marker-source-${marker.id}-${index}`}
                >
                  <span>{marker.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {markers.length > 0 && (
          <div className="ppv-marker-note" role="note">
            Red boxes show OCR candidate locations. Confirm each tag against the original PDF.
          </div>
        )}
        {state === 'loading' && (
          <div className="ppv-overlay" role="status" data-testid="status-preview-loading"><Loader2 size={18} className="pdf-spin" /> Rendering page</div>
        )}
        {state === 'error' && (
          <div className="ppv-overlay ppv-error" role="alert" data-testid="status-preview-error">
            <AlertTriangle size={18} /> This page could not be shown.
            <button type="button" className="btn" onClick={() => setRetry((n) => n + 1)} data-testid="button-preview-retry">Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}
