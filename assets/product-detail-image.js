'use strict';

// 單一商品沿用分配表格的優先序；每列最多六位，過長時分張以維持字體大小。
const productDetailImageButton=document.createElement('button');
productDetailImageButton.id='exportProductDetailImage';
productDetailImageButton.type='button';
productDetailImageButton.textContent='單一商品明細';
document.querySelector('.tools').insertBefore(productDetailImageButton,$('exportOrdersImage'));
let productDetailImageBusy=false;

function syncProductDetailImageButton(){
 productDetailImageButton.hidden=tab!=='orders'&&tab!=='allocation';
 productDetailImageButton.disabled=productDetailImageBusy||!state.orders.some(o=>state.products.some(p=>(o.quantities[p.id]??0)>0));
}
const productDetailImageObserver=new MutationObserver(syncProductDetailImageButton);
productDetailImageObserver.observe($('allocation'),{childList:true,attributes:true,attributeFilter:['hidden']});
productDetailImageObserver.observe($('orders'),{attributes:true,attributeFilter:['hidden']});
syncProductDetailImageButton();

function productDetailImageData(productId){
 const product=state.products.find(p=>p.id===productId);
 if(!product)throw Error('找不到此商品，請重新選擇。');
 const buyers=buildAllocation().products.find(p=>p.productId===productId).priorities;
 if(!buyers.length)throw Error('此商品目前沒有訂購人。');
 return {title:state.title,product,buyers,quantity:buyers.reduce((sum,b)=>sum+b.quantity,0)};
}

function updateProductDetailImageSummary(){
 const data=productDetailImageData($('productDetailImageSelect').value);
 $('productDetailImageSummary').textContent=`共 ${fmt(data.buyers.length)} 位訂購人，合計 ${fmt(data.quantity)} ${productUnit(data.product)}。`;
}

productDetailImageButton.onclick=()=>{
 if(!validUI())return;
 const allocation=buildAllocation();
 const counts=new Map(allocation.products.map(p=>[p.productId,p.priorities.length]));
 if(!allocation.products.some(p=>p.priorities.length))return notify('目前沒有可匯出的商品訂購明細。',true);
 const select=$('productDetailImageSelect'),previous=select.value;
 select.replaceChildren(...state.products.map(p=>{
  const option=document.createElement('option'),count=counts.get(p.id);
  option.value=p.id;option.disabled=!count;
  option.textContent=productLabel(p)+(count?`（${fmt(count)} 位）`:'（尚無訂購人）');
  return option;
 }));
 select.value=counts.get(previous)?previous:state.products.find(p=>counts.get(p.id)).id;
 updateProductDetailImageSummary();
 $('productDetailImageDialog').showModal();
};
$('productDetailImageSelect').onchange=updateProductDetailImageSummary;
$('cancelProductDetailImage').onclick=()=>$('productDetailImageDialog').close();

function productDetailImageLayout(productId){
 const data=productDetailImageData(productId),padding=32,gap=10,columns=Math.min(6,data.buyers.length);
 const width=Math.max(680,padding*2+columns*200+(columns-1)*gap),cardWidth=(width-padding*2-(columns-1)*gap)/columns;
 const context=document.createElement('canvas').getContext('2d');
 if(!context)throw Error('此瀏覽器無法建立圖片。');
 const family='"Segoe UI","Microsoft JhengHei",sans-serif';
 const block=(value,size,weight,color,lineHeight,margin=0,maxWidth=cardWidth-32)=>{
  const font=`${weight} ${size}px ${family}`,lines=[];let line='';context.font=font;
  for(const character of Array.from(String(value))){
   if(character==='\n'){lines.push(line);line='';continue;}
   if(line&&context.measureText(line+character).width>maxWidth){lines.push(line);line='';}
   line+=character;
  }
  lines.push(line);
  return {font,lines,color,lineHeight,margin,height:lines.length*lineHeight+margin};
 };
 const header=[
  block(data.title,20,500,'#52665e',28,0,width-padding*2),
  block(productLabel(data.product),26,700,'#203d38',36,8,width-padding*2),
  block(`共 ${fmt(data.buyers.length)} 位訂購人 · 合計 ${fmt(data.quantity)} ${productUnit(data.product)}`,18,500,'#246655',26,10,width-padding*2)
 ];
 const headerHeight=padding+header.reduce((sum,b)=>sum+b.height,0)+24;
 const rows=[];
 for(let index=0;index<data.buyers.length;index+=6){
  const cards=data.buyers.slice(index,index+6).map(b=>{
   const blocks=[
    block('優先序 '+b.priority,14,700,'#246655',22),
    block(b.nickname,18,700,'#203d38',26,12),
    block(`${fmt(b.quantity)} ${productUnit(data.product)}`,18,500,'#203d38',26,4),
    block('台幣合計 '+fmt(b.twd),16,400,'#52665e',24,4),
    block(`${b.shippingTwd>0?'有運費':'無運費'} · 順序 ${b.sequence??'—'}`,14,400,'#52665e',22,4)
   ];
   return {blocks,height:32+blocks.reduce((sum,b)=>sum+b.height,0)};
  });
  rows.push({cards,height:Math.max(...cards.map(c=>c.height))});
 }
 // 固定兩倍解析度，單張保持在 2,400 萬像素內，不因訂購人增加而縮小文字。
 const pages=[],footerHeight=44,maxHeight=4000;
 let page={rows:[],height:headerHeight};
 for(const row of rows){
  if(headerHeight+row.height+footerHeight>maxHeight)throw Error('商品名稱或買家暱稱過長，請縮短後再匯出。');
  const spacing=page.rows.length?12:0;
  if(page.rows.length&&page.height+spacing+row.height+footerHeight>maxHeight){
   pages.push({...page,height:page.height+footerHeight});page={rows:[],height:headerHeight};
  }
  page.height+=(page.rows.length?12:0)+row.height;page.rows.push(row);
 }
 pages.push({...page,height:page.height+footerHeight});
 return {...data,width,cardWidth,padding,gap,header,headerHeight,pages};
}

