import { createStoredZip, type ZipFile } from './zip-binary';
import { extractPdfVectorPage, type PdfVectorStats } from './pdf-dxf-geometry';
import { writeDxf } from './dxf-writer';

export type PdfDxfJob = { aliasNumber: number; bytes: ArrayBuffer | (() => Promise<ArrayBuffer>) };
export type PdfDxfReport = { pdf: number; page: number; status: 'exported' | 'skipped'; file?: string; stats?: PdfVectorStats; warnings: string[] };

export async function buildPdfDxfPackage(
  jobs: PdfDxfJob[], scale = 1,
  onProgress?: (pdf: number, page: number, total: number) => void,
  shouldContinue: () => boolean = () => true,
): Promise<{ blob: Blob; reports: PdfDxfReport[]; exported: number }> {
  if(!jobs.length)throw new Error('Add a PDF before creating DXF pages.');
  if(!Number.isFinite(scale)||scale<=0)throw new Error('Scale multiplier must be greater than zero.');
  const [pdfjs,worker]=await Promise.all([import('pdfjs-dist'),import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
  const files: ZipFile[]=[],reports: PdfDxfReport[]=[];
  const encoder=new TextEncoder();
  let outputBytes=0;
  for(const job of jobs) {
    if(!shouldContinue())throw new Error('DXF export stopped. No download was created.');
    const bytes=typeof job.bytes==='function'?await job.bytes():job.bytes;
    const loading=pdfjs.getDocument({data:new Uint8Array(bytes.slice(0)),stopAtErrors:true});
    try {
      const pdf=await loading.promise;
      for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) {
        if(!shouldContinue())throw new Error('DXF export stopped. No download was created.');
        onProgress?.(job.aliasNumber,pageNumber,pdf.numPages);
        const page=await pdf.getPage(pageNumber);
        try {
          const operators=await page.getOperatorList({annotationMode:pdfjs.AnnotationMode.ENABLE});
          const geometry=extractPdfVectorPage(operators,pdfjs.OPS,page.getViewport({scale:1}),scale);
          if(!geometry.entities.length || (geometry.stats.imageAreaRatio>0.5 && geometry.stats.basePaths<20)) {
            reports.push({pdf:job.aliasNumber,page:pageNumber,status:'skipped',stats:geometry.stats,warnings:[
              'This page has no sufficient editable vector drawing. Scanned-image tracing is not implemented; no misleading image-only DXF was created.',
              ...geometry.warnings,
            ]});
          } else {
            const file=`PDF_${String(job.aliasNumber).padStart(3,'0')}_PAGE_${String(pageNumber).padStart(3,'0')}.dxf`;
            const content=encoder.encode(writeDxf(geometry.entities,geometry.width,geometry.height));
            if(outputBytes+content.length>250*1024*1024) {
              reports.push({pdf:job.aliasNumber,page:pageNumber,status:'skipped',warnings:[
                'The DXF download would exceed the 250 MB export limit. Export this PDF separately.',
              ]});
              continue;
            }
            outputBytes+=content.length;
            files.push({path:file,content});
            reports.push({pdf:job.aliasNumber,page:pageNumber,status:'exported',file,stats:geometry.stats,warnings:geometry.warnings});
          }
        } catch(error) {
          reports.push({pdf:job.aliasNumber,page:pageNumber,status:'skipped',warnings:[error instanceof Error?error.message:'This page could not be converted.']});
        } finally {page.cleanup();}
      }
    } finally {await loading.destroy().catch(()=>undefined);}
  }
  const exported=reports.filter(report=>report.status==='exported').length;
  if(!exported)throw new Error(`No DXF pages were created. ${reports.map(r=>`PDF ${r.pdf}, page ${r.page}: ${r.warnings[0]}`).join(' ')}`);
  files.push({path:'CONVERSION_REPORT.json',content:encoder.encode(JSON.stringify({
    format:'DXF',dxfVersion:'AC1018',dxfStructure:'modelspace-layout-linked',nativeDwg:false,
    autoCadWasRun:false,autoCadOpenVerified:false,libraryReplacementApplied:false,scaleMultiplier:scale,
    engineeringScaleVerified:false,pdfCompletenessVerified:false,sourceContentSanitized:false,pages:reports,
  },null,2))});
  files.push({path:'READ_ME.txt',content:encoder.encode(
    'PDF VECTOR TO DXF\nCopyright (c) 2026 gaurav.cbiindia.\n\n'+
    'Each exported PDF page has its own real ASCII DXF. No AutoCAD or DWT is required to create these files.\n'+
    'Open a DXF in AutoCAD and use ZOOM Extents. You can Save As DWG locally after reviewing it.\n\n'+
    'The file includes Model/Paper Space block records, entity owner links, layouts, and an initial Model view. This is a compatibility target, not proof of an AutoCAD reopen test. Do not run a LISP/batch helper to open these DXF files. If AutoCAD rejects the file, use F2 to capture its full command history.\n\n'+
    'This is raw source vector geometry, not a Legends Library-standard reconstructed drawing. Raster images are not traced. Fonts, complex clipping and fill rules may differ. Read CONVERSION_REPORT.json before use.\n'+
    'A structurally valid DXF does not prove complete PDF content transfer. PDF decoding may skip malformed or unsupported appearance streams; compare every page against its source before acceptance.\n'+
    'Coordinates are millimetres at PDF paper size times the chosen scale multiplier. Verify with a known dimension before engineering use.\n'+
    'Markup appearances use separate PDF_MARKUP layers when the PDF identifies them as annotations; baked-in markups may remain in geometry layers. No markup instruction is automatically implemented.\n'+
    'Source branding, notes and confidential details may remain in vector geometry. Review/redact before sharing. Nothing was uploaded during export.\n'+
    'DXF creation is not native DWG verification, and no AutoCAD open/save test has been performed by the browser.\n',
  )});
  return {blob:createStoredZip(files),reports,exported};
}
