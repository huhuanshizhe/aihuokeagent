import test from 'node:test';
import assert from 'node:assert/strict';
import { addEvidence, resolveEvidence, type FieldEvidence } from '../enrich/evidence.js';
import { extractContactEvidence, normalizeWebsiteUrl } from '../enrich/website-crawler.js';

test('official website evidence wins a conflicting lower-confidence search result', () => {
  const evidence: FieldEvidence[] = [];
  addEvidence(evidence, 'website', 'https://directory.example/acme', 'exa', 0.55);
  addEvidence(evidence, 'website', 'https://acme.co.th', 'official_website', 0.94);
  const resolved = resolveEvidence('website', evidence);
  assert.equal(resolved.value, 'https://acme.co.th');
  assert.equal(resolved.conflict?.resolvedValue, 'https://acme.co.th');
});

test('website extraction preserves first-party contact evidence and LinkedIn', () => {
  const result = extractContactEvidence(`
    <a href="mailto:sales@acme.co.th">Email</a>
    <a href="tel:+66 2 123 4567">Call</a>
    <a href="https://www.linkedin.com/company/acme-thailand/">LinkedIn</a>
  `, 'https://acme.co.th');
  assert.deepEqual(result.emails, ['sales@acme.co.th']);
  assert.deepEqual(result.phones, ['+66 2 123 4567']);
  assert.match(result.linkedInUrl || '', /linkedin\.com\/company\/acme-thailand/);
});

test('website URL validation rejects local and private targets', () => {
  assert.equal(normalizeWebsiteUrl('localhost:3100'), undefined);
  assert.equal(normalizeWebsiteUrl('http://192.168.1.10'), undefined);
  assert.match(normalizeWebsiteUrl('acme.co.th') || '', /^https:\/\/acme\.co\.th/);
});

test('search evidence remains lower confidence than a verified official website', () => {
  const evidence: FieldEvidence[] = [];
  addEvidence(evidence, 'website', 'https://unverified.example', 'exa', 0.62);
  assert.equal(resolveEvidence('website', evidence).value, 'https://unverified.example');
  assert.equal(evidence.some(item => item.source === 'official_website'), false);
});
