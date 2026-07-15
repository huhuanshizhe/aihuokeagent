import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdapterStatus } from '../config.js';
import { extractRequestApiKey } from '../api/auth.js';
test('adapter status never exposes API key previews', () => {
    const status = getAdapterStatus();
    for (const provider of Object.values(status)) {
        assert.deepEqual(Object.keys(provider), ['enabled']);
    }
});
test('API authentication accepts standard headers without exposing secrets', () => {
    assert.equal(extractRequestApiKey('Bearer service-secret', undefined), 'service-secret');
    assert.equal(extractRequestApiKey(undefined, 'service-secret'), 'service-secret');
    assert.equal(extractRequestApiKey('Basic ignored', undefined), undefined);
});
//# sourceMappingURL=config-security.test.js.map