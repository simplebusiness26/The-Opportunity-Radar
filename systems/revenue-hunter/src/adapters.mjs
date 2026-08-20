const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options = {}, { attempts = 4, baseDelay = 900 } = {}) {
  let lastResponse;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      lastResponse = response;
      if (![429, 502, 503, 504].includes(response.status)) return response;
      if (attempt === attempts - 1) return response;
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : baseDelay * (2 ** attempt) + Math.floor(Math.random() * 350);
      await sleep(waitMs);
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await sleep(baseDelay * (2 ** attempt));
    }
  }
  return lastResponse;
}

const json = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body?.error?.message || body?.errors?.[0]?.details || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return body;
};

const OSM_CATEGORIES = {
  roofer: { tags: [['craft','roofer']], name: 'roof|roofing|roofs' },
  roofers: { tags: [['craft','roofer']], name: 'roof|roofing|roofs' },
  roofing: { tags: [['craft','roofer']], name: 'roof|roofing|roofs' },
  plumber: { tags: [['craft','plumber']], name: 'plumb|heating|boiler' },
  plumbers: { tags: [['craft','plumber']], name: 'plumb|heating|boiler' },
  plumbing: { tags: [['craft','plumber']], name: 'plumb|heating|boiler' },
  electrician: { tags: [['craft','electrician']], name: 'electric|electrical' },
  electricians: { tags: [['craft','electrician']], name: 'electric|electrical' },
  electrical: { tags: [['craft','electrician']], name: 'electric|electrical' },
  builder: { tags: [['craft','builder']], name: 'builder|building|construction' },
  builders: { tags: [['craft','builder']], name: 'builder|building|construction' },
  building: { tags: [['craft','builder']], name: 'builder|building|construction' },
  carpenter: { tags: [['craft','carpenter']], name: 'carpent|joiner|joinery' },
  carpenters: { tags: [['craft','carpenter']], name: 'carpent|joiner|joinery' },
  painter: { tags: [['craft','painter']], name: 'paint|decorat' },
  painters: { tags: [['craft','painter']], name: 'paint|decorat' },
  decorator: { tags: [['craft','painter']], name: 'paint|decorat' },
  decorators: { tags: [['craft','painter']], name: 'paint|decorat' },
  gardener: { tags: [['craft','gardener']], name: 'garden|landscap' },
  gardeners: { tags: [['craft','gardener']], name: 'garden|landscap' },
  landscaping: { tags: [['craft','landscaper'],['craft','gardener']], name: 'landscap|garden' },
  landscaper: { tags: [['craft','landscaper']], name: 'landscap' },
  landscapers: { tags: [['craft','landscaper']], name: 'landscap' },
  locksmith: { tags: [['craft','locksmith']], name: 'locksmith|locks' },
  locksmiths: { tags: [['craft','locksmith']], name: 'locksmith|locks' },
  cleaner: { tags: [['craft','cleaning']], name: 'cleaning|cleaners' },
  cleaners: { tags: [['craft','cleaning']], name: 'cleaning|cleaners' },
  cleaning: { tags: [['craft','cleaning']], name: 'cleaning|cleaners' },
  restaurant: { tags: [['amenity','restaurant']], name: '' }, restaurants: { tags: [['amenity','restaurant']], name: '' },
  cafe: { tags: [['amenity','cafe']], name: '' }, cafes: { tags: [['amenity','cafe']], name: '' },
  garage: { tags: [['shop','car_repair'],['craft','car_repair']], name: 'garage|motors|autos|car repair' },
  garages: { tags: [['shop','car_repair'],['craft','car_repair']], name: 'garage|motors|autos|car repair' },
  mechanic: { tags: [['shop','car_repair'],['craft','car_repair']], name: 'garage|motors|autos|mechanic' },
  mechanics: { tags: [['shop','car_repair'],['craft','car_repair']], name: 'garage|motors|autos|mechanic' },
  hairdresser: { tags: [['shop','hairdresser']], name: '' }, hairdressers: { tags: [['shop','hairdresser']], name: '' },
  barber: { tags: [['shop','hairdresser']], name: 'barber' }, barbers: { tags: [['shop','hairdresser']], name: 'barber' },
  dentist: { tags: [['amenity','dentist']], name: '' }, dentists: { tags: [['amenity','dentist']], name: '' },
  solicitor: { tags: [['office','lawyer']], name: 'solicitor|law' }, solicitors: { tags: [['office','lawyer']], name: 'solicitor|law' },
  lawyer: { tags: [['office','lawyer']], name: 'solicitor|law' }, lawyers: { tags: [['office','lawyer']], name: 'solicitor|law' },
  accountant: { tags: [['office','accountant']], name: 'accountant|accountancy' }, accountants: { tags: [['office','accountant']], name: 'accountant|accountancy' }
};

function splitBusinessQuery(query = '') {
  const text = String(query).trim();
  const m = text.match(/^(.+?)\s+in\s+(.+)$/i);
  if (!m) throw new Error('Use a query like "roofers in Brighton"');
  return { category: m[1].trim().toLowerCase(), location: m[2].trim() };
}

