// 純計算邏輯：金額、分配、搶購湊免運、盲盒限購、退費與運費分攤。
// 不讀取全域 state、不碰 DOM；需要的資料一律以參數傳入，方便 Node 測試直接 require。
// 以 classic script 載入（支援 file:// 開啟），對外只暴露全域 OrderLogic。
(function (root) {
  'use strict';

  /** 日幣滿額免運門檻（JPY）。 */
  const FREE_SHIPPING_JPY = 11000;
  /** 未達免運時每筆搶購訂單的境內運費（TWD）。 */
  const SHIPPING_PER_ORDER_TWD = 230;
  /** 盲盒組合搜尋的運算上限，超過即中止。 */
  const MAX_BUNDLE_OPERATIONS = 3000000;

  /** 深拷貝 JSON 相容資料。 */
  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  /** 以 zh-TW 格式顯示數字（最多兩位小數）。 */
  function fmt(x) {
    return new Intl.NumberFormat('zh-TW', {maximumFractionDigits: 2}).format(x);
  }

  // ---------------------------------------------------------------------------
  // 金額：以整數分運算
  // ---------------------------------------------------------------------------

  /** 金額轉整數分；非有限值或超出安全整數時丟出錯誤。 */
  function moneyCents(value) {
    const cents = Math.round(value * 100);
    if (!Number.isFinite(value) || !Number.isSafeInteger(cents)) throw Error('金額過大，請調整輸入。');
    return cents;
  }

  /** 是否為非負、最多兩位小數且可安全轉成整數分的金額。 */
  function validMoney(value) {
    return Number.isFinite(value) &&
      value >= 0 &&
      Number.isSafeInteger(Math.round(value * 100)) &&
      Number(value.toFixed(2)) === value;
  }

  /** 四捨五入到分（以絕對值計算，負數對稱處理）。 */
  function roundMoney(value) {
    const absolute = Math.abs(value),
      cents = Math.round((absolute + absolute * Number.EPSILON) * 100);
    if (!Number.isFinite(value) || !Number.isSafeInteger(cents)) throw Error('換算金額過大，請調整輸入。');
    return (value < 0 ? -cents : cents) / 100;
  }

  // ---------------------------------------------------------------------------
  // 名稱與商品編號
  // ---------------------------------------------------------------------------

  /** 暱稱比對用的正規化鍵。 */
  function nicknameKey(name) {
    return name.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
  }

  /** 正規化商品編號（去掉前置 #、純數字去前導零）。 */
  function productNumber(value) {
    const number = String(value ?? '').normalize('NFKC').trim().replace(/^#+\s*/u, '').trim();
    return /^\d+$/.test(number) ? String(Number(number)) : number;
  }

  /** 從商品名稱開頭取出編號數字，沒有則回傳空字串。 */
  function numberFromName(name) {
    return String(name).normalize('NFKC').match(/^\s*#?\s*(\d+)(?=\D|$)/u)?.[1] ?? '';
  }

  /** 商品數量單位：盲盒單抽「抽」、整盒「盒」、一般「件」。 */
  function productUnit(p) {
    return p.isBlindBox ? (p.blindBoxType === 'single' ? '抽' : '盒') : '件';
  }

  /** 商品顯示名稱（含 #編號 與盲盒整盒／單抽標示）。 */
  function productLabel(p) {
    const number = productNumber(p.productNumber),
      prefix = numberFromName(p.name);
    const name = number && prefix ? p.name.replace(/^\s*[#＃]?\s*\d+\s*/u, '') : p.name;
    const unit = p.isBlindBox ? (p.blindBoxType === 'single' ? '單抽' : '整盒') : '';
    return (number ? '#' + number + ' ' : '') + name + (unit && !name.includes(unit) ? '（' + unit + '）' : '');
  }

  // ---------------------------------------------------------------------------
  // 訂單金額與優先順序
  // ---------------------------------------------------------------------------

  /** 單一買家訂單的數量、台幣（含運費）、日幣合計。 */
  function total(state, o) {
    let twd = moneyCents(o.shippingTwd ?? 0),
      jpy = 0,
      quantity = 0;
    for (const p of state.products) {
      const q = o.quantities[p.id] ?? 0;
      quantity += q;
      twd += q * moneyCents(p.twd);
      jpy += q * moneyCents(p.jpy);
    }
    return {quantity, twd: twd / 100, jpy: jpy / 100, shippingTwd: o.shippingTwd ?? 0};
  }

  /** 全團所有訂單的數量、台幣、日幣、運費合計。 */
  function allTotals(state) {
    let quantity = 0,
      twd = 0,
      jpy = 0,
      shipping = 0;
    for (const o of state.orders) {
      const v = total(state, o);
      quantity += v.quantity;
      twd += moneyCents(v.twd);
      jpy += moneyCents(v.jpy);
      shipping += moneyCents(v.shippingTwd);
    }
    return {quantity, twd: twd / 100, jpy: jpy / 100, shippingTwd: shipping / 100};
  }

  /** 0 → A、25 → Z、26 → AA … 的優先順序代號。 */
  function priorityLetter(index) {
    let label = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
    return label;
  }

  /** 每個商品的買家優先順序：有付運費者優先，再依金額高、留言順序早、原始順序。 */
  function buildAllocation(state) {
    const originalIndex = new Map(state.orders.map((o, i) => [o.id, i]));
    const sorted = [...state.orders].sort((a, b) =>
      Number((b.shippingTwd ?? 0) > 0) - Number((a.shippingTwd ?? 0) > 0) ||
      total(state, b).twd - total(state, a).twd ||
      (a.sequence ?? Infinity) - (b.sequence ?? Infinity) ||
      originalIndex.get(a.id) - originalIndex.get(b.id));
    return {
      products: state.products.map(p => ({
        productId: p.id,
        priorities: sorted
          .filter(o => (o.quantities[p.id] ?? 0) > 0)
          .map((o, i) => ({
            priority: priorityLetter(i),
            orderId: o.id,
            nickname: o.nickname,
            quantity: o.quantities[p.id],
            twd: total(state, o).twd,
            shippingTwd: o.shippingTwd ?? 0,
            sequence: o.sequence
          }))
      }))
    };
  }

  // ---------------------------------------------------------------------------
  // 盲盒與限購
  // ---------------------------------------------------------------------------

  /** 限購分組鍵：盲盒依商品編號（或系列）共用，一般商品各自一組。 */
  function blindBoxKey(product) {
    return product.isBlindBox
      ? 'blind:' + nicknameKey(productNumber(product.productNumber) || product.blindBoxSeries || 'legacy-shared')
      : 'product:' + product.id;
  }

  /** 同組盲盒中提供共用設定的商品（優先整盒款）。 */
  function blindBoxSource(product, products) {
    if (!product.isBlindBox) return product;
    const members = products.filter(p => p.isBlindBox && blindBoxKey(p) === blindBoxKey(product));
    return members.find(p => p.blindBoxType !== 'single') ?? members[0] ?? product;
  }

  /** 依限購分組整理商品，附上每盒抽數與限購數。 */
  function blindBoxGroups(products) {
    const groups = new Map();
    for (const p of products) {
      const key = blindBoxKey(p),
        source = blindBoxSource(p, products);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: p.isBlindBox ? '#' + (productNumber(p.productNumber) || p.blindBoxSeries || source.name) : productLabel(p),
          isBlindBox: !!p.isBlindBox,
          boxSize: source.blindBoxSize ?? 1,
          limit: source.purchaseLimit ?? 1,
          products: []
        });
      }
      groups.get(key).products.push(p);
    }
    return [...groups.values()];
  }

  /** 一件商品佔用的限購單位（整盒 = 每盒抽數，其餘 = 1）。 */
  function productUnitWeight(p) {
    return p.isBlindBox && p.blindBoxType !== 'single' ? (p.blindBoxSize ?? 1) : 1;
  }

  /** 一個限購分組在單筆訂單可用的總單位數。 */
  function groupUnitCap(group) {
    return group.limit * (group.isBlindBox ? group.boxSize : 1);
  }

  /** 檢查限購與每盒抽數設定；同組盲盒設定不一致時丟出錯誤。 */
  function assertBlindBoxSettings(products) {
    for (const group of blindBoxGroups(products)) {
      if (!Number.isSafeInteger(group.limit) || group.limit < 1 ||
        !Number.isSafeInteger(group.boxSize) || group.boxSize < 1 ||
        !Number.isSafeInteger(groupUnitCap(group))) {
        throw Error(group.name + ' 的限購數量或每盒抽數無效。');
      }
      if (group.isBlindBox && group.products.some(p => (p.blindBoxSize ?? 1) !== group.boxSize || (p.purchaseLimit ?? 1) !== group.limit)) {
        throw Error('盲盒 ' + group.name + ' 的每盒抽數與限購盒數必須一致。');
      }
    }
  }

  /** 單筆搶購數量超過限購的分組清單（含錯誤訊息）。 */
  function purchaseLimitViolations(state, quantities) {
    return blindBoxGroups(state.products).flatMap(group => {
      const used = group.products.reduce((sum, p) => sum + (quantities[p.id] ?? 0) * productUnitWeight(p), 0),
        cap = groupUnitCap(group);
      return used > cap
        ? [{
          productId: group.products.find(p => (quantities[p.id] ?? 0) > 0).id,
          message: group.isBlindBox
            ? '盲盒「' + group.name + '」合計 ' + fmt(used) + ' 抽，超過 ' + fmt(group.limit) + ' 盒 × ' + fmt(group.boxSize) + ' = ' + fmt(cap) + ' 抽（整盒與單抽共用限購）'
            : group.name + ' 超過單筆限購 ' + fmt(cap)
        }]
        : [];
    });
  }

  /** 已放入 existing 後，每個商品在同一筆訂單還能再放的數量。 */
  function purchaseCapacities(state, existing = {}) {
    const capacities = {};
    for (const group of blindBoxGroups(state.products)) {
      const used = group.products.reduce((sum, p) => sum + (existing[p.id] ?? 0) * productUnitWeight(p), 0),
        left = Math.max(0, groupUnitCap(group) - used);
      for (const p of group.products) capacities[p.id] = Math.floor(left / productUnitWeight(p));
    }
    return capacities;
  }

  /** 從 pool 盡量裝滿一筆訂單（每組先放單位大的），回傳所有商品的數量。 */
  function fillLimitedCart(state, pool, existing = {}) {
    const quantities = {...existing};
    for (const group of blindBoxGroups(state.products)) {
      let left = groupUnitCap(group) - group.products.reduce((sum, p) => sum + (quantities[p.id] ?? 0) * productUnitWeight(p), 0);
      const products = [...group.products].sort((a, b) => productUnitWeight(b) - productUnitWeight(a));
      for (const p of products) {
        const count = Math.min(pool[p.id] ?? 0, Math.floor(Math.max(0, left) / productUnitWeight(p)));
        quantities[p.id] = (quantities[p.id] ?? 0) + count;
        left -= count * productUnitWeight(p);
      }
    }
    return Object.fromEntries(state.products.map(p => [p.id, quantities[p.id] ?? 0]));
  }

  // ---------------------------------------------------------------------------
  // 搶購訂單：湊免運與自動分配
  // ---------------------------------------------------------------------------

  /** 訂單依商品日幣單價計算的日幣金額。 */
  function purchaseJpy(state, o) {
    return state.products.reduce((sum, p) => sum + Math.round(p.jpy * 100) * (o.quantities[p.id] ?? 0), 0) / 100;
  }

  /** 從 pool 找出金額 ≥ targetJpy 且最小的商品組合；無解回傳 null。有盲盒時改用分組演算法。 */
  function minimumShippingBundle(state, pool, capacity, targetJpy, existing = {}) {
    if (state.products.some(p => p.isBlindBox)) return minimumGroupedShippingBundle(state, pool, existing, targetJpy);
    const target = Math.max(0, Math.round(targetJpy * 100));
    const options = state.products
      .map(p => ({id: p.id, cost: Math.round(p.jpy * 100), count: Math.min(pool[p.id] ?? 0, capacity[p.id] ?? 0)}))
      .filter(p => p.count > 0)
      .sort((a, b) => (pool[b.id] ?? 0) / Math.max(1, capacity[b.id] ?? 1) - (pool[a.id] ?? 0) / Math.max(1, capacity[a.id] ?? 1));
    const zero = options.filter(p => p.cost === 0),
      positive = options.filter(p => p.cost > 0);
    const finish = quantities => {
      for (const p of zero) quantities[p.id] = p.count;
      return quantities;
    };
    if (!target) return finish({});
    const small = positive.filter(p => p.cost < target),
      large = positive.filter(p => p.cost >= target).sort((a, b) => a.cost - b.cost);
    const smallTotal = small.reduce((sum, p) => sum + p.cost * p.count, 0);
    if (smallTotal < target) return large.length ? finish({[large[0].id]: 1}) : null;
    const gcd = (a, b) => {
      while (b) {
        const r = a % b;
        a = b;
        b = r;
      }
      return a;
    };
    const divisor = positive.reduce((d, p) => gcd(d, p.cost), 0),
      scaledTarget = Math.ceil(target / divisor);
    const upper = Math.min(large[0]?.cost ?? Infinity, target + Math.max(...small.map(p => p.cost)) - 1);
    const cap = Math.floor(upper / divisor),
      reachable = new Array(cap + 1);
    reachable[0] = {previous: null};
    // 有界背包：以 1、2、4… 的批次拆分數量。
    for (const p of positive) {
      const cost = p.cost / divisor;
      let left = Math.min(p.count, Math.floor(cap / cost)),
        batch = 1;
      while (left > 0) {
        const count = Math.min(batch, left),
          weight = cost * count;
        for (let sum = cap; sum >= weight; sum--) {
          if (!reachable[sum] && reachable[sum - weight]) reachable[sum] = {previous: reachable[sum - weight], productId: p.id, count};
        }
        left -= count;
        batch *= 2;
      }
    }
    let best = scaledTarget;
    while (best <= cap && !reachable[best]) best++;
    if (best > cap) return null;
    const quantities = {};
    for (let node = reachable[best]; node.productId; node = node.previous) {
      quantities[node.productId] = (quantities[node.productId] ?? 0) + node.count;
    }
    return finish(quantities);
  }

  /** 有盲盒時的湊免運：每個限購分組各自算整盒／單抽容量，再找最低達標金額。 */
  function minimumGroupedShippingBundle(state, pool, existing, targetJpy) {
    assertBlindBoxSettings(state.products);
    const target = Math.max(0, Math.round(targetJpy * 100));
    if (!target) return {};
    const costs = state.products.map(p => Math.round(p.jpy * 100)).filter(n => n > 0);
    if (!costs.length) return null;
    const gcd = (a, b) => {
        while (b) {
          const r = a % b;
          a = b;
          b = r;
        }
        return a;
      },
      divisor = costs.reduce(gcd),
      wanted = Math.ceil(target / divisor),
      upper = Math.floor((target + Math.max(...costs) - 1) / divisor);
    let reachable = new Map([[0, {}]]),
      operations = 0;
    for (const group of blindBoxGroups(state.products)) {
      const left = groupUnitCap(group) - group.products.reduce((sum, p) => sum + (existing[p.id] ?? 0) * productUnitWeight(p), 0);
      let choices = new Map([[0, {units: 0, quantities: {}}]]);
      for (const p of group.products) {
        const cost = Math.round(p.jpy * 100) / divisor,
          weight = productUnitWeight(p);
        if (!cost) continue;
        const next = new Map();
        for (const [sum, node] of choices) {
          const max = Math.min(pool[p.id] ?? 0, Math.floor((left - node.units) / weight), Math.floor((upper - sum) / cost));
          for (let q = 0; q <= max; q++) {
            if (++operations > MAX_BUNDLE_OPERATIONS) throw Error('盲盒組合過多，請減少商品或調整限購條件後再試。');
            const value = sum + q * cost,
              units = node.units + q * weight;
            if (!next.has(value) || next.get(value).units > units) next.set(value, {units, quantities: {...node.quantities, [p.id]: q}});
          }
        }
        choices = next;
      }
      const next = new Map();
      for (const [sum, quantities] of reachable) {
        for (const [cost, node] of choices) {
          if (++operations > MAX_BUNDLE_OPERATIONS) throw Error('盲盒組合過多，請減少商品或調整限購條件後再試。');
          const value = sum + cost;
          if (value <= upper && !next.has(value)) next.set(value, {...quantities, ...node.quantities});
        }
      }
      reachable = next;
    }
    let best = Infinity;
    for (const value of reachable.keys()) if (value >= wanted && value < best) best = value;
    if (!Number.isFinite(best)) return null;
    const selected = reachable.get(best),
      combined = {...existing};
    for (const p of state.products) combined[p.id] = (existing[p.id] ?? 0) + (selected[p.id] ?? 0);
    // 日幣 0 元的商品不影響金額，在剩餘容量內一併放入。
    for (const group of blindBoxGroups(state.products)) {
      let left = groupUnitCap(group) - group.products.reduce((sum, p) => sum + (combined[p.id] ?? 0) * productUnitWeight(p), 0);
      for (const p of group.products) {
        if (Math.round(p.jpy * 100) === 0) {
          const count = Math.min(pool[p.id] ?? 0, Math.floor(left / productUnitWeight(p)));
          selected[p.id] = count;
          left -= count * productUnitWeight(p);
        }
      }
    }
    return selected;
  }

  /** 每個商品的預購總量、已分配到搶購訂單的數量與差異。 */
  function purchaseReconciliation(state) {
    return state.products.map(p => {
      const requested = state.orders.reduce((sum, o) => sum + (o.quantities[p.id] ?? 0), 0),
        planned = (state.purchaseOrders ?? []).reduce((sum, o) => sum + (o.quantities[p.id] ?? 0), 0);
      return {
        productId: p.id,
        productNumber: p.productNumber,
        name: productLabel(p),
        unit: productUnit(p),
        requested,
        planned,
        difference: planned - requested,
        remaining: Math.max(0, requested - planned),
        overAllocated: Math.max(0, planned - requested)
      };
    });
  }

  /**
   * 自動建立搶購訂單（不修改 state，回傳新的搶購訂單陣列）。
   * options.onlyRemaining：保留現有安排，只分配尚未分配的數量。
   * options.makeId：產生 ID 的函式（必填），以 makeId('po') 呼叫。
   */
  function buildAutomaticPurchaseOrders(state, {onlyRemaining = false, makeId} = {}) {
    if (typeof makeId !== 'function') throw TypeError('buildAutomaticPurchaseOrders 需要 options.makeId 函式。');
    assertBlindBoxSettings(state.products);
    const checks = purchaseReconciliation(state);
    if (onlyRemaining && checks.some(c => c.overAllocated)) throw Error('已有商品超額分配，請先手動修正，再補分配剩餘。');
    if (onlyRemaining && (state.purchaseOrders ?? []).some(o => purchaseLimitViolations(state, o.quantities).length)) throw Error('現有搶購訂單超過限購，請先手動修正，再補分配剩餘。');
    const pool = Object.fromEntries(state.products.map(p => [p.id, onlyRemaining ? checks.find(c => c.productId === p.id).remaining : 0])),
      result = onlyRemaining ? clone(state.purchaseOrders ?? []) : [];
    const limits = purchaseCapacities(state);
    const nonEmpty = q => state.products.some(p => (q[p.id] ?? 0) > 0);
    const make = (quantities, isOwnCart, nickname = '') => {
      if (!nonEmpty(quantities)) throw Error('剩餘商品無法依目前限購安排，請檢查商品設定。');
      if (result.length >= 2000) throw Error('限購條件需要超過 2,000 筆搶購訂單，請調整數量後重算。');
      const serial = Math.max(0, ...result.filter(o => o.isOwnCart === isOwnCart).map(o => o.serial ?? 0)) + 1;
      result.push({
        id: makeId('po'),
        accountId: '',
        purchaser: '',
        serial,
        name: (isOwnCart ? '自成一車' : '訂單') + serial + (nickname ? '（' + nickname + '）' : ''),
        isOwnCart,
        actualCostTwd: null,
        actualQuantities: Object.fromEntries(state.products.map(p => [p.id, quantities[p.id] ?? 0])),
        quantities: Object.fromEntries(state.products.map(p => [p.id, quantities[p.id] ?? 0]))
      });
    };
    const consume = q => {
      for (const p of state.products) {
        pool[p.id] -= q[p.id] ?? 0;
        if (pool[p.id] < 0) throw Error('搶購分配數量錯誤，請重新計算。');
      }
    };
    // 未付運費的買家商品進共用池；有付運費的買家各自成車。
    if (!onlyRemaining) {
      for (const o of state.orders.filter(o => (o.shippingTwd ?? 0) <= 0)) {
        for (const p of state.products) pool[p.id] += o.quantities[p.id] ?? 0;
      }
    }
    const index = new Map(state.orders.map((o, i) => [o.id, i]));
    const paid = onlyRemaining
      ? []
      : state.orders
        .filter(o => (o.shippingTwd ?? 0) > 0)
        .sort((a, b) => total(state, b).twd - total(state, a).twd || (a.sequence ?? Infinity) - (b.sequence ?? Infinity) || index.get(a.id) - index.get(b.id));
    for (const o of paid) {
      const remaining = {...o.quantities};
      while (nonEmpty(remaining)) {
        const quantities = fillLimitedCart(state, remaining);
        for (const p of state.products) remaining[p.id] = (remaining[p.id] ?? 0) - quantities[p.id];
        const capacities = purchaseCapacities(state, quantities);
        const ownCost = purchaseJpy(state, {quantities}),
          topUp = minimumShippingBundle(state, pool, capacities, Math.max(0, FREE_SHIPPING_JPY - ownCost), quantities);
        if (topUp) {
          consume(topUp);
          for (const p of state.products) quantities[p.id] += topUp[p.id] ?? 0;
        }
        make(quantities, true, o.nickname);
      }
    }
    while (nonEmpty(pool)) {
      const bundle = minimumShippingBundle(state, pool, limits, FREE_SHIPPING_JPY);
      if (!bundle) break;
      consume(bundle);
      make(bundle, false);
    }
    // 剩餘未達免運的商品集中成單；限購不容許一筆裝完時，依上限拆成必要筆數。
    while (nonEmpty(pool)) {
      const quantities = fillLimitedCart(state, pool);
      consume(quantities);
      make(quantities, false);
    }
    if (result.some(o => purchaseLimitViolations(state, o.quantities).length)) throw Error('整盒與單抽共用限購核對失敗，未取代現有搶購訂單。');
    for (const p of state.products) {
      const expected = state.orders.reduce((sum, o) => sum + (o.quantities[p.id] ?? 0), 0),
        actual = result.reduce((sum, o) => sum + o.quantities[p.id], 0);
      if (!Number.isSafeInteger(expected) || expected !== actual || result.some(o => o.quantities[p.id] > limits[p.id])) throw Error('數量核對失敗，未取代現有搶購訂單。');
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // 退費與境內運費分攤
  // ---------------------------------------------------------------------------

  /** 單一買家的應退金額（TWD）。 */
  function refundAmount(state, o) {
    return state.products.reduce((sum, p) => sum + (o.refundQuantities?.[p.id] ?? 0) * moneyCents(p.twd), 0) / 100;
  }

  /** 全團應退金額合計（TWD）。 */
  function refundGrandTotal(state) {
    return state.orders.reduce((sum, o) => sum + moneyCents(refundAmount(state, o)), 0) / 100;
  }

  /** 實際購買未達免運的境內運費，由運費為 0 且退費後仍有商品的買家平均分攤。 */
  function shippingShare(state) {
    const purchases = state.purchaseOrders ?? [];
    const belowFreeShippingCount = purchases.filter(o =>
      state.products.some(p => actualPurchaseQuantity(o, p.id) > 0) &&
      purchaseJpy(state, {quantities: actualPurchaseQuantities(state, o)}) < FREE_SHIPPING_JPY).length;
    const zeroShippingBuyerCount = state.orders.filter(o =>
      (o.shippingTwd ?? 0) === 0 &&
      state.products.some(p => (o.quantities[p.id] ?? 0) > (o.refundQuantities?.[p.id] ?? 0))).length;
    const totalShippingTwd = belowFreeShippingCount * SHIPPING_PER_ORDER_TWD;
    return {
      belowFreeShippingCount,
      shippingPerOrderTwd: SHIPPING_PER_ORDER_TWD,
      totalShippingTwd,
      zeroShippingBuyerCount,
      perBuyerTwd: totalShippingTwd === 0 ? 0 : zeroShippingBuyerCount ? roundMoney(totalShippingTwd / zeroShippingBuyerCount) : null
    };
  }

  // ---------------------------------------------------------------------------
  // 實際購買、自動退費與國際運費
  // ---------------------------------------------------------------------------

  /** 搶購訂單某商品的實際購買數量（未記錄時沿用搶購數量）。 */
  function actualPurchaseQuantity(order, pid) {
    return order.actualQuantities?.[pid] ?? order.quantities[pid] ?? 0;
  }

  /** 搶購訂單所有商品的實際購買數量。 */
  function actualPurchaseQuantities(state, order) {
    return Object.fromEntries(state.products.map(p => [p.id, actualPurchaseQuantity(order, p.id)]));
  }

  /** purchaseReconciliation 加上實際購買數量與短缺量。 */
  function actualPurchaseReconciliation(state) {
    return purchaseReconciliation(state).map(row => {
      const purchased = (state.purchaseOrders ?? []).reduce((sum, o) => sum + actualPurchaseQuantity(o, row.productId), 0);
      return {...row, purchased, shortage: row.planned - purchased};
    });
  }

  /** 買家扣除退費後實際買到的商品總數。 */
  function successfulBuyerQuantity(state, order) {
    return state.products.reduce((sum, product) =>
      sum + Math.max(0, (order.quantities[product.id] ?? 0) - (order.refundQuantities?.[product.id] ?? 0)), 0);
  }

  /** 國際運費依件數、境內運費依人數分攤到每位買家（整數分，餘數依序分給前面的件／人）。 */
  function internationalShippingBreakdown(state) {
    const buyers = state.orders.map(order => ({order, quantity: successfulBuyerQuantity(state, order)}));
    const buyerQuantityTotal = buyers.reduce((sum, buyer) => sum + buyer.quantity, 0);
    const totalQuantity = (state.purchaseOrders ?? []).reduce((sum, order) =>
      sum + state.products.reduce((count, product) => count + actualPurchaseQuantity(order, product.id), 0), 0);
    const internationalCents = moneyCents(state.internationalShippingTwd ?? 0);
    const intlBaseCents = totalQuantity ? Math.floor(internationalCents / totalQuantity) : 0;
    const intlRemainder = totalQuantity ? internationalCents % totalQuantity : 0;
    const domestic = shippingShare(state),
      domesticTotalCents = moneyCents(domestic.totalShippingTwd);
    const domesticBaseCents = domestic.zeroShippingBuyerCount ? Math.floor(domesticTotalCents / domestic.zeroShippingBuyerCount) : 0;
    const domesticRemainder = domestic.zeroShippingBuyerCount ? domesticTotalCents % domestic.zeroShippingBuyerCount : 0;
    let itemCursor = 0,
      buyerCursor = 0;
    const rows = buyers.map(({order, quantity}) => {
      const start = itemCursor,
        end = start + quantity;
      const extraIntlCents = Math.max(0, Math.min(end, intlRemainder) - Math.min(start, intlRemainder));
      itemCursor = end;
      const internationalCents = intlBaseCents * quantity + extraIntlCents;
      const paysDomestic = (order.shippingTwd ?? 0) === 0 && quantity > 0;
      const domesticCents = paysDomestic ? domesticBaseCents + (buyerCursor++ < domesticRemainder ? 1 : 0) : 0;
      return {order, quantity, internationalCents, domesticCents, totalCents: internationalCents + domesticCents};
    });
    const allocatedInternationalCents = rows.reduce((sum, row) => sum + row.internationalCents, 0);
    const allocatedDomesticCents = rows.reduce((sum, row) => sum + row.domesticCents, 0);
    return {
      rows,
      totalQuantity,
      buyerQuantityTotal,
      internationalCents,
      domesticTotalCents,
      allocatedInternationalCents,
      allocatedDomesticCents,
      unallocatedInternationalCents: internationalCents - allocatedInternationalCents,
      unallocatedDomesticCents: domesticTotalCents - allocatedDomesticCents,
      totalDueCents: rows.reduce((sum, row) => sum + row.totalCents, 0)
    };
  }

  /**
   * 依實際購買短缺量，從優先順序最後的買家開始產生退費數量。
   * 回傳 Map(orderId → {productId: 退費數量})；不修改 state。
   * options.validate：若提供，會先以 validate(state) 檢查資料（UI 傳入 validate）。
   */
  function buildAutomaticRefunds(state, {validate} = {}) {
    if (typeof validate === 'function') validate(state);
    if (!(state.purchaseOrders ?? []).length) throw Error('請先建立搶購清單 A，再確認實際購買紀錄 B。');
    const checks = actualPurchaseReconciliation(state);
    if (checks.some(row => row.difference)) throw Error('搶購清單 A 尚未與訂購明細一致，請先完成分配或修正超額數量，再產生退費。');
    if (checks.some(row => !Number.isSafeInteger(row.planned) || !Number.isSafeInteger(row.purchased) || row.shortage < 0)) throw Error('搶購或實際購買數量無效，請先修正。');
    const refunds = new Map(state.orders.map(o => [o.id, Object.fromEntries(state.products.map(p => [p.id, 0]))])),
      allocation = buildAllocation(state);
    for (const row of checks) {
      let remaining = row.shortage;
      const priorities = allocation.products.find(p => p.productId === row.productId).priorities;
      for (let i = priorities.length - 1; i >= 0 && remaining > 0; i--) {
        const buyer = priorities[i],
          quantity = Math.min(remaining, buyer.quantity);
        refunds.get(buyer.orderId)[row.productId] = quantity;
        remaining -= quantity;
      }
      if (remaining) throw Error('退費數量超過買家預購數量，請先核對分配表。');
    }
    return refunds;
  }

  /** 實付成本、退費後營收、境內運費補貼與實際淨利（成本未填齊時淨利為 null）。 */
  function actualCostSummary(state) {
    const orders = state.purchaseOrders ?? [],
      missingCount = orders.filter(o => o.actualCostTwd == null).length;
    const recordedCostTwd = orders.reduce((sum, o) => sum + moneyCents(o.actualCostTwd ?? 0), 0) / 100;
    const netRevenueTwd = (moneyCents(allTotals(state).twd) - moneyCents(refundGrandTotal(state))) / 100;
    const shipping = shippingShare(state),
      shippingSupplementTwd = shipping.totalShippingTwd;
    const complete = orders.length > 0 && missingCount === 0;
    return {
      recordedCostTwd,
      missingCount,
      totalCount: orders.length,
      complete,
      netRevenueTwd,
      shippingSupplementTwd,
      belowFreeShippingCount: shipping.belowFreeShippingCount,
      actualNetProfitTwd: complete
        ? (moneyCents(netRevenueTwd) - moneyCents(recordedCostTwd) + moneyCents(shippingSupplementTwd)) / 100
        : null
    };
  }

  const OrderLogic = Object.freeze({
    FREE_SHIPPING_JPY,
    SHIPPING_PER_ORDER_TWD,
    fmt,
    moneyCents,
    validMoney,
    roundMoney,
    nicknameKey,
    productNumber,
    numberFromName,
    productUnit,
    productLabel,
    total,
    allTotals,
    priorityLetter,
    buildAllocation,
    blindBoxKey,
    blindBoxSource,
    blindBoxGroups,
    productUnitWeight,
    groupUnitCap,
    assertBlindBoxSettings,
    purchaseLimitViolations,
    purchaseCapacities,
    fillLimitedCart,
    purchaseJpy,
    minimumShippingBundle,
    minimumGroupedShippingBundle,
    purchaseReconciliation,
    buildAutomaticPurchaseOrders,
    refundAmount,
    refundGrandTotal,
    shippingShare,
    actualPurchaseQuantity,
    actualPurchaseQuantities,
    actualPurchaseReconciliation,
    successfulBuyerQuantity,
    internationalShippingBreakdown,
    buildAutomaticRefunds,
    actualCostSummary
  });

  root.OrderLogic = OrderLogic;
  if (typeof module !== 'undefined' && module.exports) module.exports = OrderLogic;
})(typeof globalThis !== 'undefined' ? globalThis : this);
