'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {OrderLogic: L, loadFixture} = require('./support.js');

test('moneyCents 轉整數分，拒絕非有限值與過大金額', () => {
  assert.equal(L.moneyCents(0.1), 10);
  assert.equal(L.moneyCents(1.005), 100); // 1.005 * 100 = 100.4999…，原版即四捨五入成 100
  assert.equal(L.moneyCents(259.27), 25927);
  assert.throws(() => L.moneyCents(NaN), /金額過大/);
  assert.throws(() => L.moneyCents(Infinity), /金額過大/);
  assert.throws(() => L.moneyCents(Number.MAX_SAFE_INTEGER), /金額過大/);
});

test('validMoney 只接受非負、最多兩位小數的金額', () => {
  for (const ok of [0, 1, 0.1, 12.34, 1150.5]) assert.equal(L.validMoney(ok), true, String(ok));
  for (const bad of [-1, 1.234, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.equal(L.validMoney(bad), false, String(bad));
});

test('roundMoney 以分為單位四捨五入，負數對稱', () => {
  assert.equal(L.roundMoney(1.005), 1.01);
  assert.equal(L.roundMoney(-1.005), -1.01);
  assert.equal(L.roundMoney(2.675), 2.68);
  assert.equal(L.roundMoney(460 / 3), 153.33);
  assert.equal(L.roundMoney(0), 0);
  assert.throws(() => L.roundMoney(NaN), /換算金額過大/);
});

test('total 以整數分加總，避免浮點誤差並包含運費', () => {
  const state = loadFixture('totals');
  const [o1, o2, o3] = state.orders;
  // 0.1 + 0.2 + 運費 0.1：浮點直接相加會得到 0.30000000000000004 之類的值。
  assert.deepEqual(L.total(state, o1), {quantity: 2, twd: 0.4, jpy: 0.3, shippingTwd: 0.1});
  assert.deepEqual(L.total(state, o2), {quantity: 10, twd: 1815.19, jpy: 8642.22, shippingTwd: 0});
  // 沒有 shippingTwd 欄位時視為 0。
  assert.deepEqual(L.total(state, o3), {quantity: 0, twd: 0, jpy: 0, shippingTwd: 0});
});

test('allTotals 為各訂單合計（整數分）', () => {
  const state = loadFixture('totals');
  assert.deepEqual(L.allTotals(state), {quantity: 12, twd: 1815.59, jpy: 8642.52, shippingTwd: 0.1});
});

test('priorityLetter 產生 A…Z、AA… 代號', () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(L.priorityLetter),
    ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('productNumber／productLabel 正規化商品編號', () => {
  assert.equal(L.productNumber('#007'), '7');
  assert.equal(L.productNumber('＃12'), '12');
  assert.equal(L.productNumber(' A-1 '), 'A-1');
  assert.equal(L.productNumber(undefined), '');
  assert.equal(L.productLabel({productNumber: '3', name: '#3 徽章'}), '#3 徽章');
  assert.equal(L.productLabel({productNumber: '10', name: '盲盒', isBlindBox: true, blindBoxType: 'single'}), '#10 盲盒（單抽）');
  assert.equal(L.productUnit({isBlindBox: true, blindBoxType: 'box'}), '盒');
});
