import type { EngineeringRow, PdfTagCandidate } from '@/lib/engineering-data';
import { PdfExtractionError, type ExtractionStage } from './pdf-extraction-error';

const TAG_PATTERN = /\b(?:[A-Z]{1,8}\s*[-–]\s*)+\d{1,6}[A-Z0-9]*(?:\s*[-–]\s*[A-Z0-9]{1,8}){0,3}\b/g;
const INSTRUMENT_PREFIXES = /^(?:AI|DI|FI|FIC|FIT|FQI|LI|LIC|LS|LSH|LSL|PI|PIC|PDI|PSH|PSL|TI|TIC|TSH|TSL|TT|PT|FT|LT|FC|PC|TC|LC|AT|AIT|XV|ZSO|ZSC)$/;
const VALVE_PREFIXES = /^(?:XV|HV|BV|CV|PCV|FCV|LCV|TCV|PSV|PRV|MOV|SDV|BDV|NRV)$/;
const LINE_SPEC_PATTERN = /\b(?:LINE|PIPING)\s+SPEC(?:IFICATION)?\s*[:#=-]?\s*([A-Z0-9][A-Z0-9._/-]{1,15})\b/g;
const LINE_SPEC_VALUE_PATTERN = /\b(?:LINE|PIPING)\s+SPEC(?:IFICATION)?\s*[:#=-]?\s*([A-Z0-9][A-Z0-9._/-]{1,15})\b/i;

export type PdfExtractionProgress = (page: number, total: number, method: 'PDF text' | 'OCR') => void;
export type PdfExtractionResult = {
  candidates: PdfTagCandidate[];
  pages: number;
  ocrPages: number;
};
export type PositionedPdfText = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  hasEOL?: boolean;
};

type PdfViewport = {
  width: number;
  height: number;
  convertToViewportPoint: (x: number, y: number) => number[];
};

type OcrWord = {
  text: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
};

function normalizedLocation(
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const x = Math.max(0, Math.min(1, left / pageWidth));
  const y = Math.max(0, Math.min(1, top / pageHeight));
  const x2 = Math.max(x, Math.min(1, right / pageWidth));
  const y2 = Math.max(y, Math.min(1, bottom / pageHeight));
  if (x2 - x < 0.0001 || y2 - y < 0.0001) return null;
  return { pageNumber, x, y, width: x2 - x, height: y2 - y };
}

function textItemLocation(item: PositionedPdfText, pageNumber: number, viewport: PdfViewport) {
  const points = [
    viewport.convertToViewportPoint(item.x, item.y),
    viewport.convertToViewportPoint(item.x + item.width, item.y),
    viewport.convertToViewportPoint(item.x, item.y + item.height),
    viewport.convertToViewportPoint(item.x + item.width, item.y + item.height),
  ];
  return normalizedLocation(
    pageNumber,
    viewport.width,
    viewport.height,
    Math.min(...points.map((point) => point[0] ?? 0)),
    Math.min(...points.map((point) => point[1] ?? 0)),
    Math.max(...points.map((point) => point[0] ?? 0)),
    Math.max(...points.map((point) => point[1] ?? 0)),
  );
}

function candidatesFromOcrWords(
  words: readonly OcrWord[],
  pageNumber: number,
  tile: { left: number; top: number; pageWidth: number; pageHeight: number },
): PdfTagCandidate[] {
  const candidates: PdfTagCandidate[] = [];
  for (const word of words) {
    if (!word.text || !word.bbox) continue;
    const location = normalizedLocation(
      pageNumber,
      tile.pageWidth,
      tile.pageHeight,
      tile.left + word.bbox.x0,
      tile.top + word.bbox.y0,
      tile.left + word.bbox.x1,
      tile.top + word.bbox.y1,
    );
    if (!location) continue;
    candidates.push(...extractTagCandidates(word.text, pageNumber).map((candidate) => ({
      ...candidate,
      sourceLocations: [location],
    })));
  }
  return candidates;
}

function mergeSourceLocations(
  current: PdfTagCandidate['sourceLocations'],
  additions: PdfTagCandidate['sourceLocations'],
) {
  const locations = new Map<string, NonNullable<PdfTagCandidate['sourceLocations']>[number]>();
  for (const location of [...(current ?? []), ...(additions ?? [])]) {
    const key = [
      location.pageNumber,
      location.x.toFixed(4),
      location.y.toFixed(4),
      location.width.toFixed(4),
      location.height.toFixed(4),
    ].join(':');
    if (!locations.has(key) && locations.size < 500) locations.set(key, location);
  }
  return [...locations.values()];
}

/** Rejoins adjacent PDF text fragments without inserting spaces inside CAD tags. */
export function joinPdfTextItems(items: readonly PositionedPdfText[]): string {
  let output = '';
  let previous: PositionedPdfText | undefined;
  for (const item of items) {
    const value = item.str.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (previous) {
      const fontSize = Math.max(1, (previous.fontSize + item.fontSize) / 2);
      const sameLine = Math.abs(item.y - previous.y) <= Math.max(1, fontSize * 0.3);
      const gap = item.x - (previous.x + previous.width);
      const adjacent = sameLine && gap >= -fontSize * 0.5 && gap <= fontSize * 0.35;
      output += adjacent ? '' : sameLine ? ' ' : '\n';
      if (previous.hasEOL && !output.endsWith('\n')) output += '\n';
    }
    output += value;
    previous = item;
  }
  return output;
}

export function getOcrTileStarts(length: number, tileSize = 1700, overlap = 120): number[] {
  if (length <= tileSize + overlap) return [0];
  const step = tileSize - overlap;
  const starts: number[] = [];
  for (let start = 0; start < length; start += step) {
    const remaining = length - (start + tileSize);
    if (remaining > 0 && remaining <= overlap) start = length - tileSize;
    starts.push(start);
    if (start + tileSize >= length) break;
  }
  return starts;
}

export function extractTagCandidates(text: string, pageNumber: number): PdfTagCandidate[] {
  const found = new Map<string, PdfTagCandidate>();
  const normalized = text.toUpperCase();
  for (const match of normalized.matchAll(TAG_PATTERN)) {
    const tag = match[0].replace(/[–\s]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const parts = tag.split('-').filter(Boolean);
    const parsed = tag.match(/^([A-Z]{1,8})-(\d{1,6})(.*)$/);
    if (!parsed || tag.length < 3 || parts.length > 6) continue;
    const prefix = parsed[1];
    const type: EngineeringRow['type'] = /^OPC$/.test(prefix)
      ? 'OPC'
      : VALVE_PREFIXES.test(prefix)
      ? 'Valve'
      : INSTRUMENT_PREFIXES.test(prefix)
        ? 'Instrument'
        : parts.length >= 4 || /^(?:L|LINE|PIPE)$/.test(prefix)
          ? 'Pipe Run'
          : 'Equipment';
    const start = Math.max(0, (match.index ?? 0) - 180);
    const end = Math.min(normalized.length, (match.index ?? 0) + match[0].length + 180);
    const context = normalized.slice(start, end);
    const size = context.match(/\b(?:NOMINAL\s*(?:DIA(?:METER)?|SIZE)|NPS|DN)\s*[:#=-]?\s*((?:(?:NPS|DN)\s*)?\d{1,3}(?:\s*\/\s*\d{1,2})?(?:\.\d+)?\s*(?:MM|IN(?:CH)?)?["”]?)/i)?.[1] ?? '';
    const material = context.match(/\b(?:PIPING|PIPE)\s*(?:MATERIAL|MATL)\s*[:#=-]?\s*([A-Z0-9][A-Z0-9._/-]{1,15})/i)?.[1] ?? '';
    const flow = context.match(/\b(?:DESIGN\s+FLOW|FLOW(?:\s+RATE)?)\s*[:=]?\s*([\d.,]+\s*(?:KG\/H|M3\/H|NM3\/H|T\/H|L\/S|M3\/D|GPM|M\/S)?)/i)?.[1] ?? '';
    const heatTracing = context.match(/\b(?:HEAT\s+TRACING|HEAT\s+TRACE)\s*[:=]?\s*(YES|NO|ELECTRIC|STEAM|NONE|N\/A)\b/i)?.[1] ?? '';
    const insulation = context.match(/\bINSULATION\s*[:=]?\s*([A-Z0-9][A-Z0-9._/-]{0,12})/i)?.[1] ?? '';
    const suffixParts = parsed[3].split('-').filter(Boolean);
    const lastSuffix = suffixParts.at(-1) ?? '';
    const taggedLineSpec = type === 'Pipe Run' && /[A-Z]/i.test(lastSuffix) && /\d/.test(lastSuffix) ? lastSuffix : '';
    const lineSpec = context.match(LINE_SPEC_VALUE_PATTERN)?.[1] ?? taggedLineSpec;
    const key = `${type}:${tag.toLowerCase()}`;
    if (!found.has(key)) {
      found.set(key, {
        tag,
        type,
        tagPrefix: prefix,
        tagSequence: parsed[2],
        tagSuffix: parsed[3].replace(/^-/, ''),
        pageNumber,
        nominalDiameter: size.replace(/\s+/g, ' ').trim(),
        pipingMaterial: material,
        lineSpec,
        flow,
        heatTracing,
        insulation,
      });
    }
  }
  for (const match of normalized.matchAll(LINE_SPEC_PATTERN)) {
    const tag = match[1].replace(/\s+/g, '').toUpperCase();
    const key = `Line Spec:${tag.toLowerCase()}`;
    if (!found.has(key)) {
      found.set(key, {
        tag,
        type: 'Line Spec',
        tagPrefix: 'LINE SPEC',
        tagSequence: tag,
        tagSuffix: '',
        lineSpec: tag,
        pageNumber,
      });
    }
  }
  return [...found.values()];
}

function mergeCandidates(primary: PdfTagCandidate[], additions: PdfTagCandidate[]) {
  const merged = new Map(primary.map((candidate) => [`${candidate.type}:${candidate.tag.toLowerCase()}`, { ...candidate }]));
  for (const candidate of additions) {
    const key = `${candidate.type}:${candidate.tag.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...candidate });
      continue;
    }
    existing.sourceLocations = mergeSourceLocations(existing.sourceLocations, candidate.sourceLocations);
    for (const field of [
      'nominalDiameter', 'pipingMaterial', 'lineSpec', 'flow', 'heatTracing', 'insulation',
      'equipmentType', 'equipmentName', 'equipmentClass', 'opcDrawing', 'connection',
    ] as const) {
      if (!existing[field] && candidate[field]) existing[field] = candidate[field];
    }
  }
  return [...merged.values()];
}

/**
 * Extracts candidate tags on-device. Sparse or incomplete text layers are supplemented
 * with high-resolution tiled OCR so small labels on engineering sheets remain readable.
 */
export async function extractPdfEngineeringTags(
  bytes: ArrayBuffer,
  onProgress?: PdfExtractionProgress,
  shouldContinue: () => boolean = () => true,
): Promise<PdfExtractionResult> {
  const [pdfjs, workerUrl] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  const pdf = await loading.promise;
  let ocrWorker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null = null;
  const candidatesByKey = new Map<string, PdfTagCandidate>();
  let ocrPages = 0;
  let activePage = 1;
  let stage: ExtractionStage = 'PDF text';

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      activePage = pageNumber;
      stage = 'PDF text';
      if (!shouldContinue()) throw new Error('Processing paused. Resume EDE extraction from the saved PDF.');
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const sourceViewport = page.getViewport({ scale: 1 });
      const positionedItems = content.items.flatMap((item) => {
        if (!('str' in item) || typeof item.str !== 'string' || !item.str ||
            !('transform' in item) || !Array.isArray(item.transform)) return [];
        const transform = item.transform as number[];
        return [{
          str: item.str,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          width: 'width' in item && typeof item.width === 'number' ? item.width : 0,
          height: 'height' in item && typeof item.height === 'number' ? item.height : 0,
          fontSize: Math.hypot(transform[0] ?? 0, transform[1] ?? 0) || 10,
          hasEOL: 'hasEOL' in item && item.hasEOL === true,
        }];
      });
      const embeddedText = joinPdfTextItems(positionedItems);
      let pageCandidates = extractTagCandidates(embeddedText, pageNumber);
      const locatedTextCandidates = positionedItems.flatMap((item) => {
        const location = textItemLocation(
          { ...item, height: item.height || item.fontSize },
          pageNumber,
          sourceViewport,
        );
        if (!location) return [];
        return extractTagCandidates(item.str, pageNumber).map((candidate) => ({
          ...candidate,
          sourceLocations: [location],
        }));
      });
      pageCandidates = mergeCandidates(pageCandidates, locatedTextCandidates);

      if (embeddedText.replace(/\s/g, '').length < 120 || pageCandidates.length < 20) {
        onProgress?.(pageNumber, pdf.numPages, 'OCR');
        if (!ocrWorker) {
          stage = 'OCR startup';
          const { createWorker, PSM } = await import('tesseract.js');
          ocrWorker = await createWorker('eng', 1, {
            workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
            langPath: 'https://tessdata.projectnaptha.com/4.0.0',
          });
          await ocrWorker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
        }
        const baseViewport = page.getViewport({ scale: 1 });
        stage = 'page image';
        const scale = Math.min(3.5, 3200 / Math.max(baseViewport.width, baseViewport.height));
        const viewport = page.getViewport({ scale });
        const pageCanvas = document.createElement('canvas');
        const tileCanvas = document.createElement('canvas');
        pageCanvas.width = Math.ceil(viewport.width);
        pageCanvas.height = Math.ceil(viewport.height);
        const pageContext = pageCanvas.getContext('2d', { willReadFrequently: false });
        if (!pageContext) throw new Error('This browser cannot prepare a page image for local OCR.');
        try {
          await page.render({ canvas: pageCanvas, canvasContext: pageContext, viewport }).promise;
          const tileSize = 1700;
          const overlap = 120;
          const ocrCandidates: PdfTagCandidate[] = [];
          const xStarts = getOcrTileStarts(pageCanvas.width, tileSize, overlap);
          const yStarts = getOcrTileStarts(pageCanvas.height, tileSize, overlap);
          for (const top of yStarts) {
            for (const left of xStarts) {
              if (!shouldContinue()) throw new Error('Processing paused. Resume EDE extraction from the saved PDF.');
              const width = Math.min(pageCanvas.width <= tileSize + overlap ? pageCanvas.width : tileSize, pageCanvas.width - left);
              const height = Math.min(pageCanvas.height <= tileSize + overlap ? pageCanvas.height : tileSize, pageCanvas.height - top);
              tileCanvas.width = width;
              tileCanvas.height = height;
              const tileContext = tileCanvas.getContext('2d', { willReadFrequently: false });
              if (!tileContext) throw new Error('This browser cannot prepare a page image for local OCR.');
              tileContext.drawImage(pageCanvas, left, top, width, height, 0, 0, width, height);
              stage = 'OCR reading';
              const result = await ocrWorker.recognize(tileCanvas);
              ocrCandidates.push(...extractTagCandidates(result.data.text, pageNumber));
              ocrCandidates.push(...candidatesFromOcrWords(
                (result.data as unknown as { words?: OcrWord[] }).words ?? [],
                pageNumber,
                { left, top, pageWidth: pageCanvas.width, pageHeight: pageCanvas.height },
              ));
            }
          }
          ocrPages += 1;
          pageCandidates = mergeCandidates(pageCandidates, ocrCandidates);
        } finally {
          pageCanvas.width = 0;
          pageCanvas.height = 0;
          tileCanvas.width = 0;
          tileCanvas.height = 0;
        }
      } else {
        onProgress?.(pageNumber, pdf.numPages, 'PDF text');
      }

      for (const candidate of pageCandidates) {
        const key = `${candidate.type}:${candidate.tag.toLowerCase()}`;
        const existing = candidatesByKey.get(key);
        candidatesByKey.set(
          key,
          existing ? mergeCandidates([existing], [candidate])[0] : candidate,
        );
      }
      page.cleanup();
    }
    return { candidates: [...candidatesByKey.values()], pages: pdf.numPages, ocrPages };
  } catch (error) {
    if (!shouldContinue()) throw error;
    throw new PdfExtractionError(activePage, stage, error);
  } finally {
    await ocrWorker?.terminate().catch(() => undefined);
    await loading.destroy().catch(() => undefined);
  }
}
