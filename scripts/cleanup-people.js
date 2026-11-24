const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
pool.query('DELETE FROM people WHERE id IN (4,5,6)')
  .then(r => { console.log('Deleted', r.rowCount, 'duplicate rows'); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); process.exit(1); });