function productDetailImageCanvas(layout,pageIndex=0){
 const page=layout.pages[pageIndex];
 if(!page)throw Error('找不到此張商品明細。');
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 if(!ctx)throw Error('此瀏覽器無法建立圖片。');
 canvas.width=Math.ceil(layout.width*2);canvas.height=Math.ceil(page.height*2);ctx.scale(2,2);
 ctx.fillStyle='#fffef9';ctx.fillRect(0,0,layout.width,page.height);ctx.textBaseline='top';
 const drawBlocks=(blocks,x,y,align)=>{
  ctx.textAlign=align;
  for(const b of blocks){
   y+=b.margin;ctx.font=b.font;ctx.fillStyle=b.color;
   for(const line of b.lines){ctx.fillText(line,x,y);y+=b.lineHeight;}
  }
 };
 drawBlocks(layout.header,layout.padding,layout.padding,'left');
 let y=layout.headerHeight;
 for(const row of page.rows){
  row.cards.forEach((card,index)=>{
   const x=layout.padding+index*(layout.cardWidth+layout.gap);
   ctx.fillStyle='#f5f7ef';ctx.fillRect(x,y,layout.cardWidth,44);
   ctx.strokeStyle='#dfe5dc';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,layout.cardWidth-1,row.height-1);
   drawBlocks(card.blocks,x+layout.cardWidth/2,y+16,'center');
  });
  y+=row.height+12;
 }
 ctx.font='14px "Segoe UI","Microsoft JhengHei",sans-serif';ctx.fillStyle='#52665e';ctx.textAlign='right';
 ctx.fillText(`每列最多 6 位 · 第 ${pageIndex+1} / ${layout.pages.length} 張`,layout.width-layout.padding,page.height-28);
 return canvas;
}

async function exportSingleProductDetailImage(productId,button){
 if(productDetailImageBusy||!validUI())return;
 productDetailImageBusy=true;button.disabled=true;$('downloadProductDetailImage').disabled=true;syncProductDetailImageButton();
 try{
  await document.fonts.ready;
  const layout=productDetailImageLayout(productId);
  const filename=Array.from((layout.title+'_'+productLabel(layout.product)).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')).slice(0,90).join('')||'代購訂單';
  for(let index=0;index<layout.pages.length;index++){
   const canvas=productDetailImageCanvas(layout,index);
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('無法產生圖片。')),'image/png'));
   canvas.width=0;canvas.height=0;
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;
   link.download=filename+'_單一商品明細'+(layout.pages.length>1?`_${index+1}`:'')+'.png';link.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('productDetailImageDialog').close();
  notify(`已匯出 ${productLabel(layout.product)} 的 ${fmt(layout.buyers.length)} 位訂購人明細，每 6 位換行`+(layout.pages.length>1?`，共 ${layout.pages.length} 張圖片。`:'。'));
 }catch(error){notify('圖片匯出失敗：'+error.message,true);}
 finally{productDetailImageBusy=false;button.disabled=false;$('downloadProductDetailImage').disabled=false;syncProductDetailImageButton();}
}
$('productDetailImageForm').onsubmit=e=>{e.preventDefault();exportSingleProductDetailImage($('productDetailImageSelect').value,$('downloadProductDetailImage'));};
$('allocation').addEventListener('click',e=>{
 const button=e.target.closest('[data-export-product-detail]');
 if(button)exportSingleProductDetailImage(button.dataset.exportProductDetail,button);
});
