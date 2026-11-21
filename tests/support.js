'use strict';
// 測試共用工具（非測試檔）：載入 OrderLogic 與 fixtures、產生可預期的 ID。
const path = require('node:path');
const fs = require('node:fs');

const OrderLogic = require(path.join(__dirname, '..', 'assets', 'order-logic.js'));

/** 每次呼叫都回傳一份全新的 fixture 深拷貝，避免測試互相影響。 */
function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));
}

/** 產生依序遞增的 ID（po-1、po-2…），並記錄呼叫次數。 */
function idMaker() {
  let count = 0;
  const makeId = prefix => prefix + '-gen-' + (++count);
  makeId.count = () => count;
  return makeId;
}

/** 把產生的 ID 換成固定字樣，斷言時不依賴 ID 的實際值。 */
function normalizeIds(orders, keep = new Set()) {
  return orders.map(o => ({...o, id: keep.has(o.id) ? o.id : '<generated>'}));
}

/** 每個商品在 orders 中的數量合計。 */
function sumByProduct(state, orders) {
  return Object.fromEntries(state.products.map(p => [p.id, orders.reduce((sum, o) => sum + (o.quantities[p.id] ?? 0), 0)]));
}

module.exports = {OrderLogic, loadFixture, idMaker, normalizeIds, sumByProduct};
