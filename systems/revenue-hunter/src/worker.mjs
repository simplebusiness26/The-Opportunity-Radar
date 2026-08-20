import { discoverBusinesses, inspectWebsite, findContacts, createPaymentLink, domainFromUrl } from './adapters.mjs';
import { inferOpportunitySignals, chooseBestFinding, scoreProspect, priceOffer } from './scoring.mjs';
import { RevenueRepository } from './repository.mjs';

const J = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const readJson = async req => req.json().catch(() => ({}));
const esc = s => String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const safeJson = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

function estimateInputs(prospect, best, inspection) {
  const evidenceCount = inspection.findings.length;
  const noWebsite = !prospect.website;
  return {
    pain: best.severity,
    buyerClarity: prospect.phone || prospect.website ? 80 : 52,
    speedToCash: best.severity >= 75 ? 84 : 68,
    deliveryEase: noWebsite || ['NO_QUOTE_FLOW','NO_BOOKING_FLOW','NO_STRUCTURED_FORM','WEAK_CTA'].includes(best.code) ? 86 : 64,
    evidence: noWebsite ? 82 : Math.min(95, 50 + evidenceCount * 7),
    margin: 80,
    contactability: prospect.phone ? 82 : (prospect.website ? 70 : 42)
  };
}

function profileFromInspection(prospect, raw = {}) {
  const markdown = String(raw.markdown || '');
  const lines = markdown.split('\n')
    .map(x => x.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter(x => x.length >= 4 && x.length <= 72)
    .filter(x => !/^(home|menu|contact|about|privacy|cookies|terms|skip|facebook|instagram|login)$/i.test(x));
  const unique = [...new Set(lines.map(x => x.replace(/\s+/g, ' ')))];
  const headline = unique.find(x => x.length >= 12 && x.length <= 64) || `${prospect.name}`;
  const services = unique.filter(x => x !== headline && !x.toLowerCase().includes(String(prospect.name).toLowerCase())).slice(0, 6);
  return {
    headline,
    services,
    sourceTitle: raw.title || '',
    contentSample: markdown.slice(0, 1800),
    source: prospect.website ? 'website' : 'public-business-record'
  };
}

function whyChosen(prospect, best, scoring, inspection) {
  const bits = [];
  if (!prospect.website) bits.push('no discoverable website');
  if (prospect.phone) bits.push('direct phone contact available');
  if (best?.title) bits.push(best.title.toLowerCase());
  if (inspection?.findings?.length > 2) bits.push(`${inspection.findings.length} conversion signals detected`);
  bits.push(`commercial score ${scoring.total}/100`);
  return bits.join(' • ');
}

function outreachDraft(p) {
  const price = p.offer_price ? `£${p.offer_price}` : 'a fixed price';
  return {
    subject: `Quick idea for ${p.name}`,
    body: `Hi ${p.name} team,\n\nI was looking at your online customer journey and noticed ${String(p.primary_problem || 'a conversion gap').toLowerCase()}. I put together a private mobile-first demo showing how ${p.proposed_solution || 'a simpler enquiry journey'} could look for your business.\n\nIf it is useful, I can build and install the finished version for ${price}. No obligation — the demo is simply there so you can judge the idea properly.\n\nBest,\nCraig`,
    requiresHumanApproval: true
  };
}

async function investigateOne(repo, env, prospect) {
  let raw = { markdown: '', links: [], title: '' };
  let inspectionError = '';
  if (prospect?.website) {
    try { raw = await inspectWebsite({ browser: env.BROWSER, url: prospect.website }); }
    catch (error) { inspectionError = error instanceof Error ? error.message : String(error); }
  }

  let inspection = inferOpportunitySignals({ ...raw, website: prospect.website });
  if (inspectionError) {
    inspection = {
      findings: [{ code: 'INSPECTION_FAILED', severity: 58, title: 'Website needs manual review', solution: 'manual conversion audit and mobile-first rebuild concept' }],
      flags: { inspectionFailed: true }
    };
  }
  const best = chooseBestFinding(inspection.findings);
  const scoring = scoreProspect(estimateInputs(prospect, best, inspection));
  const offerPrice = priceOffer({ score: scoring.total, severity: best.severity, deliveryEase: scoring.components.deliveryEase });
  const profile = profileFromInspection(prospect, raw);
  const evidence = {
    flags: inspection.flags,
    sampledMarkdownChars: raw.markdown.length,
    linkCount: raw.links.length,
    scoring,
    inspectionError,
    profile,
    whyChosen: whyChosen(prospect, best, scoring, inspection),
    sourceWebsite: prospect.website || null
  };
  const saved = await repo.saveInvestigation(prospect.id, {
    score: scoring.total,
    primaryProblem: best.title,
    proposedSolution: best.solution,
    offerPrice,
    findings: inspection.findings,
    evidence
  });
  return { prospect: saved, score: scoring.total };
}

async function runHunt(repo, env, query, pageSize = 20) {
  const found = await discoverBusinesses({ apiKey: env.GOOGLE_PLACES_API_KEY, query, pageSize });
  const results = [];
  for (const raw of found) {
    const saved = await repo.upsertProspect(raw);
    try { results.push(await investigateOne(repo, env, saved)); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ prospect: saved, error: message });
    }
  }
  return results.sort((a,b) => Number(b.score || 0) - Number(a.score || 0));
}

