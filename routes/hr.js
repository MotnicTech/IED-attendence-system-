const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const XLSX    = require('xlsx');
const { pool } = require('../db');
const { requireHR } = require('../middleware/auth');

// ── LOGIN ──────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.hr) return res.redirect('/hr/dashboard');
  res.render('hr-login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM hr_users WHERE email=$1', [email.trim().toLowerCase()]);
    if (!r.rows.length) return res.render('hr-login', { error: 'Invalid email or password' });
    const ok = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!ok) return res.render('hr-login', { error: 'Invalid email or password' });
    req.session.hr = { id: r.rows[0].id, email: r.rows[0].email, name: r.rows[0].name };
    res.redirect('/hr/dashboard');
  } catch (err) {
    res.render('hr-login', { error: 'Database error: ' + err.message });
  }
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/hr/login'); });

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
router.get('/dashboard', requireHR, async (req, res) => {
  const { date_from, date_to, emp_email } = req.query;
  const params = [];
  let where = 'WHERE 1=1';
  if (date_from) { params.push(date_from);          where += ` AND date >= $${params.length}`; }
  if (date_to)   { params.push(date_to);            where += ` AND date <= $${params.length}`; }
  if (emp_email) { params.push(`%${emp_email}%`);   where += ` AND emp_email ILIKE $${params.length}`; }

  try {
    const records = await pool.query(
      `SELECT *,
         CASE WHEN punch_in_time IS NOT NULL AND punch_out_time IS NOT NULL
              THEN ROUND(EXTRACT(EPOCH FROM (punch_out_time - punch_in_time))/3600, 2)
              ELSE NULL END AS hours_worked
       FROM attendance_logs ${where}
       ORDER BY date DESC, emp_email ASC LIMIT 500`, params);

    const summary = await pool.query(
      `SELECT
         COUNT(*) AS total_days,
         COUNT(*) FILTER (WHERE punch_in_time IS NOT NULL AND punch_out_time IS NOT NULL) AS complete,
         COUNT(*) FILTER (WHERE punch_in_time IS NOT NULL AND punch_out_time IS NULL) AS pending_out,
         COUNT(DISTINCT emp_email) AS unique_employees
       FROM attendance_logs ${where}`, params);

    res.render('hr-dashboard', {
      hr: req.session.hr,
      records: records.rows,
      summary: summary.rows[0],
      filters: { date_from: date_from||'', date_to: date_to||'', emp_email: emp_email||'' }
    });
  } catch (err) {
    res.render('hr-dashboard', {
      hr: req.session.hr, records: [], filters: { date_from:'', date_to:'', emp_email:'' },
      summary: { total_days:0, complete:0, pending_out:0, unique_employees:0 },
      dbError: err.message
    });
  }
});

