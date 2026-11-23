/* ═════════════════════════ utils ═════════════════════════ */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let _uid=1; const uid=()=>"p"+(_uid++);
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;$("#toasts").appendChild(t);
  setTimeout(()=>t.classList.add("out"),2600);setTimeout(()=>t.remove(),3000);}
const MM_IN=25.4;
/* touch-first devices (phones, tablets): finger-friendly thresholds and hints */
const coarseMQ=matchMedia("(pointer:coarse)");
const isTouchUI=()=>coarseMQ.matches;
const phoneMQ=matchMedia("(max-width:600px)");
/* Android back button / back gesture: close the open sheet or dialog instead of leaving the app.
   uiOpened() adds a history entry; closing from the UI calls uiClosed(), which steps back over it. */
const uiStack=[];let uiSkipPop=0;
function uiOpened(name,close){
  if(uiStack.some(u=>u.name===name))return;
  uiStack.push({name,close});
  try{history.pushState({snapsheetUi:name},"");}catch(e){}
}
function uiClosed(name){
  const i=uiStack.findIndex(u=>u.name===name);if(i<0)return;
  uiStack.splice(i,1);
  if(history.state&&history.state.snapsheetUi===name){uiSkipPop++;history.back();}
}
window.addEventListener("popstate",()=>{
  if(uiSkipPop){uiSkipPop--;return;}
  const u=uiStack.pop();if(u)u.close();
});
