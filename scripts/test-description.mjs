import { ensureDescription, composeDescription } from '../dist/scan/description.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const empty = {
  externalId: '1',
  sourceUrl: 'https://maps.google.com/?cid=1',
  displayName: 'Bangkok Wedding',
  candidateType: 'COMPANY',
  city: 'Pathum Thani',
  industry: 'Wedding photographer',
  rawData: { source: 'google_places', rating: 4.6, userRatingCount: 120 },
};

const composed = composeDescription(empty);
assert(composed?.includes('Wedding photographer'), `expected role in: ${composed}`);
assert(composed?.includes('Pathum Thani'), `expected city in: ${composed}`);
assert(composed?.includes('4.6'), `expected rating in: ${composed}`);

const filled = ensureDescription(empty);
assert(filled.description === composed, 'ensureDescription should fill description');

const keep = ensureDescription({ ...empty, description: 'Official studio bio' });
assert(keep.description === 'Official studio bio', 'should keep existing description');

console.log(JSON.stringify({ ok: true, sample: composed }, null, 2));
