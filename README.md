# Group Purchase Manager

A static group-purchase order management app. It runs entirely in the browser and can be hosted on GitHub Pages.

## Deploy with GitHub Pages

1. Create a new GitHub repository (for example, `group-purchase-manager`).
2. Upload the contents of this folder to the repository root. Keep `index.html` and the `assets/` folder at the same level.
3. Open **Settings → Pages** in the repository.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. Wait for the Pages deployment to finish. GitHub will show the public website URL in the Pages settings.

## Use

- Open the published URL in a modern browser.
- Use **Open Order** (開啟訂單) and **Save Order** (儲存訂單) to import/export order JSON files. Each button opens a menu: local file (從本機開啟／儲存到本機) or Google Drive (see below). Dragging a `.json` file onto the page still opens it.
- Data is not stored on a server. Save exported JSON backups somewhere safe.
- The folder picker feature requires a browser that supports the File System Access API and may require permission each time.

## Google Drive 設定

「開啟訂單」與「儲存訂單」選單可以直接從 Google Drive 開啟訂單 JSON、存回原檔（存回 Google Drive）或另存新檔（另存到 Google Drive）。這是選用功能：`assets/drive-config.js` 留空時，Drive 選項會顯示為停用，頁面也不會載入任何 Google 程式；本機開啟／儲存與拖曳開啟不受影響。

本頁只要求 `https://www.googleapis.com/auth/drive.file` 權限：只能讀寫使用者透過「從 Google Drive 開啟」（Google Picker）選取的檔案，或由本頁建立的檔案，看不到雲端硬碟中的其他檔案。登入取得的 access token 只存在分頁記憶體中（不寫入 localStorage、IndexedDB 或訂單 JSON），約一小時後過期會自動重新取得；選單中的「登出 Google 帳號」會撤銷 token。Drive 檔案資訊也只記在記憶體，匯出的訂單 JSON 格式不變。

### 在 Google Cloud Console 設定（一次性）

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立或選擇一個專案。
2. **API 和服務 → 程式庫**：啟用 **Google Drive API** 與 **Google Picker API**。
3. **API 和服務 → OAuth 同意畫面**（Google Auth Platform）：
   - 使用者類型選「外部」，填入應用程式名稱與聯絡信箱。
   - 「資料存取／範圍」只加入 `https://www.googleapis.com/auth/drive.file`。
   - 發布狀態為「測試中」時，在「測試使用者」加入要使用本頁的 Google 帳號（未加入的帳號無法登入）。`drive.file` 是非敏感範圍，若要開放所有人使用可改為「正式版」。
4. **API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID**：
   - 應用程式類型選「網頁應用程式」。
   - 「已授權的 JavaScript 來源」加入放置本頁的來源（只填 scheme + 網域 + 連接埠，不含路徑），例如 GitHub Pages 的 `https://<帳號>.github.io`，以及本機測試用的 `http://localhost` 和 `http://localhost:8000`（實際使用的連接埠）。
   - 不需要填「已授權的重新導向 URI」。複製結尾為 `.apps.googleusercontent.com` 的 **用戶端 ID**。
5. **憑證 → 建立憑證 → API 金鑰**，然後編輯該金鑰：
   - 「應用程式限制」選「網站」（HTTP 參照網址），加入 `https://<帳號>.github.io/*`（或你的網址）與 `http://localhost:*/*`。
   - 「API 限制」選「限制金鑰」，只勾選 **Google Picker API**。
6. **應用程式 ID（appId）= 專案編號**（純數字，不是專案 ID）：在 Console 首頁的「專案資訊」卡片或 **IAM 與管理 → 設定** 可以看到。Picker 需要它，選取的檔案才會授權給本頁（`drive.file`）。
7. 編輯 `assets/drive-config.js`，填入三個值後重新部署：

   ```js
   root.DRIVE_CONFIG = {
     clientId: '1234567890-abc123.apps.googleusercontent.com',
     apiKey: 'AIzaSy...',
     appId: '1234567890'
   };
   ```

   這些值會出現在瀏覽器中，本身不是機密；請靠第 4、5 步的來源與參照網址限制保護它們。

### 使用方式與限制

- 第一次打開「開啟訂單」或「儲存訂單」選單時才會載入 Google 元件；若看到「正在載入 Google 元件，請稍候再按一次」，稍等一下再按一次 Drive 選項即可（登入視窗必須由點擊直接開啟，否則會被瀏覽器阻擋）。
- 「存回 Google Drive」只有在目前的訂單是從 Google Drive 開啟或另存過時才能使用，選項上會顯示檔名，頁首也會顯示目前的 Drive 檔名。從本機開啟或拖曳開啟其他訂單後，會改回一般的本機訂單。
- 存回前會檢查 Drive 上的檔案；若開啟後已被其他人或其他裝置修改，會先詢問是否覆蓋。
- 含附圖的大型訂單（超過 5 MB）會分段上傳並顯示進度。
- **用 `file://` 直接開啟 `index.html` 時無法使用 Google Drive**（Google 登入不接受 `file://` 來源），Drive 選項會顯示為停用。請改用 GitHub Pages 網址，或在專案資料夾執行 `python3 -m http.server 8000` 後開啟 `http://localhost:8000/`。

## Project layout

- `index.html` — application entry page
- `assets/order-logic.js` — pure calculation logic (`OrderLogic`: money, allocation, purchase bundling, refunds, shipping split); loaded first
- `assets/order-records.js` — initial order data and state
- `assets/actual-purchase-refunds.js` — actual-purchase and refund features
- `assets/drive-config.js` — Google Drive settings (`DRIVE_CONFIG`; empty = Drive disabled)
- `assets/drive-storage.js` — Google Drive sign-in, Picker, download and upload (`DriveStorage`)
- `assets/system-core.js` — application logic and UI
- `assets/order-file-menu.js` — the Open Order / Save Order menus and Google Drive actions
- `assets/product-detail-image.js` — product detail image export

## Development

The calculation logic in `assets/order-logic.js` has a regression test suite in `tests/`, written with Node's built-in `node:test` and `node:assert` (Node.js 18 or newer; no `npm install` needed, there are no dependencies).

```sh
npm test
# or, without npm:
node --test tests/
```

- `tests/*.test.js` — test files (money and totals, allocation priority, purchase-order bundling, refunds and shipping split, Google Drive storage with injected fakes, open/save menu state)
- `tests/fixtures/*.json` — hand-written order data in the same format as exported order JSON
- `tests/index.js` — entry point that loads every `*.test.js` when `node --test tests/` is given the folder
- `tests/support.js` — shared helpers (fixture loading, deterministic ids)

The site itself still needs no build step; `package.json` only exists to run the tests.

## Notes

This is a static-site deployment; no backend, database, or build step is required. The original development scripts, test reports, and screenshots are not needed to publish the website.
