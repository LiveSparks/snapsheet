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
  input.after(tools);tools.append(minus,plus,entry,val);input.parentElement.classList.add("rangeRow");
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
/* panel drawer (tablets) / bottom sheet (phones) */
const panelIsOpen=()=>document.body.classList.contains("panelOpen");
function setPanel(open){
  if(open===panelIsOpen())return;
  document.body.classList.toggle("panelOpen",open);
  $("#btnControls").setAttribute("aria-expanded",String(open));
  if(open)uiOpened("panel",()=>setPanel(false));
  else{uiClosed("panel");$("#panel").classList.remove("tall");$("#panel").style.transform="";}
}
$("#btnControls").onclick=()=>setPanel(!panelIsOpen());
$("#backdrop").onclick=$("#panelClose").onclick=()=>setPanel(false);
/* phones: drag the sheet's header down to close it, up to make it taller; tap it to toggle height */
(()=>{
  const head=$("#panelHead"),panel=$("#panel");let drag=null;
  head.addEventListener("pointerdown",e=>{
    if(!phoneMQ.matches||e.target.closest("button"))return;
    drag={y:e.clientY,dy:0,t:e.timeStamp};head.setPointerCapture(e.pointerId);panel.classList.add("dragging");});
  head.addEventListener("pointermove",e=>{if(!drag)return;drag.dy=e.clientY-drag.y;
    panel.style.transform=drag.dy>0?`translateY(${drag.dy}px)`:"";});
  const end=e=>{if(!drag)return;const{dy,t}=drag;drag=null;panel.classList.remove("dragging");panel.style.transform="";
    const fast=e.timeStamp-t<250;
    if(dy>90||(fast&&dy>30)){if(panel.classList.contains("tall")&&dy<220&&!fast)panel.classList.remove("tall");else setPanel(false);}
    else if(dy<-40)panel.classList.add("tall");
    else if(Math.abs(dy)<6&&e.type==="pointerup")panel.classList.toggle("tall");};
  head.addEventListener("pointerup",end);head.addEventListener("pointercancel",end);
})();
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
  if(e.key==="Escape")setPanel(false);
});
/* re-render only when the width changes: on phones, the URL bar sliding in and out fires resize with a new height only */
let lastStageW=0;
window.addEventListener("resize",debounce(()=>{const w=stageInnerW();if(Math.abs(w-lastStageW)<1)return;lastStageW=w;
  if(state.layout&&state.photos.length)renderPages();},160));

/* init */
loadSettings();
restoreControls();
enhanceRanges();
renderPresets();
lastStageW=stageInnerW();
relayoutNow();
renderFilm();
