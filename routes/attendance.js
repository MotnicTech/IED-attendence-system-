// routes/attendance.js
// Handles the legacy attendance page helpers used by the portal
// AND the new /emp/* PIN-based employee system.
// Both share the same attendance_logs table.

const express  = require('express');
const router   = express.Router();
const XLSX     = require('xlsx');
const path     = require('path');
const fs       = require('fs');
const cron     = require('node-cron');
const { pool } = require('../db');

const EXCEL_PATH = path.join(__dirname, '../data/attendance.xlsx');
const TIME_ZONE  = process.env.APP_TIMEZONE || 'Asia/Kolkata';

// ─── TIME HELPERS ──────────────────────────────────────────────────────────────
function getZonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(date);
  return parts.reduce((acc, p) => { if (p.type !== 'literal') acc[p.type] = p.value; return acc; }, {});
}

function getLocalDateKey(date = new Date()) {
  const z = getZonedParts(date);
  return `${z.year}-${z.month}-${z.day}`;
}

function getMonthYearKey(date = new Date()) {
  const z = getZonedParts(date);
  return `${z.month}/${String(z.year).slice(2)}`;
}

function getIstTimestampString(date = new Date()) {
  const z  = getZonedParts(date);
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${z.year}-${z.month}-${z.day} ${z.hour}:${z.minute}:${z.second}.${ms}`;
}

function formatTimeHHMM(value) {
  if (!value) return null;
  const text     = String(value);
  const timePart = text.includes('T') ? text.split('T')[1] : (text.split(' ')[1] || text);
  return timePart.slice(0, 5);
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const p = parseFloat(value);
  return isFinite(p) ? p : null;
}

function buildMapLink(lat, lng) {
  const la = toNumberOrNull(lat), lo = toNumberOrNull(lng);
  if (la === null || lo === null) return null;
  return `https://www.google.com/maps?q=${la},${lo}`;
}

// ─── EXCEL HELPERS ─────────────────────────────────────────────────────────────
function ensureDataDir() {
  const dir = path.join(__dirname, '../data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getWorkbook() {
  ensureDataDir();
  if (fs.existsSync(EXCEL_PATH)) return XLSX.readFile(EXCEL_PATH);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Emp ID', 'Name', 'Email', 'Status', 'Latitude', 'Longitude', 'Date', 'Location', 'Month', 'Map Link']
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
  XLSX.writeFile(wb, EXCEL_PATH);
  return wb;
}

function appendToExcel(rowData) {
  try {
    const wb        = getWorkbook();
    const sheetName = wb.SheetNames[0];
    const ws        = wb.Sheets[sheetName];
    const data      = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const lat       = toNumberOrNull(rowData.latitude);
    const lng       = toNumberOrNull(rowData.longitude);
    data.push([
      rowData.emp_id      || '',
      rowData.name        || '',
      rowData.email,
      rowData.status,
      lat  !== null ? lat  : '',
      lng  !== null ? lng  : '',
      rowData.timestamp,
      rowData.locationName || 'Unknown',
      rowData.monthYear   || getMonthYearKey(),
      buildMapLink(lat, lng) || ''
    ]);
    wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(data);
    XLSX.writeFile(wb, EXCEL_PATH);
  } catch (e) {
    console.error('Excel write error (non-fatal):', e.message);
  }
}

// ─── DB ATTENDANCE STATE ────────────────────────────────────────────────────────
async function getTodayAttendanceState(empId, empEmail) {
  const today = getLocalDateKey();

  // Try by emp_id first, fall back to email (legacy rows)
  let result;
  if (empId) {
    result = await pool.query(
      `SELECT * FROM attendance_logs
        WHERE emp_id=$1 AND date=$2
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [empId, today]
    );
  }
  if (!result || !result.rows.length) {
    result = await pool.query(
      `SELECT * FROM attendance_logs
        WHERE emp_email=$1 AND date=$2
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [empEmail, today]
    );
  }

  const record = result.rows[0] || null;
  return {
    date:         today,
    record,
    canPunchIn:   !record || (!record.punch_in_time && !record.punch_out_time),
    canPunchOut:  !!record && !!record.punch_in_time && !record.punch_out_time,
    inTimeLabel:  formatTimeHHMM(record && record.punch_in_time),
    outTimeLabel: formatTimeHHMM(record && record.punch_out_time)
  };
}

// ─── CORE PUNCH SAVE ───────────────────────────────────────────────────────────
async function savePunch(empId, empEmail, empName, status, latitude, longitude, locationName) {
  const now        = new Date();
  const timestamp  = getIstTimestampString(now);
  const dateOnly   = getLocalDateKey(now);
  const monthYear  = getMonthYearKey(now);
  const isPunchIn  = status === 'Punch In';
  const isPunchOut = status === 'Punch Out';
  const lat        = toNumberOrNull(latitude);
  const lng        = toNumberOrNull(longitude);
  const locLabel   = (locationName || '').trim() || 'Unknown';
  const mapLink    = buildMapLink(lat, lng);

  if (!isPunchIn && !isPunchOut) throw new Error('Invalid punch status.');

  // Look for today's record
  const existing = await pool.query(
    `SELECT id, punch_in_time, punch_out_time
       FROM attendance_logs
      WHERE (emp_id=$1 OR emp_email=$2) AND date=$3
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [empId || '', empEmail, dateOnly]
  );
  const rec = existing.rows[0] || null;

  if (isPunchIn) {
    if (rec && rec.punch_in_time && !rec.punch_out_time)
      throw new Error('Already punched IN today. Please punch OUT first.');
    if (rec && rec.punch_in_time && rec.punch_out_time)
      throw new Error('Attendance already completed for today.');

    await pool.query(
      `INSERT INTO attendance_logs
       (emp_id, emp_email, status, punch_in_time, punch_out_time,
        in_location, out_location, in_latitude, in_longitude,
        out_latitude, out_longitude, in_map_link, out_map_link,
        date, month_year, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        empId || '', empEmail, 'Punch In', timestamp, null,
        locLabel, null, lat, lng, null, null, mapLink, null,
        dateOnly, monthYear, timestamp
      ]
    );
  } else {
    if (!rec || !rec.punch_in_time)
      throw new Error('Please punch IN first.');
    if (rec.punch_out_time)
      throw new Error('Already punched OUT today.');

    await pool.query(
      `UPDATE attendance_logs
          SET status='Punch Out', punch_out_time=$2,
              out_location=$3, out_latitude=$4, out_longitude=$5,
              out_map_link=$6, month_year=$7
        WHERE id=$1`,
      [rec.id, timestamp, locLabel, lat, lng, mapLink, monthYear]
    );
  }

  return { timestamp, dateOnly, monthYear, lat, lng, locLabel, mapLink };
}

