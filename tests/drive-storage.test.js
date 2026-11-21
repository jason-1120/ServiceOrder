'use strict';
// Google Drive 模組測試：全部使用假的 fetch／token／picker／script loader，不連到真正的 Google 服務。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const D = require(path.join(__dirname, '..', 'assets', 'drive-storage.js'));

const CONFIG = {clientId: '123-abc.apps.googleusercontent.com', apiKey: 'AIzaSyTestKey_123', appId: '1234567890'};
const TOKEN = 'ya29.secret-token';
const META = {id: 'f1', name: '團購.json', mimeType: 'application/json', size: '20', modifiedTime: '2026-11-01T00:00:00.000Z', version: '7', headRevisionId: 'r7'};
const json = (body, init = {}) => new Response(JSON.stringify(body), {status: init.status || 200, headers: Object.assign({'Content-Type': 'application/json'}, init.headers)});
const googleError = (status, reason) => json({error: {code: status, message: 'msg ' + reason, errors: [{reason}]}}, {status});

/** 依序比對路由的假 fetch；記錄每個請求。 */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = {url, method: init.method || 'GET', headers: init.headers || {}, body: init.body};
    calls.push(call);
    const index = routes.findIndex(r => (r.method || 'GET') === call.method && r.match(url));
    if (index < 0) throw new Error('unexpected request ' + call.method + ' ' + url);
    const route = routes[index];
    if (route.once) routes.splice(index, 1);
    return route.respond(call);
  };
  return {fetch, calls};
}

function fakeTokens({tokens = [TOKEN, 'ya29.second', 'ya29.third']} = {}) {
  const log = [];
  let i = 0;
  return {
    log,
    getToken({force = false} = {}) { log.push(force ? 'force' : 'get'); if (force) i++; return Promise.resolve(tokens[Math.min(i, tokens.length - 1)]); },
    revoke() { log.push('revoke'); return Promise.resolve(); },
    hasToken: () => true
  };
}

async function makeDrive(opts = {}) {
  const {fetch, calls} = fakeFetch(opts.routes || []);
  const tokens = opts.tokens || fakeTokens();
  const statuses = [];
  const scripts = [];
  const drive = D.create({
    config: opts.config || CONFIG,
    protocol: opts.protocol || 'https:',
    fetch,
    tokenProvider: tokens,
    pickFile: opts.pickFile || (async () => ({id: 'f1', name: '團購.json'})),
    loadScript: async src => { scripts.push(src); },
    confirm: opts.confirm || (() => { throw new Error('confirm should not be called'); }),
    onStatus: text => statuses.push(text),
    random: opts.random
  });
  if (opts.load !== false) assert.equal(await drive.ensureLoaded(), true);
  return {drive, calls, tokens, statuses, scripts};
}

const isMeta = id => url => url.startsWith('https://www.googleapis.com/drive/v3/files/' + id + '?fields=');
const isMedia = id => url => url.startsWith('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media');

// ---------------------------------------------------------------------------
// 純函式
// ---------------------------------------------------------------------------

test('availability：file:// 與未設定時停用，設定完整且為 http(s) 時可用', () => {
  assert.equal(D.availability(CONFIG, 'file:').reason, 'file-protocol');
  assert.equal(D.availability(CONFIG, 'file:').available, false);
  assert.match(D.availability(CONFIG, 'file:').message, /file:\/\//);
  assert.equal(D.availability({clientId: '', apiKey: '', appId: ''}, 'https:').reason, 'not-configured');
  assert.equal(D.availability(undefined, 'https:').reason, 'not-configured');
  assert.equal(D.availability({...CONFIG, appId: 'my-project'}, 'https:').reason, 'invalid-config');
  assert.match(D.availability({...CONFIG, clientId: 'x'}, 'https:').message, /clientId/);
  assert.equal(D.availability(CONFIG, 'about:').reason, 'unsupported-protocol');
  assert.deepEqual(D.availability(CONFIG, 'https:'), {available: true, reason: 'ok', message: ''});
  assert.equal(D.availability({...CONFIG, appId: 1234567890}, 'http:').available, true);
});

test('drive-config.js 預設為空設定（未設定 → 停用）', () => {
  const sandbox = {};
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'drive-config.js'), 'utf8');
  new Function('window', 'globalThis', src)(sandbox, sandbox);
  assert.deepEqual(sandbox.DRIVE_CONFIG, {clientId: '', apiKey: '', appId: ''});
  assert.equal(D.availability(sandbox.DRIVE_CONFIG, 'https:').reason, 'not-configured');
});

