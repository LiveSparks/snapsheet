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
