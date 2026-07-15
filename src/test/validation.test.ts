import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePipelineRequest, RequestValidationError } from '../api/validation.js';

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