function demoServiceCards(p, evidence) {
  const category = String(p.category || '').replace(/[_:]/g, ' ');
  const siteServices = evidence?.profile?.services || [];
  const defaults = [
    `${category || 'Local'} services`,
    'Repairs & maintenance',
    'Fast quote requests'
  ];
  const cards = (siteServices.length ? siteServices : defaults).slice(0, 3);
  return cards.map((s, i) => `<article class="service"><span>0${i+1}</span><h3>${esc(s)}</h3><p>${siteServices.length ? 'Highlighted from the current online presence and reorganised into a clearer customer journey.' : 'Illustrative service section for this private prototype — final wording would be confirmed with the business.'}</p></article>`).join('');
}

function demoHtml(p) {
  const evidence = safeJson(p.evidence_json);
  const profile = evidence.profile || {};
  const solution = p.proposed_solution || 'conversion-focused enquiry flow';
  const address = p.address || 'Local service area';
  const headline = profile.headline && profile.headline !== p.name ? profile.headline : `${p.name}, made easier to contact`;
  const originalLink = p.website ? `<a class="ghost" href="${esc(p.website)}" rel="noreferrer" target="_blank">Current site ↗</a>` : '';
  const phoneLink = p.phone ? `<a class="primary" href="tel:${esc(p.phone)}">Call ${esc(p.phone)}</a>` : `<a class="primary" href="#quote">Request a quote</a>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(p.name)} — Revenue Hunter private demo</title><style>
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:#f4f2ed;color:#141515}.shell{max-width:1180px;margin:auto;padding:0 22px}.notice{background:#151515;color:#eee;font-size:12px;padding:9px 20px;text-align:center}.nav{display:flex;align-items:center;justify-content:space-between;padding:22px 0}.brand{font-weight:900;letter-spacing:-.04em;font-size:21px}.navlinks{display:flex;gap:20px;align-items:center}.navlinks a{text-decoration:none;color:#222;font-size:14px}.primary,.ghost{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border-radius:999px;padding:14px 20px;font-weight:800}.primary{background:#172519;color:#fff}.ghost{border:1px solid #bbb;color:#222}.hero{display:grid;grid-template-columns:1.2fr .8fr;gap:28px;align-items:stretch;padding:46px 0 24px}.heroCopy{background:#d8f65a;border-radius:34px;padding:54px}.eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.16em;font-weight:850}.hero h1{font-size:clamp(45px,7vw,86px);line-height:.91;letter-spacing:-.07em;margin:18px 0 22px;max-width:800px}.hero p{font-size:18px;line-height:1.55;max-width:640px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px}.side{background:#172519;color:white;border-radius:34px;padding:36px;display:flex;flex-direction:column;justify-content:space-between}.side big{font-size:28px;font-weight:850;line-height:1.1}.side .meta{display:grid;gap:14px;margin-top:40px}.side .meta div{border-top:1px solid #ffffff2b;padding-top:13px}.section{padding:72px 0}.sectionHead{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:28px}.section h2{font-size:clamp(34px,5vw,58px);letter-spacing:-.05em;margin:0}.sectionHead p{max-width:480px;color:#5d625f}.services{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.service{background:#fff;border-radius:24px;padding:28px;min-height:230px;box-shadow:0 6px 30px #1110000c}.service span{font-size:12px;font-weight:900;color:#73815f}.service h3{font-size:24px;letter-spacing:-.03em}.service p{color:#666;line-height:1.55}.quote{display:grid;grid-template-columns:.8fr 1.2fr;gap:20px;background:#171818;color:white;border-radius:34px;padding:42px}.quote h2{font-size:46px;line-height:1;letter-spacing:-.05em}.form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.form input,.form select,.form textarea{width:100%;padding:16px;border:0;border-radius:14px;background:#272929;color:white;font:inherit}.form textarea,.form button,.full{grid-column:1/-1}.form button{padding:16px;border:0;border-radius:14px;background:#d8f65a;font-weight:900;font-size:16px}.fine{font-size:11px;color:#999;grid-column:1/-1}.proof{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.proof span{background:#ffffff12;border:1px solid #ffffff22;padding:10px 13px;border-radius:999px;font-size:13px}footer{padding:36px 0 60px;color:#666;font-size:13px}
  @media(max-width:760px){.shell{padding:0 15px}.nav{padding:16px 0}.navlinks a:not(.primary){display:none}.hero{grid-template-columns:1fr;padding-top:22px}.heroCopy,.side{border-radius:25px;padding:28px}.hero h1{font-size:52px}.section{padding:48px 0}.sectionHead{display:block}.services{grid-template-columns:1fr}.service{min-height:0}.quote{grid-template-columns:1fr;padding:25px;border-radius:25px}.quote h2{font-size:38px}.form{grid-template-columns:1fr}.form>*{grid-column:1/-1}.actions a{width:100%}}
  </style></head><body><div class="notice">PRIVATE REVENUE HUNTER CONCEPT — not the live ${esc(p.name)} website</div><div class="shell"><nav class="nav"><div class="brand">${esc(p.name)}</div><div class="navlinks"><a href="#services">Services</a><a href="#quote">Quote</a>${phoneLink}</div></nav><main><section class="hero"><div class="heroCopy"><div class="eyebrow">${esc(address)}</div><h1>${esc(headline)}</h1><p>A mobile-first concept built around one job: making it obvious what the business does and turning interested visitors into a clear enquiry.</p><div class="actions">${phoneLink}${originalLink}</div></div><aside class="side"><div><div class="eyebrow">Revenue opportunity</div><big>${esc(p.primary_problem || 'Customer journey can be stronger')}</big></div><div class="meta"><div><small>Proposed upgrade</small><br><strong>${esc(solution)}</strong></div><div><small>Indicative implementation</small><br><strong>£${esc(p.offer_price || '—')}</strong></div></div></aside></section><section class="section" id="services"><div class="sectionHead"><h2>Clearer services.<br>Less friction.</h2><p>This private concept reorganises the available business information into a fast mobile journey rather than inventing testimonials, ratings or claims.</p></div><div class="services">${demoServiceCards(p,evidence)}</div></section><section class="section"><div class="quote" id="quote"><div><div class="eyebrow">Fast enquiry</div><h2>Turn interest into a proper lead.</h2><p>Customers can describe the job, share the basics and make the next step obvious.</p><div class="proof"><span>Mobile-first</span><span>Structured enquiry</span><span>Clear callback path</span></div></div><form class="form" onsubmit="event.preventDefault();alert('Private demo only — nothing was submitted.')"><input placeholder="Your name"><input placeholder="Phone number"><input placeholder="Postcode"><select><option>What do you need help with?</option><option>New project</option><option>Repair / maintenance</option><option>Quote / advice</option></select><textarea rows="5" placeholder="Tell us a little about the job"></textarea><button>Request my quote</button><div class="fine">Private sales prototype. This form does not send or store customer information.</div></form></div></section></main><footer>Revenue Hunter private concept for ${esc(p.name)} • Generated from public business information${p.website ? ' and the existing website' : ''}.</footer></div></body></html>`;
}