async function geocodeLocation(location) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', `${location}, UK`);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', '1');
  u.searchParams.set('countrycodes', 'gb');
  const rows = await json(await fetchWithRetry(u, { headers: { 'user-agent': 'RevenueHunter/0.3 (+https://github.com/simplebusiness26/The-Opportunity-Radar)' } }, { attempts: 3, baseDelay: 1000 }));
  if (!Array.isArray(rows) || !rows[0]?.boundingbox) throw new Error(`Could not locate "${location}" with OpenStreetMap`);
  let [south, north, west, east] = rows[0].boundingbox.map(Number);
  const latPad = Math.max(0.045, (north - south) * 0.35);
  const lonPad = Math.max(0.065, (east - west) * 0.35);
  south -= latPad; north += latPad; west -= lonPad; east += lonPad;
  return { south, west, north, east, displayName: rows[0].display_name || location };
}

function osmWebsite(tags = {}) { return tags.website || tags['contact:website'] || tags.url || tags['contact:url'] || ''; }
function osmPhone(tags = {}) { return tags.phone || tags['contact:phone'] || tags.mobile || tags['contact:mobile'] || ''; }
function osmAddress(tags = {}, fallback = '') {
  const line = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return [line, tags['addr:city'] || tags['addr:town'], tags['addr:postcode']].filter(Boolean).join(', ') || fallback;
}

function buildOverpassSelectors(config, box) {
  const bbox = `(${box.south},${box.west},${box.north},${box.east})`;
  const lines = [];
  for (const [key, value] of config.tags) lines.push(`nwr["${key}"="${value}"]["name"]${bbox};`);
  if (config.name) {
    lines.push(`nwr["name"~"${config.name}",i]${bbox};`);
    lines.push(`nwr["office"]["name"~"${config.name}",i]${bbox};`);
    lines.push(`nwr["shop"]["name"~"${config.name}",i]${bbox};`);
  }
  return lines.join('');
}

export async function discoverBusinessesFromOsm({ query, pageSize = 20 }) {
  const { category, location } = splitBusinessQuery(query);
  const config = OSM_CATEGORIES[category] || OSM_CATEGORIES[category.replace(/s$/, '')];
  if (!config) throw new Error(`Free discovery does not yet recognise category "${category}"`);
  const box = await geocodeLocation(location);
  const q = `[out:json][timeout:25];(${buildOverpassSelectors(config, box)});out center tags ${Math.min(100, Math.max(20, Number(pageSize) * 5))};`;
  const response = await fetchWithRetry('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'RevenueHunter/0.3 (+https://github.com/simplebusiness26/The-Opportunity-Radar)' },
    body: new URLSearchParams({ data: q })
  }, { attempts: 4, baseDelay: 1200 });
  const body = await json(response);
  const seen = new Set();
  const mapped = [];
  for (const e of body.elements || []) {
    const tags = e.tags || {};
    const name = String(tags.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    mapped.push({
      externalId: `osm:${e.type}:${e.id}`,
      name,
      address: osmAddress(tags, location),
      website: osmWebsite(tags),
      phone: osmPhone(tags),
      category,
      rating: null,
      ratingCount: null,
      source: 'openstreetmap',
      latitude: e.lat ?? e.center?.lat ?? null,
      longitude: e.lon ?? e.center?.lon ?? null
    });
  }
  return mapped
    .sort((a,b) => (Number(Boolean(b.website)) + Number(Boolean(b.phone))) - (Number(Boolean(a.website)) + Number(Boolean(a.phone))))
    .slice(0, Math.min(25, Math.max(5, Number(pageSize))));
}

export async function discoverBusinesses({ apiKey, query, pageSize = 20 }) {
  if (!apiKey) return discoverBusinessesFromOsm({ query, pageSize });
  const response = await fetchWithRetry('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.primaryType,places.rating,places.userRatingCount'
    },
    body: JSON.stringify({ textQuery: query, pageSize: Math.min(20, Math.max(1, pageSize)) })
  });
  const body = await json(response);
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
  if (!url) return { markdown: '', links: [], title: '', error: 'No website' };
  if (!browser?.quickAction) throw new Error('Cloudflare Browser Run BROWSER binding is not configured');
  let markdownRes;
  let linksRes;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    [markdownRes, linksRes] = await Promise.all([
      browser.quickAction('markdown', { url, gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 } }),
      browser.quickAction('links', { url, visibleLinksOnly: true, excludeExternalLinks: false, gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 } })
    ]);
    if (markdownRes.status !== 429 && linksRes.status !== 429) break;
    await sleep(800 * (2 ** attempt));
  }
  if (!markdownRes?.ok) throw new Error(`Website inspection failed (${markdownRes?.status || 'unknown'})`);
  const markdown = await markdownRes.text();
  const linksBody = await linksRes.json().catch(() => []);
  const links = Array.isArray(linksBody) ? linksBody : (linksBody?.result || []);
  const title = markdown.split('\n').map(x => x.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
  return { markdown, links, title };
}

export async function findContacts({ apiKey, domain, limit = 5 }) {
  if (!apiKey) throw new Error('HUNTER_API_KEY is not configured');
  if (!domain) return [];
  const u = new URL('https://api.hunter.io/v2/domain-search');
  u.searchParams.set('domain', domain);
  u.searchParams.set('limit', String(Math.min(10, Math.max(1, limit))));
  u.searchParams.set('api_key', apiKey);
  const body = await json(await fetchWithRetry(u));
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
  const response = await fetchWithRetry('https://api.stripe.com/v1/payment_links', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const body = await json(response);
  return { id: body.id, url: body.url, active: body.active };
}

export function domainFromUrl(value = '') {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
}
