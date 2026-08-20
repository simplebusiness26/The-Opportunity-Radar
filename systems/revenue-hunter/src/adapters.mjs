const json = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || body?.errors?.[0]?.details || `HTTP ${res.status}`);
  return body;
};

const OSM_TAGS = {
  roofer: ['craft','roofer'], roofers: ['craft','roofer'], roofing: ['craft','roofer'],
  plumber: ['craft','plumber'], plumbers: ['craft','plumber'], plumbing: ['craft','plumber'],
  electrician: ['craft','electrician'], electricians: ['craft','electrician'], electrical: ['craft','electrician'],
  builder: ['craft','builder'], builders: ['craft','builder'], building: ['craft','builder'],
  carpenter: ['craft','carpenter'], carpenters: ['craft','carpenter'],
  painter: ['craft','painter'], painters: ['craft','painter'], decorator: ['craft','painter'], decorators: ['craft','painter'],
  gardener: ['craft','gardener'], gardeners: ['craft','gardener'], landscaping: ['craft','landscaper'], landscaper: ['craft','landscaper'], landscapers: ['craft','landscaper'],
  locksmith: ['craft','locksmith'], locksmiths: ['craft','locksmith'],
  cleaner: ['craft','cleaning'], cleaners: ['craft','cleaning'], cleaning: ['craft','cleaning'],
  restaurant: ['amenity','restaurant'], restaurants: ['amenity','restaurant'],
  cafe: ['amenity','cafe'], cafes: ['amenity','cafe'],
  garage: ['shop','car_repair'], garages: ['shop','car_repair'], mechanic: ['shop','car_repair'], mechanics: ['shop','car_repair'],
  hairdresser: ['shop','hairdresser'], hairdressers: ['shop','hairdresser'], barber: ['shop','hairdresser'], barbers: ['shop','hairdresser'],
  dentist: ['amenity','dentist'], dentists: ['amenity','dentist'],
  solicitor: ['office','lawyer'], solicitors: ['office','lawyer'], lawyer: ['office','lawyer'], lawyers: ['office','lawyer'],
  accountant: ['office','accountant'], accountants: ['office','accountant']
};

function splitBusinessQuery(query = '') {
  const text = String(query).trim();
  const m = text.match(/^(.+?)\s+in\s+(.+)$/i);
  if (!m) throw new Error('For free OSM discovery use a query like "roofers in Brighton"');
  return { category: m[1].trim().toLowerCase(), location: m[2].trim() };
}

async function geocodeLocation(location) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', location);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', '1');
  u.searchParams.set('countrycodes', 'gb');
  const res = await fetch(u, { headers: { 'user-agent': 'RevenueHunter/0.1 (+https://github.com/simplebusiness26/The-Opportunity-Radar)' } });
  const rows = await json(res);
  if (!Array.isArray(rows) || !rows[0]?.boundingbox) throw new Error(`Could not locate "${location}" with OpenStreetMap`);
  const [south, north, west, east] = rows[0].boundingbox.map(Number);
  return { south, west, north, east, displayName: rows[0].display_name || location };
}

function osmWebsite(tags = {}) { return tags.website || tags['contact:website'] || tags.url || ''; }
function osmPhone(tags = {}) { return tags.phone || tags['contact:phone'] || tags.mobile || tags['contact:mobile'] || ''; }
function osmAddress(tags = {}) {
  const line = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return [line, tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ');
}

export async function discoverBusinessesFromOsm({ query, pageSize = 10 }) {
  const { category, location } = splitBusinessQuery(query);
  const tag = OSM_TAGS[category] || OSM_TAGS[category.replace(/s$/, '')];
  if (!tag) throw new Error(`Free OSM discovery does not yet recognise category "${category}"`);
  const [key, value] = tag;
  const box = await geocodeLocation(location);
  const q = `[out:json][timeout:20];nwr["${key}"="${value}"]["name"](${box.south},${box.west},${box.north},${box.east});out center tags ${Math.min(50, Math.max(1, Number(pageSize) * 3))};`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'RevenueHunter/0.1 (+https://github.com/simplebusiness26/The-Opportunity-Radar)' },
    body: new URLSearchParams({ data: q })
  });
  const body = await json(res);
  const mapped = (body.elements || []).map(e => ({
    externalId: `osm:${e.type}:${e.id}`,
    name: e.tags?.name || 'Unknown business',
    address: osmAddress(e.tags),
    website: osmWebsite(e.tags),
    phone: osmPhone(e.tags),
    category: `${key}:${value}`,
    rating: null,
    ratingCount: null,
    source: 'openstreetmap',
    latitude: e.lat ?? e.center?.lat ?? null,
    longitude: e.lon ?? e.center?.lon ?? null
  }));
  // Revenue Hunter's current website-investigation path needs a website, so prioritise records that have one.
  return mapped.sort((a,b) => Number(Boolean(b.website)) - Number(Boolean(a.website))).slice(0, Math.min(20, Math.max(1, pageSize)));
}

export async function discoverBusinesses({ apiKey, query, pageSize = 10 }) {
  if (!apiKey) return discoverBusinessesFromOsm({ query, pageSize });
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
