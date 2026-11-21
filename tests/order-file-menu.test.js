'use strict';
// 開啟／儲存選單：Drive 項目狀態（純函式）與 index.html 的載入順序。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {driveMenuModel} = require(path.join(__dirname, '..', 'assets', 'order-file-menu.js'));
const D = require(path.join(__dirname, '..', 'assets', 'drive-storage.js'));

const CONFIG = {clientId: '123-abc.apps.googleusercontent.com', apiKey: 'AIzaSyTestKey_123', appId: '1234567890'};
const OK = D.availability(CONFIG, 'https:');

test('未設定或 file:// 時所有 Drive 項目停用並說明原因，不顯示登出', () => {
  for (const availability of [D.availability({clientId: '', apiKey: '', appId: ''}, 'https:'), D.availability(CONFIG, 'file:')]) {
    const m = driveMenuModel({availability, currentFile: {id: 'f1', name: 'a.json'}, signedIn: true});
    assert.equal(m.openDrive.disabled, true);
    assert.equal(m.saveBack.disabled, true);
    assert.equal(m.saveAsDrive.disabled, true);
    assert.equal(m.signOut.hidden, true);
    assert.equal(m.openDrive.title, availability.message);
    assert.equal(m.saveBack.title, availability.message);
    assert.equal(m.saveBack.label, '存回 Google Drive');
  }
});

test('可用但沒有目前的 Drive 檔案：只能另存，存回停用', () => {
  const m = driveMenuModel({availability: OK, currentFile: null, signedIn: false});
  assert.equal(m.openDrive.disabled, false);
  assert.equal(m.saveAsDrive.disabled, false);
  assert.equal(m.saveBack.disabled, true);
  assert.match(m.saveBack.title, /另存到 Google Drive/);
  assert.equal(m.signOut.hidden, true);
});

test('有目前的 Drive 檔案：存回啟用且標籤顯示檔名；登入時顯示登出', () => {
  const m = driveMenuModel({availability: OK, currentFile: {id: 'f1', name: '團購.json'}, signedIn: true});
  assert.equal(m.saveBack.disabled, false);
  assert.equal(m.saveBack.label, '存回 Google Drive（團購.json）');
  assert.equal(m.openDrive.title, '');
  assert.equal(m.signOut.hidden, false);
});

test('index.html：Drive 設定與模組在 system-core.js 之前載入，選單腳本在之後；頁面不直接載入 Google 程式', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  const at = src => scripts.indexOf(src);
  for (const src of ['assets/drive-config.js', 'assets/drive-storage.js', 'assets/system-core.js', 'assets/order-file-menu.js']) assert.ok(at(src) >= 0, src);
  assert.ok(at('assets/drive-config.js') < at('assets/drive-storage.js'));
  assert.ok(at('assets/drive-storage.js') < at('assets/system-core.js'));
  assert.ok(at('assets/system-core.js') < at('assets/order-file-menu.js'));
  assert.ok(!scripts.some(src => /google|gstatic/.test(src)), 'Google 程式只能在打開選單時才載入');
  assert.ok(!/type="module"/.test(html), '不可使用 ES modules');
  // 選單按鈕的無障礙屬性
  for (const id of ['import', 'export']) {
    const tag = new RegExp('<button[^>]*id="' + id + '"[^>]*>').exec(html)[0];
    assert.match(tag, /aria-haspopup="menu"/);
    assert.match(tag, /aria-expanded="false"/);
  }
});

test('system-core.js：本機開啟／儲存改為具名函式，Drive 檔案資訊不寫進 payload()', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'system-core.js'), 'utf8');
  assert.match(src, /async function openLocalOrder\(\)\{if\(orderPickerBusy\)return;/);
  assert.match(src, /async function saveLocalOrder\(\)\{if\(orderPickerBusy\|\|!validUI\(\)\)return;/);
  assert.doesNotMatch(src, /\$\('import'\)\.onclick|\$\('export'\)\.onclick/);
  const payloadLine = src.split('\n').find(line => line.startsWith('function payload()'));
  assert.ok(payloadLine);
  assert.doesNotMatch(payloadLine, /Drive|drive/);
});

