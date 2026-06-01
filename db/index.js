// db/index.js - Database connection + full table initialization for HRMS
const { Pool, types } = require('pg');

// Keep timestamps as raw strings — no auto-parsing
types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value);
types.setTypeParser(1082, value => value);

// ── Pool config ───────────────────────────────────────────────────────────────
const poolConfig = {};

if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
  if (process.env.DATABASE_URL.includes('render.com')) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
} else {
  poolConfig.host                  = process.env.DB_HOST     || 'localhost';
  poolConfig.port                  = process.env.DB_PORT     ? parseInt(process.env.DB_PORT, 10) : 5432;
  poolConfig.database              = process.env.DB_NAME     || 'attendance_db';
  poolConfig.user                  = process.env.DB_USER     || 'postgres';
  poolConfig.password              = process.env.DB_PASSWORD || 'postgres';
  poolConfig.max                   = process.env.DB_POOL_MAX    ? parseInt(process.env.DB_POOL_MAX, 10)    : 10;
  poolConfig.idleTimeoutMillis     = process.env.DB_POOL_IDLE   ? parseInt(process.env.DB_POOL_IDLE, 10)   : 10000;
  poolConfig.connectionTimeoutMillis = process.env.DB_POOL_ACQUIRE ? parseInt(process.env.DB_POOL_ACQUIRE, 10) : 0;
  poolConfig.ssl = (process.env.DB_SSL === 'true' || process.env.DB_SSL === '1')
    ? { rejectUnauthorized: false }
    : false;
} 

const pool = new Pool(poolConfig);

// ── initDB ────────────────────────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {

    // ── 1. HR Admin Users ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS hr_users (
        id            SERIAL PRIMARY KEY,
        email         VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name          VARCHAR(255) NOT NULL,
        created_at    TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
      )
    `);

    // ── 2. Employees (HR-managed, login via EMP ID + PIN) ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id          SERIAL PRIMARY KEY,
        emp_id      VARCHAR(30)  UNIQUE NOT NULL,         -- e.g. IED_01
        name        VARCHAR(255) NOT NULL,
        email       VARCHAR(255) UNIQUE NOT NULL,
        phone       VARCHAR(20),
        department  VARCHAR(100),
        designation VARCHAR(100),
        pin_hash    VARCHAR(255) NOT NULL,                -- bcrypt hash of 6-digit PIN
        pin         VARCHAR(10)  DEFAULT NULL,            -- plaintext PIN for HR admin visibility
        is_active   BOOLEAN      DEFAULT TRUE,
        joined_date DATE         DEFAULT CURRENT_DATE,
        created_at  TIMESTAMP    DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
      )
    `);

    // ── 3. Attendance Logs ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id             SERIAL PRIMARY KEY,
        emp_id         VARCHAR(30)   NOT NULL,             -- FK → employees.emp_id
        emp_email      VARCHAR(255)  NOT NULL,
        status         VARCHAR(50)   NOT NULL,             -- 'Punch In' | 'Punch Out' | 'Auto Punch Out'
        punch_in_time  TIMESTAMP,
        punch_out_time TIMESTAMP,
        in_location    VARCHAR(255),
        out_location   VARCHAR(255),
        in_latitude    DECIMAL(10,6),
        in_longitude   DECIMAL(10,6),
        out_latitude   DECIMAL(10,6),
        out_longitude  DECIMAL(10,6),
        in_map_link    TEXT,
        out_map_link   TEXT,
        date           DATE         NOT NULL,              -- local IST date
        month_year     VARCHAR(10),                        -- e.g. '06/25'
        created_at     TIMESTAMP    DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
      )
    `);

    // ── 4. Migrate legacy attendance_logs columns (backward compat) ───────────
    //    Old schema used: latitude, longitude, location_name, punch_time, map_link
    //    Safe to run on an already-updated DB (ADD COLUMN IF NOT EXISTS is idempotent)
    const legacyAlters = [
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS emp_id         VARCHAR(30)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS emp_email      VARCHAR(255)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS status          VARCHAR(50)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS punch_in_time   TIMESTAMP`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS punch_out_time  TIMESTAMP`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS in_location     VARCHAR(255)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS out_location    VARCHAR(255)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS in_latitude     DECIMAL(10,6)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS in_longitude    DECIMAL(10,6)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS out_latitude    DECIMAL(10,6)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS out_longitude   DECIMAL(10,6)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS in_map_link     TEXT`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS out_map_link    TEXT`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS date            DATE`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS month_year      VARCHAR(10)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS created_at      TIMESTAMP`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS latitude      DECIMAL(10,6)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS longitude     DECIMAL(10,6)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS location_name VARCHAR(255)`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS punch_time    TIMESTAMP`,
      `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS map_link      TEXT`,
    ];
    for (const sql of legacyAlters) {
      try { await client.query(sql); } catch (_) { /* column already exists */ }
    }

    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin VARCHAR(10) DEFAULT NULL
    `).catch(() => {});

    await client.query(`
      ALTER TABLE attendance_logs
        ALTER COLUMN punch_time DROP NOT NULL
    `).catch(() => {});

    // ── 5. Indexes ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_att_date      ON attendance_logs(date);
      CREATE INDEX IF NOT EXISTS idx_att_emp_id    ON attendance_logs(emp_id);
      CREATE INDEX IF NOT EXISTS idx_att_emp_email ON attendance_logs(emp_email);
      CREATE INDEX IF NOT EXISTS idx_att_month     ON attendance_logs(month_year);
      CREATE INDEX IF NOT EXISTS idx_emp_id        ON employees(emp_id);
      CREATE INDEX IF NOT EXISTS idx_emp_email     ON employees(email);
    `);

    // ── 6. Backfill legacy rows that have no emp_id ────────────────────────────
    //    Old rows stored only emp_email; try to match employees table
    await client.query(`
      UPDATE attendance_logs a
         SET emp_id = e.emp_id
        FROM employees e
       WHERE a.emp_id IS NULL
         AND LOWER(a.emp_email) = LOWER(e.email)
    `).catch(() => {});   // silently skip if emp_id col didn't exist before

    // ── 7. Backfill punch_in_time / punch_out_time from legacy columns ─────────
    await client.query(`
      UPDATE attendance_logs
         SET punch_in_time = COALESCE(punch_in_time, punch_time),
             in_location   = COALESCE(in_location,   location_name),
             in_latitude   = COALESCE(in_latitude,   latitude),
             in_longitude  = COALESCE(in_longitude,  longitude),
             in_map_link   = COALESCE(in_map_link,   map_link)
       WHERE punch_in_time IS NULL
         AND status ILIKE '%in%'
    `).catch(() => {});

    await client.query(`
      UPDATE attendance_logs
         SET punch_out_time = COALESCE(punch_out_time, punch_time),
             out_location   = COALESCE(out_location,   location_name),
             out_latitude   = COALESCE(out_latitude,   latitude),
             out_longitude  = COALESCE(out_longitude,  longitude),
             out_map_link   = COALESCE(out_map_link,   map_link)
       WHERE punch_out_time IS NULL
         AND status ILIKE '%out%'
    `).catch(() => {});

    console.log('✅ Database tables ready (hr_users, employees, attendance_logs)');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };