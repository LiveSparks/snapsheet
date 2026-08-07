"use strict";

/* ═════════════════════════ utils ═════════════════════════ */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let _uid=1; const uid=()=>"p"+(_uid++);
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;$("#toasts").appendChild(t);
  setTimeout(()=>t.classList.add("out"),2600);setTimeout(()=>t.remove(),3000);}
const MM_IN=25.4;

/* ═════════════════════════ state ═════════════════════════ */
const SIZES={a4:[210,297],a5:[148,210],a3:[297,420],b5:[176,250],letter:[215.9,279.4],legal:[215.9,355.6],p1015:[101.6,152.4],p1318:[127,177.8]};
const state={
  photos:[], P:new Map(), sel:new Set(),
  mode:"polaroid",
  page:{size:"a4",w:210,h:297,orient:"auto",margin:8,gap:3},
  flow:{maxW:92,maxH:92,rotate:true},
  pol:{pw:62,ph:62,band:16,pad:5,border:true,dates:true},
  grid:{cw:60,ch:45,fit:"cover"},
  guides:{on:true,style:"marks",color:"#e0242f",preview:true},
  dpi:300, target:"sel", layout:null,
};
const MIN_ZOOM=.5;
const SETTINGS_KEY="snapsheet-settings-v1";
function mergeSettings(target,source){if(!source||typeof source!=="object")return;
  Object.keys(target).forEach(k=>{if(Object.prototype.hasOwnProperty.call(source,k)&&typeof source[k]===typeof target[k])target[k]=source[k];});}
let savedSettings=null;
function loadSettings(){
  try{savedSettings=JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null");}catch(e){savedSettings=null;}
  if(!savedSettings)return;
  if(["flow","polaroid","grid"].includes(savedSettings.mode))state.mode=savedSettings.mode;
  mergeSettings(state.page,savedSettings.page);mergeSettings(state.flow,savedSettings.flow);mergeSettings(state.pol,savedSettings.pol);mergeSettings(state.grid,savedSettings.grid);mergeSettings(state.guides,savedSettings.guides);
  if(Number.isFinite(savedSettings.dpi))state.dpi=savedSettings.dpi;
  if(savedSettings.target==="sel"||savedSettings.target==="all")state.target=savedSettings.target;
}
function settingsSnapshot(){return{mode:state.mode,page:{...state.page},flow:{...state.flow},pol:{...state.pol},grid:{...state.grid},guides:{...state.guides},dpi:state.dpi,target:state.target,
  adjust:batchAdj(),closed:$$(".sec").filter(s=>s.classList.contains("closed")).map(s=>s.id)};}
const saveSettings=debounce(()=>{try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settingsSnapshot()));}catch(e){}},140);
const DEF_ADJ=()=>({b:100,c:100,s:100,sh:0,r:10});
const adjActive=p=>p.adj.b!==100||p.adj.c!==100||p.adj.s!==100||p.adj.sh>0;
const adjCss=p=>`brightness(${p.adj.b}%) contrast(${p.adj.c}%) saturate(${p.adj.s}%)`;
const fmtDate=ms=>{const d=new Date(ms);const z=n=>String(n).padStart(2,"0");return `${z(d.getDate())}.${z(d.getMonth()+1)}.${d.getFullYear()}`};
const capText=p=>{const c=(p.caption||"").trim(); if(c)return c; return state.pol.dates?fmtDate(p.dateMs):""};
function frameMM(){ if(state.mode==="polaroid")return{w:state.pol.pw,h:state.pol.ph,cover:true};
  if(state.mode==="grid")return{w:state.grid.cw,h:state.grid.ch,cover:state.grid.fit==="cover"};
  return null; }
const polPad=()=>state.pol.border?state.pol.pad:0;

/* ═════════════════════════ bitmap cache / imaging ═════════════════════════ */
const CANVAS_FILTER=(()=>{try{const c=document.createElement("canvas").getContext("2d");c.filter="brightness(1.2)";return c.filter==="brightness(1.2)"}catch(e){return false}})();
const bmpCache=new Map();
async function getBitmap(p,needPx){
  const c=bmpCache.get(p.id);
  if(c&&c.px>=needPx*0.98)return c.bmp;
  let bmp=null;
  const dims=imageDims(p),ar=dims.w/dims.h; let rw=Math.min(dims.w,Math.ceil(needPx)), rh=Math.min(dims.h,Math.ceil(needPx/ar));
  try{ bmp=await createImageBitmap(p.printBlob,{resizeWidth:rw,resizeHeight:rh,resizeQuality:"high"}); }
  catch(e1){ try{ bmp=await createImageBitmap(p.printBlob); }
    catch(e2){ const url=URL.createObjectURL(p.printBlob); const img=await loadImg(url); URL.revokeObjectURL(url); bmp=img; } }
  if(bmpCache.size>7){const k=bmpCache.keys().next().value;const old=bmpCache.get(k);if(old&&old.bmp.close)try{old.bmp.close()}catch(e){} bmpCache.delete(k);}
  bmpCache.set(p.id,{bmp,px:Math.max(needPx,rw)});
  return bmp;
}
function loadImg(url){return new Promise((res,rej)=>{const i=new Image();i.decoding="async";i.onload=()=>res(i);i.onerror=()=>rej(new Error("decode failed"));i.src=url;});}

/* pixel-level adjust fallback (no ctx.filter) */
function pixelAdjust(ctx,w,h,adj){
  const id=ctx.getImageData(0,0,w,h),d=id.data,b=adj.b/100,c=adj.c/100,s=adj.s/100;
  for(let i=0;i<d.length;i+=4){
    let r=d[i]*b,g=d[i+1]*b,bl=d[i+2]*b;
    r=(r-128)*c+128;g=(g-128)*c+128;bl=(bl-128)*c+128;
    const l=.299*r+.587*g+.114*bl;
    d[i]=l+(r-l)*s;d[i+1]=l+(g-l)*s;d[i+2]=l+(bl-l)*s;
  }
  ctx.putImageData(id,0,0);
}
/* unsharp mask (separable box blur) */
function boxBlurData(d,w,h,r){
  r=Math.max(1,Math.round(r));const win=2*r+1;
  const tmp=new Uint8ClampedArray(d.length),out=new Uint8ClampedArray(d.length);
  for(let y=0;y<h;y++){
    const row=y*w*4;let sr=0,sg=0,sb=0;
    for(let x=-r;x<=r;x++){const i=(x<0?0:x>=w?w-1:x)*4+row;sr+=d[i];sg+=d[i+1];sb+=d[i+2];}
    for(let x=0;x<w;x++){
      const o=row+x*4;tmp[o]=sr/win;tmp[o+1]=sg/win;tmp[o+2]=sb/win;tmp[o+3]=d[o+3];
      const ai=Math.min(w-1,x+r+1)*4+row,si=Math.max(0,x-r)*4+row;
      sr+=d[ai]-d[si];sg+=d[ai+1]-d[si+1];sb+=d[ai+2]-d[si+2];
    }
  }
  for(let x=0;x<w;x++){
    let sr=0,sg=0,sb=0;
    for(let y=-r;y<=r;y++){const i=(y<0?0:y>=h?h-1:y)*w*4+x*4;sr+=tmp[i];sg+=tmp[i+1];sb+=tmp[i+2];}
    for(let y=0;y<h;y++){
      const o=y*w*4+x*4;out[o]=sr/win;out[o+1]=sg/win;out[o+2]=sb/win;out[o+3]=tmp[o+3];
      const ai=(Math.min(h-1,y+r+1)*w+x)*4,si=(Math.max(0,y-r)*w+x)*4;
      sr+=tmp[ai]-tmp[si];sg+=tmp[ai+1]-tmp[si+1];sb+=tmp[ai+2]-tmp[si+2];
    }
  }
  return out;
}
function unsharpCanvas(cv,amount,rpx){
  if(amount<=0||rpx<0.35)return;
  const ctx=cv.getContext("2d",{willReadFrequently:true});
  const w=cv.width,h=cv.height; if(!w||!h)return;
  const id=ctx.getImageData(0,0,w,h);
  const blur=boxBlurData(id.data,w,h,rpx);
  const d=id.data,a=amount;
  for(let i=0;i<d.length;i+=4){
    d[i]=clamp(d[i]+(d[i]-blur[i])*a,0,255);
    d[i+1]=clamp(d[i+1]+(d[i+1]-blur[i+1])*a,0,255);
    d[i+2]=clamp(d[i+2]+(d[i+2]-blur[i+2])*a,0,255);
  }
  ctx.putImageData(id,0,0);
}
const sharpPx=(r,pxPerMm)=>r/10*pxPerMm/(150/MM_IN);