test('Drive 存檔期間訂單被本機開啟／拖曳取代：存好的檔案不可成為目前檔案', () => {
  const {driveSaveOutcome} = require(path.join(__dirname, '..', 'assets', 'order-file-menu.js'));
  assert.equal(driveSaveOutcome(null, 3, 3), 'cancelled');
  assert.equal(driveSaveOutcome({id: 'f1', name: 'A.json'}, 3, 3), 'saved');
  assert.equal(driveSaveOutcome({id: 'f1', name: 'A.json'}, 3, 4), 'replaced');
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'system-core.js'), 'utf8');
  // openOrderFile（本機開啟、拖曳、Drive 開啟共用）確認取代後才遞增世代並設定／清除 Drive 檔案
  assert.match(src, /return;state=data;orderFileGeneration\+\+;setCurrentDriveFile\(driveFile\);/);
  const menu = fs.readFileSync(path.join(__dirname, '..', 'assets', 'order-file-menu.js'), 'utf8');
  assert.equal((menu.match(/const generation = orderFileGeneration;/g) || []).length, 2);
  assert.match(menu, /if \(outcome === 'replaced'\) \{\s*\/\/[^\n]*\n\s*setCurrentDriveFile\(null\);/);
});

test('Drive 動作等待 Google 登入時不佔用本機開啟／儲存；取得 token 後才佔用，結束時釋放', async () => {
  const {createDriveLocks} = require(path.join(__dirname, '..', 'assets', 'order-file-menu.js'));
  let busy = false;
  const locks = createDriveLocks({get: () => busy, set: v => { busy = v; }});
  const requests = [];
  let config;
  const google = {accounts: {oauth2: {initTokenClient: c => { config = c; return {requestAccessToken: o => requests.push(o)}; }, revoke: (t, done) => done()}}};
  const tokens = D.createGisTokenProvider({google, clientId: CONFIG.clientId});
  let picks = 0;
  const drive = D.create({config: CONFIG, protocol: 'https:', fetch: async () => { throw new Error('no fetch'); }, tokenProvider: tokens,
    pickFile: async () => { picks++; assert.equal(busy, true, 'Picker 期間佔用旗標'); return null; }, loadScript: async () => {}});
  await drive.ensureLoaded();

  // 登入視窗沒有任何回呼：旗標不被佔用，本機開啟／儲存仍可使用
  const stuck = locks.begin();
  const first = drive.openFromDrive({onAuthorized: stuck.onAuthorized}).finally(stuck.release);
  assert.equal(busy, false);
  // 再按一次 Drive：取代前一個請求；前一個安靜結束（superseded）
  const lock = locks.begin();
  const second = drive.openFromDrive({onAuthorized: lock.onAuthorized}).finally(lock.release);
  assert.equal(await first, null);
  assert.equal(stuck.superseded(), true);
  assert.equal(lock.superseded(), false);
  config.callback({access_token: 'tok', expires_in: 3600});
  assert.equal(await second, null);
  assert.equal(picks, 1);
  assert.equal(busy, false, '結束後釋放');

  // 取得 token 時本機開啟正在進行：Drive 動作中止，且不會釋放本機的旗標
  const third = locks.begin();
  busy = true;
  await assert.rejects(drive.openFromDrive({onAuthorized: third.onAuthorized}).finally(third.release), /本機開啟或儲存正在進行中/);
  assert.equal(busy, true, '本機的旗標保持不變');
  busy = false;

  // 工作中途需要重新登入（例如登出或 token 過期）而登入請求沒有回呼：再按一次 Drive 項目可取代它並釋放旗標
  const working = locks.begin();
  const save = drive.saveAsToDrive({contents: '{}', name: 'a.json', onAuthorized: working.onAuthorized}).finally(working.release);
  await drive.signOut();
  await new Promise(r => setImmediate(r));
  assert.equal(busy, true, '已取得 token 的工作佔用旗標');
  assert.equal(drive.isWaitingForToken(), true);
  const retry = locks.begin();
  const reopen = drive.openFromDrive({onAuthorized: retry.onAuthorized}).finally(retry.release);
  assert.equal(await save, null, '被取代的動作視為取消');
  assert.equal(working.superseded(), true);
  assert.equal(busy, false, '被取代的動作釋放旗標');
  config.callback({access_token: 'tok2', expires_in: 3600});
  assert.equal(await reopen, null);
  assert.equal(busy, false);

  // 登出時仍在等待登入的動作：結束（取消），不佔用旗標
  const signOutLock = locks.begin();
  await drive.signOut();
  const waiting = drive.openFromDrive({onAuthorized: signOutLock.onAuthorized}).finally(signOutLock.release);
  locks.cancelPending();
  await drive.signOut();
  assert.equal(await waiting, null);
  assert.equal(signOutLock.superseded(), true);
  assert.equal(busy, false);
});
