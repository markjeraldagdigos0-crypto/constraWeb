const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session Configuration
app.use(session({
  secret: 'buildcorp_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Helper function to get current Philippine Time (PST)
function getPHTime() {
  const now = new Date();
  const optionsDate = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
  const optionsTime24 = { timeZone: 'Asia/Manila', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
  const optionsTime12 = { timeZone: 'Asia/Manila', hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit' };
  
  const formatterDate = new Intl.DateTimeFormat('en-CA', optionsDate);
  const formatterTime24 = new Intl.DateTimeFormat('en-GB', optionsTime24);
  const formatterTime12 = new Intl.DateTimeFormat('en-US', optionsTime12);
  
  return {
    date: formatterDate.format(now),
    time24: formatterTime24.format(now),
    time: formatterTime12.format(now),
    timestamp: new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
  };
}

// Initialize Database Tables & Auto-Migrate missing columns
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS officer_users (
        id SERIAL PRIMARY KEY,
        role VARCHAR(50) NOT NULL, -- 'payroll' or 'scanner'
        full_name VARCHAR(255) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'Pending', -- 'Pending' or 'Approved'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'BuildCorp Construction',
        company_logo TEXT DEFAULT '',
        company_address VARCHAR(255) DEFAULT '123 Builder St, Metro City',
        contact_number VARCHAR(50) DEFAULT '555-0199',
        default_meal_deduction NUMERIC(10,2) DEFAULT 50.00
      );

      CREATE TABLE IF NOT EXISTS work_schedules (
        id SERIAL PRIMARY KEY,
        morning_in_start VARCHAR(10) DEFAULT '06:00',
        morning_in_end VARCHAR(10) DEFAULT '07:00',
        morning_out_start VARCHAR(10) DEFAULT '11:30',
        morning_out_end VARCHAR(10) DEFAULT '12:00',
        afternoon_in_start VARCHAR(10) DEFAULT '12:00',
        afternoon_in_end VARCHAR(10) DEFAULT '13:00',
        afternoon_out_start VARCHAR(10) DEFAULT '17:00',
        afternoon_out_end VARCHAR(10) DEFAULT '18:00',
        full_day_hours NUMERIC DEFAULT 9,
        half_day_hours NUMERIC DEFAULT 4.5
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        password TEXT NOT NULL DEFAULT '',
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
        attendance_time VARCHAR(50) NOT NULL,
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

      CREATE TABLE IF NOT EXISTS deductions (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        deduction_name VARCHAR(100) NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        deduction_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE workers ADD COLUMN IF NOT EXISTS password TEXT NOT NULL DEFAULT '';
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS morning_in_start VARCHAR(10) DEFAULT '06:00';
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS morning_in_end VARCHAR(10) DEFAULT '07:00';
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS morning_out_start VARCHAR(10) DEFAULT '11:30';
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS morning_out_end VARCHAR(10) DEFAULT '12:00';
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS afternoon_in_start VARCHAR(10) DEFAULT '12:00';
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS afternoon_in_end VARCHAR(10) DEFAULT '13:00';
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS afternoon_out_start VARCHAR(10) DEFAULT '17:00';
      ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS afternoon_out_end VARCHAR(10) DEFAULT '18:00';
      ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS default_meal_deduction NUMERIC(10,2) DEFAULT 50.00;
    `);

    const settingsCheck = await pool.query('SELECT * FROM company_settings');
    if (settingsCheck.rows.length === 0) {
      await pool.query('INSERT INTO company_settings (company_name, default_meal_deduction) VALUES ($1, $2)', ['BuildCorp Construction', 50.00]);
    }

    const scheduleCheck = await pool.query('SELECT * FROM work_schedules');
    if (scheduleCheck.rows.length === 0) {
      await pool.query(`INSERT INTO work_schedules (morning_in_start, morning_in_end, morning_out_start, morning_out_end, afternoon_in_start, afternoon_in_end, afternoon_out_start, afternoon_out_end) 
        VALUES ('06:00', '07:00', '11:30', '12:00', '12:00', '13:00', '17:00', '18:00')`);
    }
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}
initDB();

async function getSettings() {
  const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
  return res.rows[0] || { company_name: 'BuildCorp Construction', company_logo: '', company_address: '', contact_number: '', default_meal_deduction: 50.00 };
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.redirect('/admin/login');
}

function requirePayroll(req, res, next) {
  if (req.session && req.session.officerRole === 'payroll') {
    return next();
  }
  res.redirect('/officer/login');
}

function requireScanner(req, res, next) {
  if (req.session && req.session.officerRole === 'scanner') {
    return next();
  }
  res.redirect('/officer/login');
}

function formatTimeTo12Hour(time24) {
  if (!time24) return '';
  const parts = time24.split(':');
  if (parts.length < 2) return time24;
  let hour = parseInt(parts[0], 10);
  const minute = parts[1];
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12; 
  return `${hour}:${minute} ${ampm}`;
}

function layout(title, content) {
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

// MAIN PAGE /
app.get('/', async (req, res) => {
  const settings = await getSettings();
  const html = `
    <div style="text-align: center; padding: 40px 20px;">
      ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo" style="max-height: 80px; margin-bottom: 15px;">` : ''}
      <h1 style="font-size: 32px; margin-bottom: 10px;">${settings.company_name}</h1>
      <p style="color: #64748b; margin-bottom: 30px;">Construction Worker Management System</p>
      
      <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">
        <a href="/admin/login" class="btn" style="padding: 20px 40px; font-size: 18px;">ADMIN PORTAL</a>
        <a href="/officer/login" class="btn btn-warning" style="padding: 20px 40px; font-size: 18px;">OFFICER PORTAL</a>
        <a href="/worker/login" class="btn btn-success" style="padding: 20px 40px; font-size: 18px;">WORKER PORTAL</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Main', html));
});

// ADMIN AUTHENTICATION & REGISTRATION (Never removed)
app.get('/admin/login', async (req, res) => {
  const settings = await getSettings();
  const error = req.query.error || '';
  const success = req.query.success || '';

  let content = `
    <div style="max-width: 400px; margin: 50px auto;" class="card">
      <h2 style="text-align: center; margin-bottom: 20px;">Admin Login</h2>
      ${error ? `<div class="alert-box alert-danger">${error}</div>` : ''}
      ${success ? `<div class="alert-box alert-success">${success}</div>` : ''}
      <form action="/admin/login" method="POST">
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn" style="width: 100%; padding: 12px; margin-bottom: 15px;">Login</button>
      </form>
      <div style="text-align: center; font-size: 14px;">
        Wala pang admin account? <a href="/admin/register" style="color: var(--accent); font-weight: bold;">Mag-register dito</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Admin Login', content));
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.redirect('/admin/login?error=Invalid username or password.');
    }
    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password);
    if (!match) {
      return res.redirect('/admin/login?error=Invalid username or password.');
    }

    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin/login?error=Server error during login.');
  }
});

app.get('/admin/register', async (req, res) => {
  const settings = await getSettings();
  const error = req.query.error || '';

  let content = `
    <div style="max-width: 400px; margin: 50px auto;" class="card">
      <h2 style="text-align: center; margin-bottom: 20px;">Create Admin Account</h2>
      ${error ? `<div class="alert-box alert-danger">${error}</div>` : ''}
      <form action="/admin/register" method="POST">
        <label>Full Name</label>
        <input type="text" name="full_name" required>
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px; margin-bottom: 15px;">Register Admin</button>
      </form>
      <div style="text-align: center; font-size: 14px;">
        May account na? <a href="/admin/login" style="color: var(--accent); font-weight: bold;">Mag-login dito</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Admin Register', content));
});

app.post('/admin/register', async (req, res) => {
  const { full_name, username, password } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.redirect('/admin/register?error=Username is already taken.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO admin_users (username, password, full_name) VALUES ($1, $2, $3)', [username, hashedPassword, full_name]);
    res.redirect('/admin/login?success=Admin account created successfully! Please login.');
  } catch (err) {
    res.redirect('/admin/register?error=Server error during registration.');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// OFFICER (PAYROLL & SCANNER) AUTHENTICATION & REGISTRATION
app.get('/officer/login', async (req, res) => {
  const settings = await getSettings();
  const error = req.query.error || '';
  const success = req.query.success || '';

  let content = `
    <div style="max-width: 400px; margin: 50px auto;" class="card">
      <h2 style="text-align: center; margin-bottom: 20px;">Officer Portal Login</h2>
      ${error ? `<div class="alert-box alert-danger">${error}</div>` : ''}
      ${success ? `<div class="alert-box alert-success">${success}</div>` : ''}
      <form action="/officer/login" method="POST">
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn btn-warning" style="width: 100%; padding: 12px; margin-bottom: 15px;">Login as Officer</button>
      </form>
      <div style="text-align: center; font-size: 14px;">
        Wala pang officer account? <a href="/officer/register" style="color: var(--accent); font-weight: bold;">Mag-register dito</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Officer Login', content));
});

app.post('/officer/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM officer_users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.redirect('/officer/login?error=Invalid username or password.');
    }
    const officer = result.rows[0];

    if (officer.status !== 'Approved') {
      return res.redirect('/officer/login?error=Ang iyong account ay naghihintay pa ng approval mula sa Admin.');
    }

    const match = await bcrypt.compare(password, officer.password);
    if (!match) {
      return res.redirect('/officer/login?error=Invalid username or password.');
    }

    req.session.officerId = officer.id;
    req.session.officerUsername = officer.username;
    req.session.officerRole = officer.role; // 'payroll' or 'scanner'

    if (officer.role === 'payroll') {
      res.redirect('/payroll/dashboard');
    } else {
      res.redirect('/scanner');
    }
  } catch (err) {
    res.redirect('/officer/login?error=Server error during login.');
  }
});

app.get('/officer/register', async (req, res) => {
  const settings = await getSettings();
  const error = req.query.error || '';

  let content = `
    <div style="max-width: 400px; margin: 40px auto;" class="card">
      <h2 style="text-align: center; margin-bottom: 20px;">Officer Registration</h2>
      ${error ? `<div class="alert-box alert-danger">${error}</div>` : ''}
      <form action="/officer/register" method="POST">
        <label>Piliin ang Uri ng Officer</label>
        <select name="role" required>
          <option value="payroll">Payroll Officer</option>
          <option value="scanner">Scanner Officer</option>
        </select>
        <label>Full Name</label>
        <input type="text" name="full_name" required>
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px; margin-bottom: 15px;">Register & Request Approval</button>
      </form>
      <div style="text-align: center; font-size: 14px;">
        May account na? <a href="/officer/login" style="color: var(--accent); font-weight: bold;">Mag-login dito</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Officer Register', content));
});

app.post('/officer/register', async (req, res) => {
  const { role, full_name, username, password } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM officer_users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.redirect('/officer/register?error=Username is already taken.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO officer_users (role, full_name, username, password, status) VALUES ($1, $2, $3, $4, $5)',
      [role, full_name, username, hashedPassword, 'Pending']
    );
    res.redirect('/officer/login?success=Matagumpay na nakapag-register! Mag-aabang na lang ng approval mula sa Admin.');
  } catch (err) {
    res.redirect('/officer/register?error=Server error during registration.');
  }
});

app.get('/officer/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/officer/login');
  });
});

// ADMIN PORTAL & APPROVAL MANAGEMENT
const adminNav = `
  <nav class="no-print">
    <a href="/admin">Dashboard</a>
    <a href="/admin/approvals">Officer Approvals</a>
    <a href="/admin/workers">Workers</a>
    <a href="/admin/attendance">Attendance</a>
    <a href="/admin/advance">Advance Money</a>
    <a href="/admin/deductions">Deductions</a>
    <a href="/admin/salary">Salary & Payroll</a>
    <a href="/admin/announcements">Announcements</a>
    <a href="/admin/settings">Company Settings</a>
    <a href="/admin/schedule">Work Schedule</a>
    <a href="/admin/logout" style="background: var(--danger); color: white; margin-left: auto;">Logout</a>
  </nav>
`;

app.get('/admin', requireAdmin, async (req, res) => {
  const settings = await getSettings();
  const workersCount = await pool.query('SELECT COUNT(*) FROM workers');
  const phNow = getPHTime();
  const today = phNow.date;
  const presentToday = await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE attendance_date = $1', [today]);
  const pendingOfficers = await pool.query("SELECT COUNT(*) FROM officer_users WHERE status = 'Pending'");
  const recentAttendance = await pool.query('SELECT a.*, w.full_name FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id ORDER BY a.created_at DESC LIMIT 5');

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Admin Portal</h2>
      </div>
      <div>Logged in as: <strong>${req.session.adminUsername}</strong></div>
    </header>
    ${adminNav}
    <div class="grid-2">
      <div class="card">
        <h3>Workers Overview</h3>
        <p><strong>Total Workers:</strong> ${workersCount.rows[0].count}</p>
        <p><strong>Present Today:</strong> ${presentToday.rows[0].count}</p>
      </div>
      <div class="card">
        <h3>Pending Officer Approvals</h3>
        <p>May <strong>${pendingOfficers.rows[0].count}</strong> na officer account na naghihintay ng approval.</p>
        <a href="/admin/approvals" class="btn btn-warning" style="margin-top: 10px;">Tignan ang Approvals</a>
      </div>
    </div>
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

// Officer Approvals Route for Admin
app.get('/admin/approvals', requireAdmin, async (req, res) => {
  const officers = await pool.query('SELECT * FROM officer_users ORDER BY status DESC, id DESC');
  let content = `
    <header><div class="brand"><h2>Officer Approvals Management</h2></div></header>
    ${adminNav}
    <div class="card">
      <h3>Manage Payroll & Scanner Officer Accounts</h3>
      <table>
        <tr><th>Role</th><th>Full Name</th><th>Username</th><th>Status</th><th>Actions</th></tr>
        ${officers.rows.map(o => `
          <tr>
            <td><strong>${o.role.toUpperCase()}</strong></td>
            <td>${o.full_name}</td>
            <td>${o.username}</td>
            <td><span class="badge ${o.status === 'Approved' ? 'badge-success' : 'badge-warning'}">${o.status}</span></td>
            <td>
              ${o.status === 'Pending' ? `<a href="/admin/approvals/action/${o.id}/Approve" class="btn btn-success" style="padding: 4px 8px; font-size: 12px;">Approve</a>` : ''}
              <a href="/admin/approvals/action/${o.id}/Delete" class="btn btn-danger" onclick="return confirm('Sigurado ka bang gusto mong tanggalin ang account na ito?');" style="padding: 4px 8px; font-size: 12px;">Delete</a>
            </td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
  res.send(layout('Officer Approvals', content));
});

app.get('/admin/approvals/action/:id/:action', requireAdmin, async (req, res) => {
  const { id, action } = req.params;
  if (action === 'Approve') {
    await pool.query("UPDATE officer_users SET status = 'Approved' WHERE id = $1", [id]);
  } else if (action === 'Delete') {
    await pool.query('DELETE FROM officer_users WHERE id = $1', [id]);
  }
  res.redirect('/admin/approvals');
});

// WORKER MANAGEMENT ROUTES
app.get('/admin/workers', requireAdmin, async (req, res) => {
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
              <a href="/admin/workers/delete/${w.worker_id}" class="btn btn-danger" onclick="return confirm('Are you sure you want to delete worker ${w.full_name}?');" style="padding: 4px 8px; font-size: 12px;">Delete</a>
            </td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
  res.send(layout('Workers Management', content));
});

app.get('/admin/workers/register', requireAdmin, async (req, res) => {
  const countRes = await pool.query('SELECT COUNT(*) FROM workers');
  const nextIdNum = parseInt(countRes.rows[0].count) + 1;
  const autoWorkerId = 'W-' + String(nextIdNum).padStart(4, '0');

  let content = `
    <header><div class="brand"><h2>Register New Worker</h2></div></header>
    ${adminNav}
    <div class="card">
      <form action="/admin/workers/register" method="POST">
        <label>Worker ID (Auto Generated)</label>
        <input type="text" value="${autoWorkerId}" disabled style="background: #e2e8f0;">
        <input type="hidden" name="worker_id" value="${autoWorkerId}">
        
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

app.post('/admin/workers/register', requireAdmin, async (req, res) => {
  const { worker_id, full_name, position, contact_number, daily_rate, assigned_project } = req.body;
  try {
    const defaultPassword = await bcrypt.hash(worker_id, 10);
    await pool.query(
      'INSERT INTO workers (worker_id, password, full_name, position, contact_number, daily_rate, assigned_project) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [worker_id, defaultPassword, full_name, position, contact_number, daily_rate, assigned_project]
    );
    res.redirect(`/admin/workers/qr/${worker_id}`);
  } catch (err) {
    res.status(500).send('Database Error: ' + err.message);
  }
});

app.get('/admin/workers/edit/:worker_id', requireAdmin, async (req, res) => {
  const { worker_id } = req.params;
  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
  if (workerRes.rows.length === 0) return res.send('Worker not found');
  const worker = workerRes.rows[0];

  let content = `
    <header><div class="brand"><h2>Edit Worker Details</h2></div></header>
    ${adminNav}
    <div class="card">
      <form action="/admin/workers/edit/${worker.worker_id}" method="POST">
        <label>Worker ID</label>
        <input type="text" value="${worker.worker_id}" disabled style="background: #e2e8f0;">
        <label>Full Name</label>
        <input type="text" name="full_name" value="${worker.full_name}" required>
        <label>Position</label>
        <input type="text" name="position" value="${worker.position}" required>
        <label>Contact Number</label>
        <input type="text" name="contact_number" value="${worker.contact_number || ''}">
        <label>Daily Rate (₱)</label>
        <input type="number" step="0.01" name="daily_rate" value="${worker.daily_rate}" required>
        <label>Assigned Project</label>
        <input type="text" name="assigned_project" value="${worker.assigned_project || ''}">
        <button type="submit" class="btn btn-success">Update Worker</button>
        <a href="/admin/workers" class="btn btn-warning">Cancel</a>
      </form>
    </div>
  `;
  res.send(layout('Edit Worker', content));
});

app.post('/admin/workers/edit/:worker_id', requireAdmin, async (req, res) => {
  const { worker_id } = req.params;
  const { full_name, position, contact_number, daily_rate, assigned_project } = req.body;
  try {
    await pool.query(
      'UPDATE workers SET full_name = $1, position = $2, contact_number = $3, daily_rate = $4, assigned_project = $5 WHERE worker_id = $6',
      [full_name, position, contact_number, daily_rate, assigned_project, worker_id]
    );
    res.redirect('/admin/workers');
  } catch (err) {
    res.status(500).send('Database Error: ' + err.message);
  }
});

app.get('/admin/workers/qr/:worker_id', requireAdmin, async (req, res) => {
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
      <div id="qrcode" style="display: flex; justify-content: center; margin: 20px 0;"></div>
      <button onclick="window.print()" class="btn">Print QR Code</button>
      <a href="/admin/workers" class="btn btn-warning">Back to Workers</a>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
      new QRCode(document.getElementById("qrcode"), { text: "${worker.worker_id}", width: 200, height: 200 });
    </script>
  `;
  res.send(layout('Worker QR', content));
});

app.get('/admin/workers/toggle/:worker_id', requireAdmin, async (req, res) => {
  const { worker_id } = req.params;
  const workerRes = await pool.query('SELECT status FROM workers WHERE worker_id = $1', [worker_id]);
  if (workerRes.rows.length > 0) {
    const newStatus = workerRes.rows[0].status === 'Active' ? 'Inactive' : 'Active';
    await pool.query('UPDATE workers SET status = $1 WHERE worker_id = $2', [newStatus, worker_id]);
  }
  res.redirect('/admin/workers');
});

app.get('/admin/workers/delete/:worker_id', requireAdmin, async (req, res) => {
  const { worker_id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM attendance_logs WHERE worker_id = $1', [worker_id]);
    await client.query('DELETE FROM advance_money WHERE worker_id = $1', [worker_id]);
    await client.query('DELETE FROM deductions WHERE worker_id = $1', [worker_id]);
    await client.query('DELETE FROM workers WHERE worker_id = $1', [worker_id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/admin/workers');
});

// ATTENDANCE & REPORTING ROUTES
app.get('/admin/attendance', requireAdmin, async (req, res) => {
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
  query += ' ORDER BY a.attendance_date DESC, a.created_at DESC LIMIT 100';
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

app.get('/admin/attendance/clear', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM attendance_logs');
  res.redirect('/admin/attendance');
});

// ADVANCE MONEY ROUTES
app.get('/admin/advance', requireAdmin, async (req, res) => {
  const workers = await pool.query("SELECT * FROM workers WHERE status = 'Active'");
  const advances = await pool.query('SELECT am.*, w.full_name FROM advance_money am JOIN workers w ON am.worker_id = w.worker_id ORDER BY am.advance_date DESC');
  const phNow = getPHTime();

  let content = `
    <header><div class="brand"><h2>Advance Money Management</h2></div></header>
    ${adminNav}
    <div class="card">
      <h3>Record Advance Money (Cash Advance)</h3>
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

app.post('/admin/advance', requireAdmin, async (req, res) => {
  const { worker_id, amount, advance_date, notes } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, advance_date, notes) VALUES ($1, $2, $3, $4)', [worker_id, amount, advance_date, notes]);
  res.redirect('/admin/advance');
});

// DEDUCTIONS ROUTES
app.get('/admin/deductions', requireAdmin, async (req, res) => {
  const workers = await pool.query("SELECT * FROM workers WHERE status = 'Active'");
  const deductionsList = await pool.query('SELECT d.*, w.full_name FROM deductions d JOIN workers w ON d.worker_id = w.worker_id ORDER BY d.deduction_date DESC');
  const phNow = getPHTime();

  let content = `
    <header><div class="brand"><h2>Worker Deductions Management</h2></div></header>
    ${adminNav}
    <div class="card">
      <h3>Add Deduction</h3>
      <form action="/admin/deductions" method="POST">
        <label>Select Worker</label>
        <select name="worker_id" required>
          ${workers.rows.map(w => `<option value="${w.worker_id}">${w.full_name} (${w.worker_id})</option>`).join('')}
        </select>
        <label>Deduction Name</label>
        <input type="text" name="deduction_name" placeholder="Meal Deduction / SSS" required>
        <label>Amount (₱)</label>
        <input type="number" step="0.01" name="amount" required>
        <label>Date</label>
        <input type="date" name="deduction_date" value="${phNow.date}" required>
        <label>Notes</label>
        <textarea name="notes"></textarea>
        <button type="submit" class="btn btn-success">Save Deduction</button>
      </form>
    </div>
    <div class="card">
      <h3>Deductions History</h3>
      <table>
        <tr><th>Worker ID</th><th>Name</th><th>Deduction Name</th><th>Amount</th><th>Date</th></tr>
        ${deductionsList.rows.map(d => `<tr><td>${d.worker_id}</td><td>${d.full_name}</td><td>${d.deduction_name}</td><td>₱${d.amount}</td><td>${d.deduction_date.toISOString().split('T')[0]}</td></tr>`).join('')}
      </table>
    </div>
  `;
  res.send(layout('Deductions', content));
});

app.post('/admin/deductions', requireAdmin, async (req, res) => {
  const { worker_id, deduction_name, amount, deduction_date, notes } = req.body;
  await pool.query('INSERT INTO deductions (worker_id, deduction_name, amount, deduction_date, notes) VALUES ($1, $2, $3, $4, $5)', [worker_id, deduction_name, amount, deduction_date, notes]);
  res.redirect('/admin/deductions');
});

// PAYROLL LOGIC (Admin & Payroll Officer Portal)
async function renderSalaryPage(req, res, userRole) {
  const settings = await getSettings();
  const workers = await pool.query('SELECT * FROM workers');

  let salaryData = [];
  let grandTotalNet = 0;

  for (let w of workers.rows) {
    const attRes = await pool.query('SELECT attendance_date, COUNT(*) as scan_count FROM attendance_logs WHERE worker_id = $1 GROUP BY attendance_date', [w.worker_id]);
    
    let totalEquivalentDays = 0;
    for (let row of attRes.rows) {
      let scans = parseInt(row.scan_count);
      if (scans >= 4) totalEquivalentDays += 1.0;
      else if (scans >= 2) totalEquivalentDays += 0.5;
    }

    let totalSalary = totalEquivalentDays * parseFloat(w.daily_rate);
    const advRes = await pool.query('SELECT SUM(amount) as total_adv FROM advance_money WHERE worker_id = $1', [w.worker_id]);
    let totalAdvance = parseFloat(advRes.rows[0].total_adv) || 0;

    const dedRes = await pool.query('SELECT SUM(amount) as total_ded FROM deductions WHERE worker_id = $1', [w.worker_id]);
    let totalDeductions = parseFloat(dedRes.rows[0].total_ded) || 0;

    let netSalary = totalSalary - totalAdvance - totalDeductions;
    if (netSalary < 0) netSalary = 0;

    // Alamin kung may natitira pa bang attendance, advance, o deductions (ibig sabihin hindi pa nakasahod/na-reset)
    const hasUnpaidData = (totalEquivalentDays > 0 || totalAdvance > 0 || totalDeductions > 0);

    if (hasUnpaidData) {
      grandTotalNet += netSalary;
    }

    salaryData.push({
      ...w,
      totalEquivalentDays: totalEquivalentDays.toFixed(1),
      totalSalary,
      totalAdvance,
      totalDeductions,
      netSalary,
      hasUnpaidData
    });
  }

  const navBar = userRole === 'admin' ? adminNav : `
    <nav class="no-print">
      <a href="/payroll/dashboard" class="active">Payroll Summary</a>
      <a href="/officer/logout" style="background: var(--danger); color: white; margin-left: auto;">Logout</a>
    </nav>
  `;

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Salary & Payroll Portal</h2>
      </div>
    </header>
    ${navBar}
    <div class="card" style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: space-between; align-items: center;">
      <div>
        <h3>Payroll Summary Overview</h3>
        <p>Kabuuang Pera na Kailangan para sa mga Hindi Pa Nakasahod: <strong style="color: var(--success); font-size: 18px;">₱${grandTotalNet.toFixed(2)}</strong></p>
      </div>
      <div class="no-print">
        <button onclick="window.print()" class="btn">Print Summary Report</button>
      </div>
    </div>
    <div class="card">
      <h3>Worker Salary Breakdown (Isa-isang Pagsahod at Pagtatapos)</h3>
      <table>
        <tr><th>ID</th><th>Name</th><th>Daily Rate</th><th>Total Days</th><th>Net Salary</th><th>Status / Action</th></tr>
        ${salaryData.map(s => `
          <tr>
            <td>${s.worker_id}</td>
            <td>${s.full_name}</td>
            <td>₱${s.daily_rate}</td>
            <td>${s.totalEquivalentDays} days</td>
            <td><strong>₱${s.netSalary.toFixed(2)}</strong></td>
            <td>
              ${s.hasUnpaidData ? `
                <span class="badge badge-warning">Hindi Pa Nakasahod</span>
                <a href="/${userRole}/salary/reset/${s.worker_id}" class="btn btn-success" onclick="return confirm('I-mark ba bilang NAZAHOD na si ${s.full_name} at i-reset ang kanyang attendance/deductions para sa susunod na cut-off?');" style="padding: 4px 8px; font-size: 12px; margin-left: 5px;">Mark as Paid & Reset</a>
              ` : `
                <span class="badge badge-success">Nakasahod Na / Clear</span>
              `}
            </td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
  res.send(layout('Salary Calculation', content));
}

app.get('/admin/salary', requireAdmin, async (req, res) => {
  await renderSalaryPage(req, res, 'admin');
});

app.get('/admin/salary/reset/:worker_id', requireAdmin, async (req, res) => {
  const { worker_id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM attendance_logs WHERE worker_id = $1', [worker_id]);
    await client.query('DELETE FROM advance_money WHERE worker_id = $1', [worker_id]);
    await client.query('DELETE FROM deductions WHERE worker_id = $1', [worker_id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/admin/salary');
});

// Payroll Officer Dedicated Routes
app.get('/payroll/dashboard', requirePayroll, async (req, res) => {
  await renderSalaryPage(req, res, 'payroll');
});

app.get('/payroll/salary/reset/:worker_id', requirePayroll, async (req, res) => {
  const { worker_id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM attendance_logs WHERE worker_id = $1', [worker_id]);
    await client.query('DELETE FROM advance_money WHERE worker_id = $1', [worker_id]);
    await client.query('DELETE FROM deductions WHERE worker_id = $1', [worker_id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/payroll/dashboard');
});

// ANNOUNCEMENTS & SETTINGS
app.get('/admin/announcements', requireAdmin, async (req, res) => {
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

app.post('/admin/announcements', requireAdmin, async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
  res.redirect('/admin/announcements');
});

app.get('/admin/settings', requireAdmin, async (req, res) => {
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
        <label>Default Meal Deduction Amount (₱)</label>
        <input type="number" step="0.01" name="default_meal_deduction" value="${settings.default_meal_deduction || 50.00}" required>
        <button type="submit" class="btn btn-success">Save Settings</button>
      </form>
    </div>
  `;
  res.send(layout('Company Settings', content));
});

app.post('/admin/settings', requireAdmin, async (req, res) => {
  const { company_name, company_logo, company_address, contact_number, default_meal_deduction } = req.body;
  try {
    await pool.query(
      'UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, contact_number = $4, default_meal_deduction = $5 WHERE id = 1',
      [company_name, company_logo, company_address, contact_number, default_meal_deduction]
    );
    res.redirect('/admin/settings');
  } catch (err) {
    res.status(500).send('Database Error: ' + err.message);
  }
});

app.get('/admin/schedule', requireAdmin, async (req, res) => {
  let schedRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  if (schedRes.rows.length === 0) {
    await pool.query(`INSERT INTO work_schedules (morning_in_start, morning_in_end, morning_out_start, morning_out_end, afternoon_in_start, afternoon_in_end, afternoon_out_start, afternoon_out_end) 
      VALUES ('06:00', '07:00', '11:30', '12:00', '12:00', '13:00', '17:00', '18:00')`);
    schedRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  }
  const sched = schedRes.rows[0];
  let content = `
    <header><div class="brand"><h2>Work Schedule & Time Windows</h2></div></header>
    ${adminNav}
    <div class="card">
      <form action="/admin/schedule" method="POST">
        <h3>Morning Session Settings</h3>
        <div style="display: flex; gap: 15px;">
          <div style="flex:1;"><label>Time IN Start</label><input type="time" name="morning_in_start" value="${sched.morning_in_start || '06:00'}"></div>
          <div style="flex:1;"><label>Time IN End</label><input type="time" name="morning_in_end" value="${sched.morning_in_end || '07:00'}"></div>
        </div>
        <div style="display: flex; gap: 15px;">
          <div style="flex:1;"><label>Time OUT Start</label><input type="time" name="morning_out_start" value="${sched.morning_out_start || '11:30'}"></div>
          <div style="flex:1;"><label>Time OUT End</label><input type="time" name="morning_out_end" value="${sched.morning_out_end || '12:00'}"></div>
        </div>

        <h3 style="margin-top: 20px;">Afternoon Session Settings</h3>
        <div style="display: flex; gap: 15px;">
          <div style="flex:1;"><label>Time IN Start</label><input type="time" name="afternoon_in_start" value="${sched.afternoon_in_start || '12:00'}"></div>
          <div style="flex:1;"><label>Time IN End</label><input type="time" name="afternoon_in_end" value="${sched.afternoon_in_end || '13:00'}"></div>
        </div>
        <div style="display: flex; gap: 15px;">
          <div style="flex:1;"><label>Time OUT Start</label><input type="time" name="afternoon_out_start" value="${sched.afternoon_out_start || '17:00'}"></div>
          <div style="flex:1;"><label>Time OUT End</label><input type="time" name="afternoon_out_end" value="${sched.afternoon_out_end || '18:00'}"></div>
        </div>

        <button type="submit" class="btn btn-success" style="margin-top: 20px;">Save Schedule</button>
      </form>
    </div>
  `;
  res.send(layout('Work Schedule', content));
});

app.post('/admin/schedule', requireAdmin, async (req, res) => {
  const { morning_in_start, morning_in_end, morning_out_start, morning_out_end, afternoon_in_start, afternoon_in_end, afternoon_out_start, afternoon_out_end } = req.body;
  try {
    const check = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    if (check.rows.length === 0) {
      await pool.query(`INSERT INTO work_schedules (morning_in_start, morning_in_end, morning_out_start, morning_out_end, afternoon_in_start, afternoon_in_end, afternoon_out_start, afternoon_out_end) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [morning_in_start, morning_in_end, morning_out_start, morning_out_end, afternoon_in_start, afternoon_in_end, afternoon_out_start, afternoon_out_end]);
    } else {
      await pool.query(`UPDATE work_schedules SET morning_in_start = $1, morning_in_end = $2, morning_out_start = $3, morning_out_end = $4, afternoon_in_start = $5, afternoon_in_end = $6, afternoon_out_start = $7, afternoon_out_end = $8 WHERE id = $9`,
        [morning_in_start, morning_in_end, morning_out_start, morning_out_end, afternoon_in_start, afternoon_in_end, afternoon_out_start, afternoon_out_end, check.rows[0].id]);
    }
    res.redirect('/admin/schedule');
  } catch (err) {
    res.status(500).send('Database Error: ' + err.message);
  }
});

// WORKER PORTAL
app.get('/worker/login', async (req, res) => {
  const settings = await getSettings();
  const error = req.query.error || '';
  let content = `
    <div style="max-width: 400px; margin: 50px auto;" class="card">
      <h2 style="text-align: center; margin-bottom: 20px;">Worker Portal Login</h2>
      ${error ? `<div class="alert-box alert-danger">${error}</div>` : ''}
      <form action="/worker/login" method="POST">
        <label>Worker ID</label>
        <input type="text" name="worker_id" placeholder="e.g. W-0001" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px; margin-bottom: 15px;">Login</button>
      </form>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Worker Login', content));
});

app.post('/worker/login', async (req, res) => {
  const { worker_id, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
    if (result.rows.length === 0) {
      return res.redirect('/worker/login?error=Invalid Worker ID or Password.');
    }
    const worker = result.rows[0];
    const match = await bcrypt.compare(password, worker.password);
    if (!match) {
      return res.redirect('/worker/login?error=Invalid Worker ID or Password.');
    }

    req.session.workerId = worker.worker_id;
    res.redirect('/worker');
  } catch (err) {
    res.redirect('/worker/login?error=Server error.');
  }
});

app.get('/worker/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/worker/login');
  });
});

app.post('/worker/change-password', async (req, res) => {
  if (!req.session || !req.session.workerId) return res.redirect('/worker/login');
  const worker_id = req.session.workerId;
  const { current_password, new_password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
    const worker = result.rows[0];
    const match = await bcrypt.compare(current_password, worker.password);
    if (!match) return res.redirect('/worker?error=Mali ang kasalukuyang password.');

    const hashedNewPassword = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE workers SET password = $1 WHERE worker_id = $2', [hashedNewPassword, worker_id]);
    res.redirect('/worker?success=Matagumpay na nabago ang password!');
  } catch (err) {
    res.redirect('/worker?error=Server error.');
  }
});

app.get('/worker', async (req, res) => {
  if (!req.session || !req.session.workerId) return res.redirect('/worker/login');
  const settings = await getSettings();
  const worker_id = req.session.workerId;
  const errorMsg = req.query.error || '';
  const successMsg = req.query.success || '';

  const wRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
  const worker = wRes.rows[0];
  const attendance = (await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date DESC LIMIT 20', [worker_id])).rows;
  const advances = (await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY advance_date DESC', [worker_id])).rows;
  const deductions = (await pool.query('SELECT * FROM deductions WHERE worker_id = $1 ORDER BY deduction_date DESC', [worker_id])).rows;
  const announcements = (await pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5')).rows;

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Worker Portal</h2>
      </div>
      <div><a href="/worker/logout" class="btn btn-danger" style="padding: 6px 12px; font-size: 13px;">Logout</a></div>
    </header>
    ${errorMsg ? `<div class="alert-box alert-danger">${errorMsg}</div>` : ''}
    ${successMsg ? `<div class="alert-box alert-success">${successMsg}</div>` : ''}
    <div class="card">
      <h3>Welcome, ${worker.full_name} (${worker.worker_id})</h3>
      <p><strong>Position:</strong> ${worker.position}</p>
      <p><strong>Daily Rate:</strong> ₱${worker.daily_rate}</p>
    </div>
    <div class="card">
      <h3>Palitan ang Password</h3>
      <form action="/worker/change-password" method="POST">
        <label>Kasalukuyang Password</label>
        <input type="password" name="current_password" required>
        <label>Bagong Password</label>
        <input type="password" name="new_password" required>
        <button type="submit" class="btn">I-update ang Password</button>
      </form>
    </div>
    <div class="card" style="text-align: center;">
      <h3>My QR Code</h3>
      <div id="qrcode" style="display: flex; justify-content: center; margin: 15px 0;"></div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
      new QRCode(document.getElementById("qrcode"), { text: "${worker.worker_id}", width: 150, height: 150 });
    </script>
  `;
  res.send(layout('Worker Portal', content));
});

// SCANNER PORTAL (Protected by Scanner Officer Role)
app.get('/scanner', requireScanner, async (req, res) => {
  const settings = await getSettings();

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Scanner Portal (Officer: ${req.session.officerUsername})</h2>
      </div>
      <div><a href="/officer/logout" class="btn btn-danger" style="padding: 6px 12px; font-size: 13px;">Logout</a></div>
    </header>

    <div class="card">
      <h3>Worker QR Attendance Scanner (Meal Deduction)</h3>
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

    <!-- MEAL PROMPT MODAL OVERLAY -->
    <div id="mealModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; justify-content:center; align-items:center;">
      <div style="background:white; padding:30px; border-radius:10px; text-align:center; max-width:400px; width:90%; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
        <h3 style="color:var(--primary); margin-bottom:10px;">MEAL DEDUCTION QUERY</h3>
        <p id="modalWorkerName" style="font-size:16px; font-weight:bold; color:var(--accent); margin-bottom:15px;"></p>
        <p style="margin-bottom:20px;">Kakain ba ang worker na ito ngayon? (May bawas na ₱${settings.default_meal_deduction || 50.00} pag OO)</p>
        <div style="display:flex; gap:15px; justify-content:center;">
          <button onclick="resolveMeal(true)" class="btn btn-success" style="flex:1; padding:12px;">OO (Kain)</button>
          <button onclick="resolveMeal(false)" class="btn btn-danger" style="flex:1; padding:12px;">HINDI</button>
        </div>
      </div>
    </div>

    <script src="https://unpkg.com/html5-qrcode" type="text/javascript"></script>
    <script>
      let currentMode = '';
      let html5QrCode = null;
      let pendingWorkerId = null;

      function setMode(mode) {
        currentMode = mode;
        document.getElementById('modeDisplay').innerText = 'CURRENT SCAN MODE: TIME ' + mode;
        document.getElementById('startBtn').removeAttribute('disabled');
        document.getElementById('btnIn').style.opacity = mode === 'IN' ? '1' : '0.6';
        document.getElementById('btnOut').style.opacity = mode === 'OUT' ? '1' : '0.6';
      }

      function startScanner() {
        if (!currentMode) { alert('Please Select TIME IN or TIME OUT First.'); return; }
        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('stopBtn').style.display = 'inline-block';

        html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            await stopScanner();
            checkAttendanceAndPromptMeal(decodedText);
          },
          (errorMessage) => {}
        ).catch(err => { alert('Camera access error: ' + err); });
      }

      async function stopScanner() {
        if (html5QrCode && html5QrCode.isScanning) { await html5QrCode.stop(); }
        document.getElementById('startBtn').style.display = 'inline-block';
        document.getElementById('stopBtn').style.display = 'none';
      }

      async function checkAttendanceAndPromptMeal(workerId) {
        const res = await fetch('/api/attendance/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worker_id: workerId, attendance_type: currentMode })
        });
        const data = await res.json();
        const resultDiv = document.getElementById('scanResult');

        if (!data.success) {
          resultDiv.innerHTML = \`<div class="alert-box alert-danger">ERROR: \${data.message}</div>\`;
          setTimeout(() => { resultDiv.innerHTML = ''; startScanner(); }, 4000);
          return;
        }

        pendingWorkerId = workerId;
        document.getElementById('modalWorkerName').innerText = data.worker.full_name + ' (' + data.worker.worker_id + ')';
        document.getElementById('mealModal').style.display = 'flex';
      }

      async function resolveMeal(isEating) {
        document.getElementById('mealModal').style.display = 'none';
        const res = await fetch('/api/attendance/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worker_id: pendingWorkerId, attendance_type: currentMode, is_eating: isEating })
        });
        const data = await res.json();
        const resultDiv = document.getElementById('scanResult');

        if (data.success) {
          let mealMsg = isEating ? '<br><span style="color:var(--danger)">May nabawas na Meal Deduction (₱' + data.mealAmount + ')</span>' : '<br><span style="color:var(--success)">Walang meal deduction.</span>';
          resultDiv.innerHTML = \`<div class="alert-box alert-success">SUCCESS! (\${data.stepDescription})<br>\${data.worker.full_name}<br>ID: \${data.worker.worker_id}<br>TIME \${currentMode}<br>\${data.date} \${data.time}\${mealMsg}</div>\`;
        } else {
          resultDiv.innerHTML = \`<div class="alert-box alert-danger">ERROR: \${data.message}</div>\`;
        }

        pendingWorkerId = null;
        setTimeout(() => { resultDiv.innerHTML = ''; startScanner(); }, 3500);
      }
    </script>
  `;
  res.send(layout('Scanner Portal', content));
});

// API Endpoints for Scanner
app.post('/api/attendance/check', async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  const client = await pool.connect();
  try {
    const workerRes = await client.query("SELECT * FROM workers WHERE worker_id = $1 AND status = 'Active'", [worker_id]);
    if (workerRes.rows.length === 0) return res.json({ success: false, message: 'Worker not found or inactive.' });
    const worker = workerRes.rows[0];
    
    const ph = getPHTime();
    const today = ph.date;
    const currentTime24 = ph.time24;

    const todayLogsRes = await client.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND attendance_date = $2 ORDER BY created_at ASC, id ASC', [worker_id, today]);
    const logsCount = todayLogsRes.rows.length;

    let expectedType = '';
    let stepDescription = '';

    if (logsCount === 0) { expectedType = 'IN'; stepDescription = '1st Scan: Umaga Time IN'; }
    else if (logsCount === 1) { expectedType = 'OUT'; stepDescription = '2nd Scan: Umaga Time OUT (Lunch Break)'; }
    else if (logsCount === 2) { expectedType = 'IN'; stepDescription = '3rd Scan: Hapon Time IN'; }
    else if (logsCount === 3) { expectedType = 'OUT'; stepDescription = '4th Scan: Hapon Time OUT (Uwian)'; }
    else { return res.json({ success: false, message: 'Tapos na ang 4 na beses na pag-scan mo ngayong araw.' }); }

    if (attendance_type !== expectedType) {
      return res.json({ success: false, message: `Maling pindot! Ang sunod mong i-scan ay ${expectedType} (${stepDescription}).` });
    }

    const schedRes = await client.query('SELECT * FROM work_schedules LIMIT 1');
    if (schedRes.rows.length > 0) {
      const s = schedRes.rows[0];
      let windowStart = logsCount === 0 ? s.morning_in_start : logsCount === 1 ? s.morning_out_start : logsCount === 2 ? s.afternoon_in_start : s.afternoon_out_start;
      let windowEnd = logsCount === 0 ? s.morning_in_end : logsCount === 1 ? s.morning_out_end : logsCount === 2 ? s.afternoon_in_end : s.afternoon_out_end;
      let sessionName = logsCount === 0 ? 'Umaga Time IN' : logsCount === 1 ? 'Umaga Time OUT' : logsCount === 2 ? 'Hapon Time IN' : 'Hapon Time OUT';

      if (windowStart && windowEnd) {
        const curTime = currentTime24.substring(0, 5);
        if (curTime < windowStart || curTime > windowEnd) {
          return res.json({ success: false, message: `Hindi pa oras o lampas na para sa ${sessionName}!\nNakatakdang oras: ${formatTimeTo12Hour(windowStart)} - ${formatTimeTo12Hour(windowEnd)}.` });
        }
      }
    }

    res.json({ success: true, worker, stepDescription });
  } catch (err) {
    res.json({ success: false, message: 'Server error during validation.' });
  } finally {
    client.release();
  }
});

app.post('/api/attendance/commit', async (req, res) => {
  const { worker_id, attendance_type, is_eating } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const workerRes = await client.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
    const worker = workerRes.rows[0];

    const ph = getPHTime();
    const today = ph.date;
    const timeStr12 = ph.time;

    await client.query('INSERT INTO attendance_logs (worker_id, attendance_date, attendance_time, attendance_type) VALUES ($1, $2, $3, $4)', [worker_id, today, timeStr12, attendance_type]);

    let mealAmount = 0;
    if (is_eating) {
      const settingsRes = await client.query('SELECT default_meal_deduction FROM company_settings LIMIT 1');
      mealAmount = parseFloat(settingsRes.rows[0]?.default_meal_deduction || 50.00);
      await client.query('INSERT INTO deductions (worker_id, deduction_name, amount, deduction_date, notes) VALUES ($1, $2, $3, $4, $5)', [worker_id, 'Meal Deduction', mealAmount, today, `Automatic deduction (${attendance_type})`]);
    }

    await client.query('COMMIT');
    res.json({ success: true, worker, date: today, time: timeStr12, mealAmount, stepDescription: `Recorded Time ${attendance_type}` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ success: false, message: 'Server error during commit.' });
  } finally {
    client.release();
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