/* ═════════════════════════ import pipeline ═════════════════════════ */
const importQueue=[]; let importBusy=0, importDone=0, importTotal=0;
const heifLibReady=new Promise((resolve,reject)=>{
  const s=$("#heifLib");
  if(typeof window.libheif==="function")return resolve();
  if(!s)return reject(new Error("HEIF decoder script is missing"));
  s.addEventListener("load",()=>resolve(),{once:true});
  s.addEventListener("error",()=>reject(new Error("HEIF decoder failed to load")),{once:true});
});
let heifModulePromise=null;
function getHeifModule(){
  if(!heifModulePromise)heifModulePromise=heifLibReady.then(()=>window.libheif());
  return heifModulePromise;
}
async function decodeHeic(file){
  try{
    const lib=await getHeifModule();
    const decoder=new lib.HeifDecoder();
    const images=decoder.decode(new Uint8Array(await file.arrayBuffer()));
    const image=images[0];
    if(!image)throw new Error("HEIF contains no images");
    const w=image.get_width(),h=image.get_height();
    const cv=document.createElement("canvas");cv.width=w;cv.height=h;
    const ctx=cv.getContext("2d"),data=ctx.createImageData(w,h);
    await new Promise((resolve,reject)=>image.display(data,displayData=>displayData?resolve():reject(new Error("HEIF display failed"))));
    ctx.putImageData(data,0,0);
    const blob=await new Promise((resolve,reject)=>cv.toBlob(b=>b?resolve(b):reject(new Error("HEIF conversion failed")),"image/jpeg",.92));
    if(image.free)image.free();
    if(decoder.free)decoder.free();
    return blob;
  }catch(primary){
    if(!window.heic2any)throw primary;
    const out=await heic2any({blob:file,toType:"image/jpeg",quality:.92});
    return Array.isArray(out)?out[0]:out;
  }
}
function queueImport(files){
  const list=[...files].filter(f=>f&&(f.type.startsWith("image/")||/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name)));
  if(!list.length)return toast("No image files found");
  importDone=0;importTotal+=list.length;
  list.forEach(f=>importQueue.push(f));
  showOv("Importing photos"); pumpImport();
}
async function pumpImport(){
  while(importQueue.length&&importBusy<2){
    const f=importQueue.shift(); importBusy++;
    importFile(f).catch(e=>{console.warn(e);toast(`Skipped ${f.name} (couldn’t decode)`);})
      .finally(()=>{importBusy--;importDone++;
        ovSet(importDone,importTotal,"photo");
        if(!importQueue.length&&!importBusy){hideOv();relayoutNow();renderFilm();toast(`${importDone} photo${importDone>1?"s":""} added`);importTotal=0;}
        else pumpImport();});
  }
}
async function importFile(file){
  const isHeic=/\.(heic|heif)$/i.test(file.name)||/^image\/(heic|heif)/i.test(file.type);
  let blob=file,img=null,url=null;
  try{ url=URL.createObjectURL(file); img=await loadImg(url); }        // native decode (Safari handles HEIC)
  catch(e){
    if(url)URL.revokeObjectURL(url);
    if(!isHeic)throw e;
    blob=await decodeHeic(file);
    url=URL.createObjectURL(blob); img=await loadImg(url);
  }
  const nw=img.naturalWidth,nh=img.naturalHeight;
  const k=Math.min(1,1600/Math.max(nw,nh));
  const work=document.createElement("canvas");work.width=Math.round(nw*k);work.height=Math.round(nh*k);
  work.getContext("2d").drawImage(img,0,0,work.width,work.height);
  const tk=Math.min(1,520/Math.max(work.width,work.height));
  const th=document.createElement("canvas");th.width=Math.round(work.width*tk);th.height=Math.round(work.height*tk);
  th.getContext("2d").drawImage(work,0,0,th.width,th.height);
  const workBlob=await new Promise(r=>work.toBlob(r,"image/jpeg",0.86));
  const thumbBlob=await new Promise(r=>th.toBlob(r,"image/jpeg",0.75));
  if(url)URL.revokeObjectURL(url);
  const p={id:uid(),name:file.name,w:nw,h:nh,dateMs:file.lastModified||Date.now(),
    printBlob:(blob!==file)?blob:file, workBlob, thumbURL:URL.createObjectURL(thumbBlob),
    adj:DEF_ADJ(),crop:{z:1,x:0,y:0},rotation:0,caption:"",included:true};
  state.photos.push(p);state.P.set(p.id,p);
}

