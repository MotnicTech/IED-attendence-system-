const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireDriver, requireHR } = require('../middleware/auth');
const router = express.Router();

const cloudinary = require("../config/cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// ============================    
// DRIVER PHOTO UPLOAD
// ============================
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "driver-photos",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    public_id: (req, file) => {
      return `driver_${Date.now()}`;
    },
  },
});

const upload = multer({
  storage,
});
// GET /driver/login
router.get('/login', (req, res) => {
  if (req.session.driver) return res.redirect('/driver/attendance');
  res.render('driver-login', { error: null });
});

// POST /driver/login
router.post('/login', async (req, res) => {
  const { driver_code, password } = req.body;
  try {
    const r = await pool.query(
      'SELECT * FROM drivers WHERE driver_code=$1 AND is_active=TRUE',
      [driver_code.trim().toUpperCase()]
    );
    if (!r.rows.length) {
      return res.render('driver-login', { error: 'Invalid Driver ID or inactive.' });
    }
    const ok = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!ok) {
      return res.render('driver-login', { error: 'Incorrect password.' });
    }
    // Set session (no logout route provided by design)
    const drv = r.rows[0];
    req.session.driver = {
      id: drv.id,
      driver_code: drv.driver_code,
      name: drv.name
    };
    res.redirect('/driver/attendance');
  } catch (err) {
    console.error(err);
    res.render('driver-login', { error: 'Server error.' });
  }
});

// GET /driver/attendance — driver punch UI
router.get('/attendance', requireDriver, (req, res) => {
  res.render('Driver-Usage', {
    driver: req.session.driver
  });
});

// GET /driver/api/today — current day’s state
router.get('/api/today', requireDriver, async (req, res) => {
  const did = req.session.driver.id;
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  try {
    const r = await pool.query(
      `SELECT * FROM driver_attendance 
       WHERE driver_id=$1 AND date=$2
       ORDER BY id DESC LIMIT 1`, [did, today]
    );
    const rec = r.rows[0];
    res.json({
      authenticated: true,
      success: true,
      record: rec || null,
      canPunchIn: !rec,
      canPunchOut: !!rec && !rec.punch_out_time
    });
  } catch (err) {
    res.status(500).json({ authenticated: true, success: false, message: err.message });
  }
});

// POST /driver/api/punch — handle punch in/out
router.post('/api/punch', requireDriver, upload.single('photo'), async (req, res) => {
  const did = req.session.driver.id;
  const { status, latitude, longitude, locationName, km, route } = req.body;
  const photo = req.file ? req.file.path : null;
  // 'photo' will be handled by multer middleware separately
  const now = new Date();
  const timestamp = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  try {
    // Look for an existing record today
    const r = await pool.query(
      'SELECT * FROM driver_attendance WHERE driver_id=$1 AND date=$2',
      [did, dateStr]
    );
    const rec = r.rows[0];
    if (status === 'Punch In') {
      if (rec) throw new Error('Already punched IN today.');
      // Insert new record
      await pool.query(
        `INSERT INTO driver_attendance 
         (driver_id, status, punch_in_time, start_location,
          start_latitude, start_longitude, start_km, start_photo_path,
          date, day, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [did, status, timestamp, locationName, latitude, longitude, km, photo,
          dateStr, now.toLocaleString('en-US', { weekday: 'long' }), timestamp]
      );
    } else { // Punch Out
      if (!rec) throw new Error('Please punch IN first.');
      if (rec.punch_out_time) throw new Error('Already punched OUT today.');
      const totalKm = km - (rec.start_km || 0);
      const diff = new Date(timestamp) - new Date(rec.punch_in_time);
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.round((diff % 3600000) / 60000);
      const interval = `${hours} hours ${minutes} mins`;
      await pool.query(
        `UPDATE driver_attendance SET 
           status=$2, punch_out_time=$3, end_location=$4, end_latitude=$5, end_longitude=$6,
           end_km=$7, end_photo_path=$8, total_km=$9, total_hours=$10,route=$11
         WHERE id=$1`,
        [rec.id, status, timestamp, locationName, latitude, longitude,
          km, photo, totalKm, interval, route]
      );
    }
    res.json({ success: true, message: `${status} recorded at ${timestamp}` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /driver/api/location — receive live GPS coordinate
router.post('/api/location', requireDriver, async (req, res) => {

  const { latitude, longitude } = req.body;

  try {

    const did = req.session.driver.id;

    const attendance = await pool.query(
      `
SELECT id
FROM driver_attendance
WHERE driver_id=$1
ORDER BY id DESC
LIMIT 1
`,
      [did]
    );

    if (!attendance.rows.length) {

      return res.json({
        success: false,
        message: "No attendance found."
      });

    }

    const attendanceId = attendance.rows[0].id;

    await pool.query(
      `
INSERT INTO driver_route_logs
(
attendance_id,
driver_id,
latitude,
longitude,
timestamp
)
VALUES
($1,$2,$3,$4,NOW())
`,
      [
        attendanceId,
        did,
        latitude,
        longitude
      ]
    );

    console.log("GPS Saved -> Attendance:", attendanceId);

    res.json({
      success: true
    });

  } catch (err) {

    console.error(err);

    res.json({
      success: false,
      message: err.message
    });

  }

});

module.exports = router;