import { discoverBusinesses, inspectWebsite } from './adapters.mjs';
import { inferOpportunitySignals, scoreProspect } from './scoring.mjs';
import { RevenueRepository } from './repository.mjs';
import { enrichFromCompaniesHouse } from './companies-house.mjs';
import { extractBrandAssets, extractContactsDeep, deepSiteAudit, identityFingerprint, identityConfidence } from './intelligence.mjs';
import { chooseOpportunity, commercialEstimate } from './opportunity-library.mjs';
import { createGovernor } from './governor.mjs';
import { dashboardHtml, dossierHtml, evidenceHtml, demoHtml, salesHtml, learningHtml } from './ui.mjs';

const J=(d,s=200)=>new Response(JSON.stringify(d,null,2),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const H=(html,s=200)=>new Response(html,{status:s,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
const readJson=async r=>r.json().catch(()=>({}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safeJson=v=>{try{return JSON.parse(v||'{}')}catch{return {}}};
const dedupeFindings=arr=>{const m=new Map();for(const f of arr||[]){const old=m.get(f.code);if(!old||Number(f.severity)>Number(old.severity))m.set(f.code,f)}return [...m.values()]};

function profileFromRendered(p,raw={}){
 const markdown=String(raw.markdown||'');const lines=markdown.split('\n').map(x=>x.replace(/^#{1,6}\s*/,'').replace(/^[-*]\s*/,'').trim()).filter(x=>x.length>=4&&x.length<=86).filter(x=>!/^(home|menu|contact|about|privacy|cookies|terms|skip|facebook|instagram|login)$/i.test(x));const unique=[...new Set(lines.map(x=>x.replace(/\s+/g,' ')))];
 return {headline:unique.find(x=>x.length>=12&&x.length<=70)||p.name,services:unique.filter(x=>!x.toLowerCase().includes(String(p.name).toLowerCase())).slice(0,6),source:p.website?'website':'public-record'};
}

function estimateInputs(p,chosen,audit,contacts,identity){
 const severity=Number(chosen.finding.severity||50),o=chosen.opportunity;return {pain:severity,buyerClarity:(contacts.phones?.length||contacts.emails?.length||p.website)?82:50,speedToCash:severity>=75?85:70,deliveryEase:Math.max(45,100-Math.round(o.effortMinutes/8)),evidence:Math.min(96,50+Number(audit.summary?.audited||0)*7+Number(identity||0)*.18),margin:o.marginScore,contactability:contacts.phones?.length?88:(contacts.emails?.length?80:(p.website?65:38))};
}

function whyChosen(p,chosen,scoring,audit,contacts,identity,commercial){
 const bits=[];if(!p.website)bits.push('no discoverable website');if(contacts.phones?.length)bits.push('direct phone contact');if(contacts.emails?.length)bits.push('email found');if(audit.summary?.audited)bits.push(`${audit.summary.audited} page audit`);bits.push(chosen.finding.title.toLowerCase());bits.push(`${Math.round(identity)}% identity confidence`);bits.push(`${Math.round(scoring.total)}/100 commercial score`);bits.push(`${Math.round(commercial.expectedMargin)} indicative margin`);return bits.join(' • ');
}

async function cached(repo,key,ttl,loader,governor){const hit=await repo.cacheGet(key);if(hit){governor?.cacheHit();return hit}const v=await loader();await repo.cacheSet(key,v,ttl);return v}

async function buildIntelligence(repo,env,p,governor){
 const cacheKey=`intel:v4:${identityFingerprint(p)}:${p.website||'no-site'}`;
 const prior=await repo.cacheGet(cacheKey);
 if(prior){governor.cacheHit();await repo.saveInvestigation(p.id,prior.investigation);await repo.saveIntelligence(p.id,prior.intelligence);if(prior.contactRows?.length)await repo.saveContacts(p.id,prior.contactRows);return {prospect:await repo.get(p.id),cached:true}}

 let rendered={markdown:'',links:[],title:''},inspectionError='';
 let audit={pages:[],summary:{noWebsite:!p.website,audited:0},findings:[],rawHomeHtml:''};
 if(p.website&&governor.allowDeepAudit()){
  try{audit=await deepSiteAudit({website:p.website,links:[],maxPages:governor.limits.auditPagesPerSite})}catch(e){inspectionError=e instanceof Error?e.message:String(e)}
 }
 if(!p.website&&!audit.findings.length)audit=await deepSiteAudit({website:'',links:[],maxPages:1});
 const needRendered=p.website&&governor.allowBrowser(2)&&(audit.rawHomeHtml.length<6000||audit.summary?.failed>0);
 if(needRendered){
  try{rendered=await inspectWebsite({browser:env.BROWSER,url:p.website})}catch(e){inspectionError=e instanceof Error?e.message:String(e)}
 }
 const renderedSignals=rendered.markdown?inferOpportunitySignals({...rendered,website:p.website}):{findings:[],flags:{}};
 const findings=dedupeFindings([...(audit.findings||[]),...(renderedSignals.findings||[])]);
 const chosen=chooseOpportunity(findings);
 const sourceHtml=audit.rawHomeHtml||'';
 const brand=extractBrandAssets(sourceHtml,p.website||'');
 const extracted=extractContactsDeep(sourceHtml,rendered.links||[],p.website||'');
 const contacts={phones:[...new Set([p.phone,...(extracted.phones||[])].filter(Boolean))],emails:extracted.emails||[],socials:extracted.socials||{},contactPage:extracted.contactPage||'',website:p.website||'',address:p.address||''};
 let companyHouse={connected:false,status:'not_connected'};
 if(env.COMPANIES_HOUSE_API_KEY){companyHouse=await cached(repo,`ch:v1:${String(p.name).toLowerCase()}:${p.address||''}`,168,()=>enrichFromCompaniesHouse({apiKey:env.COMPANIES_HOUSE_API_KEY,prospect:p}),governor)}
 const ident=identityConfidence({prospect:p,companyHouse,contacts,brand});
 const scoring=scoreProspect(estimateInputs(p,chosen,audit,contacts,ident));
 const commercial=commercialEstimate({code:chosen.finding.code,score:scoring.total,severity:chosen.finding.severity});
 const profile=profileFromRendered(p,rendered);
 const evidence={whyChosen:whyChosen(p,chosen,scoring,audit,contacts,ident,commercial),contacts,profile,inspectionError,scoring,companyHouseStatus:companyHouse.status,sourceWebsite:p.website||'',governor:governor.snapshot()};
 const investigation={score:scoring.total,primaryProblem:chosen.finding.title,proposedSolution:commercial.solution,offerPrice:commercial.price,findings,opportunityCode:chosen.finding.code,expectedMargin:commercial.expectedMargin,expectedEffortMinutes:commercial.effortMinutes,evidence};
 const assets=[{type:'logo',url:brand.logoUrl,confidence:95},{type:'favicon',url:brand.faviconUrl,confidence:70},{type:'social_image',url:brand.ogImageUrl,confidence:85},{type:'hero',url:brand.heroImageUrl,confidence:80},...(brand.galleryUrls||[]).slice(0,5).map((url,i)=>({type:`gallery_${i+1}`,url,confidence:65}))].filter(x=>x.url);
 const intelligence={companyNumber:companyHouse.companyNumber||'',companyStatus:companyHouse.companyStatus||'',identityConfidence:ident,identity:{fingerprint:identityFingerprint(p),companyHouse,contacts},brand,audit:{pages:audit.pages||[],summary:audit.summary||{},findings:audit.findings||[]},websiteFingerprint:`${p.website||''}|${audit.pages?.[0]?.bytes||0}|${audit.pages?.[0]?.title||''}`,assets};
 const contactRows=(contacts.emails||[]).map(email=>({email,type:'website',confidence:88}));
 await repo.saveInvestigation(p.id,investigation);await repo.saveIntelligence(p.id,intelligence);if(contactRows.length)await repo.saveContacts(p.id,contactRows);
 await repo.cacheSet(cacheKey,{investigation,intelligence,contactRows},48);
 return {prospect:await repo.get(p.id),cached:false};
}

async function runHunt(repo,env,query){
 const governor=createGovernor(env);const pageSize=governor.limits.prospectsPerRun;
 const found=await cached(repo,`discovery:v4:${String(query).toLowerCase()}`,12,()=>discoverBusinesses({apiKey:env.GOOGLE_PLACES_API_KEY,query,pageSize}),governor);
 const results=[];
 for(const raw of found){if(!governor.allowProspect())break;const p=await repo.upsertProspect(raw);try{results.push(await buildIntelligence(repo,env,p,governor))}catch(e){results.push({prospect:p,error:e instanceof Error?e.message:String(e)})}await sleep(80)}
 return {results:results.sort((a,b)=>Number(b.prospect?.score||0)-Number(a.prospect?.score||0)),governor:governor.snapshot()};
}

function outreachHtml(p){const ev=safeJson(p.evidence_json),c=ev.contacts||{},price=p.offer_price?`£${p.offer_price}`:'a fixed price';const contact=(c.emails?.[0]||c.email||'');const subject=`Quick idea for ${p.name}`;const body=`Hi ${p.name} team,\n\nI looked at your online customer journey and found ${String(p.primary_problem||'a conversion opportunity').toLowerCase()}. I put together a private mobile-first concept showing how ${p.proposed_solution||'a simpler customer journey'} could look for your business.\n\nIf it is useful, I can build the finished version for ${price}. The demo is there so you can judge the idea before deciding anything.\n\nBest,\nCraig`;
 return H(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;background:#090b0e;color:#f5f6f7;margin:0}.w{max-width:800px;margin:auto;padding:18px}.c{background:#151922;border:1px solid #29313c;border-radius:20px;padding:19px;margin:12px 0}.m{white-space:pre-wrap;line-height:1.6}.a{color:#dfff48}</style></head><body><div class="w"><p><a class="a" href="/dossier/${p.id}">← Dossier</a></p><div class="c"><h1>${p.name}</h1><p>Human-approved outreach draft. Nothing is sent automatically.</p>${contact?`<p>Suggested email: <a class="a" href="mailto:${contact}">${contact}</a></p>`:''}</div><div class="c"><b>Subject</b><h2>${subject}</h2></div><div class="c"><b>Message</b><div class="m">${body}</div></div></div></body></html>`)}

async function screenshotFor(repo,env,id,device){const p=await repo.get(id);if(!p?.website)return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="100%" height="100%" fill="#151922"/><text x="50%" y="50%" fill="white" font-size="28" text-anchor="middle">No website screenshot available</text></svg>',{headers:{'content-type':'image/svg+xml','cache-control':'public,max-age=3600'}});if(!env.BROWSER?.quickAction)return new Response('Browser binding unavailable',{status:503});const viewport=device==='mobile'?{width:390,height:844,deviceScaleFactor:1}:{width:1280,height:800,deviceScaleFactor:1};for(let i=0;i<3;i++){const r=await env.BROWSER.quickAction('screenshot',{url:p.website,viewport,screenshotOptions:{fullPage:false},gotoOptions:{waitUntil:'networkidle2',timeout:25000}});if(r.status!==429)return new Response(r.body,{status:r.status,headers:{'content-type':r.headers.get('content-type')||'image/png','cache-control':'public,max-age=21600'}});await sleep(700*(i+1))}return new Response('Screenshot temporarily rate limited',{status:429})}

async function readForm(request){const ct=request.headers.get('content-type')||'';if(ct.includes('application/json'))return readJson(request);const form=await request.formData();return Object.fromEntries(form.entries())}

export default{
 async fetch(request,env){const url=new URL(request.url),repo=new RevenueRepository(env.REVENUE_DB);try{
  if(url.pathname==='/'&&request.method==='GET')return H(dashboardHtml());
  if(url.pathname==='/health')return J({ok:true,system:'revenue-hunter',version:'0.4.0',isolation:'independent',freeFirst:true,optional:{companiesHouse:Boolean(env.COMPANIES_HOUSE_API_KEY),googlePlaces:Boolean(env.GOOGLE_PLACES_API_KEY),hunter:Boolean(env.HUNTER_API_KEY),stripe:Boolean(env.STRIPE_SECRET_KEY)}});
  if(url.pathname==='/api/dashboard')return J(await repo.dashboard());
  if(url.pathname==='/api/prospects'&&request.method==='GET')return J(await repo.list(Number(url.searchParams.get('limit')||60),{savedOnly:url.searchParams.get('saved')==='1',salesStage:url.searchParams.get('sales_stage')||''}));
  if(url.pathname==='/api/run'&&request.method==='POST'){const b=await readJson(request);if(!b.query)return J({error:'query required'},400);const run=await runHunt(repo,env,b.query);return J({query:b.query,count:run.results.length,results:run.results,governor:run.governor},201)}
  let m=url.pathname.match(/^\/api\/prospects\/([^/]+)\/save$/);if(m&&request.method==='POST'){const b=await readJson(request);return J(await repo.toggleSaved(m[1],b.saved!==false))}
  m=url.pathname.match(/^\/api\/prospects\/([^/]+)\/investigate$/);if(m&&request.method==='POST'){const p=await repo.get(m[1]);if(!p)return J({error:'not found'},404);const g=createGovernor(env);return J((await buildIntelligence(repo,env,p,g)).prospect)}
  m=url.pathname.match(/^\/api\/prospects\/([^/]+)\/outcome$/);if(m&&request.method==='POST'){const b=await readJson(request);if(!b.status)return J({error:'status required'},400);await repo.recordOutcome(m[1],b);return J({ok:true})}
  const visual=url.pathname.match(/^\/visual\/([^/]+)$/);if(visual)return screenshotFor(repo,env,visual[1],url.searchParams.get('device')||'mobile');
  const dossier=url.pathname.match(/^\/dossier\/([^/]+)$/);if(dossier){const p=await repo.get(dossier[1]);if(!p)return H('Not found',404);return H(dossierHtml(p,{assets:await repo.assets(p.id),contacts:await repo.contacts(p.id),notes:await repo.notes(p.id),events:await repo.salesEvents(p.id)}))}
  const evidence=url.pathname.match(/^\/evidence\/([^/]+)$/);if(evidence){const p=await repo.get(evidence[1]);return p?H(evidenceHtml(p)):H('Not found',404)}
  const demo=url.pathname.match(/^\/demo\/([^/]+)$/);if(demo){const p=await repo.get(demo[1]);return p?H(demoHtml(p)):H('Not found',404)}
  const outreach=url.pathname.match(/^\/outreach\/([^/]+)$/);if(outreach){const p=await repo.get(outreach[1]);return p?outreachHtml(p):H('Not found',404)}
  if(url.pathname==='/sales'&&request.method==='GET')return H(salesHtml(await repo.list(200)));
  m=url.pathname.match(/^\/sales\/([^/]+)$/);if(m&&request.method==='POST'){const b=await readForm(request);await repo.updateSales(m[1],{stage:b.stage||'new',nextAction:b.nextAction||'',note:b.note||''});return Response.redirect(new URL(`/dossier/${m[1]}`,request.url),303)}
  if(url.pathname==='/learning'&&request.method==='GET')return H(learningHtml(await repo.learningSummary()));
  if(url.pathname==='/api/exchange/export'){const ps=await repo.list(30);return J({contract:'revenue-hunter.opportunities.v1',generatedAt:new Date().toISOString(),items:ps.filter(p=>Number(p.score)>=70).map(p=>({externalRef:p.id,title:p.name,kind:'near_term_revenue',score:p.score,problem:p.primary_problem,proposedSolution:p.proposed_solution,indicativePrice:p.offer_price,expectedMargin:p.expected_margin,identityConfidence:p.identity_confidence}))})}
  return J({error:'not found'},404)
 }catch(e){return J({error:e instanceof Error?e.message:String(e)},500)}},
 async scheduled(_c,env,ctx){if(!env.DEFAULT_HUNT_QUERY)return;ctx.waitUntil((async()=>{const repo=new RevenueRepository(env.REVENUE_DB);await runHunt(repo,env,env.DEFAULT_HUNT_QUERY)})())}
};
