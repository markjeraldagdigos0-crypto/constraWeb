const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize database tables & default settings
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'BuildCorp Construction',
        company_logo TEXT DEFAULT '',
        company_address VARCHAR(255) DEFAULT '123 Construction Ave',
        contact_number VARCHAR(50) DEFAULT '555-0199'
      );

      CREATE TABLE IF NOT EXISTS work_schedules (
        id SERIAL PRIMARY KEY,
        morning_start VARCHAR(10) DEFAULT '07:00',
        morning_end VARCHAR(10) DEFAULT '12:00',
        afternoon_start VARCHAR(10) DEFAULT '13:00',
        afternoon_end VARCHAR(10) DEFAULT '17:00',
        full_day_hours NUMERIC DEFAULT 8,
        half_day_hours NUMERIC DEFAULT 4
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100),
        contact_number VARCHAR(50),
        daily_rate NUMERIC(10,2) DEFAULT 0,
        assigned_project VARCHAR(255),
        profile_picture TEXT,
        status VARCHAR(20) DEFAULT 'Active'
      );

      CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        qr_data TEXT NOT NULL
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
        notes TEXT
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
        current_quantity NUMERIC(10,2) DEFAULT 0,
        minimum_stock_level NUMERIC(10,2) DEFAULT 5,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS stock_transactions (
        id SERIAL PRIMARY KEY,
        material_id INT NOT NULL,
        transaction_type VARCHAR(10) NOT NULL,
        quantity NUMERIC(10,2) NOT NULL,
        stock_after NUMERIC(10,2) NOT NULL,
        reference_info VARCHAR(255),
        notes TEXT,
        recorded_from VARCHAR(50),
        transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert defaults if empty
    const settingsCheck = await client.query('SELECT * FROM company_settings');
    if (settingsCheck.rows.length === 0) {
      await client.query(`INSERT INTO company_settings (company_name, company_logo, company_address, contact_number) VALUES ('BuildCorp Construction', '', '123 Construction Ave', '555-0199')`);
    }

    const scheduleCheck = await client.query('SELECT * FROM work_schedules');
    if (scheduleCheck.rows.length === 0) {
      await client.query(`INSERT INTO work_schedules (morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours) VALUES ('07:00', '12:00', '13:00', '17:00', 8, 4)`);
    }
    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("DB Initialization error:", err);
  } finally {
    client.release();
  }
}
initDB();

// Helper to get global settings
async function getSettings() {
  const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
  return res.rows[0] || {};
}