// ── EXCEL EXPORT ──────────────────────────────────────────────────────────────
router.get('/export', requireHR, async (req, res) => {
  const { date_from, date_to, emp_email } = req.query;
  const params = [];
  let where = 'WHERE 1=1';
  if (date_from) { params.push(date_from);        where += ` AND date >= $${params.length}`; }
  if (date_to)   { params.push(date_to);          where += ` AND date <= $${params.length}`; }
  if (emp_email) { params.push(`%${emp_email}%`); where += ` AND emp_email ILIKE $${params.length}`; }

  try {
    const result = await pool.query(
      `SELECT *,
         CASE WHEN punch_in_time IS NOT NULL AND punch_out_time IS NOT NULL
              THEN ROUND(EXTRACT(EPOCH FROM (punch_out_time - punch_in_time))/3600, 2)
              ELSE NULL END AS hours_worked
       FROM attendance_logs ${where}
       ORDER BY date ASC, emp_email ASC`, params);

    const wb = XLSX.utils.book_new();

    // ── SHEET 1: Attendance Register (one row per emp per day) ────────────────
    const h1 = [
      'Sr.', 'Employee Email', 'Date', 'Month',
      'Punch In', 'In Location', 'In Lat', 'In Lng', 'In Map',
      'Punch Out', 'Out Location', 'Out Lat', 'Out Lng', 'Out Map',
      'Hours Worked', 'Day Status'
    ];

    const rows1 = result.rows.map((r, i) => {
      const inT  = r.punch_in_time  ? new Date(r.punch_in_time)  : null;
      const outT = r.punch_out_time ? new Date(r.punch_out_time) : null;
      const h    = r.hours_worked ? parseFloat(r.hours_worked) : null;
      const dayStatus = h !== null
        ? (h >= 8 ? 'Full Day' : h >= 4 ? 'Half Day' : 'Short')
        : (inT ? 'Not Punched Out' : '—');

      return [
        i + 1,
        r.emp_email,
        new Date(r.date).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}),
        r.month_year || '',
        inT  ? inT.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})  : '—',
        r.in_location  || '—',
        r.in_latitude  ? parseFloat(r.in_latitude)  : '',
        r.in_longitude ? parseFloat(r.in_longitude) : '',
        r.in_map_link  || '',
        outT ? outT.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—',
        r.out_location  || '—',
        r.out_latitude  ? parseFloat(r.out_latitude)  : '',
        r.out_longitude ? parseFloat(r.out_longitude) : '',
        r.out_map_link  || '',
        h !== null ? `${h.toFixed(2)} hrs` : '—',
        dayStatus
      ];
    });

    const ws1 = XLSX.utils.aoa_to_sheet([h1, ...rows1]);
    ws1['!cols'] = [
      {wch:5},{wch:32},{wch:14},{wch:8},
      {wch:12},{wch:16},{wch:10},{wch:10},{wch:42},
      {wch:12},{wch:16},{wch:10},{wch:10},{wch:42},
      {wch:13},{wch:15}
    ];
    // Style header row bold
    const range = XLSX.utils.decode_range(ws1['!ref']);
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: C });
      if (!ws1[addr]) continue;
      ws1[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E8F0FE' } } };
    }
    XLSX.utils.book_append_sheet(wb, ws1, 'Attendance Register');

    // ── SHEET 2: Employee-wise Monthly Summary ────────────────────────────────
    // Group by emp + month
    const empMonth = {};
    result.rows.forEach(r => {
      const key = `${r.emp_email}__${r.month_year}`;
      if (!empMonth[key]) empMonth[key] = {
        email: r.emp_email, month: r.month_year,
        total: 0, complete: 0, half: 0, short: 0, pending: 0,
        totalHours: 0
      };
      const m = empMonth[key];
      m.total++;
      const h = r.hours_worked ? parseFloat(r.hours_worked) : null;
      if (h !== null) {
        m.totalHours += h;
        if (h >= 8)     m.complete++;
        else if (h >= 4) m.half++;
        else             m.short++;
      } else if (r.punch_in_time) {
        m.pending++;
      }
    });

    const h2 = ['Employee Email','Month','Total Days','Full Day','Half Day','Short','Pending Out','Total Hours'];
    const rows2 = Object.values(empMonth).map(m => [
      m.email, m.month, m.total, m.complete, m.half, m.short, m.pending,
      m.totalHours.toFixed(2) + ' hrs'
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([h2, ...rows2]);
    ws2['!cols'] = [{wch:32},{wch:8},{wch:11},{wch:10},{wch:10},{wch:8},{wch:13},{wch:13}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Monthly Summary');

    // Send file
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fname = `IED_Attendance_${date_from||'all'}_to_${date_to||'all'}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).send('Export error: ' + err.message);
  }
});

// ── FIRST-TIME SETUP ──────────────────────────────────────────────────────────
router.get('/setup', async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*) FROM hr_users');
    if (parseInt(r.rows[0].count) > 0)
      return res.send('<h2>Setup already done. <a href="/hr/login">Login here</a></h2>');
    res.render('hr-setup', { error: null, success: null });
  } catch (err) {
    res.send(`<h2>DB Error: ${err.message}</h2><p>Make sure PostgreSQL is running.</p>`);
  }
});

router.post('/setup', async (req, res) => {
  const { name, email, password, setup_key } = req.body;
  if (setup_key !== 'IED@2024')
    return res.render('hr-setup', { error: 'Invalid setup key', success: null });
  try {
    const r = await pool.query('SELECT COUNT(*) FROM hr_users');
    if (parseInt(r.rows[0].count) > 0)
      return res.send('<h2>Already done. <a href="/hr/login">Login</a></h2>');
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO hr_users (name,email,password_hash) VALUES ($1,$2,$3)',
      [name, email.trim().toLowerCase(), hash]);
    res.render('hr-setup', { error: null, success: 'HR account created! <a href="/hr/login">Login now</a>' });
  } catch (err) {
    res.render('hr-setup', { error: err.message, success: null });
  }
});

module.exports = router;