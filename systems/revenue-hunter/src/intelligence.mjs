const absolutize=(value,base)=>{try{return new URL(value,base).href}catch{return ''}};
const txt=s=>String(s||'').replace(/\s+/g,' ').trim();
const uniq=a=>[...new Set(a.filter(Boolean))];
const first=(re,html)=>{const m=String(html||'').match(re);return m?.[1]||''};

export function extractBrandAssets(html='',baseUrl=''){
  const images=[...String(html).matchAll(/<img\b[^>]*>/gi)].map(m=>m[0]);
  const src=t=>first(/(?:src|data-src)=["']([^"']+)/i,t);
  const alt=t=>first(/alt=["']([^"']*)/i,t).toLowerCase();
  const cls=t=>`${first(/class=["']([^"']*)/i,t)} ${first(/id=["']([^"']*)/i,t)}`.toLowerCase();
  const logoTag=images.find(t=>/logo|brand/.test(`${alt(t)} ${cls(t)}`))||'';
  const og=first(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,html)||first(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,html);
  const twitter=first(/<meta[^>]+(?:name|property)=["']twitter:image["'][^>]+content=["']([^"']+)/i,html);
  const icon=first(/<link[^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]+href=["']([^"']+)/i,html)||first(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*(?:icon|shortcut icon)/i,html);
  const heroTag=images.find(t=>{const a=`${alt(t)} ${cls(t)}`;return /hero|banner|cover|masthead/.test(a)&&!/(logo|icon)/.test(a)})||images.find(t=>!/(logo|icon|avatar)/.test(`${alt(t)} ${cls(t)}`))||'';
  const gallery=uniq(images.map(src).map(x=>absolutize(x,baseUrl))).slice(0,8);
  return {logoUrl:absolutize(src(logoTag),baseUrl),faviconUrl:absolutize(icon,baseUrl),ogImageUrl:absolutize(og||twitter,baseUrl),heroImageUrl:absolutize(src(heroTag),baseUrl),galleryUrls:gallery};
}

export function extractContactsDeep(html='',links=[],baseUrl=''){
  const s=String(html||'');
  const hrefs=links.map(x=>typeof x==='string'?x:(x?.href||x?.url||''));
  const emails=uniq([
    ...[...s.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(m=>m[0]),
    ...hrefs.filter(x=>/^mailto:/i.test(x)).map(x=>x.replace(/^mailto:/i,'').split('?')[0])
  ]).filter(x=>!/(example\.com|sentry|wix|wordpress|cloudflare)/i.test(x)).slice(0,8);
  const phones=uniq([
    ...hrefs.filter(x=>/^tel:/i.test(x)).map(x=>x.replace(/^tel:/i,'')),
    ...[...s.matchAll(/(?:\+44\s?\d{2,4}|0\d{2,4})[\s().-]*\d{3,4}[\s.-]*\d{3,4}/g)].map(m=>txt(m[0]))
  ]).slice(0,6);
  const socials=Object.fromEntries(['facebook','instagram','linkedin','x.com','twitter','youtube','tiktok'].map(k=>[k,hrefs.find(x=>String(x).toLowerCase().includes(k))]).filter(([,v])=>v));
  const contactPage=hrefs.find(x=>/contact|enquir|quote|get-in-touch/i.test(x))||'';
  return {emails,phones,socials,contactPage:absolutize(contactPage,baseUrl)};
}

export function discoverAuditPages(links=[],baseUrl='',max=4){
  let origin='';try{origin=new URL(baseUrl).origin}catch{return []}
  const items=links.map(x=>typeof x==='string'?x:(x?.href||x?.url||'')).map(x=>absolutize(x,baseUrl)).filter(x=>x.startsWith(origin));
  const priorities=[/contact|quote|enquir|get-in-touch/i,/service|what-we-do|solutions/i,/about|company|team/i,/book|appointment|reservation/i];
  const picked=[];for(const re of priorities){const x=items.find(u=>re.test(u)&&!picked.includes(u));if(x)picked.push(x)}
  return picked.slice(0,max);
}

async function fetchPage(url,timeout=9000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:{'user-agent':'RevenueHunter/0.4'},redirect:'follow',signal:c.signal});const html=await r.text();return {url:r.url||url,status:r.status,ok:r.ok,html:html.slice(0,650000),contentType:r.headers.get('content-type')||''}}catch(e){return {url,status:0,ok:false,html:'',error:e instanceof Error?e.message:String(e)}}finally{clearTimeout(t)}
}

function pageSignals(page){
  const h=page.html.toLowerCase();const title=first(/<title[^>]*>([^<]*)/i,page.html);const forms=(page.html.match(/<form\b/gi)||[]).length;const buttons=(page.html.match(/<(?:button|a)\b[^>]*(?:class|role)[^>]*>/gi)||[]).length;
  const hasQuote=/quote|estimate|quotation/.test(h),hasBooking=/book|appointment|schedule|reserve/.test(h),hasContact=/contact|tel:|mailto:/.test(h),hasCta=/get a quote|free quote|request|book now|call now|get in touch/.test(h);
  return {url:page.url,status:page.status,title:txt(title),bytes:page.html.length,forms,buttons,hasQuote,hasBooking,hasContact,hasCta,https:/^https:/i.test(page.url)};
}

export async function deepSiteAudit({website,links=[],maxPages=4}){
  if(!website)return {pages:[],summary:{noWebsite:true},findings:[{code:'NO_WEBSITE',severity:92,title:'No discoverable website',solution:'mobile-first conversion website'}]};
  const urls=uniq([website,...discoverAuditPages(links,website,maxPages-1)]).slice(0,maxPages);
  const pages=[];for(const u of urls)pages.push(await fetchPage(u));
  const sig=pages.map(pageSignals),findings=[];
  const good=sig.filter(x=>x.status>=200&&x.status<400);
  if(!good.some(x=>x.hasQuote))findings.push({code:'NO_QUOTE_FLOW',severity:78,title:'No obvious quote flow across audited pages',solution:'guided quote and job-intake funnel'});
  if(!good.some(x=>x.hasBooking))findings.push({code:'NO_BOOKING_FLOW',severity:64,title:'No obvious booking flow across audited pages',solution:'booking and availability funnel'});
  if(!good.some(x=>x.forms>0))findings.push({code:'NO_STRUCTURED_FORM',severity:72,title:'No structured enquiry form detected',solution:'structured enquiry and callback flow'});
  if(!good.some(x=>x.hasCta))findings.push({code:'WEAK_CTA',severity:66,title:'Weak conversion calls-to-action',solution:'conversion-focused landing page and CTA system'});
  if(!good.some(x=>x.hasContact))findings.push({code:'CONTACT_FRICTION',severity:84,title:'Contact route is hard to detect',solution:'prominent contact, callback and fast-message journey'});
  const dead=sig.filter(x=>x.status===0||x.status>=400);if(dead.length)findings.push({code:'DEAD_LINKS',severity:Math.min(82,50+dead.length*8),title:`${dead.length} audited page${dead.length===1?'':'s'} failed to load`,solution:'broken-link and customer-journey repair'});
  if(!sig[0]?.https)findings.push({code:'NO_HTTPS',severity:90,title:'Website is not using HTTPS',solution:'secure HTTPS and deployment setup'});
  return {pages:sig,summary:{audited:urls.length,working:good.length,failed:dead.length,forms:good.reduce((a,x)=>a+x.forms,0),hasQuote:good.some(x=>x.hasQuote),hasBooking:good.some(x=>x.hasBooking),hasContact:good.some(x=>x.hasContact),hasCta:good.some(x=>x.hasCta)},findings,rawHomeHtml:pages[0]?.html||''};
}

export function identityFingerprint(p={}){
  const domain=(()=>{try{return new URL(p.website).hostname.replace(/^www\./,'')}catch{return ''}})();
  const phone=String(p.phone||'').replace(/\D/g,'').slice(-10);const post=(String(p.address||'').match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)||[])[0]?.replace(/\s/g,'').toUpperCase()||'';
  return [String(p.name||'').toLowerCase().replace(/[^a-z0-9]/g,''),domain,phone,post].filter(Boolean).join('|');
}

export function identityConfidence({prospect,companyHouse,contacts,brand}){
  let n=35;if(prospect.website)n+=15;if(prospect.phone)n+=12;if(contacts?.emails?.length)n+=8;if(brand?.logoUrl||brand?.ogImageUrl)n+=6;if(companyHouse?.status==='matched')n+=Math.round((companyHouse.identityScore||0)*0.24);return Math.min(100,n);
}
