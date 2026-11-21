'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {OrderLogic: L, loadFixture} = require('./support.js');

const orderIdsFor = (allocation, productId) =>
  allocation.products.find(p => p.productId === productId).priorities.map(r => [r.priority, r.orderId]);

test('buildAllocation：付運費者優先，再依台幣金額高、留言序號早、原始順序', () => {
  const state = loadFixture('allocation');
  const allocation = L.buildAllocation(state);
  assert.deepEqual(orderIdsFor(allocation, 'p1'), [
    ['A', 'o-paid-big'],   // 付運費、750
    ['B', 'o-paid-small'], // 付運費、290
    ['C', 'o-big'],        // 2530
    ['D', 'o-tie-early'],  // 460、序號 2
    ['E', 'o-tie-late'],   // 460、序號 3
    ['F', 'o-noseq-1'],    // 230、無序號 → 原始順序
    ['G', 'o-noseq-2']
  ]);
  // 只列出有訂該商品的買家，代號從 A 重新開始。
  assert.deepEqual(orderIdsFor(allocation, 'p2'), [['A', 'o-paid-big'], ['B', 'o-big'], ['C', 'o-p2-only']]);
});

test('buildAllocation 每列帶出數量、台幣合計、運費與序號', () => {
  const state = loadFixture('allocation');
  const row = L.buildAllocation(state).products[0].priorities[0];
  assert.deepEqual(row, {priority: 'A', orderId: 'o-paid-big', nickname: '有付運費多', quantity: 1, twd: 750, shippingTwd: 60, sequence: 8});
});

test('buildAllocation 不修改 state', () => {
  const state = loadFixture('allocation');
  const before = JSON.stringify(state);
  L.buildAllocation(state);
  assert.equal(JSON.stringify(state), before);
});
