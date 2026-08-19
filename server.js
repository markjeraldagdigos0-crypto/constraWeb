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
  
  const formatterDate = new Intl.DateTimeFormat('en-CA', optionsDate); // YYYY-MM-DD
  const formatterTime24 = new Intl.DateTimeFormat('en-GB', optionsTime24); // HH:MM:SS
  const formatterTime12 = new Intl.DateTimeFormat('en-US', optionsTime12); // h:MM:SS AM/PM
  
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
        role VARCHAR(50) DEFAULT 'admin',
        is_approved BOOLEAN DEFAULT TRUE,
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

    // Auto-migrate missing columns
    await pool.query(`
      ALTER TABLE workers ADD COLUMN IF NOT EXISTS password TEXT NOT NULL DEFAULT '';
      ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'admin';
      ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT TRUE;
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
    console.log('Database initialized and migrated successfully.');
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
  if (req.session && req.session.adminId && req.session.role === 'admin') {
    return next();
  }
  res.redirect('/admin/login');
}

function requirePayroll(req, res, next) {
  if (req.session && req.session.adminId && (req.session.role === 'admin' || req.session.role === 'payroll')) {
    return next();
  }
  res.redirect('/payroll/login');
}

function requireScanner(req, res, next) {
  if (req.session && req.session.adminId && (req.session.role === 'admin' || req.session.role === 'scanner')) {
    return next();
  }
  res.redirect('/scanner/login');
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
        <a href="/admin/login" class="btn" style="padding: 15px 30px; font-size: 16px;">ADMIN PORTAL</a>
        <a href="/payroll/login" class="btn btn-warning" style="padding: 15px 30px; font-size: 16px;">PAYROLL PORTAL</a>
        <a href="/scanner/login" class="btn btn-success" style="padding: 15px 30px; font-size: 16px;">SCANNER PORTAL</a>
        <a href="/worker/login" class="btn" style="background: var(--primary); padding: 15px 30px; font-size: 16px;">WORKER PORTAL</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Main', html));
});

// ADMIN AUTHENTICATION & APPROVAL ROUTES
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
        Wala pang Admin account? <a href="/admin/register" style="color: var(--accent); font-weight: bold;">Mag-register dito</a><br><br>
        Gusto mo bang mag-register bilang <a href="/payroll/register" style="color: var(--warning);">Payroll Officer</a> o <a href="/scanner/register" style="color: var(--success);">Scanner Officer</a>?
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Admin Login', content));
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1 AND role = $2', [username, 'admin']);
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
    req.session.role = 'admin';
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
        <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px; margin-bottom: 15px;">Register Account</button>
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
    await pool.query('INSERT INTO admin_users (username, password, full_name, role, is_approved) VALUES ($1, $2, $3, $4, $5)', [username, hashedPassword, full_name, 'admin', true]);
    res.redirect('/admin/login?success=Admin account created successfully! Please login.');
  } catch (err) {
    res.redirect('/admin/register?error=Server error during registration.');
  }
});

// PAYROLL OFFICER REGISTRATION & LOGIN
app.get('/payroll/login', async (req, res) => {
  const settings = await getSettings();
  const error = req.query.error || '';
  const success = req.query.success || '';

  let content = `
    <div style="max-width: 400px; margin: 50px auto;" class="card">
      <h2 style="text-align: center; margin-bottom: 20px;">Payroll Officer Login</h2>
      ${error ? `<div class="alert-box alert-danger">${error}</div>` : ''}
      ${success ? `<div class="alert-box alert-success">${success}</div>` : ''}
      <form action="/payroll/login" method="POST">
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn btn-warning" style="width: 100%; padding: 12px; margin-bottom: 15px;">Login as Payroll</button>
      </form>
      <div style="text-align: center; font-size: 14px;">
        Wala pang account? <a href="/payroll/register" style="color: var(--warning); font-weight: bold;">Mag-register dito</a><br>
        <a href="/" style="color: #64748b;">Bumalik sa Home</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Payroll Login', content));
});

