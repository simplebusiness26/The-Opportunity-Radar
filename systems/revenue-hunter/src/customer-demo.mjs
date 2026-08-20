const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parse=v=>{try{return JSON.parse(v||'{}')}catch{return {}}};
const uniq=a=>[...new Set((a||[]).filter(Boolean))];

function palette(p,brand={}){
 const seed=String(p.name||'').split('').reduce((n,c)=>n+c.charCodeAt(0),0)%4;
 return [
  {bg:'#f5f2eb',ink:'#171816',accent:'#b9e64b',soft:'#e8eddc'},
  {bg:'#f4f6fb',ink:'#111827',accent:'#6680ff',soft:'#e8ecff'},
  {bg:'#f7f3ee',ink:'#201a17',accent:'#e8794a',soft:'#f7dfd4'},
  {bg:'#eef4f1',ink:'#12231c',accent:'#65c99a',soft:'#d9eee4'}
 ][seed];
}

function categoryInfo(category=''){
 const c=String(category).toLowerCase();
 if(/roof/.test(c)) return {label:'Roofing specialists', services:['Roof repairs','New roofs','Flat roofing','Maintenance & inspections'], cta:'Get a roofing quote', intro:'Professional roofing support for homes and businesses.'};
 if(/clean/.test(c)) return {label:'Professional cleaning', services:['Domestic cleaning','Deep cleans','End of tenancy','Regular cleaning'], cta:'Get a cleaning quote', intro:'Reliable cleaning with a simple, clear booking and enquiry journey.'};
 if(/plumb|heating|boiler/.test(c)) return {label:'Plumbing & heating', services:['Plumbing repairs','Boiler & heating','Emergency call-outs','Maintenance'], cta:'Request a call-back', intro:'Straightforward plumbing and heating support when customers need it.'};
 if(/electric/.test(c)) return {label:'Electrical services', services:['Electrical repairs','Installations','Inspection & testing','Commercial electrical'], cta:'Request a quote', intro:'Clear, professional electrical services with an easier route to enquire.'};
 if(/builder|building|construction/.test(c)) return {label:'Building & construction', services:['Extensions & renovations','General building','Repairs & maintenance','Project enquiries'], cta:'Discuss your project', intro:'A clearer way for customers to understand services and start a project enquiry.'};
 if(/restaurant|cafe/.test(c)) return {label:'Food & hospitality', services:['Menu','Bookings','Events & groups','Visit us'], cta:'Book a table', intro:'A cleaner customer journey for discovering, choosing and booking.'};
 if(/hair|barber/.test(c)) return {label:'Hair & grooming', services:['Cuts & styling','Appointments','Treatments','Visit the studio'], cta:'Book an appointment', intro:'A polished mobile-first booking experience for new and returning customers.'};
 if(/dent/.test(c)) return {label:'Dental care', services:['General dentistry','New patients','Appointments','Treatment enquiries'], cta:'Book an appointment', intro:'A calm, clear way for patients to understand services and make contact.'};
 if(/law|solicitor/.test(c)) return {label:'Legal services', services:['Legal advice','Consultations','Business matters','Personal matters'], cta:'Request a consultation', intro:'Professional legal information organised around clarity, trust and contact.'};
 if(/account/.test(c)) return {label:'Accountancy services', services:['Accounts & tax','Bookkeeping','Business support','Consultations'], cta:'Book a consultation', intro:'Clear financial services with a simpler path from interest to enquiry.'};
 return {label:'Local specialists', services:['Core services','Repairs & support','New enquiries','Ongoing service'], cta:'Request a quote', intro:'A clearer, more professional way for customers to understand the business and get in touch.'};
}

function cleanService(text=''){
 return String(text).replace(/^[-•*\d.\s]+/,'').replace(/\s+/g,' ').trim();
}

function companyData(p){
 const ev=parse(p.evidence_json), brand=parse(p.brand_json), ident=parse(p.identity_json);
 const c=ev.contacts||{};
 const category=categoryInfo(p.category||'');
 const extracted=uniq((ev.profile?.services||[]).map(cleanService).filter(x=>x.length>=4&&x.length<=70).filter(x=>!/cookie|privacy|terms|facebook|instagram|home|contact us/i.test(x))).slice(0,6);
 const services=uniq([...extracted,...category.services]).slice(0,6);
 const images=uniq([brand.heroImageUrl,brand.ogImageUrl,...(brand.galleryUrls||[])]).filter(Boolean).slice(0,6);
 const phone=c.phones?.[0]||c.phone||p.phone||'';
 const email=c.emails?.[0]||c.email||'';
 const address=c.address||p.address||'';
 const social=c.socials||{};
 const headline=(ev.profile?.headline&&ev.profile.headline!==p.name&&ev.profile.headline.length<90)?ev.profile.headline:'';
 return {ev,brand,ident,category,services,images,phone,email,address,social,headline};
}

