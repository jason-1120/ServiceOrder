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
- `assets/order-logic.js` — pure calculation logic (`OrderLogic`: money, allocation, purchase bundling, refunds, shipping split); loaded first
- `assets/order-records.js` — initial order data and state
- `assets/actual-purchase-refunds.js` — actual-purchase and refund features
- `assets/system-core.js` — application logic and UI
- `assets/product-detail-image.js` — product detail image export

## Development

The calculation logic in `assets/order-logic.js` has a regression test suite in `tests/`, written with Node's built-in `node:test` and `node:assert` (Node.js 18 or newer; no `npm install` needed, there are no dependencies).

```sh
npm test
# or, without npm:
node --test tests/
```

- `tests/*.test.js` — test files (money and totals, allocation priority, purchase-order bundling, refunds and shipping split)
- `tests/fixtures/*.json` — hand-written order data in the same format as exported order JSON
- `tests/index.js` — entry point that loads every `*.test.js` when `node --test tests/` is given the folder
- `tests/support.js` — shared helpers (fixture loading, deterministic ids)

The site itself still needs no build step; `package.json` only exists to run the tests.

## Notes

This is a static-site deployment; no backend, database, or build step is required. The original development scripts, test reports, and screenshots are not needed to publish the website.
