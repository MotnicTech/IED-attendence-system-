const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { pool } = require('../db');
 
const EXCEL_PATH = path.join(__dirname, '../data/attendance.xlsx');

function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getMonthYearKey(date = new Date()) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getFullYear()).slice(2)}`;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMapLink(latitude, longitude) {
  const lat = toNumberOrNull(latitude);
  const lng = toNumberOrNull(longitude);
  if (lat === null || lng === null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function formatTimeLabel(dateValue) {
  if (!dateValue) return null;
  return new Date(dateValue).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

async function getTodayAttendanceState(employeeEmail) {
  const today = getLocalDateKey();
  const result = await pool.query(
    `SELECT id, emp_email, status, punch_in_time, punch_out_time, location_name, latitude, longitude, date, month_year, map_link,
            in_location, out_location, in_map_link, out_map_link
       FROM attendance_logs
      WHERE emp_email = $1
        AND date = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [employeeEmail, today]
  );

  const record = result.rows[0] || null;
  return {
    date: today,
    record,
    canPunchIn: !record || (!record.punch_in_time && !record.punch_out_time),
    canPunchOut: !!record && !!record.punch_in_time && !record.punch_out_time,
    inTimeLabel: formatTimeLabel(record && record.punch_in_time),
    outTimeLabel: formatTimeLabel(record && record.punch_out_time)
  };
}

function getWorkbook() {
  if (fs.existsSync(EXCEL_PATH)) return XLSX.readFile(EXCEL_PATH);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['name', 'status', 'latitude', 'longitude', 'date', 'location', 'Month', 'Location in Map']
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '10020012');
  XLSX.writeFile(wb, EXCEL_PATH);
  return wb;
}

function appendToExcel(rowData) {
  const wb = getWorkbook();
  const sheetName = wb.SheetNames.includes('10020012') ? '10020012' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const now = new Date(rowData.timestamp);
  const monthStr = getMonthYearKey(now);
  const latitude = toNumberOrNull(rowData.latitude);
  const longitude = toNumberOrNull(rowData.longitude);
  data.push([
    rowData.email,
    rowData.status,
    latitude === null ? '' : latitude,
    longitude === null ? '' : longitude,
    rowData.timestamp,
    rowData.locationName || 'Unknown',
    monthStr,
    buildMapLink(rowData.latitude, rowData.longitude) || ''
  ]);
  wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(data);
  XLSX.writeFile(wb, EXCEL_PATH);
}

async function saveToDB(employeeEmail, rowData) {
  const now = new Date(rowData.timestamp || new Date());
  const dateOnly = getLocalDateKey(now);
  const monthYear = getMonthYearKey(now);
  const statusText = String(rowData.status || '').trim().toLowerCase();
  const isPunchIn = statusText === 'punch in';
  const isPunchOut = statusText === 'punch out';
  const latitude = toNumberOrNull(rowData.latitude);
  const longitude = toNumberOrNull(rowData.longitude);
  const locationLabel = rowData.locationName || 'Unknown';
  const mapLink = buildMapLink(rowData.latitude, rowData.longitude);

  if (!isPunchIn && !isPunchOut) {
    throw new Error('Invalid punch status');
  }

  const existingResult = await pool.query(
    `SELECT id, punch_in_time, punch_out_time
       FROM attendance_logs
      WHERE emp_email = $1
        AND date = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [employeeEmail, dateOnly]
  );

  const existing = existingResult.rows[0] || null;

  if (isPunchIn) {
    if (existing && existing.punch_in_time && !existing.punch_out_time) {
      throw new Error('IN already recorded for today. Please punch OUT first.');
    }
    if (existing && existing.punch_in_time && existing.punch_out_time) {
      throw new Error('Attendance already completed for today.');
    }

    await pool.query(
      `INSERT INTO attendance_logs
       (emp_email, status, latitude, longitude, location_name, punch_time, punch_in_time, punch_out_time,
        in_location, out_location, in_latitude, in_longitude, out_latitude, out_longitude,
        in_map_link, out_map_link, date, month_year, map_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        employeeEmail,
        rowData.status,
        latitude,
        longitude,
        locationLabel,
        now,
        now,
        null,
        locationLabel,
        null,
        latitude,
        longitude,
        null,
        null,
        mapLink,
        null,
        dateOnly,
        monthYear,
        mapLink
      ]
    );
    return;
  }

  if (!existing || !existing.punch_in_time) {
    throw new Error('Please punch IN first.');
  }
  if (existing.punch_out_time) {
    throw new Error('OUT already recorded for today.');
  }

  await pool.query(
    `UPDATE attendance_logs
        SET status = $2,
            latitude = $3,
            longitude = $4,
            location_name = $5,
            punch_out_time = $6,
            out_location = $7,
            out_latitude = $8,
            out_longitude = $9,
            out_map_link = $10,
            month_year = $11,
            map_link = COALESCE($12, map_link)
      WHERE id = $1`,
    [
      existing.id,
      rowData.status,
      latitude,
      longitude,
      locationLabel,
      now,
      locationLabel,
      latitude,
      longitude,
      mapLink,
      monthYear,
      mapLink
    ]
  );
}

