CREATE TABLE IF NOT EXISTS rh_prospects (
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
);
CREATE INDEX IF NOT EXISTS rh_prospects_score_idx ON rh_prospects(score DESC);
CREATE INDEX IF NOT EXISTS rh_prospects_stage_idx ON rh_prospects(stage);

CREATE TABLE IF NOT EXISTS rh_contacts (
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
);

CREATE TABLE IF NOT EXISTS rh_outcomes (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES rh_prospects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  quoted_amount REAL,
  paid_amount REAL,
  delivery_cost REAL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
