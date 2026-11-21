'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {OrderLogic: L, loadFixture} = require('./support.js');

/** 把 buildAutomaticRefunds 的結果寫回 state（模擬 UI 套用退費）。 */
function withRefunds(state) {
  const refunds = L.buildAutomaticRefunds(state);
  for (const o of state.orders) o.refundQuantities = refunds.get(o.id);
  return state;
}

test('buildAutomaticRefunds：短缺從優先順序最後的買家開始退', () => {
  const state = loadFixture('refunds-shipping');
  const before = JSON.stringify(state);
  const refunds = L.buildAutomaticRefunds(state);
  assert.equal(JSON.stringify(state), before, '不修改 state');
  // p1 優先順序：Ben（付運費）、Amy、Dan、Cat；短缺 3 → Cat 1、Dan 1、Amy 1，Ben 不退。
  assert.deepEqual(Object.fromEntries(refunds), {
    o1: {p1: 1, p2: 0},
    o2: {p1: 0, p2: 0},
    o3: {p1: 1, p2: 0},
    o4: {p1: 1, p2: 0},
    o5: {p1: 0, p2: 0}
  });
  const shortage = L.actualPurchaseReconciliation(state).find(r => r.productId === 'p1').shortage;
  assert.equal([...refunds.values()].reduce((sum, r) => sum + r.p1, 0), shortage);
});

test('buildAutomaticRefunds：同一買家多件時一起退，不足再往前一位', () => {
  const state = loadFixture('refunds-shipping');
  state.purchaseOrders[0].actualQuantities.p1 = 1; // p1 只買到 1 件 → 短缺 4
  const refunds = L.buildAutomaticRefunds(state);
  // Cat 1、Dan 1，再由 Amy 退 2；付運費的 Ben 保留。
  assert.deepEqual(state.orders.map(o => refunds.get(o.id).p1), [2, 0, 1, 1, 0]);
  state.purchaseOrders[0].actualQuantities.p1 = 0; // 全部買不到 → 每人全退
  const all = L.buildAutomaticRefunds(state);
  assert.deepEqual(state.orders.map(o => all.get(o.id).p1), [2, 1, 1, 1, 0]);
});

test('buildAutomaticRefunds：呼叫 validate 並檢查前置條件', () => {
  const state = loadFixture('refunds-shipping');
  let validated = 0;
  L.buildAutomaticRefunds(state, {validate: s => { assert.equal(s, state); validated++; }});
  assert.equal(validated, 1);
  assert.throws(() => L.buildAutomaticRefunds({...state, purchaseOrders: []}), /請先建立搶購清單 A/);
  const mismatch = loadFixture('refunds-shipping');
  mismatch.purchaseOrders[0].quantities.p1 = 2;
  assert.throws(() => L.buildAutomaticRefunds(mismatch), /尚未與訂購明細一致/);
  const overBought = loadFixture('refunds-shipping');
  overBought.purchaseOrders[0].actualQuantities.p1 = 6; // 實際 6 件 > 計畫 5 件
  assert.throws(() => L.buildAutomaticRefunds(overBought), /數量無效/);
});

test('refundAmount／refundGrandTotal 以整數分計算', () => {
  const state = withRefunds(loadFixture('refunds-shipping'));
  assert.deepEqual(state.orders.map(o => L.refundAmount(state, o)), [460, 0, 460, 460, 0]);
  assert.equal(L.refundGrandTotal(state), 1380);
});

test('shippingShare：未達免運的實際購買單由運費 0 且仍有商品的買家平均分攤', () => {
  const state = withRefunds(loadFixture('refunds-shipping'));
  // po-x 實際 4000 + 5000、po-y 實際 10000 日圓，皆未達 11,000。
  // Ben 付了運費、Cat 全數退費 → 分攤人數為 Amy、Dan、Eve 共 3 人。
  assert.deepEqual(L.shippingShare(state), {
    belowFreeShippingCount: 2,
    shippingPerOrderTwd: 230,
    totalShippingTwd: 460,
    zeroShippingBuyerCount: 3,
    perBuyerTwd: 153.33
  });
});

