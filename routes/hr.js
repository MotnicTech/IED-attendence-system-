// routes/hr.js — HR admin: login, dashboard, employee management, Excel export (SMTP Reloaded)
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const path = require('path');
const { pool } = require('../db');
const { requireHR } = require('../middleware/auth');

// ─── TIME UTILS (inline — no external util file needed) ───────────────────────
const TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

function getZonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  return parts.reduce((a, p) => { if (p.type !== 'literal') a[p.type] = p.value; return a; }, {});
}

function formatDateDMY(value) {
  if (!value) return '—';
  const text = String(value);
  const datePart = text.includes('T') ? text.split('T')[0] : text.split(' ')[0];
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return text;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[parseInt(month, 10) - 1] || month} ${year}`;
}

function formatTimeHHMM(value) {
  if (!value) return null;
  const text = String(value);
  const timePart = text.includes('T') ? text.split('T')[1] : (text.split(' ')[1] || text);
  return timePart.slice(0, 5);
}

function getMonthYearKey(date = new Date()) {
  const z = getZonedParts(date);
  return `${z.month}/${String(z.year).slice(2)}`;
}

// ─── MAIL DISPATCH (Nodemailer Welcome Mail) ───────────────────────────
async function sendWelcomeEmail(employee) {
  const { name, email, emp_id, pin } = employee;

  // Temporarily disabled welcome email dispatch as per user request
  return { success: false, message: 'SMTP settings not configured.' };

  try {
    // 2. Create Nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_PORT === '465', // true for 465, false for others
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const logoPath = path.join(__dirname, '../public/images/IED_LOGO.jpg');

    // 3. Compile HTML Template
    const htmlBody = `
      <div style="background-color: #f5f0e8; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px 20px; text-align: center;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e0d9ce; box-shadow: 0 4px 24px rgba(0,0,0,0.06); overflow: hidden; text-align: left;">
          
          <!-- Header Banner -->
          <div style="background-color: #0f1923; padding: 30px; text-align: center;">
            <img src="cid:ied_logo" alt="IED Logo" style="height: 60px; width: auto; max-width: 200px; border-radius: 8px; background-color: rgba(255,255,255,0.1); padding: 4px;" />
            <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 16px 0 0 0; letter-spacing: -0.5px;">Welcome to IED HRMS</h1>
          </div>
          
          <!-- Body Content -->
          <div style="padding: 40px 30px; color: #0f1923; line-height: 1.6;">
            <h2 style="font-size: 18px; font-weight: 700; color: #c94a2b; margin: 0 0 16px 0;">Hello ${name},</h2>
            <p style="font-size: 14px; margin: 0 0 20px 0; color: #4b5563;">Your employee account has been created on the <strong>IED Attendance & HRMS Portal</strong>. You can now use your credentials to log in and mark your attendance.</p>
            
            <!-- Credentials Box -->
            <div style="background-color: #fcfbf9; border: 1.5px dashed #d4a843; border-radius: 12px; padding: 24px; margin: 24px 0;">
              <h3 style="font-size: 13px; font-weight: 700; text-transform: uppercase; color: #d4a843; margin: 0 0 16px 0; letter-spacing: 0.8px;">Your Credentials</h3>
              
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="padding: 6px 0; color: #7a7166; font-weight: 500; width: 120px;">Employee ID:</td>
                  <td style="padding: 6px 0; color: #0f1923; font-weight: 700; font-family: monospace; font-size: 16px;">${emp_id}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #7a7166; font-weight: 500;">Secure Login PIN:</td>
                  <td style="padding: 6px 0; color: #c94a2b; font-weight: 700; font-family: monospace; font-size: 18px; letter-spacing: 2px;">${pin}</td>
                </tr>
              </table>
            </div>
            
            <p style="font-size: 13px; margin: 0 0 24px 0; color: #7a7166; font-style: italic;">Note: Please keep your login PIN secure and do not share it with anyone.</p>
            
            <!-- Action Button -->
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://ied-attendence-system-2bkz.onrender.com/emp/login" target="_blank" style="background-color: #c94a2b; color: #ffffff; padding: 14px 28px; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 10px; display: inline-block; transition: background 0.2s;">
                👉 Open Employee Login Portal
              </a>
            </div>
            
            <hr style="border: 0; border-top: 1px solid #e0d9ce; margin: 30px 0;" />
            
            <p style="font-size: 12px; color: #7a7166; margin: 0; text-align: center;">This is an automated email from the IED HRMS System. Please do not reply to this mail.</p>
          </div>
          
        </div>
      </div>
    `;

    // 4. Send Email
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `"IED HRMS" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Welcome to IED HRMS — Your Account Credentials',
      html: htmlBody,
      attachments: [{
        filename: 'IED_LOGO.jpg',
        path: logoPath,
        cid: 'ied_logo' // inline cid reference
      }]
    });

    console.log(`✉️ Welcome email successfully sent to ${email}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ Welcome email sending failed for ${email}:`, err.message);
    return { success: false, error: err.message };
  }
}

