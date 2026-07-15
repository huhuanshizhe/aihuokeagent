import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarketProfile, localizeIndustrialKeyword } from '../adapters/market-localization.js';
import { buildGoogleSearchPlans } from '../adapters/google-places.js';
import { buildBravePlacePlans } from '../adapters/brave-places.js';
test('Thailand market profile provides a national viewport and industrial clusters', () => {
    const profile = getMarketProfile('泰国');
    assert.equal(profile?.code, 'TH');
    assert.ok((profile?.clusters.length || 0) >= 6);
    assert.ok(profile.viewport.low.latitude < profile.viewport.high.latitude);
});
test('industrial keywords gain a Thai-language discovery variant', () => {
    assert.equal(localizeIndustrialKeyword('automotive paint booth manufacturer', 'TH'), 'ห้องพ่นสีรถยนต์');
    const plans = buildGoogleSearchPlans({ keywords: ['automotive paint booth manufacturer'], countries: ['TH'] });
    assert.equal(plans.length, 2);
    assert.equal(plans[0].regionCode, 'TH');
    assert.ok(plans[0].viewport);
    assert.equal(plans[1].languageCode, 'th');
    assert.match(plans[1].marketSegment, /Chonburi/);
});
test('Brave place plans rotate Thai industrial clusters instead of using unsupported web country targeting', () => {
    const plans = buildBravePlacePlans({ keywords: ['paint booth', 'automotive parts manufacturer'], countries: ['Thailand'] });
    assert.equal(plans[0].country, 'TH');
    assert.match(plans[0].location, /Chonburi Thailand/);
    assert.match(plans[1].location, /Rayong Thailand/);
});
test('Malaysia localization is loaded from the Market Pack rather than adapter code', () => {
    assert.equal(localizeIndustrialKeyword('pet hospital', 'MY'), 'hospital haiwan');
    const profile = getMarketProfile('马来西亚');
    assert.equal(profile?.code, 'MY');
    assert.match(profile?.clusters[0].name || '', /Kuala Lumpur/);
});
//# sourceMappingURL=market-localization.test.js.map