// ─── AUTO PUNCH-OUT ────────────────────────────────────────────────────────────
async function autoPunchOutPendingRecords(referenceTime = new Date()) {
  const todayKey = getLocalDateKey(referenceTime);
  const pending  = await pool.query(
    `SELECT id, emp_id, emp_email, date
       FROM attendance_logs
      WHERE punch_in_time IS NOT NULL
        AND punch_out_time IS NULL
        AND date < $1
      ORDER BY date ASC, id ASC`,
    [todayKey]
  );

  let updatedCount = 0;
  for (const r of pending.rows) {
    const closeTime = `${r.date} 23:59:59.000`;
    await pool.query(
      `UPDATE attendance_logs
          SET status='Auto Punch Out', punch_out_time=$2,
              out_location=$3, out_map_link=$4
        WHERE id=$1`,
      [r.id, closeTime, 'System Auto Punch-Out', null]
    );
    appendToExcel({
      emp_id: r.emp_id, email: r.emp_email, status: 'Auto Punch Out',
      latitude: '', longitude: '', locationName: 'System Auto Punch-Out',
      timestamp: closeTime, monthYear: getMonthYearKey(new Date(`${r.date}T12:00:00`))
    });
    updatedCount++;
  }
  return { updatedCount };
}

function scheduleAutoPunchOut() {
  cron.schedule('0 0 * * *', async () => {
    try {
      const r = await autoPunchOutPendingRecords();
      if (r.updatedCount > 0) console.log(`✅ Auto punch-out: ${r.updatedCount} record(s)`);
    } catch (err) {
      console.error('Auto punch-out job error:', err.message);
    }
  }, { timezone: TIME_ZONE });
  console.log('🕐 Auto punch-out cron scheduled (midnight IST)');
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET / ─── Render main index.ejs (legacy portal UI) ───────────────────────
router.get('/', (req, res) => {
  res.render('index', { initialUser: req.user || req.session.user || null });
});

// ── GET /api/attendance/today ─── Used by index.ejs frontend ──────────────────
router.get('/api/attendance/today', async (req, res) => {
  const authUser    = req.user || req.session.user;
  const empEmail    = authUser?.email?.toLowerCase() || '';
  if (!empEmail) return res.status(401).json({ authenticated: false, message: 'Please sign in first.' });

  try {
    const state = await getTodayAttendanceState(null, empEmail);
    res.json({ authenticated: true, employeeEmail: empEmail, ...state });
  } catch (err) {
    res.status(500).json({ authenticated: true, message: err.message });
  }
});

// ── POST /punch ─── Used by index.ejs frontend (Google users) ─────────────────
router.post('/punch', async (req, res) => {
  try {
    const authUser = req.user || req.session.user;
    const empEmail = authUser?.email?.toLowerCase() || '';
    if (!empEmail) return res.status(401).json({ success: false, message: 'Please sign in first.' });

    const { status, latitude, longitude, locationName } = req.body;
    if (!status || !latitude || !longitude)
      return res.status(400).json({ success: false, message: 'Missing required fields.' });

    await savePunch(null, empEmail, authUser.name || empEmail, status, latitude, longitude, locationName);

    appendToExcel({
      email: empEmail, name: authUser.name || '',
      status, latitude, longitude, locationName,
      timestamp: getIstTimestampString(), monthYear: getMonthYearKey()
    });

    res.json({ success: true, message: `${status} recorded!` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'Server error.' });
  }
});

// ── GET /download ─── Download Excel file ─────────────────────────────────────
router.get('/download', (req, res) => {
  if (fs.existsSync(EXCEL_PATH)) return res.download(EXCEL_PATH, 'attendance.xlsx');
  res.status(404).send('File not found. No attendance recorded yet.');
});

// Attach helpers for use by other modules / tests
router.autoPunchOutPendingRecords = autoPunchOutPendingRecords;
router.scheduleAutoPunchOut       = scheduleAutoPunchOut;
router.savePunch                  = savePunch;
router.getTodayAttendanceState    = getTodayAttendanceState;

module.exports = router;