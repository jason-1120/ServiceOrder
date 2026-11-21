'use strict';
// `node --test tests/` 的進入點：Node 22 會把目錄參數當成模組解析到這個檔案，
// 這裡載入所有 *.test.js，讓它們在同一個 node:test 執行中跑完。
// （會自行展開目錄的 Node 版本只會挑 *.test.js，不會執行本檔，因此不會重複。）
const fs = require('node:fs');
const path = require('node:path');

for (const file of fs.readdirSync(__dirname).filter(name => name.endsWith('.test.js')).sort()) {
  require(path.join(__dirname, file));
}
