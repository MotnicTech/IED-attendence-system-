// app.js — IED HRMS  (matches your exact folder structure)
'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const { pool, initDB } = require('./db');          // db/index.js
const { requireHR,
  requireEmployee } = require('./middleware/auth'); // middleware/auth.js
const hrRouter = require('./routes/hr');       // routes/hr.js

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 4000;

// ── VIEW ENGINE ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ied-hrms-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000   // 30 days
  }
}));

// ── EMPLOYEE ROUTES (PIN-based login) ────────────────────────────────────────
// We define these inline here to keep your folder structure (no separate employee route file).
// All employee logic lives in routes/attendance.js helpers + here.

const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

// ── Time helpers (shared) ─────────────────────────────────────────────────────
function getZonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  return parts.reduce((a, p) => { if (p.type !== 'literal') a[p.type] = p.value; return a; }, {});
}
function getLocalDateKey(d = new Date()) { const z = getZonedParts(d); return `${z.year}-${z.month}-${z.day}`; }
function getMonthYearKey(d = new Date()) { const z = getZonedParts(d); return `${z.month}/${String(z.year).slice(2)}`; }
function getIstTimestampString(d = new Date()) {
  const z = getZonedParts(d), ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${z.year}-${z.month}-${z.day} ${z.hour}:${z.minute}:${z.second}.${ms}`;
}
function formatTimeHHMM(v) {
  if (!v) return null;
  const t = String(v); const tp = t.includes('T') ? t.split('T')[1] : (t.split(' ')[1] || t);
  return tp.slice(0, 5);
}
function formatDateDMY(v) {
  if (!v) return '—'; const t = String(v);
  const dp = t.includes('T') ? t.split('T')[0] : t.split(' ')[0];
  const [y, m, d] = dp.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[parseInt(m, 10) - 1] || m} ${y}`;
}
function toNum(v) { if (v === undefined || v === null || v === '') return null; const p = parseFloat(v); return isFinite(p) ? p : null; }
function mapLink(lat, lng) { const la = toNum(lat), lo = toNum(lng); if (la === null || lo === null) return null; return `https://www.google.com/maps?q=${la},${lo}`; }

// ── Employee Express Router ───────────────────────────────────────────────────
const empRouter = require('express').Router();

// GET /emp/login
empRouter.get('/login', (req, res) => {
  if (req.session.employee) return res.redirect('/emp/attendance');
  res.render('emp-login', { error: null });
});

// POST /emp/login
empRouter.post('/login', async (req, res) => {
  const { emp_id, pin } = req.body;
  try {
    const clean = (emp_id || '').trim().toUpperCase();
    const r = await pool.query('SELECT * FROM employees WHERE emp_id=$1 AND is_active=TRUE', [clean]);
    if (!r.rows.length) return res.render('emp-login', { error: 'Invalid Employee ID or account inactive.' });
    const ok = await bcrypt.compare(pin, r.rows[0].pin_hash);
    if (!ok) return res.render('emp-login', { error: 'Incorrect PIN. Please try again.' });
    const emp = r.rows[0];
    req.session.employee = {
      id: emp.id, emp_id: emp.emp_id, name: emp.name,
      email: emp.email, department: emp.department, designation: emp.designation
    };
    res.redirect('/emp/attendance');
  } catch (err) {
    res.render('emp-login', { error: 'Server error: ' + err.message });
  }
});

// GET /emp/logout
empRouter.get('/logout', (req, res) => {
  res.redirect('/emp/attendance');
});

// GET /emp/attendance — punch page
empRouter.get('/attendance', requireEmployee, (req, res) => {
  res.render('emp-attendance', { employee: req.session.employee });
});