// EMP ID generator: IED_01, IED_02, ...
async function generateEmpId() {
  const result = await pool.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(emp_id, '\\D', '', 'g'), '')::int), 0) + 1 AS next_id
       FROM employees
      WHERE emp_id ~ '^IED_\\d+$'`
  );
  const nextId = parseInt(result.rows[0].next_id, 10) || 1;
  return `IED_${String(nextId).padStart(2, '0')}`;
}

// Random numeric PIN
function generatePin(length = 6) {
  let pin = '';
  for (let i = 0; i < length; i++) pin += Math.floor(Math.random() * 10);
  return pin;
}

// Working days in a MM/YY month (exclude Sundays)
function workingDaysInMonth(monthYear) {
  if (!monthYear || !monthYear.includes('/')) return 26;
  const [mm, yy] = monthYear.split('/');
  const year = parseInt('20' + yy, 10);
  const month = parseInt(mm, 10) - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let working = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month, d).getDay() !== 0) working++;
  }
  return working;
}

function parseDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value).trim();
  const datePart = text.includes('T') ? text.split('T')[0] : text.split(' ')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function countWorkingDaysBetween(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end || start > end) return 0;

  let count = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endNormalized = new Date(end);
  endNormalized.setHours(0, 0, 0, 0);

  while (cursor <= endNormalized) {
    if (cursor.getDay() !== 0) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function getReportRange(dateFrom, dateTo) {
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = parseDateKey(dateFrom) || currentMonthStart;
  const end = parseDateKey(dateTo) || today;
  return {
    startKey: formatDateKey(start),
    endKey: formatDateKey(end),
    totalDays: countWorkingDaysBetween(start, end)
  };
}

function buildEmployeeSummary(rows, employeesRows, totalDays) {
  const map = new Map();
  for (const employee of employeesRows || []) {
    const key = employee.emp_id || employee.email;
    if (!key) continue;
    map.set(key, {
      emp_id: employee.emp_id || '—',
      emp_name: employee.name || '—',
      has_pin: !!employee.has_pin,
      email: employee.email || '—',
      total_days: totalDays,
      present: 0,
      absent: totalDays,
      pending_out: 0
    });
  }

  for (const row of rows) {
    const key = row.emp_id || row.emp_email;
    if (!key) continue;
    if (!map.has(key)) {
      continue; // Skip logs of inactive/deleted employees
    }
    const item = map.get(key);
    if (row.punch_in_time || row.punch_out_time) {
      item.present += 1;
      if (row.punch_in_time && !row.punch_out_time) item.pending_out += 1;
    }
  }

  for (const item of map.values()) {
    item.absent = Math.max(0, item.total_days - item.present);
  }

  return Array.from(map.values()).sort((a, b) => a.emp_name.localeCompare(b.emp_name));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HR LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/login', (req, res) => {
  if (req.session.hr) return res.redirect('/hr/dashboard');
  res.render('hr-login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM hr_users WHERE email=$1', [email.trim().toLowerCase()]);
    if (!r.rows.length) return res.render('hr-login', { error: 'Invalid email or password.' });
    const ok = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!ok) return res.render('hr-login', { error: 'Invalid email or password.' });
    req.session.hr = { id: r.rows[0].id, email: r.rows[0].email, name: r.rows[0].name };
    res.redirect('/hr/dashboard');
  } catch (err) {
    res.render('hr-login', { error: 'Database error: ' + err.message });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/hr/login'));
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD — attendance register with filters
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/dashboard', requireHR, async (req, res) => {
  let { date_from, date_to, emp_email, emp_id } = req.query;

  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!date_from) {
    date_from = formatDateKey(currentMonthStart);
  }
  if (!date_to) {
    date_to = formatDateKey(today);
  }

  const params = [];
  let where = 'WHERE 1=1';
  if (date_from) { params.push(date_from); where += ` AND a.date >= $${params.length}`; }
  if (date_to) { params.push(date_to); where += ` AND a.date <= $${params.length}`; }
  if (emp_email) { params.push(`%${emp_email}%`); where += ` AND a.emp_email ILIKE $${params.length}`; }
  if (emp_id) { params.push(`%${emp_id}%`); where += ` AND a.emp_id ILIKE $${params.length}`; }

  const reportRange = getReportRange(date_from, date_to);

  try {
    // Only include attendance rows that map to an existing employee record
    const records = await pool.query(
      `SELECT a.*,
              e.name        AS emp_name,
              e.department,
              e.designation,
              CASE
                WHEN a.punch_in_time IS NOT NULL AND a.punch_out_time IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (
                       a.punch_out_time::TIMESTAMP - a.punch_in_time::TIMESTAMP
                     ))/3600, 2)
                ELSE NULL
              END AS hours_worked
         FROM attendance_logs a
         INNER JOIN employees e
           ON e.emp_id = a.emp_id
          OR LOWER(e.email) = LOWER(a.emp_email)
         ${where}
         ORDER BY a.date DESC, a.emp_email ASC
         LIMIT 500`,
      params
    );

    const employees = await pool.query(
      `SELECT emp_id, name, email, (pin_hash IS NOT NULL) AS has_pin FROM employees ORDER BY name`
    );

    const employeeSummary = buildEmployeeSummary(records.rows, employees.rows, reportRange.totalDays);

    const summary = await pool.query(
      `SELECT
         COUNT(*)                                                                            AS total_records,
         COUNT(*) FILTER (WHERE a.punch_in_time IS NOT NULL AND a.punch_out_time IS NOT NULL) AS complete,
         COUNT(*) FILTER (WHERE a.punch_in_time IS NOT NULL AND a.punch_out_time IS NULL)     AS pending_out,
         COUNT(DISTINCT a.emp_email)                                                         AS unique_employees
         FROM attendance_logs a
         INNER JOIN employees e
           ON e.emp_id = a.emp_id
          OR LOWER(e.email) = LOWER(a.emp_email)
         ${where}`,
      params
    );

    // Build the Daily Grid (All active employees mapped daily)
    const start = parseDateKey(reportRange.startKey);
    const end = parseDateKey(reportRange.endKey);
    const dates = [];
    if (start && end) {
      const cursor = new Date(start);
      while (cursor <= end) {
        dates.push(formatDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    dates.reverse(); // latest date first

    const empParams = [];
    let empWhere = 'WHERE is_active = TRUE';
    if (emp_email) {
      empParams.push(`%${emp_email}%`);
      empWhere += ` AND email ILIKE $${empParams.length}`;
    }
    if (emp_id) {
      empParams.push(`%${emp_id}%`);
      empWhere += ` AND emp_id ILIKE $${empParams.length}`;
    }
    const targetEmployees = await pool.query(
      `SELECT emp_id, name, email FROM employees ${empWhere} ORDER BY name`,
      empParams
    );

    const logsMap = new Map();
    for (const r of records.rows) {
      const dKey = r.date ? (r.date instanceof Date ? formatDateKey(r.date) : String(r.date).split('T')[0].split(' ')[0]) : '';
      const eId = (r.emp_id || '').trim().toUpperCase();
      const eEmail = (r.emp_email || '').trim().toLowerCase();
      if (dKey && eId) logsMap.set(`${dKey}__id__${eId}`, r);
      if (dKey && eEmail) logsMap.set(`${dKey}__email__${eEmail}`, r);
    }

    const dailyGrid = [];
    for (const dKey of dates) {
      const dateObj = parseDateKey(dKey);
      const isSunday = dateObj && dateObj.getDay() === 0;

      for (const emp of targetEmployees.rows) {
        const eId = (emp.emp_id || '').trim().toUpperCase();
        const eEmail = (emp.email || '').trim().toLowerCase();

        const log = logsMap.get(`${dKey}__id__${eId}`) || logsMap.get(`${dKey}__email__${eEmail}`);
        if (log) {
          dailyGrid.push(log);
        } else {
          dailyGrid.push({
            date: dKey,
            emp_id: emp.emp_id,
            emp_name: emp.name,
            email: emp.email,
            status: isSunday ? 'Weekly Off' : 'Absent',
            punch_in_time: null,
            punch_out_time: null,
            in_location: null,
            in_map_link: null,
            out_location: null,
            out_map_link: null,
            hours_worked: null
          });
        }
      }
    }

    // If a PIN was just generated via reset-pin->redirect, surface it once and clear
    const newPinInfo = req.session.newPinInfo || null;
    if (req.session.newPinInfo) delete req.session.newPinInfo;

    res.render('hr-dashboard', {
      hr: req.session.hr,
      records: records.rows,
      employeeSummary,
      dailyGrid,
      reportRange,
      summary: summary.rows[0],
      filters: { date_from: date_from || '', date_to: date_to || '', emp_email: emp_email || '', emp_id: emp_id || '' },
      newPinInfo,
      formatTimeHHMM,
      formatDateDMY
    });
  } catch (err) {
    res.render('hr-dashboard', {
      hr: req.session.hr, records: [],
      employeeSummary: [],
      dailyGrid: [],
      reportRange,
      filters: { date_from: '', date_to: '', emp_email: '', emp_id: '' },
      summary: { total_records: 0, complete: 0, pending_out: 0, unique_employees: 0 },
      dbError: err.message, formatTimeHHMM, formatDateDMY
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  EMPLOYEE LIST
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/employees', requireHR, async (req, res) => {
  try {
    const emps = await pool.query('SELECT * FROM employees ORDER BY created_at DESC');
    res.render('hr-employees', { hr: req.session.hr, employees: emps.rows, message: null, error: null });
  } catch (err) {
    res.render('hr-employees', { hr: req.session.hr, employees: [], message: null, error: err.message });
  }
});

// ── ADD EMPLOYEE ───────────────────────────────────────────────────────────────
router.post('/employees/add', requireHR, async (req, res) => {
  const { name, email, phone, department, designation, custom_pin } = req.body;

  async function rerender(message, error, newEmp) {
    const emps = await pool.query('SELECT * FROM employees ORDER BY created_at DESC').catch(() => ({ rows: [] }));
    return res.render('hr-employees', { hr: req.session.hr, employees: emps.rows, message, error, newEmp });
  }

  try {
    const emailLower = email.trim().toLowerCase();
    const dup = await pool.query('SELECT id FROM employees WHERE email=$1', [emailLower]);
    if (dup.rows.length) return rerender(null, 'An employee with this email already exists.', null);

    const emp_id = await generateEmpId();
    const pin = (custom_pin && custom_pin.trim().length >= 4) ? custom_pin.trim() : generatePin(6);
    const pinHash = await bcrypt.hash(pin, 10);

    await pool.query(
      `INSERT INTO employees (emp_id, name, email, phone, department, designation, pin_hash, pin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [emp_id, name.trim(), emailLower, phone || null, department || null, designation || null, pinHash, pin]
    );

    const mailResult = await sendWelcomeEmail({ name: name.trim(), email: emailLower, emp_id, pin });
    let successMsg = `✅ Employee added successfully!`;
    if (mailResult.success) {
      successMsg += ` Credentials emailed to ${emailLower}.`;
    } else if (mailResult.error) {
      successMsg += ` (Welcome email failed: ${mailResult.error})`;
    }

    return rerender(
      successMsg,
      null,
      { emp_id, pin, name: name.trim(), email: emailLower }
    );
  } catch (err) {
    return rerender(null, err.message, null);
  }
});

