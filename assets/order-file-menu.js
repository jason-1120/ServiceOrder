// 「開啟訂單」「儲存訂單」選單與 Google Drive 動作（classic script，在 system-core.js 之後載入）。
// 本機開啟／儲存直接呼叫 system-core.js 的 openLocalOrder()／saveLocalOrder()，行為與原本按鈕完全相同。
// Google 元件只在使用者第一次打開選單時才載入；登入視窗與 Picker 必須在選單項目的 click 中同步觸發。
(function (root) {
  'use strict';

  /**
   * 依目前狀態決定 Drive 選單項目（純函式，Node 測試可直接呼叫）。
   * availability：DriveStorage.availabilityStatus() 的結果；currentFile：{id,name} 或 null；signedIn：是否有有效 token。
   */
  function driveMenuModel({availability, currentFile, signedIn} = {}) {
    const usable = Boolean(availability && availability.available);
    const reason = usable ? '' : (availability && availability.message) || 'Google Drive 目前無法使用。';
    const hasFile = usable && Boolean(currentFile && currentFile.id);
    return {
      openDrive: {disabled: !usable, title: reason},
      saveBack: {
        disabled: !hasFile,
        label: hasFile ? '存回 Google Drive（' + (currentFile.name || '未命名') + '）' : '存回 Google Drive',
        title: !usable ? reason : hasFile ? '覆蓋 Google Drive 上的「' + (currentFile.name || '未命名') + '」' : '目前的訂單不是從 Google Drive 開啟或儲存的，請改用「另存到 Google Drive」。'
      },
      saveAsDrive: {disabled: !usable, title: reason},
      signOut: {hidden: !(usable && signedIn)}
    };
  }

  /**
   * Drive 存檔完成後該怎麼處理（純函式）。
   * 存檔期間若使用者以本機開啟或拖曳換成另一份訂單（generation 已改變），存好的 Drive 檔案不可再成為目前檔案，
   * 否則之後「存回」會把另一份訂單覆蓋到這個 Drive 檔案。
   */
  function driveSaveOutcome(saved, startGeneration, currentGeneration) {
    if (!saved) return 'cancelled';
    return startGeneration === currentGeneration ? 'saved' : 'replaced';
  }

  /**
   * Drive 動作與共用的「開啟／儲存進行中」旗標（system-core.js 的 orderPickerBusy）之間的協調（Node 測試可直接呼叫）。
   * 旗標只在取得 Google token 之後才佔用：登入視窗可能被關閉卻沒有任何回呼，若一開始就佔用，本機開啟／儲存會永遠沒有反應。
   * 等待 token 期間再按一次 Drive 項目會取代前一個請求（DriveStorage 負責），被取代的動作安靜地結束。
   * flag：{get(), set(value)}。回傳 {begin(), cancelPending()}；begin() 的結果傳給 DriveStorage 的 onAuthorized，結束時呼叫 release()。
   */
  function createDriveLocks(flag) {
    let seq = 0;
    return {
      begin() {
        const lock = {seq: ++seq, held: false};
        lock.onAuthorized = () => {
          if (flag.get()) throw new Error('本機開啟或儲存正在進行中，請等它完成後再試。');
          flag.set(true);
          lock.held = true;
        };
        lock.release = () => { if (lock.held) { lock.held = false; flag.set(false); } };
        // 被後來的點擊取代（或登出取消）的動作不顯示「已取消」，避免蓋掉新動作的訊息。
        lock.superseded = () => lock.seq !== seq;
        return lock;
      },
      cancelPending() { seq++; }
    };
  }

  const api = {driveMenuModel, driveSaveOutcome, createDriveLocks};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OrderFileMenu = api;

  // 以下為瀏覽器 UI；Node 測試沒有 document，只匯出純函式。
  if (typeof document === 'undefined' || !document.getElementById('openMenuList')) return;

  const $ = id => document.getElementById(id);
  const drive = root.DriveStorage || null;
  const DE = drive || {errorMessage: () => 'Google Drive 目前無法使用。', isCancelled: () => false};
  let loadError = null;

  // ---------------------------------------------------------------------------
  // 選單（menu button 模式：aria-expanded、方向鍵、Escape、點外面關閉）
  // ---------------------------------------------------------------------------

  const menus = [];

  function items(list) {
    return Array.from(list.querySelectorAll('[role="menuitem"]')).filter(el => !el.hidden);
  }

  function closeMenu(menu, focusTrigger = false) {
    if (menu.list.hidden) return;
    menu.list.hidden = true;
    menu.trigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) menu.trigger.focus();
  }

  function openMenu(menu, focus = 'first') {
    for (const other of menus) if (other !== menu) closeMenu(other);
    refreshDriveItems();
    menu.list.hidden = false;
    menu.trigger.setAttribute('aria-expanded', 'true');
    alignMenu(menu.list);
    preloadGoogle();
    const list = items(menu.list);
    const target = focus === 'last' ? list[list.length - 1] : list[0];
    if (target) target.focus();
  }

  /** 預設靠右對齊按鈕；超出視窗左側（例如手機版按鈕換行到左邊）時改為靠左。 */
  function alignMenu(list) {
    list.classList.remove('menu-list-start');
    const rect = list.getBoundingClientRect();
    if (rect.left < 8) list.classList.add('menu-list-start');
  }

  function setupMenu(trigger, list, actions) {
    const menu = {trigger, list};
    menus.push(menu);
    trigger.addEventListener('click', () => (list.hidden ? openMenu(menu) : closeMenu(menu)));
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu(menu, event.key === 'ArrowUp' ? 'last' : 'first');
      }
    });
    list.addEventListener('keydown', event => {
      const all = items(list);
      const index = all.indexOf(document.activeElement);
      let next = null;
      if (event.key === 'ArrowDown') next = all[(index + 1) % all.length];
      else if (event.key === 'ArrowUp') next = all[(index - 1 + all.length) % all.length];
      else if (event.key === 'Home') next = all[0];
      else if (event.key === 'End') next = all[all.length - 1];
      else if (event.key === 'Escape') { event.preventDefault(); closeMenu(menu, true); return; }
      else if (event.key === 'Tab') { closeMenu(menu); return; }
      if (next) { event.preventDefault(); next.focus(); }
    });
    list.addEventListener('click', event => {
      const item = event.target.closest('[role="menuitem"]');
      if (!item || !list.contains(item)) return;
      // 停用的 Drive 項目仍可聚焦（aria-disabled），按下時說明原因。
      if (item.getAttribute('aria-disabled') === 'true') {
        notify(item.title || 'Google Drive 目前無法使用。', true);
        return;
      }
      closeMenu(menu, true);
      // 必須同步呼叫，才能保留檔案視窗／Google 登入視窗需要的使用者啟用狀態。
      const action = actions[item.dataset.action];
      if (action) action();
    });
    return menu;
  }

  document.addEventListener('pointerdown', event => {
    for (const menu of menus) {
      if (!menu.list.hidden && !menu.list.contains(event.target) && !menu.trigger.contains(event.target)) closeMenu(menu);
    }
  });
  document.addEventListener('focusin', event => {
    for (const menu of menus) {
      if (!menu.list.hidden && !menu.list.contains(event.target) && menu.trigger !== event.target) closeMenu(menu);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const menu of menus) if (!menu.list.hidden) closeMenu(menu, true);
  });

  // ---------------------------------------------------------------------------
  // Drive 狀態
  // ---------------------------------------------------------------------------

  const availability = () => (drive ? drive.availabilityStatus() : {available: false, reason: 'missing', message: 'Google Drive 元件未載入。'});

  function applyItem(el, state) {
    if (!el) return;
    if ('hidden' in state) el.hidden = state.hidden;
    if ('disabled' in state) el.setAttribute('aria-disabled', state.disabled ? 'true' : 'false');
    if ('label' in state) el.textContent = state.label;
    if ('title' in state) { if (state.title) el.title = state.title; else el.removeAttribute('title'); }
  }

  function refreshDriveItems() {
    const model = driveMenuModel({
      availability: availability(),
      currentFile: drive ? drive.currentFile() : null,
      signedIn: drive ? drive.isSignedIn() : false
    });
    applyItem($('openDrive'), model.openDrive);
    applyItem($('saveDrive'), model.saveBack);
    applyItem($('saveAsDrive'), model.saveAsDrive);
    applyItem($('signOutDrive'), model.signOut);
  }

  /** 第一次打開選單時才載入 Google 元件；不可用（未設定、file://）時不載入任何外部程式。 */
  function preloadGoogle() {
    if (!drive || !availability().available || drive.isReady()) return;
    loadError = null;
    drive.ensureLoaded().then(() => { loadError = null; }, error => { loadError = error; });
  }

  /** 把 Drive 錯誤顯示為 zh-Hant 訊息；使用者取消不算錯誤。 */
  function reportDriveError(error, prefix) {
    if (DE.isCancelled(error)) return;
    const shown = error && error.code === 'not-loaded' && loadError ? loadError : error;
    // 尚未載入完成：DriveStorage 已重新開始載入，這裡追蹤它的結果，下次按下時才能顯示載入失敗的原因。
    if (error && error.code === 'not-loaded') preloadGoogle();
    if (shown && shown.code === 'not-loaded') { notify(DE.errorMessage(shown)); return; }
    const message = shown && shown.name === 'DriveError' ? DE.errorMessage(shown) : (shown && shown.message) || String(shown);
    notify(prefix + message, true);
    refreshDriveItems();
  }

  const status = text => notify(text);

  // ---------------------------------------------------------------------------
  // Drive 動作（全部在選單項目的 click 中同步開始）
  // ---------------------------------------------------------------------------

  // 進行中的 Drive 動作若正在等待 Google 登入，再按 Drive 項目可取代它（避免登入視窗沒回呼時永遠卡住）。
  const pickerBlocked = () => orderPickerBusy && !drive.isWaitingForToken();
  const locks = createDriveLocks({get: () => orderPickerBusy, set: value => { orderPickerBusy = value; }});

  function openDriveOrder() {
    if (!drive || pickerBlocked()) return;
    const lock = locks.begin();
    drive.openFromDrive({onStatus: status, onAuthorized: lock.onAuthorized}).then(async result => {
      if (!result) { if (!lock.superseded()) notify('已取消從 Google Drive 開啟，原資料未變更。'); return; }
      let opened;
      try {
        opened = await openOrderFile(result.file, result.meta);
      } catch (error) {
        notify('開啟失敗：' + error.message, true);
        return;
      }
      if (opened) notify('已從 Google Drive 開啟「' + result.file.name + '」，所有合計已依單價與數量重新計算。');
      else notify('已取消開啟訂單，原資料未變更。');
    }).catch(error => reportDriveError(error, '從 Google Drive 開啟失敗：'))
      .finally(lock.release);
  }

  /** 產生與本機儲存相同的 JSON（同一個 payload()）；失敗時回傳 null 並顯示訊息。 */
  function driveContents() {
    try {
      return JSON.stringify(payload(), null, 2);
    } catch (error) {
      notify('儲存失敗（準備訂單資料）：' + error.name + (error.message ? ': ' + error.message : ''), true);
      return null;
    }
  }

  function afterDriveSave(saved, verb, startGeneration, lock) {
    const outcome = driveSaveOutcome(saved, startGeneration, orderFileGeneration);
    if (outcome === 'cancelled') { if (lock.superseded()) return; notify('已取消儲存到 Google Drive，訂單仍未儲存。'); return; }
    if (outcome === 'replaced') {
      // DriveStorage 已把剛存好的檔案設為目前檔案，但畫面上已是另一份訂單：再次清除，避免之後覆蓋錯的 Drive 檔案。
      setCurrentDriveFile(null);
      refreshDriveItems();
      notify('先前的訂單已' + verb + ' Google Drive「' + saved.name + '」。目前畫面已換成另一份訂單，它尚未儲存，也不會連結到該 Drive 檔案。');
      return;
    }
    $('saveStatus').textContent = '已儲存訂單檔案';
    showDriveFileStatus();
    notify('訂單已' + verb + ' Google Drive「' + saved.name + '」。');
  }

  function saveDriveOrder() {
    if (!drive || pickerBlocked() || !validUI()) return;
    const file = drive.currentFile();
    if (!file) { notify(DE.errorMessage({code: 'no-current-file'}), true); return; }
    const contents = driveContents();
    if (contents === null) return;
    const generation = orderFileGeneration;
    const lock = locks.begin();
    drive.saveToDrive({contents, onStatus: status, onAuthorized: lock.onAuthorized})
      .then(saved => afterDriveSave(saved, '存回', generation, lock))
      .catch(error => reportDriveError(error, '存回 Google Drive 失敗：'))
      .finally(lock.release);
  }

  function saveAsDriveOrder() {
    if (!drive || pickerBlocked() || !validUI()) return;
    const contents = driveContents();
    if (contents === null) return;
    const generation = orderFileGeneration;
    const lock = locks.begin();
    drive.saveAsToDrive({contents, name: orderFilename(), onStatus: status, onAuthorized: lock.onAuthorized})
      .then(saved => afterDriveSave(saved, '另存到', generation, lock))
      .catch(error => reportDriveError(error, '另存到 Google Drive 失敗：'))
      .finally(lock.release);
  }

  function signOutDrive() {
    if (!drive) return;
    // 登出會取消仍在等待登入的 Drive 動作；那些動作不再另外顯示「已取消」。
    locks.cancelPending();
    drive.signOut().then(() => notify('已登出 Google 帳號。'), error => reportDriveError(error, '登出失敗：'))
      .finally(() => { showDriveFileStatus(); refreshDriveItems(); });
  }

  const actions = {
    openLocal: () => openLocalOrder(),
    openDrive: openDriveOrder,
    saveLocal: () => saveLocalOrder(),
    saveDrive: saveDriveOrder,
    saveAsDrive: saveAsDriveOrder,
    signOutDrive
  };
  setupMenu($('import'), $('openMenuList'), actions);
  setupMenu($('export'), $('saveMenuList'), actions);
  refreshDriveItems();
})(typeof window !== 'undefined' ? window : globalThis);