/* ═════════════════════════ layout engines ═════════════════════════ */
const EPS=0.02;
function imageDims(p){return (Math.abs((p.rotation||0)%2)===1)?{w:p.h,h:p.w}:{w:p.w,h:p.h};}
function rotationDeg(p){return ((p.rotation||0)%4+4)%4*90;}
function mkF(p,x,y,w,h,crop){return{pid:p.id,img:{x,y,w,h},cut:{x,y,w,h},cap:null,crop}}
function layFlow(photos,W,H){
  const m=state.page.margin,gap=state.page.gap,iw=W-2*m,ih=H-2*m;
  const items=photos.map(p=>{
    const ar=p.w/p.h;let w=state.flow.maxW,h=w/ar;
    if(h>state.flow.maxH){h=state.flow.maxH;w=h*ar;}
    return{p,w,h};
  }).sort((a,b)=>b.h-a.h||b.w-a.w);
  const pages=[];let frames=[],used=0,x=0,y=0,shelfH=0,started=false;
  const center=fs=>{let mr=0,mb=0;fs.forEach(f=>{mr=Math.max(mr,f.img.x-m+f.img.w);mb=Math.max(mb,f.img.y-m+f.img.h);});
    const dx=(iw-mr)/2,dy=(ih-mb)/2;fs.forEach(f=>{f.img.x+=dx;f.img.y+=dy;f.cut={...f.img};});};
  const newPage=()=>{if(frames.length){center(frames);pages.push({w:W,h:H,frames});}frames=[];x=0;y=0;shelfH=0;started=false;};
  const place=(it,ww,hh)=>{frames.push(mkF(it.p,m+x,m+y,ww,hh,false));x+=ww+gap;shelfH=Math.max(shelfH,hh);started=true;used+=ww*hh;};
  const fits=(ww,hh)=>started?(x+ww<=iw+EPS&&y+Math.max(shelfH,hh)<=ih+EPS):(ww<=iw+EPS&&hh<=ih+EPS);
  for(const it of items){
    let w=it.w,h=it.h;
    if(w>iw||h>ih){const k=Math.min(iw/w,ih/h);w*=k;h*=k;}
    const rw=h,rh=w;
    if(fits(w,h)){place(it,w,h);continue;}
    if(state.flow.rotate&&fits(rw,rh)){place(it,rw,rh);continue;}
    if(started){y+=shelfH+gap;x=0;shelfH=0;}
    const okN=w<=iw+EPS&&y+h<=ih+EPS, okR=state.flow.rotate&&rw<=iw+EPS&&y+rh<=ih+EPS;
    if(okN)place(it,w,h);
    else if(okR)place(it,rw,rh);
    else{newPage();place(it,w,h);}
  }
  newPage();
  return{pages,cov:pages.length?used/(pages.length*iw*ih):0};
}
function layCells(photos,W,H,cellW,cellH,mkFrame){
  const m=state.page.margin,gap=state.page.gap,iw=W-2*m,ih=H-2*m;
  let cols=Math.max(1,Math.floor((iw+gap)/(cellW+gap)));
  let rows=Math.max(1,Math.floor((ih+gap)/(cellH+gap)));
  if(cellW>iw)cols=1; if(cellH>ih)rows=1;
  const per=cols*rows,pages=[];let used=0;
  for(let s=0;s<photos.length;s+=per){
    const chunk=photos.slice(s,s+per);
    const gw=cols*cellW+(cols-1)*gap, gh=rows*cellH+(rows-1)*gap;
    const ox=m+(iw-gw)/2, oy=m+(ih-gh)/2;
    const frames=chunk.map((p,i)=>{
      const cx=ox+(i%cols)*(cellW+gap), cy=oy+Math.floor(i/cols)*(cellH+gap);
      used+=cellW*cellH; return mkFrame(p,cx,cy);
    });
    pages.push({w:W,h:H,frames});
  }
  return{pages,cov:pages.length?used/(pages.length*iw*ih):0};
}
function layPolaroid(photos,W,H){
  const{pw,ph,band}=state.pol,pad=polPad(),cw=pw+2*pad,ch=ph+band+2*pad;
  return layCells(photos,W,H,cw,ch,(p,cx,cy)=>({
    pid:p.id,img:{x:cx+pad,y:cy+pad,w:pw,h:ph},cut:{x:cx,y:cy,w:cw,h:ch},
    cap:band>0.5?{x:cx,y:cy+pad+ph,w:cw,h:band}:null,crop:true}));
}
function layGrid(photos,W,H){
  const{cw,ch,fit}=state.grid;
  return layCells(photos,W,H,cw,ch,(p,cx,cy)=>{
    let img={x:cx,y:cy,w:cw,h:ch};
    if(fit==="contain"){const s=Math.min(cw/p.w,ch/p.h);
      img={x:cx+(cw-p.w*s)/2,y:cy+(ch-p.h*s)/2,w:p.w*s,h:p.h*s};}
    return{pid:p.id,img,cut:{x:cx,y:cy,w:cw,h:ch},cap:null,crop:fit==="cover"};
  });
}
function buildLayout(photos,W,H){
  if(state.mode==="flow")return layFlow(photos,W,H);
  if(state.mode==="polaroid")return layPolaroid(photos,W,H);
  return layGrid(photos,W,H);
}
function computeLayout(){
  const inc=state.photos.filter(p=>p.included);
  let[w,h]=SIZES[state.page.size]||[state.page.w,state.page.h];
  if(state.page.size==="custom"){w=state.page.w;h=state.page.h;}
  const orients=state.page.orient==="auto"?["portrait","landscape"]:[state.page.orient];
  let best=null;
  for(const o of orients){
    const W=o==="landscape"?h:w, H=o==="landscape"?w:h;
    const L=buildLayout(inc,W,H);
    if(!best||L.pages.length<best.pages.length)best={...L,W,H,o};
  }
  best.placed=inc.length;
  state.layout=best;
}

/* ═════════════════════════ rendering: pages ═════════════════════════ */
const frameMap=new Map();
const dpr=()=>Math.min(2.5,window.devicePixelRatio||1);
function el(tag,cls){const e=document.createElement(tag);if(cls)e.className=cls;return e;}
function coverGeom(p,fw,fh,z){
  const dims=imageDims(p);
  const s0=Math.max(fw/dims.w,fh/dims.h)*z, dw=dims.w*s0, dh=dims.h*s0;
  const mx=Math.max(0,(dw-fw)/2),my=Math.max(0,(dh-fh)/2);
  return{dw,dh,left:(fw-dw)/2+clamp(p.crop.x,-mx,mx),top:(fh-dh)/2+clamp(p.crop.y,-my,my)};
}
function clampCrop(p){
  const fm=frameMM(); if(!fm||!fm.cover)return;
  const dims=imageDims(p),s0=Math.max(fm.w/dims.w,fm.h/dims.h)*p.crop.z;
  const mx=Math.max(0,(dims.w*s0-fm.w)/2),my=Math.max(0,(dims.h*s0-fm.h)/2);
  p.crop.x=clamp(p.crop.x,-mx,mx); p.crop.y=clamp(p.crop.y,-my,my);
}
function applyFrameImg(img,p,f,K){
  const dims=imageDims(p),turn=(p.rotation||0)%2!==0,rot=rotationDeg(p);
  let left,top,dw,dh;
  if(f.crop){const g=coverGeom(p,f.img.w,f.img.h,p.crop.z);dw=g.dw*K;dh=g.dh*K;left=g.left*K;top=g.top*K;}
  else{const s=Math.min(f.img.w/dims.w,f.img.h/dims.h);dw=dims.w*s*K;dh=dims.h*s*K;left=(f.img.w*K-dw)/2;top=(f.img.h*K-dh)/2;}
  const iw=turn?dh:dw,ih=turn?dw:dh;
  img.style.left=(left+dw/2-iw/2)+"px";img.style.top=(top+dh/2-ih/2)+"px";img.style.width=iw+"px";img.style.height=ih+"px";
  img.style.transform=rot?`rotate(${rot}deg)`:"none";
  img.style.filter=adjActive(p)?adjCss(p):"none";
}
function setCapEl(c,p,f,K){
  const t=capText(p);c.textContent=t;c.style.display=t?"":"none";if(!t)return;
  const fs=Math.min(f.cap.h*K*0.62,f.cap.w*K/(Math.max(3,t.length)*0.42),f.cap.h*K);
  c.style.fontSize=fs+"px";
}
function drawGuides(ctx,pg,K,W,H){
  const g=state.guides;ctx.strokeStyle=g.color;ctx.globalAlpha=0.9;
  ctx.lineWidth=Math.max(0.8,0.22*K);
  const vx=new Set(),hy=new Set();
  pg.frames.forEach(f=>{[f.cut.x,f.cut.x+f.cut.w].forEach(v=>vx.add(Math.round(v*10)/10));
    [f.cut.y,f.cut.y+f.cut.h].forEach(v=>hy.add(Math.round(v*10)/10));});
  if(g.style==="edge"){
    const l=3.5;ctx.beginPath();
    vx.forEach(x=>{if(x<0||x>W)return;ctx.moveTo(x*K,0);ctx.lineTo(x*K,l*K);ctx.moveTo(x*K,H*K);ctx.lineTo(x*K,(H-l)*K);});
    hy.forEach(y=>{if(y<0||y>H)return;ctx.moveTo(0,y*K);ctx.lineTo(l*K,y*K);ctx.moveTo(W*K,y*K);ctx.lineTo((W-l)*K,y*K);});
    ctx.stroke();
  }else if(g.style==="lines"){
    ctx.beginPath();
    vx.forEach(x=>{ctx.moveTo(x*K,0);ctx.lineTo(x*K,H*K);});
    hy.forEach(y=>{ctx.moveTo(0,y*K);ctx.lineTo(W*K,y*K);});
    ctx.stroke();
  }else{
    const g0=0.9,l=2.6;ctx.beginPath();
    pg.frames.forEach(f=>{
      const{x,y,w,h}=f.cut;
      [[x,y,-1,-1],[x+w,y,1,-1],[x,y+h,-1,1],[x+w,y+h,1,1]].forEach(([cx,cy,sx,sy])=>{
        const x1=cx+sx*g0,x2=cx+sx*(g0+l),y1=cy+sy*g0,y2=cy+sy*(g0+l);
        if(x2>=0&&x1<=W){ctx.moveTo(x1*K,cy*K);ctx.lineTo(x2*K,cy*K);}
        if(y2>=0&&y1<=H){ctx.moveTo(cx*K,y1*K);ctx.lineTo(cx*K,y2*K);}
      });
    });
    ctx.stroke();
  }
  ctx.globalAlpha=1;
}
function sizeLabel(){return state.page.size==="custom"?"Custom":$("#pgSize").selectedOptions[0].text.split(" ·")[0];}
function renderPages(){
  const wrap=$("#pagesWrap");frameMap.clear();wrap.innerHTML="";
  const has=state.photos.length>0;
  $("#empty").style.display=has?"none":"";
  if(!has)return;
  const L=state.layout;
  $("#btnPrint").disabled=$("#btnExport").disabled=!L.pages.length;
  if(!L.pages.length){wrap.innerHTML='<div class="nopage">No photos included — re-include some from the film strip.</div>';return;}
  const stageW=$("#stage").clientWidth-48;
  const K=clamp(Math.min(stageW,780)/L.W,0.3,4);
  const frag=document.createDocumentFragment();
  L.pages.forEach((pg,i)=>{
    const box=el("div","pagebox");
    const lab=el("div","plabel");
    lab.innerHTML=`<b>SHEET ${i+1}/${L.pages.length}</b><span>${pg.frames.length} photos · ${sizeLabel()} · ${Math.round(L.W)}×${Math.round(L.H)} mm</span>`;
    const page=el("div","page");
    page.style.width=L.W*K+"px";page.style.height=L.H*K+"px";
    pg.frames.forEach(f=>{
      const p=state.P.get(f.pid);if(!p)return;
      const b=document.createElement("button");b.type="button";b.className="frame";b.title=p.name;
      b.style.cssText=`left:${f.img.x*K}px;top:${f.img.y*K}px;width:${f.img.w*K}px;height:${f.img.h*K}px`;
      const img=new Image();img.alt="";img.src=p.thumbURL;img.draggable=false;
      applyFrameImg(img,p,f,K);b.appendChild(img);
      b.addEventListener("click",()=>openEditor(p.id));
      page.appendChild(b);
      const entry={el:b,img,f,capEl:null};
      if(!frameMap.has(p.id))frameMap.set(p.id,[]);
      frameMap.get(p.id).push(entry);
      if(f.cap){const c=el("div","cap");
        c.style.cssText=`left:${f.cap.x*K}px;top:${f.cap.y*K}px;width:${f.cap.w*K}px;height:${f.cap.h*K}px`;
        setCapEl(c,p,f,K);page.appendChild(c);entry.capEl=c;}
    });
    if(state.guides.on&&state.guides.preview){
      const cv=document.createElement("canvas");cv.className="guides";
      const D=dpr();cv.width=Math.round(L.W*K*D);cv.height=Math.round(L.H*K*D);
      cv.style.width=L.W*K+"px";cv.style.height=L.H*K+"px";
      const ctx=cv.getContext("2d");ctx.setTransform(D,0,0,D,0,0);
      drawGuides(ctx,pg,K,L.W,L.H);page.appendChild(cv);
    }
    box.append(lab,page);frag.appendChild(box);
  });
  wrap.appendChild(frag);
  updateStats();
}
function updatePhotoVisual(p){
  (frameMap.get(p.id)||[]).forEach(e=>{applyFrameImg(e.img,p,e.f,curK());if(e.capEl)setCapEl(e.capEl,p,e.f,curK());});
}
function curK(){const L=state.layout;if(!L||!L.pages.length)return 1;
  return clamp(Math.min($("#stage").clientWidth-48,780)/L.W,0.3,4);}
