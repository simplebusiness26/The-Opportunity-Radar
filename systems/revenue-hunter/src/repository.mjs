const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();

const BASE_SCHEMA=[
`CREATE TABLE IF NOT EXISTS rh_prospects (
 id TEXT PRIMARY KEY, external_id TEXT NOT NULL, name TEXT NOT NULL, address TEXT DEFAULT '', website TEXT DEFAULT '', phone TEXT DEFAULT '', category TEXT DEFAULT '', rating REAL, rating_count INTEGER, source TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'detected', score REAL, primary_problem TEXT, proposed_solution TEXT, offer_price INTEGER, findings_json TEXT, evidence_json TEXT, saved INTEGER NOT NULL DEFAULT 0, saved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(source, external_id))`,
`CREATE INDEX IF NOT EXISTS rh_prospects_score_idx ON rh_prospects(score DESC)`,
`CREATE INDEX IF NOT EXISTS rh_prospects_stage_idx ON rh_prospects(stage)`,
`CREATE TABLE IF NOT EXISTS rh_contacts (id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES rh_prospects(id) ON DELETE CASCADE, email TEXT NOT NULL, type TEXT DEFAULT '', confidence INTEGER DEFAULT 0, first_name TEXT DEFAULT '', last_name TEXT DEFAULT '', position TEXT DEFAULT '', seniority TEXT DEFAULT '', department TEXT DEFAULT '', created_at TEXT NOT NULL, UNIQUE(prospect_id,email))`,
`CREATE TABLE IF NOT EXISTS rh_outcomes (id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES rh_prospects(id) ON DELETE CASCADE, status TEXT NOT NULL, quoted_amount REAL, paid_amount REAL, delivery_cost REAL, notes TEXT DEFAULT '', created_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS rh_assets (id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES rh_prospects(id) ON DELETE CASCADE, asset_type TEXT NOT NULL, url TEXT NOT NULL, source TEXT DEFAULT '', confidence INTEGER DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(prospect_id,asset_type,url))`,
`CREATE TABLE IF NOT EXISTS rh_cache (cache_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS rh_sales_events (id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES rh_prospects(id) ON DELETE CASCADE, event_type TEXT NOT NULL, note TEXT DEFAULT '', value REAL, created_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS rh_notes (id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES rh_prospects(id) ON DELETE CASCADE, note TEXT NOT NULL, created_at TEXT NOT NULL)`,
`CREATE INDEX IF NOT EXISTS rh_sales_events_prospect_idx ON rh_sales_events(prospect_id,created_at DESC)`
];

const EXTRA_COLUMNS={
 company_number:'TEXT',company_status:'TEXT',identity_confidence:'REAL DEFAULT 0',identity_json:'TEXT',brand_json:'TEXT',audit_json:'TEXT',opportunity_code:'TEXT',expected_margin:'REAL',expected_effort_minutes:'INTEGER',sales_stage:"TEXT DEFAULT 'new'",next_action:'TEXT',last_hunted_at:'TEXT',website_fingerprint:'TEXT',last_audited_at:'TEXT',dossier_version:"TEXT DEFAULT 'v0.4'"
};

function isDuplicateColumnError(error){return /duplicate column name/i.test(String(error?.message||error||''))}

