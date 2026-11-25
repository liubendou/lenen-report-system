'use strict';
// 手动/定时备份：VACUUM INTO 到 data/backups/，保留最近 30 份。用法：node backup.js
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.LENEN_DATA || path.join(__dirname, 'data');
const bakDir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(bakDir, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'lenen.db'), { readOnly: false });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const target = path.join(bakDir, `lenen-${stamp}.db`);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
const files = fs.readdirSync(bakDir).filter(f => f.endsWith('.db')).sort();
while (files.length > 30) fs.unlinkSync(path.join(bakDir, files.shift()));
console.log('backup ->', target, `(${files.length} kept)`);
