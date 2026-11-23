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