app.post('/payroll/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1 AND role = $2', [username, 'payroll']);
    if (result.rows.length === 0) {
      return res.redirect('/payroll/login?error=Invalid username or account not found.');
    }
    const user = result.rows[0];
    if (!user.is_approved) {
      return res.redirect('/payroll/login?error=Ang iyong account ay naghihintay pa ng pag-apruba ng Admin.');
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.redirect('/payroll/login?error=Invalid password.');
    }

    req.session.adminId = user.id;
    req.session.adminUsername = user.username;
    req.session.role = 'payroll';
    res.redirect('/payroll/dashboard');
  } catch (err) {
    res.redirect('/payroll/login?error=Server error during login.');
  }
});

app.get('/payroll/register', async (req, res) => {
  const settings = await getSettings();
  const error = req.query.error || '';

  let content = `
    <div style="max-width: 400px; margin: 50px auto;" class="card">
      <h2 style="text-align: center; margin-bottom: 20px;">Payroll Officer Registration</h2>
      ${error ? `<div class="alert-box alert-danger">${error}</div>` : ''}
      <form action="/payroll/register" method="POST">
        <label>Full Name</label>
        <input type="text" name="full_name" required>
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn btn-warning" style="width: 100%; padding: 12px; margin-bottom: 15px;">Register (Needs Admin Approval)</button>
      </form>
      <div style="text-align: center; font-size: 14px;">
        May account na? <a href="/payroll/login" style="color: var(--warning); font-weight: bold;">Mag-login dito</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Payroll Register', content));
});

app.post('/payroll/register', async (req, res) => {
  const { full_name, username, password } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.redirect('/payroll/register?error=Username is already taken.');
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO admin_users (username, password, full_name, role, is_approved) VALUES ($1, $2, $3, $4, $5)', [username, hashedPassword, full_name, 'payroll', false]);
    res.redirect('/payroll/login?success=Matagumpay na nakapag-register! Mangyaring maghintay na ma-approve ito ng Admin.');
  } catch (err) {
    res.redirect('/payroll/register?error=Server error during registration.');
  }
});

// SCANNER OFFICER REGISTRATION & LOGIN
app.get('/scanner/login', async (req, res) => {
  const settings = await getSettings();
  const error = req.query.error || '';
  const success = req.query.success || '';

  let content = `
    <div style="max-width: 400px; margin: 50px auto;" class="card">
      <h2 style="text-align: center; margin-bottom: 20px;">Scanner Officer Login</h2>
      ${error ? `<div class="alert-box alert-danger">${error}</div>` : ''}
      ${success ? `<div class="alert-box alert-success">${success}</div>` : ''}
      <form action="/scanner/login" method="POST">
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px; margin-bottom: 15px;">Login as Scanner</button>
      </form>
      <div style="text-align: center; font-size: 14px;">
        Wala pang account? <a href="/scanner/register" style="color: var(--success); font-weight: bold;">Mag-register dito</a><br>
        <a href="/" style="color: #64748b;">Bumalik sa Home</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Scanner Login', content));
});

app.post('/scanner/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1 AND role = $2', [username, 'scanner']);
    if (result.rows.length === 0) {
      return res.redirect('/scanner/login?error=Invalid username or account not found.');
    }
    const user = result.rows[0];
    if (!user.is_approved) {
      return res.redirect('/scanner/login?error=Ang iyong account ay naghihintay pa ng pag-apruba ng Admin.');
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.redirect('/scanner/login?error=Invalid password.');
    }

    req.session.adminId = user.id;
    req.session.adminUsername = user.username;
    req.session.role = 'scanner';
    res.redirect('/scanner');
  } catch (err) {
    res.redirect('/scanner/login?error=Server error during login.');
  }
});