function dashboardHtml() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090b0e"><title>Revenue Hunter</title><style>
  *{box-sizing:border-box}body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;margin:0;background:#090b0e;color:#f4f5f6}.w{max-width:1080px;margin:auto;padding:24px}.top{padding:30px 0 12px}.top h1{font-size:clamp(42px,8vw,78px);letter-spacing:-.065em;line-height:.9;margin:0}.top p{color:#9ca3ad;max-width:650px;font-size:16px}.hunt{background:#141820;border:1px solid #252b36;border-radius:24px;padding:18px;margin:20px 0}.hunt form{display:flex;gap:10px}.hunt input{min-width:0;flex:1;background:#fff;color:#111;border:0;padding:16px;border-radius:14px;font:inherit}.hunt button{background:#ddff47;color:#111;border:0;padding:15px 22px;border-radius:14px;font-weight:900;font-size:16px}.msg{font-size:13px;color:#aab1ba;margin:12px 2px 0}.stats{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 26px}.pill{background:#171d28;border:1px solid #273142;padding:9px 12px;border-radius:99px;font-size:13px}.heading{display:flex;justify-content:space-between;align-items:end;margin:30px 0 14px}.heading h2{font-size:28px;margin:0}.heading span{font-size:12px;color:#7f8791}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.prospect{background:#13171d;border:1px solid #242b35;border-radius:22px;padding:20px;overflow:hidden}.prospectTop{display:flex;justify-content:space-between;gap:12px}.business{font-size:23px;font-weight:850;letter-spacing:-.035em}.score{width:58px;height:58px;border-radius:18px;background:#ddff47;color:#101210;display:grid;place-items:center;font-size:20px;font-weight:950;flex:0 0 auto}.score.na{background:#2a303a;color:#adb5c0}.meta{font-size:12px;color:#848d99;margin:6px 0 17px}.problem{font-size:18px;font-weight:800;margin-bottom:8px}.fix{color:#b6bdc6;line-height:1.45;font-size:14px}.why{background:#0c0f13;border-radius:14px;padding:12px;margin:15px 0;font-size:12px;line-height:1.45;color:#939da9}.money{display:flex;justify-content:space-between;padding:13px 0;border-top:1px solid #242b35;border-bottom:1px solid #242b35;margin-bottom:14px}.money b{font-size:18px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.actions a,.actions button{display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none;padding:11px;border-radius:12px;font:inherit;font-weight:800;font-size:13px;border:1px solid #343c48;background:#1b212a;color:#f5f6f7}.actions .demo{background:#ddff47;color:#111;border-color:#ddff47}.empty{padding:35px;border:1px dashed #343b46;border-radius:20px;color:#929aa5;text-align:center}
  @media(max-width:720px){.w{padding:17px}.top{padding-top:22px}.hunt{padding:13px}.hunt form{display:grid}.hunt button{width:100%}.grid{grid-template-columns:1fr}.prospect{padding:17px}.actions{grid-template-columns:1fr 1fr}.heading{margin-top:24px}}
  </style></head><body><div class="w"><header class="top"><h1>Revenue<br>Hunter</h1><p>Find businesses with visible commercial problems, investigate the opportunity and build something convincing enough to start a sales conversation.</p></header><section class="hunt"><form id="hunt"><input id="q" value="roofers in Brighton" aria-label="Search" placeholder="e.g. roofers in Brighton"><button>Hunt opportunities</button></form><div id="msg" class="msg">Free discovery mode • deeper website investigation runs automatically when a website is available.</div></section><div id="stats" class="stats"></div><div class="heading"><h2>Top prospects</h2><span id="count"></span></div><div id="prospects" class="grid"><div class="empty">Loading opportunities…</div></div></div><script>
  const E=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const evidence=p=>{try{return JSON.parse(p.evidence_json||'{}')}catch{return {}}};
  function card(p){const ev=evidence(p),score=p.score==null?'—':Math.round(Number(p.score)),why=ev.whyChosen||'Awaiting evidence summary';const original=p.website?'<a href="'+E(p.website)+'" target="_blank" rel="noreferrer">Original ↗</a>':'<button disabled>No site found</button>';return '<article class="prospect"><div class="prospectTop"><div><div class="business">'+E(p.name)+'</div><div class="meta">'+E(p.category||'business')+' • '+E(p.address||'location not listed')+' • '+E(p.stage)+'</div></div><div class="score '+(p.score==null?'na':'')+'">'+score+'</div></div><div class="problem">'+E(p.primary_problem||'Investigation pending')+'</div><div class="fix">'+E(p.proposed_solution||'Revenue Hunter is still analysing this prospect.')+'</div><div class="why"><strong>WHY IT CHOSE THIS:</strong><br>'+E(why)+'</div><div class="money"><span>Indicative offer</span><b>'+(p.offer_price?'£'+E(p.offer_price):'—')+'</b></div><div class="actions"><a class="demo" href="/demo/'+E(p.id)+'">View custom demo</a>'+original+'<a href="/api/prospects/'+E(p.id)+'" target="_blank">Evidence</a><a href="/api/prospects/'+E(p.id)+'/outreach-draft" target="_blank">Outreach draft</a></div></article>'}
  async function load(){const [d,p]=await Promise.all([fetch('/api/dashboard').then(r=>r.json()),fetch('/api/prospects?limit=50').then(r=>r.json())]);document.querySelector('#stats').innerHTML=(d.stages||[]).map(s=>'<span class="pill">'+E(s.stage)+': '+E(s.count)+'</span>').join('');document.querySelector('#count').textContent=p.length+' saved';document.querySelector('#prospects').innerHTML=p.length?p.map(card).join(''):'<div class="empty">No prospects yet. Run a hunt above.</div>'}
  document.querySelector('#hunt').onsubmit=async e=>{e.preventDefault();const q=document.querySelector('#q').value.trim();const msg=document.querySelector('#msg');msg.textContent='Finding, investigating and ranking prospects… this can take a little while.';const r=await fetch('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,pageSize:20})});if(r.ok){const d=await r.json();msg.textContent='Run complete: '+d.count+' prospects processed. Highest-value opportunities are shown first.'}else{msg.textContent='Run failed: '+await r.text()}await load()};load();
  </script></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const repo = new RevenueRepository(env.REVENUE_DB);
    try {
      if (url.pathname === '/' && request.method === 'GET') return new Response(dashboardHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (url.pathname === '/health') return J({ ok: true, system: 'revenue-hunter', version: '0.2.0', isolation: 'independent', discovery: env.GOOGLE_PLACES_API_KEY ? 'google_places' : 'openstreetmap_free' });
      if (url.pathname === '/api/dashboard') return J(await repo.dashboard());
      if (url.pathname === '/api/prospects' && request.method === 'GET') return J(await repo.list(Number(url.searchParams.get('limit') || 50)));
      if (url.pathname === '/api/run' && request.method === 'POST') {
        const b = await readJson(request); if (!b.query) return J({ error: 'query required' }, 400);
        const results = await runHunt(repo, env, b.query, b.pageSize || 20);
        return J({ query: b.query, count: results.length, investigated: results.filter(x=>x.score!=null).length, results }, 201);
      }
      if (url.pathname === '/api/hunt' && request.method === 'POST') {
        const b = await readJson(request); if (!b.query) return J({ error: 'query required' }, 400);
        const found = await discoverBusinesses({ apiKey: env.GOOGLE_PLACES_API_KEY, query: b.query, pageSize: b.pageSize || 20 });
        const saved = []; for (const p of found) saved.push(await repo.upsertProspect(p));
        return J({ query: b.query, count: saved.length, prospects: saved }, 201);
      }
      const inv = url.pathname.match(/^\/api\/prospects\/([^/]+)\/investigate$/);
      if (inv && request.method === 'POST') {
        const p = await repo.get(inv[1]); if (!p) return J({ error: 'not found' }, 404);
        const result = await investigateOne(repo, env, p);
        return J(result.prospect);
      }
      const enrich = url.pathname.match(/^\/api\/prospects\/([^/]+)\/enrich$/);
      if (enrich && request.method === 'POST') {
        const p = await repo.get(enrich[1]); if (!p) return J({ error: 'not found' }, 404);
        const contacts = await findContacts({ apiKey: env.HUNTER_API_KEY, domain: domainFromUrl(p.website), limit: 5 });
        return J(await repo.saveContacts(p.id, contacts));
      }
      const draft = url.pathname.match(/^\/api\/prospects\/([^/]+)\/outreach-draft$/);
      if (draft && request.method === 'GET') {
        const p = await repo.get(draft[1]); if (!p) return J({ error: 'not found' }, 404);
        return J(outreachDraft(p));
      }
      const payment = url.pathname.match(/^\/api\/prospects\/([^/]+)\/payment-link$/);
      if (payment && request.method === 'POST') {
        const p = await repo.get(payment[1]); if (!p) return J({ error: 'not found' }, 404);
        const b = await readJson(request);
        const amount = Number(b.amountGbp || p.offer_price);
        if (!amount || amount < 1) return J({ error: 'amountGbp or prospect offer_price required' }, 400);
        return J(await createPaymentLink({ secretKey: env.STRIPE_SECRET_KEY, amountGbp: amount, description: b.description || `${p.name}: ${p.proposed_solution || 'digital service'}`, prospectId: p.id }), 201);
      }
      const outcome = url.pathname.match(/^\/api\/prospects\/([^/]+)\/outcome$/);
      if (outcome && request.method === 'POST') {
        const b = await readJson(request); if (!b.status) return J({ error: 'status required' }, 400);
        await repo.recordOutcome(outcome[1], b); return J({ ok: true });
      }
      const detail = url.pathname.match(/^\/api\/prospects\/([^/]+)$/);
      if (detail && request.method === 'GET') {
        const p = await repo.get(detail[1]); if (!p) return J({ error: 'not found' }, 404);
        return J({ ...p, evidence: safeJson(p.evidence_json), findings: safeJson(p.findings_json), contacts: await repo.contacts(p.id) });
      }
      const demo = url.pathname.match(/^\/demo\/([^/]+)$/);
      if (demo && request.method === 'GET') {
        const p = await repo.get(demo[1]); if (!p) return new Response('Not found',{status:404});
        return new Response(demoHtml(p), { headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' } });
      }
      if (url.pathname === '/api/exchange/export' && request.method === 'GET') {
        const prospects = await repo.list(20);
        return J({ contract: 'revenue-hunter.opportunities.v1', generatedAt: new Date().toISOString(), items: prospects.filter(p=>Number(p.score)>=70).map(p=>({ externalRef:p.id, title:p.name, kind:'near_term_revenue', score:p.score, problem:p.primary_problem, proposedSolution:p.proposed_solution, indicativePrice:p.offer_price })) });
      }
      return J({ error: 'not found' }, 404);
    } catch (e) { return J({ error: e instanceof Error ? e.message : String(e) }, 500); }
  },
  async scheduled(_controller, env, ctx) {
    if (!env.DEFAULT_HUNT_QUERY) return;
    ctx.waitUntil((async () => {
      const repo = new RevenueRepository(env.REVENUE_DB);
      await runHunt(repo, env, env.DEFAULT_HUNT_QUERY, Number(env.DEFAULT_HUNT_SIZE || 20));
    })());
  }
};
