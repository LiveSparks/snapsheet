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
