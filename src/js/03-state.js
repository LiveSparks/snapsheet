/* ═════════════════════════ state ═════════════════════════ */
const SIZES={a4:[210,297],a5:[148,210],a3:[297,420],b5:[176,250],letter:[215.9,279.4],legal:[215.9,355.6],p1015:[101.6,152.4],p1318:[127,177.8]};
const state={
  photos:[], P:new Map(), sel:new Set(),
  mode:"polaroid",
  page:{size:"a4",w:210,h:297,orient:"auto",margin:8,gap:3},
  flow:{maxW:92,maxH:92,rotate:true},
  pol:{pw:62,ph:62,band:16,pad:5,border:true,dates:true},
  grid:{cw:60,ch:45,fit:"cover"},
  guides:{on:true,style:"marks",color:"#e0242f",preview:true},
  ff:{snap:true,grid:0,show:true,unit:"mm",po:"auto",alignTo:"sel",orient:"portrait"},
  dpi:300, target:"sel", layout:null,
};
const MIN_ZOOM=.5;
const SETTINGS_KEY="snapsheet-settings-v1";
function mergeSettings(target,source){if(!source||typeof source!=="object")return;
  Object.keys(target).forEach(k=>{if(Object.prototype.hasOwnProperty.call(source,k)&&typeof source[k]===typeof target[k])target[k]=source[k];});}
let savedSettings=null;
function loadSettings(){
  try{savedSettings=JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null");}catch(e){savedSettings=null;}
  if(!savedSettings)return;
  if(["flow","polaroid","grid","freeform"].includes(savedSettings.mode))state.mode=savedSettings.mode;
  mergeSettings(state.page,savedSettings.page);mergeSettings(state.flow,savedSettings.flow);mergeSettings(state.pol,savedSettings.pol);mergeSettings(state.grid,savedSettings.grid);mergeSettings(state.guides,savedSettings.guides);mergeSettings(state.ff,savedSettings.ff);
  if(Number.isFinite(savedSettings.dpi))state.dpi=savedSettings.dpi;
  if(savedSettings.target==="sel"||savedSettings.target==="all")state.target=savedSettings.target;
}
function settingsSnapshot(){return{mode:state.mode,page:{...state.page},flow:{...state.flow},pol:{...state.pol},grid:{...state.grid},guides:{...state.guides},ff:{...state.ff},dpi:state.dpi,target:state.target,
  adjust:batchAdj(),closed:$$(".sec").filter(s=>s.classList.contains("closed")).map(s=>s.id)};}
const saveSettings=debounce(()=>{try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settingsSnapshot()));}catch(e){}},140);
const DEF_ADJ=()=>({b:100,c:100,s:100,sh:0,r:10});
const adjActive=p=>p.adj.b!==100||p.adj.c!==100||p.adj.s!==100||p.adj.sh>0;
const adjCss=p=>`brightness(${p.adj.b}%) contrast(${p.adj.c}%) saturate(${p.adj.s}%)`;
const fmtDate=ms=>{const d=new Date(ms);const z=n=>String(n).padStart(2,"0");return `${z(d.getDate())}.${z(d.getMonth()+1)}.${d.getFullYear()}`};
const capText=p=>{const c=(p.caption||"").trim(); if(c)return c; return state.pol.dates?fmtDate(p.dateMs):""};
function frameMM(p){ if(state.mode==="freeform")return p&&p.ff?{w:p.ff.w,h:p.ff.h,cover:true}:null;
  if(state.mode==="polaroid")return{w:state.pol.pw,h:state.pol.ph,cover:true};
  if(state.mode==="grid")return{w:state.grid.cw,h:state.grid.ch,cover:state.grid.fit==="cover"};
  return null; }
const polPad=()=>state.pol.border?state.pol.pad:0;
