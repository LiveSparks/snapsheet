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
  ff:{snap:true,grid:0,show:true,unit:"mm",po:"auto",alignTo:"sel",orient:"portrait"},
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
  if(["flow","polaroid","grid","freeform"].includes(savedSettings.mode))state.mode=savedSettings.mode;
  mergeSettings(state.page,savedSettings.page);mergeSettings(state.flow,savedSettings.flow);mergeSettings(state.pol,savedSettings.pol);mergeSettings(state.grid,savedSettings.grid);mergeSettings(state.guides,savedSettings.guides);mergeSettings(state.ff,savedSettings.ff);
  if(Number.isFinite(savedSettings.dpi))state.dpi=savedSettings.dpi;
  if(savedSettings.target==="sel"||savedSettings.target==="all")state.target=savedSettings.target;
}
function settingsSnapshot(){return{mode:state.mode,page:{...state.page},flow:{...state.flow},pol:{...state.pol},grid:{...state.grid},guides:{...state.guides},ff:{...state.ff},dpi:state.dpi,target:state.target,
  adjust:batchAdj(),closed:$$(".sec").filter(s=>s.classList.contains("closed")).map(s=>s.id)};}
const saveSettings=debounce(()=>{try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settingsSnapshot()));}catch(e){}},140);
const DEF_ADJ=()=>({b:100,c:100,s:100,sh:0,r:10});
const adjActive=p=>p.adj.b!==100||p.adj.c!==100||p.adj.s!==100||p.adj.sh>0;
const adjCss=p=>`brightness(${p.adj.b}%) contrast(${p.adj.c}%) saturate(${p.adj.s}%)`;
const fmtDate=ms=>{const d=new Date(ms);const z=n=>String(n).padStart(2,"0");return `${z(d.getDate())}.${z(d.getMonth()+1)}.${d.getFullYear()}`};
const capText=p=>{const c=(p.caption||"").trim(); if(c)return c; return state.pol.dates?fmtDate(p.dateMs):""};
function frameMM(p){ if(state.mode==="freeform")return p&&p.ff?{w:p.ff.w,h:p.ff.h,cover:true}:null;
  if(state.mode==="polaroid")return{w:state.pol.pw,h:state.pol.ph,cover:true};
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
/* drop every cached full-resolution bitmap (after an export they can hold hundreds of MB) */
function releaseBitmaps(){bmpCache.forEach(c=>{if(c.bmp&&c.bmp.close)try{c.bmp.close()}catch(e){}});bmpCache.clear();}
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
    printBlob:(blob!==file)?blob:file, workBlob, thumbBlob, thumbURL:URL.createObjectURL(thumbBlob),
    adj:DEF_ADJ(),crop:{z:1,x:0,y:0},rotation:0,caption:"",included:true};
  state.photos.push(p);state.P.set(p.id,p);
  await persistPhotoBlobs(p);
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
  if(state.mode==="freeform")return layFreeform(photos,W,H);
  return layGrid(photos,W,H);
}
function computeLayout(){
  const inc=state.photos.filter(p=>p.included);
  let[w,h]=SIZES[state.page.size]||[state.page.w,state.page.h];
  if(state.page.size==="custom"){w=state.page.w;h=state.page.h;}
  const orients=state.mode==="freeform"?[ffOrient()]:state.page.orient==="auto"?["portrait","landscape"]:[state.page.orient];
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
  const fm=frameMM(p); if(!fm||!fm.cover)return;
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
  const wrap=$("#pagesWrap");frameMap.clear();wrap.innerHTML="";wrap.classList.toggle("ff",isFF());
  const has=state.photos.length>0;
  $("#empty").style.display=has?"none":"";
  if(!has){scheduleSave();return;}
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
    const page=el("div","page");page.dataset.pi=i;
    page.style.width=L.W*K+"px";page.style.height=L.H*K+"px";
    pg.frames.forEach(f=>{
      const p=state.P.get(f.pid);if(!p)return;
      const b=document.createElement("button");b.type="button";b.className="frame";b.title=p.name;b.dataset.pid=p.id;
      b.style.cssText=`left:${f.img.x*K}px;top:${f.img.y*K}px;width:${f.img.w*K}px;height:${f.img.h*K}px`;
      const img=new Image();img.alt="";img.src=p.thumbURL;img.draggable=false;
      applyFrameImg(img,p,f,K);b.appendChild(img);
      b.addEventListener("click",()=>{if(!isFF())openEditor(p.id);});
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
  if(isFF())ffDecorate();
  updateStats();scheduleSave();
}
function updatePhotoVisual(p){
  (frameMap.get(p.id)||[]).forEach(e=>{applyFrameImg(e.img,p,e.f,curK());if(e.capEl)setCapEl(e.capEl,p,e.f,curK());});
  scheduleSave();
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
  stripCounts();scheduleSave();
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
    t.classList.toggle("sel",state.sel.has(p.id));ffRefreshSel();return;}
  if(!p.included){p.included=true;relayout();renderFilm();return;}
  openEditor(p.id);
});
$("#btnSelAll").onclick=()=>{state.photos.forEach(p=>state.sel.add(p.id));renderFilm();ffRefreshSel();};
$("#btnSelNone").onclick=()=>{state.sel.clear();renderFilm();ffRefreshSel();};
/* "Clear roll" and the top-bar "New" button both start a new project (see persistence) */

/* ═════════════════════════ editor modal ═════════════════════════ */
const editor={pid:null,token:0};
function includedList(){return state.photos.filter(p=>p.included);}
function openEditor(pid){
  const p=state.P.get(pid);if(!p)return;
  editor.pid=pid;$("#modal").hidden=false;
  const fm=frameMM(p);
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
  const fm=frameMM(p);
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
  i=(i+dir+list.length)%list.length;openEditor(list[i].id);}
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
    const fm=frameMM(p);if(!(fm&&fm.cover))return;
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
    const fm=frameMM(p);if(!(fm&&fm.cover))return;
     p.crop.z=clamp(p.crop.z*Math.exp(-e.deltaY*0.0014),MIN_ZOOM,5);clampCrop(p);
    $("#mZoom").value=Math.round(p.crop.z*100);$("#mZoomv").textContent=Math.round(p.crop.z*100)+"%";
    updatePhotoVisual(p);editorDrawSoon();},{passive:false});
  cv.addEventListener("dblclick",()=>{const p=state.P.get(editor.pid);if(!p)return;p.crop={z:1,x:0,y:0};syncEditorControls();updatePhotoVisual(p);editorDraw();});
})();

/* ═════════════════════════ export & print ═════════════════════════ */
function showOv(t){$("#ovTitle").textContent=t;$("#ovBarFill").style.width="0%";$("#ovText").textContent="";$("#overlay").hidden=false;}
function ovSet(i,n,label="sheet"){$("#ovBarFill").style.width=(n?100*i/n:0)+"%";$("#ovText").textContent=`${label} ${i} of ${n}`;}
function hideOv(){$("#overlay").hidden=true;}
/* fonts.load() can stall offline: never wait on it for more than 3 s */
async function ensureFonts(){try{await Promise.race([(async()=>{await document.fonts.load("600 24px Caveat");await document.fonts.ready;})(),sleep(3000)]);}catch(e){}}
/* Canvases are released explicitly: browsers cap total canvas memory (Safari ≈384 MB) and
   only reclaim it on GC, so a long export used to exhaust it and then throw mid-way. */
