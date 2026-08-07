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
