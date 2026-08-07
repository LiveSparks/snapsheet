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
