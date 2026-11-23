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
