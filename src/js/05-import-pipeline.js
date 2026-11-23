/* ═════════════════════════ import pipeline ═════════════════════════ */
const importQueue=[]; let importBusy=0, importDone=0, importTotal=0;
const heifLibReady=new Promise((resolve,reject)=>{
  const s=$("#heifLib");
  if(typeof window.libheif==="function")return resolve();
  if(!s)return reject(new Error("HEIF decoder script is missing"));
  s.addEventListener("load",()=>resolve(),{once:true});
  s.addEventListener("error",()=>reject(new Error("HEIF decoder failed to load")),{once:true});
});
let heifModulePromise=null;
function getHeifModule(){
  if(!heifModulePromise)heifModulePromise=heifLibReady.then(()=>window.libheif());
  return heifModulePromise;
}
async function decodeHeic(file){
  try{
    const lib=await getHeifModule();
    const decoder=new lib.HeifDecoder();
    const images=decoder.decode(new Uint8Array(await file.arrayBuffer()));
    const image=images[0];
    if(!image)throw new Error("HEIF contains no images");
    const w=image.get_width(),h=image.get_height();
    const cv=document.createElement("canvas");cv.width=w;cv.height=h;
    const ctx=cv.getContext("2d"),data=ctx.createImageData(w,h);
    await new Promise((resolve,reject)=>image.display(data,displayData=>displayData?resolve():reject(new Error("HEIF display failed"))));
    ctx.putImageData(data,0,0);
    const blob=await new Promise((resolve,reject)=>cv.toBlob(b=>b?resolve(b):reject(new Error("HEIF conversion failed")),"image/jpeg",.92));
    if(image.free)image.free();
    if(decoder.free)decoder.free();
    return blob;
  }catch(primary){
    if(!window.heic2any)throw primary;
    const out=await heic2any({blob:file,toType:"image/jpeg",quality:.92});
    return Array.isArray(out)?out[0]:out;
  }
}
function queueImport(files){
  const list=[...files].filter(f=>f&&(f.type.startsWith("image/")||/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name)));
  if(!list.length)return toast("No image files found");
  importDone=0;importTotal+=list.length;
  list.forEach(f=>importQueue.push(f));
  showOv("Importing photos"); pumpImport();
}
async function pumpImport(){
  while(importQueue.length&&importBusy<2){
    const f=importQueue.shift(); importBusy++;
    importFile(f).catch(e=>{console.warn(e);toast(`Skipped ${f.name} (couldn’t decode)`);})
      .finally(()=>{importBusy--;importDone++;
        ovSet(importDone,importTotal,"photo");
        if(!importQueue.length&&!importBusy){hideOv();relayoutNow();renderFilm();toast(`${importDone} photo${importDone>1?"s":""} added`);importTotal=0;}
        else pumpImport();});
  }
}
async function importFile(file){
  const isHeic=/\.(heic|heif)$/i.test(file.name)||/^image\/(heic|heif)/i.test(file.type);
  let blob=file,img=null,url=null;
  try{ url=URL.createObjectURL(file); img=await loadImg(url); }        // native decode (Safari handles HEIC)
  catch(e){
    if(url)URL.revokeObjectURL(url);
    if(!isHeic)throw e;
    blob=await decodeHeic(file);
    url=URL.createObjectURL(blob); img=await loadImg(url);
  }
  const nw=img.naturalWidth,nh=img.naturalHeight;
  const k=Math.min(1,1600/Math.max(nw,nh));
  const work=document.createElement("canvas");work.width=Math.round(nw*k);work.height=Math.round(nh*k);
  work.getContext("2d").drawImage(img,0,0,work.width,work.height);
  const tk=Math.min(1,520/Math.max(work.width,work.height));
  const th=document.createElement("canvas");th.width=Math.round(work.width*tk);th.height=Math.round(work.height*tk);
  th.getContext("2d").drawImage(work,0,0,th.width,th.height);
  const workBlob=await new Promise(r=>work.toBlob(r,"image/jpeg",0.86));
  const thumbBlob=await new Promise(r=>th.toBlob(r,"image/jpeg",0.75));
  if(url)URL.revokeObjectURL(url);
  const p={id:uid(),name:file.name,w:nw,h:nh,dateMs:file.lastModified||Date.now(),
    printBlob:(blob!==file)?blob:file, workBlob, thumbBlob, thumbURL:URL.createObjectURL(thumbBlob),
    adj:DEF_ADJ(),crop:{z:1,x:0,y:0},rotation:0,caption:"",included:true};
  state.photos.push(p);state.P.set(p.id,p);
  await persistPhotoBlobs(p);
}
