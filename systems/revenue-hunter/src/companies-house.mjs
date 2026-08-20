const API='https://api.company-information.service.gov.uk';
const strip=s=>String(s||'').toLowerCase().replace(/\b(limited|ltd|plc|llp|uk)\b/g,'').replace(/[^a-z0-9]/g,'');
const basic=key=>'Basic '+btoa(`${key}:`);
const addr=a=>[a?.premises,a?.address_line_1,a?.address_line_2,a?.locality,a?.region,a?.postal_code].filter(Boolean).join(', ');

export function companyIdentitySimilarity(prospect,item){
  const a=strip(prospect?.name),b=strip(item?.title);
  let score=0;
  if(a&&b){ if(a===b) score+=72; else if(a.includes(b)||b.includes(a)) score+=55; else {
    const at=new Set(a.match(/.{1,4}/g)||[]),bt=new Set(b.match(/.{1,4}/g)||[]); const overlap=[...at].filter(x=>bt.has(x)).length; score+=Math.min(45,overlap*7);
  }}
  const pa=String(prospect?.address||'').toLowerCase(),ia=String(item?.address_snippet||addr(item?.address)||'').toLowerCase();
  const post=(pa.match(/[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}/i)||[])[0];
  if(post&&ia.replace(/\s/g,'').includes(post.replace(/\s/g,'').toLowerCase())) score+=22;
  if(item?.company_status==='active') score+=6;
  return Math.min(100,score);
}

async function get(path,key){
  const r=await fetch(API+path,{headers:{authorization:basic(key),'user-agent':'RevenueHunter/0.4'}});
  if(r.status===429) throw new Error('Companies House rate limit reached');
  if(!r.ok) throw new Error(`Companies House HTTP ${r.status}`);
  return r.json();
}

export async function enrichFromCompaniesHouse({apiKey,prospect}){
  if(!apiKey) return {connected:false,status:'not_connected',matches:[]};
  const u=new URL(API+'/search/companies'); u.searchParams.set('q',prospect.name); u.searchParams.set('items_per_page','5');
  const r=await fetch(u,{headers:{authorization:basic(apiKey),'user-agent':'RevenueHunter/0.4'}});
  if(r.status===429) return {connected:true,status:'rate_limited',matches:[]};
  if(!r.ok) return {connected:true,status:`http_${r.status}`,matches:[]};
  const body=await r.json();
  const candidates=(body.items||[]).map(x=>({...x,identityScore:companyIdentitySimilarity(prospect,x)})).sort((a,b)=>b.identityScore-a.identityScore);
  const best=candidates[0];
  if(!best||best.identityScore<52) return {connected:true,status:'no_confident_match',matches:candidates.slice(0,3)};
  let profile=null,officers=[];
  try{ profile=await get(`/company/${encodeURIComponent(best.company_number)}`,apiKey); }catch{}
  try{ const o=await get(`/company/${encodeURIComponent(best.company_number)}/officers?items_per_page=8`,apiKey); officers=(o.items||[]).filter(x=>!x.resigned_on).slice(0,5).map(x=>({name:x.name,role:x.officer_role,appointedOn:x.appointed_on})); }catch{}
  return {connected:true,status:'matched',companyNumber:best.company_number,companyName:best.title,companyStatus:profile?.company_status||best.company_status||'',companyType:profile?.type||'',sicCodes:profile?.sic_codes||[],registeredAddress:addr(profile?.registered_office_address)||best.address_snippet||'',dateOfCreation:profile?.date_of_creation||best.date_of_creation||'',identityScore:best.identityScore,officers,matches:candidates.slice(0,3).map(x=>({companyNumber:x.company_number,name:x.title,status:x.company_status,score:x.identityScore,address:x.address_snippet||addr(x.address)}))};
}
