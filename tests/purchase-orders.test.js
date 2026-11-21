'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {OrderLogic: L, loadFixture, idMaker, normalizeIds, sumByProduct} = require('./support.js');

const FREE = L.FREE_SHIPPING_JPY;

/** 搶購單在各限購分組佔用的單位數。 */
function unitsByGroup(state, quantities) {
  return Object.fromEntries(L.blindBoxGroups(state.products).map(g =>
    [g.key, g.products.reduce((sum, p) => sum + (quantities[p.id] ?? 0) * L.productUnitWeight(p), 0)]));
}

/** 所有自動分配結果都必須成立的不變量。 */
function assertInvariants(state, result) {
  assert.deepEqual(sumByProduct(state, result), sumByProduct(state, state.orders), '每個商品的總數量必須守恆');
  const caps = L.purchaseCapacities(state);
  for (const cart of result) {
    assert.deepEqual(L.purchaseLimitViolations(state, cart.quantities), [], cart.name + ' 超過限購');
    for (const p of state.products) assert.ok(cart.quantities[p.id] <= caps[p.id], cart.name + ' 的 ' + p.id + ' 超過單筆上限');
    assert.ok(state.products.some(p => cart.quantities[p.id] > 0), cart.name + ' 不應為空單');
    assert.deepEqual(cart.actualQuantities, cart.quantities, '新建搶購單的實際數量預設等於搶購數量');
    assert.deepEqual(Object.keys(cart.quantities), state.products.map(p => p.id), '每筆都列出所有商品');
  }
}

test('buildAutomaticPurchaseOrders 需要 makeId', () => {
  assert.throws(() => L.buildAutomaticPurchaseOrders(loadFixture('purchase-basic')), TypeError);
});

test('一般商品：數量守恆、限購、湊免運與自成一車', () => {
  const state = loadFixture('purchase-basic');
  const before = JSON.stringify(state);
  const makeId = idMaker();
  const result = L.buildAutomaticPurchaseOrders(state, {makeId});
  assert.equal(JSON.stringify(state), before, '不修改 state');
  assert.equal(makeId.count(), result.length);
  assert.deepEqual(result.map(o => o.id), result.map((_, i) => 'po-gen-' + (i + 1)));
  assertInvariants(state, result);

  // 付運費的 Bob 自成一車，包含他全部商品，並從共用池補到免運。
  const own = result.filter(o => o.isOwnCart);
  assert.equal(own.length, 1);
  assert.equal(own[0].name, '自成一車1（Bob）');
  assert.equal(own[0].serial, 1);
  const bob = state.orders.find(o => o.id === 'o-bob');
  for (const [pid, q] of Object.entries(bob.quantities)) assert.ok(own[0].quantities[pid] >= q);
  assert.ok(L.purchaseJpy(state, own[0]) >= FREE);

  // 共用池：除了最後一筆剩餘單，其餘都達免運；剩餘單本身湊不到免運。
  const shared = result.filter(o => !o.isOwnCart);
  assert.deepEqual(shared.map(o => o.serial), shared.map((_, i) => i + 1));
  assert.deepEqual(shared.map(o => o.name), shared.map((_, i) => '訂單' + (i + 1)));
  const below = shared.filter(o => L.purchaseJpy(state, o) < FREE);
  assert.equal(below.length, 1);
  assert.equal(below[0], shared[shared.length - 1]);
  assert.ok(L.purchaseJpy(state, below[0]) < FREE);
});

test('一般商品：目前演算法的完整結果（ID 已正規化）', () => {
  const state = loadFixture('purchase-basic');
  const result = normalizeIds(L.buildAutomaticPurchaseOrders(state, {makeId: idMaker()}));
  const row = (serial, name, isOwnCart, q) => ({
    id: '<generated>', accountId: '', purchaser: '', serial, name, isOwnCart, actualCostTwd: null, actualQuantities: q, quantities: q
  });
  assert.deepEqual(result, [
    row(1, '自成一車1（Bob）', true, {p1: 1, p2: 1, p3: 3, p4: 2}),
    row(1, '訂單1', false, {p1: 1, p2: 1, p3: 3, p4: 0}),
    row(2, '訂單2', false, {p1: 1, p2: 1, p3: 3, p4: 0}),
    row(3, '訂單3', false, {p1: 3, p2: 1, p3: 0, p4: 0}),
    row(4, '訂單4', false, {p1: 1, p2: 0, p3: 0, p4: 0})
  ]);
});

test('付運費買家超過限購時拆成多筆自成一車', () => {
  const state = loadFixture('purchase-basic');
  state.orders.find(o => o.id === 'o-bob').quantities = {p2: 5}; // p2 限購 2 → 需要 3 車
  const result = L.buildAutomaticPurchaseOrders(state, {makeId: idMaker()});
  assertInvariants(state, result);
  const own = result.filter(o => o.isOwnCart);
  assert.deepEqual(own.map(o => o.name), ['自成一車1（Bob）', '自成一車2（Bob）', '自成一車3（Bob）']);
  // Bob 的 5 個都在自己的車裡（補免運只會再加入共用池的商品）。
  assert.ok(own.reduce((sum, o) => sum + o.quantities.p2, 0) >= 5);
});