test('uploadStrategy：5 MB 以下 multipart，超過 resumable', () => {
  assert.equal(D.uploadStrategy(0), 'multipart');
  assert.equal(D.uploadStrategy(5 * 1024 * 1024), 'multipart');
  assert.equal(D.uploadStrategy(5 * 1024 * 1024 + 1), 'resumable');
  assert.equal(D.byteLength('團購'), 6);
});

test('buildMultipartBody：metadata 與內容兩段，內容原封不動', () => {
  const contents = '{"title":"團購","x":"a\\r\\nb"}';
  const {body, contentType} = D.buildMultipartBody({name: 'a.json', mimeType: 'application/json'}, contents, 'BOUND');
  assert.equal(contentType, 'multipart/related; boundary=BOUND');
  assert.equal(body,
    '--BOUND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.json","mimeType":"application/json"}\r\n' +
    '--BOUND\r\nContent-Type: application/json\r\n\r\n' + contents + '\r\n--BOUND--');
  assert.throws(() => D.buildMultipartBody({}, 'x--BOUND', 'BOUND'), /分隔字串/);
});

test('detectConflict：version 或 modifiedTime 不同即為衝突', () => {
  const loaded = {id: 'f1', version: '7', modifiedTime: 'T1'};
  assert.deepEqual(D.detectConflict(loaded, {id: 'f1', version: '7', modifiedTime: 'T1'}), {conflict: false, reason: 'none'});
  assert.deepEqual(D.detectConflict(loaded, {id: 'f1', version: '8', modifiedTime: 'T2'}), {conflict: true, reason: 'version'});
  assert.deepEqual(D.detectConflict({id: 'f1', modifiedTime: 'T1'}, {id: 'f1', modifiedTime: 'T2'}), {conflict: true, reason: 'modifiedTime'});
  assert.deepEqual(D.detectConflict({id: 'f1'}, {id: 'f1', version: '1'}), {conflict: false, reason: 'unknown'});
  assert.deepEqual(D.detectConflict(loaded, {id: 'other', version: '7'}), {conflict: true, reason: 'id'});
  assert.match(D.conflictMessage({name: 'a.json', modifiedTime: '2026-11-01T00:00:00Z'}), /「a\.json」.*已被其他人或其他裝置修改/);
});

test('errorMessage：401／403／404／網路錯誤轉成中文訊息，取消不是錯誤', () => {
  const http = (status, reason = '') => new D.DriveError('http', 'x', {status, reason});
  assert.equal(D.errorMessage(new D.DriveError('cancelled')), null);
  assert.match(D.errorMessage(http(401)), /重新登入/);
  assert.match(D.errorMessage(http(403, 'insufficientFilePermissions')), /沒有權限.*從 Google Drive 開啟/);
  assert.match(D.errorMessage(http(403, 'userRateLimitExceeded')), /太頻繁/);
  assert.match(D.errorMessage(http(403, 'storageQuotaExceeded')), /空間已滿/);
  assert.match(D.errorMessage(http(404, 'notFound')), /找不到.*已被刪除/);
  assert.match(D.errorMessage(http(503)), /HTTP 503/);
  assert.match(D.errorMessage(new D.DriveError('network')), /網路連線/);
  assert.equal(D.errorMessage(new D.DriveError('not-loaded')), '正在載入 Google 元件，請稍候再按一次。');
  assert.match(D.errorMessage(new D.DriveError('popup')), /彈出式視窗/);
  assert.match(D.errorMessage(new Error('boom')), /boom/);
});

test('retryOn401：401 時強制換 token 重試一次，第二次仍 401 就回傳該回應', async () => {
  const seen = [];
  const getToken = async force => (force ? 'new' : 'old');
  let res = await D.retryOn401(async t => { seen.push(t); return new Response('', {status: t === 'old' ? 401 : 200}); }, getToken);
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ['old', 'new']);
  seen.length = 0;
  res = await D.retryOn401(async t => { seen.push(t); return new Response('', {status: 401}); }, getToken);
  assert.equal(res.status, 401);
  assert.deepEqual(seen, ['old', 'new']);
  seen.length = 0;
  res = await D.retryOn401(async t => { seen.push(t); return new Response('', {status: 404}); }, getToken);
  assert.deepEqual(seen, ['old']);
});

