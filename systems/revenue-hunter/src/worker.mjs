import { discoverBusinesses, inspectWebsite, findContacts, domainFromUrl } from './adapters.mjs';
import { inferOpportunitySignals, chooseBestFinding, scoreProspect, priceOffer } from './scoring.mjs';
import { RevenueRepository } from './repository.mjs';

const J = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const readJson = async req => req.json().catch(() => ({}));
const esc = s => String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));

function estimateInputs(prospect, best, inspection) {
  const evidenceCount = inspection.findings.length;
  return {
    pain: best.severity,
    buyerClarity: prospect.phone || prospect.website ? 78 : 45,
    speedToCash: best.severity >= 75 ? 82 : 68,
    deliveryEase: ['NO_QUOTE_FLOW','NO_BOOKING_FLOW','NO_STRUCTURED_FORM','WEAK_CTA'].includes(best.code) ? 84 : 64,
    evidence: Math.min(95, 48 + evidenceCount * 7),
    margin: 78,
    contactability: prospect.website ? 72 : (prospect.phone ? 60 : 35)
  };
}

function demoHtml(p) {
  const solution = p.proposed_solution || 'conversion-focused enquiry flow';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.name)} demo</title><style>body{font-family:system-ui;margin:0;background:#f5f5f5;color:#111}.wrap{max-width:760px;margin:auto;padding:28px}.card{background:white;padding:28px;border-radius:18px;box-shadow:0 8px 30px #0001}.tag{font-size:12px;letter-spacing:.12em;text-transform:uppercase}.hero{font-size:42px;line-height:1.05;margin:12px 0}.muted{color:#666}.grid{display:grid;gap:12px;margin-top:20px}input,textarea,button{font:inherit;padding:14px;border-radius:10px;border:1px solid #ccc}button{background:#111;color:#fff;border:0;font-weight:700}.note{font-size:12px;margin-top:18px;color:#777}</style></head><body><div class="wrap"><div class="card"><div class="tag">Private Revenue Hunter demo</div><h1 class="hero">${esc(p.name)}</h1><p class="muted">Prototype: ${esc(solution)}. This is a sales demo only and is not connected to the business.</p><div class="grid"><input placeholder="Your name"><input placeholder="Phone number"><input placeholder="Postcode"><textarea rows="4" placeholder="What do you need help with?"></textarea><button>Request a callback</button></div><div class="note">Generated from public business information. No data is submitted from this demo.</div></div></div></body></html>`;
}