function image(url,cls=''){
 return url?`<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" onerror="this.style.display='none'">`:'';
}

function serviceCards(items){
 return items.slice(0,6).map((s,i)=>`<article class="service"><div class="serviceNo">${String(i+1).padStart(2,'0')}</div><h3>${esc(s)}</h3><p>Clear information and a simple next step for customers interested in this service.</p></article>`).join('');
}

function gallery(items){
 if(!items.length)return '';
 return `<section class="section"><div class="sectionHead"><div><div class="eyebrow">Our work</div><h2>A closer look.</h2></div><p>Images sourced from the business's existing public web presence for this private concept preview.</p></div><div class="gallery">${items.slice(0,5).map((u,i)=>image(u,i===0?'wide':'')).join('')}</div></section>`;
}

export function customerDemoHtml(p){
 const d=companyData(p), t=palette(p,d.brand);
 const hero=d.images[0]||'';
 const logo=d.brand.logoUrl||d.brand.faviconUrl||'';
 const title=d.headline||`${p.name}`;
 const sub=d.category.intro;
 const phoneBtn=d.phone?`<a class="btn primary" href="tel:${esc(d.phone)}">Call ${esc(d.phone)}</a>`:'';
 const emailBtn=d.email?`<a class="btn secondary" href="mailto:${esc(d.email)}">Email us</a>`:'';
 const cta=`<a class="btn primary" href="#enquire">${esc(d.category.cta)}</a>`;
 const contactBits=[d.phone?`<a href="tel:${esc(d.phone)}">${esc(d.phone)}</a>`:'',d.email?`<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`:'',d.address?`<span>${esc(d.address)}</span>`:''].filter(Boolean).join('');
 const bgHero=hero?`background-image:linear-gradient(90deg,rgba(0,0,0,.68),rgba(0,0,0,.18)),url('${esc(hero)}');background-size:cover;background-position:center;`:'';
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="${t.ink}"><title>${esc(p.name)} — Website concept</title><style>
 *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:${t.bg};color:${t.ink};font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.preview{background:${t.ink};color:#fff;padding:8px 16px;text-align:center;font-size:11px;letter-spacing:.08em}.shell{max-width:1180px;margin:auto;padding:0 22px}.nav{display:flex;justify-content:space-between;align-items:center;padding:20px 0;gap:18px}.brand{display:flex;align-items:center;gap:12px;font-size:21px;font-weight:950;letter-spacing:-.04em}.brand img{max-width:170px;max-height:54px;object-fit:contain}.navlinks{display:flex;gap:22px;align-items:center}.navlinks a{text-decoration:none;color:${t.ink};font-size:14px;font-weight:750}.btn{display:inline-flex;align-items:center;justify-content:center;padding:14px 18px;border-radius:999px;text-decoration:none;font-weight:900;border:1px solid ${t.ink}}.primary{background:${t.ink};color:#fff}.secondary{background:transparent;color:${t.ink}}.hero{min-height:590px;border-radius:34px;padding:56px;display:flex;align-items:flex-end;${bgHero}background-color:${t.accent};overflow:hidden}.heroCopy{max-width:760px;${hero?'color:#fff':''}}.eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.15em;font-weight:950}.hero h1{font-size:clamp(52px,8vw,92px);line-height:.9;letter-spacing:-.07em;margin:16px 0 22px}.hero p{font-size:20px;line-height:1.55;max-width:650px}.heroActions{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px}.hero ${hero?'.secondary{color:#fff;border-color:#fff}.primary{background:#fff;color:'+t.ink+';border-color:#fff}':''}.trust{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.trust div{background:#fff;border-radius:20px;padding:20px}.trust strong{display:block;font-size:18px}.trust span{color:#69706c;font-size:13px}.section{padding:76px 0}.sectionHead{display:flex;justify-content:space-between;gap:30px;align-items:end;margin-bottom:30px}.sectionHead h2{font-size:clamp(38px,5vw,62px);letter-spacing:-.055em;line-height:.95;margin:8px 0}.sectionHead p{max-width:480px;color:#666c68;line-height:1.6}.services{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.service{background:#fff;border-radius:24px;padding:28px;min-height:230px}.serviceNo{font-size:12px;font-weight:950;color:#7b817e}.service h3{font-size:24px;letter-spacing:-.03em}.service p{color:#676d69;line-height:1.55}.gallery{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:230px;gap:12px}.gallery img{width:100%;height:100%;object-fit:cover;border-radius:22px;background:#ddd}.gallery .wide{grid-column:span 2;grid-row:span 2}.about{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:stretch}.aboutCopy{background:${t.soft};border-radius:30px;padding:40px}.aboutCopy h2{font-size:48px;letter-spacing:-.05em;margin:10px 0 18px}.aboutCopy p{line-height:1.65;color:#565d59}.contactCard{background:${t.ink};color:#fff;border-radius:30px;padding:40px;display:flex;flex-direction:column;justify-content:space-between}.contactCard a{color:#fff}.contactDetails{display:grid;gap:12px;margin:30px 0}.contactDetails a,.contactDetails span{text-decoration:none;font-size:18px}.quote{background:#fff;border-radius:32px;padding:40px;display:grid;grid-template-columns:.8fr 1.2fr;gap:26px}.quote h2{font-size:46px;letter-spacing:-.05em;line-height:1;margin:12px 0}.form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.form input,.form select,.form textarea,.form button{font:inherit;border:1px solid #d8ddd8;border-radius:14px;padding:15px}.form textarea,.form button{grid-column:1/-1}.form button{background:${t.accent};font-weight:950;border-color:${t.accent}}.fine{grid-column:1/-1;color:#7b817e;font-size:11px}.footer{padding:38px 0 60px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;color:#676d69;font-size:13px}
 @media(max-width:760px){.shell{padding:0 14px}.nav{padding:14px 0}.navlinks a:not(.btn){display:none}.brand{font-size:18px}.brand img{max-width:145px}.hero{min-height:520px;padding:26px;border-radius:25px}.hero h1{font-size:54px}.hero p{font-size:17px}.heroActions .btn{width:100%}.trust{grid-template-columns:1fr}.section{padding:52px 0}.sectionHead{display:block}.services{grid-template-columns:1fr}.service{min-height:0}.gallery{grid-template-columns:1fr 1fr;grid-auto-rows:170px}.gallery .wide{grid-column:1/-1;grid-row:span 1}.about{grid-template-columns:1fr}.aboutCopy,.contactCard{padding:27px;border-radius:24px}.aboutCopy h2{font-size:40px}.quote{grid-template-columns:1fr;padding:25px;border-radius:24px}.form{grid-template-columns:1fr}.form>*{grid-column:1/-1}.footer{padding-bottom:36px}}
 </style></head><body><div class="preview">PRIVATE WEBSITE CONCEPT PREVIEW — not the current live website</div><div class="shell"><nav class="nav"><div class="brand">${logo?image(logo,''):esc(p.name)}</div><div class="navlinks"><a href="#services">Services</a><a href="#about">About</a><a href="#enquire">Contact</a>${d.phone?phoneBtn:cta}</div></nav><main><section class="hero"><div class="heroCopy"><div class="eyebrow">${esc(d.category.label)}${d.address?` · ${esc(d.address)}`:''}</div><h1>${esc(title)}</h1><p>${esc(sub)}</p><div class="heroActions">${cta}${phoneBtn}${emailBtn}</div></div></section><div class="trust"><div><strong>${esc(p.name)}</strong><span>${esc(d.category.label)}</span></div><div><strong>Clear service journey</strong><span>Designed around the services customers are actually looking for.</span></div><div><strong>Mobile first</strong><span>Built to make calling, enquiring and understanding the business easier.</span></div></div><section class="section" id="services"><div class="sectionHead"><div><div class="eyebrow">Services</div><h2>What we can help with.</h2></div><p>This concept uses service information collected from the company's current public web presence where available, then reorganises it into a clearer customer journey.</p></div><div class="services">${serviceCards(d.services)}</div></section>${gallery(d.images.slice(hero?1:0))}<section class="section" id="about"><div class="about"><div class="aboutCopy"><div class="eyebrow">About ${esc(p.name)}</div><h2>Local expertise, made easier to choose.</h2><p>${esc(sub)} This concept keeps the business identity front and centre while making important information, services and contact routes easier to understand on a phone.</p>${d.address?`<p><strong>Area:</strong> ${esc(d.address)}</p>`:''}</div><div class="contactCard"><div><div class="eyebrow">Contact</div><h2>Ready to talk?</h2><div class="contactDetails">${contactBits||'<span>Contact details would be confirmed before launch.</span>'}</div></div><div>${d.phone?phoneBtn:cta}</div></div></div></section><section class="section" id="enquire"><div class="quote"><div><div class="eyebrow">Quick enquiry</div><h2>${esc(d.category.cta)}</h2><p>Give us the basics and we can get back to you with the right next step.</p></div><form class="form" onsubmit="event.preventDefault();alert('Concept preview only — nothing was submitted.')"><input placeholder="Your name"><input placeholder="Phone number"><input placeholder="Email address"><input placeholder="Postcode / area"><select><option>Select a service</option>${d.services.slice(0,5).map(s=>`<option>${esc(s)}</option>`).join('')}</select><textarea rows="5" placeholder="Tell us what you need help with"></textarea><button>${esc(d.category.cta)}</button><div class="fine">Concept preview only. This form does not send or store information.</div></form></div></section></main><footer class="footer"><strong>${esc(p.name)}</strong><div>${d.phone?esc(d.phone)+' · ':''}${d.email?esc(d.email)+' · ':''}${esc(d.address||'')}</div></footer></div></body></html>`;
}
