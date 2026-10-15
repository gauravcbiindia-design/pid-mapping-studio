import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  approveCadReviewCandidate,
  createCadStandardsLibrarySeed,
  type CadLibraryItem,
  type CadReviewCandidate,
  updateReviewedCadLibraryItem,
} from '../src/lib/cad-standards.ts';
import {
  buildAutoCadDwgRunnerPackage,
  parseLinetypeDefinition,
  parseLinetypePattern,
  type ApprovedRunnerStandard,
} from '../src/lib/pdf-dwg-runner.ts';
import { parseValveMaskBoundary } from '../src/lib/valve-mask.ts';

function reviewedLayer(name: string, discipline: 'PFD' | 'P&ID' | 'Shared'): CadLibraryItem {
  return {
    id: `layer-${name}`,
    category: 'layer',
    name: `Layer · ${name}`,
    summary: '',
    sourceFile: 'local source',
    sourceKind: 'extracted-dwg',
    scope: 'company',
    reviewStatus: 'reviewed',
    canPromote: false,
    fields: [
      { label: 'CAD name', value: name },
      { label: 'Source discipline', value: discipline },
    ],
  };
}

function symbolCandidate(discipline: 'PFD' | 'P&ID' | 'Shared' = 'P&ID'): CadReviewCandidate {
  return {
    id: 'symbol-candidate',
    proposedScope: 'company',
    sourceGroup: 'local-source',
    status: 'needs-review',
    item: {
      id: 'symbol-candidate',
      category: 'symbol',
      name: 'Block · PUMP-01',
      summary: '',
      sourceFile: 'local source',
      sourceKind: 'extracted-dwg',
      scope: 'company',
      reviewStatus: 'needs-review',
      canPromote: false,
      fields: [
        { label: 'Block asset ID', value: 'block-asset-1' },
        { label: 'Block name', value: 'PUMP-01' },
        { label: 'Source drawing ID', value: 'drawing-1' },
        { label: 'Source discipline', value: discipline },
      ],
    },
  };
}

function assertLispParenthesesBalanced(source: string): void {
  let depth = 0;
  let inString = false;
  let inComment = false;
  let escaped = false;
  for (const char of source) {
    if (inComment) {
      if (char === '\n') inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === ';') inComment = true;
    else if (char === '"') inString = true;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      assert.ok(depth >= 0, 'AutoLISP closes a parenthesis before opening it');
    }
  }
  assert.equal(inString, false, 'AutoLISP ends outside a string');
  assert.equal(depth, 0, 'AutoLISP parentheses are balanced');
}

test('extracted symbols cannot be approved without an already approved compatible non-zero layer', () => {
  const library = createCadStandardsLibrarySeed();
  library.companyItems.push(reviewedLayer('PUMP-EQUIPMENT', 'P&ID'));
  library.reviewCandidates.push(symbolCandidate());

  assert.throws(
    () => approveCadReviewCandidate(library, 'symbol-candidate', 'company', [
      { label: 'Fallback category', value: 'pump' },
      { label: 'Target CAD layer', value: '0' },
    ]),
    /compatible non-zero CAD layer/,
  );
  assert.throws(
    () => approveCadReviewCandidate(library, 'symbol-candidate', 'company', [
      { label: 'Fallback category', value: 'pump' },
      { label: 'Target CAD layer', value: 'UNKNOWN-LAYER' },
    ]),
    /compatible non-zero CAD layer/,
  );
});

test('extracted symbols can be approved on a reviewed layer matching their discipline', () => {
  const library = createCadStandardsLibrarySeed();
  library.companyItems.push(reviewedLayer('PUMP-EQUIPMENT', 'P&ID'));
  library.reviewCandidates.push(symbolCandidate());

  const approved = approveCadReviewCandidate(library, 'symbol-candidate', 'company', [
    { label: 'Fallback category', value: 'pump' },
    { label: 'Target CAD layer', value: 'PUMP-EQUIPMENT' },
  ]);

  assert.equal(approved.companyItems.find((item) => item.id === 'symbol-candidate')
    ?.fields.find((field) => field.label === 'Target CAD layer')?.value, 'PUMP-EQUIPMENT');
  assert.equal(approved.reviewCandidates[0].status, 'approved');
});

