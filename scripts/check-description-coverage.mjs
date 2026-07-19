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
  const candidates = json.data?.candidates || [];
  const withDesc = candidates.filter(c => typeof c.description === 'string' && c.description.trim());
  const samples = withDesc.slice(0, 5).map(c => ({
    name: c.displayName,
    description: c.description,
    source: c.rawData?.source || c.matchExplain?.channel,
  }));
  console.log(JSON.stringify({
    ok: json.success,
    wallMs: Date.now() - wall0,
    total: candidates.length,
    withDescription: withDesc.length,
    coverage: candidates.length ? +(withDesc.length / candidates.length).toFixed(2) : 0,
    samples,
    errors: json.data?.errors || [],
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
