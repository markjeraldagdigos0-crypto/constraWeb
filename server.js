const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Helper function to get current Philippine Time (PST)
function getPHTime() {
  const now = new Date();
  const optionsDate = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
  const optionsTime = { timeZone: 'Asia/Manila', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
  
  const formatterDate = new Intl.DateTimeFormat('en-CA', optionsDate); // YYYY-MM-DD format
  const formatterTime = new Intl.DateTimeFormat('en-GB', optionsTime); // HH:MM:SS format
  
  return {
    date: formatterDate.format(now),
    time: formatterTime.format(now),
    timestamp: new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
  };
}

// Initialize Database Tables & Default Settings
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'BuildCorp Construction',
        company_logo TEXT DEFAULT '',
        company_address VARCHAR(255) DEFAULT '123 Builder St, Metro City',
        contact_number VARCHAR(50) DEFAULT '555-0199'
      );

      CREATE TABLE IF NOT EXISTS work_schedules (
        id SERIAL PRIMARY KEY,
        morning_start VARCHAR(10) DEFAULT '07:00',
        morning_end VARCHAR(10) DEFAULT '12:00',
        afternoon_start VARCHAR(10) DEFAULT '13:00',
        afternoon_end VARCHAR(10) DEFAULT '17:00',
        full_day_hours NUMERIC DEFAULT 9,
        half_day_hours NUMERIC DEFAULT 4.5
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100) NOT NULL,
        contact_number VARCHAR(50),
        daily_rate NUMERIC(10,2) NOT NULL DEFAULT 500.00,
        assigned_project VARCHAR(255),
        profile_picture TEXT,
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        attendance_date DATE NOT NULL,
        attendance_time TIME NOT NULL,
        attendance_type VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advance_money (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        advance_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        material_name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        unit VARCHAR(50),
        current_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
        minimum_stock_level NUMERIC(10,2) NOT NULL DEFAULT 10,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS stock_transactions (
        id SERIAL PRIMARY KEY,
        material_id INTEGER NOT NULL,
        transaction_type VARCHAR(10) NOT NULL,
        quantity NUMERIC(10,2) NOT NULL,
        stock_after NUMERIC(10,2) NOT NULL,
        reference_person VARCHAR(255),
        project VARCHAR(255),
        purpose TEXT,
        notes TEXT,
        recorded_from VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const settingsCheck = await pool.query('SELECT * FROM company_settings');
    if (settingsCheck.rows.length === 0) {
      await pool.query('INSERT INTO company_settings (company_name) VALUES ($1)', ['BuildCorp Construction']);
    }
    const scheduleCheck = await pool.query('SELECT * FROM work_schedules');
    if (scheduleCheck.rows.length === 0) {
      await pool.query('INSERT INTO work_schedules DEFAULT VALUES');
    }
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}
initDB();

async function getSettings() {
  const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
  return res.rows[0] || { company_name: 'BuildCorp Construction', company_logo: '', company_address: '', contact_number: '' };
}

function layout(title, content, activeTab = '') {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        :root { --primary: #1e293b; --accent: #2563eb; --success: #16a34a; --danger: #dc2626; --warning: #d97706; --bg: #f8fafc; --card: #ffffff; --text: #0f172a; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: var(--bg); color: var(--text); line-height: 1.5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { background: var(--card); padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .brand { display: flex; align-items: center; gap: 15px; }
        .brand img { max-height: 50px; max-width: 50px; object-fit: contain; }
        nav { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; background: var(--card); padding: 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        nav a { text-decoration: none; color: var(--text); padding: 8px 12px; border-radius: 4px; font-size: 14px; font-weight: 600; background: #e2e8f0; transition: 0.2s; }
        nav a:hover, nav a.active { background: var(--accent); color: white; }
        .card { background: var(--card); padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
        h1, h2, h3 { margin-bottom: 15px; color: var(--primary); }
        .btn { display: inline-block; background: var(--accent); color: white; padding: 10px 16px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; font-weight: 600; font-size: 14px; }
        .btn:hover { opacity: 0.9; }
        .btn-success { background: var(--success); }
        .btn-danger { background: var(--danger); }
        .btn-warning { background: var(--warning); }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
        th { background: #f1f5f9; color: var(--primary); }
        input, select, textarea { width: 100%; padding: 10px; margin-bottom: 15px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 14px; }
        .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
        .alert-box { padding: 15px; border-radius: 6px; margin-bottom: 15px; font-weight: bold; }
        .alert-danger { background: #fee2e2; color: var(--danger); }
        .alert-success { background: #dcfce7; color: var(--success); }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .badge-success { background: #dcfce7; color: var(--success); }
        .badge-warning { background: #fef3c7; color: var(--warning); }
        .badge-danger { background: #fee2e2; color: var(--danger); }
        @media print {
          nav, header, .no-print { display: none !important; }
          body { background: white; padding: 0; }
          .card { box-shadow: none; padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${content}
      </div>
    </body>
    </html>
  `;
}

// ==========================================
// MAIN PAGE /
// ==========================================
app.get('/', async (req, res) => {
  const settings = await getSettings();
  const html = `
    <div style="text-align: center; padding: 40px 20px;">
      ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo" style="max-height: 80px; margin-bottom: 15px;">` : ''}
      <h1 style="font-size: 32px; margin-bottom: 10px;">${settings.company_name}</h1>
      <p style="color: #64748b; margin-bottom: 30px;">Construction Worker & Inventory Management System</p>
      
      <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">
        <a href="/admin" class="btn" style="padding: 20px 40px; font-size: 18px;">ADMIN PORTAL</a>
        <a href="/worker" class="btn btn-success" style="padding: 20px 40px; font-size: 18px;">WORKER PORTAL</a>
        <a href="/scanner" class="btn btn-warning" style="padding: 20px 40px; font-size: 18px;">SCANNER PORTAL</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Main', html));
});

// ==========================================
// ADMIN PORTAL /admin
// ==========================================
const adminNav = `
  <nav class="no-print">
    <a href="/admin">Dashboard</a>
    <a href="/admin/workers">Workers</a>
    <a href="/admin/attendance">Attendance</a>
    <a href="/admin/stock">Stock Inventory</a>
    <a href="/admin/advance">Advance Money</a>
    <a href="/admin/salary">Salary & Payroll</a>
    <a href="/admin/announcements">Announcements</a>
    <a href="/admin/settings">Company Settings</a>
    <a href="/admin/schedule">Work Schedule</a>
  </nav>
`;

app.get('/admin', async (req, res) => {
  const settings = await getSettings();
  const workersCount = await pool.query('SELECT COUNT(*) FROM workers');
  const phNow = getPHTime();
  const today = phNow.date;
  const presentToday = await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE attendance_date = $1', [today]);
  const materialsCount = await pool.query('SELECT COUNT(*) FROM materials');
  const lowStock = await pool.query('SELECT * FROM materials WHERE current_quantity <= minimum_stock_level');
  const recentAttendance = await pool.query('SELECT a.*, w.full_name FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id ORDER BY a.created_at DESC LIMIT 5');

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Admin Portal</h2>
      </div>
    </header>
    ${adminNav}
    <div class="grid-2">
      <div class="card">
        <h3>Workers Overview</h3>
        <p><strong>Total Workers:</strong> ${workersCount.rows[0].count}</p>
        <p><strong>Present Today:</strong> ${presentToday.rows[0].count}</p>
      </div>
      <div class="card">
        <h3>Stock Overview</h3>
        <p><strong>Total Materials:</strong> ${materialsCount.rows[0].count}</p>
        <p><strong>Low Stock Items:</strong> ${lowStock.rows.length}</p>
      </div>
    </div>
    ${lowStock.rows.length > 0 ? `
      <div class="card alert-danger">
        <h3>LOW STOCK ALERT - PLEASE RESTOCK</h3>
        <ul>
          ${lowStock.rows.map(m => `<li>${m.material_name} (Current: ${m.current_quantity} ${m.unit}, Min: ${m.minimum_stock_level})</li>`).join('')}
        </ul>
      </div>
    ` : ''}
    <div class="card">
      <h3>Recent Attendance Logs</h3>
      <table>
        <tr><th>Worker ID</th><th>Name</th><th>Type</th><th>Date</th><th>Time</th></tr>
        ${recentAttendance.rows.map(r => `<tr><td>${r.worker_id}</td><td>${r.full_name}</td><td><span class="badge ${r.attendance_type === 'IN' ? 'badge-success' : 'badge-warning'}">${r.attendance_type}</span></td><td>${r.attendance_date.toISOString().split('T')[0]}</td><td>${r.attendance_time}</td></tr>`).join('')}
      </table>
    </div>
  `;
  res.send(layout('Admin Dashboard', content));
});

// Worker Management
app.get('/admin/workers', async (req, res) => {
  const search = req.query.search || '';
  const workers = await pool.query('SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 ORDER BY id DESC', [`%${search}%`]);

  let content = `
    <header><div class="brand"><h2>Worker Management</h2></div></header>
    ${adminNav}
    <div class="card">
      <form action="/admin/workers" method="GET" style="display: flex; gap: 10px; margin-bottom: 15px;">
        <input type="text" name="search" placeholder="Search by name or ID..." value="${search}">
        <button type="submit" class="btn" style="height: 42px;">Search</button>
        <a href="/admin/workers/register" class="btn btn-success" style="height: 42px; line-height: 22px;">Register Worker</a>
      </form>
      <table>
        <tr><th>ID</th><th>Name</th><th>Position</th><th>Daily Rate</th><th>Project</th><th>Status</th><th>Actions</th></tr>
        ${workers.rows.map(w => `
          <tr>
            <td>${w.worker_id}</td>
            <td>${w.full_name}</td>
            <td>${w.position}</td>
            <td>₱${w.daily_rate}</td>
            <td>${w.assigned_project || '-'}</td>
            <td><span class="badge ${w.status === 'Active' ? 'badge-success' : 'badge-danger'}">${w.status}</span></td>
            <td>
              <a href="/admin/workers/qr/${w.worker_id}" class="btn" style="padding: 4px 8px; font-size: 12px;">QR Code</a>
              <a href="/admin/workers/edit/${w.worker_id}" class="btn btn-warning" style="padding: 4px 8px; font-size: 12px;">Edit</a>
              <a href="/admin/workers/toggle/${w.worker_id}" class="btn ${w.status === 'Active' ? 'btn-danger' : 'btn-success'}" style="padding: 4px 8px; font-size: 12px;">${w.status === 'Active' ? 'Deactivate' : 'Activate'}</a>
            </td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
  res.send(layout('Workers Management', content));
});

app.get('/admin/workers/register', async (req, res) => {
  const countRes = await pool.query('SELECT COUNT(*) FROM workers');
  const nextIdNum = parseInt(countRes.rows[0].count) + 1;
  const autoWorkerId = 'W-' + String(nextIdNum).padStart(4, '0');

  let content = `
    <header><div class="brand"><h2>Register New Worker</h2></div></header>
    ${adminNav}
    <div class="card">
      <form action="/admin/workers/register" method="POST">
        <label>Worker ID (Auto Generated)</label>
        <input type="text" name="worker_id" value="${autoWorkerId}" readonly style="background: #e2e8f0;">
        <label>Full Name</label>
        <input type="text" name="full_name" required>
        <label>Position</label>
        <input type="text" name="position" required>
        <label>Contact Number</label>
        <input type="text" name="contact_number">
        <label>Daily Rate (₱)</label>
        <input type="number" step="0.01" name="daily_rate" value="500.00" required>
        <label>Assigned Project</label>
        <input type="text" name="assigned_project">
        <button type="submit" class="btn btn-success">Save Worker & Generate QR</button>
      </form>
    </div>
  `;
  res.send(layout('Register Worker', content));
});

app.post('/admin/workers/register', async (req, res) => {
  const { worker_id, full_name, position, contact_number, daily_rate, assigned_project } = req.body;
  await pool.query('INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project) VALUES ($1, $2, $3, $4, $5, $6)',
    [worker_id, full_name, position, contact_number, daily_rate, assigned_project]);
  res.redirect(`/admin/workers/qr/${worker_id}`);
});

app.get('/admin/workers/qr/:worker_id', async (req, res) => {
  const { worker_id } = req.params;
  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
  const settings = await getSettings();
  if (workerRes.rows.length === 0) return res.send('Worker not found');
  const worker = workerRes.rows[0];

  let content = `
    <header><div class="brand"><h2>Worker QR Code</h2></div></header>
    ${adminNav}
    <div class="card" style="text-align: center; max-width: 450px; margin: 0 auto;">
      ${settings.company_logo ? `<img src="${settings.company_logo}" style="max-height: 40px; margin-bottom: 10px;">` : ''}
      <h3>${settings.company_name}</h3>
      <hr style="margin: 10px 0;">
      <h2 style="margin: 10px 0;">${worker.full_name}</h2>
      <p style="font-size: 16px; font-weight: bold; color: var(--accent);">ID: ${worker.worker_id}</p>
      <p style="margin-bottom: 15px;">Position: ${worker.position}</p>
      <div id="qrcode" style="display: flex; justify-content: center; margin: 20px 0;"></div>
      <button onclick="window.print()" class="btn">Print QR Code</button>
      <a href="/admin/workers" class="btn btn-warning">Back to Workers</a>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
      new QRCode(document.getElementById("qrcode"), {
        text: "${worker.worker_id}",
        width: 200,
        height: 200
      });
    </script>
  `;
  res.send(layout('Worker QR', content));
});

app.get('/admin/workers/toggle/:worker_id', async (req, res) => {
  const { worker_id } = req.params;
  const workerRes = await pool.query('SELECT status FROM workers WHERE worker_id = $1', [worker_id]);
  if (workerRes.rows.length > 0) {
    const newStatus = workerRes.rows[0].status === 'Active' ? 'Inactive' : 'Active';
    await pool.query('UPDATE workers SET status = $1 WHERE worker_id = $2', [newStatus, worker_id]);
  }
  res.redirect('/admin/workers');
});

// Admin Attendance Report & Clear Logs
app.get('/admin/attendance', async (req, res) => {
  const search = req.query.search || '';
  const dateFilter = req.query.date || '';
  let query = 'SELECT a.*, w.full_name FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id WHERE 1=1';
  let params = [];
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (w.full_name ILIKE $${params.length} OR a.worker_id ILIKE $${params.length})`;
  }
  if (dateFilter) {
    params.push(dateFilter);
    query += ` AND a.attendance_date = $${params.length}`;
  }
  query += ' ORDER BY a.attendance_date DESC, a.attendance_time DESC LIMIT 100';
  const logs = await pool.query(query, params);

  let content = `
    <header><div class="brand"><h2>Attendance Logs</h2></div></header>
    ${adminNav}
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
        <form action="/admin/attendance" method="GET" style="display: flex; gap: 10px; flex: 1; min-width: 280px; margin-bottom: 0;">
          <input type="text" name="search" placeholder="Worker Name or ID..." value="${search}" style="flex: 1;">
          <input type="date" name="date" value="${dateFilter}" style="width: 180px;">
          <button type="submit" class="btn" style="height: 42px;">Filter</button>
        </form>
        <a href="/admin/attendance/clear" class="btn btn-danger" onclick="return confirm('Are you sure you want to clear ALL attendance logs?');" style="height: 42px; line-height: 22px;">Clear All Logs</a>
      </div>
      <table>
        <tr><th>Worker ID</th><th>Name</th><th>Date</th><th>Time</th><th>Type</th></tr>
        ${logs.rows.map(l => `<tr><td>${l.worker_id}</td><td>${l.full_name}</td><td>${l.attendance_date.toISOString().split('T')[0]}</td><td>${l.attendance_time}</td><td><span class="badge ${l.attendance_type === 'IN' ? 'badge-success' : 'badge-warning'}">${l.attendance_type}</span></td></tr>`).join('')}
      </table>
    </div>
  `;
  res.send(layout('Attendance Report', content));
});

app.get('/admin/attendance/clear', async (req, res) => {
  await pool.query('DELETE FROM attendance_logs');
  res.redirect('/admin/attendance');
});

// Admin Stock Inventory
app.get('/admin/stock', async (req, res) => {
  const materials = await pool.query('SELECT * FROM materials ORDER BY material_name ASC');
  const history = await pool.query('SELECT st.*, m.material_name, m.unit FROM stock_transactions st JOIN materials m ON st.material_id = m.id ORDER BY st.created_at DESC LIMIT 20');

  let content = `
    <header><div class="brand"><h2>Stock Inventory</h2></div></header>
    ${adminNav}
    <div class="card">
      <h3>Materials List</h3>
      <a href="/admin/stock/add" class="btn btn-success" style="margin-bottom: 15px;">Add New Material</a>
      <table>
        <tr><th>Material</th><th>Category</th><th>Unit</th><th>Current Stock</th><th>Min Level</th><th>Status</th></tr>
        ${materials.rows.map(m => `
          <tr>
            <td>${m.material_name}</td>
            <td>${m.category || '-'}</td>
            <td>${m.unit}</td>
            <td>${m.current_quantity}</td>
            <td>${m.minimum_stock_level}</td>
            <td>${m.current_quantity <= m.minimum_stock_level ? '<span class="badge badge-danger">LOW STOCK</span>' : '<span class="badge badge-success">OK</span>'}</td>
          </tr>
        `).join('')}
      </table>
    </div>
    <div class="card">
      <h3>Recent Stock Transactions</h3>
      <table>
        <tr><th>Date/Time</th><th>Material</th><th>Type</th><th>Qty</th><th>Stock After</th><th>Reference / Project</th></tr>
        ${history.rows.map(h => `
          <tr>
            <td>${h.created_at.toISOString().replace('T', ' ').substring(0, 16)}</td>
            <td>${h.material_name}</td>
            <td><span class="badge ${h.transaction_type === 'IN' ? 'badge-success' : 'badge-danger'}">${h.transaction_type}</span></td>
            <td>${h.quantity} ${h.unit}</td>
            <td>${h.stock_after}</td>
            <td>${h.reference_person || h.project || '-'}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
  res.send(layout('Stock Inventory', content));
});

app.get('/admin/stock/add', (req, res) => {
  let content = `
    <header><div class="brand"><h2>Add Material</h2></div></header>
    ${adminNav}
    <div class="card">
      <form action="/admin/stock/add" method="POST">
        <label>Material Name</label>
        <input type="text" name="material_name" required>
        <label>Category</label>
        <input type="text" name="category">
        <label>Unit (e.g., pcs, bags, kg)</label>
        <input type="text" name="unit" required>
        <label>Initial Quantity</label>
        <input type="number" step="0.01" name="current_quantity" value="0" required>
        <label>Minimum Stock Level (Alert Threshold)</label>
        <input type="number" step="0.01" name="minimum_stock_level" value="10" required>
        <label>Notes</label>
        <textarea name="notes"></textarea>
        <button type="submit" class="btn btn-success">Save Material</button>
      </form>
    </div>
  `;
  res.send(layout('Add Material', content));
});

app.post('/admin/stock/add', async (req, res) => {
  const { material_name, category, unit, current_quantity, minimum_stock_level, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const matRes = await client.query(
      'INSERT INTO materials (material_name, category, unit, current_quantity, minimum_stock_level, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [material_name, category, unit, current_quantity, minimum_stock_level, notes]
    );
    if (parseFloat(current_quantity) > 0) {
      await client.query(
        'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, reference_person, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [matRes.rows[0].id, 'IN', current_quantity, current_quantity, 'Initial Stock', notes, 'Admin']
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/admin/stock');
});

// Advance Money Management
app.get('/admin/advance', async (req, res) => {
  const workers = await pool.query('SELECT * FROM workers WHERE status = \'Active\'');
  const advances = await pool.query('SELECT am.*, w.full_name FROM advance_money am JOIN workers w ON am.worker_id = w.worker_id ORDER BY am.advance_date DESC');
  const phNow = getPHTime();

  let content = `
    <header><div class="brand"><h2>Advance Money Management</h2></div></header>
    ${adminNav}
    <div class="card">
      <h3>Record Advance Money</h3>
      <form action="/admin/advance" method="POST">
        <label>Select Worker</label>
        <select name="worker_id" required>
          ${workers.rows.map(w => `<option value="${w.worker_id}">${w.full_name} (${w.worker_id})</option>`).join('')}
        </select>
        <label>Amount (₱)</label>
        <input type="number" step="0.01" name="amount" required>
        <label>Date</label>
        <input type="date" name="advance_date" value="${phNow.date}" required>
        <label>Notes</label>
        <textarea name="notes"></textarea>
        <button type="submit" class="btn btn-success">Save Advance</button>
      </form>
    </div>
    <div class="card">
      <h3>Advance History</h3>
      <table>
        <tr><th>Worker ID</th><th>Name</th><th>Amount</th><th>Date</th><th>Notes</th></tr>
        ${advances.rows.map(a => `<tr><td>${a.worker_id}</td><td>${a.full_name}</td><td>₱${a.amount}</td><td>${a.advance_date.toISOString().split('T')[0]}</td><td>${a.notes || '-'}</td></tr>`).join('')}
      </table>
    </div>
  `;
  res.send(layout('Advance Money', content));
});

app.post('/admin/advance', async (req, res) => {
  const { worker_id, amount, advance_date, notes } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, advance_date, notes) VALUES ($1, $2, $3, $4)', [worker_id, amount, advance_date, notes]);
  res.redirect('/admin/advance');
});

// Salary Calculation Report, Summary & Reset to 0
app.get('/admin/salary', async (req, res) => {
  const settings = await getSettings();
  const workers = await pool.query('SELECT * FROM workers');
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const schedule = scheduleRes.rows[0];

  let salaryData = [];
  let grandTotalGross = 0;
  let grandTotalAdvance = 0;
  let grandTotalNet = 0;

  for (let w of workers.rows) {
    const attRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date ASC, attendance_time ASC', [w.worker_id]);
    const logs = attRes.rows;

    let totalWorkingHours = 0;
    let i = 0;
    while (i < logs.length) {
      if (logs[i].attendance_type === 'IN') {
        let inTime = logs[i].attendance_time;
        if (i + 1 < logs.length && logs[i+1].attendance_type === 'OUT' && logs[i].attendance_date.toISOString() === logs[i+1].attendance_date.toISOString()) {
          let outTime = logs[i+1].attendance_time;
          let [inH, inM] = inTime.split(':').map(Number);
          let [outH, outM] = outTime.split(':').map(Number);
          let diff = (outH + outM / 60) - (inH + inM / 60);
          if (diff > 0) totalWorkingHours += diff;
          i += 2;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    let fullDayHours = parseFloat(schedule.full_day_hours) || 9;
    let equivalentDays = totalWorkingHours / fullDayHours;
    let totalSalary = equivalentDays * parseFloat(w.daily_rate);

    const advRes = await pool.query('SELECT SUM(amount) as total_adv FROM advance_money WHERE worker_id = $1', [w.worker_id]);
    let totalAdvance = parseFloat(advRes.rows[0].total_adv) || 0;
    let netSalary = totalSalary - totalAdvance;
    if (netSalary < 0) netSalary = 0;

    grandTotalGross += totalSalary;
    grandTotalAdvance += totalAdvance;
    grandTotalNet += netSalary;

    salaryData.push({
      ...w,
      totalWorkingHours: totalWorkingHours.toFixed(1),
      equivalentDays: equivalentDays.toFixed(2),
      totalSalary: totalSalary,
      totalAdvance: totalAdvance,
      netSalary: netSalary
    });
  }

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Salary & Payroll Summary</h2>
      </div>
    </header>
    ${adminNav}
    <div class="card" style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: space-between; align-items: center;">
      <div>
        <h3>Payroll Summary Overview</h3>
        <p>Kakailanganing Pera para sa Sahod (Net Payout): <strong style="color: var(--success); font-size: 18px;">₱${grandTotalNet.toFixed(2)}</strong></p>
      </div>
      <div style="display: flex; gap: 10px;" class="no-print">
        <button onclick="window.print()" class="btn">Print Summary Report</button>
        <a href="/admin/salary/reset" class="btn btn-danger" onclick="return confirm('WARNING: This will clear all current attendance logs and advance payments, resetting workers salary data to ₱0 for the next cutoff. Proceed?');">Process Payout & Reset to 0</a>
      </div>
    </div>
    <div class="card">
      <h3>Worker Salary Breakdown</h3>
      <table>
        <tr><th>ID</th><th>Name</th><th>Daily Rate</th><th>Total Hours</th><th>Eq. Days</th><th>Gross Salary</th><th>Advance Ded.</th><th>Net Salary</th></tr>
        ${salaryData.map(s => `
          <tr>
            <td>${s.worker_id}</td>
            <td>${s.full_name}</td>
            <td>₱${s.daily_rate}</td>
            <td>${s.totalWorkingHours} hrs</td>
            <td>${s.equivalentDays}</td>
            <td>₱${s.totalSalary.toFixed(2)}</td>
            <td>₱${s.totalAdvance.toFixed(2)}</td>
            <td><strong>₱${s.netSalary.toFixed(2)}</strong></td>
          </tr>
        `).join('')}
        <tr style="background: #f1f5f9; font-weight: bold;">
          <td colspan="5" style="text-align: right;">TOTAL:</td>
          <td>₱${grandTotalGross.toFixed(2)}</td>
          <td>₱${grandTotalAdvance.toFixed(2)}</td>
          <td>₱${grandTotalNet.toFixed(2)}</td>
        </tr>
      </table>
    </div>
  `;
  res.send(layout('Salary Calculation', content));
});

app.get('/admin/salary/reset', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM attendance_logs');
    await client.query('DELETE FROM advance_money');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/admin/salary');
});

// Announcements Management
app.get('/admin/announcements', async (req, res) => {
  const anns = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
  let content = `
    <header><div class="brand"><h2>Announcements</h2></div></header>
    ${adminNav}
    <div class="card">
      <h3>Create Announcement</h3>
      <form action="/admin/announcements" method="POST">
        <label>Title</label>
        <input type="text" name="title" required>
        <label>Content</label>
        <textarea name="content" required></textarea>
        <button type="submit" class="btn btn-success">Post Announcement</button>
      </form>
    </div>
    <div class="card">
      <h3>Posted Announcements</h3>
      ${anns.rows.map(a => `<div style="border-bottom: 1px solid #cbd5e1; padding: 10px 0;"><h4>${a.title}</h4><small>${a.created_at.toISOString().replace('T', ' ').substring(0, 16)}</small><p>${a.content}</p></div>`).join('')}
    </div>
  `;
  res.send(layout('Announcements', content));
});

app.post('/admin/announcements', async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
  res.redirect('/admin/announcements');
});

// Company Settings
app.get('/admin/settings', async (req, res) => {
  const settings = await getSettings();
  let content = `
    <header><div class="brand"><h2>Company Settings</h2></div></header>
    ${adminNav}
    <div class="card">
      <form action="/admin/settings" method="POST">
        <label>Company Name</label>
        <input type="text" name="company_name" value="${settings.company_name}" required>
        <label>Company Logo URL</label>
        <input type="text" name="company_logo" value="${settings.company_logo || ''}">
        <label>Company Address</label>
        <input type="text" name="company_address" value="${settings.company_address || ''}">
        <label>Contact Number</label>
        <input type="text" name="contact_number" value="${settings.contact_number || ''}">
        <button type="submit" class="btn btn-success">Save Settings</button>
      </form>
    </div>
  `;
  res.send(layout('Company Settings', content));
});

app.post('/admin/settings', async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, company_address = $3, contact_number = $4 WHERE id = 1',
    [company_name, company_logo, company_address, contact_number]);
  res.redirect('/admin/settings');
});

// Work Schedule
app.get('/admin/schedule', async (req, res) => {
  const schedRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const sched = schedRes.rows[0];
  let content = `
    <header><div class="brand"><h2>Work Schedule Configuration</h2></div></header>
    ${adminNav}
    <div class="card">
      <form action="/admin/schedule" method="POST">
        <label>Morning Start</label>
        <input type="text" name="morning_start" value="${sched.morning_start}">
        <label>Morning End</label>
        <input type="text" name="morning_end" value="${sched.morning_end}">
        <label>Afternoon Start</label>
        <input type="text" name="afternoon_start" value="${sched.afternoon_start}">
        <label>Afternoon End</label>
        <input type="text" name="afternoon_end" value="${sched.afternoon_end}">
        <label>Full Day Hours</label>
        <input type="number" step="0.5" name="full_day_hours" value="${sched.full_day_hours}">
        <label>Half Day Hours</label>
        <input type="number" step="0.5" name="half_day_hours" value="${sched.half_day_hours}">
        <button type="submit" class="btn btn-success">Save Schedule</button>
      </form>
    </div>
  `;
  res.send(layout('Work Schedule', content));
});

app.post('/admin/schedule', async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours } = req.body;
  await pool.query('UPDATE work_schedules SET morning_start = $1, morning_end = $2, afternoon_start = $3, afternoon_end = $4, full_day_hours = $5, half_day_hours = $6 WHERE id = 1',
    [morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours]);
  res.redirect('/admin/schedule');
});


// ==========================================
// WORKER PORTAL /worker
// ==========================================
app.get('/worker', async (req, res) => {
  const settings = await getSettings();
  const worker_id = req.query.worker_id || '';
  let worker = null;
  let attendance = [];
  let advances = [];
  let announcements = [];

  if (worker_id) {
    const wRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
    if (wRes.rows.length > 0) {
      worker = wRes.rows[0];
      const attRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date DESC, attendance_time DESC LIMIT 20', [worker_id]);
      attendance = attRes.rows;
      const advRes = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY advance_date DESC', [worker_id]);
      advances = advRes.rows;
    }
  }
  const annRes = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5');
  announcements = annRes.rows;

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Worker Portal</h2>
      </div>
    </header>
    <div class="card">
      <h3>Enter Your Worker ID to View Information</h3>
      <form action="/worker" method="GET" style="display: flex; gap: 10px;">
        <input type="text" name="worker_id" placeholder="e.g. W-0001" value="${worker_id}" required>
        <button type="submit" class="btn" style="height: 42px;">View Profile</button>
      </form>
    </div>
    ${worker_id && !worker ? `<div class="card alert-danger">Worker ID not found.</div>` : ''}
    ${worker ? `
      <div class="card">
        <h3>Welcome, ${worker.full_name} (${worker.worker_id})</h3>
        <p><strong>Position:</strong> ${worker.position}</p>
        <p><strong>Assigned Project:</strong> ${worker.assigned_project || '-'}</p>
        <p><strong>Daily Rate:</strong> ₱${worker.daily_rate}</p>
      </div>
      <div class="card" style="text-align: center;">
        <h3>My QR Code</h3>
        <div id="qrcode" style="display: flex; justify-content: center; margin: 15px 0;"></div>
        <p><strong>${worker.worker_id}</strong></p>
      </div>
      <div class="card">
        <h3>My Recent Attendance</h3>
        <table>
          <tr><th>Date</th><th>Time</th><th>Type</th></tr>
          ${attendance.map(a => `<tr><td>${a.attendance_date.toISOString().split('T')[0]}</td><td>${a.attendance_time}</td><td><span class="badge ${a.attendance_type === 'IN' ? 'badge-success' : 'badge-warning'}">${a.attendance_type}</span></td></tr>`).join('')}
        </table>
      </div>
      <div class="card">
        <h3>My Advances</h3>
        <table>
          <tr><th>Date</th><th>Amount</th><th>Notes</th></tr>
          ${advances.map(ad => `<tr><td>${ad.advance_date.toISOString().split('T')[0]}</td><td>₱${ad.amount}</td><td>${ad.notes || '-'}</td></tr>`).join('')}
        </table>
      </div>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
      <script>
        new QRCode(document.getElementById("qrcode"), {
          text: "${worker.worker_id}",
          width: 150,
          height: 150
        });
      </script>
    ` : ''}
    <div class="card">
      <h3>Announcements</h3>
      ${announcements.map(a => `<div style="border-bottom: 1px solid #cbd5e1; padding: 10px 0;"><h4>${a.title}</h4><p>${a.content}</p></div>`).join('')}
    </div>
  `;
  res.send(layout('Worker Portal', content));
});


// ==========================================
// SCANNER PORTAL /scanner
// ==========================================
app.get('/scanner', async (req, res) => {
  const settings = await getSettings();
  const materials = await pool.query('SELECT * FROM materials ORDER BY material_name ASC');

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Scanner & Inventory Portal</h2>
      </div>
    </header>

    <div class="card">
      <h3>Worker QR Attendance Scanner</h3>
      <div style="margin-bottom: 15px; display: flex; gap: 10px;">
        <button onclick="setMode('IN')" id="btnIn" class="btn" style="flex: 1;">SELECT TIME IN</button>
        <button onclick="setMode('OUT')" id="btnOut" class="btn btn-warning" style="flex: 1;">SELECT TIME OUT</button>
      </div>
      <div id="modeDisplay" class="alert-box alert-success" style="text-align: center;">CURRENT SCAN MODE: NOT SELECTED</div>
      <div style="text-align: center; margin-bottom: 15px;">
        <button onclick="startScanner()" class="btn btn-success" id="startBtn" disabled>START QR SCANNER</button>
        <button onclick="stopScanner()" class="btn btn-danger" id="stopBtn" style="display:none;">STOP SCANNER</button>
      </div>
      <div id="reader" style="width: 100%; max-width: 400px; margin: 0 auto;"></div>
      <div id="scanResult" style="margin-top: 15px; text-align: center; font-weight: bold; font-size: 16px;"></div>
    </div>

    <div class="card">
      <h3>Stock IN / OUT Management</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
        <div>
          <h4>Record Stock IN</h4>
          <form action="/scanner/stock-in" method="POST">
            <label>Material</label>
            <select name="material_id" required>
              ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (${m.unit})</option>`).join('')}
            </select>
            <label>Quantity Received</label>
            <input type="number" step="0.01" name="quantity" required>
            <label>Supplier / Reference</label>
            <input type="text" name="reference_person" required>
            <label>Notes</label>
            <textarea name="notes"></textarea>
            <button type="submit" class="btn btn-success">Save Stock IN</button>
          </form>
        </div>
        <div>
          <h4>Record Stock OUT</h4>
          <form action="/scanner/stock-out" method="POST">
            <label>Material</label>
            <select name="material_id" required>
              ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
            </select>
            <label>Quantity Issued</label>
            <input type="number" step="0.01" name="quantity" required>
            <label>Issued To / Project</label>
            <input type="text" name="project" required>
            <label>Purpose</label>
            <input type="text" name="purpose" required>
            <label>Notes</label>
            <textarea name="notes"></textarea>
            <button type="submit" class="btn btn-danger">Save Stock OUT</button>
          </form>
        </div>
      </div>
    </div>

    <script src="https://unpkg.com/html5-qrcode" type="text/javascript"></script>
    <script>
      let currentMode = '';
      let html5QrCode = null;

      function setMode(mode) {
        currentMode = mode;
        document.getElementById('modeDisplay').innerText = 'CURRENT SCAN MODE: TIME ' + mode;
        document.getElementById('startBtn').removeAttribute('disabled');
        document.getElementById('btnIn').style.opacity = mode === 'IN' ? '1' : '0.6';
        document.getElementById('btnOut').style.opacity = mode === 'OUT' ? '1' : '0.6';
      }

      function startScanner() {
        if (!currentMode) {
          alert('Please Select TIME IN or TIME OUT First.');
          return;
        }
        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('stopBtn').style.display = 'inline-block';

        html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            await stopScanner();
            processAttendance(decodedText);
          },
          (errorMessage) => {}
        ).catch(err => {
          alert('Camera access error: ' + err);
        });
      }

      async function stopScanner() {
        if (html5QrCode && html5QrCode.isScanning) {
          await html5QrCode.stop();
        }
        document.getElementById('startBtn').style.display = 'inline-block';
        document.getElementById('stopBtn').style.display = 'none';
      }

      async function processAttendance(workerId) {
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worker_id: workerId, attendance_type: currentMode })
        });
        const data = await res.json();
        const resultDiv = document.getElementById('scanResult');
        if (data.success) {
          resultDiv.innerHTML = \`<div class="alert-box alert-success">SUCCESS!<br>\${data.worker.full_name}<br>Worker ID: \${data.worker.worker_id}<br>TIME \${currentMode}<br>\${data.date} \${data.time}</div>\`;
        } else {
          resultDiv.innerHTML = \`<div class="alert-box alert-danger">ERROR: \${data.message}</div>\`;
        }
        setTimeout(() => {
          resultDiv.innerHTML = '';
          startScanner();
        }, 3500);
      }
    </script>
  `;
  res.send(layout('Scanner Portal', content));
});

// API Endpoint for QR Attendance Processing using Philippine Time (PST)
app.post('/api/attendance', async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  const client = await pool.connect();
  try {
    const workerRes = await client.query('SELECT * FROM workers WHERE worker_id = $1 AND status = \'Active\'', [worker_id]);
    if (workerRes.rows.length === 0) {
      return res.json({ success: false, message: 'Worker not found or inactive.' });
    }
    const worker = workerRes.rows[0];
    
    // Get Philippine Time components
    const ph = getPHTime();
    const today = ph.date;
    const timeStr = ph.time;

    const lastAttRes = await client.query(
      'SELECT * FROM attendance_logs WHERE worker_id = $1 AND attendance_date = $2 ORDER BY attendance_time DESC LIMIT 1',
      [worker_id, today]
    );

    const lastRecord = lastAttRes.rows[0];

    if (!lastRecord) {
      if (attendance_type === 'OUT') {
        return res.json({ success: false, message: 'Cannot record TIME OUT as the first attendance.' });
      }
    } else {
      if (lastRecord.attendance_type === 'IN' && attendance_type === 'IN') {
        return res.json({ success: false, message: 'Cannot record two consecutive TIME IN records.' });
      }
      if (lastRecord.attendance_type === 'OUT' && attendance_type === 'OUT') {
        return res.json({ success: false, message: 'Cannot record two consecutive TIME OUT records.' });
      }
    }

    await client.query(
      'INSERT INTO attendance_logs (worker_id, attendance_date, attendance_time, attendance_type) VALUES ($1, $2, $3, $4)',
      [worker_id, today, timeStr, attendance_type]
    );

    res.json({ success: true, worker, date: today, time: timeStr });
  } catch (err) {
    res.json({ success: false, message: 'Server error during attendance recording.' });
  } finally {
    client.release();
  }
});

// Scanner Stock IN
app.post('/scanner/stock-in', async (req, res) => {
  const { material_id, quantity, reference_person, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const matRes = await client.query('SELECT * FROM materials WHERE id = $1', [material_id]);
    const mat = matRes.rows[0];
    const newStock = parseFloat(mat.current_quantity) + parseFloat(quantity);

    await client.query('UPDATE materials SET current_quantity = $1 WHERE id = $2', [newStock, material_id]);
    await client.query(
      'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, reference_person, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [material_id, 'IN', quantity, newStock, reference_person, notes, 'Scanner']
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/scanner');
});

// Scanner Stock OUT
app.post('/scanner/stock-out', async (req, res) => {
  const { material_id, quantity, project, purpose, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const matRes = await client.query('SELECT * FROM materials WHERE id = $1', [material_id]);
    const mat = matRes.rows[0];
    if (parseFloat(quantity) > parseFloat(mat.current_quantity)) {
      await client.query('ROLLBACK');
      client.release();
      return res.send('<script>alert("Insufficient Stock."); window.location="/scanner";</script>');
    }
    const newStock = parseFloat(mat.current_quantity) - parseFloat(quantity);
    await client.query('UPDATE materials SET current_quantity = $1 WHERE id = $2', [newStock, material_id]);
    await client.query(
      'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, project, purpose, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [material_id, 'OUT', quantity, newStock, project, purpose, notes, 'Scanner']
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/scanner');
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