test('valve mask outline is required at approval and can be updated after approval', () => {
  const library = createCadStandardsLibrarySeed();
  library.companyItems.push(reviewedLayer('PIPE_INLINE', 'P&ID'));
  library.reviewCandidates.push(symbolCandidate());

  assert.throws(
    () => approveCadReviewCandidate(library, 'symbol-candidate', 'company', [
      { label: 'Fallback category', value: 'valve' },
      { label: 'Target CAD layer', value: 'PIPE_INLINE' },
    ]),
    /reviewed valve-body mask outline is required/,
  );

  const approved = approveCadReviewCandidate(library, 'symbol-candidate', 'company', [
    { label: 'Fallback category', value: 'valve' },
    { label: 'Target CAD layer', value: 'PIPE_INLINE' },
    { label: 'Wipeout mask boundary', value: '-2,0; 0,1; 2,0; 0,-1' },
  ]);
  assert.equal(
    approved.companyItems.find((item) => item.id === 'symbol-candidate')
      ?.fields.find((field) => field.label === 'Wipeout mask boundary')?.value,
    '-2,0; 0,1; 2,0; 0,-1',
  );

  const updated = updateReviewedCadLibraryItem(approved, 'symbol-candidate', [
    { label: 'Wipeout mask boundary', value: '-1,0; 0,0.5; 1,0; 0,-0.5' },
  ]);
  assert.equal(
    updated.companyItems.find((item) => item.id === 'symbol-candidate')
      ?.fields.find((field) => field.label === 'Wipeout mask boundary')?.value,
    '-1,0; 0,0.5; 1,0; 0,-0.5',
  );
  assert.equal(updated.auditTrail[0].action, 'Reviewed valve mask updated');
});

test('AutoCAD runner keeps approved blocks as INSERT references and assigns the approved layer', async () => {
  const zip = buildAutoCadDwgRunnerPackage(
    [{ pageCount: 1, pdfBytes: new Uint8Array([37, 80, 68, 70]), discipline: 'P&ID' }],
    [{
      blockName: 'PUMP-01',
      blockAssetId: 'block-asset-1',
      fallbackCategory: 'pump',
      targetLayer: 'PUMP-EQUIPMENT',
      discipline: 'P&ID',
      sourceId: 'drawing-1',
    }],
    [{ id: 'block-asset-1', content: new Uint8Array([1, 2, 3]) }],
    [{
      name: 'PUMP-EQUIPMENT',
      category: 'layer',
      detail: 'color=3;linetype=CONTINUOUS',
      discipline: 'P&ID',
    }],
  );
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  const lisp = strFromU8(files['DOC_01.lsp']);

  assert.match(lisp, /\("pump" "SYMBOL_001" "CAD_SYMBOLS\/SYMBOL_001\.dwg" "PUMP-EQUIPMENT" nil\)/);
  assert.match(lisp, /set-insert-layer fallback target-layer/);
  assert.match(lisp, /"INSERT"/);
  assert.match(lisp, /\(cons 8 layer-name\)/);
  assert.match(lisp, /\(entmod data\)/);
  assert.doesNotMatch(lisp, /EXPLODE/i);
});

test('runner refuses layer 0 or a target layer missing from the page standards', () => {
  const baseSymbol = {
    blockName: 'PUMP-01',
    blockAssetId: 'block-asset-1',
    fallbackCategory: 'pump',
    targetLayer: 'PUMP-EQUIPMENT',
    discipline: 'P&ID' as const,
    sourceId: 'drawing-1',
  };
  const job = [{ pageCount: 1, pdfBytes: new Uint8Array([37, 80, 68, 70]), discipline: 'P&ID' as const }];
  const asset = [{ id: 'block-asset-1', content: new Uint8Array([1, 2, 3]) }];

  assert.throws(
    () => buildAutoCadDwgRunnerPackage(job, [{ ...baseSymbol, targetLayer: '0' }], asset, []),
    /non-zero target CAD layer/,
  );
  assert.throws(
    () => buildAutoCadDwgRunnerPackage(job, [baseSymbol], asset, []),
    /not included in this runner page/,
  );
});

test('linetype parsing preserves signed dash/gap lengths and rejects complex definitions', () => {
  assert.deepEqual(
    parseLinetypePattern('description=Dash;pattern=(0.5 -0.25 0.125 -0.25);patternFlags=(0 0 0 0)'),
    [0.5, -0.25, 0.125, -0.25],
  );
  assert.deepEqual(
    parseLinetypePattern('description=Simple;pattern=(1 -0.5);patternFlags=nil'),
    [1, -0.5],
  );
  assert.equal(parseLinetypePattern('pattern=(1 -0.5);patternFlags=(0 2)'), null);
  assert.equal(parseLinetypePattern('pattern=(0 0);patternFlags=(0 0)'), null);
  assert.equal(parseLinetypePattern('pattern=(1 -0.5);patternFlags=(0)'), null);
});

