'use strict';

function actualPurchaseQuantity(order,pid){return order.actualQuantities?.[pid]??order.quantities[pid]??0;}
function actualPurchaseQuantities(order){return Object.fromEntries(state.products.map(p=>[p.id,actualPurchaseQuantity(order,p.id)]));}
function actualQuantitiesAfterPlanChange(order,quantities){
 return Object.fromEntries(state.products.map(p=>{
  const previous=order?.quantities[p.id]??0,actual=order?actualPurchaseQuantity(order,p.id):0;
  const quantity=!order||actual===previous?quantities[p.id]:actual;
  if(quantity>quantities[p.id])throw Error(productLabel(p)+' 的實際購買數量大於新的搶購數量，請先調整「實際購買紀錄」。');
  return [p.id,quantity];
 }));
}
function actualPurchaseReconciliation(){return purchaseReconciliation().map(row=>{const purchased=(state.purchaseOrders??[]).reduce((sum,o)=>sum+actualPurchaseQuantity(o,row.productId),0);return {...row,purchased,shortage:row.planned-purchased};});}
function successfulBuyerQuantity(order){return state.products.reduce((sum,product)=>sum+Math.max(0,(order.quantities[product.id]??0)-(order.refundQuantities?.[product.id]??0)),0);}
function internationalShippingBreakdown(){
 const buyers=state.orders.map(order=>({order,quantity:successfulBuyerQuantity(order)}));
 const buyerQuantityTotal=buyers.reduce((sum,buyer)=>sum+buyer.quantity,0);
 const totalQuantity=(state.purchaseOrders??[]).reduce((sum,order)=>sum+state.products.reduce((count,product)=>count+actualPurchaseQuantity(order,product.id),0),0);
 const internationalCents=moneyCents(state.internationalShippingTwd??0);
 const intlBaseCents=totalQuantity?Math.floor(internationalCents/totalQuantity):0;
 const intlRemainder=totalQuantity?internationalCents%totalQuantity:0;
 const domestic=shippingShare(),domesticTotalCents=moneyCents(domestic.totalShippingTwd);
 const domesticBaseCents=domestic.zeroShippingBuyerCount?Math.floor(domesticTotalCents/domestic.zeroShippingBuyerCount):0;
 const domesticRemainder=domestic.zeroShippingBuyerCount?domesticTotalCents%domestic.zeroShippingBuyerCount:0;
 let itemCursor=0,buyerCursor=0;
 const rows=buyers.map(({order,quantity})=>{
  const start=itemCursor,end=start+quantity;
  const extraIntlCents=Math.max(0,Math.min(end,intlRemainder)-Math.min(start,intlRemainder));
  itemCursor=end;
  const internationalCents=intlBaseCents*quantity+extraIntlCents;
  const paysDomestic=(order.shippingTwd??0)===0&&quantity>0;
  const domesticCents=paysDomestic?domesticBaseCents+(buyerCursor++<domesticRemainder?1:0):0;
  return {order,quantity,internationalCents,domesticCents,totalCents:internationalCents+domesticCents};
 });
 const allocatedInternationalCents=rows.reduce((sum,row)=>sum+row.internationalCents,0);
 const allocatedDomesticCents=rows.reduce((sum,row)=>sum+row.domesticCents,0);
 return {rows,totalQuantity,buyerQuantityTotal,internationalCents,domesticTotalCents,allocatedInternationalCents,allocatedDomesticCents,unallocatedInternationalCents:internationalCents-allocatedInternationalCents,unallocatedDomesticCents:domesticTotalCents-allocatedDomesticCents,totalDueCents:rows.reduce((sum,row)=>sum+row.totalCents,0)};
}
function renderInternationalShippingAllocation(){
 const result=internationalShippingBreakdown(),amount=state.internationalShippingTwd??0;
 const unitRate=result.totalQuantity?amount/result.totalQuantity:0;
 $('internationalShippingRate').textContent=result.totalQuantity?
  '實際購買 '+fmt(result.totalQuantity)+' 件 · 買家分攤 '+fmt(result.buyerQuantityTotal)+' 件 · 每件約 TWD '+new Intl.NumberFormat('zh-TW',{maximumFractionDigits:4}).format(unitRate):
  '目前實際購買件數為 0，尚無法分攤國際運費';
 const notices=[];
 if(!result.totalQuantity&&result.internationalCents)notices.push('目前實際購買件數為 0，國際運費 TWD '+fmt(result.internationalCents/100)+' 尚無法分攤。');
 if(!result.totalQuantity&&result.buyerQuantityTotal)notices.push('買家成功購買件數與實際購買紀錄不一致，請核對實際數量或退費紀錄。');
 if(result.totalQuantity&&result.buyerQuantityTotal<result.totalQuantity)notices.push('買家成功購買件數比實際購買紀錄少 '+fmt(result.totalQuantity-result.buyerQuantityTotal)+' 件，仍有國際運費 TWD '+fmt(result.unallocatedInternationalCents/100)+' 未分攤。');
 if(result.buyerQuantityTotal>result.totalQuantity)notices.push('買家成功購買件數比實際購買紀錄多 '+fmt(result.buyerQuantityTotal-result.totalQuantity)+' 件，分攤金額超出國際總運費 TWD '+fmt(-result.unallocatedInternationalCents/100)+'，請核對實際數量或退費紀錄。');
 if(result.unallocatedDomesticCents)notices.push('尚有境內運費 TWD '+fmt(result.unallocatedDomesticCents/100)+' 未分配（目前沒有符合條件的買家）。');
 $('internationalShippingNotice').textContent=notices.join(' ');
 $('internationalShippingAllocation').innerHTML='<table class="international-shipping-table"><thead><tr><th>序號</th><th>買家暱稱</th><th>成功購買商品數量</th><th>個人國際運費 (A)</th><th>境內運費 (B)</th><th>應支付運費 (A+B)</th></tr></thead><tbody>'+
  (result.rows.map(row=>'<tr><td data-label="序號">'+esc(row.order.sequence??'—')+'</td><td data-label="買家暱稱">'+esc(row.order.nickname)+'</td><td data-label="成功購買商品數量">'+fmt(row.quantity)+'</td><td data-label="個人國際運費 (A)">TWD '+fmt(row.internationalCents/100)+'</td><td data-label="境內運費 (B)">TWD '+fmt(row.domesticCents/100)+'</td><td data-label="應支付運費 (A+B)"><strong>TWD '+fmt(row.totalCents/100)+'</strong></td></tr>').join('')||'<tr><td colspan="6" class="empty">尚無買家紀錄。</td></tr>')+
  '</tbody><tfoot><tr><td colspan="2">合計</td><td>'+fmt(result.totalQuantity)+'</td><td>TWD '+fmt(result.allocatedInternationalCents/100)+'</td><td>TWD '+fmt(result.allocatedDomesticCents/100)+'</td><td><strong>TWD '+fmt(result.totalDueCents/100)+'</strong></td></tr></tfoot></table>';
}
function internationalShippingMarkup(){
 return '<section id="internationalShippingPanel"><div class="international-shipping-input"><label for="internationalShippingInput">輸入國際總運費 (TWD)<input id="internationalShippingInput" type="number" min="0" max="90071992547409.9" step="0.01" value="'+esc(state.internationalShippingTwd??0)+'"></label><strong id="internationalShippingRate"></strong></div><p class="purchase-rule">單件國際運費＝國際總運費 ÷ 實際購買總件數；每位買家應付運費＝成功購買件數 × 單件國際運費 (A) + 境內運費 (B)。</p><p id="internationalShippingNotice" class="mismatch" role="status"></p><div id="internationalShippingAllocation"></div></section>';
}
function buyerReceivedListMarkup(){
 const buyers=state.orders.map(order=>({order,products:state.products.map(product=>({product,quantity:(order.quantities[product.id]??0)-(order.refundQuantities?.[product.id]??0)})).filter(item=>item.quantity>0)})).filter(buyer=>buyer.products.length);
 return '<section id="buyerReceivedList"><h3>買家實得商品總表</h3><div class="buyer-received-table-wrap"><table class="buyer-received-table"><thead><tr><th>買家暱稱</th><th>買家實得商品</th></tr></thead><tbody>'+
  (buyers.map(({order,products})=>'<tr><td>'+esc(order.nickname)+'</td><td>'+products.map(({product,quantity})=>'<span class="buyer-received-item"><strong>'+esc(productLabel(product))+'</strong>'+(quantity>1?' × '+fmt(quantity)+' '+esc(productUnit(product)):'')+'</span>').join('　')+'</td></tr>').join('')||'<tr><td colspan="2" class="empty">目前沒有買家實得商品。</td></tr>')+
  '</tbody></table></div></section>';
}
function renderActualPurchaseSummary(){
 const checks=actualPurchaseReconciliation().filter(row=>row.requested||row.planned);
 $('actualPurchaseSummary').innerHTML='<p class="purchase-rule">實際購買數量預設與搶購清單 A 相同。請把沒買到的商品減少數量（完全沒買到填 0），再到「退費紀錄」產生退費。退費件數按 A − B 計算。</p><p class="purchase-rule">實付成本請輸入這筆搶購訂單最終支付的台幣總額（含代墊運費與其他相關費用）。未達免運的運費每筆固定 230 元，須再向買家補收，系統會將這筆應補收運費加回淨利。未確認請留空；完全沒買到且沒有支出請填 0。所有成本填齊後，實際淨利＝台幣訂單合計 − 退費總額 − 實付成本 ＋（實際購買未達免運筆數 × 230）。</p>'+(checks.length?'<table class="purchase-check"><thead><tr><th>商品</th><th>A 預計購買</th><th>B 實際買到</th><th>C 需退數量</th></tr></thead><tbody>'+checks.map(row=>`<tr><td>${esc(row.name)}</td><td>${fmt(row.planned)} ${row.unit}</td><td data-actual-product="${esc(row.productId)}">${fmt(row.purchased)} ${row.unit}</td><td class="${row.shortage?'mismatch':''}" data-shortage-product="${esc(row.productId)}">${fmt(row.shortage)} ${row.unit}</td></tr>`).join('')+'</tbody></table>':'')+buyerReceivedListMarkup();
 $('actualPurchaseSummary').innerHTML+=internationalShippingMarkup();
 renderInternationalShippingAllocation();
}
function renderActualPurchases(){
 const orders=state.purchaseOrders??[];renderActualPurchaseSummary();
 $('actualPurchase').innerHTML='<thead><tr><th>搶購帳號／搶購人</th><th>搶購順序／訂單</th><th>自成一車</th><th class="actual-cost-heading">實付成本 TWD</th>'+state.products.map(p=>`<th>${esc(productLabel(p))}</th>`).join('')+'<th>實際數量合計</th></tr></thead><tbody>'+orders.map((o,i)=>`<tr data-actual-order="${esc(o.id)}"><td data-label="搶購帳號／搶購人">${esc((state.purchaseAccounts??[]).find(a=>a.id===o.accountId)?.name||'未指定帳號')}<span class="priority-detail">${esc(o.purchaser||'未指定搶購人')}</span></td><td data-label="搶購順序／訂單">${i+1}<br><strong>${esc(o.name)}</strong></td><td data-label="自成一車">${o.isOwnCart?'✓':'—'}</td><td data-label="實付成本 TWD"><input type="number" min="0" max="90071992547409.9" step="0.01" placeholder="尚未填寫" value="${o.actualCostTwd??''}" data-kind="actualCostTwd" data-purchase-id="${esc(o.id)}" aria-label="${esc(o.name)} 實付成本 TWD"><span class="ordered-quantity">未確認留空，無支出填 0</span></td>${state.products.map(p=>`<td data-label="${esc(productLabel(p))}"><input type="number" min="0" max="${o.quantities[p.id]??0}" step="1" required value="${actualPurchaseQuantity(o,p.id)}" data-kind="actualQty" data-purchase-id="${esc(o.id)}" data-product="${esc(p.id)}" aria-label="${esc(o.name+' '+productLabel(p))} 實際買到數量" ${(o.quantities[p.id]??0)===0?'disabled':''}><span class="ordered-quantity">A 預計 ${fmt(o.quantities[p.id]??0)} ${productUnit(p)}</span></td>`).join('')}<td data-label="實際數量合計" data-actual-order-total="${esc(o.id)}">${fmt(state.products.reduce((sum,p)=>sum+actualPurchaseQuantity(o,p.id),0))}</td></tr>`).join('')+(orders.length?'':`<tr><td class="empty" colspan="${state.products.length+5}">請先在「訂單搶購分配順序」建立搶購清單 A。</td></tr>`)+`</tbody><tfoot><tr><td colspan="3">實際購買合計</td><td data-label="實付成本合計 TWD" id="actualCostFooter"></td>${state.products.map(p=>`<td data-label="${esc(productLabel(p))}" data-actual-footer="${esc(p.id)}">${fmt(orders.reduce((sum,o)=>sum+actualPurchaseQuantity(o,p.id),0))}</td>`).join('')}<td data-label="實際數量合計" id="actualQuantityTotal">${fmt(orders.reduce((sum,o)=>sum+state.products.reduce((n,p)=>n+actualPurchaseQuantity(o,p.id),0),0))}</td></tr></tfoot>`;
}
function editActualPurchaseQuantity(input){
 input.setCustomValidity('');const order=(state.purchaseOrders??[]).find(o=>o.id===input.dataset.purchaseId),product=state.products.find(p=>p.id===input.dataset.product);if(!order||!product)return;
 const quantity=Number(input.value),maximum=order.quantities[product.id]??0;
 if(!input.checkValidity()||!Number.isSafeInteger(quantity)||quantity<0||quantity>maximum){notify('實際買到數量必須為 0～'+fmt(maximum)+' 的整數。',true);return;}
 order.actualQuantities??=actualPurchaseQuantities(order);order.actualQuantities[product.id]=quantity;renderActualPurchaseSummary();
 for(const p of state.products){const cell=document.querySelector(`[data-actual-footer="${p.id}"]`);if(cell)cell.textContent=fmt((state.purchaseOrders??[]).reduce((sum,o)=>sum+actualPurchaseQuantity(o,p.id),0));}
 for(const o of state.purchaseOrders??[]){const cell=document.querySelector(`[data-actual-order-total="${o.id}"]`);if(cell)cell.textContent=fmt(state.products.reduce((sum,p)=>sum+actualPurchaseQuantity(o,p.id),0));}
 $('actualQuantityTotal').textContent=fmt((state.purchaseOrders??[]).reduce((sum,o)=>sum+state.products.reduce((n,p)=>n+actualPurchaseQuantity(o,p.id),0),0));updateRefundTotals();save();notify('實際購買數量與運費已更新；請到「退費紀錄」重新產生退費，以更新分攤人數。');
}

