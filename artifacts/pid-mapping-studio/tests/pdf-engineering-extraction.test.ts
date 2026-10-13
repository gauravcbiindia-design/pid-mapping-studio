import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractPdfNoteCandidates, extractTagCandidates, getOcrTileStarts, joinPdfTextItems,
} from '../src/lib/pdf-engineering-extraction';

test('detects equipment, instrument, valve, and multi-part line tag candidates', () => {
  const tags = extractTagCandidates(
    'Pump P-101, instrument FIC-204, valve PCV-203, line P-418-6113-A21PB.',
    3,
  );

  assert.deepEqual(tags.map(({ tag, type, pageNumber }) => ({ tag, type, pageNumber })), [
    { tag: 'P-101', type: 'Equipment', pageNumber: 3 },
    { tag: 'FIC-204', type: 'Instrument', pageNumber: 3 },
    { tag: 'PCV-203', type: 'Valve', pageNumber: 3 },
    { tag: 'P-418-6113-A21PB', type: 'Pipe Run', pageNumber: 3 },
  ]);
});

test('normalizes duplicate candidates on the same page', () => {
  const tags = extractTagCandidates('P-101 and P–101; FIC-204.', 1);
  assert.deepEqual(tags.map((candidate) => candidate.tag), ['P-101', 'FIC-204']);
});

test('extracts a line spec from a multi-part pipe tag without changing the pipe-run type', () => {
  const line = extractTagCandidates('Line P-418-6113-A21PB', 2)[0];
  assert.equal(line.type, 'Pipe Run');
  assert.equal(line.lineSpec, 'A21PB');
});

test('reads only clearly labelled process values near a tag', () => {
  const [line] = extractTagCandidates(
    'P-418-6113-A21PB  NOMINAL DIAMETER: 2 IN  PIPING MATERIAL: CS  FLOW: 12 M3/H  HEAT TRACING: YES  INSULATION: C',
    1,
  );

  assert.equal(line.nominalDiameter, '2 IN');
  assert.equal(line.pipingMaterial, 'CS');
  assert.equal(line.lineSpec, 'A21PB');
  assert.equal(line.flow, '12 M3/H');
  assert.equal(line.heatTracing, 'YES');
  assert.equal(line.insulation, 'C');
});

test('creates a separate Line Spec record only when the PDF labels a specification', () => {
  const specs = extractTagCandidates('LINE SPEC: A21PB', 5);
  assert.deepEqual(specs.map(({ tag, type, lineSpec }) => ({ tag, type, lineSpec })), [
    { tag: 'A21PB', type: 'Line Spec', lineSpec: 'A21PB' },
  ]);
});

test('extracts numbered drawing notes as page-linked Item Note candidates and deduplicates OCR copies', () => {
  const notes = extractPdfNoteCandidates([{
    pageNumber: 4,
    searchableText: [
      'GENERAL NOTES',
      '1. Verify the equipment connection before issuing this drawing.',
      '2. Keep all existing line identifiers unchanged during the revision.',
      'LEGEND',
      'P-101 Pump',
    ].join('\n'),
    ocrTiles: ['GENERAL NOTES\n1. Verify the equipment connection before issuing this drawing.'],
  }]);

  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map(({ tag, type, pageNumber }) => ({ tag, type, pageNumber })), [
    { tag: 'NOTE-P4-1', type: 'Item Note', pageNumber: 4 },
    { tag: 'NOTE-P4-2', type: 'Item Note', pageNumber: 4 },
  ]);
  assert.match(notes[0].description ?? '', /Verify the equipment connection/);
});

test('rejoins adjacent PDF text fragments so split CAD tag characters are not lost', () => {
  const text = joinPdfTextItems([
    { str: 'P', x: 0, y: 20, width: 5, fontSize: 10 },
    { str: '-', x: 5.2, y: 20, width: 3, fontSize: 10 },
    { str: '1', x: 8.3, y: 20, width: 5, fontSize: 10 },
    { str: '0', x: 13.4, y: 20, width: 5, fontSize: 10 },
    { str: '1', x: 18.5, y: 20, width: 5, fontSize: 10 },
    { str: 'Pump', x: 40, y: 20, width: 22, fontSize: 10 },
  ]);

  assert.equal(text, 'P-101 Pump');
  assert.equal(extractTagCandidates(text, 1)[0].tag, 'P-101');
});

test('OCR tile layout covers wide pages without tiny edge tiles', () => {
  assert.deepEqual(getOcrTileStarts(1600), [0]);
  assert.deepEqual(getOcrTileStarts(3200), [0, 1580]);
  assert.deepEqual(getOcrTileStarts(4900), [0, 1580, 3200]);
});
