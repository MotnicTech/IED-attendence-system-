const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');

const EXCEL_PATH = path.join(__dirname, '../data/attendance.xlsx');

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
  const monthStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(2)}`;
  data.push([
    rowData.email,
    rowData.status,
    parseFloat(rowData.latitude),
    parseFloat(rowData.longitude),
    rowData.timestamp,
    rowData.locationName,
    monthStr,
    `https://www.google.com/maps?q=${rowData.latitude},${rowData.longitude}`
  ]);
  wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(data);
  XLSX.writeFile(wb, EXCEL_PATH);
}

async function saveToDB(rowData) {
  try {
    const now = new Date(rowData.timestamp);
    const dateOnly = now.toISOString().split('T')[0];
    const monthYear = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(2)}`;
    const statusText = String(rowData.status || '').toLowerCase();
    const isPunchIn = statusText.includes('in');
    const isPunchOut = statusText.includes('out');
    const punchInTime = isPunchIn ? now : null;
    const punchOutTime = isPunchOut ? now : null;
    const inLocation = isPunchIn ? (rowData.locationName || 'Unknown') : null;
    const outLocation = isPunchOut ? (rowData.locationName || 'Unknown') : null;
    const inLatitude = isPunchIn ? parseFloat(rowData.latitude) : null;
    const inLongitude = isPunchIn ? parseFloat(rowData.longitude) : null;
    const outLatitude = isPunchOut ? parseFloat(rowData.latitude) : null;
    const outLongitude = isPunchOut ? parseFloat(rowData.longitude) : null;
    const mapLink = `https://www.google.com/maps?q=${rowData.latitude},${rowData.longitude}`;
    const inMapLink = isPunchIn ? mapLink : null;
    const outMapLink = isPunchOut ? mapLink : null;
    const updateResult = await pool.query(
      `WITH target AS (
         SELECT id
         FROM attendance_logs
         WHERE emp_email = $1
           AND date = $17
           AND (
             ($20 AND punch_in_time IS NULL)
             OR ($21 AND punch_out_time IS NULL)
             OR (punch_in_time IS NULL AND punch_out_time IS NULL)
           )
         ORDER BY created_at ASC, id ASC
         LIMIT 1
       )
       UPDATE attendance_logs a
       SET status = $2,
           latitude = $3,
           longitude = $4,
           location_name = $5,
           punch_time = COALESCE(a.punch_time, $6),
           punch_in_time = COALESCE(a.punch_in_time, $7),
           punch_out_time = COALESCE(a.punch_out_time, $8),
           in_location = COALESCE(a.in_location, $9),
           out_location = COALESCE(a.out_location, $10),
           in_latitude = COALESCE(a.in_latitude, $11),
           in_longitude = COALESCE(a.in_longitude, $12),
           out_latitude = COALESCE(a.out_latitude, $13),
           out_longitude = COALESCE(a.out_longitude, $14),
           in_map_link = COALESCE(a.in_map_link, $15),
           out_map_link = COALESCE(a.out_map_link, $16),
           month_year = $18,
           map_link = COALESCE(a.map_link, $19)
       FROM target
       WHERE a.id = target.id
       RETURNING a.id`,
      [
        rowData.email,
        rowData.status,
        parseFloat(rowData.latitude),
        parseFloat(rowData.longitude),
        rowData.locationName || 'Unknown',
        now,
        punchInTime,
        punchOutTime,
        inLocation,
        outLocation,
        inLatitude,
        inLongitude,
        outLatitude,
        outLongitude,
        inMapLink,
        outMapLink,
        dateOnly,
        monthYear,
        mapLink,
        isPunchIn,
        isPunchOut
      ]
    );

    if (updateResult.rowCount === 0) {
      await pool.query(
        `INSERT INTO attendance_logs
         (emp_email, status, latitude, longitude, location_name, punch_time, punch_in_time, punch_out_time,
          in_location, out_location, in_latitude, in_longitude, out_latitude, out_longitude,
          in_map_link, out_map_link, date, month_year, map_link)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          rowData.email,
          rowData.status,
          parseFloat(rowData.latitude),
          parseFloat(rowData.longitude),
          rowData.locationName || 'Unknown',
          now,
          punchInTime,
          punchOutTime,
          inLocation,
          outLocation,
          inLatitude,
          inLongitude,
          outLatitude,
          outLongitude,
          inMapLink,
          outMapLink,
          dateOnly,
          monthYear,
          mapLink
        ]
      );
    }
  } catch (err) {
    console.error('DB save error (non-fatal):', err.message);
  }
}

router.get('/', (req, res) => res.render('index'));

router.post('/punch', async (req, res) => {
  try {
    const { email, status, latitude, longitude, locationName, timestamp } = req.body;
    if (!email || !status || !latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    appendToExcel({ email, status, latitude, longitude, locationName, timestamp });
    await saveToDB({ email, status, latitude, longitude, locationName, timestamp });
    res.json({ success: true, message: `${status} recorded!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.get('/download', (req, res) => {
  if (fs.existsSync(EXCEL_PATH)) res.download(EXCEL_PATH, 'attendance.xlsx');
  else res.status(404).send('File not found');
});

module.exports = router;