app.get('/scanner/register', async (req, res) => {
  const settings = await getSettings();
  const error = req.query.error || '';

  let content = `
    <div style="max-width: 400px; margin: 50px auto;" class="card">
      <h2 style="text-align: center; margin-bottom: 20px;">Scanner Officer Registration</h2>
      ${error ? `<div class="alert-box alert-danger">${error}</div>` : ''}
      <form action="/scanner/register" method="POST">
        <label>Full Name</label>
        <input type="text" name="full_name" required>
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px; margin-bottom: 15px;">Register (Needs Admin Approval)</button>
      </form>
      <div style="text-align: center; font-size: 14px;">
        May account na? <a href="/scanner/login" style="color: var(--success); font-weight: bold;">Mag-login dito</a>
      </div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Scanner Register', content));
});

app.post('/scanner/register', async (req, res) => {
  const { full_name, username, password } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.redirect('/scanner/register?error=Username is already taken.');
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO admin_users (username, password, full_name, role, is_approved) VALUES ($1, $2, $3, $4, $5)', [username, hashedPassword, full_name, 'scanner', false]);
    res.redirect('/scanner/login?success=Matagumpay na nakapag-register! Mangyaring maghintay na ma-approve ito ng Admin.');
  } catch (err) {
    res.redirect('/scanner/register?error=Server error during registration.');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

app.get('/payroll/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/payroll/login');
  });
});

app.get('/scanner/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/scanner/login');
  });
});

// ADMIN PORTAL & APPROVALS
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
  const pendingApprovals = await pool.query('SELECT COUNT(*) FROM admin_users WHERE is_approved = FALSE');

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
        <p><strong>Pending Accounts:</strong> ${pendingApprovals.rows[0].count}</p>
        <a href="/admin/approvals" class="btn btn-warning" style="margin-top: 10px;">Review Accounts</a>
      </div>
    </div>
  `;
  res.send(layout('Admin Dashboard', content));
});

app.get('/admin/approvals', requireAdmin, async (req, res) => {
  const pendingUsers = await pool.query("SELECT * FROM admin_users WHERE role != 'admin' ORDER BY created_at DESC");

  let content = `
    <header><div class="brand"><h2>Officer Account Approvals</h2></div></header>
    ${adminNav}
    <div class="card">
      <h3>Payroll & Scanner Officer Accounts</h3>
      <table>
        <tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr>
        ${pendingUsers.rows.map(u => `
          <tr>
            <td>${u.full_name}</td>
            <td>${u.username}</td>
            <td><span class="badge ${u.role === 'payroll' ? 'badge-warning' : 'badge-success'}">${u.role.toUpperCase()}</span></td>
            <td><span class="badge ${u.is_approved ? 'badge-success' : 'badge-danger'}">${u.is_approved ? 'Approved' : 'Pending'}</span></td>
            <td>
              ${u.is_approved ? 
                `<a href="/admin/approvals/toggle/${u.id}" class="btn btn-danger" style="padding: 4px 8px; font-size: 12px;">Revoke</a>` : 
                `<a href="/admin/approvals/toggle/${u.id}" class="btn btn-success" style="padding: 4px 8px; font-size: 12px;">Approve</a>`
              }
              <a href="/admin/approvals/delete/${u.id}" class="btn btn-danger" onclick="return confirm('Delete this account?');" style="padding: 4px 8px; font-size: 12px;">Delete</a>
            </td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
  res.send(layout('Officer Approvals', content));
});

app.get('/admin/approvals/toggle/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const userRes = await pool.query('SELECT is_approved FROM admin_users WHERE id = $1', [id]);
  if (userRes.rows.length > 0) {
    const newStatus = !userRes.rows[0].is_approved;
    await pool.query('UPDATE admin_users SET is_approved = $1 WHERE id = $2', [newStatus, id]);
  }
  res.redirect('/admin/approvals');
});

app.get('/admin/approvals/delete/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM admin_users WHERE id = $1', [id]);
  res.redirect('/admin/approvals');
});

