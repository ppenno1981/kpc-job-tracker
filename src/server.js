require('dotenv').config();
require('express-async-errors');
const express = require('express');
const path = require('path');
const pool = require('./db');
const routes = require('./routes');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(routes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Database ready');
}

app.listen(PORT, async () => {
  await initDb();
  console.log(`KPC Job Tracker running on port ${PORT}`);
});