test('linetype extraction preserves the DATALINE SHX shape and its offsets', () => {
  const detail = [
    'description=Line Circle Line',
    'patternLength=13.5',
    'pattern=(9 -3 -1.5)',
    'patternFlags=(0 4 0)',
    'complexData=((40 . 13.5) (49 . 9.0) (74 . 0) (49 . -3.0) (74 . 4) (75 . 133) (340 . "2DAAB") (46 . 1.0) (50 . 0.0) (44 . -1.5) (45 . 0.0) (49 . -1.5) (74 . 0))',
    'shapeFonts=(("2DAAB" . "ltypeshp.shx"))',
  ].join(';');
  const definition = parseLinetypeDefinition('DATALINE', detail);

  assert.ok(definition);
  assert.equal(definition.patternLength, 13.5);
  assert.deepEqual(
    definition.segments.map((segment) => [segment.length, segment.flags]),
    [[9, 0], [-3, 4], [-1.5, 0]],
  );
  const shapeSegment = definition.segments[1];
  assert.equal(shapeSegment.flags, 4);
  if (shapeSegment.flags === 4) {
    assert.equal(shapeSegment.shapeNumber, 133);
    assert.equal(shapeSegment.shapeFile, 'ltypeshp.shx');
    assert.equal(shapeSegment.scale, 1);
    assert.equal(shapeSegment.rotation, 0);
    assert.equal(shapeSegment.offsetX, -1.5);
    assert.equal(shapeSegment.offsetY, 0);
    assert.match(shapeSegment.styleName, /^P2DWG_DATALINE_[A-Z0-9]+$/);
  }
  assert.equal(
    parseLinetypeDefinition('DATALINE', detail.replace('ltypeshp.shx', '')),
    null,
    'shape linetypes without an extracted SHX dependency must be rejected',
  );
});

test('valve mask boundary accepts a simple body outline and rejects unsafe contours', () => {
  assert.deepEqual(
    parseValveMaskBoundary('-2,0; 0,1; 2,0; 0,-1'),
    [[-2, 0], [0, 1], [2, 0], [0, -1]],
  );
  assert.throws(
    () => parseValveMaskBoundary('0,0; 2,2; 0,2; 2,0'),
    /must not cross or touch itself/,
  );
  assert.throws(
    () => parseValveMaskBoundary('0,0; 1,1; 2,2'),
    /must enclose an area/,
  );
  assert.throws(
    () => parseValveMaskBoundary('0,0; bad,1; 2,0'),
    /finite X,Y/,
  );
});

test('a valve fallback requires a reviewed mask outline and creates a shaped AutoCAD Wipeout', async () => {
  const job = [{ pageCount: 1, pdfBytes: new Uint8Array([37, 80, 68, 70]), discipline: 'P&ID' as const }];
  const valve = {
    blockName: 'VALVE_001',
    blockAssetId: 'valve-asset-1',
    fallbackCategory: 'valve',
    targetLayer: 'PIPE_INLINE',
    discipline: 'P&ID' as const,
    sourceId: 'drawing-1',
  };
  const assets = [{ id: 'valve-asset-1', content: new Uint8Array([1, 2, 3]) }];
  const standards: ApprovedRunnerStandard[] = [{
    name: 'PIPE_INLINE',
    category: 'layer',
    detail: 'color=3;linetype=CONTINUOUS',
    discipline: 'P&ID',
  }];

  assert.throws(
    () => buildAutoCadDwgRunnerPackage(job, [valve], assets, standards),
    /no reviewed body mask outline/,
  );

  const zip = buildAutoCadDwgRunnerPackage(
    job,
    [{ ...valve, wipeoutBoundary: [[-2, 0], [0, 1], [2, 0], [0, -1]] }],
    assets,
    standards,
  );
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  const lisp = strFromU8(files['DOC_01.lsp']);
  assertLispParenthesesBalanced(lisp);
  assert.match(lisp, /"SYMBOL_001" "CAD_SYMBOLS\/SYMBOL_001\.dwg" "PIPE_INLINE" \(\(-2 0\) \(0 1\) \(2 0\) \(0 -1\)\)/);
  assert.match(lisp, /"_.WIPEOUT" "_P" polyline "_Y"/);
  assert.match(lisp, /\(setvar "WIPEOUTFRAME" 0\)/);
  assert.match(lisp, /"_.DRAWORDER" fallback "" "_F"/);
  assert.match(lisp, /VALVE_BODY_WIPEOUT/);
});