// WORKER MANAGEMENT & OTHER ADMIN ROUTES
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
              <a href="/admin/workers/delete/${w.worker_id}" class="btn btn-danger" onclick="return confirm('Delete worker ${w.full_name}?');" style="padding: 4px 8px; font-size: 12px;">Delete</a>
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
        <label>Worker ID</label>
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
      <h3>${settings.company_name}</h3>
      <h2>${worker.full_name}</h2>
      <p>ID: ${worker.worker_id}</p>
      <div id="qrcode" style="display: flex; justify-content: center; margin: 20px 0;"></div>
      <button onclick="window.print()" class="btn">Print QR Code</button>
      <a href="/admin/workers" class="btn btn-warning">Back</a>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>new QRCode(document.getElementById("qrcode"), { text: "${worker.worker_id}", width: 200, height: 200 });</script>
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

// ATTENDANCE MANAGEMENT
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
      <form action="/admin/attendance" method="GET" style="display: flex; gap: 10px; margin-bottom: 15px;">
        <input type="text" name="search" placeholder="Name or ID..." value="${search}">
        <input type="date" name="date" value="${dateFilter}">
        <button type="submit" class="btn">Filter</button>
      </form>
      <table>
        <tr><th>Worker ID</th><th>Name</th><th>Date</th><th>Time</th><th>Type</th></tr>
        ${logs.rows.map(l => `<tr><td>${l.worker_id}</td><td>${l.full_name}</td><td>${l.attendance_date.toISOString().split('T')[0]}</td><td>${l.attendance_time}</td><td><span class="badge ${l.attendance_type === 'IN' ? 'badge-success' : 'badge-warning'}">${l.attendance_type}</span></td></tr>`).join('')}
      </table>
    </div>
  `;
  res.send(layout('Attendance Report', content));
});

// ADVANCE MONEY
app.get('/admin/advance', requireAdmin, async (req, res) => {
  const workers = await pool.query("SELECT * FROM workers WHERE status = 'Active'");
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

app.post('/admin/advance', requireAdmin, async (req, res) => {
  const { worker_id, amount, advance_date, notes } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, advance_date, notes) VALUES ($1, $2, $3, $4)', [worker_id, amount, advance_date, notes]);
  res.redirect('/admin/advance');
});

// DEDUCTIONS
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
        <label>Deduction Type / Name</label>
        <input type="text" name="deduction_name" placeholder="Meal Deduction / Uniform" required>
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
        <tr><th>Worker ID</th><th>Name</th><th>Deduction Name</th><th>Amount</th><th>Date</th><th>Notes</th></tr>
        ${deductionsList.rows.map(d => `<tr><td>${d.worker_id}</td><td>${d.full_name}</td><td>${d.deduction_name}</td><td>₱${parseFloat(d.amount).toFixed(2)}</td><td>${d.deduction_date.toISOString().split('T')[0]}</td><td>${d.notes || '-'}</td></tr>`).join('')}
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

// SALARY & PAYROLL PORTAL ROUTES (Accessible by Admin and Payroll Officer)
const payrollNav = `
  <nav class="no-print">
    <a href="/payroll/dashboard" class="active">Payroll Summary</a>
    <a href="/payroll/logout" style="background: var(--danger); color: white; margin-left: auto;">Logout</a>
  </nav>