export class RevenueRepository{
 constructor(db){this.db=db;this.schemaReady=null}
 async ensureSchema(){
  if(!this.schemaReady)this.schemaReady=(async()=>{
   await this.db.batch(BASE_SCHEMA.map(sql=>this.db.prepare(sql)));
   const info=(await this.db.prepare('PRAGMA table_info(rh_prospects)').all()).results||[];
   const cols=new Set(info.map(x=>x.name));
   for(const [name,type] of Object.entries(EXTRA_COLUMNS)){
    if(cols.has(name))continue;
    try{
     await this.db.prepare(`ALTER TABLE rh_prospects ADD COLUMN ${name} ${type}`).run();
     cols.add(name);
    }catch(error){
     // Multiple Worker requests can race during a first deployment. If another
     // request added the same column after our PRAGMA read, the migration is
     // already complete and should not make the application unavailable.
     if(!isDuplicateColumnError(error))throw error;
     cols.add(name);
    }
   }
  })().catch(e=>{this.schemaReady=null;throw e});
  await this.schemaReady;
 }
 async upsertProspect(p){await this.ensureSchema();const pid=id();await this.db.prepare(`INSERT INTO rh_prospects(id,external_id,name,address,website,phone,category,rating,rating_count,source,stage,last_hunted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'detected',?,?,?) ON CONFLICT(source,external_id) DO UPDATE SET name=excluded.name,address=CASE WHEN excluded.address<>'' THEN excluded.address ELSE rh_prospects.address END,website=CASE WHEN excluded.website<>'' THEN excluded.website ELSE rh_prospects.website END,phone=CASE WHEN excluded.phone<>'' THEN excluded.phone ELSE rh_prospects.phone END,category=excluded.category,rating=excluded.rating,rating_count=excluded.rating_count,last_hunted_at=excluded.last_hunted_at,updated_at=excluded.updated_at`).bind(pid,p.externalId,p.name,p.address||'',p.website||'',p.phone||'',p.category||'',p.rating??null,p.ratingCount??null,p.source,now(),now(),now()).run();return this.db.prepare('SELECT * FROM rh_prospects WHERE source=? AND external_id=?').bind(p.source,p.externalId).first()}
 async list(limit=50,{savedOnly=false,salesStage=''}={}){await this.ensureSchema();let q='SELECT * FROM rh_prospects',args=[];const where=[];if(savedOnly)where.push('saved=1');if(salesStage){where.push('sales_stage=?');args.push(salesStage)}if(where.length)q+=' WHERE '+where.join(' AND ');q+=' ORDER BY saved DESC, score DESC, updated_at DESC LIMIT ?';args.push(limit);return (await this.db.prepare(q).bind(...args).all()).results}
 async get(pid){await this.ensureSchema();return this.db.prepare('SELECT * FROM rh_prospects WHERE id=?').bind(pid).first()}
 async saveInvestigation(pid,d){await this.ensureSchema();await this.db.prepare(`UPDATE rh_prospects SET stage='investigated',score=?,primary_problem=?,proposed_solution=?,offer_price=?,findings_json=?,evidence_json=?,opportunity_code=COALESCE(?,opportunity_code),expected_margin=COALESCE(?,expected_margin),expected_effort_minutes=COALESCE(?,expected_effort_minutes),updated_at=? WHERE id=?`).bind(d.score,d.primaryProblem,d.proposedSolution,d.offerPrice,JSON.stringify(d.findings||[]),JSON.stringify(d.evidence||{}),d.opportunityCode??null,d.expectedMargin??null,d.expectedEffortMinutes??null,now(),pid).run();return this.get(pid)}
 async saveIntelligence(pid,d){await this.ensureSchema();await this.db.prepare(`UPDATE rh_prospects SET company_number=?,company_status=?,identity_confidence=?,identity_json=?,brand_json=?,audit_json=?,website_fingerprint=?,last_audited_at=?,dossier_version='v0.4',updated_at=? WHERE id=?`).bind(d.companyNumber||'',d.companyStatus||'',d.identityConfidence||0,JSON.stringify(d.identity||{}),JSON.stringify(d.brand||{}),JSON.stringify(d.audit||{}),d.websiteFingerprint||'',now(),now(),pid).run();if(d.assets?.length){for(const a of d.assets)if(a.url)await this.db.prepare(`INSERT OR IGNORE INTO rh_assets(id,prospect_id,asset_type,url,source,confidence,created_at) VALUES(?,?,?,?,?,?,?)`).bind(id(),pid,a.type,a.url,a.source||'website',a.confidence||70,now()).run()}return this.get(pid)}
 async assets(pid){await this.ensureSchema();return (await this.db.prepare('SELECT * FROM rh_assets WHERE prospect_id=? ORDER BY confidence DESC,created_at DESC').bind(pid).all()).results}
 async toggleSaved(pid,saved=true){await this.ensureSchema();await this.db.prepare('UPDATE rh_prospects SET saved=?,saved_at=?,updated_at=? WHERE id=?').bind(saved?1:0,saved?now():null,now(),pid).run();return this.get(pid)}
 async saveContacts(pid,contacts){await this.ensureSchema();for(const c of contacts||[])if(c.email)await this.db.prepare(`INSERT OR REPLACE INTO rh_contacts(id,prospect_id,email,type,confidence,first_name,last_name,position,seniority,department,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id(),pid,c.email,c.type||'',c.confidence||0,c.firstName||'',c.lastName||'',c.position||'',c.seniority||'',c.department||'',now()).run();return this.contacts(pid)}
 async contacts(pid){await this.ensureSchema();return (await this.db.prepare('SELECT * FROM rh_contacts WHERE prospect_id=? ORDER BY confidence DESC').bind(pid).all()).results}
 async updateSales(pid,{stage,nextAction='',note='',value=null}={}){await this.ensureSchema();if(stage)await this.db.prepare('UPDATE rh_prospects SET sales_stage=?,next_action=?,updated_at=? WHERE id=?').bind(stage,nextAction,now(),pid).run();if(stage||note)await this.db.prepare('INSERT INTO rh_sales_events(id,prospect_id,event_type,note,value,created_at) VALUES(?,?,?,?,?,?)').bind(id(),pid,stage||'note',note,value,now()).run();return this.get(pid)}
 async addNote(pid,note){await this.ensureSchema();await this.db.prepare('INSERT INTO rh_notes(id,prospect_id,note,created_at) VALUES(?,?,?,?)').bind(id(),pid,note,now()).run();return this.notes(pid)}
 async notes(pid){await this.ensureSchema();return (await this.db.prepare('SELECT * FROM rh_notes WHERE prospect_id=? ORDER BY created_at DESC LIMIT 30').bind(pid).all()).results}
 async salesEvents(pid){await this.ensureSchema();return (await this.db.prepare('SELECT * FROM rh_sales_events WHERE prospect_id=? ORDER BY created_at DESC LIMIT 50').bind(pid).all()).results}
 async recordOutcome(pid,o){await this.ensureSchema();await this.db.prepare('INSERT INTO rh_outcomes(id,prospect_id,status,quoted_amount,paid_amount,delivery_cost,notes,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id(),pid,o.status,o.quotedAmount??null,o.paidAmount??null,o.deliveryCost??null,o.notes||'',now()).run();const stage=o.status==='won'||o.status==='paid'?o.status:(o.status==='lost'?'lost':o.status);await this.updateSales(pid,{stage,nextAction:'',note:o.notes||'',value:o.paidAmount??o.quotedAmount??null})}
 async learningSummary(){await this.ensureSchema();const byCategory=(await this.db.prepare(`SELECT p.category,COUNT(DISTINCT p.id) prospects,SUM(CASE WHEN o.status IN ('won','paid') THEN 1 ELSE 0 END) wins,COALESCE(SUM(o.paid_amount),0) paid FROM rh_prospects p LEFT JOIN rh_outcomes o ON p.id=o.prospect_id GROUP BY p.category ORDER BY paid DESC,wins DESC LIMIT 12`).all()).results;const byOpportunity=(await this.db.prepare(`SELECT COALESCE(p.opportunity_code,'unknown') opportunity,COUNT(DISTINCT p.id) prospects,SUM(CASE WHEN o.status IN ('won','paid') THEN 1 ELSE 0 END) wins,COALESCE(SUM(o.paid_amount),0) paid FROM rh_prospects p LEFT JOIN rh_outcomes o ON p.id=o.prospect_id GROUP BY p.opportunity_code ORDER BY paid DESC,wins DESC LIMIT 12`).all()).results;return {byCategory,byOpportunity}}
 async cacheGet(key){await this.ensureSchema();const x=await this.db.prepare('SELECT value_json,expires_at FROM rh_cache WHERE cache_key=?').bind(key).first();if(!x||new Date(x.expires_at)<=new Date())return null;try{return JSON.parse(x.value_json)}catch{return null}}
 async cacheSet(key,value,ttlHours=72){await this.ensureSchema();const expires=new Date(Date.now()+ttlHours*3600000).toISOString();await this.db.prepare('INSERT INTO rh_cache(cache_key,value_json,expires_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at').bind(key,JSON.stringify(value),expires,now()).run();return value}
 async dashboard(){await this.ensureSchema();const stages=(await this.db.prepare('SELECT stage,COUNT(*) count FROM rh_prospects GROUP BY stage').all()).results;const sales=(await this.db.prepare('SELECT sales_stage,COUNT(*) count FROM rh_prospects GROUP BY sales_stage').all()).results;const totals=await this.db.prepare(`SELECT COUNT(*) prospects,SUM(saved) saved,COALESCE(SUM(CASE WHEN score>=80 THEN 1 ELSE 0 END),0) high_value,COALESCE(SUM(expected_margin),0) indicative_margin FROM rh_prospects`).first();const money=await this.db.prepare(`SELECT COALESCE(SUM(paid_amount),0) paid,COALESCE(SUM(delivery_cost),0) costs FROM rh_outcomes`).first();return {stages,sales,totals:{...totals,...money},learning:await this.learningSummary()}}
}