// 每個商品分別從分配表最後一位買家往前扣件數，允許部分退費。
function buildAutomaticRefunds(){
 validate(state);if(!(state.purchaseOrders??[]).length)throw Error('請先建立搶購清單 A，再確認實際購買紀錄 B。');const checks=actualPurchaseReconciliation();
 if(checks.some(row=>row.difference))throw Error('搶購清單 A 尚未與訂購明細一致，請先完成分配或修正超額數量，再產生退費。');
 if(checks.some(row=>!Number.isSafeInteger(row.planned)||!Number.isSafeInteger(row.purchased)||row.shortage<0))throw Error('搶購或實際購買數量無效，請先修正。');
 const refunds=new Map(state.orders.map(o=>[o.id,Object.fromEntries(state.products.map(p=>[p.id,0]))])),allocation=buildAllocation();
 for(const row of checks){let remaining=row.shortage;const priorities=allocation.products.find(p=>p.productId===row.productId).priorities;for(let i=priorities.length-1;i>=0&&remaining>0;i--){const buyer=priorities[i],quantity=Math.min(remaining,buyer.quantity);refunds.get(buyer.orderId)[row.productId]=quantity;remaining-=quantity;}if(remaining)throw Error('退費數量超過買家預購數量，請先核對分配表。');}
 return refunds;
}
function refundExportData(){const rows=state.orders.map(o=>({order:o,products:state.products.filter(p=>(o.refundQuantities?.[p.id]??0)>0).map(p=>({product:p,quantity:o.refundQuantities[p.id]})),amount:refundAmount(o)})).filter(row=>row.products.length);if(!rows.length)throw Error('目前沒有需要退費的商品。');return rows;}
async function refundExportCanvas(){
 validate(state);const rows=refundExportData();await document.fonts.ready;
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),padding=24,width=920,lineHeight=28,columnWidths=[170,520,182],font='18px "Segoe UI","Microsoft JhengHei",sans-serif';ctx.font=font;
 const wrap=(text,maxWidth)=>{const lines=[];let line='';for(const char of Array.from(text)){if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line);line='';}line+=char;}lines.push(line);return lines;};
 const titleLines=wrap(state.title+' · 退費紀錄',width-padding*2),sections=rows.map(row=>{const buyer=wrap(row.order.nickname,columnWidths[0]-24),items=row.products.flatMap(item=>wrap(productLabel(item.product)+' × '+fmt(item.quantity)+' '+productUnit(item.product),columnWidths[1]-24)),amount=[...wrap('TWD '+fmt(row.amount),columnWidths[2]-24),row.order.isRefunded?'已退費':'未退費'];return {buyer,items,amount,height:Math.max(buyer.length,items.length,amount.length)*lineHeight+28};});
 const height=padding*2+titleLines.length*lineHeight+44+sections.reduce((sum,row)=>sum+row.height,0)+60;if(height>16384||width*height>24000000)throw Error('退費圖片資料過多，請減少此訂單的資料筆數後再匯出。');
 canvas.width=width;canvas.height=height;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.font=font;ctx.textBaseline='top';ctx.fillStyle='#203d38';let y=padding;for(const line of titleLines){ctx.fillText(line,padding,y);y+=lineHeight;}y+=12;
 ctx.fillStyle='#e8eee3';ctx.fillRect(padding,y,width-padding*2,36);ctx.fillStyle='#203d38';ctx.font='bold '+font;const columnX=[padding,padding+columnWidths[0],padding+columnWidths[0]+columnWidths[1]];['買家','退費商品與數量','退費總額／狀態'].forEach((label,i)=>ctx.fillText(label,columnX[i]+12,y+5));y+=36;
 for(const section of sections){[section.buyer,section.items,section.amount].forEach((lines,i)=>{ctx.fillStyle=i===2?'#c62828':'#203d38';ctx.font=i===2?'bold '+font:font;lines.forEach((line,index)=>ctx.fillText(line,columnX[i]+12,y+14+index*lineHeight));});y+=section.height;ctx.strokeStyle='#dfe5dc';ctx.beginPath();ctx.moveTo(padding,y);ctx.lineTo(width-padding,y);ctx.stroke();}
 ctx.fillStyle='#203d38';ctx.font='bold '+font;ctx.fillText('全團退費總額：TWD '+fmt(refundGrandTotal()),padding+12,y+20);return canvas;
}
function initializeActualPurchaseUI(){
 $('actualPurchaseSummary').addEventListener('input',e=>{if(e.target.id==='internationalShippingInput')editInternationalShipping(e.target);});
 document.querySelector('.panel').addEventListener('click',async e=>{
  const button=e.target.closest('[data-export-received]');if(!button||!validUI())return;
  button.disabled=true;
  try{
   const orderId=button.dataset.exportReceived,nickname=state.orders.find(o=>o.id===orderId)?.nickname??'買家';
   const canvas=await buyerReceivedCanvas(orderId),blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('無法產生圖片。')),'image/png'));
   const url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download=(nickname.replace(/[\\/:*?"<>|]/g,'_')||'買家')+'_實際買到商品.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   notify('已輸出 '+nickname+' 的實際買到商品（訂購 − 退費）。');
  }catch(error){notify('買家商品圖片匯出失敗：'+error.message,true);}
  finally{button.disabled=false;}
 });
 $('generateRefunds').onclick=()=>{if(!validUI())return;try{const refunds=buildAutomaticRefunds();for(const order of state.orders)order.refundQuantities=refunds.get(order.id);save();render();notify('已依 A − B 重新產生並取代退費紀錄，可繼續手動調整。');}catch(error){notify('產生退費失敗：'+error.message,true);}};
 $('exportRefundsImage').onclick=async()=>{if(!validUI())return;const button=$('exportRefundsImage');button.disabled=true;try{const canvas=await refundExportCanvas(),blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('無法產生圖片。')),'image/png')),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(state.title.replace(/[\\/:*?"<>|]/g,'_')||'代購訂單')+'_退費紀錄.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('退費紀錄圖片已匯出，包含全部有退費商品的買家。');}catch(error){notify('退費圖片匯出失敗：'+error.message,true);}finally{button.disabled=false;}};
}


// 實付成本採台幣；null 代表未填，0 代表已確認沒有支出。
function actualCostSummary(){
 const orders=state.purchaseOrders??[],missingCount=orders.filter(o=>o.actualCostTwd==null).length;
 const recordedCostTwd=orders.reduce((sum,o)=>sum+moneyCents(o.actualCostTwd??0),0)/100;
 const netRevenueTwd=(moneyCents(allTotals().twd)-moneyCents(refundGrandTotal()))/100;
 const shipping=shippingShare(),shippingSupplementTwd=shipping.totalShippingTwd;
 const complete=orders.length>0&&missingCount===0;
 return {recordedCostTwd,missingCount,totalCount:orders.length,complete,netRevenueTwd,shippingSupplementTwd,
  belowFreeShippingCount:shipping.belowFreeShippingCount,
  actualNetProfitTwd:complete?(moneyCents(netRevenueTwd)-moneyCents(recordedCostTwd)+moneyCents(shippingSupplementTwd))/100:null};
}
function updateActualCostTotals(){
 const result=actualCostSummary(),amount=fmt(result.recordedCostTwd);
 const status=!result.totalCount?'尚無實際購買紀錄':result.missingCount?'已填 '+fmt(result.totalCount-result.missingCount)+'／'+fmt(result.totalCount)+' 筆，成本未填齊':'已填齊 '+fmt(result.totalCount)+' 筆成本';
 $('actualCostTotal').textContent=amount;
 $('actualCostStatus').textContent='TWD · '+(result.missingCount?'已填小計 · ':'')+status;
 $('actualProfit').textContent=result.actualNetProfitTwd===null?'—':fmt(result.actualNetProfitTwd);
 $('actualProfitCalculation').textContent=result.complete?
  'TWD '+fmt(allTotals().twd)+' − 退費 '+fmt(refundGrandTotal())+' − 實付成本 '+amount+' + 應補收運費 '+fmt(result.shippingSupplementTwd)+'（'+fmt(result.belowFreeShippingCount)+' 筆 × '+fmt(SHIPPING_PER_ORDER_TWD)+'）':
  status+'；填齊後顯示實際淨利';
 if($('actualCostFooter'))$('actualCostFooter').textContent=amount+(result.missingCount?'（未填齊）':'');
}
function editActualPurchaseCost(input){
 input.setCustomValidity('');
 const order=(state.purchaseOrders??[]).find(o=>o.id===input.dataset.purchaseId);if(!order)return;
 const value=input.value===''?null:Number(input.value);
 if(!input.checkValidity()||(value!==null&&!validMoney(value))){
  input.setCustomValidity('實付成本須為有效的非負台幣金額，最多兩位小數。');
  notify('實付成本無效，請輸入 0 或正數，最多兩位小數；未確認可留空。',true);return;
 }
 const previous=order.actualCostTwd??null;order.actualCostTwd=value;
 try{assertSafeAmounts(state);}catch(error){order.actualCostTwd=previous;input.setCustomValidity(error.message);notify(error.message,true);return;}
 updateActualCostTotals();save();notify(value===null?'此筆實付成本尚未填寫。':'實付成本與實際淨利已更新。');
}
function editInternationalShipping(input){
 input.setCustomValidity('');
 const value=input.value===''?0:Number(input.value);
 if(!input.checkValidity()||!validMoney(value)){input.setCustomValidity('國際總運費須為有效的非負台幣金額，最多兩位小數。');notify('請輸入有效的國際總運費。',true);return;}
 const previous=state.internationalShippingTwd??0;
 state.internationalShippingTwd=value;
 try{assertSafeAmounts(state);}catch(error){state.internationalShippingTwd=previous;input.setCustomValidity(error.message);notify(error.message,true);return;}
 save();renderInternationalShippingAllocation();notify('');
}
function buyerReceivedData(orderId){
 validate(state);const order=state.orders.find(o=>o.id===orderId);
 if(!order)throw Error('找不到這位買家的訂購紀錄。');
 const products=state.products.map(product=>({name:productLabel(product),quantity:(order.quantities[product.id]??0)-(order.refundQuantities?.[product.id]??0),unit:productUnit(product)})).filter(p=>p.quantity>0);
 if(!products.length)throw Error('這位買家沒有實際可交付商品（未訂購或已全部退費）。');
 return {nickname:order.nickname,products};
}
async function buyerReceivedCanvas(orderId){
 const data=buyerReceivedData(orderId);await document.fonts.ready;
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 const width=880,padding=28,lineHeight=30,nameWidth=670,font='20px "Segoe UI","Microsoft JhengHei",sans-serif';
 const wrap=(text,maxWidth)=>{const lines=[];let line='';for(const ch of Array.from(text)){if(line&&ctx.measureText(line+ch).width>maxWidth){lines.push(line);line='';}line+=ch;}lines.push(line);return lines;};
 ctx.font='bold '+font;const buyerLines=wrap('買家：'+data.nickname,width-padding*2);
 ctx.font=font;const rows=data.products.map(p=>({...p,lines:wrap(p.name,nameWidth-24)}));
 const headerHeight=padding+buyerLines.length*lineHeight+20+44;
 const height=headerHeight+rows.reduce((sum,row)=>sum+Math.max(row.lines.length*lineHeight,30)+24,0)+padding;
 if(height>16384||width*height>24000000)throw Error('商品清單過長，無法產生圖片。');
 canvas.width=width;canvas.height=height;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.textBaseline='top';
 ctx.font='bold '+font;ctx.fillStyle='#203d38';let y=padding;
 for(const line of buyerLines){ctx.fillText(line,padding,y);y+=lineHeight;}y+=20;
 ctx.fillStyle='#e8eee3';ctx.fillRect(padding,y,width-padding*2,44);ctx.fillStyle='#203d38';
 ctx.fillText('商品名稱',padding+12,y+8);ctx.fillText('數量',padding+nameWidth+12,y+8);y+=44;
 for(const row of rows){ctx.font=font;row.lines.forEach((line,i)=>ctx.fillText(line,padding+12,y+12+i*lineHeight));ctx.font='bold '+font;ctx.fillText(fmt(row.quantity)+' '+row.unit,padding+nameWidth+12,y+12);y+=Math.max(row.lines.length*lineHeight,30)+24;ctx.strokeStyle='#dfe5dc';ctx.beginPath();ctx.moveTo(padding,y);ctx.lineTo(width-padding,y);ctx.stroke();}
 return canvas;
}
