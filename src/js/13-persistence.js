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