test('nextOffsetFromRange 讀取 308 的 Range 標頭', () => {
  assert.equal(D.nextOffsetFromRange('bytes=0-262143', 99), 262144);
  assert.equal(D.nextOffsetFromRange(null, 99), 99);
  assert.equal(D.nextOffsetFromRange(null), 0, '沒有 Range 標頭代表尚未收到任何位元組');
  assert.equal(D.nextOffsetFromRange(''), 0);
});

// ---------------------------------------------------------------------------
// 可用性與載入
// ---------------------------------------------------------------------------

test('未設定或 file:// 時不載入任何外部程式，開啟／儲存回報停用原因', async () => {
  for (const [config, protocol, reason] of [[{clientId: '', apiKey: '', appId: ''}, 'https:', 'not-configured'], [CONFIG, 'file:', 'file-protocol']]) {
    const {drive, scripts, calls} = await makeDrive({config, protocol, load: false});
    assert.equal(await drive.ensureLoaded(), false);
    assert.equal(drive.isReady(), false);
    await assert.rejects(drive.openFromDrive(), err => err.code === reason);
    await assert.rejects(drive.saveAsToDrive({contents: '{}', name: 'a.json'}), err => err.code === reason);
    assert.deepEqual(scripts, []);
    assert.deepEqual(calls, []);
  }
});

test('尚未載入時不等待也不跳視窗：丟出 not-loaded 並開始載入', async () => {
  const {drive, scripts, tokens} = await makeDrive({load: false});
  assert.equal(drive.isReady(), false);
  await assert.rejects(drive.openFromDrive(), err => err.code === 'not-loaded');
  assert.deepEqual(tokens.log, []);
  assert.deepEqual(scripts.sort(), [D.GAPI_SRC, D.GSI_SRC].sort());
  assert.equal(await drive.ensureLoaded(), true);
  assert.equal(drive.isReady(), true);
});

test('ensureLoaded 以 gapi.load(picker) 與 GIS 建立 token client，失敗後可重試', async () => {
  let fail = true, inits = 0, pickerLoads = 0;
  const google = {accounts: {oauth2: {initTokenClient: () => { inits++; return {requestAccessToken() {}}; }}}};
  const gapi = {load: (name, cb) => { assert.equal(name, 'picker'); pickerLoads++; cb.callback(); }};
  const drive = D.create({config: CONFIG, protocol: 'https:', fetch: async () => { throw new Error('no'); },
    loadScript: async () => { if (fail) throw new Error('blocked'); }, getGoogle: () => google, getGapi: () => gapi});
  await assert.rejects(drive.ensureLoaded(), err => err.code === 'load-failed');
  fail = false;
  assert.equal(await drive.ensureLoaded(), true);
  assert.equal(inits, 1);
  assert.equal(pickerLoads, 1);
});

// ---------------------------------------------------------------------------
// 開啟
// ---------------------------------------------------------------------------

test('openFromDrive：同步發出 token 請求，Picker 選檔後下載內容並回傳 File-like 與 meta', async () => {
  const content = '{"title":"團購"}';
  const {drive, calls, tokens} = await makeDrive({routes: [
    {match: isMeta('f1'), respond: () => json(META)},
    {match: isMedia('f1'), respond: () => new Response(content)}
  ]});
  const promise = drive.openFromDrive();
  assert.deepEqual(tokens.log, ['get'], 'token 必須在點擊處理函式中同步請求');
  const result = await promise;
  assert.equal(result.file.name, '團購.json');
  assert.equal(result.file.size, Buffer.byteLength(content));
  assert.equal(await result.file.text(), content);
  assert.deepEqual(result.meta, {id: 'f1', name: '團購.json', modifiedTime: META.modifiedTime, version: '7'});
  assert.equal(calls[0].headers.Authorization, 'Bearer ' + TOKEN);
  assert.match(calls[0].url, /fields=id%2Cname%2CmimeType%2Csize%2CmodifiedTime%2Cversion%2CheadRevisionId/);
  assert.equal(drive.currentFile(), null, '確認開啟前不記住檔案');
  drive.setCurrentFile(result.meta);
  assert.deepEqual(drive.currentFile(), result.meta);
});

test('openFromDrive：Picker 取消或登入視窗關閉時回傳 null（不是錯誤）', async () => {
  let {drive, calls} = await makeDrive({pickFile: async () => null});
  assert.equal(await drive.openFromDrive(), null);
  assert.deepEqual(calls, []);
  const tokens = {getToken: () => Promise.reject(new D.DriveError('cancelled')), revoke: async () => {}};
  ({drive} = await makeDrive({tokens}));
  assert.equal(await drive.openFromDrive(), null);
});

