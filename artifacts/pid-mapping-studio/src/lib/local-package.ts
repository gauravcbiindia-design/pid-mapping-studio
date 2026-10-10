import masterGenerator from './master-generator-template.lsp?raw';
import { validateMapping, type DrawingMapping } from '@/lib/pid-domain';
import { createStoredZip, type ZipFile } from '@/lib/zip-binary';

const DEMO_BLOCKS = new Set(['DEMO_PUMP', 'DEMO_VALVE', 'DEMO_PI']);

function assertPackageable(mapping: DrawingMapping): void {
  if (!validateMapping(mapping)) {
    throw new Error('The mapping is incomplete or has broken record/entity links.');
  }

  const unsupported = mapping.entities.filter(
    (entity) =>
      entity.blockName !== null && !DEMO_BLOCKS.has(entity.blockName),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `The package contains ${unsupported.length} block reference(s) without a supplied local definition. Use one of the visible DEMO blocks or load an approved company block library locally.`,
    );
  }

  for (const entity of mapping.entities) {
    if (
      ['equipment', 'valve', 'instrument'].includes(entity.kind) &&
      !entity.blockName
    ) {
      throw new Error(
        `${entity.tag || entity.id} has no block name. Map a reviewed local symbol before preparing this package.`,
      );
    }
  }
}

function lispString(value: string): string {
  // Keep the adapter source ASCII-safe for Windows code pages. AutoCAD's
  // Unicode escapes survive the AutoLISP string parser; mapping.json remains
  // the source for exact text if an older drawing font cannot render a glyph.
  const flat = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
  const escaped = Array.from(flat, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint > 0xffff) {
      throw new Error(
        'The local AutoLISP adapter cannot safely encode this non-BMP character. The JSON mapping remains available; remove it from AutoCAD-bound text and retry.',
      );
    }
    return codePoint > 0x7e
      ? `\\U+${codePoint.toString(16).padStart(4, '0').toUpperCase()}`
      : character;
  }).join('');
  return `"${escaped.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function toLisp(value: unknown): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string') return lispString(value);
  if (typeof value === 'boolean') return value ? 'T' : 'nil';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('The mapping contains a non-finite number.');
    }
    return Number.isInteger(value) ? `${value}` : `${value}`;
  }
  if (Array.isArray(value)) {
    return `(${value.map(toLisp).join(' ')})`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return `(${entries
      .map(([key, entry]) => `(${lispString(key)} . ${toLisp(entry)})`)
      .join('\n  ')})`;
  }
  throw new Error('The mapping contains a value AutoLISP cannot represent.');
}

function createMappingAdapter(mapping: DrawingMapping): string {
  return `; Copyright (c) 2026 gaurav.cbiindia.
