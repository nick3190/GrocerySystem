import pg from 'pg';
import dotenv from 'dotenv';

// 載入 .env 環境變數
dotenv.config();

const { Pool } = pg;

// 設定資料庫連線資訊
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',     // DBeaver 登入帳號
  host: process.env.DB_HOST || 'localhost',    // 主機位址
  database: process.env.DB_NAME || 'postgres', // 資料庫名稱
  password: process.env.DB_PASSWORD || 'yuanrong', // DBeaver 登入密碼
  port: process.env.DB_PORT || 5432,           // PostgreSQL 預設 port
});

export default pool;