class ExportError extends Error{}
function freeCanvas(cv){if(cv){cv.width=0;cv.height=0;}}
function makeCanvas(w,h,opts){
  if(w>32767||h>32767||w*h>268e6)throw new ExportError(`A ${w}×${h} px sheet is larger than browsers can draw — choose a lower print quality (dpi).`);
  const cv=document.createElement("canvas");cv.width=w;cv.height=h;
  const ctx=cv.width===w&&cv.height===h?cv.getContext("2d",opts):null;
  if(!ctx){freeCanvas(cv);throw new ExportError(`The browser could not allocate a ${w}×${h} px canvas — choose a lower print quality (dpi).`);}
  return[cv,ctx];
}
function canvasToBlob(cv,mime,q){return new Promise((res,rej)=>cv.toBlob(b=>b?res(b):rej(new ExportError("The browser ran out of memory encoding a sheet — choose a lower print quality (dpi).")),mime,q));}
async function renderPageCanvas(pg,dpi,withGuides){
  const K=dpi/MM_IN;
  const[cv,ctx]=makeCanvas(Math.round(pg.w*K),Math.round(pg.h*K));
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,cv.width,cv.height);
  /* an over-sized canvas can be created yet silently refuse to draw: probe its far corner */
  if(ctx.getImageData(cv.width-1,cv.height-1,1,1).data[3]!==255){const dims=`${cv.width}×${cv.height}`;freeCanvas(cv);
    throw new ExportError(`A ${dims} px sheet exceeds this browser's canvas limit — choose a lower print quality (dpi).`);}
  try{
    for(const f of pg.frames){
      const p=state.P.get(f.pid);if(!p)continue;
      const r=f.img,dims=imageDims(p),turn=(p.rotation||0)%2!==0,rot=rotationDeg(p);let dw,dh,left,top;
      if(f.crop){const g=coverGeom(p,r.w,r.h,p.crop.z);dw=g.dw;dh=g.dh;left=g.left;top=g.top;}
      else{const s=Math.min(r.w/dims.w,r.h/dims.h);dw=dims.w*s;dh=dims.h*s;left=(r.w-dw)/2;top=(r.h-dh)/2;}
      const srcW=turn?dh:dw,srcH=turn?dw:dh;
      const pxW=srcW*K,pxH=srcH*K;
      const capS=Math.min(1,Math.sqrt(20e6/(pxW*pxH)));
      const ow=Math.max(4,Math.round(pxW*capS)),oh=Math.max(4,Math.round(pxH*capS));
      const bmp=await getBitmap(p,Math.max(ow,oh));
      const[off,octx]=makeCanvas(ow,oh,{willReadFrequently:p.adj.sh>0||!CANVAS_FILTER});
      try{
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
      }finally{freeCanvas(off);}
      if(f.cap){const t=capText(p);
        if(t){const fs=Math.min(f.cap.h*K*0.62,f.cap.w*K/(Math.max(3,t.length)*0.42));
          ctx.font=`600 ${fs}px Caveat, cursive`;ctx.fillStyle="#3a3a38";
          ctx.textAlign="center";ctx.textBaseline="middle";
          ctx.fillText(t,(f.cap.x+f.cap.w/2)*K,(f.cap.y+f.cap.h/2)*K);}}
      await sleep(0);
    }
    if(withGuides)drawGuides(ctx,pg,K,pg.w,pg.h);
  }catch(e){freeCanvas(cv);throw e;}
  return cv;
}
/* render every sheet one at a time, handing each encoded blob to `take`; always clears the overlay */
let exportBusy=false;
async function renderSheets(title,mime,q,take){
  if(exportBusy){toast("Already rendering — please wait");return false;}
  const L=state.layout;exportBusy=true;showOv(title);
  try{
    await ensureFonts();
    for(let i=0;i<L.pages.length;i++){
      ovSet(i+1,L.pages.length);await sleep(0);
      const cv=await renderPageCanvas(L.pages[i],state.dpi,state.guides.on);
      let blob;try{blob=await canvasToBlob(cv,mime,q);}finally{freeCanvas(cv);}
      await take(blob,i,L);
    }
    return true;
  }catch(e){
    console.error(e);
    toast(e instanceof ExportError?e.message:`Rendering failed (${e&&e.message||e}) — try a lower print quality or fewer sheets.`);
    return false;
  }finally{releaseBitmaps();hideOv();exportBusy=false;}
}
$("#btnPrint").onclick=async()=>{
  const L=state.layout;if(!L||!L.pages.length)return toast("Nothing to print yet");
  if(exportBusy)return toast("Already rendering — please wait");
  const urls=[],revoke=()=>urls.forEach(u=>URL.revokeObjectURL(u));
  /* open the tab synchronously, inside the click, so popup blockers allow it */
  const win=window.open("","_blank");
  if(win)win.document.write('<p style="font:14px system-ui;padding:20px">Rendering sheets…</p>');
  const ok=await renderSheets("Rendering sheets","image/jpeg",0.92,blob=>{urls.push(URL.createObjectURL(blob));});
  if(!ok){revoke();if(win&&!win.closed)win.close();return;}
  if(!win||win.closed){revoke();return toast("Rendering complete, but the print tab was blocked — allow popups to print");}
  const w=L.W.toFixed(1),h=L.H.toFixed(1);
  let printStarted=false;
  const startPrint=()=>{if(printStarted||win.closed)return;printStarted=true;win.focus();win.print();};
  win.document.open();
  win.addEventListener("load",()=>setTimeout(startPrint,150),{once:true});
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>SNAPSHEET print</title><style>
    @page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;background:#fff}
    img{display:block;width:${w}mm;height:${h}mm;page-break-after:always}img:last-child{page-break-after:auto}
    .tip{position:fixed;z-index:9;top:10px;left:50%;transform:translateX(-50%);font:600 12px/1.4 system-ui;background:#111;color:#ffc832;padding:8px 14px;border-radius:8px}
    @media print{.tip{display:none}}</style></head><body>
    <div class="tip">Print at <b>Actual size / 100%</b> with margins OFF — paper ${Math.round(L.W)}×${Math.round(L.H)} mm</div>
     ${urls.map(s=>`<img src="${s}">`).join("")}</body></html>`);
  win.document.close();
  setTimeout(startPrint,1200);
  const watch=setInterval(()=>{if(win.closed){clearInterval(watch);revoke();}},5000);
  toast("Rendered — choose “Actual size” in the print dialog");
};
$("#btnExport").onclick=e=>{e.stopPropagation();$("#exportMenu").classList.toggle("open");$("#helpMenu").classList.remove("open");};
$("#btnHelp").onclick=e=>{e.stopPropagation();$("#helpMenu").classList.toggle("open");$("#exportMenu").classList.remove("open");};
document.addEventListener("click",()=>{$("#exportMenu").classList.remove("open");$("#helpMenu").classList.remove("open");});
function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);}
$("#exportMenu").addEventListener("click",async e=>{
  const b=e.target.closest("[data-fmt]");if(!b)return;
  const fmt=b.dataset.fmt,L=state.layout;
  if(!L||!L.pages.length)return;
  if(fmt==="pdf"&&!window.jspdf?.jsPDF)return toast("PDF export is unavailable — check your connection");
  $("#exportMenu").classList.remove("open");
  const isPdf=fmt==="pdf",orientation=L.W>=L.H?"landscape":"portrait";
  const pdf=isPdf?new window.jspdf.jsPDF({orientation,unit:"mm",format:[L.W,L.H],compress:true}):null;
  const mime=fmt==="png"?"image/png":"image/jpeg",ext=fmt==="png"?"png":"jpg";
  const ok=await renderSheets("Exporting sheets",mime,0.92,async(blob,i)=>{
    if(isPdf){
      if(i)pdf.addPage([L.W,L.H],orientation);
      /* raw JPEG bytes (not a base64 data URL) with an explicit alias, so jsPDF neither
         keeps a 33 % larger string per sheet nor hashes every image to de-duplicate it */
      pdf.addImage(new Uint8Array(await blob.arrayBuffer()),"JPEG",0,0,L.W,L.H,"sheet"+i,"FAST");
    }else{
      downloadBlob(blob,`snapsheet-${state.page.size}-${i+1}of${L.pages.length}.${ext}`);
      await sleep(200);
    }
  });
  if(!ok)return;
  if(isPdf){
    showOv("Saving PDF");await sleep(30);
    try{downloadBlob(pdf.output("blob"),`snapsheet-${state.page.size}.pdf`);}
    catch(err){console.error(err);hideOv();return toast("The PDF was too large to assemble — choose a lower print quality or export fewer sheets.");}
    hideOv();
  }
  toast(isPdf?"PDF downloaded":"Sheets downloaded — print at actual size");
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

/* ═════════════════════════ freeform canvas ═════════════════════════ */
const FF_PRESETS=[
  {n:"Passport",w:35,h:45},{n:"2×2″",w:50.8,h:50.8},{n:"Instax mini",w:46,h:62},{n:"Wallet",w:63.5,h:88.9},
  {n:"3×3″",w:76.2,h:76.2},{n:"3.5×5″",w:88.9,h:127},{n:"4×6″",w:101.6,h:152.4},{n:"A6",w:105,h:148},
  {n:"5×7″",w:127,h:177.8},{n:"A5",w:148,h:210},{n:"6×8″",w:152.4,h:203.2},{n:"8×10″",w:203.2,h:254}];
const FF_SIZES_KEY="snapsheet-ff-sizes",FF_MIN=5,FF_SNAP_PX=7;
let ffUserSizes=[];
try{ffUserSizes=JSON.parse(localStorage.getItem(FF_SIZES_KEY)||"[]");}catch(e){ffUserSizes=[];}
if(!Array.isArray(ffUserSizes))ffUserSizes=[];
const ff={pages:1,z:0,drag:null,undo:[],redo:[],nudgeT:0};
const isFF=()=>state.mode==="freeform";
const ffIncluded=()=>state.photos.filter(p=>p.included&&p.ff);
const ffSelected=()=>state.photos.filter(p=>state.sel.has(p.id)&&p.included&&p.ff);
const ffU=mm=>state.ff.unit==="in"?mm/MM_IN:mm;
const ffFromU=v=>state.ff.unit==="in"?v*MM_IN:v;
const ffFmt=mm=>{const v=ffU(mm);return state.ff.unit==="in"?String(+v.toFixed(2)):String(+v.toFixed(1));};
function ffOrient(){return state.page.orient==="auto"?state.ff.orient:state.page.orient;}

/* ---------- layout ---------- */
function ffDefaultSize(p){const d=imageDims(p),ar=d.w/d.h,L=90;return ar>=1?{w:L,h:L/ar}:{w:L*ar,h:L};}
function ffFit(r,W,H){
  const k=Math.min(1,W/r.w,H/r.h);if(k<1){r.w*=k;r.h*=k;}
  r.x=clamp(r.x,0,W-r.w);r.y=clamp(r.y,0,H-r.h);
}
function ffOverlaps(a,b,g){return a.x<b.x+b.w+g-EPS&&a.x+a.w>b.x-g+EPS&&a.y<b.y+b.h+g-EPS&&a.y+a.h>b.y-g+EPS;}
function ffFindSpot(rects,w,h,W,H){
  const m=state.page.margin,g=state.page.gap;
  const xs=[m,...rects.map(r=>r.x+r.w+g)].sort((a,b)=>a-b),ys=[m,...rects.map(r=>r.y+r.h+g)].sort((a,b)=>a-b);
  for(const y of ys){if(y+h>H-m+EPS)continue;
    for(const x of xs){if(x+w>W-m+EPS)continue;
      const c={x,y,w,h};if(!rects.some(r=>ffOverlaps(c,r,g)))return{x,y};}}
  return null;
}
/* place `list` around the fixed `keep` frames, first free spot, adding sheets as needed */
function ffPack(list,keep,W,H){
  const byPage=[],add=p=>{(byPage[p.ff.page]||(byPage[p.ff.page]=[])).push(p.ff);};
  keep.forEach(add);
  const m=state.page.margin,iw=Math.max(10,W-2*m),ih=Math.max(10,H-2*m);
  list.forEach(p=>{
    let{w,h}=p.ff?{w:p.ff.w,h:p.ff.h}:ffDefaultSize(p);
    const k=Math.min(1,iw/w,ih/h);w*=k;h*=k;
    let pi=0,spot=null;
    for(;;pi++){spot=ffFindSpot(byPage[pi]||[],w,h,W,H);if(spot)break;if(!(byPage[pi]&&byPage[pi].length)){spot={x:m,y:m};break;}}
    p.ff={page:pi,x:spot.x,y:spot.y,w,h,z:p.ff?p.ff.z:++ff.z};
    add(p);
  });
  ff.pages=Math.max(ff.pages,byPage.length,1);
}
function layFreeform(photos,W,H){
  photos.forEach(p=>{if(p.ff)ffFit(p.ff,W,H);});
  const missing=photos.filter(p=>!p.ff);
  if(missing.length)ffPack(missing,photos.filter(p=>p.ff),W,H);
  if(!photos.length)return{pages:[],cov:0};
  ff.pages=Math.max(ff.pages,1,...photos.map(p=>p.ff.page+1));
  const pages=Array.from({length:ff.pages},()=>({w:W,h:H,frames:[]}));let used=0;
  photos.slice().sort((a,b)=>a.ff.z-b.ff.z).forEach(p=>{
    pages[p.ff.page].frames.push({pid:p.id,img:p.ff,cut:p.ff,cap:null,crop:true});used+=p.ff.w*p.ff.h;});
  return{pages,cov:used/(pages.length*W*H)};
}
/* entering freeform: start from whatever the current mode laid out */
function ffSeedFromLayout(L){
  if(!L||!L.pages||!L.pages.length)return;
  if(state.page.orient==="auto"&&L.o)state.ff.orient=L.o;
  L.pages.forEach((pg,pi)=>pg.frames.forEach(f=>{const p=state.P.get(f.pid);if(!p||p.ff)return;
    p.ff={page:pi,x:f.img.x,y:f.img.y,w:f.img.w,h:f.img.h,z:++ff.z};}));
  ff.pages=Math.max(ff.pages,L.pages.length);
}

/* ---------- undo ---------- */
function ffSnapshot(){return{pages:ff.pages,list:state.photos.map(p=>[p.id,p.ff?{...p.ff}:null,p.included])};}
function ffPush(){ff.undo.push(ffSnapshot());if(ff.undo.length>100)ff.undo.shift();ff.redo.length=0;ffPanelSync();}
function ffRestore(s){ff.pages=s.pages;
  s.list.forEach(([id,f,inc])=>{const p=state.P.get(id);if(p){p.ff=f?{...f}:null;p.included=inc;}});
  relayoutNow();renderFilm();}
function ffUndo(){if(!ff.undo.length)return toast("Nothing to undo");ff.redo.push(ffSnapshot());ffRestore(ff.undo.pop());}
function ffRedo(){if(!ff.redo.length)return toast("Nothing to redo");ff.undo.push(ffSnapshot());ffRestore(ff.redo.pop());}

/* ---------- snapping ---------- */
function ffTargets(pi,exclude){
  const L=state.layout,W=L.W,H=L.H,m=state.page.margin,g=state.page.gap;
  const xs=[{v:0},{v:m},{v:W/2},{v:W-m},{v:W}],ys=[{v:0},{v:m},{v:H/2},{v:H-m},{v:H}];
  state.photos.forEach(p=>{if(!p.included||!p.ff||p.ff.page!==pi||exclude.has(p.id))return;const r=p.ff;
    xs.push({v:r.x},{v:r.x+r.w/2},{v:r.x+r.w},{v:r.x-g,only:"e"},{v:r.x+r.w+g,only:"s"});
    ys.push({v:r.y},{v:r.y+r.h/2},{v:r.y+r.h},{v:r.y-g,only:"e"},{v:r.y+r.h+g,only:"s"});});
  return{xs,ys};
}
/* cands: [{v,k:"s"|"c"|"e"}] → nearest target within thr: {off,v} */
function ffBest(cands,targets,thr){
  let best=null;
  for(const c of cands)for(const t of targets){if(t.only&&t.only!==c.k)continue;
    const d=t.v-c.v;if(Math.abs(d)<=thr&&(!best||Math.abs(d)<Math.abs(best.off)))best={off:d,v:t.v};}
  return best;
}
function ffGridSnap(v,thr){const g=state.ff.grid;if(!(g>0))return null;const t=Math.round(v/g)*g;
  return Math.abs(t-v)<=Math.max(thr,g/2)?{off:t-v,v:null}:null;}
function ffSnapAxis(cands,targets,thr){
  if(state.ff.snap){const b=ffBest(cands,targets,thr);if(b)return b;}
  return ffGridSnap(cands[0].v,thr);
}

/* ---------- selection overlays ---------- */
const ffEntry=pid=>(frameMap.get(pid)||[])[0];
function ffBox(node,r,K){node.style.left=r.x*K+"px";node.style.top=r.y*K+"px";node.style.width=r.w*K+"px";node.style.height=r.h*K+"px";}
function ffSyncOverlay(p,K){const en=ffEntry(p.id);if(!en||!en.sel)return;ffBox(en.sel,p.ff,K);
  const b=en.sel.querySelector(".ffbadge");if(b)b.textContent=`${ffFmt(p.ff.w)} × ${ffFmt(p.ff.h)} ${state.ff.unit}`;}
function ffRefreshSel(){
  $$("#film .tile").forEach(t=>t.classList.toggle("sel",state.sel.has(t.dataset.id)));
  stripCounts();
  if(!isFF())return;
  $$("#pagesWrap .ffsel").forEach(n=>n.remove());
  const K=curK(),sel=ffSelected();
  frameMap.forEach((arr,pid)=>arr.forEach(en=>{en.el.classList.toggle("ffon",state.sel.has(pid));en.sel=null;}));
  sel.forEach(p=>{const en=ffEntry(p.id);if(!en)return;
    const o=el("div","ffsel"+(sel.length>1?" multi":""));
    if(sel.length===1){["nw","n","ne","e","se","s","sw","w"].forEach(d=>{const h=el("span","ffh");h.dataset.d=d;h.dataset.pid=p.id;o.appendChild(h);});
      o.appendChild(el("span","ffbadge"));}
    en.el.parentElement.appendChild(o);en.sel=o;ffSyncOverlay(p,K);});
  ffPanelSync();
}
function ffGuideLines(pageEl,gx,gy){
  const layer=pageEl&&pageEl.querySelector(".ffguides");
  $$("#pagesWrap .ffguides").forEach(l=>{if(l!==layer)l.innerHTML="";});
  if(!layer)return;layer.innerHTML="";const K=curK();
  gx.forEach(v=>{if(v==null)return;const d=el("i","ffg v");d.style.left=v*K+"px";layer.appendChild(d);});
  gy.forEach(v=>{if(v==null)return;const d=el("i","ffg h");d.style.top=v*K+"px";layer.appendChild(d);});
}
/* called by renderPages() in freeform mode */
function ffDecorate(){
  const K=curK(),m=state.page.margin,L=state.layout;
  $$("#pagesWrap .page").forEach(pg=>{
    if(state.ff.show){
      const mb=el("div","ffmargin");ffBox(mb,{x:m,y:m,w:L.W-2*m,h:L.H-2*m},K);pg.prepend(mb);
      if(state.ff.grid>0){const gs=state.ff.grid*K;
        if(gs>=4){const gb=el("div","ffgridbg");gb.style.backgroundSize=`${gs}px ${gs}px`;pg.prepend(gb);}}
    }
    pg.appendChild(el("div","ffguides"));
  });
  ffRefreshSel();
}

/* ---------- pointer interaction ---------- */
function ffPageAt(x,y){return $$("#pagesWrap .page").find(pg=>{const r=pg.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;});}
const ffWrap=$("#pagesWrap");
ffWrap.addEventListener("pointerdown",e=>{
  if(!isFF()||e.button>0)return;
  const pageEl=e.target.closest(".page");if(!pageEl)return;
  const K=curK(),pi=+pageEl.dataset.pi,st=$("#stage").scrollTop;
  const h=e.target.closest(".ffh"),fr=e.target.closest(".frame");
  const additive=e.shiftKey||e.ctrlKey||e.metaKey;
  if(h){const p=state.P.get(h.dataset.pid);if(!p||!p.ff)return;
    ff.drag={type:"resize",dir:h.dataset.d,p,r0:{...p.ff},K,sx:e.clientX,sy:e.clientY,st,pi,pageEl,moved:false};
  }else if(fr){const pid=fr.dataset.pid,was=state.sel.has(pid);
    if(additive){if(was){state.sel.delete(pid);ffRefreshSel();return;}state.sel.add(pid);}
    else if(!was){state.sel.clear();state.sel.add(pid);}
    ffRefreshSel();
    const items=ffSelected().filter(p=>p.ff.page===pi).map(p=>({p,x:p.ff.x,y:p.ff.y}));
    if(!items.length)return;
    const bb=items.reduce((b,{p})=>({x0:Math.min(b.x0,p.ff.x),y0:Math.min(b.y0,p.ff.y),x1:Math.max(b.x1,p.ff.x+p.ff.w),y1:Math.max(b.y1,p.ff.y+p.ff.h)}),{x0:1e9,y0:1e9,x1:-1e9,y1:-1e9});
    ff.drag={type:"move",items,bb:{x:bb.x0,y:bb.y0,w:bb.x1-bb.x0,h:bb.y1-bb.y0},K,sx:e.clientX,sy:e.clientY,st,pi,pageEl,tp:pi,moved:false,
      collapse:!additive&&was&&state.sel.size>1?pid:null,ids:new Set(items.map(i=>i.p.id))};
  }else{
    const r=pageEl.getBoundingClientRect();
    ff.drag={type:"marq",pageEl,pi,K,x0:(e.clientX-r.left)/K,y0:(e.clientY-r.top)/K,sx:e.clientX,sy:e.clientY,
      base:additive?new Set(state.sel):new Set(),additive,moved:false,box:null};
  }
  if(e.pointerType==="mouse"||ff.drag.type!=="marq")e.preventDefault();
  try{ffWrap.setPointerCapture(e.pointerId);}catch(err){}
});
ffWrap.addEventListener("pointermove",e=>{
  const d=ff.drag;if(!d)return;
  if(!d.moved){if(Math.hypot(e.clientX-d.sx,e.clientY-d.sy)<3)return;d.moved=true;
    if(d.type!=="marq"){ffPush();d.pageEl.parentElement.classList.add("dragging");}}
  const thr=FF_SNAP_PX/d.K,snapOn=!e.altKey;
  if(d.type==="move"){
    let dx=(e.clientX-d.sx)/d.K,dy=(e.clientY-d.sy+$("#stage").scrollTop-d.st)/d.K;
    const tEl=ffPageAt(e.clientX,e.clientY)||d.pageEl,tp=+tEl.dataset.pi;
    const oR=d.pageEl.getBoundingClientRect(),tR=tEl.getBoundingClientRect();
    const off={x:(oR.left-tR.left)/d.K,y:(oR.top-tR.top)/d.K};
    const b={x:d.bb.x+dx+off.x,y:d.bb.y+dy+off.y,w:d.bb.w,h:d.bb.h};
    let gx=null,gy=null;
    if(snapOn){const T=ffTargets(tp,d.ids);
      const sx=ffSnapAxis([{v:b.x,k:"s"},{v:b.x+b.w/2,k:"c"},{v:b.x+b.w,k:"e"}],T.xs,thr);
      const sy=ffSnapAxis([{v:b.y,k:"s"},{v:b.y+b.h/2,k:"c"},{v:b.y+b.h,k:"e"}],T.ys,thr);
      if(sx){dx+=sx.off;gx=sx.v;}if(sy){dy+=sy.off;gy=sy.v;}}
    d.tp=tp;d.off=off;
    d.items.forEach(it=>{it.p.ff.x=it.x+dx;it.p.ff.y=it.y+dy;const en=ffEntry(it.p.id);if(en)ffBox(en.el,it.p.ff,d.K);ffSyncOverlay(it.p,d.K);});
    ffGuideLines(tEl,[gx],[gy]);
  }else if(d.type==="resize"){
    const{r0,dir}=d,p=d.p,ar=r0.w/r0.h,lock=dir.length===2&&!e.shiftKey;
    const dx=(e.clientX-d.sx)/d.K,dy=(e.clientY-d.sy+$("#stage").scrollTop-d.st)/d.K;
    const E=dir.includes("e"),Wd=dir.includes("w"),S=dir.includes("s"),N=dir.includes("n");
    let w=r0.w+(E?dx:Wd?-dx:0),h=r0.h+(S?dy:N?-dy:0);
    if(lock){if(Math.abs(w/r0.w-1)>=Math.abs(h/r0.h-1))h=w/ar;else w=h*ar;}
    let gx=null,gy=null;
    if(snapOn){const T=ffTargets(d.pi,new Set([p.id]));
      const ex=()=>E?r0.x+w:r0.x+r0.w-w,ey=()=>S?r0.y+h:r0.y+r0.h-h;
      const sx=(E||Wd)?ffSnapAxis([{v:ex(),k:E?"e":"s"}],T.xs,thr):null;
      const sy=(S||N)?ffSnapAxis([{v:ey(),k:S?"e":"s"}],T.ys,thr):null;
      if(lock){const useX=sx&&(!sy||Math.abs(sx.off)<=Math.abs(sy.off));
        if(useX){w+=E?sx.off:-sx.off;h=w/ar;gx=sx.v;}else if(sy){h+=S?sy.off:-sy.off;w=h*ar;gy=sy.v;}}
      else{if(sx){w+=E?sx.off:-sx.off;gx=sx.v;}if(sy){h+=S?sy.off:-sy.off;gy=sy.v;}}}
    if(lock){const k=Math.max(1,FF_MIN/w,FF_MIN/h);w*=k;h*=k;}else{w=Math.max(FF_MIN,w);h=Math.max(FF_MIN,h);}
    Object.assign(p.ff,{x:Wd?r0.x+r0.w-w:r0.x,y:N?r0.y+r0.h-h:r0.y,w,h});
    const en=ffEntry(p.id);if(en){ffBox(en.el,p.ff,d.K);applyFrameImg(en.img,p,en.f,d.K);}
    ffSyncOverlay(p,d.K);ffGuideLines(d.pageEl,[gx],[gy]);
  }else{
    const r=d.pageEl.getBoundingClientRect(),x1=(e.clientX-r.left)/d.K,y1=(e.clientY-r.top)/d.K;
    const q={x:Math.min(d.x0,x1),y:Math.min(d.y0,y1),w:Math.abs(x1-d.x0),h:Math.abs(y1-d.y0)};
    if(!d.box){d.box=el("div","ffmarq");d.pageEl.appendChild(d.box);}
    ffBox(d.box,q,d.K);
    state.sel.clear();d.base.forEach(id=>state.sel.add(id));
    ffIncluded().forEach(p=>{if(p.ff.page===d.pi&&ffOverlaps(p.ff,q,0))state.sel.add(p.id);});
    ffRefreshSel();
  }
});
function ffEndDrag(){
  const d=ff.drag;if(!d)return;ff.drag=null;
  if(d.box)d.box.remove();
  ffGuideLines(null,[],[]);
  if(d.type==="marq"){if(!d.moved&&!d.additive){state.sel.clear();ffRefreshSel();}return;}
  if(!d.moved){if(d.collapse){state.sel.clear();state.sel.add(d.collapse);ffRefreshSel();}return;}
  if(d.type==="move"&&d.tp!==d.pi)d.items.forEach(it=>{it.p.ff.page=d.tp;it.p.ff.x+=d.off.x;it.p.ff.y+=d.off.y;});
  if(d.type==="resize")clampCrop(d.p);
  relayoutNow();
}
ffWrap.addEventListener("pointerup",ffEndDrag);
ffWrap.addEventListener("pointercancel",ffEndDrag);
ffWrap.addEventListener("dblclick",e=>{if(!isFF())return;const fr=e.target.closest(".frame");if(fr)openEditor(fr.dataset.pid);});

/* ---------- commands ---------- */
function ffTargetsOrAll(){let list=ffSelected();
  if(!list.length){list=ffIncluded();if(list.length)toast("No photos selected — applied to all");}
  return list;}
function ffWarnOverlap(list){
  const all=ffIncluded();
  if(list.some(a=>all.some(b=>a!==b&&a.ff.page===b.ff.page&&ffOverlaps(a.ff,b.ff,-0.01))))
    toast("Some photos now overlap — try Auto-arrange");
}
function ffApplySize(w,h){
  const list=ffTargetsOrAll();if(!list.length)return;
  ffPush();const L=state.layout;
  list.forEach(p=>{const dm=imageDims(p),ar=dm.w/dm.h;let ww=w,hh=h;
    if(ww==null&&hh==null)return;
    if(hh==null)hh=ww/ar;else if(ww==null)ww=hh*ar;
    else if(state.ff.po!=="free"){const land=state.ff.po==="auto"?ar>1:state.ff.po==="landscape";
      const a=Math.max(ww,hh),b=Math.min(ww,hh);[ww,hh]=land?[a,b]:[b,a];}
    p.ff.w=Math.max(FF_MIN,ww);p.ff.h=Math.max(FF_MIN,hh);ffFit(p.ff,L.W,L.H);clampCrop(p);});
  relayoutNow();ffWarnOverlap(list);
}
function ffPhotoRatio(){
  const list=ffTargetsOrAll();if(!list.length)return;ffPush();const L=state.layout;
  list.forEach(p=>{const dm=imageDims(p),ar=dm.w/dm.h,long=Math.max(p.ff.w,p.ff.h);
    if(ar>=1){p.ff.w=long;p.ff.h=long/ar;}else{p.ff.h=long;p.ff.w=long*ar;}ffFit(p.ff,L.W,L.H);clampCrop(p);});
  relayoutNow();
}
function ffAlign(kind){
  const list=ffSelected();if(!list.length)return toast("Select photos to align");
  const L=state.layout,m=state.page.margin;
  const onePage=list.every(p=>p.ff.page===list[0].ff.page);
  const toPage=list.length===1||state.ff.alignTo==="page"||!onePage;
  if((kind==="dh"||kind==="dv")){
    if(list.length<3||!onePage)return toast("Select 3 or more photos on one sheet to distribute");
    ffPush();const ax=kind==="dh"?"x":"y",sz=kind==="dh"?"w":"h";
    const s=list.slice().sort((a,b)=>a.ff[ax]-b.ff[ax]);
    const start=s[0].ff[ax],end=Math.max(...s.map(p=>p.ff[ax]+p.ff[sz])),tot=s.reduce((t,p)=>t+p.ff[sz],0);
    const gap=(end-start-tot)/(s.length-1);let c=start;
    s.forEach(p=>{p.ff[ax]=c;c+=p.ff[sz]+gap;});
    return relayoutNow();
  }
  ffPush();
  let box;
  if(toPage)box={x:m,y:m,w:L.W-2*m,h:L.H-2*m};
  else{const x0=Math.min(...list.map(p=>p.ff.x)),y0=Math.min(...list.map(p=>p.ff.y));
    box={x:x0,y:y0,w:Math.max(...list.map(p=>p.ff.x+p.ff.w))-x0,h:Math.max(...list.map(p=>p.ff.y+p.ff.h))-y0};}
  list.forEach(p=>{const r=p.ff;
    if(kind==="l")r.x=box.x;if(kind==="c")r.x=box.x+(box.w-r.w)/2;if(kind==="r")r.x=box.x+box.w-r.w;
    if(kind==="t")r.y=box.y;if(kind==="m")r.y=box.y+(box.h-r.h)/2;if(kind==="b")r.y=box.y+box.h-r.h;});
  relayoutNow();
}
function ffZOrder(front){const list=ffSelected();if(!list.length)return toast("Select photos first");
  ffPush();const zs=ffIncluded().map(p=>p.ff.z);let z=front?Math.max(...zs):Math.min(...zs);
  list.sort((a,b)=>a.ff.z-b.ff.z);(front?list:list.slice().reverse()).forEach(p=>{p.ff.z=front?++z:--z;});
  ff.z=Math.max(ff.z,...ffIncluded().map(p=>p.ff.z));relayoutNow();}
function ffAutoArrange(){
  const inc=ffIncluded();if(!inc.length)return;
  ffPush();const L=state.layout;
  const sel=ffSelected(),only=sel.length>1?sel:null;
  if(only){const ids=new Set(only.map(p=>p.id));
    ffPack(only.slice().sort((a,b)=>b.ff.h-a.ff.h||b.ff.w-a.ff.w),inc.filter(p=>!ids.has(p.id)),L.W,L.H);
    toast(`Re-packed ${only.length} selected photos`);}
  else{ff.pages=1;ffPack(inc.slice().sort((a,b)=>b.ff.h-a.ff.h||b.ff.w-a.ff.w),[],L.W,L.H);toast("Re-packed all photos");}
  relayoutNow();
}
function ffAddSheet(){ffPush();ff.pages++;relayoutNow();
  const pages=$$("#pagesWrap .pagebox");pages[pages.length-1]?.scrollIntoView({behavior:"smooth",block:"center"});}
function ffTrimSheets(){
  const used=[...new Set(ffIncluded().map(p=>p.ff.page))].sort((a,b)=>a-b);
  if(used.length===ff.pages)return toast("No empty sheets");
  ffPush();const map=new Map(used.map((v,i)=>[v,i]));
  state.photos.forEach(p=>{if(p.ff)p.ff.page=map.has(p.ff.page)?map.get(p.ff.page):0;});
  ff.pages=Math.max(1,used.length);relayoutNow();toast("Removed empty sheets");
}
function ffRemoveSelected(){const list=ffSelected();if(!list.length)return;
  ffPush();list.forEach(p=>{p.included=false;state.sel.delete(p.id);});relayoutNow();renderFilm();
  toast(`${list.length} photo${list.length>1?"s":""} removed from the sheet — tap in the film strip to bring back`);}
function ffNudge(dx,dy){const list=ffSelected();if(!list.length)return;
  if(Date.now()-ff.nudgeT>900)ffPush();ff.nudgeT=Date.now();
  list.forEach(p=>{p.ff.x+=dx;p.ff.y+=dy;ffFit(p.ff,state.layout.W,state.layout.H);});relayoutNow();}
function ffKey(e){
  if(!isFF()||e.target.closest?.("input,textarea,select,[contenteditable]"))return false;
  const mod=e.ctrlKey||e.metaKey,k=e.key;
  if(mod&&k.toLowerCase()==="z"){e.preventDefault();e.shiftKey?ffRedo():ffUndo();return true;}
  if(mod&&k.toLowerCase()==="y"){e.preventDefault();ffRedo();return true;}
  if(mod&&k.toLowerCase()==="a"){e.preventDefault();ffIncluded().forEach(p=>state.sel.add(p.id));ffRefreshSel();return true;}
  if(k==="Escape"&&state.sel.size){state.sel.clear();ffRefreshSel();return true;}
  if((k==="Delete"||k==="Backspace")&&ffSelected().length){e.preventDefault();ffRemoveSelected();return true;}
  const st=e.shiftKey?10:1,dirs={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,-st],ArrowDown:[0,st]};
  if(dirs[k]&&ffSelected().length){e.preventDefault();ffNudge(...dirs[k]);return true;}
  return false;
}

/* ---------- panel ---------- */
function ffRenderSizeChips(){
  const w=$("#ffSizeChips");w.innerHTML="";
  const all=[...FF_PRESETS.map(s=>({...s,user:false})),...ffUserSizes.map(s=>({...s,user:true}))];
  all.forEach(s=>{const c=el("button","chip"+(s.user?" user":""));c.type="button";
    c.title=`${+s.w.toFixed(1)} × ${+s.h.toFixed(1)} mm`;
    c.innerHTML=`<span>${s.n.replace(/</g,"&lt;")}</span>`+(s.user?'<span class="x" title="Delete">✕</span>':"");
    c.addEventListener("click",e=>{
      if(e.target.classList.contains("x")){ffUserSizes=ffUserSizes.filter(u=>u!==ffUserSizes.find(q=>q.n===s.n&&q.w===s.w&&q.h===s.h));
        try{localStorage.setItem(FF_SIZES_KEY,JSON.stringify(ffUserSizes));}catch(err){}ffRenderSizeChips();return;}
      ffApplySize(s.w,s.h);});
    w.appendChild(c);});
}
function ffReadDims(){const rd=id=>{const v=$(id).value.trim();if(v==="")return null;const n=+v;return Number.isFinite(n)&&n>0?ffFromU(n):NaN;};
  return{w:rd("#ffW"),h:rd("#ffH")};}
function ffPanelSync(){
  if(!isFF())return;
  const sel=ffSelected(),one=sel.length===1,act=document.activeElement;
  const pages=new Set(sel.map(p=>p.ff.page+1));
  $("#ffInfo").innerHTML=sel.length?`<b>${sel.length}</b> photo${sel.length>1?"s":""} selected · sheet ${[...pages].join(", ")}`:
    "Nothing selected — click a photo, Shift-click or drag a box to select several.";
  const same=k=>sel.length&&sel.every(p=>Math.abs(p.ff[k]-sel[0].ff[k])<0.05);
  const put=(id,k,enabled)=>{const i=$(id);if(i===act)return;
    i.value=enabled&&same(k)?ffFmt(sel[0].ff[k]):"";i.placeholder=enabled&&sel.length&&!same(k)?"mixed":state.ff.unit;};
  put("#ffW","w",true);put("#ffH","h",true);put("#ffX","x",one);put("#ffY","y",one);
  $("#ffX").disabled=$("#ffY").disabled=!one;
  $$("#ffAlign button").forEach(b=>b.disabled=b.dataset.a.startsWith("d")?sel.length<3:!sel.length);
  ["#ffFront","#ffBack","#ffEdit"].forEach(id=>$(id).disabled=!sel.length);$("#ffEdit").disabled=!one;
  $("#ffUndo").disabled=!ff.undo.length;$("#ffRedo").disabled=!ff.redo.length;
  $$(".ffUnitLbl").forEach(s=>s.textContent=state.ff.unit);
}
function ffRestoreControls(){
  const mark=(sel,attr,v)=>$$(sel+" button").forEach(b=>b.classList.toggle("on",b.dataset[attr]===v));
  mark("#ffPOSeg","po",state.ff.po);mark("#ffUnitSeg","u",state.ff.unit);mark("#ffAlignToSeg","at",state.ff.alignTo);
  $("#ffSnap").checked=state.ff.snap;$("#ffShow").checked=state.ff.show;$("#ffGrid").value=String(state.ff.grid);
  if($("#ffGrid").value!==String(state.ff.grid))$("#ffGrid").value="0";
}
segBind("#ffPOSeg",b=>{state.ff.po=b.dataset.po;});
segBind("#ffUnitSeg",b=>{state.ff.unit=b.dataset.u;$("#ffW").value=$("#ffH").value="";ffRefreshSel();});
segBind("#ffAlignToSeg",b=>{state.ff.alignTo=b.dataset.at;});
$("#ffSnap").addEventListener("change",e=>{state.ff.snap=e.target.checked;});
$("#ffShow").addEventListener("change",e=>{state.ff.show=e.target.checked;renderPages();});
$("#ffGrid").addEventListener("change",e=>{state.ff.grid=+e.target.value;renderPages();});
$("#ffApply").onclick=()=>{const{w,h}=ffReadDims();
  if(Number.isNaN(w)||Number.isNaN(h))return toast("Enter a positive width and/or height");
  if(w==null&&h==null)return toast("Enter a width, a height, or both");
  ffApplySize(w,h);};
["#ffW","#ffH"].forEach(id=>$(id).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("#ffApply").click();}}));
["#ffX","#ffY"].forEach(id=>$(id).addEventListener("change",e=>{
  const sel=ffSelected();if(sel.length!==1)return;const v=+e.target.value;if(!Number.isFinite(v))return;
  ffPush();sel[0].ff[id==="#ffX"?"x":"y"]=ffFromU(v);relayoutNow();}));
$("#ffRatio").onclick=ffPhotoRatio;
$("#ffSaveSize").onclick=()=>{const{w,h}=ffReadDims();
  if(!(w>0&&h>0))return toast("Enter both width and height to save a size");
  const n=state.ff.unit==="in"?`${ffFmt(w)}×${ffFmt(h)}″`:`${Math.round(w*10)/10}×${Math.round(h*10)/10}`;
  if(ffUserSizes.some(s=>s.n===n))return toast("That size is already saved");
  ffUserSizes.push({n,w,h});try{localStorage.setItem(FF_SIZES_KEY,JSON.stringify(ffUserSizes));}catch(err){}
  ffRenderSizeChips();toast(`Size ${n} saved`);};
$("#ffAlign").addEventListener("click",e=>{const b=e.target.closest("button");if(b)ffAlign(b.dataset.a);});
$("#ffFront").onclick=()=>ffZOrder(true);
$("#ffBack").onclick=()=>ffZOrder(false);
$("#ffArrange").onclick=ffAutoArrange;
$("#ffAddSheet").onclick=ffAddSheet;
$("#ffTrim").onclick=ffTrimSheets;
$("#ffUndo").onclick=ffUndo;
$("#ffRedo").onclick=ffRedo;
$("#ffEdit").onclick=()=>{const s=ffSelected();if(s.length===1)openEditor(s[0].id);};
ffRenderSizeChips();

/* ═════════════════════════ UI wiring ═════════════════════════ */
function segBind(sel,cb){$(sel).addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  $$(sel+" button").forEach(x=>x.classList.remove("on"));b.classList.add("on");cb(b);saveSettings();});}
segBind("#modeSeg",b=>{if(b.dataset.mode==="freeform"&&state.mode!=="freeform")ffSeedFromLayout(state.layout);
  state.mode=b.dataset.mode;$("#optFreeform").hidden=state.mode!=="freeform";
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
  $("#dpiNote").textContent=`Rendered at ${state.dpi} dpi — print at “actual size”, margins off. Higher values can exceed browser canvas limits.`;});
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
  mark("#modeSeg","mode",state.mode);$("#optFlow").hidden=state.mode!=="flow";$("#optPolaroid").hidden=state.mode!=="polaroid";$("#optGrid").hidden=state.mode!=="grid";$("#optFreeform").hidden=state.mode!=="freeform";ffRestoreControls();
  const setRange=(id,value,suffix)=>{$("#"+id).value=value;$("#"+id+"v").textContent=value+suffix;};
  setRange("fMaxW",state.flow.maxW,"mm");setRange("fMaxH",state.flow.maxH,"mm");$("#fRotate").checked=state.flow.rotate;
  setRange("pW",state.pol.pw,"mm");setRange("pH",state.pol.ph,"mm");setRange("pBand",state.pol.band,"mm");setRange("pPad",state.pol.pad,"mm");$("#pBorder").checked=state.pol.border;$("#pDates").checked=state.pol.dates;
  setRange("gCW",state.grid.cw,"mm");setRange("gCH",state.grid.ch,"mm");mark("#gFitSeg","fit",state.grid.fit);
  $("#pgSize").value=state.page.size;$("#customDims").hidden=state.page.size!=="custom";$("#pgCW").value=state.page.w;$("#pgCH").value=state.page.h;
  mark("#orientSeg","o",state.page.orient);setRange("pgMargin",state.page.margin,"mm");setRange("pgGap",state.page.gap,"mm");$("#pgDpi").value=state.dpi;$("#dpiNote").textContent=`Rendered at ${state.dpi} dpi — print at “actual size”, margins off. Higher values can exceed browser canvas limits.`;
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
  if(ffKey(e))return;
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

/* ═════════════════════════ persistence (IndexedDB) ═════════════════════════ */
/* Photos (original + working + thumbnail blobs) live in the "blobs" store, one record per photo.
   Everything else — order, edits, captions, crops, inclusion, freeform frames, selection —
   is one small "project" record rewritten (debounced) whenever the sheets re-render. */
const DB_NAME="snapsheet",DB_VER=1;
var project={ready:false,warned:false,db:null};  // var: scheduleSave() runs during earlier modules' init
function openDB(){
  if(!project.db)project.db=new Promise((res,rej)=>{
    if(!window.indexedDB)return rej(new Error("IndexedDB unavailable"));
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=()=>{const db=r.result;
      if(!db.objectStoreNames.contains("blobs"))db.createObjectStore("blobs");
      if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta");};
    r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);r.onblocked=()=>rej(new Error("IndexedDB blocked"));
  });
  return project.db;
}
/* run fn(store) in one transaction; resolves with the last request's result once committed */
async function idb(storeName,mode,fn){
  const db=await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(storeName,mode),req=fn(tx.objectStore(storeName));
    tx.oncomplete=()=>res(req?req.result:undefined);
    tx.onerror=tx.onabort=()=>rej(tx.error||new Error("IndexedDB transaction failed"));
  });
}
function storageWarn(e){console.warn("Persistence:",e);
  if(project.warned)return;project.warned=true;
  toast("Couldn’t save photos in this browser (storage full or blocked) — work won’t survive a reload");}

function persistPhotoBlobs(p){
  if(navigator.storage&&navigator.storage.persist&&!project.askedPersist){project.askedPersist=true;navigator.storage.persist().catch(()=>{});}
  return idb("blobs","readwrite",s=>s.put({print:p.printBlob,work:p.workBlob,thumb:p.thumbBlob},p.id)).catch(storageWarn);
}
function projectSnapshot(){
  return{v:1,uid:_uid,ffPages:ff.pages,ffZ:ff.z,sel:[...state.sel],
    photos:state.photos.map(p=>({id:p.id,name:p.name,w:p.w,h:p.h,dateMs:p.dateMs,adj:{...p.adj},crop:{...p.crop},
      rotation:p.rotation||0,caption:p.caption||"",included:p.included,ff:p.ff?{...p.ff}:null}))};
}
function saveProjectNow(){
  if(!project.ready)return Promise.resolve();
  return idb("meta","readwrite",s=>s.put(projectSnapshot(),"project")).catch(storageWarn);
}
const saveProjectSoon=debounce(saveProjectNow,400);
function scheduleSave(){if(project&&project.ready)saveProjectSoon();}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")saveProjectNow();});
window.addEventListener("pagehide",()=>saveProjectNow());

async function restoreProject(){
  let meta=null;
  try{meta=await idb("meta","readonly",s=>s.get("project"));}catch(e){console.warn("Persistence:",e);project.ready=true;return;}
  if(!meta||!Array.isArray(meta.photos)||!meta.photos.length){project.ready=true;return;}
  showOv("Restoring your sheets");
  try{
    const keep=new Set();
    for(let i=0;i<meta.photos.length;i++){
      const m=meta.photos[i];ovSet(i+1,meta.photos.length,"photo");
      const b=await idb("blobs","readonly",s=>s.get(m.id)).catch(()=>null);
      if(!b||!b.print||!b.thumb)continue;
      const p={id:m.id,name:m.name,w:m.w,h:m.h,dateMs:m.dateMs,printBlob:b.print,workBlob:b.work,thumbBlob:b.thumb,
        thumbURL:URL.createObjectURL(b.thumb),adj:{...DEF_ADJ(),...m.adj},crop:{z:1,x:0,y:0,...m.crop},
        rotation:m.rotation||0,caption:m.caption||"",included:m.included!==false,ff:m.ff||null};
      state.photos.push(p);state.P.set(p.id,p);keep.add(p.id);
    }
    const maxId=Math.max(0,...state.photos.map(p=>+String(p.id).slice(1)||0));
    _uid=Math.max(_uid,meta.uid||0,maxId+1);
    (meta.sel||[]).forEach(id=>{if(keep.has(id))state.sel.add(id);});
    if(Number.isFinite(meta.ffPages))ff.pages=Math.max(1,meta.ffPages);
    if(Number.isFinite(meta.ffZ))ff.z=meta.ffZ;
    /* drop blobs whose photo is gone (e.g. a save interrupted mid-import) */
    idb("blobs","readonly",s=>s.getAllKeys()).then(keys=>{const stale=(keys||[]).filter(k=>!keep.has(k));
      if(stale.length)return idb("blobs","readwrite",s=>{let r;stale.forEach(k=>{r=s.delete(k);});return r;});}).catch(()=>{});
    const lost=meta.photos.length-state.photos.length;
    if(lost>0)toast(`${lost} photo${lost>1?"s":""} could not be restored`);
    else toast(`Restored ${state.photos.length} photo${state.photos.length>1?"s":""} — use New to start over`);
  }finally{
    project.ready=true;hideOv();relayoutNow();renderFilm();
  }
}
async function clearProjectStore(){
  try{await idb("meta","readwrite",s=>s.delete("project"));await idb("blobs","readwrite",s=>s.clear());}catch(e){console.warn("Persistence:",e);}
}
function newProject(){
  if(!state.photos.length)return toast("Already a blank project");
  if(!confirm("Start a new project?\n\nThis removes every photo, edit and arrangement saved in this browser. It can’t be undone."))return;
  state.photos.forEach(p=>URL.revokeObjectURL(p.thumbURL));
  state.photos=[];state.P.clear();state.sel.clear();releaseBitmaps();
  ff.pages=1;ff.z=0;ff.undo.length=0;ff.redo.length=0;
  clearProjectStore();
  relayoutNow();renderFilm();toast("New project — add photos to begin");
}
$("#btnNew").onclick=newProject;
$("#btnClearAll").onclick=newProject;
restoreProject();