// ── RESET PIN ──────────────────────────────────────────────────────────────────
router.post('/employees/reset-pin', requireHR, async (req, res) => {
  const { emp_id } = req.body;
  try {
    const newPin = generatePin(6);
    const pinHash = await bcrypt.hash(newPin, 10);
    await pool.query('UPDATE employees SET pin_hash=$1, pin=$2 WHERE emp_id=$3', [pinHash, newPin, emp_id]);
    // If caller requested a redirect (e.g. back to dashboard), stash the pin in session and redirect
    const returnTo = req.body.return_to || req.query.return_to;
    if (returnTo) {
      req.session.newPinInfo = { emp_id, pin: newPin };
      return res.redirect(returnTo);
    }
    const emps = await pool.query('SELECT * FROM employees ORDER BY created_at DESC');
    res.render('hr-employees', {
      hr: req.session.hr, employees: emps.rows, error: null,
      message: `🔑 PIN reset for ${emp_id}.`,
      newEmp: { emp_id, pin: newPin }
    });
  } catch (err) {
    const emps = await pool.query('SELECT * FROM employees ORDER BY created_at DESC').catch(() => ({ rows: [] }));
    res.render('hr-employees', { hr: req.session.hr, employees: emps.rows, message: null, error: err.message });
  }
});

