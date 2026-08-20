import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBrandAssets, extractContactsDeep, identityFingerprint, identityConfidence } from '../src/intelligence.mjs';
import { companyIdentitySimilarity } from '../src/companies-house.mjs';
import { opportunityFor, commercialEstimate, chooseOpportunity } from '../src/opportunity-library.mjs';
import { createGovernor } from '../src/governor.mjs';

test('extracts free brand assets and contacts from public HTML',()=>{
 const html=`<html><head><meta property="og:image" content="/share.jpg"><link rel="icon" href="/icon.png"></head><body><img class="site-logo" src="/logo.svg"><a href="mailto:hello@example-roofing.co.uk">Email</a><a href="tel:01273123456">Call</a><a href="https://instagram.com/example">IG</a></body></html>`;
 const brand=extractBrandAssets(html,'https://example-roofing.co.uk');
 const contacts=extractContactsDeep(html,['mailto:hello@example-roofing.co.uk','tel:01273123456','https://instagram.com/example'],'https://example-roofing.co.uk');
 assert.equal(brand.logoUrl,'https://example-roofing.co.uk/logo.svg');
 assert.equal(brand.ogImageUrl,'https://example-roofing.co.uk/share.jpg');
 assert.ok(contacts.emails.includes('hello@example-roofing.co.uk'));
 assert.ok(contacts.phones.includes('01273123456'));
});

test('identity graph fingerprints stable business signals',()=>{
 const fp=identityFingerprint({name:'Example Roofing Ltd',website:'https://www.example.co.uk',phone:'01273 123456',address:'Brighton BN1 1AA'});
 assert.match(fp,/exampleroofingltd/);
 assert.match(fp,/example\.co\.uk/);
 assert.match(fp,/BN11AA/);
 assert.ok(identityConfidence({prospect:{website:'x',phone:'1'},companyHouse:{status:'matched',identityScore:90},contacts:{emails:['a@b.co.uk']},brand:{logoUrl:'x'}})>80);
});

test('Companies House name matching prefers same company',()=>{
 const good=companyIdentitySimilarity({name:'Example Roofing Ltd',address:'Brighton BN1 1AA'},{title:'EXAMPLE ROOFING LIMITED',company_status:'active',address_snippet:'Brighton BN1 1AA'});
 const bad=companyIdentitySimilarity({name:'Example Roofing Ltd',address:'Brighton BN1 1AA'},{title:'OTHER SERVICES LIMITED',company_status:'active',address_snippet:'London SW1A 1AA'});
 assert.ok(good>bad);
 assert.ok(good>=70);
});

test('opportunity library produces margin-aware offer',()=>{
 const chosen=chooseOpportunity([{code:'NO_QUOTE_FLOW',severity:78,title:'No quote',solution:'quote'},{code:'NO_FAST_MESSAGE',severity:45,title:'No fast message',solution:'message'}]);
 assert.equal(chosen.finding.code,'NO_QUOTE_FLOW');
 const est=commercialEstimate({code:chosen.finding.code,score:82,severity:78});
 assert.ok(est.price>=250);
 assert.ok(est.expectedMargin>0);
 assert.equal(opportunityFor('NO_QUOTE_FLOW').demoType,'quote');
});

test('free-first governor caps expensive work',()=>{
 const g=createGovernor({RH_PROSPECTS_PER_RUN:'5',RH_DEEP_AUDITS_PER_RUN:'2',RH_BROWSER_ACTIONS_PER_RUN:'2'});
 assert.equal(g.allowDeepAudit(),true);assert.equal(g.allowDeepAudit(),true);assert.equal(g.allowDeepAudit(),false);
 assert.equal(g.allowBrowser(2),true);assert.equal(g.allowBrowser(1),false);
 assert.equal(g.snapshot().paidDependenciesRequired,false);
});
