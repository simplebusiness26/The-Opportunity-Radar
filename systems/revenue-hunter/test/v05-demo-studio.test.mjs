import test from 'node:test';
import assert from 'node:assert/strict';
import { customerDemoHtml } from '../src/customer-demo.mjs';
import { addStyleStudio } from '../src/style-studio.mjs';

const prospect={
 id:'prospect-123',
 name:'Brighton Test Roofing',
 category:'roofers',
 address:'Brighton',
 phone:'01273 000000',
 brand_json:JSON.stringify({
  logoUrl:'https://example.com/logo.png',
  heroImageUrl:'https://example.com/roof.jpg',
  galleryUrls:['https://example.com/job1.jpg','https://example.com/job2.jpg']
 }),
 evidence_json:JSON.stringify({
  contacts:{phones:['01273 000000'],emails:['hello@example.com']},
  profile:{headline:'Roofing built around your home',services:['Roof Repairs','Flat Roofing','New Roofs']}
 })
};

test('customer demo is customer-facing and contains real prospect information',()=>{
 const html=customerDemoHtml(prospect);
 assert.match(html,/Brighton Test Roofing/);
 assert.match(html,/Roof Repairs/);
 assert.match(html,/01273 000000/);
 assert.doesNotMatch(html,/commercial score/i);
 assert.doesNotMatch(html,/indicative offer/i);
});

test('Style Studio adds controlled design choices and feedback submission',()=>{
 const html=addStyleStudio(customerDemoHtml(prospect),prospect);
 assert.match(html,/Try another look/);
 assert.match(html,/Make this feel more like your business/);
 assert.match(html,/Editorial/);
 assert.match(html,/Showcase/);
 assert.match(html,/Hero image/);
 assert.match(html,/Send my preferences/);
 assert.match(html,/\/api\/demo-feedback\/prospect-123/);
});