async function autoPunchOutPendingRecords(referenceTime = new Date()) {
  const todayKey = getLocalDateKey(referenceTime);
  const pending = await pool.query(
    `SELECT id, emp_email, date, punch_in_time
       FROM attendance_logs
      WHERE punch_in_time IS NOT NULL
        AND punch_out_time IS NULL
        AND date < $1
      ORDER BY date ASC, created_at ASC, id ASC`,
    [todayKey]
  );

  let updatedCount = 0;

  for (const record of pending.rows) {
    const closeTime = new Date(`${record.date}T23:59:59.000`);
    await pool.query(
      `UPDATE attendance_logs
          SET status = $2,
              punch_out_time = $3,
              out_location = $4,
              out_map_link = $5
        WHERE id = $1`,
      [record.id, 'Auto Punch Out', closeTime, 'System Auto Punch-Out', null]
    );

    try {
      appendToExcel({
        email: record.emp_email,
        status: 'Auto Punch Out',
        latitude: '',
        longitude: '',
        locationName: 'System Auto Punch-Out',
        timestamp: closeTime.toISOString()
      });
    } catch (excelErr) {
      console.error('Excel auto punch-out sync error:', excelErr.message);
    }

    updatedCount += 1;
  }

  return { updatedCount };
}

function scheduleAutoPunchOut() {
  cron.schedule('0 0 * * *', async () => {
    try {
      const result = await autoPunchOutPendingRecords();
      if (result.updatedCount > 0) {
        console.log(`✅ Auto punch-out completed for ${result.updatedCount} record(s)`);
      }
    } catch (err) {
      console.error('Auto punch-out job failed:', err.message);
    }
  }, {
    timezone: process.env.CRON_TIMEZONE || undefined
  });
}

router.get('/api/attendance/today', async (req, res) => {
  const authUser = req.user || req.session.user;
  const employeeEmail = authUser && authUser.email ? authUser.email.toLowerCase() : '';

  if (!employeeEmail) {
    return res.status(401).json({ authenticated: false, message: 'Please sign in with Google first.' });
  }

  try {
    const state = await getTodayAttendanceState(employeeEmail);
    res.json({ authenticated: true, employeeEmail, ...state });
  } catch (err) {
    res.status(500).json({ authenticated: true, message: err.message });
  }
});

router.get('/', (req, res) => res.render('index', {
  initialUser: req.user || req.session.user || null
}));

router.post('/punch', async (req, res) => {
  try {
    const authUser = req.user || req.session.user;
    const employeeEmail = authUser && authUser.email ? authUser.email.toLowerCase() : '';
    const { status, latitude, longitude, locationName, timestamp } = req.body;
    if (!employeeEmail) {
      return res.status(401).json({ success: false, message: 'Please sign in with Google first.' });
    }
    if (!status || !latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    await saveToDB(employeeEmail, { email: employeeEmail, status, latitude, longitude, locationName, timestamp });
    try {
      appendToExcel({ email: employeeEmail, status, latitude, longitude, locationName, timestamp });
    } catch (excelErr) {
      console.error('Excel save error (non-fatal):', excelErr.message);
    }
    res.json({ success: true, message: `${status} recorded!` });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success: false, message: err.message || 'Server error' });
  }
});

router.get('/download', (req, res) => {
  if (fs.existsSync(EXCEL_PATH)) res.download(EXCEL_PATH, 'attendance.xlsx');
  else res.status(404).send('File not found');
});

router.autoPunchOutPendingRecords = autoPunchOutPendingRecords;
router.scheduleAutoPunchOut = scheduleAutoPunchOut;

module.exports = router;
