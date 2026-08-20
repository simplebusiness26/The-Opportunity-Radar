const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rh_prospects (
    id TEXT PRIMARY KEY,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    website TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    category TEXT DEFAULT '',
    rating REAL,
    rating_count INTEGER,
    source TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'detected',
    score REAL,
    primary_problem TEXT,
    proposed_solution TEXT,
    offer_price INTEGER,
    findings_json TEXT,
    evidence_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source, external_id)
  )`,
  `CREATE INDEX IF NOT EXISTS rh_prospects_score_idx ON rh_prospects(score DESC)`,
  `CREATE INDEX IF NOT EXISTS rh_prospects_stage_idx ON rh_prospects(stage)`,
  `CREATE TABLE IF NOT EXISTS rh_contacts (
    id TEXT PRIMARY KEY,
    prospect_id TEXT NOT NULL REFERENCES rh_prospects(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    type TEXT DEFAULT '',
    confidence INTEGER DEFAULT 0,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    position TEXT DEFAULT '',
    seniority TEXT DEFAULT '',
    department TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(prospect_id, email)
  )`,
  `CREATE TABLE IF NOT EXISTS rh_outcomes (
    id TEXT PRIMARY KEY,
    prospect_id TEXT NOT NULL REFERENCES rh_prospects(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    quoted_amount REAL,
    paid_amount REAL,
    delivery_cost REAL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )`
];

export class RevenueRepository {
  constructor(db) { this.db = db; this.schemaReady = null; }

  async ensureSchema() {
    if (!this.schemaReady) {
      this.schemaReady = this.db.batch(SCHEMA.map(sql => this.db.prepare(sql))).catch(error => {
        this.schemaReady = null;
        throw error;
      });
    }
    await this.schemaReady;
  }

  async upsertProspect(p) {
    await this.ensureSchema();
    const prospectId = id();
    await this.db.prepare(`INSERT INTO rh_prospects
      (id, external_id, name, address, website, phone, category, rating, rating_count, source, stage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'detected', ?, ?)
      ON CONFLICT(source, external_id) DO UPDATE SET
      name=excluded.name,address=excluded.address,website=excluded.website,phone=excluded.phone,category=excluded.category,
      rating=excluded.rating,rating_count=excluded.rating_count,updated_at=excluded.updated_at`)
      .bind(prospectId, p.externalId, p.name, p.address, p.website, p.phone, p.category, p.rating, p.ratingCount, p.source, now(), now()).run();
    return this.db.prepare(`SELECT * FROM rh_prospects WHERE source=? AND external_id=?`).bind(p.source, p.externalId).first();
  }

  async list(limit = 50) {
    await this.ensureSchema();
    return (await this.db.prepare(`SELECT * FROM rh_prospects ORDER BY score DESC, updated_at DESC LIMIT ?`).bind(limit).all()).results;
  }

  async get(prospectId) {
    await this.ensureSchema();
    return this.db.prepare(`SELECT * FROM rh_prospects WHERE id=?`).bind(prospectId).first();
  }

  async saveInvestigation(prospectId, data) {
    await this.ensureSchema();
    await this.db.prepare(`UPDATE rh_prospects SET stage='investigated', score=?, primary_problem=?, proposed_solution=?, offer_price=?, findings_json=?, evidence_json=?, updated_at=? WHERE id=?`)
      .bind(data.score, data.primaryProblem, data.proposedSolution, data.offerPrice, JSON.stringify(data.findings), JSON.stringify(data.evidence), now(), prospectId).run();
    return this.get(prospectId);
  }

  async saveContacts(prospectId, contacts) {
    await this.ensureSchema();
    for (const c of contacts) await this.db.prepare(`INSERT OR REPLACE INTO rh_contacts (id, prospect_id, email, type, confidence, first_name, last_name, position, seniority, department, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id(), prospectId, c.email, c.type, c.confidence, c.firstName, c.lastName, c.position, c.seniority, c.department, now()).run();
    await this.db.prepare(`UPDATE rh_prospects SET stage='contact_ready', updated_at=? WHERE id=?`).bind(now(), prospectId).run();
    return (await this.db.prepare(`SELECT * FROM rh_contacts WHERE prospect_id=? ORDER BY confidence DESC`).bind(prospectId).all()).results;
  }

  async contacts(prospectId) {
    await this.ensureSchema();
    return (await this.db.prepare(`SELECT * FROM rh_contacts WHERE prospect_id=? ORDER BY confidence DESC`).bind(prospectId).all()).results;
  }

  async recordOutcome(prospectId, o) {
    await this.ensureSchema();
    await this.db.prepare(`INSERT INTO rh_outcomes (id, prospect_id, status, quoted_amount, paid_amount, delivery_cost, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id(), prospectId, o.status, o.quotedAmount ?? null, o.paidAmount ?? null, o.deliveryCost ?? null, o.notes ?? '', now()).run();
    await this.db.prepare(`UPDATE rh_prospects SET stage=?, updated_at=? WHERE id=?`).bind(o.status, now(), prospectId).run();
  }

  async dashboard() {
    await this.ensureSchema();
    const stages = (await this.db.prepare(`SELECT stage, COUNT(*) count FROM rh_prospects GROUP BY stage`).all()).results;
    const totals = await this.db.prepare(`SELECT COUNT(DISTINCT p.id) prospects, COALESCE(SUM(o.paid_amount),0) paid, COALESCE(SUM(o.delivery_cost),0) costs FROM rh_prospects p LEFT JOIN rh_outcomes o ON p.id=o.prospect_id`).first();
    const top = (await this.db.prepare(`SELECT id,name,category,score,primary_problem,offer_price,stage FROM rh_prospects ORDER BY score DESC LIMIT 10`).all()).results;
    return { stages, totals, top };
  }
}