// ==================== HTML TEMPLATE LAYOUT ====================
function layout(title, bodyContent, activeNav = '') {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
      :root {
        --primary: #f59e0b;
        --primary-dark: #d97706;
        --dark: #1f2937;
        --light: #f3f4f6;
        --white: #ffffff;
        --danger: #ef4444;
        --success: #10b981;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      body { background: var(--light); color: var(--dark); line-height: 1.6; }
      header { background: var(--dark); color: var(--white); padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid var(--primary); }
      .brand { display: flex; align-items: center; gap: 1rem; }
      .brand img { height: 45px; width: 45px; object-fit: contain; border-radius: 4px; background: #fff; }
      .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
      .card { background: var(--white); border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
      h1, h2, h3 { margin-bottom: 1rem; color: var(--dark); }
      .btn { display: inline-block; background: var(--primary); color: var(--white); padding: 0.6rem 1.2rem; border-radius: 4px; text-decoration: none; font-weight: 600; border: none; cursor: pointer; transition: background 0.2s; }
      .btn:hover { background: var(--primary-dark); }
      .btn-danger { background: var(--danger); }
      .btn-danger:hover { background: #dc2626; }
      .btn-success { background: var(--success); }
      .btn-success:hover { background: #059669; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
      th { background: #f9fafb; font-weight: 600; }
      .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
      .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
      .stat-box { background: var(--white); padding: 1.2rem; border-radius: 8px; border-left: 5px solid var(--primary); box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
      .stat-box h4 { font-size: 0.9rem; color: #6b7280; text-transform: uppercase; }
      .stat-box p { font-size: 1.8rem; font-weight: bold; margin-top: 0.5rem; }
      form input, form select, form textarea { width: 100%; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #d1d5db; border-radius: 4px; }
      form label { display: block; margin-bottom: 0.3rem; font-weight: 600; font-size: 0.9rem; }
      .alert { padding: 1rem; border-radius: 4px; margin-bottom: 1rem; font-weight: bold; }
      .alert-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
      .alert-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
      .nav-menu { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; background: var(--white); padding: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
      .nav-menu a { padding: 0.5rem 1rem; border-radius: 4px; text-decoration: none; color: var(--dark); font-weight: 600; background: #f3f4f6; }
      .nav-menu a.active, .nav-menu a:hover { background: var(--primary); color: var(--white); }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">
        <div id="header-logo-container"></div>
        <h2 id="header-company-name">Loading...</h2>
      </div>
      <div>
        <a href="/" class="btn" style="background:#4b5563;">Main Home</a>
      </div>
    </header>
    <div class="container">
      ${bodyContent}
    </div>
    <script>
      fetch('/api/settings').then(res => res.json()).then(data => {
        document.getElementById('header-company-name').innerText = data.company_name || 'BuildCorp';
        const logoDiv = document.getElementById('header-logo-container');
        if (data.company_logo) {
          logoDiv.innerHTML = '<img src="' + data.company_logo + '" alt="Logo">';
        } else {
          logoDiv.innerHTML = '<div style="width:45px;height:45px;background:#f59e0b;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;border-radius:4px;">BC</div>';
        }
      });
    </script>
  </body>
  </html>
  `;
}

// ==================== API ENDPOINTS ====================

app.get('/api/settings', async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
});

// ==================== MAIN PAGE / ====================
app.get('/', async (req, res) => {
  const settings = await getSettings();
  const html = `
    <div style="text-align: center; padding: 3rem 1rem;">
      <div style="margin-bottom: 1.5rem;">
        ${settings.company_logo ? `<img src="${settings.company_logo}" style="max-height: 100px; object-fit: contain;" />` : `<div style="font-size: 3rem; font-weight: bold; color: #f59e0b;">🏗️ BuildCorp</div>`}
      </div>
      <h1 style="font-size: 2.5rem; margin-bottom: 0.5rem;">${settings.company_name}</h1>
      <p style="color: #6b7280; font-size: 1.1rem; margin-bottom: 2rem;">Construction Worker & Inventory Management System</p>
      
      <div style="display: flex; justify-content: center; gap: 1.5rem; flex-wrap: wrap; margin-top: 2rem;">
        <a href="/admin" class="btn" style="font-size: 1.2rem; padding: 1rem 2rem;">[ ADMIN PORTAL ]</a>
        <a href="/worker" class="btn" style="font-size: 1.2rem; padding: 1rem 2rem; background: #3b82f6;">[ WORKER PORTAL ]</a>
        <a href="/scanner" class="btn" style="font-size: 1.2rem; padding: 1rem 2rem; background: #10b981;">[ SCANNER PORTAL ]</a>
      </div>
    </div>
  `;
  res.send(html);
});

// ==================== ADMIN PORTAL ====================
app.get('/admin', async (req, res) => {
  const tab = req.query.tab || 'dashboard';
  const settings = await getSettings();

  let content = `
    <div class="nav-menu">
      <a href="/admin?tab=dashboard" class="${tab==='dashboard'?'active':''}">1. Dashboard</a>
      <a href="/admin?tab=workers" class="${tab==='workers'?'active':''}">2. Workers</a>
      <a href="/admin?tab=attendance" class="${tab==='attendance'?'active':''}">3. Attendance</a>
      <a href="/admin?tab=stock" class="${tab==='stock'?'active':''}">4. Stock Inventory</a>
      <a href="/admin?tab=advance" class="${tab==='advance'?'active':''}">5. Advance Money</a>
      <a href="/admin?tab=salary" class="${tab==='salary'?'active':''}">6. Salary</a>
      <a href="/admin?tab=announcements" class="${tab==='announcements'?'active':''}">7. Announcements</a>
      <a href="/admin?tab=settings" class="${tab==='settings'?'active':''}">8. Company Settings</a>
      <a href="/admin?tab=schedule" class="${tab==='schedule'?'active':''}">9. Work Schedule</a>
      <a href="/">10. Return to Main Page</a>
    </div>
  `;

  if (tab === 'dashboard') {
    const workersCount = await pool.query('SELECT COUNT(*) FROM workers');
    const today = new Date().toISOString().split('T')[0];
    const presentCount = await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE attendance_date = $1', [today]);
    const lowStock = await pool.query('SELECT * FROM materials WHERE current_quantity <= minimum_stock_level');
    const totalMaterials = await pool.query('SELECT COUNT(*) FROM materials');
    const recentAtt = await pool.query('SELECT * FROM attendance_logs ORDER BY created_at DESC LIMIT 5');
    const recentIn = await pool.query("SELECT * FROM stock_transactions WHERE transaction_type='IN' ORDER BY transaction_date DESC LIMIT 5");
    const recentOut = await pool.query("SELECT * FROM stock_transactions WHERE transaction_type='OUT' ORDER BY transaction_date DESC LIMIT 5");

    content += `
      <h2>Admin Dashboard</h2>
      <div class="grid-4" style="margin-bottom: 1.5rem;">
        <div class="stat-box"><h4>Total Workers</h4><p>${workersCount.rows[0].count}</p></div>
        <div class="stat-box"><h4>Present Today</h4><p>${presentCount.rows[0].count}</p></div>
        <div class="stat-box"><h4>Total Materials</h4><p>${totalMaterials.rows[0].count}</p></div>
        <div class="stat-box" style="border-left-color: #ef4444;"><h4>Low Stock Items</h4><p>${lowStock.rows.length}</p></div>
      </div>

      ${lowStock.rows.length > 0 ? `<div class="alert alert-danger">LOW STOCK ALERT: ${lowStock.rows.length} materials are at or below minimum stock level!</div>` : ''}

      <div class="grid-2">
        <div class="card">
          <h3>Recent Attendance Logs</h3>
          <table>
            <tr><th>Worker ID</th><th>Type</th><th>Time</th></tr>
            ${recentAtt.rows.map(r => `<tr><td>${r.worker_id}</td><td>${r.attendance_type}</td><td>${r.attendance_time}</td></tr>`).join('')}
          </table>
        </div>
        <div class="card">
          <h3>Recent Stock In / Out</h3>
          <table>
            <tr><th>Type</th><th>Qty</th><th>Date</th></tr>
            ${recentIn.rows.map(r => `<tr><td><span style="color:green;">IN</span></td><td>${r.quantity}</td><td>${r.transaction_date.toISOString().split('T')[0]}</td></tr>`).join('')}
            ${recentOut.rows.map(r => `<tr><td><span style="color:red;">OUT</span></td><td>${r.quantity}</td><td>${r.transaction_date.toISOString().split('T')[0]}</td></tr>`).join('')}
          </table>
        </div>
      </div>
    `;
  } else if (tab === 'workers') {
    const search = req.query.search || '';
    const workers = await pool.query('SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 ORDER BY id DESC', [`%${search}%`]);

    content += `
      <div class="card">
        <h3>Register New Worker</h3>
        <form action="/admin/workers/add" method="POST" class="grid-2">
          <div>
            <label>Full Name</label>
            <input type="text" name="full_name" required>
            <label>Position</label>
            <input type="text" name="position">
            <label>Contact Number</label>
            <input type="text" name="contact_number">
          </div>
          <div>
            <label>Daily Rate</label>
            <input type="number" step="0.01" name="daily_rate" required>
            <label>Assigned Project</label>
            <input type="text" name="assigned_project">
            <label>Profile Picture URL (Optional)</label>
            <input type="text" name="profile_picture">
          </div>
          <div style="grid-column: span 2;">
            <button type="submit" class="btn">Register Worker & Generate QR</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h3>Worker Directory</h3>
        <form method="GET" action="/admin" style="display:flex; gap:0.5rem; margin-bottom:1rem;">
          <input type="hidden" name="tab" value="workers">
          <input type="text" name="search" placeholder="Search by name or ID..." value="${search}" style="margin:0;">
          <button type="submit" class="btn">Search</button>
        </form>
        <table>
          <tr><th>ID</th><th>Name</th><th>Position</th><th>Daily Rate</th><th>Status</th><th>Actions</th></tr>
          ${workers.rows.map(w => `
            <tr>
              <td>${w.worker_id}</td>
              <td>${w.full_name}</td>
              <td>${w.position || '-'}</td>
              <td>$${w.daily_rate}</td>
              <td>${w.status}</td>
              <td>
                <a href="/admin/workers/qr?id=${w.worker_id}" class="btn" style="padding:0.3rem 0.6rem; font-size:0.8rem;">QR Code</a>
                <a href="/admin/workers/delete?id=${w.worker_id}" class="btn btn-danger" style="padding:0.3rem 0.6rem; font-size:0.8rem;" onclick="return confirm('Delete worker?')">Delete</a>
              </td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  } else if (tab === 'attendance') {
    const logs = await pool.query('SELECT * FROM attendance_logs ORDER BY attendance_date DESC, attendance_time DESC LIMIT 50');
    content += `
      <div class="card">
        <h3>Attendance History</h3>
        <table>
          <tr><th>Worker ID</th><th>Date</th><th>Time</th><th>Type</th></tr>
          ${logs.rows.map(l => `<tr><td>${l.worker_id}</td><td>${l.attendance_date.toISOString().split('T')[0]}</td><td>${l.attendance_time}</td><td><b>${l.attendance_type}</b></td></tr>`).join('')}
        </table>
      </div>
    `;
  } else if (tab === 'stock') {
    const materials = await pool.query('SELECT * FROM materials ORDER BY id DESC');
    const history = await pool.query('SELECT t.*, m.material_name FROM stock_transactions t JOIN materials m ON t.material_id = m.id ORDER BY t.transaction_date DESC LIMIT 20');
    const lowStock = materials.rows.filter(m => Number(m.current_quantity) <= Number(m.minimum_stock_level));

    content += `
      ${lowStock.length > 0 ? `<div class="alert alert-danger">LOW STOCK - PLEASE RESTOCK: ${lowStock.map(m=>m.material_name).join(', ')}</div>` : ''}
      <div class="card">
        <h3>Add Material</h3>
        <form action="/admin/stock/add" method="POST" class="grid-2">
          <div>
            <label>Material Name</label>
            <input type="text" name="material_name" required>
            <label>Category</label>
            <input type="text" name="category">
            <label>Unit (e.g., pcs, bags)</label>
            <input type="text" name="unit" required>
          </div>
          <div>
            <label>Initial Quantity</label>
            <input type="number" step="0.01" name="current_quantity" value="0" required>
            <label>Minimum Stock Level</label>
            <input type="number" step="0.01" name="minimum_stock_level" value="5" required>
            <label>Notes</label>
            <input type="text" name="notes">
          </div>
          <div style="grid-column: span 2;"><button type="submit" class="btn">Add Material</button></div>
        </form>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>Record Stock IN</h3>
          <form action="/scanner/stock-in" method="POST">
            <input type="hidden" name="redirect" value="/admin?tab=stock">
            <label>Select Material</label>
            <select name="material_id" required>
              ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
            </select>
            <label>Quantity Received</label>
            <input type="number" step="0.01" name="quantity" required>
            <label>Supplier / Notes</label>
            <input type="text" name="notes">
            <button type="submit" class="btn btn-success">Record Stock IN</button>
          </form>
        </div>
        <div class="card">
          <h3>Record Stock OUT</h3>
          <form action="/scanner/stock-out" method="POST">
            <input type="hidden" name="redirect" value="/admin?tab=stock">
            <label>Select Material</label>
            <select name="material_id" required>
              ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
            </select>
            <label>Quantity Issued</label>
            <input type="number" step="0.01" name="quantity" required>
            <label>Project / Purpose / Issued To</label>
            <input type="text" name="notes" required>
            <button type="submit" class="btn btn-danger">Record Stock OUT</button>
          </form>
        </div>
      </div>

      <div class="card">
        <h3>Current Inventory</h3>
        <table>
          <tr><th>Material</th><th>Category</th><th>Quantity</th><th>Min Level</th><th>Unit</th></tr>
          ${materials.rows.map(m => `
            <tr ${Number(m.current_quantity) <= Number(m.minimum_stock_level) ? 'style="background:#fee2e2;"' : ''}>
              <td>${m.material_name}</td>
              <td>${m.category || '-'}</td>
              <td><b>${m.current_quantity}</b></td>
              <td>${m.minimum_stock_level}</td>
              <td>${m.unit}</td>
            </tr>
          `).join('')}
        </table>
      </div>

      <div class="card">
        <h3>Stock History</h3>
        <table>
          <tr><th>Material</th><th>Type</th><th>Qty</th><th>Stock After</th><th>Notes</th><th>Date</th></tr>
          ${history.rows.map(h => `
            <tr>
              <td>${h.material_name}</td>
              <td><span style="color:${h.transaction_type==='IN'?'green':'red'}; font-weight:bold;">${h.transaction_type}</span></td>
              <td>${h.quantity}</td>
              <td>${h.stock_after}</td>
              <td>${h.notes || '-'}</td>
              <td>${h.transaction_date.toISOString().split('T')[0]}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  } else if (tab === 'advance') {
    const workers = await pool.query('SELECT * FROM workers');
    const advances = await pool.query('SELECT a.*, w.full_name FROM advance_money a JOIN workers w ON a.worker_id = w.worker_id ORDER BY a.advance_date DESC');
    content += `
      <div class="card">
        <h3>Add Advance Money</h3>
        <form action="/admin/advance/add" method="POST">
          <label>Select Worker</label>
          <select name="worker_id" required>
            ${workers.rows.map(w => `<option value="${w.worker_id}">${w.full_name} (${w.worker_id})</option>`).join('')}
          </select>
          <label>Amount</label>
          <input type="number" step="0.01" name="amount" required>
          <label>Date</label>
          <input type="date" name="advance_date" value="${new Date().toISOString().split('T')[0]}" required>
          <label>Notes</label>
          <input type="text" name="notes">
          <button type="submit" class="btn">Add Advance</button>
        </form>
      </div>
      <div class="card">
        <h3>Advance History</h3>
        <table>
          <tr><th>Worker ID</th><th>Worker Name</th><th>Amount</th><th>Date</th><th>Notes</th></tr>
          ${advances.rows.map(a => `<tr><td>${a.worker_id}</td><td>${a.full_name}</td><td>$${a.amount}</td><td>${a.advance_date.toISOString().split('T')[0]}</td><td>${a.notes || '-'}</td></tr>`).join('')}
        </table>
      </div>
    `;
  } else if (tab === 'salary') {
    const workers = await pool.query('SELECT * FROM workers');
    const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    const schedule = scheduleRes.rows[0];

    // Compute salary breakdown per worker based on logs
    let salaryData = [];
    for (let w of workers.rows) {
      const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date ASC, attendance_time ASC', [w.worker_id]);
      const advances = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [w.worker_id]);
      const totalAdvance = Number(advances.rows[0]?.total || 0);

      // Group logs by date
      let daysMap = {};
      logs.rows.forEach(l => {
        let dStr = l.attendance_date.toISOString().split('T')[0];
        if (!daysMap[dStr]) daysMap[dStr] = [];
        daysMap[dStr].push(l);
      });

      let fullDays = 0;
      let halfDays = 0;

      Object.keys(daysMap).forEach(d => {
        let dayLogs = daysMap[d];
        let totalHours = 0;
        for (let i = 0; i < dayLogs.length - 1; i += 2) {
          if (dayLogs[i].attendance_type === 'IN' && dayLogs[i+1]?.attendance_type === 'OUT') {
            let inTime = dayLogs[i].attendance_time.split(':');
            let outTime = dayLogs[i+1].attendance_time.split(':');
            let inH = parseInt(inTime[0]) + parseInt(inTime[1])/60;
            let outH = parseInt(outTime[0]) + parseInt(outTime[1])/60;
            
            // Subtract lunch break 12:00 to 1:00 if span crosses
            let diff = outH - inH;
            if (inH < 12 && outH > 13) diff -= 1;
            if (diff > 0) totalHours += diff;
          }
        }
        if (totalHours >= (schedule.full_day_hours || 8)) {
          fullDays += 1;
        } else if (totalHours >= (schedule.half_day_hours || 4)) {
          halfDays += 1;
        }
      });

      let equivDays = fullDays + (halfDays * 0.5);
      let totalSalary = equivDays * Number(w.daily_rate);
      let netSalary = totalSalary - totalAdvance;

      salaryData.push({ ...w, fullDays, halfDays, equivDays, totalSalary, totalAdvance, netSalary });
    }

    content += `
      <div class="card">
        <h3>Salary Calculation & Payroll</h3>
        <table>
          <tr><th>Worker</th><th>Rate</th><th>Full Days</th><th>Half Days</th><th>Eq. Days</th><th>Total Salary</th><th>Advance Ded.</th><th>Net Salary</th></tr>
          ${salaryData.map(s => `
            <tr>
              <td>${s.full_name} (${s.worker_id})</td>
              <td>$${s.daily_rate}</td>
              <td>${s.fullDays}</td>
              <td>${s.halfDays}</td>
              <td><b>${s.equivDays}</b></td>
              <td>$${s.totalSalary.toFixed(2)}</td>
              <td>$${s.totalAdvance.toFixed(2)}</td>
              <td><b>$${s.netSalary.toFixed(2)}</b></td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  } else if (tab === 'announcements') {
    const anns = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
    content += `
      <div class="card">
        <h3>Create Announcement</h3>
        <form action="/admin/announcements/add" method="POST">
          <label>Title</label>
          <input type="text" name="title" required>
          <label>Content</label>
          <textarea name="content" rows="4" required></textarea>
          <button type="submit" class="btn">Publish Announcement</button>
        </form>
      </div>
      <div class="card">
        <h3>All Announcements</h3>
        ${anns.rows.map(a => `<div style="border-bottom:1px solid #ddd; padding:0.5rem 0;"><h4>${a.title}</h4><p>${a.content}</p><small>${a.created_at}</small></div>`).join('')}
      </div>
    `;
  } else if (tab === 'settings') {
    content += `
      <div class="card">
        <h3>Company Settings</h3>
        <form action="/admin/settings/update" method="POST">
          <label>Company Name</label>
          <input type="text" name="company_name" value="${settings.company_name || ''}" required>
          <label>Company Logo URL</label>
          <input type="text" name="company_logo" value="${settings.company_logo || ''}">
          <label>Company Address</label>
          <input type="text" name="company_address" value="${settings.company_address || ''}">
          <label>Contact Number</label>
          <input type="text" name="contact_number" value="${settings.contact_number || ''}">
          <button type="submit" class="btn">Save Settings</button>
        </form>
      </div>
    `;
  } else if (tab === 'schedule') {
    const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    const sch = scheduleRes.rows[0];
    content += `
      <div class="card">
        <h3>Work Schedule Configuration</h3>
        <form action="/admin/schedule/update" method="POST" class="grid-2">
          <div>
            <label>Morning Start</label>
            <input type="text" name="morning_start" value="${sch.morning_start}">
            <label>Morning End</label>
            <input type="text" name="morning_end" value="${sch.morning_end}">
            <label>Full Day Hours</label>
            <input type="number" step="0.5" name="full_day_hours" value="${sch.full_day_hours}">
          </div>
          <div>
            <label>Afternoon Start</label>
            <input type="text" name="afternoon_start" value="${sch.afternoon_start}">
            <label>Afternoon End</label>
            <input type="text" name="afternoon_end" value="${sch.afternoon_end}">
            <label>Half Day Hours</label>
            <input type="number" step="0.5" name="half_day_hours" value="${sch.half_day_hours}">
          </div>
          <div style="grid-column: span 2;"><button type="submit" class="btn">Update Schedule</button></div>
        </form>
      </div>
    `;
  }

  res.send(layout('Admin Portal', content));
});

// Worker QR Code Print Page
app.get('/admin/workers/qr', async (req, res) => {
  const workerId = req.query.id;
  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [workerId]);
  const settings = await getSettings();
  if (workerRes.rows.length === 0) return res.send('Worker not found');
  const w = workerRes.rows[0];

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>QR Code - ${w.full_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 2rem; background: #fff; }
        .card { border: 2px solid #333; display: inline-block; padding: 2rem; border-radius: 8px; width: 350px; }
        .logo { max-height: 50px; margin-bottom: 1rem; }
        #qrcode { margin: 1.5rem auto; display: flex; justify-content: center; }
        .btn { background: #f59e0b; color: #fff; padding: 0.5rem 1rem; border: none; font-weight: bold; border-radius: 4px; cursor: pointer; margin-top: 1rem; }
      </style>
    </head>
    <body>
      <div class="card" id="print-area">
        ${settings.company_logo ? `<img src="${settings.company_logo}" class="logo">` : `<h3>${settings.company_name}</h3>`}
        <h2>${settings.company_name}</h2>
        <hr style="margin: 1rem 0;">
        <h3>${w.full_name}</h3>
        <p><strong>Worker ID:</strong> ${w.worker_id}</p>
        <p><strong>Position:</strong> ${w.position || 'Worker'}</p>
        <div id="qrcode"></div>
        <p style="font-size: 0.8rem; color: #666;">Scan for Attendance</p>
      </div>
      <div>
        <button class="btn" onclick="window.print()">Print QR Code</button>
        <br><br>
        <a href="/admin?tab=workers" style="color: #666; text-decoration: none;">Back to Workers</a>
      </div>
      <script>
        QRCode.toCanvas(document.createElement('canvas'), '${w.worker_id}', { width: 200 }, function (error, canvas) {
          if (!error) document.getElementById('qrcode').appendChild(canvas);
        });
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// Admin Post Handlers
app.post('/admin/workers/add', async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, profile_picture } = req.body;
  const countRes = await pool.query('SELECT COUNT(*) FROM workers');
  const nextIdNum = parseInt(countRes.rows[0].count) + 1;
  const worker_id = 'W-' + String(nextIdNum).padStart(4, '0');

  await pool.query(
    'INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture]
  );
  await pool.query('INSERT INTO qr_codes (worker_id, qr_data) VALUES ($1, $2)', [worker_id, worker_id]);
  res.redirect('/admin?tab=workers');
});

app.get('/admin/workers/delete', async (req, res) => {
  const workerId = req.query.id;
  await pool.query('DELETE FROM workers WHERE worker_id = $1', [workerId]);
  await pool.query('DELETE FROM qr_codes WHERE worker_id = $1', [workerId]);
  res.redirect('/admin?tab=workers');
});

app.post('/admin/stock/add', async (req, res) => {
  const { material_name, category, unit, current_quantity, minimum_stock_level, notes } = req.body;
  const mat = await pool.query(
    'INSERT INTO materials (material_name, category, unit, current_quantity, minimum_stock_level, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [material_name, category, unit, current_quantity, minimum_stock_level, notes]
  );
  await pool.query(
    'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6)',
    [mat.rows[0].id, 'IN', current_quantity, current_quantity, 'Initial Stock', 'Admin']
  );
  res.redirect('/admin?tab=stock');
});

app.post('/admin/advance/add', async (req, res) => {
  const { worker_id, amount, advance_date, notes } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, advance_date, notes) VALUES ($1, $2, $3, $4)', [worker_id, amount, advance_date, notes]);
  res.redirect('/admin?tab=advance');
});

app.post('/admin/announcements/add', async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
  res.redirect('/admin?tab=announcements');
});

app.post('/admin/settings/update', async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name=$1, company_logo=$2, company_address=$3, contact_number=$4', [company_name, company_logo, company_address, contact_number]);
  res.redirect('/admin?tab=settings');
});

app.post('/admin/schedule/update', async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours } = req.body;
  await pool.query('UPDATE work_schedules SET morning_start=$1, morning_end=$2, afternoon_start=$3, afternoon_end=$4, full_day_hours=$5, half_day_hours=$6', [morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours]);
  res.redirect('/admin?tab=schedule');
});


// ==================== WORKER PORTAL ====================
app.get('/worker', async (req, res) => {
  const workerId = req.query.worker_id || '';
  let worker = null;
  let attendance = [];
  let advances = [];
  let salaryInfo = null;
  let announcements = [];

  const settings = await getSettings();

  if (workerId) {
    const wRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [workerId]);
    if (wRes.rows.length > 0) {
      worker = wRes.rows[0];
      const attRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date DESC, attendance_time DESC', [workerId]);
      attendance = attRes.rows;
      const advRes = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY advance_date DESC', [workerId]);
      advances = advRes.rows;
      announcements = (await pool.query('SELECT * FROM announcements ORDER BY created_at DESC')).rows;
    }
  }

  const content = `
    <div class="card" style="text-align: center;">
      <h2>Worker Portal</h2>
      <p>Enter your Worker ID to access your personal profile, QR code, and attendance.</p>
      <form method="GET" action="/worker" style="max-width: 400px; margin: 1rem auto; display: flex; gap: 0.5rem;">
        <input type="text" name="worker_id" placeholder="e.g. W-0001" value="${workerId}" required style="margin:0;">
        <button type="submit" class="btn">View Profile</button>
      </form>
    </div>

    ${workerId && !worker ? `<div class="alert alert-danger">Worker ID not found in system.</div>` : ''}

    ${worker ? `
      <div class="card">
        <h3>Welcome, ${worker.full_name} (${worker.worker_id})</h3>
        <div class="grid-2">
          <div>
            <p><strong>Position:</strong> ${worker.position || '-'}</p>
            <p><strong>Contact:</strong> ${worker.contact_number || '-'}</p>
            <p><strong>Daily Rate:</strong> $${worker.daily_rate}</p>
            <p><strong>Assigned Project:</strong> ${worker.assigned_project || '-'}</p>
          </div>
          <div style="text-align: center;">
            <h4>My QR Code</h4>
            <div id="worker-qrcode" style="display:flex; justify-content:center; margin:1rem 0;"></div>
            <p style="font-size:0.9rem; font-weight:bold;">${worker.worker_id}</p>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>My Attendance Logs</h3>
        <table>
          <tr><th>Date</th><th>Time</th><th>Type</th></tr>
          ${attendance.map(a => `<tr><td>${a.attendance_date.toISOString().split('T')[0]}</td><td>${a.attendance_time}</td><td><b>${a.attendance_type}</b></td></tr>`).join('')}
        </table>
      </div>

      <div class="card">
        <h3>My Advance Money</h3>
        <table>
          <tr><th>Date</th><th>Amount</th><th>Notes</th></tr>
          ${advances.map(ad => `<tr><td>${ad.advance_date.toISOString().split('T')[0]}</td><td>$${ad.amount}</td><td>${ad.notes || '-'}</td></tr>`).join('')}
        </table>
      </div>

      <div class="card">
        <h3>Announcements</h3>
        ${announcements.map(an => `<div style="border-bottom:1px solid #eee; padding:0.5rem 0;"><h4>${an.title}</h4><p>${an.content}</p></div>`).join('')}
      </div>

      <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script>
      <script>
        QRCode.toCanvas(document.createElement('canvas'), '${worker.worker_id}', { width: 160 }, function (error, canvas) {
          if (!error) document.getElementById('worker-qrcode').appendChild(canvas);
        });
      </script>
    ` : ''}
  `;
  res.send(layout('Worker Portal', content));
});


// ==================== SCANNER PORTAL ====================
app.get('/scanner', async (req, res) => {
  const materials = await pool.query('SELECT * FROM materials ORDER BY material_name ASC');
  const history = await pool.query('SELECT t.*, m.material_name FROM stock_transactions t JOIN materials m ON t.material_id = m.id ORDER BY t.transaction_date DESC LIMIT 15');

  const content = `
    <div class="card" style="border-left: 6px solid #10b981;">
      <h2>Scanner Portal</h2>
      <p>Use device camera to record QR attendance or manage stock inventory.</p>
    </div>

    <!-- QR ATTENDANCE SECTION -->
    <div class="card">
      <h3>Worker QR Attendance Scanner</h3>
      <div style="margin-bottom: 1rem;">
        <label><strong>Select Scan Mode:</strong></label>
        <button class="btn" id="btn-in" onclick="setMode('IN')" style="background:#6b7280;">[ TIME IN ]</button>
        <button class="btn" id="btn-out" onclick="setMode('OUT')" style="background:#6b7280; margin-left: 0.5rem;">[ TIME OUT ]</button>
        <p style="margin-top: 0.5rem; font-weight: bold; color: #10b981;" id="mode-display">CURRENT SCAN MODE: NOT SELECTED</p>
      </div>

      <div id="scanner-container" style="display:none; max-width: 400px; margin: 1rem auto;">
        <div id="reader"></div>
      </div>
      <button class="btn btn-success" id="start-scan-btn" onclick="startScanner()" style="display:none;">[ START QR SCANNER ]</button>
      
      <div id="scan-result" style="margin-top: 1rem; font-size: 1.1rem; font-weight: bold;"></div>
    </div>

    <!-- STOCK INVENTORY SECTION -->
    <div class="grid-2">
      <div class="card">
        <h3>Stock IN</h3>
        <form action="/scanner/stock-in" method="POST">
          <input type="hidden" name="redirect" value="/scanner">
          <label>Select Material</label>
          <select name="material_id" required>
            ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (Stock: ${m.current_quantity} ${m.unit})</option>`).join('')}
          </select>
          <label>Quantity Received</label>
          <input type="number" step="0.01" name="quantity" required>
          <label>Supplier / Notes</label>
          <input type="text" name="notes">
          <button type="submit" class="btn btn-success">Record Stock IN</button>
        </form>
      </div>

      <div class="card">
        <h3>Stock OUT</h3>
        <form action="/scanner/stock-out" method="POST">
          <input type="hidden" name="redirect" value="/scanner">
          <label>Select Material</label>
          <select name="material_id" required>
            ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (Stock: ${m.current_quantity} ${m.unit})</option>`).join('')}
          </select>
          <label>Quantity Issued</label>
          <input type="number" step="0.01" name="quantity" required>
          <label>Project / Purpose / Issued To</label>
          <input type="text" name="notes" required>
          <button type="submit" class="btn btn-danger">Record Stock OUT</button>
        </form>
      </div>
    </div>

    <div class="card">
      <h3>Current Stock Level</h3>
      <table>
        <tr><th>Material</th><th>Category</th><th>Quantity</th><th>Unit</th></tr>
        ${materials.rows.map(m => `
          <tr ${Number(m.current_quantity) <= Number(m.minimum_stock_level) ? 'style="background:#fee2e2;"' : ''}>
            <td>${m.material_name}</td>
            <td>${m.category || '-'}</td>
            <td><b>${m.current_quantity}</b></td>
            <td>${m.unit}</td>
          </tr>
        `).join('')}
      </table>
    </div>

    <div class="card">
      <h3>Stock Transaction History</h3>
      <table>
        <tr><th>Material</th><th>Type</th><th>Qty</th><th>Stock After</th><th>Notes</th><th>Date</th></tr>
        ${history.rows.map(h => `
          <tr>
            <td>${h.material_name}</td>
            <td><span style="color:${h.transaction_type==='IN'?'green':'red'}; font-weight:bold;">${h.transaction_type}</span></td>
            <td>${h.quantity}</td>
            <td>${h.stock_after}</td>
            <td>${h.notes || '-'}</td>
            <td>${h.transaction_date.toISOString().split('T')[0]}</td>
          </tr>
        `).join('')}
      </table>
    </div>

    <!-- Include Html5Qrcode Library -->
    <script src="https://unpkg.com/html5-qrcode"></script>
    <script>
      let currentMode = '';
      let html5QrCode = null;

      function setMode(mode) {
        currentMode = mode;
        document.getElementById('btn-in').style.background = mode === 'IN' ? '#10b981' : '#6b7280';
        document.getElementById('btn-out').style.background = mode === 'OUT' ? '#ef4444' : '#6b7280';
        document.getElementById('mode-display').innerText = 'CURRENT SCAN MODE: ' + (mode === 'IN' ? 'TIME IN' : 'TIME OUT');
        document.getElementById('start-scan-btn').style.display = 'inline-block';
      }

      function startScanner() {
        if (!currentMode) {
          alert('Please Select TIME IN or TIME OUT First.');
          return;
        }
        document.getElementById('scanner-container').style.display = 'block';
        if (!html5QrCode) {
          html5QrCode = new Html5Qrcode("reader");
        }
        html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          async (decodedText) => {
            // Stop temporarily to process
            await html5QrCode.stop();
            document.getElementById('scanner-container').style.display = 'none';
            processAttendance(decodedText);
          },
          (error) => {}
        ).catch(err => {
          alert("Camera error: " + err);
        });
      }

      async function processAttendance(workerId) {
        const res = await fetch('/api/attendance/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worker_id: workerId, attendance_type: currentMode })
        });
        const data = await res.json();
        const resultDiv = document.getElementById('scan-result');
        if (data.success) {
          resultDiv.innerHTML = \`<div class="alert alert-success">SUCCESS!<br>\${data.worker.full_name}<br>Worker ID: \${data.worker.worker_id}<br>\${data.attendance_type}<br>\${data.date} \${data.time}</div>\`;
        } else {
          resultDiv.innerHTML = \`<div class="alert alert-danger">ERROR: \${data.message}</div>\`;
        }
        // Restart scanner after 3 seconds
        setTimeout(() => {
          resultDiv.innerHTML = '';
          startScanner();
        }, 3500);
      }
    </script>
  `;
  res.send(layout('Scanner Portal', content));
});

// QR Attendance API Validation & Recording
app.post('/api/attendance/scan', async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
  if (workerRes.rows.length === 0) {
    return res.json({ success: false, message: 'Worker not found in database.' });
  }
  const worker = workerRes.rows[0];

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0];

  // Get last attendance record for this worker today
  const lastLogRes = await pool.query(
    'SELECT * FROM attendance_logs WHERE worker_id = $1 AND attendance_date = $2 ORDER BY attendance_time DESC LIMIT 1',
    [worker_id, dateStr]
  );
  const lastLog = lastLogRes.rows[0];

  // Validation Rules
  if (!lastLog && attendance_type === 'OUT') {
    return res.json({ success: false, message: 'Cannot record TIME OUT as the first attendance.' });
  }
  if (lastLog && lastLog.attendance_type === 'IN' && attendance_type === 'IN') {
    return res.json({ success: false, message: 'Cannot record two consecutive TIME IN records.' });
  }
  if (lastLog && lastLog.attendance_type === 'OUT' && attendance_type === 'OUT') {
    return res.json({ success: false, message: 'Cannot record two consecutive TIME OUT records.' });
  }

  await pool.query(
    'INSERT INTO attendance_logs (worker_id, attendance_date, attendance_time, attendance_type) VALUES ($1, $2, $3, $4)',
    [worker_id, dateStr, timeStr, attendance_type]
  );

  res.json({
    success: true,
    worker,
    attendance_type,
    date: dateStr,
    time: timeStr
  });
});

// Stock IN/OUT Handlers for Scanner/Admin
app.post('/scanner/stock-in', async (req, res) => {
  const { material_id, quantity, notes, redirect } = req.body;
  const matRes = await pool.query('SELECT * FROM materials WHERE id = $1', [material_id]);
  if (matRes.rows.length === 0) return res.redirect(redirect || '/scanner');
  const mat = matRes.rows[0];

  const newQty = Number(mat.current_quantity) + Number(quantity);
  await pool.query('UPDATE materials SET current_quantity = $1 WHERE id = $2', [newQty, material_id]);
  await pool.query(
    'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6)',
    [material_id, 'IN', quantity, newQty, notes, 'Scanner/Admin']
  );
  res.redirect(redirect || '/scanner');
});

app.post('/scanner/stock-out', async (req, res) => {
  const { material_id, quantity, notes, redirect } = req.body;
  const matRes = await pool.query('SELECT * FROM materials WHERE id = $1', [material_id]);
  if (matRes.rows.length === 0) return res.redirect(redirect || '/scanner');
  const mat = matRes.rows[0];

  if (Number(quantity) > Number(mat.current_quantity)) {
    return res.send(`<script>alert('Insufficient Stock.'); window.location.href='${redirect || '/scanner'}';</script>`);
  }

  const newQty = Number(mat.current_quantity) - Number(quantity);
  await pool.query('UPDATE materials SET current_quantity = $1 WHERE id = $2', [newQty, material_id]);
  await pool.query(
    'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6)',
    [material_id, 'OUT', quantity, newQty, notes, 'Scanner/Admin']
  );
  res.redirect(redirect || '/scanner');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});