`;

app.get('/payroll/dashboard', requirePayroll, async (req, res) => {
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

    let isPaid = (totalEquivalentDays === 0 && totalSalary === 0 && totalAdvance === 0 && totalDeductions === 0);

    grandTotalNet += netSalary;

    salaryData.push({
      ...w,
      totalEquivalentDays: totalEquivalentDays.toFixed(1),
      totalSalary,
      totalAdvance,
      totalDeductions,
      netSalary,
      isPaid
    });
  }

  const roleNav = req.session.role === 'admin' ? adminNav : payrollNav;

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Payroll Portal</h2>
      </div>
      <div>Logged in as: <strong>${req.session.adminUsername} (${req.session.role.toUpperCase()})</strong></div>
    </header>
    ${roleNav}
    <div class="card" style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: space-between; align-items: center;">
      <div>
        <h3>Payroll Overview</h3>
        <p>Total Net Payout: <strong style="color: var(--success); font-size: 18px;">₱${grandTotalNet.toFixed(2)}</strong></p>
      </div>
      <div class="no-print">
        <button onclick="window.print()" class="btn">Print Payroll Report</button>
      </div>
    </div>
    <div class="card">
      <h3>Worker Salary Breakdown & Status</h3>
      <table>
        <tr><th>ID</th><th>Name</th><th>Daily Rate</th><th>Total Days</th><th>Gross</th><th>Advance</th><th>Deductions</th><th>Net Salary</th><th>Status / Action</th></tr>
        ${salaryData.map(s => `
          <tr>
            <td>${s.worker_id}</td>
            <td>${s.full_name}</td>
            <td>₱${s.daily_rate}</td>
            <td>${s.totalEquivalentDays} days</td>
            <td>₱${s.totalSalary.toFixed(2)}</td>
            <td>₱${s.totalAdvance.toFixed(2)}</td>
            <td>₱${s.totalDeductions.toFixed(2)}</td>
            <td><strong>₱${s.netSalary.toFixed(2)}</strong></td>
            <td>
              ${s.isPaid ? 
                `<span class="badge badge-success">Naka-sahod na</span>` : 
                `<a href="/payroll/pay/${s.worker_id}" class="btn btn-warning" onclick="return confirm('I-process at i-reset na ba ang sahod ni ${s.full_name}?');" style="padding: 4px 8px; font-size: 12px;">Sahudin & Reset</a>`
              }
            </td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
  res.send(layout('Payroll Portal', content));
});

app.get('/admin/salary', requireAdmin, async (req, res) => {
  res.redirect('/payroll/dashboard');
});