function dashboardHtml() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revenue Hunter</title><style>body{font-family:system-ui;margin:0;background:#0b0d10;color:#eee}.w{max-width:980px;margin:auto;padding:24px}.card{background:#151922;border:1px solid #252b36;border-radius:16px;padding:18px;margin:12px 0}input,button{font:inherit;padding:12px;border-radius:9px;border:1px solid #303744}input{width:min(620px,70%)}button{background:#e8ff5a;color:#111;font-weight:800}.row{display:flex;gap:10px;flex-wrap:wrap}.pill{background:#232936;padding:7px 10px;border-radius:99px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #252b36}a{color:#e8ff5a}</style></head><body><div class="w"><h1>Revenue Hunter</h1><p>Independent near-term revenue engine. Human approval remains required for outreach.</p><div class="card"><form id="hunt"><input id="q" placeholder="e.g. roofers in Brighton"><button>Hunt</button></form><p id="msg"></p></div><div id="stats" class="row"></div><div class="card"><h2>Top prospects</h2><div id="prospects">Loading…</div></div></div><script>
async function load(){const d=await fetch('/api/dashboard').then(r=>r.json());document.querySelector('#stats').innerHTML=(d.stages||[]).map(s=>'<span class="pill">'+s.stage+': '+s.count+'</span>').join('');const p=await fetch('/api/prospects').then(r=>r.json());document.querySelector('#prospects').innerHTML='<table><tr><th>Business</th><th>Score</th><th>Problem</th><th>Stage</th><th></th></tr>'+p.map(x=>'<tr><td>'+x.name+'</td><td>'+(x.score??'-')+'</td><td>'+(x.primary_problem??'-')+'</td><td>'+x.stage+'</td><td><a href="/demo/'+x.id+'">demo</a></td></tr>').join('')+'</table>'}
document.querySelector('#hunt').onsubmit=async(e)=>{e.preventDefault();let q=document.querySelector('#q').value;document.querySelector('#msg').textContent='Searching…';let r=await fetch('/api/hunt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,pageSize:10})});document.querySelector('#msg').textContent=r.ok?'Prospects added. Investigate via API or next automation run.':'Error: '+await r.text();load()};load();</script></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const repo = new RevenueRepository(env.REVENUE_DB);
    try {
      if (url.pathname === '/' && request.method === 'GET') return new Response(dashboardHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (url.pathname === '/health') return J({ ok: true, system: 'revenue-hunter', version: '0.1.0', isolation: 'independent' });
      if (url.pathname === '/api/dashboard') return J(await repo.dashboard());
      if (url.pathname === '/api/prospects' && request.method === 'GET') return J(await repo.list(Number(url.searchParams.get('limit') || 50)));
      if (url.pathname === '/api/hunt' && request.method === 'POST') {
        const b = await readJson(request); if (!b.query) return J({ error: 'query required' }, 400);
        const found = await discoverBusinesses({ apiKey: env.GOOGLE_PLACES_API_KEY, query: b.query, pageSize: b.pageSize || 10 });
        const saved = []; for (const p of found) saved.push(await repo.upsertProspect(p));
        return J({ query: b.query, count: saved.length, prospects: saved }, 201);
      }
      const inv = url.pathname.match(/^\/api\/prospects\/([^/]+)\/investigate$/);
      if (inv && request.method === 'POST') {
        const p = await repo.get(inv[1]); if (!p) return J({ error: 'not found' }, 404);
        const raw = await inspectWebsite({ browser: env.BROWSER, url: p.website });
        const inspection = inferOpportunitySignals({ ...raw, website: p.website });
        const best = chooseBestFinding(inspection.findings);
        const scoring = scoreProspect(estimateInputs(p, best, inspection));
        const offerPrice = priceOffer({ score: scoring.total, severity: best.severity, deliveryEase: scoring.components.deliveryEase });
        const saved = await repo.saveInvestigation(p.id, { score: scoring.total, primaryProblem: best.title, proposedSolution: best.solution, offerPrice, findings: inspection.findings, evidence: { flags: inspection.flags, sampledMarkdownChars: raw.markdown.length, linkCount: raw.links.length, scoring } });
        return J(saved);
      }
      const enrich = url.pathname.match(/^\/api\/prospects\/([^/]+)\/enrich$/);
      if (enrich && request.method === 'POST') {
        const p = await repo.get(enrich[1]); if (!p) return J({ error: 'not found' }, 404);
        const contacts = await findContacts({ apiKey: env.HUNTER_API_KEY, domain: domainFromUrl(p.website), limit: 5 });
        return J(await repo.saveContacts(p.id, contacts));
      }
      const outcome = url.pathname.match(/^\/api\/prospects\/([^/]+)\/outcome$/);
      if (outcome && request.method === 'POST') {
        const b = await readJson(request); if (!b.status) return J({ error: 'status required' }, 400);
        await repo.recordOutcome(outcome[1], b); return J({ ok: true });
      }
      const detail = url.pathname.match(/^\/api\/prospects\/([^/]+)$/);
      if (detail && request.method === 'GET') {
        const p = await repo.get(detail[1]); if (!p) return J({ error: 'not found' }, 404);
        return J({ ...p, contacts: await repo.contacts(p.id) });
      }
      const demo = url.pathname.match(/^\/demo\/([^/]+)$/);
      if (demo && request.method === 'GET') { const p = await repo.get(demo[1]); if (!p) return new Response('Not found',{status:404}); return new Response(demoHtml(p), { headers: { 'content-type': 'text/html; charset=utf-8' } }); }
      if (url.pathname === '/api/exchange/export' && request.method === 'GET') {
        const prospects = await repo.list(20); return J({ contract: 'revenue-hunter.opportunities.v1', generatedAt: new Date().toISOString(), items: prospects.filter(p=>Number(p.score)>=70).map(p=>({ externalRef:p.id, title:p.name, kind:'near_term_revenue', score:p.score, problem:p.primary_problem, proposedSolution:p.proposed_solution, indicativePrice:p.offer_price })) });
      }
      return J({ error: 'not found' }, 404);
    } catch (e) { return J({ error: e instanceof Error ? e.message : String(e) }, 500); }
  }
};