test('shippingShare：沒有未達免運的單時每人 0；無人可分攤時為 null', () => {
  const state = withRefunds(loadFixture('refunds-shipping'));
  const free = JSON.parse(JSON.stringify(state));
  free.purchaseOrders[0].actualQuantities = {p1: 3, p2: 1}; // 11,000 日圓
  free.purchaseOrders[1].actualQuantities = {p1: 2, p2: 2}; // 14,000 日圓
  assert.equal(L.shippingShare(free).perBuyerTwd, 0);
  const nobody = JSON.parse(JSON.stringify(state));
  for (const o of nobody.orders) o.shippingTwd = 50;
  assert.equal(L.shippingShare(nobody).perBuyerTwd, null);
});

test('internationalShippingBreakdown：國際與境內運費每一分都分配出去', () => {
  const state = withRefunds(loadFixture('refunds-shipping'));
  const b = L.internationalShippingBreakdown(state);
  assert.equal(b.totalQuantity, 5);
  assert.equal(b.buyerQuantityTotal, 5);
  assert.equal(b.internationalCents, 10003);
  assert.equal(b.domesticTotalCents, 46000);
  assert.equal(b.allocatedInternationalCents, 10003);
  assert.equal(b.allocatedDomesticCents, 46000);
  assert.equal(b.unallocatedInternationalCents, 0);
  assert.equal(b.unallocatedDomesticCents, 0);
  assert.equal(b.totalDueCents, 10003 + 46000);
  // 10003 / 5 件 = 2000 餘 3，餘數依序分給前 3 件；46000 / 3 人 = 15333 餘 1，給第一位分攤者。
  assert.deepEqual(b.rows.map(r => [r.order.id, r.quantity, r.internationalCents, r.domesticCents, r.totalCents]), [
    ['o1', 2, 4002, 15334, 19336],
    ['o2', 1, 2001, 0, 2001],
    ['o3', 0, 0, 0, 0],
    ['o4', 1, 2000, 15333, 17333],
    ['o5', 1, 2000, 15333, 17333]
  ]);
});

test('internationalShippingBreakdown：各種國際運費金額都完全守恆', () => {
  const state = withRefunds(loadFixture('refunds-shipping'));
  for (const amount of [0, 0.01, 0.04, 1, 99.99, 1234.57]) {
    state.internationalShippingTwd = amount;
    const b = L.internationalShippingBreakdown(state);
    assert.equal(b.allocatedInternationalCents, L.moneyCents(amount), String(amount));
    assert.equal(b.rows.reduce((sum, r) => sum + r.totalCents, 0), b.totalDueCents);
    const amounts = b.rows.filter(r => r.quantity).map(r => r.internationalCents / r.quantity);
    assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1, '每件分攤差距不超過 1 分');
  }
});

test('actualCostSummary：淨利 = 退費後營收 − 實付成本 + 境內運費補貼', () => {
  const state = withRefunds(loadFixture('refunds-shipping'));
  // 營收 5831.5 − 退費 1380 = 4451.5；成本 2100.25 + 1999.5 = 4099.75；補貼 460。
  assert.deepEqual(L.actualCostSummary(state), {
    recordedCostTwd: 4099.75,
    missingCount: 0,
    totalCount: 2,
    complete: true,
    netRevenueTwd: 4451.5,
    shippingSupplementTwd: 460,
    belowFreeShippingCount: 2,
    actualNetProfitTwd: 811.75
  });
});

test('actualCostSummary：成本未填齊或沒有搶購單時淨利為 null', () => {
  const state = withRefunds(loadFixture('refunds-shipping'));
  state.purchaseOrders[1].actualCostTwd = null;
  const partial = L.actualCostSummary(state);
  assert.equal(partial.missingCount, 1);
  assert.equal(partial.complete, false);
  assert.equal(partial.recordedCostTwd, 2100.25);
  assert.equal(partial.actualNetProfitTwd, null);
  const empty = L.actualCostSummary({...state, purchaseOrders: []});
  assert.equal(empty.complete, false);
  assert.equal(empty.actualNetProfitTwd, null);
});