function updateStats(){
  const L=state.layout,inc=state.photos.filter(p=>p.included).length;
  $("#stats").innerHTML=L.pages.length?
    `<span><span class="dot" style="background:var(--cy)"></span><b>${L.pages.length}</b> SHEET${L.pages.length>1?"S":""}</span>
     <span><span class="dot" style="background:var(--mg)"></span><b>${inc}</b> PHOTOS</span>
     <span><span class="dot" style="background:var(--yl)"></span><b>${Math.round((L.cov||0)*100)}%</b> COVERAGE</span>`:"";
}
const relayoutNow=()=>{computeLayout();renderPages();};
const relayout=debounce(relayoutNow,110);

/* ═════════════════════════ film strip ═════════════════════════ */
function renderFilm(){
  const film=$("#film");film.innerHTML="";
  if(!state.photos.length){film.innerHTML='<div class="filmEmpty">Your roll is empty — add photos above.</div>';}
  state.photos.forEach(p=>{
    const t=el("div","tile"+(state.sel.has(p.id)?" sel":"")+(p.included?"":" off"));
    t.dataset.id=p.id;t.title=p.name;
    const img=new Image();img.src=p.thumbURL;img.alt="";img.loading="lazy";t.appendChild(img);
    const ck=el("span","ck");ck.textContent="✓";t.appendChild(ck);
    const rm=el("span","rm");rm.textContent="✕";rm.title="Remove from layout";t.appendChild(rm);
    const bd=el("span","bd");
    if(adjActive(p))bd.appendChild(el("i","adj"));
    if((p.caption||"").trim())bd.appendChild(el("i","capd"));
    t.appendChild(bd);
    film.appendChild(t);
  });
  stripCounts();
}
function stripCounts(){
  const n=state.photos.length,sel=state.sel.size,off=state.photos.filter(p=>!p.included).length;
  $("#stripCount").textContent=`${n} photo${n!==1?"s":""}`+(sel?` · ${sel} selected`:"")+(off?` · ${off} hidden`:"");
  $("#tgtSel").textContent=sel?`Selected (${sel})`:"Selected";
}
$("#film").addEventListener("click",e=>{
  const t=e.target.closest(".tile");if(!t)return;
  const p=state.P.get(t.dataset.id);if(!p)return;
  if(e.target.closest(".rm")){p.included=false;relayout();renderFilm();return;}
  if(e.target.closest(".ck")){state.sel.has(p.id)?state.sel.delete(p.id):state.sel.add(p.id);
    t.classList.toggle("sel",state.sel.has(p.id));stripCounts();return;}
  if(!p.included){p.included=true;relayout();renderFilm();return;}
  openEditor(p.id);
});
$("#btnSelAll").onclick=()=>{state.photos.forEach(p=>state.sel.add(p.id));renderFilm();};
$("#btnSelNone").onclick=()=>{state.sel.clear();renderFilm();};
$("#btnClearAll").onclick=()=>{
  if(!state.photos.length)return;
  if(!confirm("Remove all photos from the roll?"))return;
  state.photos.forEach(p=>{URL.revokeObjectURL(p.thumbURL);});
  state.photos=[];state.P.clear();state.sel.clear();bmpCache.clear();
  relayoutNow();renderFilm();
};