// GET /emp/api/today — current day state JSON
empRouter.get('/api/today', requireEmployee, async (req, res) => {
  const emp = req.session.employee;
  try {
    const today = getLocalDateKey();
    const result = await pool.query(
      `SELECT * FROM attendance_logs WHERE emp_id=$1 AND date=$2 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [emp.emp_id, today]
    );
    const record = result.rows[0] || null;
    res.json({
      success: true,
      date: today,
      record,
      canPunchIn: !record || (!record.punch_in_time && !record.punch_out_time),
      canPunchOut: !!record && !!record.punch_in_time && !record.punch_out_time,
      inTimeLabel: formatTimeHHMM(record && record.punch_in_time),
      outTimeLabel: formatTimeHHMM(record && record.punch_out_time)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /emp/api/punch — save punch in or out
empRouter.post('/api/punch', requireEmployee, async (req, res) => {
  const emp = req.session.employee;
  const { status, latitude, longitude, locationName } = req.body;

  if (!['Punch In', 'Punch Out'].includes(status))
    return res.status(400).json({ success: false, message: 'Invalid punch status.' });

  const now = new Date();
  const timestamp = getIstTimestampString(now);
  const dateOnly = getLocalDateKey(now);
  const monthYear = getMonthYearKey(now);
  const lat = toNum(latitude);
  const lng = toNum(longitude);

  if (lat === null || lng === null) {
    return res.status(400).json({ success: false, message: 'Location (latitude and longitude) is mandatory.' });
  }

  const locLabel = (locationName || '').trim() || 'Unknown';
  const mLink = mapLink(lat, lng);
  const isPunchIn = status === 'Punch In';

  try {
    const existing = await pool.query(
      `SELECT id, punch_in_time, punch_out_time FROM attendance_logs
        WHERE emp_id=$1 AND date=$2 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [emp.emp_id, dateOnly]
    );
    const rec = existing.rows[0] || null;

    if (isPunchIn) {
      if (rec && rec.punch_in_time && !rec.punch_out_time)
        return res.status(400).json({ success: false, message: 'Already punched IN today. Please punch OUT first.' });
      if (rec && rec.punch_in_time && rec.punch_out_time)
        return res.status(400).json({ success: false, message: 'Attendance already completed for today.' });

      await pool.query(
        `INSERT INTO attendance_logs
         (emp_id, emp_email, status, punch_in_time, punch_out_time,
          in_location, out_location, in_latitude, in_longitude,
          out_latitude, out_longitude, in_map_link, out_map_link,
          date, month_year, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          emp.emp_id, emp.email, 'Punch In', timestamp, null,
          locLabel, null, lat, lng, null, null, mLink, null,
          dateOnly, monthYear, timestamp
        ]
      );
    } else {
      if (!rec || !rec.punch_in_time)
        return res.status(400).json({ success: false, message: 'Please punch IN first.' });
      if (rec.punch_out_time)
        return res.status(400).json({ success: false, message: 'Already punched OUT today.' });

      await pool.query(
        `UPDATE attendance_logs
            SET status='Punch Out', punch_out_time=$2,
                out_location=$3, out_latitude=$4, out_longitude=$5,
                out_map_link=$6, month_year=$7
          WHERE id=$1`,
        [rec.id, timestamp, locLabel, lat, lng, mLink, monthYear]
      );
    }

    res.json({ success: true, message: `${status} recorded at ${formatTimeHHMM(timestamp)}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /emp/report — employee's own attendance report
empRouter.get('/report', requireEmployee, async (req, res) => {
  const emp = req.session.employee;
  const { month_year } = req.query;

  try {
    const params = [emp.emp_id];
    let where = 'WHERE emp_id=$1';
    if (month_year && month_year.trim()) {
      params.push(month_year.trim());
      where += ` AND month_year=$${params.length}`;
    }

    const logs = await pool.query(
      `SELECT *,
              CASE WHEN punch_in_time IS NOT NULL AND punch_out_time IS NOT NULL
                   THEN ROUND(EXTRACT(EPOCH FROM (
                          punch_out_time::TIMESTAMP - punch_in_time::TIMESTAMP
                        ))/3600, 2)
                   ELSE NULL END AS hours_worked
         FROM attendance_logs ${where} ORDER BY date DESC`,
      params
    );

    // Compute summary
    const summary = { total_present: 0, full_day: 0, half_day: 0, short_day: 0, pending_out: 0, total_hours: 0 };
    logs.rows.forEach(r => {
      const h = r.hours_worked ? parseFloat(r.hours_worked) : null;
      if (h !== null) {
        summary.total_present++; summary.total_hours += h;
        if (h >= 8) summary.full_day++;
        else if (h >= 4) summary.half_day++;
        else summary.short_day++;
      } else if (r.punch_in_time) {
        summary.total_present++; summary.pending_out++;
      }
    });

    const months = await pool.query(
      `SELECT DISTINCT month_year FROM attendance_logs WHERE emp_id=$1 ORDER BY month_year DESC`,
      [emp.emp_id]
    );

    res.render('emp-report', {
      employee: req.session.employee,
      logs: logs.rows,
      summary,
      months: months.rows.map(r => r.month_year),
      selected_month: month_year || '',
      formatTimeHHMM,
      formatDateDMY
    });
  } catch (err) {
    res.render('emp-report', {
      employee: req.session.employee, logs: [], summary: {},
      months: [], selected_month: '', error: err.message,
      formatTimeHHMM, formatDateDMY
    });
  }
});

// Mount employee router
app.use('/emp', empRouter);

// ── HR ROUTES ─────────────────────────────────────────────────────────────────
app.use('/hr', hrRouter);

// ── ROOT REDIRECT ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session.employee) return res.redirect('/emp/attendance');
  if (req.session.hr) return res.redirect('/hr/dashboard');
  res.redirect('/emp/login');
});

// ── GLOBAL API SESSION (legacy compat) ───────────────────────────────────────
app.get('/api/session', (req, res) => {
  res.json({
    authenticated: !!(req.session.employee || req.session.hr),
    employee: req.session.employee || null,
    hr: req.session.hr || null
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send(`
    <div style="font-family:sans-serif;text-align:center;padding:80px;color:#555">
      <h2 style="font-size:28px">404 — Not Found</h2>
      <p style="margin-top:14px">
        <a href="/emp/login" style="color:#2d6a4f;text-decoration:none;font-weight:600">← Employee Portal</a>
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <a href="/hr/login"  style="color:#c94a2b;text-decoration:none;font-weight:600">HR Admin →</a>
      </p>
    </div>
  `);
});

// ── BOOT ──────────────────────────────────────────────────────────────────────
async function start() {
  await initDB();

  // Schedule midnight auto punch-out
  cron.schedule('0 0 * * *', async () => {
    try {
      const todayKey = getLocalDateKey();
      const pending = await pool.query(
        `SELECT id, emp_id, emp_email, date FROM attendance_logs
          WHERE punch_in_time IS NOT NULL AND punch_out_time IS NULL AND date < $1`,
        [todayKey]
      );
      for (const r of pending.rows) {
        const closeTime = `${r.date} 23:59:59.000`;
        await pool.query(
          `UPDATE attendance_logs SET status='Auto Punch Out', punch_out_time=$2, out_location=$3 WHERE id=$1`,
          [r.id, closeTime, 'System Auto Punch-Out']
        );
      }
      if (pending.rows.length) console.log(`✅ Auto punch-out: ${pending.rows.length} record(s)`);
    } catch (err) {
      console.error('Auto punch-out error:', err.message);
    }
  }, { timezone: TIME_ZONE });

  app.listen(PORT, () => {
    console.log(`\n🚀 IED HRMS running → http://localhost:${PORT}`);
    console.log(`   ├─ Employee Login : /emp/login`);
    console.log(`   ├─ HR Dashboard   : /hr/dashboard`);
    console.log(`   └─ First HR setup : /hr/setup  (key: IED@2024)\n`);
  });
}

start().catch(err => { console.error('Startup error:', err); process.exit(1); });

module.exports = app;