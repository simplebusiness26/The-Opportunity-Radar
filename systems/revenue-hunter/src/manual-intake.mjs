import { inspectWebsite } from './adapters.mjs';
import { deepSiteAudit, extractBrandAssets, extractContactsDeep, identityConfidence, identityFingerprint } from './intelligence.mjs';
import { inferOpportunitySignals, scoreProspect } from './scoring.mjs';
import { chooseOpportunity, commercialEstimate } from './opportunity-library.mjs';
import { createGovernor } from './governor.mjs';

const uniq=a=>[...new Set((a||[]).filter(Boolean))];
const safeUrl=value=>{let v=String(value||'').trim();if(!/^https?:\/\//i.test(v))v='https://'+v;const u=new URL(v);if(!['http:','https:'].includes(u.protocol))throw new Error('Use a normal http/https website URL');return u.href};
const nameFromUrl=value=>{const h=new URL(value).hostname.replace(/^www\./,'');return h.split('.')[0].replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase())};
const profileFromRendered=(p,raw={})=>{const lines=String(raw.markdown||'').split('\n').map(x=>x.replace(/^#{1,6}\s*/,'').replace(/^[-*]\s*/,'').trim()).filter(x=>x.length>=4&&x.length<=86).filter(x=>!/^(home|menu|contact|about|privacy|cookies|terms|skip|facebook|instagram|login)$/i.test(x));const u=uniq(lines.map(x=>x.replace(/\s+/g,' ')));return{headline:u.find(x=>x.length>=12&&x.length<=70)||p.name,services:u.filter(x=>!x.toLowerCase().includes(String(p.name).toLowerCase())).slice(0,8),source:'website'}};
const dedupeFindings=arr=>{const m=new Map();for(const f of arr||[]){const old=m.get(f.code);if(!old||Number(f.severity)>Number(old.severity))m.set(f.code,f)}return[...m.values()]};

export async function addManualWebsite({repo,env,input}){
 const website=safeUrl(input.website||input.url);
 const name=String(input.name||'').trim()||nameFromUrl(website);
 const category=String(input.category||'website').trim().toLowerCase();
 const address=String(input.location||input.address||'').trim();
 const domain=new URL(website).hostname.replace(/^www\./,'');
 const prospect=await repo.upsertProspect({externalId:'manual:'+domain,name,address,website,phone:'',category,rating:null,ratingCount:null,source:'manual'});
 const governor=createGovernor(env);
 let rendered={markdown:'',links:[],title:''},inspectionError='';
 try{if(governor.allowBrowser(2))rendered=await inspectWebsite({browser:env.BROWSER,url:website})}catch(e){inspectionError=e instanceof Error?e.message:String(e)}
 let audit=await deepSiteAudit({website,links:rendered.links||[],maxPages:governor.limits.auditPagesPerSite});
 const renderedSignals=rendered.markdown?inferOpportunitySignals({...rendered,website}):{findings:[],flags:{}};
 const findings=dedupeFindings([...(audit.findings||[]),...(renderedSignals.findings||[])]);
 const chosen=chooseOpportunity(findings);
 const brand=extractBrandAssets(audit.rawHomeHtml||'',website);
 const extracted=extractContactsDeep(audit.rawHomeHtml||'',rendered.links||[],website);
 const contacts={phones:uniq(extracted.phones||[]),emails:uniq(extracted.emails||[]),socials:extracted.socials||{},contactPage:extracted.contactPage||'',website,address};
 const identity=identityConfidence({prospect:{...prospect,website},companyHouse:{status:'not_connected'},contacts,brand});
 const o=chosen.opportunity,severity=Number(chosen.finding.severity||50);
 const components={pain:severity,buyerClarity:(contacts.phones.length||contacts.emails.length)?84:65,speedToCash:severity>=75?84:70,deliveryEase:Math.max(45,100-Math.round(o.effortMinutes/8)),evidence:Math.min(96,58+Number(audit.summary?.audited||0)*7+identity*.15),margin:o.marginScore,contactability:contacts.phones.length?88:(contacts.emails.length?82:62)};
 const scoring=scoreProspect(components);
 const commercial=commercialEstimate({code:chosen.finding.code,score:scoring.total,severity});
 const profile=profileFromRendered(prospect,rendered);
 const evidence={whyChosen:`manual website audit • ${audit.summary?.audited||1} page audit • ${chosen.finding.title.toLowerCase()} • ${Math.round(identity)}% identity confidence • ${Math.round(scoring.total)}/100 commercial score`,contacts,profile,inspectionError,scoring,sourceWebsite:website,manualIntake:true,governor:governor.snapshot()};
 const investigation={score:scoring.total,primaryProblem:chosen.finding.title,proposedSolution:commercial.solution,offerPrice:commercial.price,findings,opportunityCode:chosen.finding.code,expectedMargin:commercial.expectedMargin,expectedEffortMinutes:commercial.effortMinutes,evidence};
 const assets=[{type:'logo',url:brand.logoUrl,confidence:95},{type:'favicon',url:brand.faviconUrl,confidence:70},{type:'social_image',url:brand.ogImageUrl,confidence:85},{type:'hero',url:brand.heroImageUrl,confidence:80},...(brand.galleryUrls||[]).slice(0,6).map((url,i)=>({type:`gallery_${i+1}`,url,confidence:65}))].filter(x=>x.url);
 const intelligence={companyNumber:'',companyStatus:'',identityConfidence:identity,identity:{fingerprint:identityFingerprint({...prospect,website}),contacts,manual:true},brand,audit:{pages:audit.pages||[],summary:audit.summary||{},findings:audit.findings||[]},websiteFingerprint:`${website}|${audit.pages?.[0]?.bytes||0}|${audit.pages?.[0]?.title||''}`,assets};
 await repo.saveInvestigation(prospect.id,investigation);
 await repo.saveIntelligence(prospect.id,intelligence);
 if(contacts.emails.length)await repo.saveContacts(prospect.id,contacts.emails.map(email=>({email,type:'website',confidence:88})));
 return await repo.get(prospect.id);
}
