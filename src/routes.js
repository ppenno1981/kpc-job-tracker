const express = require('express');
const router = express.Router();
const pool = require('./db');
const { generateInvoice } = require('./invoice');

// Generic default tasks (used if no trailer-specific sheet found)
const DEFAULT_TASKS = {
  fab:   [['Steel prep',0],['Welding',1],['Frame assembly',2],['Quality check',3]],
  galv:  [['Send to galvanisers',0],['Collect from galvanisers',1]],
  order: [['Axles',0],['Wheels',1],['Coupling',2],['Aluboard / decking',3],['Chassis plate & pack',4],['Lights & wiring',5],['Electrics',6]],
  fit:   [['Fit axles & wheels',0],['Coupling fitted',1],['Decking / floor',2],['Lights wired',3],['Final inspection',4],['Brake test',5]],
  ready: [['Balance invoice sent',0],['Invoice paid',1],['Delivery booked',2]],
};

// Trailer-type-specific build sheets (from KPC build sheet documents)
const BUILD_SHEETS = {
  'Whiterock Road Trailer': {
    fab:   [['Chassis',0],['Roof',1],['Sides',2],['Ramp',3],['Hinges',4],['Mesh Sides',5]],
    order: [['Axles',0],['Wheels',1],['Coupling',2],['J Wheel',3],['Flooring',4]],
  },
  'WhiteWater Boat Trailer': {
    fab:   [['Side Frames',0],['Crossmembers',1],['Drawbar',2],['Crossmember',3],['Roller Crossmember',4],['Roller Carriers',5],['Swing Brackets',6],['Winch Post',7]],
    order: [['Axle',0],['Wheels',1],['Coupling',2],['Winch',3],['Rollers',4],['Mudguards',5],['Lighting Board',6]],
  },
  'Boxxa Box Trailer': {
    fab:   [['Chassis',0],['Roof',1],['Corners',2],['Internal Frame',3],['Rear Surround',4],['Hatch',5],['Hatch Frame',6],['Rear Doors',7],['Rear Ramp',8],['Side Door',9],['Side Door Frame',10]],
    order: [['Axle',0],['Wheels',1],['Coupling',2],['Panels',3],['Lights',4],['Mudguards',5],['J Wheel',6],['Locks',7],['Hinges',8],['Flooring',9]],
  },
  'ATV Trailer': {
    fab:   [['Chassis',0],['Roof',1],['Sides',2],['Ramp',3],['Hinges',4],['Mesh Sides',5],['Walking Axle',6]],
    order: [['Stub Axles',0],['Wheels',1],['Coupling',2],['J Wheel',3],['Flooring',4]],
  },
  'IBC Trailer': {
    fab:   [],
    order: [['Stub Axles',0],['Wheels',1],['Coupling',2],['Drinker',3],['Wheel Bolts',4],['Ratchet Strap',5],['Hose',6],['Connectors',7],['Stand',8]],
  },
};

function getTasksForType(trailerType) {
  const sheet = BUILD_SHEETS[trailerType];
  return {
    fab:   (sheet?.fab   ?? DEFAULT_TASKS.fab),
    galv:  DEFAULT_TASKS.galv,
    order: (sheet?.order ?? DEFAULT_TASKS.order),
    fit:   DEFAULT_TASKS.fit,
    ready: DEFAULT_TASKS.ready,
  };
}

// ── Health ────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({ ok: true }));

// ── People ────────────────────────────────────────────────────────────────
router.get('/api/people', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM people ORDER BY id');
  res.json(rows);
});

// ── Jobs list ─────────────────────────────────────────────────────────────
router.get('/api/jobs', async (req, res) => {
  const archived = req.query.archived === '1';
  const { rows } = await pool.query(`
    SELECT j.*, p.name AS assigned_name, p.color AS assigned_color, p.initials AS assigned_initials
    FROM jobs j LEFT JOIN people p ON j.assigned_to = p.id
    WHERE j.archived = $1
    ORDER BY j.created_at DESC
  `, [archived]);
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

  // Insert trailer-type-specific (or generic) tasks
  const tasksToUse = getTasksForType(trailer_type);
  for (const [stage, tasks] of Object.entries(tasksToUse)) {
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
    'spec','notes','extras','price','deposit_amount','deposit_paid','balance_paid','stage',
    'assigned_to','due_date','archived'];
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
  if (done !== undefined) {
    updates.push(`done = $${i++}`); vals.push(done);
    updates.push(`done_at = $${i++}`); vals.push(done ? new Date() : null);
  }
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

// ── Admin PIN verify ──────────────────────────────────────────────────────
router.post('/api/admin/verify', (req, res) => {
  const pin = process.env.ADMIN_PIN || '1234';
  res.json({ ok: req.body.pin === pin });
});

// ── Galv send list ────────────────────────────────────────────────────────
router.get('/api/galv/pending', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT j.id, j.customer_name, j.trailer_type, j.spec, j.due_date,
           t.id AS task_id, t.label, t.done, t.done_at
    FROM jobs j
    JOIN job_tasks t ON t.job_id = j.id AND t.stage = 'galv'
    WHERE j.stage = 'galv' AND j.archived = false
    ORDER BY j.id, t.sort_order
  `);
  res.json(rows);
});

router.post('/api/galv/send', async (req, res) => {
  const { items } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'No items' });
  const { rows } = await pool.query(
    'INSERT INTO galv_sends (items) VALUES ($1) RETURNING id, sent_at',
    [JSON.stringify(items)]
  );
  res.json(rows[0]);
});

router.get('/api/galv/sends', async (req, res) => {
  const { rows } = await pool.query('SELECT id, sent_at, items FROM galv_sends ORDER BY sent_at DESC LIMIT 20');
  res.json(rows);
});

module.exports = router;
