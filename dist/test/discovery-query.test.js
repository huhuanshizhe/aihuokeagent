import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderQueryBudget } from '../scan/discovery-query.js';
test('provider query budget is bounded by result demand and a hard ceiling', () => {
    assert.equal(getProviderQueryBudget(20, 12), 6);
    assert.equal(getProviderQueryBudget(3, 12), 3);
    assert.equal(getProviderQueryBudget(20, 2), 2);
    assert.equal(getProviderQueryBudget(0, 0), 1);
});
//# sourceMappingURL=discovery-query.test.js.map