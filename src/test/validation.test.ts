import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePipelineRequest,
  parsePublicScanRequest,
  publicScanToScanOptions,
  PUBLIC_SCAN_MAX_RESULTS,
  RequestValidationError,
} from '../api/validation.js';

test('pipeline request normalizes arrays and applies safe defaults', () => {
  const parsed = parsePipelineRequest({
    keywords: [' distributor ', 'distributor', 'integrator'],
    countries: ['DE'],
  });

  assert.deepEqual(parsed.keywords, ['distributor', 'integrator']);
  assert.equal(parsed.enrichTopN, 10);
  assert.equal(parsed.enrichmentConcurrency, 3);
  assert.equal(parsed.maxResults, 25);
});

test('pipeline request requires discovery intent', () => {
  assert.throws(() => parsePipelineRequest({ countries: ['DE'] }), RequestValidationError);
});

test('pipeline request rejects enrichment-only providers as discovery sources', () => {
  assert.throws(
    () => parsePipelineRequest({ keywords: ['automation'], adapters: ['hunter'] }),
    (error: unknown) => error instanceof RequestValidationError && error.details[0]?.includes('does not support discovery'),
  );
});

test('pipeline request enforces bounded work limits', () => {
  assert.throws(
    () => parsePipelineRequest({ keywords: ['automation'], enrichTopN: 1000 }),
    RequestValidationError,
  );
});

test('public scan accepts Chinese country name and fixes maxResults', () => {
  const parsed = parsePublicScanRequest({
    keyword: ' wedding photography ',
    country: '泰国',
  });
  assert.equal(parsed.keyword, 'wedding photography');
  assert.equal(parsed.country, '泰国');
  assert.equal(parsed.countryCode, 'TH');
  assert.equal(parsed.maxResults, PUBLIC_SCAN_MAX_RESULTS);
  assert.equal(PUBLIC_SCAN_MAX_RESULTS, 20);

  const options = publicScanToScanOptions(parsed);
  assert.deepEqual(options.keywords, ['wedding photography']);
  assert.deepEqual(options.countries, ['TH']);
  assert.equal(options.maxResults, 20);
  assert.equal(options.adapters, undefined);
});

test('public scan accepts ISO country code', () => {
  const parsed = parsePublicScanRequest({ keyword: 'PLC', country: 'TH' });
  assert.equal(parsed.countryCode, 'TH');
});

test('public scan rejects missing keyword', () => {
  assert.throws(
    () => parsePublicScanRequest({ country: '泰国' }),
    RequestValidationError,
  );
});

test('public scan rejects empty keyword', () => {
  assert.throws(
    () => parsePublicScanRequest({ keyword: '   ', country: '泰国' }),
    RequestValidationError,
  );
});

test('public scan rejects unrecognized country', () => {
  assert.throws(
    () => parsePublicScanRequest({ keyword: 'test', country: 'Narnia' }),
    (error: unknown) =>
      error instanceof RequestValidationError && error.message.includes('Unrecognized country'),
  );
});