test('runner carries reviewed linetypes, scale checks, and manually tagged smart 2D Pipe Runs', async () => {
  const zip = buildAutoCadDwgRunnerPackage(
    [{ pageCount: 2, pdfBytes: new Uint8Array([37, 80, 68, 70]), discipline: 'P&ID' }],
    [],
    [],
    [
      {
        name: 'PROCESS-PIPING',
        category: 'layer',
        detail: 'color=3;lineweight=35;linetype=PIPE-DASH',
        discipline: 'P&ID',
      },
      {
        name: 'PIPE-DASH',
        category: 'linetype',
        detail: 'description=Approved dash;pattern=(0.5 -0.25 0.1 -0.25);patternFlags=(0 0 0 0)',
        discipline: 'P&ID',
      },
    ],
  );
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  const lisp = strFromU8(files['DOC_01.lsp']);
  const readme = strFromU8(files['README_LOCAL_AUTOCAD.txt']);

  assertLispParenthesesBalanced(lisp);
  assert.match(lisp, /\("PIPE-DASH" "Approved dash" 1\.1 \(\(0\.5 0\) \(-0\.25 0\) \(0\.1 0\) \(-0\.25 0\)\)\)/);
  assert.match(lisp, /no Continuous fallback was applied/);
  assert.match(lisp, /collect-imported-entities beforeEntity/);
  assert.match(lisp, /PDFIMPORT produced no usable drawing entities/);
  assert.match(lisp, /Enter that dimension in millimetres/);
  assert.match(lisp, /Can you verify page /);
  assert.match(lisp, /\("PROCESS-PIPING" 3 35 "PIPE-DASH"\)/);
  assert.match(lisp, /"CALIBRATED"/);
  assert.match(lisp, /"UNVERIFIED"/);
  assert.match(lisp, /"PIDPIPE"/);
  assert.match(lisp, /"BYLAYER"/);
  assert.match(lisp, /StableID/);
  assert.match(lisp, /"PROCESS-PIPING"/);
  assert.doesNotMatch(lisp, /EXPLODE/i);
  assert.match(readme, /does not create\s+native Plant 3D intelligence/);
});

test('runner recreates an approved shape-based linetype without dropping its SHX marker', async () => {
  const detail = [
    'description=Line Circle Line',
    'patternLength=13.5',
    'pattern=(9 -3 -1.5)',
    'patternFlags=(0 4 0)',
    'complexData=((40 . 13.5) (49 . 9.0) (74 . 0) (49 . -3.0) (74 . 4) (75 . 133) (340 . "2DAAB") (46 . 1.0) (50 . 0.0) (44 . -1.5) (45 . 0.0) (49 . -1.5) (74 . 0))',
    'shapeFonts=(("2DAAB" . "ltypeshp.shx"))',
  ].join(';');
  const zip = buildAutoCadDwgRunnerPackage(
    [{ pageCount: 1, pdfBytes: new Uint8Array([37, 80, 68, 70]), discipline: 'P&ID' }],
    [],
    [],
    [
      {
        name: 'f_Inst',
        category: 'layer',
        detail: 'color=115;lineweight=-3;linetype=DATALINE',
        discipline: 'P&ID',
      },
      {
        name: 'DATALINE',
        category: 'linetype',
        detail,
        discipline: 'P&ID',
      },
    ],
  );
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  const lisp = strFromU8(files['DOC_01.lsp']);

  assertLispParenthesesBalanced(lisp);
  assert.match(lisp, /\("DATALINE" "Line Circle Line" 13\.5 \(\(9 0\) \(-3 4 133 "P2DWG_DATALINE_[A-Z0-9]+" "ltypeshp\.shx" 1 0 -1\.5 0\) \(-1\.5 0\)\)\)/);
  assert.match(lisp, /findfile fontFile/);
  assert.match(lisp, /Required linetype shape font/);
  assert.match(lisp, /\(cons 75 \(nth 2 segment\)\)/);
  assert.match(lisp, /\(cons 340 styleHandle\)/);
  assert.match(lisp, /"LTSCALE" 1\.0/);
  assert.match(lisp, /"PSLTSCALE" 0/);
});

test('runner refuses a custom layer linetype without its approved full dash pattern', () => {
  assert.throws(
    () => buildAutoCadDwgRunnerPackage(
      [{ pageCount: 1, pdfBytes: new Uint8Array([37, 80, 68, 70]), discipline: 'P&ID' }],
      [],
      [],
      [{
        name: 'PROCESS-PIPING',
        category: 'layer',
        detail: 'color=3;linetype=PIPE-DASH',
        discipline: 'P&ID',
      }],
    ),
    /will not silently substitute Continuous/,
  );
});

test('runner refuses an approved linetype whose complex segments are not fully understood', () => {
  assert.throws(
    () => buildAutoCadDwgRunnerPackage(
      [{ pageCount: 1, pdfBytes: new Uint8Array([37, 80, 68, 70]), discipline: 'P&ID' }],
      [],
      [],
      [{
        name: 'COMPLEX-UNUSED',
        category: 'linetype',
        detail: 'description=Complex;pattern=(0.5 -0.25);patternFlags=(2 0)',
        discipline: 'P&ID',
      }],
    ),
    /Approved linetype "COMPLEX-UNUSED" has an unsupported or incomplete definition/,
  );
});
