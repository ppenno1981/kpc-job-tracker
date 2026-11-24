-- KPC Engineering Job Tracker schema

CREATE TABLE IF NOT EXISTS people (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  color TEXT DEFAULT '#1d6fa4',
  initials TEXT
);

-- Remove duplicate people before adding unique constraint
DELETE FROM people WHERE id NOT IN (SELECT MIN(id) FROM people GROUP BY name);

-- Add unique constraint idempotently (safe if already exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'people_name_unique'
  ) THEN
    ALTER TABLE people ADD CONSTRAINT people_name_unique UNIQUE (name);
  END IF;
END $$;

INSERT INTO people (name, role, color, initials) VALUES
  ('Mark',  'Fabricator', '#1d6fa4', 'MK'),
  ('Steve', 'Welder',     '#8e44ad', 'SW'),
  ('Dave',  'Fitter',     '#16a085', 'DV')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  trailer_type TEXT,
  spec TEXT,
  notes TEXT,
  price NUMERIC(10,2) DEFAULT 0,
  deposit_amount NUMERIC(10,2) DEFAULT 0,
  deposit_paid BOOLEAN DEFAULT false,
  balance_paid BOOLEAN DEFAULT false,
  stage TEXT DEFAULT 'quote',
  assigned_to INTEGER REFERENCES people(id) ON DELETE SET NULL,
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_tasks (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  label TEXT NOT NULL,
  done BOOLEAN DEFAULT false,
  assigned_to INTEGER REFERENCES people(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job_activity (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jobs_updated_at ON jobs;
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