test('沒有共用池可補時，自成一車維持原數量（未達免運）', () => {
  const state = loadFixture('purchase-basic');
  for (const o of state.orders) if (o.id !== 'o-bob') o.quantities = {};
  const result = L.buildAutomaticPurchaseOrders(state, {makeId: idMaker()});
  assertInvariants(state, result);
  assert.equal(result.length, 1);
  assert.equal(result[0].isOwnCart, true);
  assert.deepEqual(result[0].quantities, {p1: 1, p2: 1, p3: 0, p4: 0});
  assert.ok(L.purchaseJpy(state, result[0]) < FREE);
});

test('盲盒：整盒與單抽共用限購單位，所有搶購單都不超過 1 盒 × 6 抽', () => {
  const state = loadFixture('purchase-blindbox');
  const result = L.buildAutomaticPurchaseOrders(state, {makeId: idMaker()});
  assertInvariants(state, result);
  const key = L.blindBoxKey(state.products[0]);
  assert.equal(key, L.blindBoxKey(state.products[1]), '同編號的整盒與單抽為同一限購分組');
  for (const cart of result) assert.ok(unitsByGroup(state, cart.quantities)[key] <= 6);
  // 2 盒（12 抽）+ 10 單抽 = 22 抽 → 至少 4 筆含盲盒的搶購單。
  assert.ok(result.filter(o => unitsByGroup(state, o.quantities)[key] > 0).length >= 4);
  // 付運費的 C 自成一車，共用池無法補到免運（每單最多 6600 + 4×800 = 9800 日圓）。
  const own = result.filter(o => o.isOwnCart);
  assert.equal(own.length, 1);
  assert.deepEqual(own[0].quantities, {bx: 0, bs: 2, n1: 0});
  assert.ok(result.every(o => L.purchaseJpy(state, o) < FREE));
});

test('盲盒限購設定不一致時拒絕分配', () => {
  const state = loadFixture('purchase-blindbox');
  state.products[1].purchaseLimit = 2;
  assert.throws(() => L.buildAutomaticPurchaseOrders(state, {makeId: idMaker()}), /每盒抽數與限購盒數必須一致/);
});

test('onlyRemaining：保留現有搶購單，只分配剩餘數量', () => {
  const state = loadFixture('purchase-basic');
  const full = L.buildAutomaticPurchaseOrders(state, {makeId: idMaker()});
  // 只留下前兩筆，模擬使用者已經手動處理過的安排。
  state.purchaseOrders = full.slice(0, 2).map((o, i) => ({...o, id: 'kept-' + (i + 1), accountId: 'acct', actualCostTwd: 1234}));
  const kept = JSON.parse(JSON.stringify(state.purchaseOrders));
  const makeId = idMaker();
  const result = L.buildAutomaticPurchaseOrders(state, {onlyRemaining: true, makeId});
  assert.deepEqual(state.purchaseOrders, kept, '不修改 state.purchaseOrders');
  assert.deepEqual(result.slice(0, 2), kept, '現有搶購單原封不動排在前面');
  assert.ok(result.slice(2).length > 0);
  assert.equal(makeId.count(), result.length - 2);
  assertInvariants(state, result);
  // 新增的共用單序號接在現有共用單之後；剩餘分配不會產生自成一車。
  const added = result.slice(2);
  assert.ok(added.every(o => !o.isOwnCart));
  assert.deepEqual(added.map(o => o.serial), added.map((_, i) => 2 + i));
});

test('onlyRemaining：已無剩餘時結果等於現有搶購單', () => {
  const state = loadFixture('purchase-basic');
  state.purchaseOrders = L.buildAutomaticPurchaseOrders(state, {makeId: idMaker()});
  const makeId = idMaker();
  assert.deepEqual(L.buildAutomaticPurchaseOrders(state, {onlyRemaining: true, makeId}), state.purchaseOrders);
  assert.equal(makeId.count(), 0);
});

test('onlyRemaining：已有超額或超過限購時拒絕', () => {
  const state = loadFixture('purchase-basic');
  state.purchaseOrders = [{id: 'x', isOwnCart: false, serial: 1, quantities: {p1: 99}}];
  assert.throws(() => L.buildAutomaticPurchaseOrders(state, {onlyRemaining: true, makeId: idMaker()}), /超額分配/);
  state.purchaseOrders = [{id: 'x', isOwnCart: false, serial: 1, quantities: {p2: 3}}]; // p2 需求 4、限購 2
  assert.throws(() => L.buildAutomaticPurchaseOrders(state, {onlyRemaining: true, makeId: idMaker()}), /超過限購/);
});

test('minimumShippingBundle 找出達到門檻的最小金額組合', () => {
  const state = loadFixture('purchase-basic');
  const pool = {p1: 5, p2: 4, p3: 9, p4: 0};
  const bundle = L.minimumShippingBundle(state, pool, L.purchaseCapacities(state), FREE);
  const jpy = L.purchaseJpy(state, {quantities: bundle});
  assert.ok(jpy >= FREE);
  assert.equal(jpy, 11100); // 300 日圓的公約數下，11,000 不可達，11,100 為最小可達金額
  assert.equal(L.minimumShippingBundle(state, {p1: 1, p2: 0, p3: 0, p4: 0}, L.purchaseCapacities(state), FREE), null);
});
