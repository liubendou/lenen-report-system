'use strict';
// SQLite(node:sqlite) 初始化与种子数据；备份用 VACUUM INTO
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('./auth');
const { PERM_KEYS } = require('./perm');

let db = null;

function init(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(path.join(dataDir, 'lenen.db'));
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA user_version=8'); // schema 版本戳：未来结构变更时按此判断是否跑迁移脚本
  db.exec(`
CREATE TABLE IF NOT EXISTS positions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
  perms TEXT NOT NULL, scope TEXT NOT NULL, system INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, pass TEXT NOT NULL, position_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT, must_change INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY AUTOINCREMENT, idcard TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, sex TEXT NOT NULL, phone TEXT DEFAULT '',
  class_name TEXT DEFAULT '', status TEXT NOT NULL DEFAULT '已导入',
  checkin_at TEXT, created_at TEXT, created_by TEXT);
CREATE TABLE IF NOT EXISTS photos(
  student_id INTEGER PRIMARY KEY, blob BLOB NOT NULL, taken_at TEXT, by TEXT);
CREATE TABLE IF NOT EXISTS fee_state(
  student_id INTEGER, item TEXT, amount REAL DEFAULT 0, paid INTEGER DEFAULT 0,
  method TEXT DEFAULT '', at TEXT, by TEXT, PRIMARY KEY(student_id, item));
CREATE TABLE IF NOT EXISTS fee_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, item TEXT,
  action TEXT, amount REAL, at TEXT, by TEXT);
CREATE TABLE IF NOT EXISTS dorms(
  id INTEGER PRIMARY KEY AUTOINCREMENT, building TEXT NOT NULL, floor INTEGER NOT NULL,
  room TEXT NOT NULL, sex TEXT NOT NULL, beds INTEGER NOT NULL, bad INTEGER DEFAULT 0,
  note TEXT DEFAULT '', UNIQUE(building, room));
CREATE TABLE IF NOT EXISTS dorm_assign(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, dorm_id INTEGER,
  at TEXT, by TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS supplies_catalog(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS supply_state(
  student_id INTEGER, item_id INTEGER, status TEXT DEFAULT '未领', note TEXT DEFAULT '',
  at TEXT, by TEXT, PRIMARY KEY(student_id, item_id));
CREATE TABLE IF NOT EXISTS books_catalog(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS book_state(
  student_id INTEGER, book_id INTEGER, count INTEGER DEFAULT 0, at TEXT, by TEXT,
  PRIMARY KEY(student_id, book_id));
CREATE TABLE IF NOT EXISTS attendance(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, date TEXT, at TEXT,
  by TEXT, manual INTEGER DEFAULT 0, note TEXT DEFAULT '', UNIQUE(student_id, date));
CREATE TABLE IF NOT EXISTS leaves(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, from_d TEXT, to_d TEXT,
  reason TEXT DEFAULT '', by TEXT, at TEXT, status TEXT DEFAULT 'open',
  closed_at TEXT, closed_by TEXT);
CREATE TABLE IF NOT EXISTS scores(
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, exam TEXT, subject TEXT,
  value REAL, at TEXT, by TEXT, UNIQUE(student_id, exam, subject));
CREATE TABLE IF NOT EXISTS departures(
  student_id INTEGER PRIMARY KEY, supplies_ok INTEGER DEFAULT 0, clean_ok INTEGER DEFAULT 0,
  clean_note TEXT DEFAULT '', refund REAL DEFAULT 0, done INTEGER DEFAULT 0,
  at TEXT, by TEXT);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, user TEXT, action TEXT,
  target TEXT DEFAULT '', detail TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_da_student ON dorm_assign(student_id, active);
CREATE INDEX IF NOT EXISTS idx_da_dorm ON dorm_assign(dorm_id, active);
CREATE INDEX IF NOT EXISTS idx_scores_exam ON scores(exam);
CREATE INDEX IF NOT EXISTS idx_leaves_stu ON leaves(student_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);
CREATE INDEX IF NOT EXISTS idx_users_pos ON users(position_id);
CREATE TABLE IF NOT EXISTS sessions(
  sid TEXT PRIMARY KEY, uid INTEGER NOT NULL, exp INTEGER NOT NULL);
  `);
  seed();
  dailyBackup(dataDir);
  return db;
}

/* 启动时兜底备份：当天还没有备份就做一份（与定时任务/backup.js 同目录同保留策略） */
function dailyBackup(dataDir) {
  try {
    const dir = path.join(dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const have = fs.readdirSync(dir).some(f => f.includes(today));
    if (!have) {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      backupTo(path.join(dir, `lenen-${stamp}.db`));
      console.log('[lenen] 启动自动备份完成');
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
    while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
  } catch (e) { console.error('[lenen] 启动备份失败(不影响运行):', e.message); }
}

function seed() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM positions').get().n;
  if (n === 0) {
    db.prepare('INSERT INTO positions(name, perms, scope, system) VALUES(?,?,?,1)')
      .run('校长', JSON.stringify(PERM_KEYS), JSON.stringify({ type: 'all' }));
  }
  const u = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (u === 0) {
    const pos = db.prepare('SELECT id FROM positions WHERE system=1').get();
    db.prepare('INSERT INTO users(username,name,pass,position_id,status,created_at,must_change) VALUES(?,?,?,?,?,?,1)')
      .run('admin', '校长', hashPassword('change-me-on-first-login'), pos.id, 'active', new Date().toISOString());
  }
}

function backupTo(file) { db.exec(`VACUUM INTO '${String(file).replace(/'/g, "''")}'`); }
/* 事务包装：多写操作要么全成要么全滚（S4 数据完整性审查） */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (e2) {} throw e; }
}
function close() { try { db.close(); } catch (e) {} }
function audit(user, action, target, detail) {
  db.prepare('INSERT INTO audit(at,user,action,target,detail) VALUES(?,?,?,?,?)')
    .run(new Date().toISOString(), user || '-', action || '', String(target || '').slice(0, 80), String(detail || '').slice(0, 500));
}
const q = {
  one: (sql, ...a) => db.prepare(sql).get(...a),
  all: (sql, ...a) => db.prepare(sql).all(...a),
  run: (sql, ...a) => db.prepare(sql).run(...a),
};
module.exports = { init, backupTo, audit, q, tx, close };