test('openFromDrive：超過 100 MB 不下載', async () => {
  const {drive, calls} = await makeDrive({routes: [{match: isMeta('f1'), respond: () => json({...META, size: String(101 * 1024 * 1024)})}]});
  await assert.rejects(drive.openFromDrive(), err => err.code === 'too-large' && /100 MB/.test(D.errorMessage(err)));
  assert.equal(calls.length, 1);
});

test('401 時重新取得 token 重試一次；仍 401 就失敗', async () => {
  let {drive, calls, tokens} = await makeDrive({routes: [
    {match: isMeta('f1'), once: true, respond: () => googleError(401, 'authError')},
    {match: isMeta('f1'), respond: () => json(META)},
    {match: isMedia('f1'), respond: () => new Response('{}')}
  ]});
  const result = await drive.openFromDrive();
  assert.equal(await result.file.text(), '{}');
  assert.deepEqual(tokens.log, ['get', 'get', 'get', 'force', 'get']);
  assert.equal(calls[0].headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[1].headers.Authorization, 'Bearer ya29.second');

  ({drive, calls, tokens} = await makeDrive({routes: [{match: isMeta('f1'), respond: () => googleError(401, 'authError')}]}));
  await assert.rejects(drive.openFromDrive(), err => err.status === 401 && /重新登入/.test(D.errorMessage(err)));
  assert.equal(calls.length, 2, '只重試一次');
  assert.equal(tokens.log.filter(x => x === 'force').length, 1);
});

test('403／404／網路錯誤轉成中文訊息', async () => {
  for (const [respond, check] of [
    [() => googleError(403, 'insufficientFilePermissions'), /沒有權限/],
    [() => googleError(404, 'notFound'), /找不到/],
    [() => { throw new TypeError('Failed to fetch'); }, /網路連線/]
  ]) {
    const {drive} = await makeDrive({routes: [{match: isMeta('f1'), respond}]});
    await assert.rejects(drive.openFromDrive(), err => check.test(D.errorMessage(err)));
  }
});

// ---------------------------------------------------------------------------
// 儲存
// ---------------------------------------------------------------------------

test('saveAsToDrive：multipart POST 建立新檔，內容原封不動，之後成為 currentFile', async () => {
  const contents = JSON.stringify({title: '團購', orders: []}, null, 2);
  const created = {id: 'new1', name: '團購.json', modifiedTime: 'T1', version: '1', headRevisionId: 'r1'};
  const {drive, calls, tokens} = await makeDrive({random: () => 0.5, routes: [
    {method: 'POST', match: url => url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'), respond: () => json(created)}
  ]});
  const promise = drive.saveAsToDrive({contents, name: '團購.json'});
  assert.deepEqual(tokens.log, ['get']);
  const saved = await promise;
  assert.deepEqual(saved, {id: 'new1', name: '團購.json', modifiedTime: 'T1', version: '1'});
  assert.deepEqual(drive.currentFile(), saved);
  const [call] = calls;
  const boundary = /boundary=(.+)$/.exec(call.headers['Content-Type'])[1];
  assert.equal(call.body, D.buildMultipartBody({name: '團購.json', mimeType: 'application/json'}, contents, boundary).body);
  assert.match(call.url, /fields=id%2Cname/);
});

test('saveToDrive：沒有衝突時以 uploadType=media PATCH 覆蓋並更新 currentFile', async () => {
  const contents = '{"title":"團購"}';
  const {drive, calls} = await makeDrive({routes: [
    {match: isMeta('f1'), respond: () => json(META)},
    {method: 'PATCH', match: url => url.startsWith('https://www.googleapis.com/upload/drive/v3/files/f1?uploadType=media'), respond: () => json({...META, version: '8', modifiedTime: 'T9'})}
  ]});
  drive.setCurrentFile(META);
  const saved = await drive.saveToDrive({contents});
  assert.equal(saved.version, '8');
  assert.deepEqual(drive.currentFile(), {id: 'f1', name: '團購.json', modifiedTime: 'T9', version: '8'});
  assert.equal(calls[1].body, contents);
  assert.equal(calls[1].headers['Content-Type'], 'application/json; charset=UTF-8');
});

test('saveToDrive：檔案在開啟後被修改時詢問，拒絕則不上傳', async () => {
  const asked = [];
  const routes = [
    {match: isMeta('f1'), respond: () => json({...META, version: '9', modifiedTime: '2026-11-02T00:00:00Z'})},
    {method: 'PATCH', match: url => url.includes('/upload/drive/v3/files/f1?'), respond: () => json({...META, version: '10'})}
  ];
  let {drive, calls} = await makeDrive({routes: routes.slice(), confirm: m => { asked.push(m); return false; }});
  drive.setCurrentFile(META);
  assert.equal(await drive.saveToDrive({contents: '{}'}), null);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /已被其他人或其他裝置修改/);
  assert.equal(calls.length, 1, '拒絕後不上傳');
  assert.equal(drive.currentFile().version, '7');

  ({drive, calls} = await makeDrive({routes: routes.slice(), confirm: () => true}));
  drive.setCurrentFile(META);
  assert.equal((await drive.saveToDrive({contents: '{}'})).version, '10');
  assert.equal(calls.length, 2);
});