// ── TOGGLE ACTIVE ──────────────────────────────────────────────────────────────
router.post('/employees/toggle', requireHR, async (req, res) => {
  await pool.query('UPDATE employees SET is_active = NOT is_active WHERE emp_id=$1', [req.body.emp_id]);
  res.redirect('/hr/employees');
});

// ── DELETE EMPLOYEE ────────────────────────────────────────────────────────────
router.post('/employees/delete', requireHR, async (req, res) => {
  await pool.query('DELETE FROM employees WHERE emp_id=$1', [req.body.emp_id]);
  res.redirect('/hr/employees');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  EXCEL EXPORT — 3 sheets: Attendance Register | Monthly Summary | Employee Master
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/export', requireHR, async (req, res) => {
  let { date_from, date_to, emp_email, emp_id } = req.query;

  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!date_from) {
    date_from = formatDateKey(currentMonthStart);
  }
  if (!date_to) {
    date_to = formatDateKey(today);
  }

  const params = [];
  let where = 'WHERE 1=1';
  if (date_from) { params.push(date_from); where += ` AND a.date >= $${params.length}`; }
  if (date_to) { params.push(date_to); where += ` AND a.date <= $${params.length}`; }
  if (emp_email) { params.push(`%${emp_email}%`); where += ` AND a.emp_email ILIKE $${params.length}`; }
  if (emp_id) { params.push(`%${emp_id}%`); where += ` AND a.emp_id ILIKE $${params.length}`; }
  const reportRange = getReportRange(date_from, date_to);

  try {
    const emps = await pool.query(
      `SELECT emp_id, name, email, phone, department, designation, is_active, joined_date
         FROM employees ORDER BY emp_id`
    );

    const result = await pool.query(
      `SELECT a.*,
              e.name AS emp_name, e.department, e.designation, e.phone,
              CASE
                WHEN a.punch_in_time IS NOT NULL AND a.punch_out_time IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (
                       a.punch_out_time::TIMESTAMP - a.punch_in_time::TIMESTAMP
                     ))/3600, 2)
                ELSE NULL
              END AS hours_worked
         FROM attendance_logs a
         INNER JOIN employees e
           ON e.emp_id = a.emp_id
          OR LOWER(e.email) = LOWER(a.emp_email)
         ${where}
         ORDER BY a.date ASC, a.emp_email ASC`,
      params
    );

    const wb = XLSX.utils.book_new();

    // ── SHEET 1: Attendance Register ─────────────────────────────────────────
    const h1 = [
      'Sr.', 'Emp ID', 'Employee Name', 'Email', 'Department', 'Designation',
      'Date', 'Month', 'Day of Week',
      'Punch IN', 'In Location', 'In Lat', 'In Lng', 'In Map Link',
      'Punch OUT', 'Out Location', 'Out Lat', 'Out Lng', 'Out Map Link',
      'Hours Worked', 'Day Status'
    ];

    const rows1 = result.rows.map((r, i) => {
      const h = r.hours_worked ? parseFloat(r.hours_worked) : null;
      const dateObj = r.date ? new Date(String(r.date).split('T')[0] + 'T00:00:00') : null;
      const dayName = dateObj ? dateObj.toLocaleDateString('en-IN', { weekday: 'long' }) : '';
      const dayStatus = h !== null
        ? (h >= 8 ? 'Full Day' : h >= 4 ? 'Half Day' : 'Short Day')
        : (r.punch_in_time ? 'Not Punched Out' : 'Absent');

      return [
        i + 1,
        r.emp_id || '—',
        r.emp_name || '—',
        r.emp_email,
        r.department || '—',
        r.designation || '—',
        formatDateDMY(r.date),
        r.month_year || '',
        dayName,
        formatTimeHHMM(r.punch_in_time) || '—',
        r.in_location || '—',
        r.in_latitude ? parseFloat(r.in_latitude) : '',
        r.in_longitude ? parseFloat(r.in_longitude) : '',
        r.in_map_link || '',
        formatTimeHHMM(r.punch_out_time) || '—',
        r.out_location || '—',
        r.out_latitude ? parseFloat(r.out_latitude) : '',
        r.out_longitude ? parseFloat(r.out_longitude) : '',
        r.out_map_link || '',
        h !== null ? `${h.toFixed(2)} hrs` : '—',
        dayStatus
      ];
    });

    const ws1 = XLSX.utils.aoa_to_sheet([h1, ...rows1]);
    ws1['!cols'] = [
      { wch: 5 }, { wch: 15 }, { wch: 22 }, { wch: 30 }, { wch: 16 }, { wch: 18 },
      { wch: 14 }, { wch: 8 }, { wch: 14 },
      { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 42 },
      { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 42 },
      { wch: 14 }, { wch: 16 }
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Attendance Register');

    // ── SHEET 2: Monthly Summary ─────────────────────────────────────────────
    const empMonthMap = {};
    result.rows.forEach(r => {
      const key = `${r.emp_id || r.emp_email}__${r.month_year}`;
      if (!empMonthMap[key]) {
        empMonthMap[key] = {
          emp_id: r.emp_id || '—',
          emp_name: r.emp_name || '—',
          email: r.emp_email,
          department: r.department || '—',
          month: r.month_year || '—',
          total_working: workingDaysInMonth(r.month_year),
          present: 0, full_day: 0, half_day: 0, short_day: 0,
          pending_out: 0, total_hours: 0
        };
      }
      const m = empMonthMap[key];
      const h = r.hours_worked ? parseFloat(r.hours_worked) : null;
      if (h !== null) {
        m.present++; m.total_hours += h;
        if (h >= 8) m.full_day++;
        else if (h >= 4) m.half_day++;
        else m.short_day++;
      } else if (r.punch_in_time) {
        m.present++; m.pending_out++;
      }
    });

    const h2 = [
      'Emp ID', 'Employee Name', 'Email', 'Department', 'Month',
      'Total Working Days', 'Present Days', 'Full Day (≥8h)', 'Half Day (4-8h)',
      'Short Day (<4h)', 'Pending OUT', 'Absent Days',
      'Total Hours Worked', 'Avg Hours/Day'
    ];
    const rows2 = Object.values(empMonthMap).map(m => {
      const absent = Math.max(0, m.total_working - m.present);
      const avgHrs = m.present > 0 ? (m.total_hours / m.present).toFixed(2) : '0.00';
      return [
        m.emp_id, m.emp_name, m.email, m.department, m.month,
        m.total_working, m.present, m.full_day, m.half_day,
        m.short_day, m.pending_out, absent,
        m.total_hours.toFixed(2) + ' hrs', avgHrs + ' hrs'
      ];
    });

    const ws2 = XLSX.utils.aoa_to_sheet([h2, ...rows2]);
    ws2['!cols'] = [
      { wch: 15 }, { wch: 22 }, { wch: 30 }, { wch: 16 }, { wch: 8 },
      { wch: 18 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 13 }, { wch: 12 },
      { wch: 18 }, { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Monthly Summary');

    // ── SHEET 3: Attendance Report ───────────────────────────────────────────
    const summaryMap = {};
    emps.rows.forEach(e => {
      summaryMap[e.emp_id || e.email] = {
        emp_id: e.emp_id || '—',
        emp_name: e.name || '—',
        email: e.email,
        total_days: reportRange.totalDays,
        present: 0,
        absent: reportRange.totalDays
      };
    });
    result.rows.forEach(r => {
      const key = `${r.emp_id || r.emp_email}`;
      if (summaryMap[key]) {
        const item = summaryMap[key];
        if (r.punch_in_time || r.punch_out_time) {
          item.present++;
        }
      }
    });

    const summaryRows = Object.values(summaryMap).map(item => {
      item.absent = Math.max(0, item.total_days - item.present);
      return [item.emp_id, item.emp_name, item.email, item.total_days, item.present, item.absent];
    }).sort((a, b) => String(a[1]).localeCompare(String(b[1])));

    const hSummary = ['Emp ID', 'Employee Name', 'Email', 'Total Days', 'Present Days', 'Absent Days'];
    const wsSummary = XLSX.utils.aoa_to_sheet([hSummary, ...summaryRows]);
    wsSummary['!cols'] = [{ wch: 15 }, { wch: 22 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Attendance Report');

    // ── SHEET 4: Employee Master ─────────────────────────────────────────────
    const h3 = ['Emp ID', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Status', 'Joined Date'];
    const rows3 = emps.rows.map(e => [
      e.emp_id, e.name, e.email, e.phone || '', e.department || '', e.designation || '',
      e.is_active ? 'Active' : 'Inactive',
      formatDateDMY(e.joined_date)
    ]);
    const ws3 = XLSX.utils.aoa_to_sheet([h3, ...rows3]);
    ws3['!cols'] = [{ wch: 15 }, { wch: 22 }, { wch: 30 }, { wch: 15 }, { wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Employee Master');

    // ── Send file ─────────────────────────────────────────────────────────────
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fname = `IED_HRMS_Attendance_${date_from || 'all'}_to_${date_to || 'all'}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).send('Export error: ' + err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FIRST-TIME HR SETUP
// ═══════════════════════════════════════════════════════════════════════════════
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
  if (setup_key !== (process.env.HR_SETUP_KEY || 'IED@2024'))
    return res.render('hr-setup', { error: 'Invalid setup key.', success: null });
  try {
    const r = await pool.query('SELECT COUNT(*) FROM hr_users');
    if (parseInt(r.rows[0].count) > 0)
      return res.send('<h2>Already done. <a href="/hr/login">Login</a></h2>');
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO hr_users (name, email, password_hash) VALUES ($1,$2,$3)',
      [name.trim(), email.trim().toLowerCase(), hash]
    );
    res.render('hr-setup', { error: null, success: 'HR account created! <a href="/hr/login">Login now</a>' });
  } catch (err) {
    res.render('hr-setup', { error: err.message, success: null });
  }
});

// ═══════════════════════════════════════
// DRIVER MANAGEMENT
// ═══════════════════════════════════════

router.get('/drivers', requireHR, async (req, res) => {

  const {
    from_date,
    to_date,
    driver_id,
    mobile
  } = req.query;

  let where = "WHERE 1=1";
  const params = [];

  if (from_date) {
    params.push(from_date);
    where += ` AND da.date >= $${params.length}`;
  }

  if (to_date) {
    params.push(to_date);
    where += ` AND da.date <= $${params.length}`;
  }

  if (driver_id) {
    params.push(`%${driver_id}%`);
    where += ` AND d.driver_code ILIKE $${params.length}`;
  }

  if (mobile) {
    params.push(`%${mobile}%`);
    where += ` AND d.mobile ILIKE $${params.length}`;
  }

  try {

    const drivers = await pool.query(`
SELECT *
FROM drivers
ORDER BY id DESC
`);

    const attendance = await pool.query(
      `
SELECT
da.*,
d.driver_code,
d.name,
d.mobile,
COALESCE(
EXTRACT(HOUR FROM da.total_hours)::INT || ' hrs ' ||
EXTRACT(MINUTE FROM da.total_hours)::INT || ' mins',
'-'
) AS total_hours_display
FROM driver_attendance da
JOIN drivers d
ON d.id=da.driver_id
${where}
ORDER BY da.date DESC,da.id DESC
`,
      params
    );

    const stats = await pool.query(`
SELECT
(SELECT COUNT(*) FROM drivers WHERE is_active=TRUE) total_drivers,
(SELECT COUNT(*) FROM driver_attendance WHERE date=CURRENT_DATE) today_attendance,
(SELECT COALESCE(SUM(total_km),0)
FROM driver_attendance
WHERE date=CURRENT_DATE) today_km
`);

    res.render("Driver-Data", {
      hr: req.session.hr,
      drivers: drivers.rows,
      attendance: attendance.rows,
      stats: stats.rows[0],
      success: null,
      error: null,
      filters: {
        from_date: from_date || "",
        to_date: to_date || "",
        driver_id: driver_id || "",
        mobile: mobile || ""
      }
    });

  } catch (err) {

    console.error(err);

    res.render("Driver-Data", {
      hr: req.session.hr,
      drivers: [],
      attendance: [],
      stats: {
        total_drivers: 0,
        today_attendance: 0,
        today_km: 0
      },
      success: null,
      error: err.message,
      filters: {
        from_date: from_date || "",
        to_date: to_date || "",
        driver_id: driver_id || "",
        mobile: mobile || ""
      }
    });

  }

});

// EXPORT CSV
router.get('/drivers/export/csv', requireHR, async (req, res) => {
  const data = await pool.query(`
    SELECT
      da.date,
      da.day,
      d.driver_code,
      d.name,
      da.punch_in_time,
      da.punch_out_time,
      da.start_km,
      da.end_km,
      da.total_km
    FROM driver_attendance da
    JOIN drivers d
      ON d.id=da.driver_id
    ORDER BY da.date DESC
  `);

  let csv =
    `Date,Day,Driver Code,Name,Punch In,Punch Out,Start KM,End KM,Total KM\n`;

  data.rows.forEach(r => {
    csv +=
      `${r.date},${r.day},${r.driver_code},${r.name},${r.punch_in_time},${r.punch_out_time},${r.start_km},${r.end_km},${r.total_km}\n`;
  });

  res.header('Content-Type', 'text/csv');
  res.attachment('driver-report.csv');
  res.send(csv);
});



// ===============================
// ADD NEW DRIVER
// ===============================
router.post('/drivers/add', requireHR, async (req, res) => {

  const { name, mobile } = req.body;

  try {

    // Generate Next Driver Code
    const next = await pool.query(`
      SELECT
      COALESCE(
        MAX(
          NULLIF(
            regexp_replace(driver_code,'\\D','','g'),
            ''
          )::INT
        ),
        0
      ) + 1 AS next_id
      FROM drivers
    `);

    const driverCode =
      `DRV_${String(next.rows[0].next_id).padStart(2, '0')}`;

    // Generate Password
    const password =
      Math.random()
        .toString(36)
        .slice(-8)
        .toUpperCase();

    // Hash Password
    const hash =
      await bcrypt.hash(password, 10);

    // Insert Driver
    await pool.query(`
      INSERT INTO drivers
      (
        driver_code,
        name,
        mobile,
        password_hash,
        password
      )
      VALUES
      ($1,$2,$3,$4,$5)
    `, [
      driverCode,
      name,
      mobile,
      hash,
      password
    ]);

    res.redirect('/hr/drivers');

  }
  catch (err) {

    console.error(err);

    res.send(err.message);

  }

});

// ===============================
// RESET DRIVER PASSWORD
// ===============================
router.post('/drivers/reset-password/:id', requireHR, async (req, res) => {

  try {

    const password =
      Math.random()
        .toString(36)
        .slice(-8)
        .toUpperCase();

    const hash =
      await bcrypt.hash(password, 10);

    await pool.query(
      `UPDATE drivers
SET password=$1,
password_hash=$2
WHERE id=$3`,
      [
        password,
        hash,
        req.params.id
      ]
    );

    res.redirect('/hr/drivers');

  } catch (err) {

    console.error(err);
    res.send(err.message);

  }

});

// ===============================
// DISABLE DRIVER
// ===============================
router.post('/drivers/disable/:id', requireHR, async (req, res) => {

  try {

    await pool.query(
      `UPDATE drivers
SET is_active=FALSE
WHERE id=$1`,
      [
        req.params.id
      ]
    );

    res.redirect('/hr/drivers');

  } catch (err) {

    console.error(err);
    res.send(err.message);

  }

});

// ===============================
// ENABLE DRIVER
// ===============================
router.post('/drivers/enable/:id', requireHR, async (req, res) => {

  try {

    await pool.query(
      `UPDATE drivers
SET is_active=TRUE
WHERE id=$1`,
      [
        req.params.id
      ]
    );

    res.redirect('/hr/drivers');

  } catch (err) {

    console.error(err);
    res.send(err.message);

  }

});

// ===============================
// DELETE DRIVER
// ===============================
router.post('/drivers/delete/:id', requireHR, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete related route logs
    await client.query('DELETE FROM driver_route_logs WHERE driver_id=$1', [req.params.id]);

    // Delete related attendance records
    await client.query('DELETE FROM driver_attendance WHERE driver_id=$1', [req.params.id]);

    // Delete driver
    await client.query('DELETE FROM drivers WHERE id=$1', [req.params.id]);

    await client.query('COMMIT');
    res.redirect('/hr/drivers');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.send(err.message);
  } finally {
    client.release();
  }
});

// ==========================================
// DRIVER ROUTE VIEW
// ==========================================

router.get('/drivers/route/:id', requireHR, async (req, res) => {

  try {

    const attendanceId = req.params.id;

    const attendance = await pool.query(
      `
SELECT
da.*,
d.name,
d.driver_code,
COALESCE(
EXTRACT(HOUR FROM da.total_hours)::INT || ' hrs ' ||
EXTRACT(MINUTE FROM da.total_hours)::INT || ' mins',
'-'
) AS total_hours_display
FROM driver_attendance da
JOIN drivers d
ON d.id=da.driver_id
WHERE da.id=$1
`,
      [attendanceId]
    );

    if (!attendance.rows.length) {

      return res.send("Route not found.");

    }

    const points = await pool.query(
      `
SELECT
latitude,
longitude,
timestamp
FROM driver_route_logs
WHERE attendance_id=$1
ORDER BY timestamp
`,
      [attendanceId]
    );

    res.render("Driver-Route", {

      attendance: attendance.rows[0],
      points: points.rows

    });

  } catch (err) {

    console.error(err);

    res.send(err.message);

  }

});

module.exports = router;