; Browser-generated adapter: mapping.json -> AutoLISP data.
; AutoCAD does not parse JSON here; this file already contains its data as a
; normal quoted AutoLISP association list. No Python or network call is used.
(setq *PID-MAPPING* '${toLisp(mapping)})
(princ "\\nSynthetic P&ID mapping data loaded.")
(princ)
`;
}

function createRunScript(): string {
  return `; Replace the folder below with the full path to the extracted ZIP.
; Open your approved company DWT in AutoCAD first, then run SCRIPT and choose
; this file. Or paste the three commands shown in README_LOCAL_AUTOCAD.txt.
(load "C:/REPLACE_WITH_EXTRACTED_FOLDER/mapping_payload.lsp")
(load "C:/REPLACE_WITH_EXTRACTED_FOLDER/master_generator.lsp")
PIDGEN
`;
}

function createReadme(mapping: DrawingMapping): string {
  return `P&ID MAPPING STUDIO — LOCAL AUTOCAD PACKAGE
Copyright (c) 2026 gaurav.cbiindia.
================================================

DEMO SCOPE
This package was assembled in the browser from a synthetic sample only.
It does not contain or represent a company drawing, approved DWT, approved
symbol library, production-ready standards, or a generated DWG.
No AutoCAD process ran during package preparation. The DWG has NOT been created, saved,
closed, reopened, or verified.

Package status
- Mapping schema: ${mapping.schemaVersion}
- Drawing: ${mapping.drawing.name}
- Mapping status: ${mapping.drawing.mappingStatus}
- Drawing entities: ${mapping.entities.length}
- Engineering records: ${mapping.records.length}
- Unresolved company/source warnings: ${mapping.unresolvedItems.length}
- AutoCAD executed: no
- Native DWG verified: no
- Run report: pid_generation_report.csv (created only after a local AutoCAD run)

FILES
- mapping.json — versioned mapping and independent record IDs.
- package_manifest.json — explicit package, AutoCAD and DWG verification states.
- mapping_payload.lsp — browser-generated adapter from JSON to a quoted
  AutoLISP data structure. AutoLISP JSON parsing is not assumed; this package
  includes its own local adapter. No additional Python/Java runtime is needed.
- master_generator.lsp — reusable AutoLISP intended to create native layers,
  block references, lightweight polylines, and editable TEXT entities. It
  attaches stable application IDs as XData and writes handles plus an immediate
  XData read-back check. This does NOT check persistence after a save/reopen.
- pid_run.scr — optional script template. Replace its placeholder path first.

LOCAL REVIEW AND RUN
1. Extract this ZIP in an approved local folder on a Windows machine with a
   licensed AutoCAD installation. Keep the package private and follow your
   organization's handling rules for company drawings.
2. Confirm your organization's permission to use any local scripts and required
   runtimes. This package needs AutoCAD; it does not require Python or Java.
3. Open a copy of the approved company DWT, or a new blank drawing if this is
   still only a synthetic test. Confirm the units and local asset policy.
4. In the AutoCAD command line, load each file using its actual extracted path:
   (load "C:/full/path/to/extracted/mapping_payload.lsp")
   (load "C:/full/path/to/extracted/master_generator.lsp")
   Then type: PIDGEN
   You may instead update pid_run.scr with both full paths and run the SCRIPT
   command. Review the script before execution.
5. Inspect the resulting layers, block references, linework, text, tags and
   PIDMAP XData. The report status CREATED_XDATA_READBACK_OK checks the ID in
   this AutoCAD session only; it is not a saved/reopened-DWG verification. The
   generator intentionally skips any entity ID already present in the drawing
   to avoid duplicates. To apply changed placements, use a clean copy or
   deliberately remove prior generated entities first.
6. Save manually as DWG. Close the drawing, reopen the saved DWG, confirm the
   entities and stable IDs still exist, and compare each reported handle in
   pid_generation_report.csv. Those local steps are required before calling the
   output a verified DWG.

IMPORTANT LIMITS
- DEMO_PUMP, DEMO_VALVE, and DEMO_PI are illustrative block definitions only.
- Every DEMO- layer, colour, linetype, and lineweight is unverified.
- The synthetic connections are explicit sample relationships, not inferred
  from geometry or evidence on a source P&ID.
- The JSON-to-LISP adapter is generated in this browser application from the
  versioned JSON. It is not a generic JSON parser for arbitrary files.
- The master generator and AutoCAD compatibility have not been exercised in
  this environment. Review and test locally on a separate copy.
`;
}

function asZipFile(path: string, content: string): ZipFile {
  return { path, content: new TextEncoder().encode(content) };
}

export async function buildAutoCadPackage(
  mapping: DrawingMapping,
): Promise<Blob> {
  assertPackageable(mapping);

  const manifest = {
    packageName: 'P&ID Mapping Studio local AutoCAD package',
    packageVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    sourceKind: 'synthetic-demo',
    autoCadExecuted: false,
    dwgCreated: false,
    dwgReopened: false,
    dwgVerified: false,
    warnings: mapping.unresolvedItems.map(({ title, detail }) => ({
      title,
      detail,
    })),
  };

  return createStoredZip([
    asZipFile('mapping.json', `${JSON.stringify(mapping, null, 2)}\n`),
    asZipFile('package_manifest.json', `${JSON.stringify(manifest, null, 2)}\n`),
    asZipFile('mapping_payload.lsp', createMappingAdapter(mapping)),
    asZipFile('master_generator.lsp', masterGenerator),
    asZipFile('pid_run.scr', createRunScript()),
    asZipFile('README_LOCAL_AUTOCAD.txt', createReadme(mapping)),
  ]);
}
