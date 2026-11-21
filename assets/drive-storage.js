// Google Drive 開啟／儲存訂單檔案（classic script，支援 file:// 頁面載入；file:// 下功能會停用）。
// 所有 Google／網路存取都經由可注入的依賴（fetch、token provider、script loader、google/gapi 全域），
// 因此 Node 測試可以用假物件驗證，不會連到真正的 Google 服務。
// 對外只暴露全域 DriveStorage；Node 中以 module.exports 匯出。
//
// 隱私：access token 只存在記憶體（本模組的閉包變數），不寫入 localStorage、IndexedDB、cookie，
// 也不會寫進訂單 JSON；Drive 檔案資訊（id、版本）同樣只記在記憶體，上傳內容與呼叫端給的字串完全相同。
(function (root) {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const GSI_SRC = 'https://accounts.google.com/gsi/client';
  const GAPI_SRC = 'https://apis.google.com/js/api.js';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  /** 回傳／比對用的檔案欄位；size 用於下載前擋下過大的檔案與顯示進度。 */
  const META_FIELDS = 'id,name,mimeType,size,modifiedTime,version,headRevisionId';
  const JSON_MIME = 'application/json';
  /** 超過此位元組數改用 resumable upload（Drive 文件：multipart 適用 5 MB 以下）。 */
  const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;
  /** resumable 每段上傳大小，必須是 256 KiB 的倍數。 */
  const CHUNK_SIZE = 8 * 1024 * 1024;
  /** 與 openOrderFile 相同的上限，下載前先擋下。 */
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  /** token 到期前多久就視為過期，避免請求途中失效。 */
  const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;

  // ---------------------------------------------------------------------------
  // 錯誤
  // ---------------------------------------------------------------------------

  /** Drive 相關錯誤；code 為分類（cancelled、network、http…），HTTP 錯誤另帶 status 與 reason。 */
  class DriveError extends Error {
    constructor(code, message, extra) {
      super(message || code);
      this.name = 'DriveError';
      this.code = code;
      if (extra) Object.assign(this, extra);
    }
  }

  const isCancelled = error => Boolean(error && error.code === 'cancelled');

  // ---------------------------------------------------------------------------
  // 純函式
  // ---------------------------------------------------------------------------

  /** 檢查設定格式；回傳缺少或格式錯誤的欄位名稱陣列（空陣列代表設定完整）。 */
  function configProblems(config) {
    const c = config && typeof config === 'object' ? config : {};
    const problems = [];
    if (typeof c.clientId !== 'string' || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(c.clientId.trim())) problems.push('clientId');
    if (typeof c.apiKey !== 'string' || !/^[\w-]{10,}$/.test(c.apiKey.trim())) problems.push('apiKey');
    if (typeof c.appId !== 'string' && typeof c.appId !== 'number' || !/^\d+$/.test(String(c.appId).trim())) problems.push('appId');
    return problems;
  }

  /**
   * Drive 功能是否可用：需以 http(s) 開啟且設定完整。
   * 回傳 {available, reason, message}；reason 為 ok、file-protocol、unsupported-protocol、not-configured、invalid-config。
   */
  function availability(config, protocol) {
    if (protocol === 'file:') return {available: false, reason: 'file-protocol', message: '以 file:// 直接開啟頁面時無法使用 Google Drive，請改用 http(s) 網址開啟本頁。'};
    if (protocol !== 'https:' && protocol !== 'http:') return {available: false, reason: 'unsupported-protocol', message: '目前的網址無法使用 Google Drive，請改用 http(s) 網址開啟本頁。'};
    const c = config && typeof config === 'object' ? config : {};
    const empty = ['clientId', 'apiKey', 'appId'].every(k => c[k] === undefined || c[k] === null || String(c[k]).trim() === '');
    if (empty) return {available: false, reason: 'not-configured', message: 'Google Drive 尚未設定：請在 assets/drive-config.js 填入 clientId、apiKey 與 appId。'};
    const problems = configProblems(c);
    if (problems.length) return {available: false, reason: 'invalid-config', message: 'Google Drive 設定不完整或格式錯誤（' + problems.join('、') + '），請檢查 assets/drive-config.js。'};
    return {available: true, reason: 'ok', message: ''};
  }

  /** 字串的 UTF-8 位元組數。 */
  function byteLength(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
    return unescape(encodeURIComponent(text)).length;
  }

  /** 依上傳大小選擇 multipart（≤ 5 MB）或 resumable（> 5 MB）。 */
  function uploadStrategy(bytes) {
    return bytes > RESUMABLE_THRESHOLD ? 'resumable' : 'multipart';
  }

  /** 產生隨機的 multipart 分隔字串。 */
  function makeBoundary(random) {
    const rnd = typeof random === 'function' ? random : Math.random;
    return 'service-order-' + Array.from({length: 4}, () => Math.floor(rnd() * 0x100000000).toString(36)).join('');
  }

  /**
   * 建立 multipart/related 上傳主體（metadata JSON + 檔案內容）。
   * 內容原封不動放入，分隔字串若出現在內容中則丟出錯誤（呼叫端應換一個）。
   */
  function buildMultipartBody(metadata, contents, boundary, contentType = JSON_MIME) {
    if (!boundary || String(contents).includes('--' + boundary) || JSON.stringify(metadata).includes('--' + boundary)) throw new DriveError('boundary', 'multipart 分隔字串與內容衝突');
    const body = '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: ' + contentType + '\r\n\r\n' +
      contents + '\r\n' +
      '--' + boundary + '--';
    return {body, contentType: 'multipart/related; boundary=' + boundary};
  }

  /** 只保留要記在記憶體中的檔案資訊。 */
  function pickMeta(meta) {
    if (!meta || !meta.id) return null;
    const out = {id: String(meta.id), name: meta.name == null ? '' : String(meta.name)};
    if (meta.modifiedTime != null) out.modifiedTime = String(meta.modifiedTime);
    if (meta.version != null) out.version = String(meta.version);
    return out;
  }

  /**
   * 比對開啟時記下的檔案資訊與 Drive 上目前的資訊。
   * 兩邊都有 version 時比 version，否則比 modifiedTime；都無法比對時視為沒有衝突。
   * 回傳 {conflict, reason}，reason 為 version、modifiedTime、id、none、unknown。
   */
  function detectConflict(loaded, current) {
    if (!loaded || !current) return {conflict: false, reason: 'unknown'};
    if (loaded.id && current.id && String(loaded.id) !== String(current.id)) return {conflict: true, reason: 'id'};
    if (loaded.version != null && current.version != null) {
      return String(loaded.version) === String(current.version) ? {conflict: false, reason: 'none'} : {conflict: true, reason: 'version'};
    }
    if (loaded.modifiedTime != null && current.modifiedTime != null) {
      return String(loaded.modifiedTime) === String(current.modifiedTime) ? {conflict: false, reason: 'none'} : {conflict: true, reason: 'modifiedTime'};
    }
    return {conflict: false, reason: 'unknown'};
  }

  /** 覆蓋前的衝突確認文字。 */
  function conflictMessage(current) {
    const name = current && current.name ? '「' + current.name + '」' : '這個檔案';
    let when = '';
    if (current && current.modifiedTime) {
      const date = new Date(current.modifiedTime);
      when = Number.isNaN(date.getTime()) ? '' : '（最後修改：' + date.toLocaleString('zh-TW') + '）';
    }
    return 'Google Drive 上的' + name + '在你開啟之後已被其他人或其他裝置修改' + when + '。\n' +
      '繼續儲存會覆蓋那些變更，且無法在此頁面復原。\n確定要覆蓋嗎？（按「取消」則不儲存）';
  }

  /**
   * 把錯誤轉成 zh-Hant 訊息；使用者取消不是錯誤，回傳 null。
   */
  function errorMessage(error) {
    if (!error) return '發生未知錯誤。';
    if (isCancelled(error)) return null;
    switch (error.code) {
      case 'file-protocol':
      case 'unsupported-protocol':
      case 'not-configured':
      case 'invalid-config':
        return error.message;
      case 'not-loaded': return '正在載入 Google 元件，請稍候再按一次。';
      case 'load-failed': return '無法載入 Google 元件，請檢查網路連線（或關閉阻擋 Google 的擴充功能）後再試。';
      case 'popup': return 'Google 登入視窗被瀏覽器阻擋，請允許此網站開啟彈出式視窗後再按一次。';
      case 'auth': return 'Google 登入失敗' + (error.detail ? '（' + error.detail + '）' : '') + '，請再試一次。';
      case 'scope': return '未授予存取 Google Drive 檔案的權限，請重新登入並勾選允許。';
      case 'network': return '無法連線到 Google Drive，請檢查網路連線後再試。';
      case 'no-current-file': return '目前的訂單不是從 Google Drive 開啟或儲存的，請改用「另存到 Google Drive」。';
      case 'too-large': return '含附圖的訂單檔案超過 100 MB。';
      case 'upload-incomplete': return '上傳未完成（Google Drive 未確認收到完整檔案），訂單尚未儲存，請再試一次。';
      case 'busy': return 'Google Drive 正在處理上一個動作，請等它完成後再試。';
      case 'no-session': return '無法開始上傳（Google Drive 沒有回傳上傳位置），訂單尚未儲存，請再試一次。';
      case 'upload-unconfirmed': return '檔案可能已上傳，但 Google Drive 沒有回傳檔案資訊；請到 Google Drive 確認，必要時以「從 Google Drive 開啟」重新開啟該檔案。';
    }
    if (error.code === 'http') {
      const status = error.status;
      const reason = String(error.reason || '');
      if (status === 401) return 'Google 登入已過期或無效，請再按一次重新登入。';
      if (status === 403 && /storageQuotaExceeded/i.test(reason)) return 'Google Drive 儲存空間已滿，無法儲存。';
      if ((status === 403 && /rateLimit/i.test(reason)) || status === 429) return 'Google Drive 請求太頻繁，請稍候再試。';
      if (status === 403) return '沒有權限存取這個 Google Drive 檔案。本頁只能讀寫透過「從 Google Drive 開啟」選取，或由本頁建立的檔案。';
      if (status === 404) return '找不到這個 Google Drive 檔案：可能已被刪除，或本頁沒有存取權（本頁只能存取透過「從 Google Drive 開啟」選取或由本頁建立的檔案）。';
      if (status >= 500) return 'Google Drive 暫時無法處理請求（HTTP ' + status + '），請稍後再試。';
      return 'Google Drive 回應錯誤（HTTP ' + status + (error.detail ? '：' + error.detail : '') + '）。';
    }
    return 'Google Drive 發生錯誤：' + (error.message || error.name || String(error));
  }

  /**
   * 送出請求；回應為 401 時強制重新取得 token 並重試一次。
   * send(token) 回傳 Response；getToken(force) 回傳 token。第二次仍 401 就原樣回傳給呼叫端處理。
   */
  async function retryOn401(send, getToken) {
    const response = await send(await getToken(false));
    if (response.status !== 401) return response;
    return send(await getToken(true));
  }

  /** 把非 2xx 回應轉成 DriveError（讀取 Google 錯誤格式中的 reason）。 */
  async function httpError(response) {
    let reason = '', detail = '';
    try {
      const body = await response.json();
      const err = body && body.error;
      if (err && typeof err === 'object') {
        reason = (err.errors && err.errors[0] && err.errors[0].reason) || err.status || '';
        detail = err.message || '';
      } else if (typeof err === 'string') {
        reason = err;
      }
    } catch { /* 非 JSON 錯誤主體 */ }
    return new DriveError('http', 'HTTP ' + response.status + (detail ? ': ' + detail : ''), {status: response.status, reason, detail});
  }

  /**
   * 從 resumable 308 回應的 Range 標頭（bytes=0-N）推得下一個要上傳的位元組位置。
   * 依 Drive 文件，沒有 Range 標頭代表伺服器尚未收到任何位元組，因此預設從 0 重傳（fallback 預設 0）。
   */
  function nextOffsetFromRange(range, fallback = 0) {
    const match = /bytes=0-(\d+)/.exec(range || '');
    return match ? Number(match[1]) + 1 : fallback;
  }

  /** 讀取 JSON 回應主體；空主體或非 JSON 時回傳 {}（成功的上傳回應可能沒有主體）。 */
  async function readJson(response) {
    try {
      const body = await response.json();
      return body && typeof body === 'object' ? body : {};
    } catch {
      return {};
    }
  }

  // ---------------------------------------------------------------------------
  // 瀏覽器預設依賴（只在使用時才建立；Node 測試全部注入假物件）
  // ---------------------------------------------------------------------------

  /** 以 <script> 載入外部程式；同一網址只載入一次。 */
  function domScriptLoader(doc) {
    const loading = new Map();
    return src => {
      if (loading.has(src)) return loading.get(src);
      const promise = new Promise((resolve, reject) => {
        const script = doc.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => { loading.delete(src); script.remove(); reject(new DriveError('load-failed', '無法載入 ' + src)); };
        doc.head.appendChild(script);
      });
      loading.set(src, promise);
      return promise;
    };
  }

  /**
   * 以 Google Identity Services token client 取得 access token（只存在記憶體）。
   * getToken() 在需要時「同步」呼叫 requestAccessToken，呼叫端必須在點擊事件中直接呼叫以保留使用者啟用狀態。
   */
  function createGisTokenProvider({google, clientId, now = Date.now}) {
    const oauth2 = google.accounts.oauth2;
    let token = null, expiresAt = 0, granted = false, pending = null;
    const settle = (fn, value) => { const p = pending; pending = null; if (p) p[fn](value); };
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: response => {
        if (!response || response.error) {
          const code = response && response.error === 'access_denied' ? 'cancelled' : 'auth';
          settle('reject', new DriveError(code, 'token error', {detail: response && (response.error_description || response.error)}));
          return;
        }
        if (typeof oauth2.hasGrantedAllScopes === 'function' && !oauth2.hasGrantedAllScopes(response, SCOPE)) {
          settle('reject', new DriveError('scope', 'drive.file scope not granted'));
          return;
        }
        token = response.access_token;
        expiresAt = now() + Math.max(0, Number(response.expires_in || 3600) * 1000 - TOKEN_EXPIRY_MARGIN_MS);
        granted = true;
        settle('resolve', token);
      },
      error_callback: error => {
        const type = error && error.type;
        if (type === 'popup_closed') settle('reject', new DriveError('cancelled', 'popup closed'));
        else if (type === 'popup_failed_to_open') settle('reject', new DriveError('popup', 'popup blocked'));
        else settle('reject', new DriveError('auth', 'token client error', {detail: type || ''}));
      }
    });
    return {
      getToken({force = false} = {}) {
        if (!force && token && now() < expiresAt) return Promise.resolve(token);
        // 前一次請求若沒有回呼（例如舊瀏覽器關閉視窗時不通知），視為取消，避免永遠卡住。
        if (pending) settle('reject', new DriveError('cancelled', 'superseded'));
        token = null;
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        pending = {promise, resolve, reject};
        // 曾經授權過（含過期或 401）就用 prompt:'' 靜默更新；第一次使用預設流程（必要時顯示同意畫面）。
        client.requestAccessToken(granted ? {prompt: ''} : {});
        return promise;
      },
      hasToken: () => Boolean(token && now() < expiresAt),
      isPending: () => Boolean(pending),
      revoke() {
        const current = token;
        token = null; expiresAt = 0; granted = false;
        // 登出時仍在等待的 token 請求一併視為取消，讓等待中的動作結束。
        if (pending) settle('reject', new DriveError('cancelled', 'signed out'));
        if (!current) return Promise.resolve();
        return new Promise(resolve => oauth2.revoke(current, () => resolve()));
      }
    };
  }

  /** 以 Google Picker 選擇 .json 檔案；取消回傳 null。 */
  function createGooglePicker({google, apiKey, appId}) {
    return token => new Promise(resolve => {
      const picker = google.picker;
      const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(JSON_MIME).setIncludeFolders(true);
      const built = new picker.PickerBuilder()
        .addView(view)
        .setAppId(String(appId))
        .setDeveloperKey(apiKey)
        .setOAuthToken(token)
        .setLocale('zh-TW')
        .setTitle('從 Google Drive 開啟訂單（.json）')
        .setCallback(data => {
          const action = data[picker.Response.ACTION];
          if (action === picker.Action.PICKED) {
            const doc = data[picker.Response.DOCUMENTS][0];
            resolve({id: doc[picker.Document.ID], name: doc[picker.Document.NAME]});
          } else if (action === picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();
      built.setVisible(true);
    });
  }

  // ---------------------------------------------------------------------------
  // 實例
  // ---------------------------------------------------------------------------

  /**
   * 建立 Drive 存取實例。deps：
   *   config、protocol：設定與 location.protocol
   *   fetch(url, init)：網路請求
   *   loadScript(src)：載入外部程式（回傳 Promise）
   *   getGoogle()、getGapi()：取得 window.google／window.gapi
   *   tokenProvider：{getToken({force}), revoke(), hasToken()}（可省略，載入後由 GIS 建立）
   *   pickFile(token)：回傳 {id, name} 或 null（可省略，載入後由 Google Picker 建立）
   *   confirm(message)：覆蓋衝突時詢問；onStatus(text)：進度訊息；now()、random()
   */
  function create(deps) {
    const d = Object.assign({now: Date.now, random: Math.random, onStatus: () => {}, confirm: () => false}, deps || {});
    let tokens = d.tokenProvider || null;
    let pickFile = d.pickFile || null;
    let loadPromise = null, loaded = false, current = null, busy = false, phase = null, operation = 0;

    const status = () => availability(d.config, d.protocol);

    function unavailableError() {
      const s = status();
      return new DriveError(s.reason, s.message);
    }

    /** 載入 Google 元件（只在使用者第一次打開開啟／儲存選單時呼叫）。不可用時回傳 false，不載入任何外部程式。 */
    function ensureLoaded() {
      if (!status().available) return Promise.resolve(false);
      if (loaded) return Promise.resolve(true);
      if (loadPromise) return loadPromise;
      loadPromise = (async () => {
        try {
          await Promise.all([d.loadScript(GSI_SRC), d.loadScript(GAPI_SRC)]);
          if (!pickFile) {
            const gapi = d.getGapi();
            await new Promise((resolve, reject) => gapi.load('picker', {callback: resolve, onerror: () => reject(new DriveError('load-failed', 'picker'))}));
            pickFile = createGooglePicker({google: d.getGoogle(), apiKey: d.config.apiKey.trim(), appId: String(d.config.appId).trim()});
          }
          if (!tokens) tokens = createGisTokenProvider({google: d.getGoogle(), clientId: d.config.clientId.trim(), now: d.now});
          loaded = true;
          return true;
        } catch (error) {
          loadPromise = null;
          throw error instanceof DriveError ? error : new DriveError('load-failed', error && error.message);
        }
      })();
      return loadPromise;
    }

    const isReady = () => loaded && status().available;

    /**
     * 同步檢查是否可以開始（必須在點擊事件中同步呼叫，才能保留彈出視窗所需的使用者啟用狀態）。
     * 尚未載入時開始載入並丟出 not-loaded，讓 UI 顯示「請稍候再按一次」，而不是等載入完再跳視窗。
     */
    function assertReady() {
      if (!status().available) throw unavailableError();
      if (!loaded) {
        ensureLoaded().catch(() => {});
        throw new DriveError('not-loaded', '正在載入 Google 元件');
      }
    }

    async function send(url, init) {
      try {
        return await d.fetch(url, init);
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new DriveError('network', error && error.message, {cause: error});
      }
    }

    /** 帶 Authorization 的請求，401 時重新取得 token 並重試一次；非 2xx（含 308 以外）轉成 DriveError。 */
    async function authed(url, init = {}, okStatuses = []) {
      const response = await retryOn401(
        token => send(url, Object.assign({}, init, {headers: Object.assign({}, init.headers, {Authorization: 'Bearer ' + token})})),
        force => tokens.getToken({force})
      );
      if (!response.ok && !okStatuses.includes(response.status)) throw await httpError(response);
      return response;
    }

    async function getMeta(id) {
      const response = await authed(API + '/files/' + encodeURIComponent(id) + '?fields=' + encodeURIComponent(META_FIELDS) + '&supportsAllDrives=true');
      return response.json();
    }

    /** 下載內容；可讀取串流時回報進度。 */
    async function readText(response, total, onStatus) {
      try {
        return await readTextStream(response, total, onStatus);
      } catch (error) {
        // 下載途中斷線（fetch 已回應後串流讀取失敗）也視為網路錯誤。
        if (error instanceof DriveError || (error && error.name === 'AbortError')) throw error;
        throw new DriveError('network', error && error.message, {cause: error});
      }
    }

    async function readTextStream(response, total, onStatus) {
      if (!response.body || typeof response.body.getReader !== 'function' || typeof TextDecoder === 'undefined') return response.text();
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let text = '', received = 0, lastStep = -1;
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        received += value.byteLength;
        text += decoder.decode(value, {stream: true});
        if (total > 0) {
          const step = Math.floor(received / total * 10);
          if (step !== lastStep && step < 10) { lastStep = step; onStatus('正在從 Google Drive 下載… ' + step * 10 + '%'); }
        }
      }
      return text + decoder.decode();
    }

    /** multipart（新檔）或 media（覆蓋）上傳；回傳 Drive 檔案資訊。 */
    async function simpleUpload({id, name, contents}) {
      const fields = '&fields=' + encodeURIComponent(META_FIELDS) + '&supportsAllDrives=true';
      if (id) {
        const response = await authed(UPLOAD_API + '/files/' + encodeURIComponent(id) + '?uploadType=media' + fields, {
          method: 'PATCH', headers: {'Content-Type': JSON_MIME + '; charset=UTF-8'}, body: contents
        });
        return readJson(response);
      }
      let multipart;
      for (let attempt = 0; !multipart; attempt++) {
        try { multipart = buildMultipartBody({name, mimeType: JSON_MIME}, contents, makeBoundary(d.random)); }
        catch (error) { if (attempt >= 4) throw error; }
      }
      const response = await authed(UPLOAD_API + '/files?uploadType=multipart' + fields, {
        method: 'POST', headers: {'Content-Type': multipart.contentType}, body: multipart.body
      });
      return readJson(response);
    }

    /** resumable 上傳：先建立 session，再以 Content-Range 分段 PUT 到 session URI，並回報進度。 */
    async function resumableUpload({id, name, bytes, onStatus}) {
      const total = bytes.byteLength;
      const fields = '&fields=' + encodeURIComponent(META_FIELDS) + '&supportsAllDrives=true';
      const url = id
        ? UPLOAD_API + '/files/' + encodeURIComponent(id) + '?uploadType=resumable' + fields
        : UPLOAD_API + '/files?uploadType=resumable' + fields;
      const metadata = id ? {} : {name, mimeType: JSON_MIME};
      const init = await authed(url, {
        method: id ? 'PATCH' : 'POST',
        headers: {'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': JSON_MIME, 'X-Upload-Content-Length': String(total)},
        body: JSON.stringify(metadata)
      });
      const sessionUri = init.headers.get('Location') || init.headers.get('location');
      if (!sessionUri) throw new DriveError('no-session', 'missing resumable session URI', {status: init.status});
      let offset = 0, requests = 0;
      const maxRequests = Math.ceil(total / CHUNK_SIZE) * 3 + 3;
      while (offset < total) {
        if (++requests > maxRequests) throw new DriveError('upload-incomplete', 'too many resumable requests');
        const end = Math.min(offset + CHUNK_SIZE, total);
        onStatus('正在上傳到 Google Drive… ' + Math.floor(offset / total * 100) + '%（' + (offset / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB）');
        const response = await authed(sessionUri, {
          method: 'PUT',
          headers: {'Content-Type': JSON_MIME, 'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + total},
          body: bytes.subarray(offset, end)
        }, [308]);
        if (response.status !== 308) return readJson(response);
        // 308 表示尚未完成；Range 標頭為伺服器已收到的範圍，沒有 Range 代表一個位元組都沒收到，從 0 重傳。
        offset = nextOffsetFromRange(response.headers.get('Range'), 0);
      }
      // 已送完所有位元組卻仍回 308：查詢一次狀態取得最終結果。
      const check = await authed(sessionUri, {method: 'PUT', headers: {'Content-Range': 'bytes */' + total}}, [308]);
      if (check.status !== 308) return readJson(check);
      throw new DriveError('upload-incomplete', 'upload incomplete');
    }

    async function upload({id, name, contents, onStatus}) {
      const bytes = new TextEncoder().encode(contents);
      if (uploadStrategy(bytes.byteLength) === 'resumable') return resumableUpload({id, name, bytes, onStatus});
      onStatus('正在上傳到 Google Drive…');
      return simpleUpload({id, name, contents});
    }

    /**
     * 共同流程：同步檢查並（必要時）同步發出 token 請求，再執行 work；使用者取消回傳 null。
     * 同一時間只允許一個開啟／儲存動作：已取得 token、正在選檔／下載／上傳時再呼叫會丟出 busy（不會重複上傳）。
     * 但若前一個動作還在等 token（登入視窗可能已被關閉卻沒有任何回呼；包括工作中途因過期或 401 重新登入），新的點擊會取代它：
     * 重新發出 token 請求，前一個動作視為取消（回傳 null），避免永遠卡在「處理中」。
     * onAuthorized()：取得 token、開始實際工作前同步呼叫；丟出錯誤即中止（例如本機開啟／儲存正在進行）。
     */
    /** 進行中的動作正在等待 Google 登入（token 請求尚未回呼）。 */
    function isWaitingForToken() {
      return busy && (phase === 'token' || Boolean(tokens && typeof tokens.isPending === 'function' && tokens.isPending()));
    }

    function run(work, {onAuthorized} = {}) {
      let tokenPromise;
      try {
        assertReady();
        if (busy && !isWaitingForToken()) throw new DriveError('busy', 'another Drive operation is in progress');
        tokenPromise = tokens.getToken({force: false});
      } catch (error) {
        return Promise.reject(error);
      }
      const id = ++operation;
      busy = true;
      phase = 'token';
      return (async () => {
        try {
          await tokenPromise;
          if (id !== operation) return null;
          phase = 'work';
          if (onAuthorized) onAuthorized();
          return await work();
        } catch (error) {
          if (isCancelled(error)) return null;
          throw error;
        } finally {
          if (id === operation) { busy = false; phase = null; }
        }
      })();
    }

    /**
     * 從 Drive 選擇並下載訂單檔。回傳 {file: {name, size, text()}, meta}，取消回傳 null。
     * 不會自動記住檔案：呼叫端確認開啟後再呼叫 setCurrentFile(meta)。
     */
    function openFromDrive(options = {}) {
      const onStatus = options.onStatus || d.onStatus;
      return run(async () => {
        const token = await tokens.getToken({force: false});
        const picked = await pickFile(token);
        if (!picked || !picked.id) return null;
        onStatus('正在從 Google Drive 下載…');
        const meta = await getMeta(picked.id);
        if (Number(meta.size) > MAX_FILE_BYTES) throw new DriveError('too-large', 'too large');
        const response = await authed(API + '/files/' + encodeURIComponent(picked.id) + '?alt=media&supportsAllDrives=true');
        const text = await readText(response, Number(meta.size) || 0, onStatus);
        const size = byteLength(text);
        const name = meta.name || picked.name || 'drive.json';
        return {file: {name, size, text: () => Promise.resolve(text)}, meta: pickMeta(meta)};
      }, {onAuthorized: options.onAuthorized});
    }

    /**
     * 覆蓋目前的 Drive 檔案。覆蓋前取得最新資訊；若在開啟後被修改，先以 confirm 詢問，拒絕則回傳 null。
     * 成功回傳新的檔案資訊並更新 currentFile()。
     */
    function saveToDrive({contents, meta, onStatus, confirmOverwrite, onAuthorized} = {}) {
      const target = meta || current;
      const report = onStatus || d.onStatus;
      const ask = confirmOverwrite || d.confirm;
      if (!target || !target.id) {
        try { assertReady(); } catch (error) { return Promise.reject(error); }
        return Promise.reject(new DriveError('no-current-file', 'no current Drive file'));
      }
      return run(async () => {
        report('正在檢查 Google Drive 上的檔案…');
        const latest = await getMeta(target.id);
        if (detectConflict(target, latest).conflict && !ask(conflictMessage(latest))) return null;
        let saved = pickMeta(await upload({id: target.id, contents, onStatus: report}));
        if (!saved) {
          // 上傳已成功（2xx）但回應沒有檔案資訊：改查一次目前的資訊；仍查不到就保留原 id／名稱（沒有版本，下次不做衝突比對）。
          try { saved = pickMeta(await getMeta(target.id)); } catch (error) { if (isCancelled(error)) throw error; }
          if (!saved || saved.id !== String(target.id)) saved = {id: String(target.id), name: target.name == null ? '' : String(target.name)};
        }
        current = saved;
        return Object.assign({}, saved);
      }, {onAuthorized});
    }

    /** 在 Drive 建立新檔案（名稱由呼叫端提供，例如 orderFilename()）；成功後成為 currentFile()。 */
    function saveAsToDrive({contents, name, onStatus, onAuthorized} = {}) {
      const report = onStatus || d.onStatus;
      return run(async () => {
        const saved = pickMeta(await upload({name: name || '代購紀錄.json', contents, onStatus: report}));
        // 2xx 但沒有回傳檔案 id：無法得知新檔在哪裡，不可回傳 null（那代表取消），也不改動 currentFile。
        if (!saved) throw new DriveError('upload-unconfirmed', 'upload response has no file id');
        current = saved;
        return Object.assign({}, saved);
      }, {onAuthorized});
    }

    /** 登出：撤銷 token 並忘記目前的 Drive 檔案。 */
    async function signOut() {
      current = null;
      if (tokens && typeof tokens.revoke === 'function') await tokens.revoke();
    }

    return {
      availability: status,
      ensureLoaded,
      isReady,
      openFromDrive,
      saveToDrive,
      saveAsToDrive,
      signOut,
      currentFile: () => (current ? Object.assign({}, current) : null),
      setCurrentFile: meta => { current = pickMeta(meta); },
      clearCurrentFile: () => { current = null; },
      isWaitingForToken,
      isSignedIn: () => Boolean(tokens && typeof tokens.hasToken === 'function' && tokens.hasToken())
    };
  }

  /** 瀏覽器中的預設依賴。 */
  function browserDeps(win) {
    return {
      config: win.DRIVE_CONFIG,
      protocol: win.location && win.location.protocol,
      fetch: (url, init) => win.fetch(url, init),
      loadScript: domScriptLoader(win.document),
      getGoogle: () => win.google,
      getGapi: () => win.gapi,
      confirm: message => win.confirm(message)
    };
  }

  let defaultInstance = null;
  const instance = () => defaultInstance || (defaultInstance = create(browserDeps(root)));

  const DriveStorage = {
    // 常數
    SCOPE, GSI_SRC, GAPI_SRC, META_FIELDS, RESUMABLE_THRESHOLD, CHUNK_SIZE, MAX_FILE_BYTES,
    // 純函式與工具
    DriveError, isCancelled, configProblems, availability, byteLength, uploadStrategy, makeBoundary,
    buildMultipartBody, pickMeta, detectConflict, conflictMessage, errorMessage, retryOn401, httpError, readJson,
    nextOffsetFromRange, createGisTokenProvider, createGooglePicker, create,
    // 瀏覽器預設實例（第一次使用時才建立，不會在頁面載入時載入任何 Google 程式）
    availabilityStatus: () => instance().availability(),
    ensureLoaded: () => instance().ensureLoaded(),
    isReady: () => instance().isReady(),
    openFromDrive: options => instance().openFromDrive(options),
    saveToDrive: options => instance().saveToDrive(options),
    saveAsToDrive: options => instance().saveAsToDrive(options),
    signOut: () => instance().signOut(),
    currentFile: () => instance().currentFile(),
    setCurrentFile: meta => instance().setCurrentFile(meta),
    clearCurrentFile: () => instance().clearCurrentFile(),
    isWaitingForToken: () => instance().isWaitingForToken(),
    isSignedIn: () => instance().isSignedIn()
  };

  root.DriveStorage = DriveStorage;
  if (typeof module !== 'undefined' && module.exports) module.exports = DriveStorage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
