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
