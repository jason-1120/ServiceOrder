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
- Use **Open Order** and **Save Order** to import/export order JSON files.
- Data is not stored on a server. Save exported JSON backups somewhere safe.
- The folder picker feature requires a browser that supports the File System Access API and may require permission each time.

## Project layout

- `index.html` — application entry page
- `assets/order-records.js` — initial order data and state
- `assets/actual-purchase-refunds.js` — actual-purchase and refund features
- `assets/system-core.js` — application logic and UI
- `assets/product-detail-image.js` — product detail image export

## Notes

This is a static-site deployment; no backend, database, or build step is required. The original development scripts, test reports, and screenshots are not needed to publish the website.