test('saveToDrive：沒有目前的 Drive 檔案時提示改用另存', async () => {
  const {drive, tokens} = await makeDrive();
  await assert.rejects(drive.saveToDrive({contents: '{}'}), err => err.code === 'no-current-file' && /另存到 Google Drive/.test(D.errorMessage(err)));
  assert.deepEqual(tokens.log, []);
});

test('超過 5 MB 改用 resumable：建立 session 後分段 PUT 到 session URI 並回報進度', async () => {
  const contents = '{"image":"' + 'x'.repeat(D.CHUNK_SIZE + 1024) + '"}';
  const total = Buffer.byteLength(contents);
  const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc';
  const received = [];
  const {drive, calls, statuses} = await makeDrive({routes: [
    {method: 'POST', match: url => url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields='),
      respond: () => new Response('', {status: 200, headers: {Location: SESSION}})},
    {method: 'PUT', match: url => url === SESSION, respond: call => {
      received.push(Buffer.from(call.body));
      const got = received.reduce((n, b) => n + b.length, 0);
      if (got < total) return new Response('', {status: 308, headers: {Range: 'bytes=0-' + (got - 1)}});
      return json({id: 'big1', name: 'big.json', modifiedTime: 'T1', version: '1'});
    }}
  ]});
  const saved = await drive.saveAsToDrive({contents, name: 'big.json'});
  assert.deepEqual(saved, {id: 'big1', name: 'big.json', modifiedTime: 'T1', version: '1'});
  const [init, put1, put2] = calls;
  assert.equal(init.headers['X-Upload-Content-Length'], String(total));
  assert.equal(init.headers['X-Upload-Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), {name: 'big.json', mimeType: 'application/json'});
  assert.equal(put1.headers['Content-Range'], 'bytes 0-' + (D.CHUNK_SIZE - 1) + '/' + total);
  assert.equal(put2.headers['Content-Range'], 'bytes ' + D.CHUNK_SIZE + '-' + (total - 1) + '/' + total);
  assert.equal(put1.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(Buffer.concat(received).toString('utf8'), contents, '上傳內容與原字串相同');
  assert.ok(statuses.some(s => /上傳到 Google Drive… \d+%/.test(s)));
});

test('resumable 覆蓋既有檔案用 PATCH 建立 session；伺服器只收到部分時從 Range 續傳', async () => {
  const contents = 'y'.repeat(D.RESUMABLE_THRESHOLD + 10);
  const total = contents.length;
  const SESSION = 'https://upload.example/session';
  let puts = 0;
  const {drive, calls} = await makeDrive({routes: [
    {match: isMeta('f1'), respond: () => json(META)},
    {method: 'PATCH', match: url => url.startsWith('https://www.googleapis.com/upload/drive/v3/files/f1?uploadType=resumable'),
      respond: () => new Response('', {status: 200, headers: {Location: SESSION}})},
    {method: 'PUT', match: url => url === SESSION, respond: () => {
      puts++;
      if (puts === 1) return new Response('', {status: 308, headers: {Range: 'bytes=0-999'}});
      return json({...META, version: '8'});
    }}
  ]});
  drive.setCurrentFile(META);
  assert.equal((await drive.saveToDrive({contents})).version, '8');
  assert.deepEqual(JSON.parse(calls[1].body), {});
  assert.equal(calls[2].headers['Content-Range'], 'bytes 0-' + (total - 1) + '/' + total);
  assert.equal(calls[3].headers['Content-Range'], 'bytes 1000-' + (total - 1) + '/' + total);
});

test('saveToDrive：2xx 回應沒有 id 時改查檔案資訊，不回傳 null 也不清掉 currentFile', async () => {
  let metaCalls = 0;
  const {drive, calls} = await makeDrive({routes: [
    {match: isMeta('f1'), respond: () => { metaCalls++; return json(metaCalls === 1 ? META : {...META, version: '8', modifiedTime: 'T8'}); }},
    {method: 'PATCH', match: url => url.includes('/upload/drive/v3/files/f1?uploadType=media'), respond: () => json({})}
  ]});
  drive.setCurrentFile(META);
  const saved = await drive.saveToDrive({contents: '{}'});
  assert.deepEqual(saved, {id: 'f1', name: '團購.json', modifiedTime: 'T8', version: '8'});
  assert.deepEqual(drive.currentFile(), saved);
  assert.equal(calls.length, 3);
});

test('saveToDrive：2xx 空主體且查不到資訊時仍保留原檔 id', async () => {
  let metaCalls = 0;
  const {drive} = await makeDrive({routes: [
    {match: isMeta('f1'), respond: () => (++metaCalls === 1 ? json(META) : googleError(500, 'backendError'))},
    {method: 'PATCH', match: url => url.includes('/upload/drive/v3/files/f1?uploadType=media'), respond: () => new Response('', {status: 200})}
  ]});
  drive.setCurrentFile(META);
  const saved = await drive.saveToDrive({contents: '{}'});
  assert.deepEqual(saved, {id: 'f1', name: '團購.json'});
  assert.equal(drive.currentFile().id, 'f1');
});

test('saveAsToDrive：2xx 回應沒有 id 時丟出 upload-unconfirmed，currentFile 不變', async () => {
  const {drive} = await makeDrive({routes: [
    {method: 'POST', match: url => url.includes('/upload/drive/v3/files?uploadType=multipart'), respond: () => json({})}
  ]});
  drive.setCurrentFile(META);
  await assert.rejects(drive.saveAsToDrive({contents: '{}', name: 'a.json'}),
    err => err.code === 'upload-unconfirmed' && /確認/.test(D.errorMessage(err)));
  assert.equal(drive.currentFile().id, 'f1');
});

test('resumable：308 沒有 Range 標頭時視為尚未收到，從 0 重傳', async () => {
  const contents = 'z'.repeat(D.CHUNK_SIZE + 10);
  const total = contents.length;
  const SESSION = 'https://upload.example/s2';
  let puts = 0;
  const {drive, calls} = await makeDrive({routes: [
    {method: 'POST', match: url => url.includes('uploadType=resumable'), respond: () => new Response('', {status: 200, headers: {Location: SESSION}})},
    {method: 'PUT', match: url => url === SESSION, respond: () => {
      puts++;
      if (puts === 1) return new Response('', {status: 308});
      if (puts === 2) return new Response('', {status: 308, headers: {Range: 'bytes=0-' + (D.CHUNK_SIZE - 1)}});
      return json({id: 'n1', name: 'n.json', version: '1'});
    }}
  ]});
  assert.equal((await drive.saveAsToDrive({contents, name: 'n.json'})).id, 'n1');
  assert.equal(calls[1].headers['Content-Range'], 'bytes 0-' + (D.CHUNK_SIZE - 1) + '/' + total);
  assert.equal(calls[2].headers['Content-Range'], 'bytes 0-' + (D.CHUNK_SIZE - 1) + '/' + total);
  assert.equal(calls[3].headers['Content-Range'], 'bytes ' + D.CHUNK_SIZE + '-' + (total - 1) + '/' + total);
});

test('resumable：建立 session 沒有 Location 標頭時回報 no-session', async () => {
  const {drive} = await makeDrive({routes: [
    {method: 'POST', match: url => url.includes('uploadType=resumable'), respond: () => new Response('', {status: 200})}
  ]});
  await assert.rejects(drive.saveAsToDrive({contents: 'q'.repeat(D.RESUMABLE_THRESHOLD + 1), name: 'a.json'}),
    err => err.code === 'no-session' && /尚未儲存/.test(D.errorMessage(err)) && !/HTTP/.test(D.errorMessage(err)));
});

test('下載途中串流中斷視為網路錯誤', async () => {
  const body = new ReadableStream({
    pull(controller) { controller.error(new TypeError('network error')); }
  });
  const {drive} = await makeDrive({routes: [
    {match: isMeta('f1'), respond: () => json(META)},
    {match: isMedia('f1'), respond: () => new Response(body, {status: 200})}
  ]});
  await assert.rejects(drive.openFromDrive(), err => err.code === 'network' && /網路連線/.test(D.errorMessage(err)));
});

test('同時兩次儲存：第二次丟出 busy，不重複上傳也不再請求 token；完成後可再存', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  let patches = 0;
  const {drive, tokens} = await makeDrive({routes: [
    {match: isMeta('f1'), respond: () => json(META)},
    {method: 'PATCH', match: url => url.includes('/upload/drive/v3/files/f1?uploadType=media'), respond: async () => { patches++; await gate; return json(META); }}
  ]});
  drive.setCurrentFile(META);
  const first = drive.saveToDrive({contents: '{}'});
  while (patches === 0) await new Promise(r => setImmediate(r));
  const tokenCalls = tokens.log.length;
  await assert.rejects(drive.saveToDrive({contents: '{}'}), err => err.code === 'busy' && /請等它完成/.test(D.errorMessage(err)));
  await assert.rejects(drive.openFromDrive(), err => err.code === 'busy');
  assert.equal(tokens.log.length, tokenCalls, 'busy 時不請求 token');
  release();
  await first;
  assert.equal(patches, 1);
  await drive.saveToDrive({contents: '{}'});
  assert.equal(patches, 2);
});

// ---------------------------------------------------------------------------
// token：只在記憶體、到期重新請求、登出撤銷
// ---------------------------------------------------------------------------

function fakeGoogle() {
  const requests = [], revoked = [];
  let config;
  const client = {requestAccessToken: opts => requests.push(opts)};
  const google = {accounts: {oauth2: {
    initTokenClient: c => { config = c; return client; },
    hasGrantedAllScopes: (resp, scope) => resp.scope === scope,
    revoke: (token, done) => { revoked.push(token); done(); }
  }}};
  return {google, requests, revoked, respond: r => config.callback(r), fail: type => config.error_callback({type}), config: () => config};
}

test('GIS token provider：同步請求、快取、約 1 小時到期後以 prompt:\'\' 重新請求、登出時撤銷', async () => {
  const g = fakeGoogle();
  let now = 1000;
  const p = D.createGisTokenProvider({google: g.google, clientId: CONFIG.clientId, now: () => now});
  assert.equal(g.config().scope, 'https://www.googleapis.com/auth/drive.file');
  const first = p.getToken();
  assert.deepEqual(g.requests, [{}], '第一次請求在呼叫當下同步送出');
  g.respond({access_token: 'tok1', expires_in: 3599, scope: D.SCOPE});
  assert.equal(await first, 'tok1');
  assert.equal(await p.getToken(), 'tok1');
  assert.equal(g.requests.length, 1, '有效 token 不重新請求');
  now += 3600 * 1000;
  const second = p.getToken();
  assert.deepEqual(g.requests[1], {prompt: ''});
  g.respond({access_token: 'tok2', expires_in: 3599, scope: D.SCOPE});
  assert.equal(await second, 'tok2');
  const forced = p.getToken({force: true});
  assert.deepEqual(g.requests[2], {prompt: ''});
  g.respond({access_token: 'tok3', expires_in: 3599, scope: D.SCOPE});
  assert.equal(await forced, 'tok3');
  await p.revoke();
  assert.deepEqual(g.revoked, ['tok3']);
  assert.equal(p.hasToken(), false);
});

test('GIS token provider：關閉視窗是取消、被阻擋是 popup、未授權範圍是 scope', async () => {
  const g = fakeGoogle();
  const p = D.createGisTokenProvider({google: g.google, clientId: CONFIG.clientId});
  let pending = p.getToken();
  g.fail('popup_closed');
  await assert.rejects(pending, err => D.isCancelled(err));
  pending = p.getToken();
  g.fail('popup_failed_to_open');
  await assert.rejects(pending, err => err.code === 'popup');
  pending = p.getToken();
  g.respond({access_token: 'x', expires_in: 3600, scope: 'other'});
  await assert.rejects(pending, err => err.code === 'scope');
  pending = p.getToken();
  g.respond({error: 'access_denied'});
  await assert.rejects(pending, err => D.isCancelled(err));
});

test('signOut 撤銷 token 並忘記目前的 Drive 檔案', async () => {
  const {drive, tokens} = await makeDrive();
  drive.setCurrentFile(META);
  await drive.signOut();
  assert.equal(drive.currentFile(), null);
  assert.deepEqual(tokens.log, ['revoke']);
});

test('token 不會被保存：模組不使用瀏覽器儲存空間，也不會出現在上傳內容或 currentFile 中', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'drive-storage.js'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '');
  for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'caches']) assert.ok(!code.includes(api), api);

  const contents = '{"title":"t"}';
  const {drive, calls} = await makeDrive({routes: [
    {method: 'POST', match: url => url.includes('uploadType=multipart'), respond: () => json({id: 'n', name: 'a.json', version: '1', modifiedTime: 'T'})}
  ]});
  const saved = await drive.saveAsToDrive({contents, name: 'a.json'});
  assert.ok(!JSON.stringify(saved).includes(TOKEN));
  assert.ok(!JSON.stringify(drive.currentFile()).includes(TOKEN));
  assert.ok(!calls[0].body.includes(TOKEN));
  assert.ok(!calls[0].url.includes(TOKEN), 'token 不放在網址');
  const uploadedContents = calls[0].body.split('\r\n\r\n')[2].replace(/\r\n--[^\r\n]+--$/, '');
  assert.equal(uploadedContents, contents, '不在訂單 JSON 中加入 Drive 資訊');
});

