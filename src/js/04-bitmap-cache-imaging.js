/* ═════════════════════════ bitmap cache / imaging ═════════════════════════ */
const CANVAS_FILTER=(()=>{try{const c=document.createElement("canvas").getContext("2d");c.filter="brightness(1.2)";return c.filter==="brightness(1.2)"}catch(e){return false}})();
const bmpCache=new Map();
async function getBitmap(p,needPx){
  const c=bmpCache.get(p.id);
  if(c&&c.px>=needPx*0.98)return c.bmp;
  let bmp=null;
  const dims=imageDims(p),ar=dims.w/dims.h; let rw=Math.min(dims.w,Math.ceil(needPx)), rh=Math.min(dims.h,Math.ceil(needPx/ar));
  try{ bmp=await createImageBitmap(p.printBlob,{resizeWidth:rw,resizeHeight:rh,resizeQuality:"high"}); }
  catch(e1){ try{ bmp=await createImageBitmap(p.printBlob); }
    catch(e2){ const url=URL.createObjectURL(p.printBlob); const img=await loadImg(url); URL.revokeObjectURL(url); bmp=img; } }
  if(bmpCache.size>7){const k=bmpCache.keys().next().value;const old=bmpCache.get(k);if(old&&old.bmp.close)try{old.bmp.close()}catch(e){} bmpCache.delete(k);}
  bmpCache.set(p.id,{bmp,px:Math.max(needPx,rw)});
  return bmp;
}
function loadImg(url){return new Promise((res,rej)=>{const i=new Image();i.decoding="async";i.onload=()=>res(i);i.onerror=()=>rej(new Error("decode failed"));i.src=url;});}

/* pixel-level adjust fallback (no ctx.filter) */
function pixelAdjust(ctx,w,h,adj){
  const id=ctx.getImageData(0,0,w,h),d=id.data,b=adj.b/100,c=adj.c/100,s=adj.s/100;
  for(let i=0;i<d.length;i+=4){
    let r=d[i]*b,g=d[i+1]*b,bl=d[i+2]*b;
    r=(r-128)*c+128;g=(g-128)*c+128;bl=(bl-128)*c+128;
    const l=.299*r+.587*g+.114*bl;
    d[i]=l+(r-l)*s;d[i+1]=l+(g-l)*s;d[i+2]=l+(bl-l)*s;
  }
  ctx.putImageData(id,0,0);
}
/* unsharp mask (separable box blur) */
function boxBlurData(d,w,h,r){
  r=Math.max(1,Math.round(r));const win=2*r+1;
  const tmp=new Uint8ClampedArray(d.length),out=new Uint8ClampedArray(d.length);
  for(let y=0;y<h;y++){
    const row=y*w*4;let sr=0,sg=0,sb=0;
    for(let x=-r;x<=r;x++){const i=(x<0?0:x>=w?w-1:x)*4+row;sr+=d[i];sg+=d[i+1];sb+=d[i+2];}
    for(let x=0;x<w;x++){
      const o=row+x*4;tmp[o]=sr/win;tmp[o+1]=sg/win;tmp[o+2]=sb/win;tmp[o+3]=d[o+3];
      const ai=Math.min(w-1,x+r+1)*4+row,si=Math.max(0,x-r)*4+row;
      sr+=d[ai]-d[si];sg+=d[ai+1]-d[si+1];sb+=d[ai+2]-d[si+2];
    }
  }
  for(let x=0;x<w;x++){
    let sr=0,sg=0,sb=0;
    for(let y=-r;y<=r;y++){const i=(y<0?0:y>=h?h-1:y)*w*4+x*4;sr+=tmp[i];sg+=tmp[i+1];sb+=tmp[i+2];}
    for(let y=0;y<h;y++){
      const o=y*w*4+x*4;out[o]=sr/win;out[o+1]=sg/win;out[o+2]=sb/win;out[o+3]=tmp[o+3];
      const ai=(Math.min(h-1,y+r+1)*w+x)*4,si=(Math.max(0,y-r)*w+x)*4;
      sr+=tmp[ai]-tmp[si];sg+=tmp[ai+1]-tmp[si+1];sb+=tmp[ai+2]-tmp[si+2];
    }
  }
  return out;
}
function unsharpCanvas(cv,amount,rpx){
  if(amount<=0||rpx<0.35)return;
  const ctx=cv.getContext("2d",{willReadFrequently:true});
  const w=cv.width,h=cv.height; if(!w||!h)return;
  const id=ctx.getImageData(0,0,w,h);
  const blur=boxBlurData(id.data,w,h,rpx);
  const d=id.data,a=amount;
  for(let i=0;i<d.length;i+=4){
    d[i]=clamp(d[i]+(d[i]-blur[i])*a,0,255);
    d[i+1]=clamp(d[i+1]+(d[i+1]-blur[i+1])*a,0,255);
    d[i+2]=clamp(d[i+2]+(d[i+2]-blur[i+2])*a,0,255);
  }
  ctx.putImageData(id,0,0);
}
const sharpPx=(r,pxPerMm)=>r/10*pxPerMm/(150/MM_IN);