/* ═════════════════════════ editor modal ═════════════════════════ */
const editor={pid:null,token:0};
function includedList(){return state.photos.filter(p=>p.included);}
function openEditor(pid){
  const p=state.P.get(pid);if(!p)return;
  editor.pid=pid;$("#modal").hidden=false;
  const fm=frameMM();
  $("#mCropSec").style.display=(fm&&fm.cover)?"":"none";
  $("#mHint").style.display=(fm&&fm.cover)?"":"none";
  $("#mCapSec").style.display=state.mode==="polaroid"?"":"none";
  syncEditorControls();editorDraw();
}
function closeEditor(){$("#modal").hidden=true;editor.pid=null;}
function syncEditorControls(){
  const p=state.P.get(editor.pid);if(!p)return;
  const list=includedList(),idx=list.findIndex(q=>q.id===p.id);
  $("#mName").textContent=p.name;
  $("#mIdx").textContent=idx>=0?`${idx+1} / ${list.length}`:"hidden";
  const set=(id,v,suf)=>{$("#"+id).value=v;$("#"+id+"v").textContent=v+suf;};
  set("mB",p.adj.b,"%");set("mC",p.adj.c,"%");set("mS",p.adj.s,"%");set("mSH",p.adj.sh,"%");set("mR",p.adj.r,"");$("#mRv").textContent=(p.adj.r/10).toFixed(1);
  set("mZoom",Math.round(p.crop.z*100),"%");
  $("#mCap").value=p.caption||"";
  $("#mInc").checked=p.included;
}
async function editorDraw(){
  const p=state.P.get(editor.pid);if(!p)return;
  const token=++editor.token;
  const stage=$("#mStage"),cv=$("#mCanvas"),ctx=cv.getContext("2d",{willReadFrequently:true});
  const fm=frameMM();
  const dims=imageDims(p),turn=(p.rotation||0)%2!==0,rot=rotationDeg(p);
  const ar=fm?fm.w/fm.h:dims.w/dims.h;
  const bw=stage.clientWidth-36,bh=stage.clientHeight-46;
  let cw=Math.min(bw,bh*ar),ch=cw/ar;
  const D=dpr();
  cv.style.width=cw+"px";cv.style.height=ch+"px";
  cv.width=Math.round(cw*D);cv.height=Math.round(ch*D);
  const fw=fm?fm.w:100*ar, fh=fm?fm.h:100;       // frame in mm
  const Km=cw/fw;                                 // px per mm
  const cover=fm&&fm.cover;
  let dw,dh,left,top;
  if(cover){const g=coverGeom(p,fw,fh,p.crop.z);dw=g.dw*Km;dh=g.dh*Km;left=g.left*Km;top=g.top*Km;}
  else{const s=Math.min(cw/dims.w,ch/dims.h);dw=dims.w*s;dh=dims.h*s;left=(cw-dw)/2;top=(ch-dh)/2;}
  ctx.setTransform(D,0,0,D,0,0);
  ctx.fillStyle="#1c1f26";ctx.fillRect(0,0,cw,ch);
  const bmp=await getBitmap(p,Math.max(dw,dh)*D);
  if(token!==editor.token)return;
  const srcW=turn?dh:dw,srcH=turn?dw:dh;
  const capPx=Math.min(1,Math.sqrt(16e6/(srcW*srcH)));
  const ow=Math.max(4,Math.round(srcW*capPx)),oh=Math.max(4,Math.round(srcH*capPx));
  const off=document.createElement("canvas");off.width=ow;off.height=oh;
  const octx=off.getContext("2d",{willReadFrequently:p.adj.sh>0||!CANVAS_FILTER});
  if(CANVAS_FILTER)octx.filter=adjCss(p);
  octx.drawImage(bmp,0,0,ow,oh);
  if(CANVAS_FILTER)octx.filter="none";
  if(!CANVAS_FILTER&&adjActive(p))pixelAdjust(octx,ow,oh,p.adj);
  if(p.adj.sh>0)unsharpCanvas(off,p.adj.sh/100,Math.max(0.6,sharpPx(p.adj.r,Km*capPx)));
  ctx.imageSmoothingQuality="high";
  if(rot){ctx.save();ctx.translate(left+dw/2,top+dh/2);ctx.rotate(rot*Math.PI/180);ctx.drawImage(off,-srcW/2,-srcH/2,srcW,srcH);ctx.restore();}
  else ctx.drawImage(off,left,top,dw,dh);
  ctx.strokeStyle="rgba(255,255,255,.14)";ctx.lineWidth=1;
  ctx.strokeRect(left+.5,top+.5,dw-1,dh-1);
  cv._Km=Km;
}
const editorDrawSoon=(()=>{let q=false;return()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;editorDraw();});};})();
/* editor sliders */
[["mB","b","%"],["mC","c","%"],["mS","s","%"],["mSH","sh","%"],["mR","r",""]].forEach(([id,k,suf])=>{
  $("#"+id).addEventListener("input",e=>{
    const p=state.P.get(editor.pid);if(!p)return;
    p.adj[k]=+e.target.value;
    $("#"+id+"v").textContent=k==="r"?(p.adj.r/10).toFixed(1):p.adj[k]+suf;
    updatePhotoVisual(p);editorDrawSoon();
  });
});
$("#mResetAdj").onclick=()=>{const p=state.P.get(editor.pid);if(!p)return;p.adj=DEF_ADJ();syncEditorControls();updatePhotoVisual(p);editorDraw();};
function rotateEditor(dir){const p=state.P.get(editor.pid);if(!p)return;
  p.rotation=((p.rotation||0)+dir+4)%4;clampCrop(p);updatePhotoVisual(p);editorDrawSoon();}
$("#mRotateLeft").onclick=()=>rotateEditor(-1);
$("#mRotateRight").onclick=()=>rotateEditor(1);
$("#mZoom").addEventListener("input",e=>{const p=state.P.get(editor.pid);if(!p)return;
  p.crop.z=clamp(+e.target.value/100,MIN_ZOOM,5);clampCrop(p);
  $("#mZoomv").textContent=Math.round(p.crop.z*100)+"%";updatePhotoVisual(p);editorDrawSoon();});
$("#mResetCrop").onclick=()=>{const p=state.P.get(editor.pid);if(!p)return;p.crop={z:1,x:0,y:0};syncEditorControls();updatePhotoVisual(p);editorDraw();};
$("#mCap").addEventListener("input",e=>{const p=state.P.get(editor.pid);if(!p)return;p.caption=e.target.value;updatePhotoVisual(p);renderFilmDots(p);});
$("#mDateBtn").onclick=()=>{const p=state.P.get(editor.pid);if(!p)return;p.caption=fmtDate(p.dateMs);$("#mCap").value=p.caption;updatePhotoVisual(p);renderFilmDots(p);};
$("#mCapClear").onclick=()=>{const p=state.P.get(editor.pid);if(!p)return;p.caption="";$("#mCap").value="";updatePhotoVisual(p);renderFilmDots(p);};
function renderFilmDots(p){const t=$(`.tile[data-id="${p.id}"]`);if(!t)return;
  const bd=t.querySelector(".bd");bd.innerHTML="";
  if(adjActive(p))bd.appendChild(el("i","adj"));
  if((p.caption||"").trim())bd.appendChild(el("i","capd"));}
$("#mInc").addEventListener("change",e=>{const p=state.P.get(editor.pid);if(!p)return;
  p.included=e.target.checked;relayout();});
function edNav(dir){const list=includedList();if(!list.length)return;
  let i=list.findIndex(q=>q.id===editor.pid);
  i=(i+dir+list.length)%list.length;editor.pid=list[i].id;syncEditorControls();editorDraw();}
$("#mPrev").onclick=()=>edNav(-1);$("#mNext").onclick=()=>edNav(1);
$("#mClose").onclick=$("#mDone").onclick=closeEditor;
$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")closeEditor();});
/* gestures on editor canvas */
(()=>{
  const cv=$("#mCanvas");const pts=new Map();let start=null;
  cv.addEventListener("pointerdown",e=>{cv.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===2){const[a,b]=[...pts.values()];start={d:Math.hypot(a.x-b.x,a.y-b.y),z:state.P.get(editor.pid).crop.z};}});
  cv.addEventListener("pointermove",e=>{
    if(!pts.has(e.pointerId))return;
    const p=state.P.get(editor.pid);if(!p)return;
    const fm=frameMM();if(!(fm&&fm.cover))return;
    const prev=pts.get(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
     if(pts.size===2&&start){const[a,b]=[...pts.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);
       p.crop.z=clamp(start.z*d/start.d,MIN_ZOOM,5);clampCrop(p);
      $("#mZoom").value=Math.round(p.crop.z*100);$("#mZoomv").textContent=Math.round(p.crop.z*100)+"%";
      updatePhotoVisual(p);editorDrawSoon();return;}
    if(pts.size===1){const Km=cv._Km||1;p.crop.x+=(e.clientX-prev.x)/Km;p.crop.y+=(e.clientY-prev.y)/Km;clampCrop(p);
      updatePhotoVisual(p);editorDrawSoon();}
  });
  const up=e=>{pts.delete(e.pointerId);if(pts.size<2)start=null;};
  cv.addEventListener("pointerup",up);cv.addEventListener("pointercancel",up);
  cv.addEventListener("wheel",e=>{e.preventDefault();const p=state.P.get(editor.pid);if(!p)return;
    const fm=frameMM();if(!(fm&&fm.cover))return;
     p.crop.z=clamp(p.crop.z*Math.exp(-e.deltaY*0.0014),MIN_ZOOM,5);clampCrop(p);
    $("#mZoom").value=Math.round(p.crop.z*100);$("#mZoomv").textContent=Math.round(p.crop.z*100)+"%";
    updatePhotoVisual(p);editorDrawSoon();},{passive:false});
  cv.addEventListener("dblclick",()=>{const p=state.P.get(editor.pid);if(!p)return;p.crop={z:1,x:0,y:0};syncEditorControls();updatePhotoVisual(p);editorDraw();});
})();

