// Google Drive 設定（classic script，在 drive-storage.js 之前載入）。
// 三個值都留空時，Google Drive 功能會顯示為停用，頁面也不會載入任何 Google 元件。
// 這些值都不是機密（會出現在瀏覽器裡），但請在 Google Cloud Console 限制它們的使用來源。
//
// 取得方式（Google Cloud Console，https://console.cloud.google.com/）：
//  1. 建立或選擇一個專案，到「API 和服務 → 程式庫」啟用「Google Drive API」與「Google Picker API」。
//  2. 「API 和服務 → OAuth 同意畫面」：設定應用程式名稱，範圍只需要
//     https://www.googleapis.com/auth/drive.file（只能存取使用者用本頁選取或建立的檔案）。
//  3. clientId：「API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID」，類型選「網頁應用程式」，
//     「已授權的 JavaScript 來源」填入放置本頁的網址（例如 https://example.github.io 或 http://localhost:8000）。
//     複製結尾為 .apps.googleusercontent.com 的用戶端 ID。
//  4. apiKey：「憑證 → 建立憑證 → API 金鑰」，建議在「應用程式限制」設定 HTTP 參照網址為本頁網址，
//     並在「API 限制」只允許 Google Picker API。
//  5. appId：專案編號（純數字），在 Console 首頁的「專案資訊」或「IAM 與管理 → 設定」可以看到。
//     Picker 需要它，才能讓選取的檔案授權給本應用程式（drive.file 範圍）。
//
// 注意：用 file:// 直接開啟 index.html 時 Google 登入無法使用，Drive 功能會自動停用；
// 請改用 http(s) 網址開啟（例如在專案資料夾執行 `python3 -m http.server`）。
(function (root) {
  'use strict';
  root.DRIVE_CONFIG = {
    clientId: '77004314078-16mb8p1b2o7alea2cddul8t8ukk1l6m4.apps.googleusercontent.com',
    apiKey: 'AIzaSyCF5AvOncWBhWwPFInFbliXVibXidDIGDc',
    appId: '77004314078'
  };
})(typeof window !== 'undefined' ? window : globalThis);
