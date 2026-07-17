/**
 * Silent API auth for local debug UI.
 * Loads SERVICE_API_KEY from GET /api/health when EXPOSE_API_KEY_IN_UI=true.
 * Does not render any input — requests automatically attach X-Api-Key.
 */
(function (global) {
  const STORAGE_KEY = 'vertax.ui.api_key';
  let cachedKey = '';

  try {
    cachedKey = sessionStorage.getItem(STORAGE_KEY) || '';
  } catch {
    cachedKey = '';
  }

  function getApiKey() {
    return cachedKey;
  }

  function setApiKey(key) {
    cachedKey = (key || '').trim();
    try {
      if (cachedKey) sessionStorage.setItem(STORAGE_KEY, cachedKey);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
  }

  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    const key = getApiKey();
    if (key) headers['X-Api-Key'] = key;
    return headers;
  }

  async function ensureApiKey(apiBase) {
    const base = apiBase || '';
    try {
      const res = await fetch(`${base}/api/health`, { cache: 'no-store' });
      const data = await res.json();
      if (typeof data.apiKey === 'string' && data.apiKey.trim()) {
        setApiKey(data.apiKey.trim());
      }
      return {
        authRequired: Boolean(data.authRequired),
        hasKey: Boolean(getApiKey()),
      };
    } catch {
      return { authRequired: false, hasKey: Boolean(getApiKey()) };
    }
  }

  /** Drop-in fetch that always attaches X-Api-Key when available. */
  async function apiFetch(input, init) {
    const next = Object.assign({}, init || {});
    const headers = new Headers(next.headers || {});
    const key = getApiKey();
    if (key && !headers.has('X-Api-Key') && !headers.has('Authorization')) {
      headers.set('X-Api-Key', key);
    }
    next.headers = headers;
    return fetch(input, next);
  }

  global.VertaxAuth = {
    getApiKey,
    setApiKey,
    authHeaders,
    ensureApiKey,
    apiFetch,
  };
})(window);
