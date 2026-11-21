'use strict';
// 由開啟使用.html 自動載入；計算、畫面互動與訂單檔案處理。
const $=id=>document.getElementById(id), clone=x=>JSON.parse(JSON.stringify(x));
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=OrderLogic.fmt;
// 金額以整數分運算，數量仍依商品限購與預購總量處理。
function moneyCents(value){return OrderLogic.moneyCents(value);}
function validMoney(value){return OrderLogic.validMoney(value);}
function roundMoney(value){return OrderLogic.roundMoney(value);}
function assertSafeAmounts(data){
 moneyCents(data.internationalShippingTwd??0);
 let twd=0,jpy=0,refund=0,quantity=0;
 const add=(a,b)=>{const sum=a+b;if(!Number.isSafeInteger(sum))throw Error('合計金額或數量過大，請調整輸入。');return sum;};
 for(const o of data.orders){
  let buyerTwd=moneyCents(o.shippingTwd??0),buyerJpy=0,buyerRefund=0,buyerQuantity=0;
  for(const p of data.products){const q=o.quantities[p.id]??0,r=o.refundQuantities?.[p.id]??0;buyerTwd=add(buyerTwd,q*moneyCents(p.twd));buyerJpy=add(buyerJpy,q*moneyCents(p.jpy));buyerRefund=add(buyerRefund,r*moneyCents(p.twd));buyerQuantity=add(buyerQuantity,q);}
  twd=add(twd,buyerTwd);jpy=add(jpy,buyerJpy);refund=add(refund,buyerRefund);quantity=add(quantity,buyerQuantity);
 }
 let plannedJpy=0,actualJpy=0,plannedQuantity=0,actualQuantity=0,actualCost=0,belowFreeShippingCount=0;
 for(const o of data.purchaseOrders??[]){
  if(o.actualCostTwd!=null&&!validMoney(o.actualCostTwd))throw Error('實付成本須為有效的非負台幣金額，最多兩位小數。');
  actualCost=add(actualCost,moneyCents(o.actualCostTwd??0));
  let planned=0,actual=0,hasActualQuantity=false;
  for(const p of data.products){const q=o.quantities[p.id]??0,b=o.actualQuantities?.[p.id]??q;planned=add(planned,q*moneyCents(p.jpy));actual=add(actual,b*moneyCents(p.jpy));plannedQuantity=add(plannedQuantity,q);actualQuantity=add(actualQuantity,b);hasActualQuantity||=b>0;}
  if(hasActualQuantity&&actual<moneyCents(FREE_SHIPPING_JPY))belowFreeShippingCount++;
  plannedJpy=add(plannedJpy,planned);actualJpy=add(actualJpy,actual);
 }
 add(add(add(twd,-refund),-actualCost),moneyCents(belowFreeShippingCount*SHIPPING_PER_ORDER_TWD));
 const cost=roundMoney(jpy/100*(data.exchangeRate??0.21));roundMoney(twd/100-cost);
}