// ---------------------------------------------------------------------------
// token 請求沒有回呼（視窗被關閉卻沒通知）：不可永遠卡住
// ---------------------------------------------------------------------------

async function makeGisDrive(routes = []) {
  const g = fakeGoogle();
  const tokens = D.createGisTokenProvider({google: g.google, clientId: CONFIG.clientId});
  const {fetch, calls} = fakeFetch(routes);
  const drive = D.create({config: CONFIG, protocol: 'https:', fetch, tokenProvider: tokens,
    pickFile: async () => null, loadScript: async () => {}, onStatus: () => {}});
  await drive.ensureLoaded();
  return {g, drive, calls};
}

test('token 請求沒有回呼時，再按一次會取代前一個請求（前一個視為取消），新的動作可完成', async () => {
  const {g, drive} = await makeGisDrive();
  const first = drive.openFromDrive();
  assert.equal(g.requests.length, 1);
  const second = drive.openFromDrive();
  assert.equal(g.requests.length, 2, '等待 token 中再按：同步重新請求，不丟出 busy');
  assert.equal(await first, null, '被取代的動作回傳 null（取消）');
  g.respond({access_token: 'tok', expires_in: 3600, scope: D.SCOPE});
  assert.equal(await second, null, 'Picker 取消');
  // 完成後可再開始
  assert.equal(await drive.openFromDrive(), null);
});