// Individual worker salary reset (Sahudin isa-isa)
app.get('/payroll/pay/:worker_id', requirePayroll, async (req, res) => {
  const { worker_id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM attendance_logs WHERE worker_id = $1', [worker_id]);
    await client.query('DELETE FROM advance_money WHERE worker_id = $1', [worker_id]);
    await client.query('DELETE FROM deductions WHERE worker_id = $1', [worker_id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/payroll/dashboard');
});

// ANNOUNCEMENTS
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

// COMPANY SETTINGS & SCHEDULE
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
  await pool.query('UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, contact_number = $4, default_meal_deduction = $5 WHERE id = 1', [company_name, company_logo, company_address, contact_number, default_meal_deduction]);
  res.redirect('/admin/settings');
});

app.get('/admin/schedule', requireAdmin, async (req, res) => {
  let schedRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const sched = schedRes.rows[0];
  let content = `
    <header><div class="brand"><h2>Work Schedule & Time Windows</h2></div></header>
    ${adminNav}
    <div class="card">
      <form action="/admin/schedule" method="POST">
        <h3>Morning Session</h3>
        <div style="display: flex; gap: 15px;">
          <div style="flex:1;"><label>Time IN Start</label><input type="time" name="morning_in_start" value="${sched.morning_in_start}"></div>
          <div style="flex:1;"><label>Time IN End</label><input type="time" name="morning_in_end" value="${sched.morning_in_end}"></div>
        </div>
        <div style="display: flex; gap: 15px;">
          <div style="flex:1;"><label>Time OUT Start</label><input type="time" name="morning_out_start" value="${sched.morning_out_start}"></div>
          <div style="flex:1;"><label>Time OUT End</label><input type="time" name="morning_out_end" value="${sched.morning_out_end}"></div>
        </div>
        <h3 style="margin-top: 20px;">Afternoon Session</h3>
        <div style="display: flex; gap: 15px;">
          <div style="flex:1;"><label>Time IN Start</label><input type="time" name="afternoon_in_start" value="${sched.afternoon_in_start}"></div>
          <div style="flex:1;"><label>Time IN End</label><input type="time" name="afternoon_in_end" value="${sched.afternoon_in_end}"></div>
        </div>
        <div style="display: flex; gap: 15px;">
          <div style="flex:1;"><label>Time OUT Start</label><input type="time" name="afternoon_out_start" value="${sched.afternoon_out_start}"></div>
          <div style="flex:1;"><label>Time OUT End</label><input type="time" name="afternoon_out_end" value="${sched.afternoon_out_end}"></div>
        </div>
        <button type="submit" class="btn btn-success" style="margin-top: 20px;">Save Schedule</button>
      </form>
    </div>
  `;
  res.send(layout('Work Schedule', content));
});

app.post('/admin/schedule', requireAdmin, async (req, res) => {
  const { morning_in_start, morning_in_end, morning_out_start, morning_out_end, afternoon_in_start, afternoon_in_end, afternoon_out_start, afternoon_out_end } = req.body;
  const check = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  await pool.query('UPDATE work_schedules SET morning_in_start = $1, morning_in_end = $2, morning_out_start = $3, morning_out_end = $4, afternoon_in_start = $5, afternoon_in_end = $6, afternoon_out_start = $7, afternoon_out_end = $8 WHERE id = $9',
    [morning_in_start, morning_in_end, morning_out_start, morning_out_end, afternoon_in_start, afternoon_in_end, afternoon_out_start, afternoon_out_end, check.rows[0].id]);
  res.redirect('/admin/schedule');
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
      <div style="text-align: center;"><a href="/">Bumalik sa Home</a></div>
    </div>
  `;
  res.send(layout(settings.company_name + ' - Worker Login', content));
});

app.post('/worker/login', async (req, res) => {
  const { worker_id, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
    if (result.rows.length === 0) return res.redirect('/worker/login?error=Invalid Worker ID.');
    const worker = result.rows[0];
    const match = await bcrypt.compare(password, worker.password);
    if (!match) return res.redirect('/worker/login?error=Invalid Password.');
    req.session.workerId = worker.worker_id;
    res.redirect('/worker');
  } catch (err) {
    res.redirect('/worker/login?error=Server error.');
  }
});

app.get('/worker/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/worker/login'));
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
    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE workers SET password = $1 WHERE worker_id = $2', [hashed, worker_id]);
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
  const attRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date DESC, created_at DESC LIMIT 20', [worker_id]);
  const advRes = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY advance_date DESC', [worker_id]);
  const dedRes = await pool.query('SELECT * FROM deductions WHERE worker_id = $1 ORDER BY deduction_date DESC', [worker_id]);
  const annRes = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5');

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
      <p><strong>Assigned Project:</strong> ${worker.assigned_project || '-'}</p>
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
      <p><strong>${worker.worker_id}</strong></p>
    </div>

    <div class="card">
      <h3>My Recent Attendance</h3>
      <table>
        <tr><th>Date</th><th>Time</th><th>Type</th></tr>
        ${attRes.rows.map(a => `<tr><td>${a.attendance_date.toISOString().split('T')[0]}</td><td>${a.attendance_time}</td><td><span class="badge ${a.attendance_type === 'IN' ? 'badge-success' : 'badge-warning'}">${a.attendance_type}</span></td></tr>`).join('')}
      </table>
    </div>

    <div class="card">
      <h3>Summary of Advances & Deductions (Mga kaltas at advances sa sahod)</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
        <div>
          <h4>Cash Advances History</h4>
          <table>
            <tr><th>Date</th><th>Amount</th><th>Notes</th></tr>
            ${advRes.rows.map(ad => `<tr><td>${ad.advance_date.toISOString().split('T')[0]}</td><td>₱${ad.amount}</td><td>${ad.notes || '-'}</td></tr>`).join('')}
          </table>
        </div>
        <div>
          <h4>Deductions (Meal, Uniform, etc.)</h4>
          <table>
            <tr><th>Date</th><th>Name</th><th>Amount</th><th>Notes</th></tr>
            ${dedRes.rows.map(dd => `<tr><td>${dd.deduction_date.toISOString().split('T')[0]}</td><td>${dd.deduction_name}</td><td>₱${dd.amount}</td><td>${dd.notes || '-'}</td></tr>`).join('')}
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Announcements (Paunawa)</h3>
      ${annRes.rows.map(a => `<div style="border-bottom: 1px solid #cbd5e1; padding: 10px 0;"><h4>${a.title}</h4><small>${a.created_at.toISOString().replace('T', ' ').substring(0, 16)}</small><p>${a.content}</p></div>`).join('')}
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>new QRCode(document.getElementById("qrcode"), { text: "${worker.worker_id}", width: 150, height: 150 });</script>
  `;
  res.send(layout('Worker Portal', content));
});


// SCANNER PORTAL (Accessible by Admin and Scanner Officer)
app.get('/scanner', requireScanner, async (req, res) => {
  const settings = await getSettings();
  const roleNav = req.session.role === 'admin' ? adminNav : `<nav class="no-print"><a href="/scanner/logout" style="background: var(--danger); color: white; margin-left: auto;">Logout</a></nav>`;

  let content = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>${settings.company_name} - Scanner Portal</h2>
      </div>
      <div>Logged in as: <strong>${req.session.adminUsername} (${req.session.role.toUpperCase()})</strong></div>
    </header>
    ${roleNav}
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
            checkAttendanceAndPromptMeal(decodedText);
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

      async function checkAttendanceAndPromptMeal(workerId) {
        const res = await fetch('/api/attendance/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worker_id: workerId, attendance_type: currentMode })
        });
        const data = await res.json();
        const resultDiv = document.getElementById('scanResult');

        if (!data.success) {
          resultDiv.innerHTML = '<div class="alert-box alert-danger">ERROR: ' + data.message + '</div>';
          setTimeout(() => {
            resultDiv.innerHTML = '';
            startScanner();
          }, 4000);
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
          resultDiv.innerHTML = '<div class="alert-box alert-success">SUCCESS! (' + data.stepDescription + ')<br>' + data.worker.full_name + '<br>ID: ' + data.worker.worker_id + '<br>TIME ' + currentMode + '<br>' + data.date + ' ' + data.time + mealMsg + '</div>';
        } else {
          resultDiv.innerHTML = '<div class="alert-box alert-danger">ERROR: ' + data.message + '</div>';
        }

        pendingWorkerId = null;
        setTimeout(() => {
          resultDiv.innerHTML = '';
          startScanner();
        }, 3500);
      }
    </script>
  `;
  res.send(layout('Scanner Portal', content));
});

// API Endpoints for Attendance
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
    else if (logsCount === 1) { expectedType = 'OUT'; stepDescription = '2nd Scan: Umaga Time OUT'; }
    else if (logsCount === 2) { expectedType = 'IN'; stepDescription = '3rd Scan: Hapon Time IN'; }
    else if (logsCount === 3) { expectedType = 'OUT'; stepDescription = '4th Scan: Hapon Time OUT'; }
    else { return res.json({ success: false, message: 'Tapos na ang 4 na beses na pag-scan ngayong araw.' }); }

    if (attendance_type !== expectedType) {
      return res.json({ success: false, message: `Maling pindot! Ang sunod ay ${expectedType} (${stepDescription}).` });
    }

    res.json({ success: true, worker, stepDescription });
  } catch (err) {
    res.json({ success: false, message: 'Server error during attendance validation.' });
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
      await client.query('INSERT INTO deductions (worker_id, deduction_name, amount, deduction_date, notes) VALUES ($1, $2, $3, $4, $5)', [worker_id, 'Meal Deduction', mealAmount, today, `Automatic deduction from QR scan (${attendance_type})`]);
    }

    await client.query('COMMIT');
    res.json({ success: true, worker, date: today, time: timeStr12, mealAmount, stepDescription: `Recorded Time ${attendance_type}` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ success: false, message: 'Server error during attendance commit.' });
  } finally {
    client.release();
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
