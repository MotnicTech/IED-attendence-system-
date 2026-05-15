const { Pool } = require('pg');

// Build pool config from either DATABASE_URL or individual DB_* env vars
const poolConfig = {};

if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
  if (process.env.DATABASE_URL.includes('render.com')) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
} else {
  poolConfig.host = process.env.DB_HOST || 'localhost';
  poolConfig.port = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432;
  poolConfig.database = process.env.DB_NAME || 'attendance_db';
  poolConfig.user = process.env.DB_USER || 'postgres';
  poolConfig.password = process.env.DB_PASSWORD || 'postgres';
  poolConfig.max = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10;
  poolConfig.idleTimeoutMillis = process.env.DB_POOL_IDLE ? parseInt(process.env.DB_POOL_IDLE, 10) : 10000;
  poolConfig.connectionTimeoutMillis = process.env.DB_POOL_ACQUIRE ? parseInt(process.env.DB_POOL_ACQUIRE, 10) : 0;
  poolConfig.ssl = (process.env.DB_SSL === 'true' || process.env.DB_SSL === '1') ? { rejectUnauthorized: false } : false;
}

const pool = new Pool(poolConfig);

// Initialize tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS hr_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        emp_email VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        latitude DECIMAL(10, 6),
        longitude DECIMAL(10, 6),
        location_name VARCHAR(255),
        punch_time TIMESTAMP,
        punch_in_time TIMESTAMP,
        punch_out_time TIMESTAMP,
        in_location VARCHAR(255),
        out_location VARCHAR(255),
        in_latitude DECIMAL(10, 6),
        in_longitude DECIMAL(10, 6),
        out_latitude DECIMAL(10, 6),
        out_longitude DECIMAL(10, 6),
        in_map_link TEXT,
        out_map_link TEXT,
        date DATE NOT NULL,
        month_year VARCHAR(10),
        map_link TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_logs(date);
      CREATE INDEX IF NOT EXISTS idx_attendance_email ON attendance_logs(emp_email);
    `);

    await client.query(`
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS punch_in_time TIMESTAMP;
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS punch_out_time TIMESTAMP;
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS in_location VARCHAR(255);
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS out_location VARCHAR(255);
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS in_latitude DECIMAL(10, 6);
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS in_longitude DECIMAL(10, 6);
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS out_latitude DECIMAL(10, 6);
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS out_longitude DECIMAL(10, 6);
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS in_map_link TEXT;
      ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS out_map_link TEXT;
    `);

    await client.query(`
      UPDATE attendance_logs
      SET punch_in_time = COALESCE(punch_in_time, punch_time),
          in_location = COALESCE(in_location, location_name),
          in_latitude = COALESCE(in_latitude, latitude),
          in_longitude = COALESCE(in_longitude, longitude),
          in_map_link = COALESCE(in_map_link, map_link)
      WHERE punch_in_time IS NULL AND status ILIKE '%in%';
    `);

    await client.query(`
      UPDATE attendance_logs
      SET punch_out_time = COALESCE(punch_out_time, punch_time),
          out_location = COALESCE(out_location, location_name),
          out_latitude = COALESCE(out_latitude, latitude),
          out_longitude = COALESCE(out_longitude, longitude),
          out_map_link = COALESCE(out_map_link, map_link)
      WHERE punch_out_time IS NULL AND status ILIKE '%out%';
    `);

    console.log('✅ Database tables ready');
  } catch (err) {
    console.error('DB init error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
