const express = require('express');
const router = express.Router();
const pool = require('./db');
const { generateInvoice } = require('./invoice');

const DEFAULT_TASKS = {
  fab:   [['Steel prep',0],['Welding',1],['Frame assembly',2],['Quality check',3]],
  galv:  [['Send to galvanisers',0],['Collect from galvanisers',1]],
  order: [['Axles',0],['Wheels',1],['Coupling',2],['Aluboard / decking',3],['Chassis plate & pack',4],['Lights & wiring',5],['Electrics',6]],
  fit:   [['Fit axles & wheels',0],['Coupling fitted',1],['Decking / floor',2],['Lights wired',3],['Final inspection',4],['Brake test',5]],
  ready: [['Balance invoice sent',0],['Invoice paid',1],['Delivery booked',2]],
};

// ── Health ────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({ ok: true }));

// ── One-time cleanup (remove after use) ───────────────────────────────────
router.post('/admin/cleanup-people', async (req, res) => {
  await pool.query('DELETE FROM people WHERE id NOT IN (SELECT MIN(id) FROM people GROUP BY name)');
  try { await pool.query('ALTER TABLE people ADD CONSTRAINT people_name_unique UNIQUE (name)'); } catch(e) {}
  const { rows } = await pool.query('SELECT * FROM people ORDER BY id');
  res.json({ ok: true, people: rows });
});

// ── People ────────────────────────────────────────────────────────────────
router.get('/api/people', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM people ORDER BY id');
  res.json(rows);
});

// ── Jobs list ─────────────────────────────────────────────────────────────
router.get('/api/jobs', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT j.*, p.name AS assigned_name, p.color AS assigned_color, p.initials AS assigned_initials
    FROM jobs j LEFT JOIN people p ON j.assigned_to = p.id
    ORDER BY j.created_at DESC
  `);
  res.json(rows);
});

// ── Single job ────────────────────────────────────────────────────────────
router.get('/api/jobs/:id', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT j.*, p.name AS assigned_name, p.color AS assigned_color, p.initials AS assigned_initials
    FROM jobs j LEFT JOIN people p ON j.assigned_to = p.id WHERE j.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  const tasks = await pool.query(`
    SELECT t.*, p.name AS person_name FROM job_tasks t
    LEFT JOIN people p ON t.assigned_to = p.id
    WHERE t.job_id = $1 ORDER BY t.stage, t.sort_order
  `, [req.params.id]);

  const activity = await pool.query(
    'SELECT * FROM job_activity WHERE job_id = $1 ORDER BY created_at DESC',
    [req.params.id]
  );

  res.json({ ...rows[0], tasks: tasks.rows, activity: activity.rows });
});

// ── Create job ────────────────────────────────────────────────────────────
router.post('/api/jobs', async (req, res) => {
  const { customer_name, customer_phone, customer_email, trailer_type, spec, notes,
          price, deposit_amount, deposit_paid, assigned_to, due_date } = req.body;

  const { rows } = await pool.query(`
    INSERT INTO jobs (customer_name, customer_phone, customer_email, trailer_type, spec,
      notes, price, deposit_amount, deposit_paid, assigned_to, due_date, stage)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'quote') RETURNING id
  `, [customer_name, customer_phone||null, customer_email||null, trailer_type||null,
      spec||null, notes||null, price||0, deposit_amount||0,
      deposit_paid||false, assigned_to||null, due_date||null]);

  const jobId = rows[0].id;

  // Insert default tasks
  for (const [stage, tasks] of Object.entries(DEFAULT_TASKS)) {
    for (const [label, order] of tasks) {
      await pool.query(
        'INSERT INTO job_tasks (job_id, stage, label, sort_order) VALUES ($1,$2,$3,$4)',
        [jobId, stage, label, order]
      );
    }
  }

  await pool.query('INSERT INTO job_activity (job_id, text) VALUES ($1, $2)',
    [jobId, 'Job created']);
  if (deposit_paid && parseFloat(deposit_amount) > 0) {
    await pool.query('INSERT INTO job_activity (job_id, text) VALUES ($1, $2)',
      [jobId, `Deposit £${parseFloat(deposit_amount).toFixed(2)} received`]);
  }

  res.json({ id: jobId });
});

// ── Update job fields ─────────────────────────────────────────────────────
router.patch('/api/jobs/:id', async (req, res) => {
  const allowed = ['customer_name','customer_phone','customer_email','trailer_type',
    'spec','notes','price','deposit_amount','deposit_paid','balance_paid','stage',
    'assigned_to','due_date'];
  const updates = [];
  const vals = [];
  let i = 1;

  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    updates.push(`${k} = $${i++}`);
    vals.push(v === '' ? null : v);
  }
  if (!updates.length) return res.json({ ok: true });

  vals.push(req.params.id);
  await pool.query(`UPDATE jobs SET ${updates.join(',')} WHERE id = $${i}`, vals);

  // Log stage changes
  if (req.body.stage) {
    await pool.query('INSERT INTO job_activity (job_id, text) VALUES ($1,$2)',
      [req.params.id, `Stage changed to: ${req.body.stage}`]);
  }
  res.json({ ok: true });
});

// ── Delete job ────────────────────────────────────────────────────────────
router.delete('/api/jobs/:id', async (req, res) => {
  await pool.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ── Task toggle ───────────────────────────────────────────────────────────
router.patch('/api/tasks/:id', async (req, res) => {
  const { done, assigned_to } = req.body;
  const updates = [];
  const vals = [];
  let i = 1;
  if (done !== undefined) { updates.push(`done = $${i++}`); vals.push(done); }
  if (assigned_to !== undefined) { updates.push(`assigned_to = $${i++}`); vals.push(assigned_to || null); }
  if (!updates.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await pool.query(`UPDATE job_tasks SET ${updates.join(',')} WHERE id = $${i}`, vals);
  res.json({ ok: true });
});

// ── Add activity note ─────────────────────────────────────────────────────
router.post('/api/jobs/:id/notes', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
  await pool.query('INSERT INTO job_activity (job_id, text) VALUES ($1,$2)',
    [req.params.id, text.trim()]);
  res.json({ ok: true });
});

// ── Invoice download ──────────────────────────────────────────────────────
router.get('/api/jobs/:id/invoice/:type', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const type = req.params.type; // 'deposit' or 'balance'
  if (!['deposit','balance'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  generateInvoice(res, rows[0], type);
});

module.exports = router;
