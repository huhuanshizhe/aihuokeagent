import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceRegistry } from '../resources/registry.js';
import { buildDiscoveryResourcePlan } from '../resources/planner.js';
test('resource registry loads versioned market, industry, and source assets', () => {
    assert.ok(resourceRegistry.listMarkets().length >= 3);
    assert.ok(resourceRegistry.getMarket('TH'));
    assert.ok(resourceRegistry.getIndustry('pet_hospital'));
    assert.ok(resourceRegistry.getSource('th_diw_factory'));
});
test('Thailand automotive planning reuses the official factory source and local terminology', () => {
    const plan = buildDiscoveryResourcePlan({ countries: ['泰国'], industry: 'automotive manufacturing', keywords: ['automotive parts manufacturer'] });
    assert.equal(plan.marketPackId, 'market.thailand');
    assert.equal(plan.industryPackId, 'automotive_manufacturing');
    assert.ok(plan.recommendedAdapters.includes('thailand_factory'));
    assert.ok(plan.keywords.includes('ผู้ผลิตชิ้นส่วนยานยนต์'));
});
test('Malaysia pet hospital planning composes reusable packs without activating research-only sources', () => {
    const plan = buildDiscoveryResourcePlan({ countries: ['马来西亚'], industry: 'pet hospital' });
    assert.equal(plan.countryCode, 'MY');
    assert.equal(plan.marketPackId, 'market.malaysia');
    assert.equal(plan.industryPackId, 'pet_hospital');
    assert.ok(plan.keywords.includes('klinik veterinar'));
    assert.ok(plan.negativeKeywords.includes('pet grooming'));
    const researchSource = plan.sources.find(source => source.sourceCode === 'my_veterinary_directory');
    assert.equal(researchSource?.status, 'research');
    assert.ok(!plan.recommendedAdapters.includes('my_veterinary_directory'));
    assert.ok(plan.recommendedAdapters.includes('google_places'));
});
test('unknown markets degrade to global sources with an explicit warning', () => {
    const plan = buildDiscoveryResourcePlan({ countries: ['Unknownland'], keywords: ['industrial distributor'] });
    assert.ok(plan.warnings.some(warning => warning.includes('No active Market Pack')));
    assert.ok(plan.recommendedAdapters.includes('google_places'));
});
//# sourceMappingURL=resource-planner.test.js.map