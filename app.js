require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const { initDB } = require('./db');

const attendanceRoutes = require('./routes/attendance');
const hrRoutes = require('./routes/hr');

const app = express();
const PORT = process.env.PORT || 4000;  

app.set('view engine', 'ejs'); 
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ied-attendance-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));

app.use('/', attendanceRoutes);
app.use('/hr', hrRoutes);

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ IED Attendance App → http://localhost:${PORT}`);
    console.log(`👤 HR Panel         → http://localhost:${PORT}/hr/login`);
  });
}).catch(err => {
  console.error('DB connect failed:', err.message);
  app.listen(PORT, () => console.log(`✅ Running at http://localhost:${PORT} (no DB)`));
});
