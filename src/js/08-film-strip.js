/* ═════════════════════════ film strip ═════════════════════════ */
function renderFilm(){
  const film=$("#film");film.innerHTML="";
  if(!state.photos.length){film.innerHTML='<div class="filmEmpty">Your roll is empty — add photos above.</div>';}
  state.photos.forEach(p=>{
    const t=el("div","tile"+(state.sel.has(p.id)?" sel":"")+(p.included?"":" off"));
    t.dataset.id=p.id;t.title=p.name;
    const img=new Image();img.src=p.thumbURL;img.alt="";img.loading="lazy";img.draggable=false;t.appendChild(img);
    const ck=el("span","ck");ck.textContent="✓";ck.title="Select";t.appendChild(ck);
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
function toggleTileSel(t){
  const id=t.dataset.id;state.sel.has(id)?state.sel.delete(id):state.sel.add(id);
  t.classList.toggle("sel",state.sel.has(id));ffRefreshSel();
}
/* long-press a tile to select it (phones have no Shift/Ctrl); the click that follows is swallowed */
(()=>{
  const film=$("#film");let timer=0,start=null,fired=false;
  const cancel=()=>{clearTimeout(timer);timer=0;};
  film.addEventListener("pointerdown",e=>{
    const t=e.target.closest(".tile");fired=false;if(!t||e.pointerType==="mouse"||e.target.closest(".rm,.ck"))return;
    start={x:e.clientX,y:e.clientY};cancel();
    timer=setTimeout(()=>{timer=0;fired=true;toggleTileSel(t);if(navigator.vibrate)navigator.vibrate(12);},480);
  });
  film.addEventListener("pointermove",e=>{if(timer&&start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>8)cancel();});
  ["pointerup","pointercancel","pointerleave"].forEach(ev=>film.addEventListener(ev,cancel));
  film.addEventListener("contextmenu",e=>{if(e.target.closest(".tile")&&(timer||fired))e.preventDefault();});
  film.addEventListener("click",e=>{if(fired){fired=false;e.stopImmediatePropagation();e.preventDefault();}},true);
})();
$("#film").addEventListener("click",e=>{
  const t=e.target.closest(".tile");if(!t)return;
  const p=state.P.get(t.dataset.id);if(!p)return;
  if(e.target.closest(".rm")){p.included=false;relayout();renderFilm();return;}
  if(e.target.closest(".ck")){toggleTileSel(t);return;}
  if(!p.included){p.included=true;relayout();renderFilm();return;}
  openEditor(p.id);
});
$("#btnSelAll").onclick=()=>{state.photos.forEach(p=>state.sel.add(p.id));renderFilm();ffRefreshSel();};
$("#btnSelNone").onclick=()=>{state.sel.clear();renderFilm();ffRefreshSel();};
/* "Clear roll" and the top-bar "New" button both start a new project (see persistence) */
