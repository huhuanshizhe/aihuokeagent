import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateIdentity, normalizeDomain, rankCandidateForEnrichment, selectCandidatesForEnrichment, } from '../pipeline/candidate-utils.js';
function candidate(overrides = {}) {
    return {
        id: 'candidate-1',
        externalId: 'external-1',
        sourceUrl: 'https://source.example/item',
        displayName: 'Acme GmbH',
        candidateType: 'COMPANY',
        ...overrides,
    };
}
test('normalizeDomain produces a stable host identity', () => {
    assert.equal(normalizeDomain('https://www.Example.com/products?q=1'), 'example.com');
    assert.equal(normalizeDomain('example.com/'), 'example.com');
    assert.equal(normalizeDomain('not a domain'), undefined);
});
test('candidate identity deduplicates providers by company domain', () => {
    const fromMaps = candidate({ externalId: 'maps-1', website: 'https://www.acme.de/contact' });
    const fromApollo = candidate({ externalId: 'apollo-8', website: 'acme.de' });
    assert.equal(buildCandidateIdentity(fromMaps), 'domain:acme.de');
    assert.equal(buildCandidateIdentity(fromApollo), 'domain:acme.de');
});
test('candidate identity only falls back to name when country is known', () => {
    assert.equal(buildCandidateIdentity(candidate({ website: undefined, country: 'DE' })), 'name-country:acme:de');
    assert.equal(buildCandidateIdentity(candidate({ website: undefined, country: undefined })), undefined);
});
test('selection prioritizes evidence-rich companies and excludes contacts', () => {
    const sparse = candidate({ id: 'sparse', displayName: 'Sparse', matchScore: 0.7 });
    const rich = candidate({
        id: 'rich',
        displayName: 'Rich',
        matchScore: 0.7,
        website: 'https://rich.example',
        email: 'sales@rich.example',
        description: 'Industrial distributor',
        country: 'DE',
    });
    const contact = candidate({ id: 'contact', displayName: 'Buyer', candidateType: 'CONTACT', matchScore: 1 });
    assert.ok(rankCandidateForEnrichment(rich).score > rankCandidateForEnrichment(sparse).score);
    const result = selectCandidatesForEnrichment([sparse, contact, rich], 1);
    assert.equal(result.selected[0].candidate.id, 'rich');
    assert.equal(result.skipped.nonCompany, 1);
    assert.equal(result.skipped.belowLimit, 1);
});
//# sourceMappingURL=candidate-utils.test.js.map