/* ═════════════════════════ export & print ═════════════════════════ */
function showOv(t){$("#ovTitle").textContent=t;$("#ovBarFill").style.width="0%";$("#ovText").textContent="";$("#overlay").hidden=false;}
function ovSet(i,n,label="sheet"){$("#ovBarFill").style.width=(n?100*i/n:0)+"%";$("#ovText").textContent=`${label} ${i} of ${n}`;}
function hideOv(){$("#overlay").hidden=true;}
async function ensureFonts(){try{await document.fonts.load("600 24px Caveat");await document.fonts.ready;}catch(e){}}
async function renderPageCanvas(pg,dpi,withGuides){
  const K=dpi/MM_IN;
  const cv=document.createElement("canvas");
  cv.width=Math.round(pg.w*K);cv.height=Math.round(pg.h*K);
  const ctx=cv.getContext("2d");
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,cv.width,cv.height);
  for(const f of pg.frames){
    const p=state.P.get(f.pid);if(!p)continue;
    const r=f.img,dims=imageDims(p),turn=(p.rotation||0)%2!==0,rot=rotationDeg(p);let dw,dh,left,top;
    if(f.crop){const g=coverGeom(p,r.w,r.h,p.crop.z);dw=g.dw;dh=g.dh;left=g.left;top=g.top;}
    else{const s=Math.min(r.w/dims.w,r.h/dims.h);dw=dims.w*s;dh=dims.h*s;left=(r.w-dw)/2;top=(r.h-dh)/2;}
    const srcW=turn?dh:dw,srcH=turn?dw:dh;
    const pxW=srcW*K,pxH=srcH*K;
    const capS=Math.min(1,Math.sqrt(20e6/(pxW*pxH)));
    const ow=Math.max(4,Math.round(pxW*capS)),oh=Math.max(4,Math.round(pxH*capS));
    const off=document.createElement("canvas");off.width=ow;off.height=oh;
    const octx=off.getContext("2d",{willReadFrequently:p.adj.sh>0||!CANVAS_FILTER});
    const bmp=await getBitmap(p,Math.max(ow,oh));
    if(CANVAS_FILTER)octx.filter=adjCss(p);
    octx.drawImage(bmp,0,0,ow,oh);
    if(CANVAS_FILTER)octx.filter="none";
    if(!CANVAS_FILTER&&adjActive(p))pixelAdjust(octx,ow,oh,p.adj);
    if(p.adj.sh>0)unsharpCanvas(off,p.adj.sh/100,Math.max(0.6,sharpPx(p.adj.r,K*capS)));
    ctx.save();ctx.beginPath();ctx.rect(r.x*K,r.y*K,r.w*K,r.h*K);ctx.clip();
    ctx.imageSmoothingQuality="high";
    if(rot){ctx.save();ctx.translate((r.x+left+dw/2)*K,(r.y+top+dh/2)*K);ctx.rotate(rot*Math.PI/180);ctx.drawImage(off,-pxW/2,-pxH/2,pxW,pxH);ctx.restore();}
    else ctx.drawImage(off,(r.x+left)*K,(r.y+top)*K,pxW,pxH);
    ctx.restore();
    if(f.cap){const t=capText(p);
      if(t){const fs=Math.min(f.cap.h*K*0.62,f.cap.w*K/(Math.max(3,t.length)*0.42));
        ctx.font=`600 ${fs}px Caveat, cursive`;ctx.fillStyle="#3a3a38";
        ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText(t,(f.cap.x+f.cap.w/2)*K,(f.cap.y+f.cap.h/2)*K);}}
  }
  if(withGuides)drawGuides(ctx,pg,K,pg.w,pg.h);
  return cv;
}
$("#btnPrint").onclick=async()=>{
  const L=state.layout;if(!L||!L.pages.length)return toast("Nothing to print yet");
  showOv("Rendering sheets");await ensureFonts();
  const imgs=[];
  for(let i=0;i<L.pages.length;i++){
    ovSet(i+1,L.pages.length);
    const cv=await renderPageCanvas(L.pages[i],state.dpi,state.guides.on);
    imgs.push(cv.toDataURL("image/jpeg",0.92));await sleep(15);
  }
  hideOv();
  const win=window.open("","_blank");
  if(!win)return toast("Rendering complete, but the print tab was blocked — allow popups to print");
  const w=L.W.toFixed(1),h=L.H.toFixed(1);
  let printStarted=false;
  const startPrint=()=>{if(printStarted||win.closed)return;printStarted=true;win.focus();win.print();};
  win.addEventListener("load",()=>setTimeout(startPrint,150),{once:true});
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>SNAPSHEET print</title><style>
    @page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;background:#fff}
    img{display:block;width:${w}mm;height:${h}mm;page-break-after:always}img:last-child{page-break-after:auto}
    .tip{position:fixed;z-index:9;top:10px;left:50%;transform:translateX(-50%);font:600 12px/1.4 system-ui;background:#111;color:#ffc832;padding:8px 14px;border-radius:8px}
    @media print{.tip{display:none}}</style></head><body>
    <div class="tip">Print at <b>Actual size / 100%</b> with margins OFF — paper ${Math.round(L.W)}×${Math.round(L.H)} mm</div>
     ${imgs.map(s=>`<img src="${s}">`).join("")}</body></html>`);
  win.document.close();
  setTimeout(startPrint,1200);
  toast("Rendered — choose “Actual size” in the print dialog");
};
$("#btnExport").onclick=e=>{e.stopPropagation();$("#exportMenu").classList.toggle("open");$("#helpMenu").classList.remove("open");};
$("#btnHelp").onclick=e=>{e.stopPropagation();$("#helpMenu").classList.toggle("open");$("#exportMenu").classList.remove("open");};
document.addEventListener("click",()=>{$("#exportMenu").classList.remove("open");$("#helpMenu").classList.remove("open");});
$("#exportMenu").addEventListener("click",async e=>{
  const b=e.target.closest("[data-fmt]");if(!b)return;
   const fmt=b.dataset.fmt,L=state.layout;
   if(!L||!L.pages.length)return;
   if(fmt==="pdf"&&!window.jspdf?.jsPDF)return toast("PDF export is unavailable — check your connection");
   $("#exportMenu").classList.remove("open");
   showOv("Exporting sheets");await ensureFonts();
   const isPdf=fmt==="pdf",orientation=L.W>=L.H?"landscape":"portrait";
   const pdf=isPdf?new window.jspdf.jsPDF({orientation,unit:"mm",format:[L.W,L.H],compress:true}):null;
   const mime=fmt==="png"?"image/png":"image/jpeg",ext=fmt==="png"?"png":"jpg";
   for(let i=0;i<L.pages.length;i++){
     ovSet(i+1,L.pages.length);
     const cv=await renderPageCanvas(L.pages[i],state.dpi,state.guides.on);
     if(isPdf){
       if(i)pdf.addPage([L.W,L.H],orientation);
       pdf.addImage(cv.toDataURL("image/jpeg",.92),"JPEG",0,0,L.W,L.H,undefined,"FAST");
     }else{
       const blob=await new Promise(r=>cv.toBlob(r,mime,0.92));
       const a=document.createElement("a");a.href=URL.createObjectURL(blob);
       a.download=`snapsheet-${state.page.size}-${i+1}of${L.pages.length}.${ext}`;
       document.body.appendChild(a);a.click();a.remove();
       setTimeout(()=>URL.revokeObjectURL(a.href),4000);
       await sleep(200);
     }
   }
   if(isPdf)pdf.save(`snapsheet-${state.page.size}.pdf`);
   hideOv();toast(isPdf?"PDF downloaded":"Sheets downloaded — print at actual size");
 });

/* ═════════════════════════ batch adjust & presets ═════════════════════════ */
function targetsFor(announce=true){
  let list;
  if(state.target==="sel"){list=state.photos.filter(p=>state.sel.has(p.id)&&p.included);
    if(!list.length){list=state.photos.filter(p=>p.included);if(announce)toast("No photos selected — applied to all");}}
  else list=state.photos.filter(p=>p.included);
  return list;
}
function batchAdj(){return{b:+$("#bB").value,c:+$("#bC").value,s:+$("#bS").value,sh:+$("#bSH").value,r:+$("#bR").value};}
function syncBatchControls(adj){
  [["bB",adj.b,"%"],["bC",adj.c,"%"],["bS",adj.s,"%"],["bSH",adj.sh,"%"],["bR",adj.r,""]].forEach(([id,v,suf])=>{
    $("#"+id).value=v;$("#"+id+"v").textContent=id==="bR"?(v/10).toFixed(1):v+suf;syncRangeEntry(id);
  });
}
function applyBatchAdjustments(){
  const adj=batchAdj(),list=targetsFor(false);
  list.forEach(p=>p.adj={...adj});
  list.forEach(updatePhotoVisual);
  list.forEach(renderFilmDots);
}
$("#btnLoadSel").onclick=()=>{
  const p=state.photos.find(q=>state.sel.has(q.id))||state.photos.find(q=>q.included);
  if(!p)return toast("Nothing to load from");
  const set=(id,v)=>{$("#"+id).value=v;};
  set("bB",p.adj.b);$("#bBv").textContent=p.adj.b+"%";
  set("bC",p.adj.c);$("#bCv").textContent=p.adj.c+"%";
  set("bS",p.adj.s);$("#bSv").textContent=p.adj.s+"%";
  set("bSH",p.adj.sh);$("#bSHv").textContent=p.adj.sh+"%";
  set("bR",p.adj.r);$("#bRv").textContent=(p.adj.r/10).toFixed(1);["bB","bC","bS","bSH","bR"].forEach(syncRangeEntry);
  saveSettings();toast("Loaded adjustments from "+p.name);
};
[["bB","%"],["bC","%"],["bS","%"],["bSH","%"]].forEach(([id,suf])=>{
  $("#"+id).addEventListener("input",e=>{$("#"+id+"v").textContent=e.target.value+suf;applyBatchAdjustments();});});
$("#bR").addEventListener("input",e=>{$("#bRv").textContent=(e.target.value/10).toFixed(1);applyBatchAdjustments();});
/* presets */
const DEFAULT_PRESETS=[
  {name:"Phone print lift",adj:{b:108,c:106,s:112,sh:18,r:10}},
  {name:"Matte paper pop",adj:{b:106,c:112,s:116,sh:24,r:12}}
];
let presets=[];
try{presets=JSON.parse(localStorage.getItem("snapsheet-presets")||"[]");}catch(e){presets=[];}
if(!Array.isArray(presets))presets=[];
DEFAULT_PRESETS.slice().reverse().forEach(pr=>{if(!presets.some(p=>p.name===pr.name))presets.unshift({...pr,adj:{...pr.adj}});});
function savePresets(){try{localStorage.setItem("snapsheet-presets",JSON.stringify(presets));}catch(e){}}
function renderPresets(){
  const w=$("#presetChips");w.innerHTML="";
  if(!presets.length){w.innerHTML='<span style="font:11px var(--mono);color:var(--tx3)">none saved yet</span>';return;}
  presets.forEach((pr,i)=>{
    const c=el("button","chip");
    c.innerHTML=`<span>${pr.name.replace(/</g,"&lt;")}</span><span class="x" title="Delete">✕</span>`;
    c.addEventListener("click",e=>{
      if(e.target.classList.contains("x")){presets.splice(i,1);savePresets();renderPresets();return;}
      const adj={...pr.adj};const list=targetsFor();
      list.forEach(p=>p.adj={...adj});list.forEach(updatePhotoVisual);list.forEach(renderFilmDots);
      syncBatchControls(adj);saveSettings();
      toast(`Preset “${pr.name}” → ${list.length} photos`);
    });
    w.appendChild(c);
  });
}
$("#btnSavePreset").onclick=()=>{
  const name=$("#presetName").value.trim();
  if(!name)return toast("Give the preset a name");
  presets=presets.filter(p=>p.name!==name);
  presets.push({name,adj:batchAdj()});savePresets();renderPresets();
  $("#presetName").value="";toast(`Preset “${name}” saved`);
};

/* ═════════════════════════ UI wiring ═════════════════════════ */
function segBind(sel,cb){$(sel).addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  $$(sel+" button").forEach(x=>x.classList.remove("on"));b.classList.add("on");cb(b);saveSettings();});}
segBind("#modeSeg",b=>{state.mode=b.dataset.mode;
  $("#optFlow").hidden=state.mode!=="flow";
  $("#optPolaroid").hidden=state.mode!=="polaroid";
  $("#optGrid").hidden=state.mode!=="grid";relayout();});
segBind("#gFitSeg",b=>{state.grid.fit=b.dataset.fit;relayout();});
segBind("#orientSeg",b=>{state.page.orient=b.dataset.o;relayout();});
segBind("#gdStyleSeg",b=>{state.guides.style=b.dataset.s;renderPages();});
segBind("#targetSeg",b=>{state.target=b.dataset.t;});
$("#gdColors").addEventListener("click",e=>{const b=e.target.closest(".sw");if(!b)return;
  $$("#gdColors .sw").forEach(x=>x.classList.remove("on"));b.classList.add("on");
  state.guides.color=b.dataset.c;renderPages();saveSettings();});
function mmRange(id,key,after){$("#"+id).addEventListener("input",e=>{
  $("#"+id+"v").textContent=e.target.value+"mm";
  key(+e.target.value);if(after)after();relayout();});}
mmRange("fMaxW",v=>state.flow.maxW=v);
mmRange("fMaxH",v=>state.flow.maxH=v);
mmRange("pW",v=>state.pol.pw=v);
mmRange("pH",v=>state.pol.ph=v);
mmRange("pBand",v=>state.pol.band=v);
mmRange("pPad",v=>state.pol.pad=v);
mmRange("gCW",v=>state.grid.cw=v);
mmRange("gCH",v=>state.grid.ch=v);
mmRange("pgMargin",v=>state.page.margin=v);
mmRange("pgGap",v=>state.page.gap=v);
function sizeChipBind(sel,wKey,hKey){$(sel).addEventListener("click",e=>{const b=e.target.closest(".chip");if(!b)return;
  state[wKey][hKey[0]]=+b.dataset.w;state[wKey][hKey[1]]=+b.dataset.h;
  const ids=wKey==="flow"?["fMaxW","fMaxH"]:["gCW","gCH"];
  $("#"+ids[0]).value=state[wKey][hKey[0]];$("#"+ids[0]+"v").textContent=state[wKey][hKey[0]]+"mm";
  $("#"+ids[1]).value=state[wKey][hKey[1]];$("#"+ids[1]+"v").textContent=state[wKey][hKey[1]]+"mm";ids.forEach(syncRangeEntry);relayout();saveSettings();});}
sizeChipBind("#flowChips","flow",["maxW","maxH"]);
sizeChipBind("#gridChips","grid",["cw","ch"]);
$("#fRotate").addEventListener("change",e=>{state.flow.rotate=e.target.checked;relayout();});
$("#pBorder").addEventListener("change",e=>{state.pol.border=e.target.checked;relayout();});
$("#pDates").addEventListener("change",e=>{state.pol.dates=e.target.checked;renderPages();});
$("#polChips").addEventListener("click",e=>{const b=e.target.closest(".chip");if(!b)return;
  state.pol.pw=+b.dataset.w;state.pol.ph=+b.dataset.h;
  $("#pW").value=state.pol.pw;$("#pWv").textContent=state.pol.pw+"mm";
  $("#pH").value=state.pol.ph;$("#pHv").textContent=state.pol.ph+"mm";["pW","pH"].forEach(syncRangeEntry);relayout();saveSettings();});
$("#pgSize").addEventListener("change",e=>{
  state.page.size=e.target.value;
  $("#customDims").hidden=e.target.value!=="custom";
  if(SIZES[e.target.value]){[state.page.w,state.page.h]=SIZES[e.target.value];}
  relayout();});
$("#pgCW").addEventListener("input",e=>{state.page.w=clamp(+e.target.value||210,40,600);relayout();});
$("#pgCH").addEventListener("input",e=>{state.page.h=clamp(+e.target.value||297,40,600);relayout();});
$("#pgDpi").addEventListener("change",e=>{state.dpi=+e.target.value;
  $("#dpiNote").textContent=`Rendered at ${state.dpi} dpi — print at “actual size”, margins off.`;});
$("#gdOn").addEventListener("change",e=>{state.guides.on=e.target.checked;renderPages();});
$("#gdPreview").addEventListener("change",e=>{state.guides.preview=e.target.checked;renderPages();});
const RANGE_IDS=["fMaxW","fMaxH","pW","pH","pBand","pPad","gCW","gCH","pgMargin","pgGap","bB","bC","bS","bSH","bR","mB","mC","mS","mSH","mR","mZoom"];
function syncRangeEntry(id){const input=$("#"+id),entry=input?.parentElement.querySelector(".rangeEntry");if(entry)entry.value=input.value;}
function enhanceRanges(){RANGE_IDS.forEach(id=>{const input=$("#"+id);if(!input||input.dataset.enhanced)return;
  const val=$("#"+id+"v"),tools=el("span","rangeTools"),minus=document.createElement("button"),plus=document.createElement("button"),entry=document.createElement("input");
  input.dataset.enhanced="1";minus.type=plus.type="button";minus.textContent="−";plus.textContent="+";minus.setAttribute("aria-label","Decrease value");plus.setAttribute("aria-label","Increase value");
  entry.type="number";entry.className="rangeEntry";entry.min=input.min;entry.max=input.max;entry.step=input.step||"1";entry.value=input.value;entry.setAttribute("aria-label",id+" value");
  const setValue=v=>{input.value=clamp(+v,+input.min,+input.max);input.dispatchEvent(new Event("input",{bubbles:true}));};
  minus.onclick=()=>setValue(+input.value-(+input.step||1));plus.onclick=()=>setValue(+input.value+(+input.step||1));
  entry.addEventListener("change",()=>setValue(entry.value));entry.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();entry.blur();}});
  input.addEventListener("input",()=>{entry.value=input.value;});
  input.after(tools);tools.append(minus,plus,entry,val);
 });}
function restoreControls(){
  const mark=(sel,attr,value)=>{$$(sel+" button").forEach(b=>b.classList.toggle("on",b.dataset[attr]===value));};
  mark("#modeSeg","mode",state.mode);$("#optFlow").hidden=state.mode!=="flow";$("#optPolaroid").hidden=state.mode!=="polaroid";$("#optGrid").hidden=state.mode!=="grid";
  const setRange=(id,value,suffix)=>{$("#"+id).value=value;$("#"+id+"v").textContent=value+suffix;};
  setRange("fMaxW",state.flow.maxW,"mm");setRange("fMaxH",state.flow.maxH,"mm");$("#fRotate").checked=state.flow.rotate;
  setRange("pW",state.pol.pw,"mm");setRange("pH",state.pol.ph,"mm");setRange("pBand",state.pol.band,"mm");setRange("pPad",state.pol.pad,"mm");$("#pBorder").checked=state.pol.border;$("#pDates").checked=state.pol.dates;
  setRange("gCW",state.grid.cw,"mm");setRange("gCH",state.grid.ch,"mm");mark("#gFitSeg","fit",state.grid.fit);
  $("#pgSize").value=state.page.size;$("#customDims").hidden=state.page.size!=="custom";$("#pgCW").value=state.page.w;$("#pgCH").value=state.page.h;
  mark("#orientSeg","o",state.page.orient);setRange("pgMargin",state.page.margin,"mm");setRange("pgGap",state.page.gap,"mm");$("#pgDpi").value=state.dpi;$("#dpiNote").textContent=`Rendered at ${state.dpi} dpi — print at “actual size”, margins off.`;
  $("#gdOn").checked=state.guides.on;$("#gdPreview").checked=state.guides.preview;mark("#gdStyleSeg","s",state.guides.style);$$("#gdColors .sw").forEach(b=>b.classList.toggle("on",b.dataset.c===state.guides.color));
  mark("#targetSeg","t",state.target);
  const adj=savedSettings?.adjust||{};
  if(Number.isFinite(adj.b))setRange("bB",adj.b,"%");if(Number.isFinite(adj.c))setRange("bC",adj.c,"%");if(Number.isFinite(adj.s))setRange("bS",adj.s,"%");if(Number.isFinite(adj.sh))setRange("bSH",adj.sh,"%");if(Number.isFinite(adj.r)){setRange("bR",adj.r,"");$("#bRv").textContent=(adj.r/10).toFixed(1);}
  $$(".sec").forEach(s=>s.classList.toggle("closed",(savedSettings?.closed||[]).includes(s.id)));
}
$$(".sec>h3").forEach(h=>h.addEventListener("click",()=>{h.parentElement.classList.toggle("closed");saveSettings();}));
document.addEventListener("input",e=>{if(e.target.closest("#panel")&&e.target.matches("input[type=range],input[type=number]"))saveSettings();});
document.addEventListener("change",e=>{if(e.target.closest("#panel")&&e.target.matches("input,select"))saveSettings();});
/* panel drawer (mobile) */
$("#btnControls").onclick=()=>document.body.classList.toggle("panelOpen");
$("#backdrop").onclick=()=>document.body.classList.remove("panelOpen");
/* file input / drop / paste */
$("#fileInput").addEventListener("change",e=>{queueImport(e.target.files);e.target.value="";});
["dragenter","dragover"].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();$("#dropZone").classList.add("over");}));
["dragleave","drop"].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();if(ev==="drop"&&e.dataTransfer.files.length)queueImport(e.dataTransfer.files);$("#dropZone").classList.remove("over");}));
document.addEventListener("paste",e=>{
  const items=[...(e.clipboardData?.items||[])].filter(i=>i.kind==="file");
  if(items.length)queueImport(items.map(i=>i.getAsFile()));
});
$("#btnPaste").onclick=async()=>{
  try{const items=await navigator.clipboard.read();const files=[];
    for(const it of items)for(const t of it.types)if(t.startsWith("image/"))files.push(await it.getType(t));
    files.length?queueImport(files):toast("Clipboard has no image — copy one first");}
  catch(err){toast("Clipboard unavailable — use Ctrl/Cmd+V");}
};
/* keyboard */
document.addEventListener("keydown",e=>{
  if(!$("#modal").hidden){
    if(e.key==="Escape")closeEditor();
    if(e.key==="ArrowLeft")edNav(-1);
    if(e.key==="ArrowRight")edNav(1);
    return;
  }
  if(e.key==="Escape")document.body.classList.remove("panelOpen");
});
window.addEventListener("resize",debounce(()=>{if(state.layout&&state.photos.length)renderPages();},160));

/* init */
loadSettings();
restoreControls();
enhanceRanges();
renderPresets();
relayoutNow();
renderFilm();
