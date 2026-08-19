const json = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || body?.errors?.[0]?.details || `HTTP ${res.status}`);
  return body;
};

export async function discoverBusinesses({ apiKey, query, pageSize = 10 }) {
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not configured');
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.primaryType,places.rating,places.userRatingCount'
    },
    body: JSON.stringify({ textQuery: query, pageSize: Math.min(20, Math.max(1, pageSize)) })
  });
  const body = await json(res);
  return (body.places || []).map(p => ({
    externalId: p.id,
    name: p.displayName?.text || 'Unknown business',
    address: p.formattedAddress || '',
    website: p.websiteUri || '',
    phone: p.nationalPhoneNumber || '',
    category: p.primaryType || '',
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    source: 'google_places'
  }));
}

export async function inspectWebsite({ browser, url }) {
  if (!url) return { markdown: '', links: [], error: 'No website' };
  if (!browser?.quickAction) throw new Error('Cloudflare Browser Run BROWSER binding is not configured');
  const [markdownRes, linksRes] = await Promise.all([
    browser.quickAction('markdown', { url, gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 } }),
    browser.quickAction('links', { url, visibleLinksOnly: true, excludeExternalLinks: false, gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 } })
  ]);
  const markdown = await markdownRes.text();
  const linksBody = await linksRes.json().catch(() => []);
  const links = Array.isArray(linksBody) ? linksBody : (linksBody?.result || []);
  return { markdown, links };
}

export async function findContacts({ apiKey, domain, limit = 5 }) {
  if (!apiKey) throw new Error('HUNTER_API_KEY is not configured');
  if (!domain) return [];
  const u = new URL('https://api.hunter.io/v2/domain-search');
  u.searchParams.set('domain', domain);
  u.searchParams.set('limit', String(Math.min(10, Math.max(1, limit))));
  u.searchParams.set('api_key', apiKey);
  const body = await json(await fetch(u));
  return (body?.data?.emails || []).map(e => ({
    email: e.value,
    type: e.type || '',
    confidence: e.confidence ?? 0,
    firstName: e.first_name || '',
    lastName: e.last_name || '',
    position: e.position || '',
    seniority: e.seniority || '',
    department: e.department || ''
  })).sort((a, b) => b.confidence - a.confidence);
}

export async function createPaymentLink({ secretKey, amountGbp, description, prospectId }) {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');
  const params = new URLSearchParams();
  params.set('line_items[0][price_data][currency]', 'gbp');
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(Number(amountGbp) * 100)));
  params.set('line_items[0][price_data][product_data][name]', description || 'Digital services');
  params.set('line_items[0][quantity]', '1');
  params.set('metadata[revenue_hunter_prospect_id]', prospectId);
  const res = await fetch('https://api.stripe.com/v1/payment_links', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const body = await json(res);
  return { id: body.id, url: body.url, active: body.active };
}

export function domainFromUrl(value = '') {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
}