let state=clone(SEED),tab='orders',amountSort=null;
const ARRIVAL_STATUSES=['未到日本集運倉','已到日本集運倉','已到台灣集運倉','通知出貨','已建立委託單'];
const SHIPPING_STATUSES=['等待付款還未出貨','宅配中(公司)','宅配中(家裡)','寄送超商(7-11)','寄送超商(全家)','已收貨'];
function syncShipmentRecords(){
 const existing=new Map((state.shipmentRecords??[]).map(record=>[record.purchaseOrderId,record]));
 state.shipmentRecords=(state.purchaseOrders??[]).map((order,index)=>existing.get(order.id)??{purchaseOrderId:order.id,warehouse:'',sequence:index+1,shoppingOrderNumber:'',trackingCode:'',weightKg:null,arrivalStatus:ARRIVAL_STATUSES[0],shippingStatus:SHIPPING_STATUSES[0]});
}
function renderShipmentRecords(){
 syncShipmentRecords();
 const orders=state.purchaseOrders??[];
 const statusOptions=(options,selected)=>'<option value="">選擇狀態</option>'+options.map(status=>'<option value="'+esc(status)+'"'+(selected===status?' selected':'')+'>'+esc(status)+'</option>').join('');
 const rows=orders.map((order,index)=>{
  const record=state.shipmentRecords[index];
  const account=(state.purchaseAccounts??[]).find(item=>item.id===order.accountId)?.name??'';
  const label=esc(order.name);
  return '<tr>'+
   '<td data-label="集運倉"><input maxlength="100" value="'+esc(record.warehouse)+'" data-shipment-field="warehouse" data-shipment-order="'+esc(order.id)+'" aria-label="'+label+' 集運倉" placeholder="例如 SHIPIGO"></td>'+
   '<td data-label="序"><input type="number" min="1" max="9007199254740991" step="1" value="'+esc(record.sequence??'')+'" data-shipment-field="sequence" data-shipment-order="'+esc(order.id)+'" aria-label="'+label+' 序"></td>'+
   '<td data-label="搶購順序／訂單"><strong>'+label+'</strong></td>'+
   '<td data-label="搶購的帳號">'+esc(account||'—')+'</td>'+
   '<td data-label="購物訂單編號"><input maxlength="200" value="'+esc(record.shoppingOrderNumber)+'" data-shipment-field="shoppingOrderNumber" data-shipment-order="'+esc(order.id)+'" aria-label="'+label+' 購物訂單編號"></td>'+
   '<td data-label="包裹追蹤碼"><input maxlength="200" value="'+esc(record.trackingCode)+'" data-shipment-field="trackingCode" data-shipment-order="'+esc(order.id)+'" aria-label="'+label+' 包裹追蹤碼"></td>'+
   '<td data-label="入庫重量"><label class="shipment-weight"><input type="number" min="0" max="99999.99" step="0.01" value="'+esc(record.weightKg??'')+'" data-shipment-field="weightKg" data-shipment-order="'+esc(order.id)+'" aria-label="'+label+' 入庫重量"><span>KG</span></label></td>'+
   '<td data-label="到貨狀態"><select data-shipment-field="arrivalStatus" data-shipment-order="'+esc(order.id)+'" aria-label="'+label+' 到貨狀態">'+statusOptions(ARRIVAL_STATUSES,record.arrivalStatus)+'</select></td>'+
   '<td data-label="出貨狀態"><select data-shipment-field="shippingStatus" data-shipment-order="'+esc(order.id)+'" aria-label="'+label+' 出貨狀態">'+statusOptions(SHIPPING_STATUSES,record.shippingStatus)+'</select></td>'+
  '</tr>';
 }).join('');
 $('shipmentLog').innerHTML='<thead><tr><th>集運倉</th><th>序</th><th>搶購順序／訂單</th><th>搶購的帳號</th><th>購物訂單編號</th><th>包裹追蹤碼</th><th>入庫重量</th><th>到貨狀態</th><th>出貨狀態</th></tr></thead><tbody>'+(rows||'<tr><td class="empty" colspan="9">請先到「訂單搶購分配順序」建立訂單。</td></tr>')+'</tbody>';
}
function updateShipmentField(event){
 const element=event.target,field=element.dataset.shipmentField;
 if(!field)return;
 if(element.tagName==='SELECT'&&event.type!=='change')return;
 if(element.tagName!=='SELECT'&&event.type!=='input')return;
 const record=(state.shipmentRecords??[]).find(item=>item.purchaseOrderId===element.dataset.shipmentOrder);
 if(!record)return;
 if(field==='sequence'||field==='weightKg'){
  if(element.value!==''&&!element.checkValidity()){notify(field==='sequence'?'序必須是大於 0 的整數。':'入庫重量必須是 0 以上、最多兩位小數。',true);return;}
  const value=element.value===''?null:Number(element.value);
  if(field==='sequence'&&value!==null&&!Number.isSafeInteger(value)){notify('序必須是大於 0 的整數。',true);return;}
  if(field==='weightKg'&&value!==null&&!validMoney(value)){notify('入庫重量必須是 0 以上、最多兩位小數。',true);return;}
  record[field]=value;
 }else record[field]=element.value;
 save();notify('');
}
let purchaseAllocationBusy=false;
const selectedOrderIds=new Set();
function sortOrderRows(){if(!amountSort)return;const body=$('orders').querySelector('tbody');if(!body)return;const orderIndex=new Map(state.orders.map((o,i)=>[o.id,i]));const rows=[...body.rows].filter(row=>row.querySelector('[data-total="twd"]'));rows.sort((a,b)=>{const aid=a.querySelector('[data-total="twd"]').dataset.order,bid=b.querySelector('[data-total="twd"]').dataset.order;const ao=state.orders[orderIndex.get(aid)],bo=state.orders[orderIndex.get(bid)];const splitPriority=Number(Boolean(ao.isSplitBlindBox))-Number(Boolean(bo.isSplitBlindBox));const shippingPriority=ao.isSplitBlindBox&&bo.isSplitBlindBox?0:Number((bo.shippingTwd??0)>0)-Number((ao.shippingTwd??0)>0);const av=total(ao).twd,bv=total(bo).twd;return splitPriority||shippingPriority||(amountSort==='asc'?av-bv:bv-av)||orderIndex.get(aid)-orderIndex.get(bid)});for(let index=0;index<rows.length;index++){const current=body.rows[index];if(current!==rows[index])body.insertBefore(rows[index],current??null);}}
function nicknameKey(name){return OrderLogic.nicknameKey(name);}
function uniqueBuyerName(){let name='新買家',suffix=2;while(state.orders.some(o=>nicknameKey(o.nickname)===nicknameKey(name)))name='新買家 '+suffix++;return name;}
function productNumber(value){return OrderLogic.productNumber(value);}
function validProductNumber(value){return /^\d+$/.test(String(value))&&Number(value)>=1&&Number(value)<=999;}
// 商品編號是所有頁籤與匯出的共同順序；同編號維持原有先後。
function sortProducts(products=state.products){return products.sort((a,b)=>Number(a.productNumber)-Number(b.productNumber));}
function numberFromName(name){return OrderLogic.numberFromName(name);}
function nextProductNumber(products=state.products){const used=new Set(products.map(p=>productNumber(p.productNumber||numberFromName(p.name))));let n=1;while(used.has(String(n)))n++;return String(n);}
function productUnit(p){return OrderLogic.productUnit(p);}
function productLabel(p){return OrderLogic.productLabel(p);}
// 舊檔案補上商品編號；單一盲盒的整盒／單抽保留原有共用設定。
function normalizeProductNumbers(products){
 const result=products.map(p=>({...p,productNumber:productNumber(p.productNumber??numberFromName(p.name))}));
 const legacy=new Map();
 for(let i=0;i<result.length;i++){
  const p=result[i];if(!p.isBlindBox||products[i].productNumber!==undefined)continue;
  const key=nicknameKey(p.blindBoxSeries||'legacy-shared');
  if(!legacy.has(key))legacy.set(key,[]);legacy.get(key).push(p);
 }
 for(const group of legacy.values()){
  const boxes=group.filter(p=>p.blindBoxType!=='single');
  if(boxes.length>1)throw Error('舊檔案有多款整盒盲盒，請先為整盒與單抽填入對應的商品編號。');
  const source=boxes[0]??group[0],number=source.productNumber||group.find(p=>p.productNumber)?.productNumber||nextProductNumber(result);
  for(const p of group){p.productNumber=number;p.blindBoxSize=source.blindBoxSize??1;p.purchaseLimit=source.purchaseLimit??1;}
 }
 for(const p of result)if(!p.productNumber)p.productNumber=nextProductNumber(result);
 if(result.some(p=>!validProductNumber(p.productNumber)))throw Error('商品編號必須是 1～999 的整數。');
 return sortProducts(result);
}
function validate(d,{allowDuplicateNicknames=false}={}){
 if(d&&d.exchangeRate!==undefined&&(!Number.isFinite(d.exchangeRate)||d.exchangeRate<=0))throw Error('匯率必須是大於 0 的數字。');
 if(d&&d.internationalShippingTwd!==undefined&&!validMoney(d.internationalShippingTwd))throw Error('國際運費必須是有效的非負台幣金額，最多兩位小數。');
 if(!d||d.schemaVersion!==1||typeof d.title!=='string'||!d.title.trim()||d.title.length>200||!Array.isArray(d.products)||!Array.isArray(d.orders))throw Error('訂單檔案格式不符，請選擇由此頁面儲存的訂單檔案。');
 if(d.products.length>200||d.orders.length>2000)throw Error('最多支援 200 個商品與 2,000 筆訂購紀錄。');
 const accounts=d.purchaseAccounts??[];if(!Array.isArray(accounts)||accounts.length>200)throw Error('最多支援 200 個搶購帳號。');const accountIds=new Set(),accountNames=new Set();for(const a of accounts){if(!a||typeof a.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(a.id)||accountIds.has(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>200||accountNames.has(nicknameKey(a.name)))throw Error('搶購帳號名稱不可空白或重複。');accountIds.add(a.id);accountNames.add(nicknameKey(a.name));}
 const ids=new Set(), orderIds=new Set(),nicknames=new Set();
 for(const entry of [...d.products,...d.orders])if(!entry||typeof entry.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id))throw Error('資料 ID 只能包含英文字母、數字、底線與連字號。');
 for(const p of d.products){if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>500||!validMoney(p.twd)||!validMoney(p.jpy))throw Error('商品 ID、名稱或單價無效。');if(p.purchaseLimit!==undefined&&(!Number.isSafeInteger(p.purchaseLimit)||p.purchaseLimit<1))throw Error('限購數量必須是大於 0 的整數。');if(p.productUrl!==undefined&&(typeof p.productUrl!=='string'||p.productUrl.length>2048))throw Error('商品連結格式無效。');if(p.imageName!==undefined&&(typeof p.imageName!=='string'||p.imageName.length>500))throw Error('商品附圖名稱無效。');if(p.imageData!==undefined&&(typeof p.imageData!=='string'||(p.imageData&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.imageData))))throw Error('商品附圖格式無效。');if(p.isBlindBox!==undefined&&typeof p.isBlindBox!=='boolean')throw Error('盲盒標記格式無效。');if(p.blindBoxSeries!==undefined&&(typeof p.blindBoxSeries!=='string'||p.blindBoxSeries.length>200))throw Error('盲盒系列名稱無效。');if(p.blindBoxSize!==undefined&&(!Number.isSafeInteger(p.blindBoxSize)||p.blindBoxSize<1))throw Error('每盒盲盒數量必須是正整數。');if(p.blindBoxType!==undefined&&!['box','single'].includes(p.blindBoxType))throw Error('盲盒販售單位無效。');ids.add(p.id)}
 for(const p of d.products)if(p.productNumber!==undefined&&(!['string','number'].includes(typeof p.productNumber)||!validProductNumber(productNumber(p.productNumber))))throw Error('商品編號必須是 1～999 的整數。');
 const products=normalizeProductNumbers(d.products);assertBlindBoxSettings(products);
 for(const o of d.orders){if(!o||typeof o.id!=='string'||!o.id||orderIds.has(o.id)||typeof o.nickname!=='string'||!o.nickname.trim()||o.nickname.length>200||!(o.sequence===null||(Number.isSafeInteger(o.sequence)&&o.sequence>=0))||!o.quantities||Array.isArray(o.quantities)||typeof o.quantities!=='object')throw Error('訂購 ID、暱稱、留言順序或數量格式無效。');if(o.isRemitted!==undefined&&typeof o.isRemitted!=='boolean')throw Error('已匯款標記格式無效。');if(o.isRefunded!==undefined&&typeof o.isRefunded!=='boolean')throw Error('已退費標記格式無效。');if(o.isSplitBlindBox!==undefined&&typeof o.isSplitBlindBox!=='boolean')throw Error('拆團盲盒標記格式無效。');if(o.shippingTwd!==undefined&&(!validMoney(o.shippingTwd)))throw Error('運費必須為非負數。');const name=nicknameKey(o.nickname);if(!allowDuplicateNicknames&&nicknames.has(name))throw Error('買家暱稱不可重複：'+o.nickname);nicknames.add(name);orderIds.add(o.id);for(const [id,q]of Object.entries(o.quantities))if(!ids.has(id)||!Number.isSafeInteger(q)||q<0)throw Error('訂購數量必須是非負整數，且對應有效商品 ID。');}
 for(const o of d.orders){if(o.refundQuantities!==undefined&&(!o.refundQuantities||typeof o.refundQuantities!=='object'||Array.isArray(o.refundQuantities)))throw Error('退費數量格式無效。');for(const [pid,q] of Object.entries(o.refundQuantities??{}))if(!ids.has(pid)||!Number.isSafeInteger(q)||q<0||q>(o.quantities[pid]??0))throw Error('退費商品數量不可超過原訂購數量。');}
 if(d.purchaseOrders!==undefined&&(!Array.isArray(d.purchaseOrders)||d.purchaseOrders.length>2000))throw Error('搶購訂單格式無效，最多 2,000 筆。');const purchaseIds=new Set();for(const order of d.purchaseOrders??[]){if(!order||typeof order.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(order.id)||purchaseIds.has(order.id)||typeof order.name!=='string'||!order.name.trim()||order.name.length>200||typeof order.isOwnCart!=='boolean'||!order.quantities||typeof order.quantities!=='object'||Array.isArray(order.quantities)||(order.serial!==undefined&&(!Number.isSafeInteger(order.serial)||order.serial<1)))throw Error('搶購訂單名稱、標記或數量格式無效。');if(order.accountId!==undefined&&(typeof order.accountId!=='string'||(order.accountId&&!accountIds.has(order.accountId))))throw Error('搶購訂單的帳號不存在。');if(order.purchaser!==undefined&&(typeof order.purchaser!=='string'||order.purchaser.length>200))throw Error('搶購人格式無效。');purchaseIds.add(order.id);for(const [pid,q]of Object.entries(order.quantities))if(!ids.has(pid)||!Number.isSafeInteger(q)||q<0)throw Error('搶購數量必須是對應商品的非負整數。');}
 for(const order of d.purchaseOrders??[]){if(order.actualQuantities!==undefined&&(!order.actualQuantities||typeof order.actualQuantities!=='object'||Array.isArray(order.actualQuantities)))throw Error('實際購買數量格式無效。');for(const [pid,q] of Object.entries(order.actualQuantities??{}))if(!ids.has(pid)||!Number.isSafeInteger(q)||q<0||q>(order.quantities[pid]??0))throw Error('實際購買數量必須是非負整數，且不可超過搶購清單 A 的數量。');}
 const rawShipmentRecords=d.shipmentRecords??[];
 if(!Array.isArray(rawShipmentRecords)||rawShipmentRecords.length>2000)throw Error('托運紀錄格式無效，最多 2,000 筆。');
 const shipmentByPurchaseId=new Map();
 for(const record of rawShipmentRecords){
  if(!record||typeof record.purchaseOrderId!=='string'||!purchaseIds.has(record.purchaseOrderId)||shipmentByPurchaseId.has(record.purchaseOrderId)||typeof (record.warehouse??'')!=='string'||(record.warehouse??'').length>100||!(record.sequence===undefined||record.sequence===null||(Number.isSafeInteger(record.sequence)&&record.sequence>=1))||typeof (record.shoppingOrderNumber??'')!=='string'||(record.shoppingOrderNumber??'').length>200||typeof (record.trackingCode??'')!=='string'||(record.trackingCode??'').length>200||!(record.weightKg===undefined||record.weightKg===null||validMoney(record.weightKg))||!['',...ARRIVAL_STATUSES].includes(record.arrivalStatus??ARRIVAL_STATUSES[0])||!['',...SHIPPING_STATUSES].includes(record.shippingStatus??SHIPPING_STATUSES[0]))throw Error('托運紀錄欄位格式無效，請檢查集運倉、序、重量與狀態。');
  shipmentByPurchaseId.set(record.purchaseOrderId,record);
 }
 const normalizedShipmentRecords=(d.purchaseOrders??[]).map((order,index)=>{
  const record=shipmentByPurchaseId.get(order.id)??{};
  return {purchaseOrderId:order.id,warehouse:record.warehouse??'',sequence:record.sequence===undefined?index+1:record.sequence,shoppingOrderNumber:record.shoppingOrderNumber??'',trackingCode:record.trackingCode??'',weightKg:record.weightKg===undefined?null:record.weightKg,arrivalStatus:record.arrivalStatus??ARRIVAL_STATUSES[0],shippingStatus:record.shippingStatus??SHIPPING_STATUSES[0]};
 });
 assertSafeAmounts(d);
 return {schemaVersion:1,title:d.title,internationalShippingTwd:d.internationalShippingTwd??0,purchaseAccounts:accounts.map(a=>({id:a.id,name:a.name.trim()})),purchaseOrders:(d.purchaseOrders??[]).map((o,i)=>({id:o.id,name:o.name,accountId:o.accountId??'',purchaser:o.purchaser??'',isOwnCart:o.isOwnCart,serial:o.serial??i+1,actualCostTwd:o.actualCostTwd??null,actualQuantities:Object.fromEntries(d.products.map(p=>[p.id,o.actualQuantities?.[p.id]??o.quantities[p.id]??0])),quantities:Object.fromEntries(d.products.map(p=>[p.id,o.quantities[p.id]??0]))})),shipmentRecords:normalizedShipmentRecords,exchangeRate:d.exchangeRate??0.21,source:d.source&&typeof d.source.file==='string'&&typeof d.source.sheet==='string'?{file:d.source.file,sheet:d.source.sheet}:null,products:products.map(p=>({id:p.id,productNumber:p.productNumber,name:p.name,twd:p.twd,jpy:p.jpy,purchaseLimit:p.purchaseLimit??1,productUrl:p.productUrl??'',imageData:p.imageData??'',imageName:p.imageName??'',isBlindBox:p.isBlindBox??false,blindBoxSize:p.blindBoxSize??1,blindBoxType:p.blindBoxType??'box'})),orders:d.orders.map(o=>({id:o.id,sequence:o.sequence,nickname:o.nickname,isSplitBlindBox:o.isSplitBlindBox??false,isRemitted:o.isRemitted??false,isRefunded:o.isRefunded??false,shippingTwd:o.shippingTwd??0,refundQuantities:Object.fromEntries(d.products.map(p=>[p.id,o.refundQuantities?.[p.id]??0])),quantities:Object.fromEntries(d.products.map(p=>[p.id,o.quantities[p.id]??0]))}))};
}
function total(o){return OrderLogic.total(state,o);}
function allTotals(){return OrderLogic.allTotals(state);}
function priorityLetter(index){return OrderLogic.priorityLetter(index);}
function buildAllocation(){return OrderLogic.buildAllocation(state);}
function renderAllocationTable(){
 const allocation=buildAllocation(),products=new Map(state.products.map(p=>[p.id,p]));
 const query=$('search').value;
 const rows=allocation.products.filter(r=>r.priorities.length&&r.priorities.some(b=>fuzzyNickname(b.nickname,query)));
 const count=Math.max(1,...rows.map(r=>r.priorities.length));
 $('allocation').innerHTML='<thead><tr><th>商品</th>'+Array.from({length:count},(_,i)=>`<th>優先序 ${priorityLetter(i)}</th>`).join('')+'</tr></thead><tbody>'+rows.map(r=>`<tr data-priority-product="${esc(r.productId)}"><td data-label="商品"><strong>${esc(productLabel(products.get(r.productId)))}</strong><button type="button" class="small product-detail-export" data-export-product-detail="${esc(r.productId)}" aria-label="匯出 ${esc(productLabel(products.get(r.productId)))} 的訂購明細">匯出此商品明細</button></td>${Array.from({length:count},(_,i)=>{const b=r.priorities[i];return b&&fuzzyNickname(b.nickname,query)?`<td data-label="優先序 ${b.priority}" data-priority-order="${esc(b.orderId)}"><strong>${esc(b.nickname)}</strong><span class="priority-detail">${fmt(b.quantity)} ${productUnit(products.get(r.productId))}</span><span class="priority-detail">台幣合計 ${fmt(b.twd)}</span><span class="priority-detail">${b.shippingTwd>0?'有運費':'無運費'} · 順序 ${b.sequence??'—'}</span></td>`:'<td class="priority-empty"></td>'}).join('')}</tr>`).join('')+(rows.length?'':`<tr><td class="empty" colspan="${count+1}">尚無符合的預購商品。</td></tr>` )+'</tbody>';
}
let editingPurchaseId=null,lastSuggestedPurchaseName='';
const FREE_SHIPPING_JPY=OrderLogic.FREE_SHIPPING_JPY;
const SHIPPING_PER_ORDER_TWD=OrderLogic.SHIPPING_PER_ORDER_TWD;
function purchaseJpy(o){return OrderLogic.purchaseJpy(state,o);}
function minimumShippingBundle(pool,capacity,targetJpy,existing={}){return OrderLogic.minimumShippingBundle(state,pool,capacity,targetJpy,existing);}
function buildAutomaticPurchaseOrders({onlyRemaining=false}={}){return OrderLogic.buildAutomaticPurchaseOrders(state,{onlyRemaining,makeId:id});}
function purchaseReconciliation(){return OrderLogic.purchaseReconciliation(state);}
function purchaseAssignable(excludeOrderId=editingPurchaseId){
 return Object.fromEntries(state.products.map(p=>[p.id,Math.max(0,state.orders.reduce((sum,o)=>sum+(o.quantities[p.id]??0),0)-(state.purchaseOrders??[]).filter(o=>o.id!==excludeOrderId).reduce((sum,o)=>sum+(o.quantities[p.id]??0),0))]));
}
function renderPurchaseOrders(){
 const reconciliationOpen=$('purchaseSummary').querySelector('details')?.open??false;
 const orders=state.purchaseOrders??[],checks=purchaseReconciliation();const violations=orders.flatMap(o=>purchaseLimitViolations(o.quantities).map(v=>o.name+'：'+v.message));
 renderPurchaseSummary(orders,checks,violations,reconciliationOpen);
 $('purchase').innerHTML='<thead><tr><th>搶購帳號</th><th>搶購人</th><th>搶購順序</th><th>訂單名稱</th><th>自成一車</th>'+state.products.map(p=>`<th>${esc(productLabel(p))}</th>`).join('')+'<th>日幣金額／免運</th><th>數量合計</th><th>匯出</th></tr></thead><tbody>'+orders.map((o,i)=>`<tr data-purchase-order="${esc(o.id)}"><td data-label="搶購帳號"><select data-purchase-field="accountId" data-purchase-id="${esc(o.id)}" aria-label="${esc(o.name)} 搶購帳號"><option value="">選擇搶購帳號</option>${(state.purchaseAccounts??[]).map(a=>`<option value="${esc(a.id)}" ${o.accountId===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></td><td data-label="搶購人"><input maxlength="200" value="${esc(o.purchaser??'')}" data-purchase-field="purchaser" data-purchase-id="${esc(o.id)}" aria-label="${esc(o.name)} 搶購人"></td><td data-label="搶購順序">${i+1}</td><td data-label="訂單名稱"><strong>${esc(o.name)}</strong></td><td data-label="自成一車">${o.isOwnCart?'✓':'—'}</td>${state.products.map(p=>`<td data-label="${esc(productLabel(p))}">${(o.quantities[p.id]??0)>0?'<strong class="positive-quantity">'+fmt(o.quantities[p.id])+'</strong>':fmt(0)}</td>`).join('')}<td data-label="日幣金額／免運"><strong>${fmt(purchaseJpy(o))}</strong><span class="priority-detail ${purchaseJpy(o)<FREE_SHIPPING_JPY?'mismatch':''}">${purchaseJpy(o)>=FREE_SHIPPING_JPY?'達免運':'差 JPY '+fmt(FREE_SHIPPING_JPY-purchaseJpy(o))}</span></td><td data-label="數量合計">${fmt(state.products.reduce((sum,p)=>sum+(o.quantities[p.id]??0),0))}</td><td data-label="匯出"><button class="small" data-export-purchase-image="${esc(o.id)}">匯出圖片</button><button class="small" data-export-purchase-list="${esc(o.id)}">匯出清單</button><button class="small" data-edit-purchase="${esc(o.id)}">編輯</button><button class="small danger" data-delete-purchase="${esc(o.id)}">刪除</button></td></tr>`).join('')+(orders.length?'':`<tr><td class="empty" colspan="${state.products.length+8}">點選「手動新增訂單」，安排各筆訂單要搶購的商品數量。</td></tr>`)+`</tbody><tfoot><tr><td colspan="5">搶購數量合計</td>${checks.map(x=>`<td data-label="${esc(x.name)}">${fmt(x.planned)}</td>`).join('')}<td data-label="日幣金額">${fmt(orders.reduce((sum,o)=>sum+purchaseJpy(o),0))}</td><td data-label="數量合計">${fmt(checks.reduce((sum,x)=>sum+x.planned,0))}</td><td></td></tr></tfoot>`;
}
function nextPurchaseSerial(isOwnCart=false){return Math.max(0,...(state.purchaseOrders??[]).filter(o=>o.id!==editingPurchaseId&&o.isOwnCart===isOwnCart).map(o=>o.serial??0))+1;}
function openPurchaseDialog(orderId=null){
 try{assertBlindBoxSettings();}catch(error){notify(error.message,true);return;}
 if(!state.products.length){notify('請先新增商品，再安排搶購訂單。',true);return;}
 if(!orderId&&(state.purchaseOrders??[]).length>=2000){notify('最多支援 2,000 筆搶購訂單。',true);return;}
 const order=(state.purchaseOrders??[]).find(o=>o.id===orderId);editingPurchaseId=orderId;
 $('purchaseDialogTitle').textContent=order?'編輯搶購訂單':'新增搶購訂單';$('purchaseName').setCustomValidity('');$('purchaseName').value=order?.name??'訂單'+nextPurchaseSerial();$('purchaseOwnCart').checked=order?.isOwnCart??false;
 lastSuggestedPurchaseName=order&&order.name===((order.isOwnCart?'自成一車':'訂單')+order.serial)?order.name:order?'':$('purchaseName').value;
 $('purchaseQuantities').innerHTML=state.products.map(p=>`<label>${esc(productLabel(p))}<input type="number" min="0" max="9007199254740991" step="1" required value="${order?.quantities[p.id]??0}" data-limit="${p.purchaseLimit??1}" data-purchase-quantity="${esc(p.id)}" aria-label="${esc(productLabel(p))} 搶購數量"><span class="priority-detail">${esc(purchaseLimitLabel(p))} · 訂購總量 ${fmt(state.orders.reduce((sum,o)=>sum+(o.quantities[p.id]??0),0))}</span></label>`).join('');
 syncPurchaseInputCaps();$('purchaseDialog').showModal();$('purchaseName').focus();$('purchaseName').select();
}
function refundAmount(o){return OrderLogic.refundAmount(state,o);}
function refundGrandTotal(){return OrderLogic.refundGrandTotal(state);}
function renderRefunds(){const filtered=state.orders.filter(o=>fuzzyNickname(o.nickname,$('search').value));
 $('refunds').innerHTML='<thead><tr><th>順序</th><th>買家暱稱</th>'+state.products.map(p=>`<th class="product">${esc(productLabel(p))}<span class="price">TWD ${fmt(p.twd)}</span></th>`).join('')+'<th class="num">應退金額 TWD</th><th class="refunded">已退費</th></tr></thead><tbody>'+filtered.map(o=>`<tr class="${o.isRefunded?'refunded-row':''}"><td data-label="留言順序">${o.sequence??'—'}</td><td data-label="買家暱稱">${esc(o.nickname)}</td>${state.products.map(p=>`<td data-label="${esc(productLabel(p))}"><input type="number" min="0" max="${o.quantities[p.id]??0}" step="1" required value="${o.refundQuantities?.[p.id]??0}" data-kind="refundQty" data-order="${esc(o.id)}" data-product="${esc(p.id)}" aria-label="${esc(o.nickname+' '+productLabel(p))} 未買到數量"><span class="ordered-quantity">預購 ${fmt(o.quantities[p.id]??0)}</span></td>`).join('')}<td class="num sum" data-label="應退金額 TWD" data-refund-order="${esc(o.id)}">${fmt(refundAmount(o))}</td><td class="refunded" data-label="已退費"><input type="checkbox" data-kind="isRefunded" data-order="${esc(o.id)}" ${o.isRefunded?'checked':''} aria-label="${esc(o.nickname)} 已退費"></td></tr>`).join('')+(filtered.length?'':`<tr><td class="empty" colspan="${state.products.length+4}">沒有符合的訂購紀錄，請先新增預購訂單。</td></tr>`)+`</tbody><tfoot><tr><td colspan="2">全團應退合計</td>${state.products.map(p=>`<td class="num" data-label="${esc(productLabel(p))}" data-refund-product="${esc(p.id)}">${fmt(state.orders.reduce((sum,o)=>sum+(o.refundQuantities?.[p.id]??0),0))}</td>`).join('')}<td class="num" data-label="應退金額 TWD" id="footer-refund">${fmt(refundGrandTotal())}</td><td></td></tr></tfoot>`;
}
function shippingShare(){return OrderLogic.shippingShare(state);}
function updateRefundTotals(){const amount=refundGrandTotal();$('refundTotal').textContent=fmt(amount);const shipping=shippingShare();$('shippingTotal').textContent=shipping.perBuyerTwd===null?'—':fmt(shipping.perBuyerTwd);$('shippingCalculation').textContent=shipping.totalShippingTwd===0?`TWD／人 · 境內運費 0（實際購買未達免運 ${fmt(shipping.belowFreeShippingCount)} 筆）`:(shipping.zeroShippingBuyerCount?`TWD／人 · 境內運費：實際購買未達免運 ${fmt(shipping.belowFreeShippingCount)} 筆 × 230 ÷ ${fmt(shipping.zeroShippingBuyerCount)} 人（運費為 0 且退費後仍有商品）`:`境內運費：實際購買未達免運 ${fmt(shipping.belowFreeShippingCount)} 筆 × 230 = TWD ${fmt(shipping.totalShippingTwd)}；無可分攤對象（運費為 0 且退費後仍有商品：0 人）`);for(const o of state.orders){const el=document.querySelector(`[data-refund-order="${o.id}"]`);if(el)el.textContent=fmt(refundAmount(o));}for(const p of state.products){const el=document.querySelector(`[data-refund-product="${p.id}"]`);if(el)el.textContent=fmt(state.orders.reduce((sum,o)=>sum+(o.refundQuantities?.[p.id]??0),0));}if($('footer-refund'))$('footer-refund').textContent=fmt(amount);updateActualCostTotals();}
function notify(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error)}
function save(){$('saveStatus').textContent='尚未儲存訂單';}
function updateTotals(){renderPurchaseOrders();renderActualPurchases();renderAllocationTable();updateRefundTotals();const t=allTotals();const rate=state.exchangeRate??0.21;$('exchangeCalculation').textContent=`日幣 ${fmt(t.jpy)} × ${rate} = 台幣 ${fmt(roundMoney(t.jpy*rate))}`;const convertedCost=roundMoney(t.jpy*rate);$('estimatedProfit').textContent=fmt(roundMoney(t.twd-convertedCost));$('profitCalculation').textContent=`台幣 ${fmt(t.twd)} − ${fmt(convertedCost)}`;for(const k of ['twd','jpy'])$(k).textContent=fmt(t[k]);for(const o of state.orders){const v=total(o);for(const k of ['twd','jpy']){const el=document.querySelector(`[data-total="${k}"][data-order="${o.id}"]`);if(el)el.textContent=fmt(v[k]);}}for(const p of state.products){const el=document.querySelector(`[data-product-total="${p.id}"]`);if(el)el.textContent=fmt(state.orders.reduce((s,o)=>s+(o.quantities[p.id]??0),0));}for(const k of ['twd','jpy','shippingTwd']){const el=$('footer-'+k);if(el)el.textContent=fmt(t[k]);}}
function render(){
 sortProducts();
 $('editPurchaseAccounts').hidden=tab!=='purchase';$('autoPurchase').hidden=tab!=='purchase';$('allocateRemaining').hidden=tab!=='purchase';$('purchase').hidden=tab!=='purchase';$('purchaseSummary').hidden=tab!=='purchase';$('shipmentLog').hidden=tab!=='shipmentLog';$('allocation').hidden=tab!=='allocation';$('refunds').hidden=tab!=='refunds';$('actualPurchase').hidden=tab!=='actualPurchase';$('actualPurchaseSummary').hidden=tab!=='actualPurchase';$('exportRefundsImage').hidden=tab!=='refunds';$('generateRefunds').hidden=tab!=='refunds';$('add').hidden=tab==='refunds'||tab==='allocation'||tab==='actualPurchase'||tab==='shipmentLog';$('clearProducts').hidden=tab!=='products';
 $('title').value=state.title;$('orders').hidden=tab!=='orders';$('products').hidden=tab!=='products';$('search').hidden=tab==='products'||tab==='purchase'||tab==='actualPurchase'||tab==='shipmentLog';$('add').textContent=tab==='purchase'?'＋ 手動新增訂單':tab==='orders'?'＋ 新增訂購':'＋ 新增商品';for(const name of ['orders','allocation','purchase','shipmentLog','actualPurchase','refunds','products']){$(name+'Tab').classList.toggle('active',tab===name);$(name+'Tab').setAttribute('aria-pressed',String(tab===name));}
 const filtered=state.orders.filter(o=>fuzzyNickname(o.nickname,$('search').value));
 $('orders').innerHTML='<thead><tr><th class="export-choice"><button type="button" id="toggleAllOrderImages">全選</button></th><th>順序</th><th class="sticky">買家暱稱</th><th>拆團盲盒</th>'+state.products.map(p=>`<th class="product">${esc(productLabel(p))}<span class="price">TWD ${fmt(p.twd)} / JPY ${fmt(p.jpy)}</span></th>`).join('')+'<th class="num shipping-heading">運費<br>TWD</th><th class="num amount-heading" aria-sort="'+(amountSort==='asc'?'ascending':amountSort==='desc'?'descending':'none')+'"><button class="small amount-sort" data-sort-amount aria-label="依台幣合計排序">金額排序 '+(amountSort==='asc'?'↑':amountSort==='desc'?'↓':'↕')+'</button>台幣合計</th><th class="num">日幣合計</th><th class="remitted">已匯款</th><th></th></tr></thead><tbody>'+filtered.map(o=>`<tr class="${o.isRemitted?'remitted-row':''}"><td class="export-choice" data-label="匯出圖片"><input type="checkbox" data-export-order="${esc(o.id)}" ${selectedOrderIds.has(o.id)?'checked':''} aria-label="勾選 ${esc(o.nickname)} 匯出圖片"></td><td data-label="留言順序"><input class="sequence" type="number" min="0" max="9007199254740991" step="1" value="${o.sequence??''}" data-kind="sequence" data-order="${esc(o.id)}" aria-label="${esc(o.nickname)} 留言順序"></td><td class="sticky" data-label="買家暱稱"><input class="nickname" required maxlength="200" value="${esc(o.nickname)}" data-kind="nickname" data-order="${esc(o.id)}" aria-label="買家暱稱"><span class="nickname-error" data-nickname-error="${esc(o.id)}" role="status"></span></td><td class="split-blind-box" data-label="拆團盲盒"><input type="checkbox" data-kind="isSplitBlindBox" data-order="${esc(o.id)}" ${o.isSplitBlindBox?'checked':''} aria-label="${esc(o.nickname)} 拆團盲盒"></td>${state.products.map(p=>`<td data-label="${esc(productLabel(p))}"><input class="qty" type="number" min="0" max="9007199254740991" step="1" required value="${o.quantities[p.id]??0}" data-kind="qty" data-order="${esc(o.id)}" data-product="${esc(p.id)}" aria-label="${esc(o.nickname+' '+productLabel(p))} 數量"></td>`).join('')}<td data-label="運費 TWD"><input class="shipping" type="number" min="0" max="90071992547409.9" step="0.01" required value="${o.shippingTwd??0}" data-kind="shippingTwd" data-order="${esc(o.id)}" aria-label="${esc(o.nickname)} 台幣運費"></td><td class="num sum" data-label="台幣合計 TWD" data-total="twd" data-order="${esc(o.id)}"></td><td class="num sum" data-label="日幣合計 JPY" data-total="jpy" data-order="${esc(o.id)}"></td><td class="remitted" data-label="已匯款"><input type="checkbox" data-kind="isRemitted" data-order="${esc(o.id)}" ${o.isRemitted?'checked':''} aria-label="${esc(o.nickname)} 已匯款"></td><td data-label="買家商品"><div class="buyer-actions"><button class="small danger" data-delete-order="${esc(o.id)}" aria-label="刪除 ${esc(o.nickname)}">刪除</button><button class="small" data-export-received="${esc(o.id)}" aria-label="輸出 ${esc(o.nickname)} 的實際買到商品">輸出實際買到商品</button></div></td></tr>`).join('')+(filtered.length?'':`<tr><td class="empty" colspan="${state.products.length+9}">沒有符合的訂購紀錄。</td></tr>`)+`</tbody><tfoot><tr><td colspan="4" class="sticky">全團合計</td>${state.products.map(p=>`<td class="num" data-label="${esc(productLabel(p))}" data-product-total="${esc(p.id)}"></td>`).join('')}<td class="num" data-label="運費合計 TWD" id="footer-shippingTwd"></td><td class="num" data-label="台幣合計 TWD" id="footer-twd"></td><td class="num" data-label="日幣合計 JPY" id="footer-jpy"></td><td></td><td></td></tr></tfoot>`;
 $('products').innerHTML=productRowsMarkup();renderRefunds();renderShipmentRecords();updateTotals();sortOrderRows();syncOrderImageSelection();for(const el of document.querySelectorAll('#orders .nickname')){const duplicate=state.orders.some(o=>o.id!==el.dataset.order&&nicknameKey(o.nickname)===nicknameKey(el.value));if(duplicate){el.setCustomValidity('買家暱稱不可重複');document.querySelector(`[data-nickname-error="${el.dataset.order}"]`).textContent='暱稱重複，請修改';}}
}
function fuzzyNickname(nickname,query){const normalize=s=>s.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/gu,'');const name=normalize(nickname),search=normalize(query);let index=0;for(const char of search){index=name.indexOf(char,index);if(index<0)return false;index+=char.length;}return true;}
function edited(e){const el=e.target,k=el.dataset.kind;if(!k)return;if(k==='actualQty'){editActualPurchaseQuantity(el);return;}if(k==='actualCostTwd'){editActualPurchaseCost(el);return;}if(['productNumber','isBlindBox','blindBoxType','blindBoxSize','purchaseLimit'].includes(k)){el.setCustomValidity('');return;}el.setCustomValidity('');if(!el.checkValidity()){notify('請完成欄位：名稱不可空白；數量／留言順序為非負整數，單價／運費為非負數。',true);return;}if(['qty','refundQty','sequence'].includes(k)&&el.value!==''&&!Number.isSafeInteger(Number(el.value))){el.setCustomValidity('數量與留言順序必須是有效的非負整數。');notify('輸入數量過大，請調整輸入。',true);return;}if(['twd','jpy','shippingTwd'].includes(k)&&!validMoney(Number(el.value))){el.setCustomValidity('金額須為有效的非負數，最多兩位小數。');notify('金額無效或過大，請調整輸入。',true);return;}const o=state.orders.find(x=>x.id===el.dataset.order),p=state.products.find(x=>x.id===el.dataset.product),previousOrder=o?{...o,quantities:{...o.quantities},refundQuantities:{...o.refundQuantities}}:null,previousProduct=p?{...p}:null;if(k==='isRemitted'){o.isRemitted=el.checked;el.closest('tr').classList.toggle('remitted-row',o.isRemitted);}else if(k==='isRefunded'){o.isRefunded=el.checked;el.closest('tr').classList.toggle('refunded-row',o.isRefunded);}else if(k==='isSplitBlindBox')o.isSplitBlindBox=el.checked;else if(k==='refundQty'){o.refundQuantities??={};o.refundQuantities[p.id]=Number(el.value);}else if(k==='qty'){if(Number(el.value)<(o.refundQuantities?.[p.id]??0)){el.setCustomValidity('訂購數量不可低於已記錄的退費數量。');notify('請先調整退費數量，再減少預購數量。',true);return;}o.quantities[p.id]=Number(el.value);}else if(k==='sequence')o.sequence=el.value===''?null:Number(el.value);else if(k==='nickname'){const duplicate=state.orders.some(other=>other.id!==o.id&&nicknameKey(other.nickname)===nicknameKey(el.value));const error=document.querySelector(`[data-nickname-error="${o.id}"]`);if(duplicate){el.setCustomValidity('買家暱稱不可重複');if(error)error.textContent='暱稱重複，請修改';notify('買家暱稱不可重複：'+el.value,true);return;}if(error)error.textContent='';o.nickname=el.value.trim();}else if(k==='shippingTwd')o.shippingTwd=Number(el.value);else p[k]=['name','productUrl','blindBoxType'].includes(k)?el.value:Number(el.value);try{assertSafeAmounts(state);}catch(error){if(o)Object.assign(o,previousOrder);if(p)Object.assign(p,previousProduct);el.setCustomValidity(error.message);notify(error.message,true);return;}notify('');save();updateTotals();}
document.querySelector('.panel').addEventListener('input',edited);
document.querySelector('.panel').addEventListener('input',updateShipmentField);
document.querySelector('.panel').addEventListener('change',updateShipmentField);
document.querySelector('.panel').addEventListener('input',e=>{const el=e.target;if(el.dataset.kind==='productNumber'&&el.value!==''&&!validProductNumber(el.value))el.setCustomValidity('商品編號必須是 1～999 的整數。');});
document.querySelector('.panel').addEventListener('keydown',e=>{if(e.target.dataset.kind==='productNumber'&&!e.ctrlKey&&!e.metaKey&&/^[eE+.,-]$/.test(e.key))e.preventDefault();});
document.querySelector('.panel').addEventListener('beforeinput',e=>{if(e.target.dataset.kind==='productNumber'&&e.data&&/\D/.test(e.data))e.preventDefault();});
document.querySelector('.panel').addEventListener('paste',e=>{if(e.target.dataset.kind==='productNumber'&&!/^\d+$/.test(e.clipboardData.getData('text')))e.preventDefault();});
const intro=document.querySelector('.intro');
const toolbar=document.querySelector('.panel-head');
const syncFixedHeight=()=>{document.documentElement.style.setProperty('--intro-height',intro.getBoundingClientRect().height+'px');document.documentElement.style.setProperty('--toolbar-height',toolbar.getBoundingClientRect().height+'px');};
const fixedObserver=new ResizeObserver(syncFixedHeight);fixedObserver.observe(intro);fixedObserver.observe(toolbar);syncFixedHeight();
// 僅在影響金額或分組的欄位完成編輯後排序，避免輸入中移動資料列與焦點。
document.querySelector('.panel').addEventListener('change',e=>{if(['qty','shippingTwd','isSplitBlindBox','twd'].includes(e.target.dataset.kind)&&e.target.checkValidity())sortOrderRows();});
document.querySelector('.panel').addEventListener('click',e=>{if(!e.target.closest('[data-sort-amount]'))return;if(!validUI())return;amountSort=amountSort==='desc'?'asc':'desc';render();});
document.querySelector('.panel').addEventListener('focusin',e=>{if(e.target.matches('input[type="number"]'))e.target.select()});
document.querySelector('.panel').addEventListener('focusout',e=>{if(['qty','refundQty','actualQty'].includes(e.target.dataset.kind)&&e.target.value===''&&!e.target.validity.badInput){e.target.value='0';edited(e)}});
document.querySelector('.panel').addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;const oid=btn.dataset.deleteOrder,pid=btn.dataset.deleteProduct;if(oid){if(!confirm('刪除這筆訂購紀錄？'))return;state.orders=state.orders.filter(o=>o.id!==oid);}else if(pid){if(state.orders.some(o=>(o.quantities[pid]??0)>0)){notify('此商品已有訂購數量，請先將對應數量清為 0 再刪除。',true);return;}if(!confirm('刪除此商品？'))return;state.products=state.products.filter(p=>p.id!==pid);for(const po of state.purchaseOrders??[]){delete po.quantities[pid];delete po.actualQuantities?.[pid];}for(const o of state.orders){delete o.quantities[pid];delete o.refundQuantities?.[pid];}}else return;save();render();});
for(const name of ['orders','allocation','purchase','shipmentLog','actualPurchase','refunds','products'])$(name+'Tab').onclick=()=>{if(!validUI())return;tab=name;render()};
function validUI(){if(productImageUploads.size){notify('附圖處理中，請稍候再儲存或匯出。',true);return false;}const inputs=[...document.querySelectorAll('input:not([type=file])')].filter(el=>!el.closest('[hidden]')&&(!el.closest('dialog')||el.closest('dialog').open));const bad=inputs.find(el=>!el.checkValidity()||(['title'].includes(el.id)||['name','nickname'].includes(el.dataset.kind))&&!el.value.trim());if(bad){bad.focus();bad.reportValidity();notify('請先完成有效的名稱、數量與單價。',true);return false}return true}
function id(prefix){return prefix+Date.now().toString(36)+Math.random().toString(36).slice(2,9)}
function payload(){validate(state);const t=allTotals();if([...Object.values(t),t.jpy*(state.exchangeRate??0.21)].some(v=>!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER))throw Error('總金額或數量過大，請調整輸入。');return {...clone(state),exportedAt:new Date().toISOString(),calculation:'TWD = sum(quantity * twdUnitPrice) + shippingTwd; JPY = sum(quantity * jpyUnitPrice)',calculated:{orders:state.orders.map(o=>({orderId:o.id,...total(o)})),totals:t,convertedJpyCostTwd:roundMoney(t.jpy*(state.exchangeRate??0.21)),estimatedNetProfitTwd:roundMoney(t.twd-roundMoney(t.jpy*(state.exchangeRate??0.21))),refunds:state.orders.map(o=>({orderId:o.id,twd:refundAmount(o)})),refundTotalTwd:refundGrandTotal(),actualPurchaseCostTwd:actualCostSummary().recordedCostTwd,actualPurchaseCostSummary:actualCostSummary(),actualNetProfitTwd:actualCostSummary().actualNetProfitTwd,shippingShare:shippingShare(),allocation:buildAllocation(),purchaseReconciliation:purchaseReconciliation(),actualPurchaseReconciliation:actualPurchaseReconciliation()}}}
$('add').onclick=()=>{
 if(!validUI())return;
 if(tab==='purchase'){openPurchaseDialog();return;}
 let addedId;
 if(tab==='orders'){
  if(state.orders.length>=2000)return notify('最多支援 2,000 筆紀錄。',true);
  addedId=id('o');state.orders.push({id:addedId,sequence:Math.max(0,...state.orders.map(o=>o.sequence??0))+1,nickname:uniqueBuyerName(),isSplitBlindBox:false,isRemitted:false,isRefunded:false,shippingTwd:0,refundQuantities:{},quantities:Object.fromEntries(state.products.map(p=>[p.id,0]))});$('search').value='';
 }else{
  if(state.products.length>=200)return notify('最多支援 200 個商品。',true);
  const p={id:id('p'),name:'新商品',twd:0,jpy:0,purchaseLimit:1,productUrl:'',imageData:'',imageName:'',productNumber:nextProductNumber(),isBlindBox:false,blindBoxSize:1,blindBoxType:'box'};
  addedId=p.id;state.products.push(p);
  for(const po of state.purchaseOrders??[]){po.quantities[p.id]=0;if(po.actualQuantities)po.actualQuantities[p.id]=0;}
  for(const o of state.orders){o.quantities[p.id]=0;o.refundQuantities??={};o.refundQuantities[p.id]=0;}
 }
 save();render();const input=document.querySelector(tab==='orders'?`.nickname[data-order="${addedId}"]`:`.name[data-product="${addedId}"]`);input?.focus();input?.select();
};
$('title').required=true;$('title').oninput=()=>{state.title=$('title').value;save()};$('search').oninput=render;
$('clear').onclick=()=>{if(confirm('清空所有訂購紀錄？商品與單價會保留。')){state.orders=[];save();render();notify('已清空訂購紀錄，可以開始新增買家。')}};
$('clearProducts').onclick=()=>{if(confirm('清空所有商品、單價、訂購數量與退費紀錄？買家資料會保留，商品金額將歸零，運費會保留。')){state.products=[];for(const po of state.purchaseOrders??[]){po.quantities={};po.actualQuantities={};}for(const o of state.orders){o.quantities={};o.refundQuantities={};}save();render();notify('已清空商品與訂購數量，買家資料與運費已保留。')}};
$('saveStatus').textContent='空白訂單 · 請開啟訂單或新增資料';
$('setExchangeRate').onclick=()=>{if(!validUI())return;$('exchangeRateInput').value=String(state.exchangeRate??0.21);$('exchangeRateDialog').showModal();$('exchangeRateInput').focus();$('exchangeRateInput').select();};
$('exchangeRateInput').onfocus=e=>e.target.select();
$('cancelExchangeRate').onclick=()=>$('exchangeRateDialog').close();
$('exchangeRateInput').oninput=e=>e.target.setCustomValidity('');
$('exchangeRateForm').onsubmit=e=>{e.preventDefault();const input=$('exchangeRateInput'),rate=Number(input.value);if(!Number.isFinite(rate)||rate<=0)input.setCustomValidity('匯率必須是大於 0 的數字。');else {try{assertSafeAmounts({...state,exchangeRate:rate});}catch(error){input.setCustomValidity(error.message);}}if(!input.reportValidity())return;state.exchangeRate=rate;save();updateTotals();$('exchangeRateDialog').close();notify(`匯率已設為 ${rate}（1 日幣換算的台幣金額）。`);};
$('cancelPurchase').onclick=()=>$('purchaseDialog').close();
$('purchaseQuantities').addEventListener('input',e=>{for(const input of $('purchaseQuantities').querySelectorAll('input'))input.setCustomValidity('');syncPurchaseInputCaps(e.target);});
$('purchaseQuantities').addEventListener('focusin',e=>{if(e.target.matches('input[type=number]'))e.target.select();});
$('purchaseQuantities').addEventListener('focusout',e=>{if(e.target.matches('input[type=number]')&&e.target.value===''&&!e.target.validity.badInput){e.target.value='0';syncPurchaseInputCaps(e.target);}});
$('purchaseForm').onsubmit=e=>{e.preventDefault();const name=$('purchaseName').value.trim();if(!name){$('purchaseName').setCustomValidity('請輸入訂單名稱。');$('purchaseName').reportValidity();return;}if(!$('purchaseForm').reportValidity())return;const quantities=Object.fromEntries([...$('purchaseQuantities').querySelectorAll('input')].map(el=>[el.dataset.purchaseQuantity,Number(el.value)]));if(Object.values(quantities).some(q=>!Number.isSafeInteger(q)||q<0)){notify('搶購數量必須為有效的非負整數。',true);return;}try{assertBlindBoxSettings();}catch(error){notify(error.message,true);return;}if(!Object.values(quantities).some(q=>q>0)){notify('請至少安排一個商品；若不再需要此筆搶購訂單，請刪除。',true);return;}const tooMany=purchaseQuantityViolation(quantities);if(tooMany){const input=$('purchaseQuantities').querySelector(`[data-purchase-quantity="${tooMany.productId}"]`);input.setCustomValidity(tooMany.message+'，請減少數量或拆成多筆訂單。');input.reportValidity();return;}state.purchaseOrders??=[];const existing=state.purchaseOrders.find(o=>o.id===editingPurchaseId),record={id:existing?.id??id('po'),accountId:existing?.accountId??'',purchaser:existing?.purchaser??'',serial:existing&&existing.isOwnCart===$('purchaseOwnCart').checked?existing.serial:nextPurchaseSerial($('purchaseOwnCart').checked),name,isOwnCart:$('purchaseOwnCart').checked,actualCostTwd:existing?.actualCostTwd??null,quantities};try{record.actualQuantities=actualQuantitiesAfterPlanChange(existing,quantities);}catch(error){notify(error.message,true);return;}if(existing)state.purchaseOrders[state.purchaseOrders.indexOf(existing)]=record;else state.purchaseOrders.push(record);save();render();$('purchaseDialog').close();notify('搶購訂單已保存，商品數量核對已更新。');};
$('purchaseName').oninput=e=>e.target.setCustomValidity('');
$('purchaseOwnCart').onchange=()=>{const suggested=($('purchaseOwnCart').checked?'自成一車':'訂單')+nextPurchaseSerial($('purchaseOwnCart').checked);if($('purchaseName').value===lastSuggestedPurchaseName){$('purchaseName').value=suggested;lastSuggestedPurchaseName=suggested;}};
document.querySelector('.panel').addEventListener('click',e=>{
 const btn=e.target.closest('button');if(!btn)return;
 if(btn.dataset.allocateProduct){
  if(!validUI())return;openPurchaseDialog();
  const input=$('purchaseQuantities').querySelector(`[data-purchase-quantity="${btn.dataset.allocateProduct}"]`);input?.focus();input?.select();return;
 }
 if(btn.dataset.editPurchase){if(validUI())openPurchaseDialog(btn.dataset.editPurchase);return;}
 if(!btn.dataset.deletePurchase)return;
 if(!confirm('刪除此筆搶購訂單與對應托運紀錄？其中商品將回到尚未分配，可再手動調整。'))return;
 state.purchaseOrders=state.purchaseOrders.filter(o=>o.id!==btn.dataset.deletePurchase);state.shipmentRecords=(state.shipmentRecords??[]).filter(record=>record.purchaseOrderId!==btn.dataset.deletePurchase);save();render();
 notify('已刪除搶購訂單，其中商品已回到尚未分配。可手動調整或使用「補分配剩餘」。');
});
$('autoPurchase').onclick=()=>runPurchaseAllocation(false);
$('allocateRemaining').onclick=()=>runPurchaseAllocation(true);
function accountEditorRow(account){const row=document.createElement('div');row.className='account-editor-row';row.dataset.accountId=account.id;row.innerHTML=`<input required maxlength="200" aria-label="搶購帳號名稱" value="${esc(account.name)}"><button type="button" class="small danger" data-remove-account>刪除</button>`;$('purchaseAccountList').appendChild(row);return row;}
$('editPurchaseAccounts').onclick=()=>{if(!validUI())return;$('purchaseAccountList').replaceChildren();for(const account of state.purchaseAccounts??[])accountEditorRow(account);$('purchaseAccountsDialog').showModal();};
$('addPurchaseAccount').onclick=()=>{if($('purchaseAccountList').children.length>=200)return;accountEditorRow({id:id('pa'),name:''}).querySelector('input').focus();};
$('purchaseAccountList').addEventListener('click',e=>{if(e.target.closest('[data-remove-account]'))e.target.closest('.account-editor-row').remove();});
$('purchaseAccountList').addEventListener('input',()=>{for(const input of $('purchaseAccountList').querySelectorAll('input'))input.setCustomValidity('');});
$('cancelPurchaseAccounts').onclick=()=>$('purchaseAccountsDialog').close();
$('purchaseAccountsForm').onsubmit=e=>{e.preventDefault();const names=new Set(),accounts=[];for(const row of $('purchaseAccountList').children){const input=row.querySelector('input'),name=input.value.trim(),key=nicknameKey(name);input.setCustomValidity(!name?'請輸入帳號名稱。':names.has(key)?'搶購帳號名稱不可重複。':'');if(!input.reportValidity())return;names.add(key);accounts.push({id:row.dataset.accountId,name});}state.purchaseAccounts=accounts;const ids=new Set(accounts.map(a=>a.id));for(const order of state.purchaseOrders??[])if(!ids.has(order.accountId))order.accountId='';save();renderPurchaseOrders();renderShipmentRecords();$('purchaseAccountsDialog').close();notify('搶購帳號清單已保存。');};
document.querySelector('.panel').addEventListener('input',e=>{const el=e.target,field=el.dataset.purchaseField;if(!['accountId','purchaser'].includes(field))return;const order=(state.purchaseOrders??[]).find(o=>o.id===el.dataset.purchaseId);if(!order)return;if(field==='accountId'&&el.value&&!(state.purchaseAccounts??[]).some(a=>a.id===el.value))return;order[field]=el.value;save();renderShipmentRecords();});
initializeActualPurchaseUI();
render();


'use strict';
// 開啟／儲存共用使用者選定的訂單資料夾；資料夾位置與訂單內容分開保存。
let orderDirectoryHandle=null;
function orderFolderDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open('purchase-order-location',1);request.onupgradeneeded=()=>request.result.createObjectStore('settings');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function readOrderFolder(){let db;try{db=await orderFolderDatabase();orderDirectoryHandle=await new Promise((resolve,reject)=>{const request=db.transaction('settings').objectStore('settings').get('directory');request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});}catch{}finally{db?.close();}}
const orderFolderReady=readOrderFolder();
async function rememberOrderFolder(handle){let db;try{db=await orderFolderDatabase();await new Promise((resolve,reject)=>{const transaction=db.transaction('settings','readwrite');transaction.objectStore('settings').put(handle,'directory');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}catch{notify('已設定訂單資料夾；此瀏覽器無法記住位置，下次需重新選擇。');}finally{db?.close();}}
function orderPickerOptions(){return {id:'purchase-order-files',...(orderDirectoryHandle?{startIn:orderDirectoryHandle}:{}),types:[{description:'訂單檔案（.json）',accept:{'application/json':['.json']}}],excludeAcceptAllOption:false};}
$('setOrderFolder').onclick=async()=>{if(!window.showDirectoryPicker){notify('此瀏覽器不支援預設資料夾設定，請在開啟／儲存視窗手動選擇訂單資料夾。',true);return;}try{const handle=await window.showDirectoryPicker({id:'purchase-order-folder',mode:'read'});await orderFolderReady;orderDirectoryHandle=handle;useLegacyOrderPicker=false;await rememberOrderFolder(handle);notify('預設訂單資料夾已設為「'+handle.name+'」，現在可按「開啟訂單」選擇 .json 檔案。');}catch(error){if(error.name!=='AbortError')notify('設定資料夾失敗：'+error.message,true);}};
let orderPickerBusy=false,useLegacyOrderPicker=false;
async function forgetOrderFolder(){orderDirectoryHandle=null;let db;try{db=await orderFolderDatabase();await new Promise((resolve,reject)=>{const transaction=db.transaction('settings','readwrite');transaction.objectStore('settings').delete('directory');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}catch{}finally{db?.close();}}
// 檔案視窗必須在點擊當下同步開啟：失敗後不可重試（點擊授權已被消耗），改為清除失效的預設資料夾並交由呼叫端改用備援方式。
function pickOrderFile(save=false){const options=orderPickerOptions();const picker=save?window.showSaveFilePicker({...options,suggestedName:orderFilename()}):window.showOpenFilePicker({...options,multiple:false});return picker.catch(error=>{if(error.name!=='AbortError'){if(options.startIn)forgetOrderFolder();useLegacyOrderPicker=true;}throw error;});}

async function openOrderFile(file){if(file.size>100*1024*1024)throw Error('含附圖的訂單檔案超過 100 MB。');let parsed;try{parsed=JSON.parse((await file.text()).replace(/^\uFEFF/,''));}catch{throw Error('無法讀取訂單檔案，請選擇由此頁面儲存的訂單檔案。');}const data=validate(parsed);if(!confirm('開啟訂單將取代目前紀錄。請先儲存需要保留的資料。繼續開啟？'))return;state=data;selectedOrderIds.clear();$('search').value='';render();$('saveStatus').textContent='已開啟訂單檔案';notify('已開啟訂單，所有合計已依單價與數量重新計算。');}
const orderDropOverlay=$('orderDropOverlay');let orderDragDepth=0;
function hasOrderFileTransfer(event){return Array.from(event.dataTransfer?.types??[]).includes('Files');}
document.addEventListener('dragenter',event=>{if(!hasOrderFileTransfer(event))return;event.preventDefault();orderDragDepth++;orderDropOverlay.hidden=false;});
document.addEventListener('dragover',event=>{if(!hasOrderFileTransfer(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';});
document.addEventListener('dragleave',event=>{if(!hasOrderFileTransfer(event))return;orderDragDepth=Math.max(0,orderDragDepth-1);if(!orderDragDepth)orderDropOverlay.hidden=true;});
document.addEventListener('drop',async event=>{if(!hasOrderFileTransfer(event))return;event.preventDefault();orderDragDepth=0;orderDropOverlay.hidden=true;const files=Array.from(event.dataTransfer.files??[]);if(files.length!==1){notify('請一次拖曳一個 .json 訂單檔案。',true);return;}const file=files[0];if(!file.name.toLowerCase().endsWith('.json')){notify('請拖曳 .json 訂單檔案。',true);return;}try{await openOrderFile(file);}catch(error){notify('開啟失敗：'+error.message,true);}});
function orderFilename(){return (state.title.replace(/[\\/:*?"<>|]/g,'_')||'代購紀錄')+'.json';}
function fileSaveFallback(contents){const blob=new Blob([contents],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=orderFilename();link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('import').onclick=async()=>{if(orderPickerBusy)return;if(!window.showOpenFilePicker||useLegacyOrderPicker){$('file').click();return;}orderPickerBusy=true;let fileSelected=false,stage='選擇訂單檔案';try{const [handle]=await pickOrderFile();fileSelected=true;stage='讀取所選訂單';await openOrderFile(await handle.getFile());}catch(error){if(error.name==='AbortError'&&!fileSelected)notify('已取消開啟訂單，原資料未變更。');else if(!fileSelected)notify('系統檔案視窗無法開啟（'+error.name+'），已切換為相容模式：請再按一次「開啟訂單」，或直接把 .json 拖曳到頁面。',true);else notify('開啟失敗（'+stage+'）：'+error.name+(error.message?': '+error.message:''),true);}finally{orderPickerBusy=false;}};
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;try{await openOrderFile(file);}catch(error){notify('開啟失敗：'+error.message,true);}finally{$('file').value='';}};
$('export').onclick=async()=>{if(orderPickerBusy||!validUI())return;orderPickerBusy=true;let fileSelected=false,stage='準備訂單資料';try{if(window.showSaveFilePicker&&!useLegacyOrderPicker){stage='選擇儲存位置';let handle;try{handle=await pickOrderFile(true);}catch(error){if(error.name==='AbortError')throw error;handle=null;}if(handle){fileSelected=true;stage='準備訂單資料';const contents=JSON.stringify(payload(),null,2);stage='建立檔案寫入器';const writer=await handle.createWritable();try{stage='寫入訂單資料';await writer.write(contents);stage='完成檔案寫入';await writer.close();}catch(error){try{await writer.abort();}catch{}throw error;}}else {stage='下載訂單檔案';fileSaveFallback(JSON.stringify(payload(),null,2));$('saveStatus').textContent='已儲存訂單檔案';notify('系統儲存視窗無法開啟，已改為直接下載訂單檔案（請到瀏覽器的下載資料夾查看）。');return;}}else {stage='下載訂單檔案';fileSaveFallback(JSON.stringify(payload(),null,2));}$('saveStatus').textContent='已儲存訂單檔案';notify('訂單已儲存，可使用「開啟訂單」繼續編輯。');}catch(error){if(error.name==='AbortError'&&!fileSelected)notify('未完成存檔（'+stage+'），訂單仍未儲存。');else notify('儲存失敗（'+stage+'）：'+error.name+(error.message?': '+error.message:''),true);}finally{orderPickerBusy=false;}};

'use strict';
const allocationImageButton=document.createElement('button');
allocationImageButton.id='exportAllocationImage';allocationImageButton.textContent='匯出圖片';
document.querySelector('.tools').appendChild(allocationImageButton);
function syncAllocationImageButton(){allocationImageButton.hidden=$('allocation').hidden;}
new MutationObserver(syncAllocationImageButton).observe($('allocation'),{attributes:true,attributeFilter:['hidden']});syncAllocationImageButton();
// 將完整分配表繪製成 PNG，手機也維持表格版型，無須載入外部套件。
function allocationImageCanvas(){
 const table=$('allocation'),columns=table.tHead?.rows[0]?.cells.length??0;
 if(!table.querySelector('[data-priority-product]'))throw Error('目前沒有可匯出的分配資料。');
 const widths=Array.from({length:columns},(_,i)=>i===0?190:180),width=widths.reduce((a,b)=>a+b,0);
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 if(!ctx)throw Error('此瀏覽器無法建立圖片。');
 const family='"Segoe UI","Microsoft JhengHei",sans-serif';
 const wrap=(value,font,maxWidth)=>{ctx.font=font;const lines=[];let line='';for(const character of Array.from(value)){if(character==='\n'){lines.push(line);line='';continue;}if(line&&ctx.measureText(line+character).width>maxWidth){lines.push(line);line='';}line+=character;}if(line||!lines.length)lines.push(line);return lines;};
 const rows=[...table.rows].map((row,index)=>{let column=0;const cells=[...row.cells].map(cell=>{
  const span=cell.colSpan||1,cellWidth=widths.slice(column,column+span).reduce((a,b)=>a+b,0),cellColumn=column;column+=span;
  const header=index===0,elements=cell.children.length?[...cell.children].filter(element=>element.tagName!=='BUTTON'):[cell];
  const blocks=elements.map(element=>{const detail=element.classList.contains('priority-detail'),strong=element.tagName==='STRONG';const size=header?12:detail?11:14,weight=strong?700:header?500:400,font=weight+' '+size+'px '+family;return {font,color:header||detail?'#75847d':'#203d38',lineHeight:detail?18:22,margin:detail?4:0,lines:wrap(element.textContent,font,cellWidth-24)};});
  return {column:cellColumn,width:cellWidth,blocks,header,height:blocks.reduce((sum,b)=>sum+b.margin+b.lines.length*b.lineHeight,0)+28};
 });return {cells,height:Math.max(48,...cells.map(c=>c.height))};});
 const height=rows.reduce((sum,row)=>sum+row.height,0);
 if(width>16384||height>16384)throw Error('表格太大，請先搜尋部分買家後再匯出圖片。');
 const scale=Math.min(2,16384/width,16384/height,Math.sqrt(24000000/(width*height)));
 canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);ctx.scale(scale,scale);ctx.fillStyle='#fffef9';ctx.fillRect(0,0,width,height);
 let y=0;
 for(const row of rows){let x=0;for(const cell of row.cells){ctx.fillStyle=cell.header?'#f5f7ef':'#fffef9';ctx.fillRect(x,y,cell.width,row.height);ctx.strokeStyle='#dfe5dc';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,cell.width-1,row.height-1);let lineY=y+14;ctx.textBaseline='top';ctx.textAlign=cell.column===0&&!cell.header?'left':'center';for(const block of cell.blocks){lineY+=block.margin;ctx.font=block.font;ctx.fillStyle=block.color;for(const line of block.lines){ctx.fillText(line,ctx.textAlign==='left'?x+12:x+cell.width/2,lineY);lineY+=block.lineHeight;}}x+=cell.width;}y+=row.height;}
 return canvas;
}
allocationImageButton.onclick=async()=>{allocationImageButton.disabled=true;try{await document.fonts.ready;const canvas=allocationImageCanvas();const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('無法產生圖片。')),'image/png'));const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(state.title.replace(/[\\/:*?"<>|]/g,'_')||'代購訂單')+'_分配表格.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('分配表格圖片已匯出（包含目前篩選結果的全部欄位與列）。');}catch(error){notify('圖片匯出失敗：'+error.message,true);}finally{allocationImageButton.disabled=false;}};

function syncOrderImageSelection(){
 const ids=new Set(state.orders.map(o=>o.id));for(const id of selectedOrderIds)if(!ids.has(id))selectedOrderIds.delete(id);
 for(const id of ['exportOrdersImage','exportCollectionImage']){$(id).hidden=tab!=='orders';$(id).disabled=selectedOrderIds.size===0;}
 const visible=state.orders.filter(o=>fuzzyNickname(o.nickname,$('search').value)),button=$('toggleAllOrderImages');
 if(button){button.textContent=visible.length&&visible.every(o=>selectedOrderIds.has(o.id))?'取消全選':'全選';button.disabled=!visible.length;}
}
document.querySelector('.panel').addEventListener('change',e=>{const orderId=e.target.dataset.exportOrder;if(!orderId)return;if(e.target.checked)selectedOrderIds.add(orderId);else selectedOrderIds.delete(orderId);syncOrderImageSelection();});
document.querySelector('.panel').addEventListener('click',e=>{if(!e.target.closest('#toggleAllOrderImages'))return;const visible=state.orders.filter(o=>fuzzyNickname(o.nickname,$('search').value));const all=visible.every(o=>selectedOrderIds.has(o.id));for(const order of visible){if(all)selectedOrderIds.delete(order.id);else selectedOrderIds.add(order.id);}for(const checkbox of $('orders').querySelectorAll('[data-export-order]'))checkbox.checked=selectedOrderIds.has(checkbox.dataset.exportOrder);syncOrderImageSelection();});
function selectedOrderImageData(){
 const originalIndex=new Map(state.orders.map((o,i)=>[o.id,i]));
 const orders=state.orders.filter(o=>selectedOrderIds.has(o.id));
 if(amountSort)orders.sort((a,b)=>Number(Boolean(a.isSplitBlindBox))-Number(Boolean(b.isSplitBlindBox))+(0)|| (a.isSplitBlindBox&&b.isSplitBlindBox?0:Number((b.shippingTwd??0)>0)-Number((a.shippingTwd??0)>0))||(amountSort==='asc'?total(a).twd-total(b).twd:total(b).twd-total(a).twd)||originalIndex.get(a.id)-originalIndex.get(b.id));
 const headers=['順序','買家暱稱','拆團盲盒',...state.products.map(p=>productLabel(p)+'\nTWD '+fmt(p.twd)+' / JPY '+fmt(p.jpy)),'運費 TWD','台幣合計','日幣合計','已匯款'];
 const rows=orders.map(o=>({paid:o.isRemitted,cells:[o.sequence??'—',o.nickname,o.isSplitBlindBox?'✓':'—',...state.products.map(p=>fmt(o.quantities[p.id]??0)),fmt(o.shippingTwd??0),fmt(total(o).twd),fmt(total(o).jpy),o.isRemitted?'✓':'—'].map(String)}));
 const sum=orders.reduce((s,o)=>{const t=total(o);s.shipping+=o.shippingTwd??0;s.twd+=t.twd;s.jpy+=t.jpy;return s;},{shipping:0,twd:0,jpy:0});
 const footer=['勾選合計',String(orders.length)+' 筆','',...state.products.map(p=>fmt(orders.reduce((s,o)=>s+(o.quantities[p.id]??0),0))),fmt(sum.shipping),fmt(sum.twd),fmt(sum.jpy),''];
 return {headers,rows,footer};
}
function collectionImageData(){const data=selectedOrderImageData();return {headers:['買家暱稱','台幣總額 TWD'],rows:data.rows.map(row=>({paid:row.paid,cells:[row.cells[1],row.cells[row.cells.length-3]]}))};}
function ordersImageCanvas(collectionOnly=false){
 const data=collectionOnly?collectionImageData():selectedOrderImageData();if(!data.rows.length)throw Error('請至少勾選一筆訂購紀錄。');
 const widths=collectionOnly?[260,180]:[90,160,80,...state.products.map(()=>120),100,120,120,80],width=widths.reduce((a,b)=>a+b,0);
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('無法建立圖片。');
 const font='14px "Segoe UI","Microsoft JhengHei",sans-serif';ctx.font=font;
 const wrap=value=>{const result=[];let line='';return {value,wrap:max=>{for(const char of Array.from(value)){if(char==='\n'){result.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>max){result.push(line);line='';}line+=char;}result.push(line);return result;}};};
 const rows=[{header:true,cells:data.headers},...data.rows,...(data.footer?[{footer:true,cells:data.footer}]:[])].map(row=>({...row,lines:row.cells.map((cell,i)=>wrap(cell).wrap(widths[i]-20))}));
 for(const row of rows)row.height=Math.max(48,...row.lines.map(lines=>lines.length*22+24));
 const height=rows.reduce((sum,row)=>sum+row.height,0);if(width>16384||height>16384)throw Error('圖片太大，請減少勾選筆數後重試。');
 const scale=Math.min(2,16384/width,16384/height,Math.sqrt(24000000/(width*height)));canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);ctx.scale(scale,scale);ctx.fillStyle='#fffef9';ctx.fillRect(0,0,width,height);
 let y=0;for(const row of rows){let x=0;row.lines.forEach((lines,i)=>{ctx.fillStyle=row.header?'#f5f7ef':row.footer?'#eef3e8':row.paid?'#f6f69d':'#fffef9';ctx.fillRect(x,y,widths[i],row.height);ctx.strokeStyle='#dfe5dc';ctx.strokeRect(x+.5,y+.5,widths[i]-1,row.height-1);ctx.font=(row.header||row.footer?'bold ':'')+font;ctx.fillStyle='#203d38';ctx.textBaseline='top';ctx.textAlign=i===(collectionOnly?0:1)?'left':'center';lines.forEach((line,j)=>ctx.fillText(line,ctx.textAlign==='left'?x+10:x+widths[i]/2,y+12+j*22));x+=widths[i];});y+=row.height;}return canvas;
}
$('exportOrdersImage').onclick=async()=>{if(!selectedOrderIds.size||!validUI())return;const button=$('exportOrdersImage');button.disabled=true;try{await document.fonts.ready;const canvas=ordersImageCanvas(),blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('無法產生圖片。')),'image/png'));const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(state.title.replace(/[\\/:*?"<>|]/g,'_')||'代購訂單')+'_訂購明細.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已將 '+selectedOrderIds.size+' 筆勾選訂購明細匯出成圖片。');}catch(error){notify('圖片匯出失敗：'+error.message,true);}finally{syncOrderImageSelection();}};

$('exportCollectionImage').onclick=async()=>{if(!selectedOrderIds.size||!validUI())return;const button=$('exportCollectionImage');button.disabled=true;try{await document.fonts.ready;const canvas=ordersImageCanvas(true),blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('無法產生圖片。')),'image/png'));const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(state.title.replace(/[\\/:*?"<>|]/g,'_')||'代購訂單')+'_收款明細.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已將 '+selectedOrderIds.size+' 筆勾選買家的暱稱與台幣總額匯出成收款明細圖片。');}catch(error){notify('圖片匯出失敗：'+error.message,true);}finally{syncOrderImageSelection();}};

function loadProductImage(source){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('無法讀取商品附圖，請重新上傳 PNG、JPG、WebP 或 GIF 圖片。'));image.src=source;});}
function readProductImageFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('無法讀取附圖檔案。'));reader.readAsDataURL(file);});}
const productImageUploads=new Map();
document.querySelector('.panel').addEventListener('change',async e=>{
 const input=e.target,pid=input.dataset.uploadProduct;if(!pid)return;const file=input.files[0],product=state.products.find(p=>p.id===pid);if(!file||!product)return;
 const token={};productImageUploads.set(pid,token);const status=document.querySelector('[data-product-image-status="'+pid+'"]');status.textContent='處理附圖中…';
 try{
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('請選擇 PNG、JPG、WebP 或 GIF 圖片。');
  if(file.size>5*1024*1024)throw Error('單張附圖最多 5 MB。');
  const source=await readProductImageFile(file),image=await loadProductImage(source),scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL(file.type==='image/jpeg'?'image/jpeg':'image/png',.9);
  if(productImageUploads.get(pid)!==token||!state.products.includes(product))return;
  if(data.length+state.products.reduce((sum,p)=>sum+(p===product?0:(p.imageData??'').length),0)>90*1024*1024)throw Error('附圖資料過大，請縮小圖片後上傳。');
  product.imageData=data;product.imageName=file.name.slice(0,500);status.textContent='已附圖：'+product.imageName;
  document.querySelector('[data-remove-product-image="'+pid+'"]').hidden=false;save();notify('商品附圖已加入，儲存訂單時會一起存入檔案。');
 }catch(error){status.textContent=product.imageData?'已附圖：'+product.imageName:'尚未上傳';notify(error.message,true);}finally{if(productImageUploads.get(pid)===token)productImageUploads.delete(pid);input.value='';}
});
document.querySelector('.panel').addEventListener('click',e=>{const button=e.target.closest('[data-remove-product-image]');if(!button)return;const pid=button.dataset.removeProductImage,product=state.products.find(p=>p.id===pid);if(!product)return;productImageUploads.delete(pid);product.imageData='';product.imageName='';document.querySelector('[data-product-image-status="'+pid+'"]').textContent='尚未上傳';button.hidden=true;save();});
function purchaseExportData(orderId){
 const order=(state.purchaseOrders??[]).find(o=>o.id===orderId);if(!order)throw Error('找不到搶購訂單。');
 const account=(state.purchaseAccounts??[]).find(a=>a.id===order.accountId)?.name??'';
 const products=state.products.filter(p=>(order.quantities[p.id]??0)>0).map(p=>({...p,name:productLabel(p),quantity:order.quantities[p.id]}));
 if(!products.length)throw Error('這筆搶購訂單沒有數量大於 0 的商品。');
 return {order,account,products};
}
function purchaseExportText(orderId){const data=purchaseExportData(orderId),separator='----------------------------';return ['購買帳號: '+data.account,separator,...data.products.flatMap(p=>['商品名稱: '+p.name,'數量: '+p.quantity+' '+productUnit(p),'連結: '+(p.productUrl??''),separator])].join('\n');}
async function copyPurchaseList(text){
 try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}}catch{}
 const focused=document.activeElement,position={x:scrollX,y:scrollY},textarea=document.createElement('textarea');textarea.value=text;textarea.style.cssText='position:fixed;top:0;left:-9999px';document.body.appendChild(textarea);textarea.select();
 let copied=false;try{copied=document.execCommand('copy');}finally{textarea.remove();focused?.focus({preventScroll:true});window.scrollTo(position.x,position.y);}if(!copied)throw Error('瀏覽器無法複製清單，請允許剪貼簿權限後再試。');
}
async function purchaseExportCanvas(orderId){
 const data=purchaseExportData(orderId);await document.fonts.ready;
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),padding=24,gap=20,cardWidth=440,cardPadding=20,columns=3,width=padding*2+columns*cardWidth+(columns-1)*gap,font='18px "Segoe UI","Microsoft JhengHei",sans-serif';ctx.font=font;
 const wrap=(text,maxWidth)=>{const lines=[];let line='';for(const char of Array.from(text)){if(char==='\n'){lines.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line);line='';}line+=char;}lines.push(line);return lines;};
 const header=wrap('購買帳號: '+data.account,width-padding*2),sections=[];
 for(const product of data.products){const image=product.imageData?await loadProductImage(product.imageData):null,scale=image?Math.min(400/image.naturalWidth,400/image.naturalHeight):0,imageWidth=image?Math.max(1,Math.round(image.naturalWidth*scale)):0,imageHeight=image?Math.max(1,Math.round(image.naturalHeight*scale)):0,nameLines=wrap('商品名稱: '+product.name,cardWidth-cardPadding*2),quantityLines=wrap('數量: '+product.quantity+' '+productUnit(product),cardWidth-cardPadding*2);sections.push({image,imageWidth,imageHeight,nameLines,quantityLines,height:cardPadding*2+(nameLines.length+quantityLines.length)*28+(image?imageHeight+16:0)});}
 const rows=[];for(let i=0;i<sections.length;i+=columns){const cards=sections.slice(i,i+columns);rows.push({cards,height:Math.max(...cards.map(card=>card.height))});}
 const headerHeight=header.length*28+24,height=padding*2+headerHeight+rows.reduce((sum,row)=>sum+row.height,0)+(rows.length-1)*gap;
 if(height>16384||width*height>24000000)throw Error('圖片太大，請拆成較小的搶購訂單後再匯出。');
 canvas.width=width;canvas.height=height;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.font=font;ctx.textBaseline='top';ctx.fillStyle='#203d38';header.forEach((line,i)=>ctx.fillText(line,padding,padding+i*28));let y=padding+headerHeight;
 for(const row of rows){for(let i=0;i<row.cards.length;i++){const card=row.cards[i],x=padding+i*(cardWidth+gap);ctx.strokeStyle='#dfe5dc';ctx.strokeRect(x+.5,y+.5,cardWidth-1,row.height-1);let textY=y+cardPadding;ctx.fillStyle='#203d38';ctx.font=font;for(const line of card.nameLines){ctx.fillText(line,x+cardPadding,textY);textY+=28;}ctx.fillStyle='#c62828';ctx.font='bold '+font;for(const line of card.quantityLines){ctx.fillText(line,x+cardPadding,textY);textY+=28;}if(card.image){textY+=16;ctx.drawImage(card.image,x+(cardWidth-card.imageWidth)/2,textY,card.imageWidth,card.imageHeight);}}y+=row.height+gap;}
 return canvas;
}
document.querySelector('.panel').addEventListener('click',async e=>{
 const button=e.target.closest('[data-export-purchase-image],[data-export-purchase-list]');if(!button)return;if(!validUI())return;
 button.disabled=true;try{
  if(button.dataset.exportPurchaseList){await copyPurchaseList(purchaseExportText(button.dataset.exportPurchaseList));notify('搶購清單已複製，可直接按 Ctrl+V 貼上。');}
  else {const orderId=button.dataset.exportPurchaseImage,data=purchaseExportData(orderId),canvas=await purchaseExportCanvas(orderId),blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('無法產生圖片。')),'image/png'));const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(state.title+'_'+data.order.name).replace(/[\\/:*?"<>|]/g,'_')+'_搶購商品.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('搶購商品圖片已匯出。');}
 }catch(error){notify('匯出失敗：'+error.message,true);}finally{button.disabled=false;}
});

function blindBoxKey(product){return OrderLogic.blindBoxKey(product);}
function blindBoxSource(product,products=state.products){return OrderLogic.blindBoxSource(product,products);}
function blindBoxGroups(products=state.products){return OrderLogic.blindBoxGroups(products);}

function productUnitWeight(p){return OrderLogic.productUnitWeight(p);}
function groupUnitCap(group){return OrderLogic.groupUnitCap(group);}
function assertBlindBoxSettings(products=state.products){return OrderLogic.assertBlindBoxSettings(products);}

function purchaseLimitViolations(quantities){return OrderLogic.purchaseLimitViolations(state,quantities);}
function purchaseCapacities(existing={}){return OrderLogic.purchaseCapacities(state,existing);}
function fillLimitedCart(pool,existing={}){return OrderLogic.fillLimitedCart(state,pool,existing);}
function purchaseLimitLabel(p){const source=blindBoxSource(p),cap=(source.blindBoxSize??1)*(source.purchaseLimit??1);return p.isBlindBox?'#'+productNumber(p.productNumber)+' · 每盒 '+fmt(source.blindBoxSize??1)+' 抽 · 每筆整盒最多 '+fmt(source.purchaseLimit??1)+' 盒／全買單抽最多 '+fmt(cap)+' 抽 · 同款共用 '+fmt(cap)+' 抽':'單筆限購 '+fmt(p.purchaseLimit??1)+' 件';}

// 每個盲盒商品編號各自計算整盒／單抽容量，再找最低達免運金額。
function minimumGroupedShippingBundle(pool,existing,targetJpy){return OrderLogic.minimumGroupedShippingBundle(state,pool,existing,targetJpy);}

document.querySelector('.panel').addEventListener('change',e=>{
 const el=e.target,kind=el.dataset.kind;
 if(!['productNumber','isBlindBox','blindBoxType','blindBoxSize','purchaseLimit'].includes(kind))return;
 el.setCustomValidity('');
 if(kind==='productNumber'&&!validProductNumber(el.value))el.setCustomValidity('商品編號必須是 1～999 的整數。');
 if(!el.checkValidity()){notify('商品編號必須是 1～999 的整數；每盒抽數與限購數量必須是正整數。',true);return;}
 const p=state.products.find(p=>p.id===el.dataset.product);if(!p)return;
 const previous=clone(state.products);
 if(kind==='isBlindBox')p.isBlindBox=el.checked;
 else if(kind==='productNumber')p.productNumber=productNumber(el.value);
 else p[kind]=kind==='blindBoxType'?el.value:Number(el.value);
 const peers=state.products.filter(other=>other!==p&&other.isBlindBox&&blindBoxKey(other)===blindBoxKey(p));
 if(p.isBlindBox){
  if(['productNumber','isBlindBox'].includes(kind)&&peers.length){p.blindBoxSize=peers[0].blindBoxSize;p.purchaseLimit=peers[0].purchaseLimit;}
  for(const other of peers){other.blindBoxSize=p.blindBoxSize;other.purchaseLimit=p.purchaseLimit;}
 }
 try{if(!validProductNumber(p.productNumber))throw Error('商品編號必須是 1～999 的整數。');assertBlindBoxSettings();}
 catch(error){state.products=previous;el.setCustomValidity(error.message);notify(error.message,true);return;}
 save();render();notify(p.isBlindBox?'盲盒 #'+p.productNumber+' 的整盒與單抽共用設定已更新。':'商品設定已更新。');
});

function syncPurchaseInputCaps(changedInput=null){
 const inputs=new Map([...$('purchaseQuantities').querySelectorAll('[data-purchase-quantity]')].map(input=>[input.dataset.purchaseQuantity,input]));
 const assignable=purchaseAssignable();
 const quantity=p=>{const value=Number(inputs.get(p.id)?.value??0);return Number.isFinite(value)?Math.max(0,Math.floor(value)):0;};
 const maximum=p=>{const group=blindBoxGroups().find(group=>group.products.some(product=>product.id===p.id));const otherUnits=group.products.reduce((sum,other)=>sum+(other.id===p.id?0:quantity(other)*productUnitWeight(other)),0);return Math.min(assignable[p.id],Math.max(0,Math.floor((groupUnitCap(group)-otherUnits)/productUnitWeight(p))));};
 const changed=state.products.find(p=>p.id===changedInput?.dataset.purchaseQuantity);
 if(changed&&changedInput.value!==''&&!changedInput.validity.badInput){const max=maximum(changed),value=Number(changedInput.value),limited=Number.isFinite(value)?Math.min(max,Math.max(0,Math.floor(value))):0;if(value!==limited){changedInput.value=String(limited);notify(productLabel(changed)+' 目前最多可填 '+fmt(max)+' '+productUnit(changed)+'，已調整輸入數量。');}}
 for(const p of state.products){const input=inputs.get(p.id);if(!input)continue;const max=maximum(p);input.max=String(max);input.dataset.currentLimit=String(max);let hint=input.parentElement.querySelector('.purchase-current-limit');if(!hint){hint=document.createElement('span');hint.className='priority-detail purchase-current-limit';input.parentElement.appendChild(hint);}hint.textContent='目前可填：0～'+fmt(max)+' '+productUnit(p)+' · 此筆可安排總量 '+fmt(assignable[p.id])+' '+productUnit(p);}
}

function productRowsMarkup(){
 const header='<thead><tr><th aria-sort="ascending">商品編號 ↑</th><th>商品名稱</th><th class="num">台幣單價 TWD</th><th class="num">日幣成本 JPY</th><th class="num">單筆限購數量／盲盒盒數</th><th>盲盒設定</th><th>商品附圖</th><th>商品連結</th><th></th></tr></thead>';
 return header+'<tbody>'+state.products.map(p=>`<tr>
  <td data-label="商品編號"><label class="product-number-field"><span aria-hidden="true">#</span><input class="product-number" type="number" inputmode="numeric" required min="1" max="999" step="1" value="${esc(p.productNumber)}" data-kind="productNumber" data-product="${esc(p.id)}" aria-label="${esc(p.name)} 商品編號"></label><span class="priority-detail">1～999，依編號由小到大排序<br>同款整盒與單抽填相同編號</span></td>
  <td data-label="商品名稱"><input class="name" required maxlength="500" value="${esc(p.name)}" data-kind="name" data-product="${esc(p.id)}" aria-label="商品名稱"></td>
  <td class="num" data-label="台幣單價 TWD"><input class="price-input" required type="number" min="0" max="90071992547409.9" step="0.01" value="${p.twd}" data-kind="twd" data-product="${esc(p.id)}" aria-label="${esc(productLabel(p))} 台幣單價"></td>
  <td class="num" data-label="日幣成本 JPY"><input class="price-input" required type="number" min="0" max="90071992547409.9" step="0.01" value="${p.jpy}" data-kind="jpy" data-product="${esc(p.id)}" aria-label="${esc(productLabel(p))} 日幣成本"></td>
  <td class="num" data-label="${p.isBlindBox?'單筆限購盒數':'單筆限購數量'}"><input class="limit-input" required type="number" min="1" max="9007199254740991" step="1" value="${p.purchaseLimit??1}" data-kind="purchaseLimit" data-product="${esc(p.id)}" aria-label="${esc(productLabel(p))} 限購數量"><span class="priority-detail">${p.isBlindBox?'同編號整盒／單抽同步 · 盒':'件'}</span></td>
  <td data-label="盲盒設定" class="blind-box-settings"><label><input type="checkbox" data-kind="isBlindBox" data-product="${esc(p.id)}" ${p.isBlindBox?'checked':''}> 盲盒</label><div class="blind-box-options" ${p.isBlindBox?'':'hidden'}><label>販售單位<select data-kind="blindBoxType" data-product="${esc(p.id)}" ${p.isBlindBox?'':'disabled'}><option value="box" ${p.blindBoxType!=='single'?'selected':''}>整盒</option><option value="single" ${p.blindBoxType==='single'?'selected':''}>單抽</option></select></label><label ${p.blindBoxType==='single'?'hidden':''}>每盒抽數<input type="number" required min="1" max="9007199254740991" step="1" value="${p.blindBoxSize??1}" data-kind="blindBoxSize" data-product="${esc(p.id)}" ${p.isBlindBox&&p.blindBoxType!=='single'?'':'disabled'}></label><span class="priority-detail">${p.isBlindBox?esc(purchaseLimitLabel(p)):''}</span></div></td>
  <td data-label="商品附圖"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload-product="${esc(p.id)}" aria-label="${esc(productLabel(p))} 上傳附圖"><span class="priority-detail" data-product-image-status="${esc(p.id)}">${p.imageData?'已附圖：'+esc(p.imageName||'商品圖片'):'尚未上傳'}</span><button type="button" class="small" data-remove-product-image="${esc(p.id)}" ${p.imageData?'':'hidden'}>移除附圖</button></td>
  <td data-label="商品連結"><input class="product-url" maxlength="2048" value="${esc(p.productUrl??'')}" data-kind="productUrl" data-product="${esc(p.id)}" aria-label="${esc(productLabel(p))} 商品連結"></td>
  <td><button class="small danger" data-delete-product="${esc(p.id)}" aria-label="刪除 ${esc(productLabel(p))}">刪除</button></td>
 </tr>`).join('')+(state.products.length?'':'<tr><td class="empty" colspan="9">尚無商品，請點選「新增商品」。</td></tr>')+'</tbody>';
}

function purchaseQuantityViolation(quantities){
 const limit=purchaseLimitViolations(quantities)[0];if(limit)return limit;
 const assignable=purchaseAssignable(),p=state.products.find(p=>(quantities[p.id]??0)>assignable[p.id]);
 return p?{productId:p.id,message:productLabel(p)+' 此筆最多可安排 '+fmt(assignable[p.id])+' '+productUnit(p)+'，不可超過買家預購總量'}:null;
}

function renderPurchaseSummary(orders,checks,violations,reconciliationOpen){
 const pending=checks.filter(x=>x.remaining),over=checks.filter(x=>x.overAllocated);
 const status=pending.length||over.length?[...pending.map(x=>esc(x.name)+' 尚未分配 '+fmt(x.remaining)+' '+x.unit),...over.map(x=>esc(x.name)+' 多配 '+fmt(x.overAllocated)+' '+x.unit)].join('；'):'所有商品搶購數量與訂購明細一致';
 $('purchaseSummary').innerHTML='<p class="purchase-status '+(pending.length||over.length?'mismatch':'')+'">'+status+'</p>'+(violations.length?'<p class="mismatch">'+violations.map(esc).join('；')+'</p>':'')+'<details class="purchase-reconciliation"'+(reconciliationOpen?' open':'')+'><summary>搶購數量核對／尚未分配</summary><p class="purchase-rule">每筆訂單依各商品編號限購。補分配剩餘會保留現有安排並新增訂單；全部重新分配會取代現有安排。整盒與單抽分開核對預購數量。</p><table class="purchase-check"><thead><tr><th>商品</th><th>預購總量</th><th>已分配</th><th>尚未分配</th><th>操作</th></tr></thead><tbody>'+checks.map(x=>`<tr data-purchase-check="${esc(x.productId)}"><td>${esc(x.name)}</td><td>${fmt(x.requested)} ${x.unit}</td><td>${fmt(x.planned)} ${x.unit}</td><td data-remaining-product="${esc(x.productId)}" class="${x.difference?'mismatch':''}">${x.overAllocated?'多配 '+fmt(x.overAllocated):fmt(x.remaining)} ${x.unit}</td><td>${x.remaining?`<button class="small" data-allocate-product="${esc(x.productId)}">手動分配</button>`:'—'}</td></tr>`).join('')+'</tbody></table></details>';
 $('allocateRemaining').disabled=purchaseAllocationBusy||!pending.length||!!over.length||!!violations.length;
 $('autoPurchase').disabled=purchaseAllocationBusy;
 $('autoPurchase').textContent=purchaseAllocationBusy?'計算中…':orders.length?'全部重新分配':'自動建立搶購訂單';
}

async function runPurchaseAllocation(onlyRemaining){
 if(purchaseAllocationBusy||!validUI())return;
 if(onlyRemaining&&!purchaseReconciliation().some(c=>c.remaining))return notify('目前沒有尚未分配的商品。');
 if(!onlyRemaining&&(state.purchaseOrders??[]).length&&!confirm('全部重新分配會取代現有搶購訂單、托運紀錄、實際購買紀錄（含實付成本）、手動調整與帳號安排。若要保留現有安排，請使用「補分配剩餘」。確定全部重算？'))return;
 purchaseAllocationBusy=true;renderPurchaseOrders();
 await new Promise(resolve=>setTimeout(resolve,30));
 try{
  validate(state);const before=(state.purchaseOrders??[]).length,result=buildAutomaticPurchaseOrders({onlyRemaining});
  state.purchaseOrders=result;state.shipmentRecords=[];editingPurchaseId=null;save();render();
  const free=result.filter(o=>purchaseJpy(o)>=FREE_SHIPPING_JPY).length;
  notify(onlyRemaining?`已保留原有 ${before} 筆安排，新增 ${result.length-before} 筆搶購訂單；尚未分配數量已歸零，全部符合限購。`:`已重新建立 ${result.length} 筆搶購訂單，${free} 筆達到日幣 11,000 免運；全部商品數量一致且符合限購。`);
 }catch(error){notify((onlyRemaining?'補分配失敗：':'自動建立失敗：')+error.message,true);}
 finally{purchaseAllocationBusy=false;renderPurchaseOrders();}
}
