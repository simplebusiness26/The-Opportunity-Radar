import app from './worker-entry.mjs';

function withDashboardClient(html='') {
  const stripped = String(html).replace(/<script>[\s\S]*?<\/script>/i, '');
  return stripped.replace('</body>', '<script src="/dashboard-client.js" defer></script></body>');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/dashboard-client.js' && request.method === 'GET') {
      const source = `(() => {\n'use strict';\n${DASHBOARD_CLIENT_SOURCE}\n})();`;
      return new Response(source, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'public, max-age=300'
        }
      });
    }

    const response = await app.fetch(request, env, ctx);
    if (url.pathname === '/' && request.method === 'GET' && response.headers.get('content-type')?.includes('text/html')) {
      const html = await response.text();
      const headers = new Headers(response.headers);
      headers.set('content-type', 'text/html; charset=utf-8');
      headers.set('cache-control', 'no-store');
      return new Response(withDashboardClient(html), { status: response.status, headers });
    }
    return response;
  },
  scheduled(controller, env, ctx) {
    return app.scheduled?.(controller, env, ctx);
  }
};

const DASHBOARD_CLIENT_SOURCE = `
const $ = (s) => document.querySelector(s);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseJson = (value) => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const money = (n) => Number.isFinite(Number(n)) ? '£' + Math.round(Number(n)).toLocaleString('en-GB') : '—';
const savedOnly = new URLSearchParams(location.search).get('view') === 'saved';
async function jf(url, options){const r=await fetch(url,options);const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||('HTTP '+r.status));return b;}
function contacts(x,c){const phone=(c.phones&&c.phones[0])||c.phone||x.phone||'';const email=(c.emails&&c.emails[0])||c.email||'';let h=phone?'<a href="tel:'+esc(phone)+'">☎ '+esc(phone)+'</a>':'<span class="muted">Phone not found</span>';if(email)h+='<a href="mailto:'+esc(email)+'">✉ '+esc(email)+'</a>';if(x.website)h+='<a href="'+esc(x.website)+'" target="_blank" rel="noreferrer">↗ '+esc(x.website)+'</a>';return h;}
function card(x){const ev=parseJson(x.evidence_json),c=ev.contacts||{},brand=parseJson(x.brand_json),logo=brand.logoUrl||brand.faviconUrl||'',verified=x.company_number?'<span class="badge verified">Companies House '+esc(x.company_status||'matched')+'</span>':'<span class="badge">Identity '+esc(Math.round(x.identity_confidence||0))+'%</span>',score=x.score?Math.round(x.score):'—',effort=x.expected_effort_minutes?(Math.round((x.expected_effort_minutes/60)*10)/10)+'h':'—',saved=Boolean(x.saved);return '<article class="card"><div class="cardTop"><div><div class="name">'+esc(x.name)+'</div><div class="muted">'+esc(x.category||'business')+' • '+esc(x.address||'')+'</div>'+verified+'<span class="badge">'+esc(x.sales_stage||'new')+'</span>'+(logo?'<br><img class="brandThumb" src="'+esc(logo)+'" alt="">':'')+'</div><div class="score">'+esc(score)+'</div></div><div class="problem">'+esc(x.primary_problem||'Awaiting investigation')+'</div><div class="muted">'+esc(x.proposed_solution||'')+'</div><div class="why"><b>WHY THIS COULD MAKE MONEY</b><br>'+esc(ev.whyChosen||'Evidence still being built.')+'</div><div class="contact">'+contacts(x,c)+'</div><div class="economics"><div><small>Offer</small><br><b>'+money(x.offer_price)+'</b></div><div><small>Margin</small><br><b>'+money(x.expected_margin)+'</b></div><div><small>Effort</small><br><b>'+esc(effort)+'</b></div></div><div class="actions"><a href="/demo/'+encodeURIComponent(x.id)+'">Demo</a><a href="/dossier/'+encodeURIComponent(x.id)+'">Dossier</a><a href="/evidence/'+encodeURIComponent(x.id)+'">Evidence</a><button type="button" class="saveBtn '+(saved?'saved':'')+'" data-save-id="'+esc(x.id)+'" data-save-next="'+(saved?'0':'1')+'">'+(saved?'★ Saved':'☆ Save')+'</button></div></article>';}
async function load(){const data=await Promise.all([jf('/api/dashboard'),jf('/api/prospects?limit=60'+(savedOnly?'&saved=1':''))]);const d=data[0],ps=data[1],t=d.totals||{};$('#summary').innerHTML=[['Prospects',t.prospects||0],['★ Saved',t.saved||0],['80+ score',t.high_value||0],['Indicative margin',money(t.indicative_margin||0)]].map(x=>'<div class="sum"><small>'+esc(x[0])+'</small><strong>'+esc(x[1])+'</strong></div>').join('');$('#heading').textContent=savedOnly?'★ Saved prospects':'Prospects';$('#count').textContent=ps.length+' shown';$('#cards').innerHTML=ps.length?ps.map(card).join(''):'<div class="muted">No prospects in this view yet.</div>';}
async function save(btn){const id=btn.dataset.saveId,saved=btn.dataset.saveNext==='1';btn.disabled=true;try{await jf('/api/prospects/'+encodeURIComponent(id)+'/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({saved:saved})});await load();}finally{btn.disabled=false;}}
async function run(){const q=$('#q').value.trim(),btn=$('#huntBtn'),status=$('#status');if(!q||btn.disabled)return;btn.disabled=true;btn.textContent='Hunting…';let s=0;status.innerHTML='<span class="spinner"></span>Starting Revenue Hunter…';const timer=setInterval(()=>{s++;status.innerHTML='<span class="spinner"></span>Revenue Hunter is working — '+s+'s. Results are saved as they complete.';},1000);try{const d=await jf('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q})});status.textContent='Run complete — '+(d.count||0)+' processed.';await load();}catch(err){status.textContent='Run paused: '+err.message+'. Completed prospects are already saved.';await load().catch(()=>{});}finally{clearInterval(timer);btn.disabled=false;btn.textContent='Hunt opportunities';}}
function init(){const form=$('#hunt'),btn=$('#huntBtn');if(!form||!btn)return;form.action='javascript:void(0)';form.addEventListener('submit',(ev)=>{ev.preventDefault();run();});btn.type='button';btn.addEventListener('click',run);$('#cards').addEventListener('click',(ev)=>{const b=ev.target.closest('[data-save-id]');if(b)save(b);});load().catch(err=>{$('#status').textContent='Dashboard data could not load: '+err.message;});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
`;
