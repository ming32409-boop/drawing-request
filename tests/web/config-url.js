// 從網頁的 config.js 讀出 Supabase 網址，測試時攔截這個網址的請求
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'config.js'), 'utf8');
module.exports = src.match(/supabaseUrl:\s*"([^"]+)"/)[1];
