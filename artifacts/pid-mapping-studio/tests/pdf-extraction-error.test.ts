import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractionFailureMessage, PdfExtractionError } from '../src/lib/pdf-extraction-error';

test('OCR startup failure identifies the page and gives an actionable retry', () => {
  const message = extractionFailureMessage(new PdfExtractionError(3, 'OCR startup', new Error('Failed to fetch')));
  assert.match(message, /Page 3/);
  assert.match(message, /OCR engine could not start/);
  assert.match(message, /PDF remains saved/);
});

test('memory and storage failures do not falsely claim a network problem', () => {
  assert.match(extractionFailureMessage(new PdfExtractionError(2, 'OCR reading', new Error('Out of memory'))), /processing memory/);
  assert.match(extractionFailureMessage(new DOMException('Full', 'QuotaExceededError')), /storage is full/);
});

test('arbitrary library messages and source details are not stored', () => {
  const message = extractionFailureMessage(new Error('PrivateCompany confidential drawing contents'));
  assert.doesNotMatch(message, /PrivateCompany|confidential/);
  assert.match(message, /Retry EDE/);
});
