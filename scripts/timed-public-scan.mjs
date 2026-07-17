const API = 'http://localhost:3100';

async function main() {
  const health = await fetch(`${API}/api/health`).then(r => r.json());
  const headers = { 'Content-Type': 'application/json' };
  if (health.apiKey) headers['X-Api-Key'] = health.apiKey;

  const wall0 = Date.now();
  const res = await fetch(`${API}/api/public/scan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ keyword: 'wedding photography', country: '泰国' }),
  });
  const json = await res.json();
  const wallMs = Date.now() - wall0;
  const d = json.data || {};
  console.log(JSON.stringify({
    httpStatus: res.status,
    ok: json.success,
    wallMs,
    apiDurationMs: d.duration,
    candidates: (d.candidates || []).length,
    totalFound: d.totalFound,
    totalFetched: d.totalFetched,
    errors: d.errors || [],
    warnings: (d.warnings || []).slice(0, 3),
    adapterKeys: d.adapterResults ? Object.keys(d.adapterResults) : undefined,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