test('token 請求沒有回呼時登出：等待中的動作結束（取消），之後可重新開始', async () => {
  const {g, drive} = await makeGisDrive();
  const stuck = drive.saveAsToDrive({contents: '{}', name: 'a.json'});
  await drive.signOut();
  assert.equal(await stuck, null);
  const again = drive.openFromDrive();
  assert.equal(g.requests.length, 2);
  g.respond({access_token: 'tok', expires_in: 3600, scope: D.SCOPE});
  assert.equal(await again, null);
});

test('onAuthorized 在取得 token 後、實際工作前呼叫；丟出錯誤即中止且不送出請求', async () => {
  const {g, drive, calls} = await makeGisDrive();
  const order = [];
  const pending = drive.saveAsToDrive({contents: '{}', name: 'a.json', onAuthorized: () => { order.push('auth'); throw new Error('本機忙碌'); }});
  assert.deepEqual(order, [], '等待 token 時尚未呼叫');
  g.respond({access_token: 'tok', expires_in: 3600, scope: D.SCOPE});
  await assert.rejects(pending, /本機忙碌/);
  assert.deepEqual(order, ['auth']);
  assert.equal(calls.length, 0);
});

test('瀏覽器用的 DriveStorage 外觀轉接 create() 實例的每一個方法', () => {
  const instance = D.create({config: CONFIG, protocol: 'https:', fetch: async () => { throw new Error('no network'); }, loadScript: async () => {}, getGoogle: () => undefined, getGapi: () => undefined, confirm: () => true});
  const missing = Object.keys(instance).filter(name => typeof instance[name] === 'function' && name !== 'availability' && typeof D[name] !== 'function');
  assert.deepEqual(missing, []);
  assert.equal(typeof D.availabilityStatus, 'function');
});
