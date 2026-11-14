/* Plogging Journal · ಪ್ಲಾಗಿಂಗ್ ದಿನಚರಿ — offline-first web app
 * Data lives in a Google Sheet (via Apps Script); photos in Google Drive;
 * videos are YouTube links. Everything is saved on the phone first
 * (IndexedDB) and uploaded when there is a connection.
 */
"use strict";

/* ================================================================ labels (i18n) */
/* All visible text lives in i18n/<language>.json, one file per language, keyed by the same
   names (see i18n/_context.json for where each label appears). i18n/languages.json lists the
   languages the app knows about; the Settings screen chooses which of them are offered.
   Labels edited in the Google Sheet (tab "Strings") arrive with each sync and win over the files.
   Lookup order: Sheet override → chosen language → Sheet override (English) → English → key. */
const I18N = { langs: [], en: {}, cur: {}, files: {} };
async function fetchJSON(u){ const r=await fetch(u); if(!r.ok) throw new Error(u+" "+r.status); return r.json(); }
async function loadLangFile(code){
  if(I18N.files[code]) return I18N.files[code];
  try{ I18N.files[code]=await fetchJSON("i18n/"+code+".json"); }catch(e){ I18N.files[code]={}; }   // no file yet: Sheet overrides / English
  return I18N.files[code];
}
async function setLang(code){
  S.lang=code; lsSet("plog.lang",code);
  I18N.cur = code==="en" ? I18N.en : await loadLangFile(code);
  const L=langInfo(code); ensureFont(L.font);
  document.documentElement.lang=code;
  document.documentElement.style.setProperty("--font",'"'+L.font+'","Noto Sans",system-ui,sans-serif');
}
function langInfo(code){ return I18N.langs.find(l=>l.code===code) || {code,name:code,english:code,short:code.toUpperCase(),intl:"en-IN",font:"Noto Sans"}; }
function enabledLangs(){ const c=S.config&&Array.isArray(S.config.languages)&&S.config.languages.length? S.config.languages : ["kn","en"]; return c.filter(x=>I18N.langs.some(l=>l.code===x)); }
const fontsLoaded=new Set(["Noto Sans Kannada","Noto Sans"]);
function ensureFont(f){
  if(!f||fontsLoaded.has(f)) return; fontsLoaded.add(f);
  const l=document.createElement("link"); l.rel="stylesheet";
  l.href="https://fonts.googleapis.com/css2?family="+encodeURIComponent(f).replace(/%20/g,"+")+":wght@400;600;700&display=swap";
  document.head.appendChild(l);
}
function tOr(k){ const o=S.meta.strings||{}; return (o[S.lang]&&o[S.lang][k]) || I18N.cur[k] || (o.en&&o.en[k]) || I18N.en[k] || ""; }
function t(k){ return tOr(k) || k; }
function intlLocale(){ return langInfo(S.lang).intl || "en-IN"; }

/* the starting trash categories; their names are labels "item.<key>" in the language files */
const DEFAULT_ITEMS = [
  {key:"plastic_bottle", i18n:true},
  {key:"glass_bottle", i18n:true},
  {key:"broken_glass", i18n:true, hazard:true},
  {key:"beer_can", i18n:true},
  {key:"footwear", i18n:true},
  {key:"syringe", i18n:true, hazard:true}
];

/* ================================================================ utils */
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function $(s,r){ return (r||document).querySelector(s); }
function $$(s,r){ return Array.from((r||document).querySelectorAll(s)); }
function num(v){ const n=parseFloat(v); return isFinite(n)?n:0; }
function uid(n){ let s=""; const c="abcdefghijkmnpqrstuvwxyz23456789"; const a=new Uint8Array(n||8); (self.crypto||window.crypto).getRandomValues(a); for(const x of a) s+=c[x%c.length]; return s; }
function todayStr(){ return dstr(new Date()); }
function parseDate(s){ const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function dstr(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }

/* ================================================================ state */
const S = {
  lang: lsGet("plog.lang") || "kn",
  map: {},            // id -> entry (local copy, includes unsynced changes)
  lib: {topics:{}, files:{}},   // the Library: topic tree and files (local copy)
  libAt: "", libQ: "",          // Library: topic being viewed ("" = top level), search text
  config: null,
  outbox: [],         // [{t:'save'|'delete'|'config', id}]
  meta: {},           // {lastSync, sheetUrl, folderUrl}
  blobUrls: {},       // media clientId -> object URL (files not yet uploaded)
  progress: null,     // {pct} while a video uploads
  waitingWifi: false,
  sync: "idle",       // idle | syncing | offline | error | auth | none
  editing: null, draft: null, openId: null,
  range: "all", from: "", to: "",
  storageOk: true, installEvt: null
};
function fmt(n,d){ if(n==null||!isFinite(n)) return "—"; return new Intl.NumberFormat(intlLocale(),{maximumFractionDigits:d==null?1:d}).format(n); }
/* month names: abbreviated in English only; Indian-language abbreviations ("ನವೆಂ") read unnaturally, so they're written in full */
function fmtDate(s,opts){ try{ const o=Object.assign({},opts||{weekday:"short",day:"numeric",month:"short",year:"numeric"}); if(o.month==="short"&&S.lang!=="en") o.month="long";
  return new Intl.DateTimeFormat(intlLocale(),o).format(parseDate(s)); }catch(e){ return s; } }
function minutes(e){ if(!e.start||!e.end) return null; const [a,b]=e.start.split(":").map(Number),[c,d]=e.end.split(":").map(Number); let m=(c*60+d)-(a*60+b); if(m<0) m+=1440; return isFinite(m)?m:null; }
function fmtDur(m){ if(m==null) return ""; const h=Math.floor(m/60), mm=m%60; return ((h? h+" "+t("hr")+" ":"")+(mm? mm+" "+t("min"):"")).trim(); }
function items(){ return (S.config && Array.isArray(S.config.items) && S.config.items.length) ? S.config.items : DEFAULT_ITEMS; }
/* a category's name in the current language: its own names (custom categories), else the label file */
/* One-off items typed on a day keep {name (as typed), src (language typed in), names {lang:text}, mt {lang:true} (machine-translated)}. */
/* the volunteer typed or corrected a one-off item's name in the current language */
function setExtraName(x,v){
  if(v===extraName(x)) return;
  const L=S.lang; x.names=x.names||{}; x.mt=x.mt||{};
  if(!x.name || !x.src || x.src===L){
    // the original text changed: the old translations no longer fit
    for(const c of Object.keys(x.names)) if(c!==L && x.mt[c]) delete x.names[c];
    x.mt={}; x.name=v; x.src=L;
  } else delete x.mt[L];
  x.names[L]=v;
}
function extraName(x,lang){ lang=lang||S.lang; return (x.names&&x.names[lang]) || x.name || ""; }
function extraMT(x,lang){ lang=lang||S.lang; return !!(x.mt&&x.mt[lang]&&x.names&&x.names[lang]); }
function extraKey(x){ return String((x.names&&x.names.en)||x.name||"").trim().toLowerCase(); }
function itemMT(it,lang){ lang=lang||S.lang; return !!(it.mt&&it.mt[lang]); }
const TX_ICON='<svg class="txi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.8 8h12.4M8 1.8c-2.2 2.4-2.2 10 0 12.4M8 1.8c2.2 2.4 2.2 10 0 12.4" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
function mtMark(on){ return on? '<span class="mt" title="'+esc(t("mtNote"))+'">'+TX_ICON+'</span>' : ""; }
/* ---- free text (notes, places, titles) shown in the reader's language.
   Translations come from the script (which keeps a shared 'Translations' tab) and are cached on the phone.
   A small globe marks translated text; tapping it shows the original. */
function txHash(s){ let h=0x811c9dc5; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193); } return (h>>>0).toString(36)+"-"+s.length.toString(36); }
/* text already written in the reader's script needs no translation (and no call) */
const TX_SCRIPT={kn:/[\u0C80-\u0CFF]/,tcy:/[\u0C80-\u0CFF]/,kok:/[\u0C80-\u0CFF]/,en:/[A-Za-z]/,hi:/[\u0900-\u097F]/,mr:/[\u0900-\u097F]/,ta:/[\u0B80-\u0BFF]/,te:/[\u0C00-\u0C7F]/,ml:/[\u0D00-\u0D7F]/,bn:/[\u0980-\u09FF]/,gu:/[\u0A80-\u0AFF]/,pa:/[\u0A00-\u0A7F]/,or:/[\u0B00-\u0B7F]/};
function txSameScript(text){
  const re=TX_SCRIPT[S.lang]; if(!re) return false;
  let mine=0, other=0;
  for(const ch of text){ if(re.test(ch)) mine++; else if(/\p{L}/u.test(ch)) other++; }
  return mine>0 && other<=mine*0.2;   // a few English words inside Kannada are fine
}
function txGet(text){ if(txSameScript(text)) return {same:true}; const c=(S.trc||{})[S.lang]; return c? c[txHash(text)] : undefined; }
function txPlain(text){ text=String(text||"").trim(); if(!text) return ""; if(lsGet("plog.txOff")==="1") return text; const r=txGet(text); if(r===undefined){ txNeed(text); return text; } return r.same? text : r.t; }
/* translated text with the globe but not tappable (inside buttons that do something else) */
function txMark(text){ const p=txPlain(text); return esc(p)+(p!==String(text||"").trim()?TX_ICON:""); }
function tx(text){
  text=String(text||"").trim(); if(!text) return "";
  if(lsGet("plog.txOff")==="1") return esc(text);
  const r=txGet(text);
  if(r===undefined){ txNeed(text); return esc(text); }
  if(r.same) return esc(text);
  return '<span class="tx" data-tx="1" title="'+esc(t("txNote"))+'"><span class="tt">'+esc(r.t)+'</span><span class="to" hidden>'+esc(text)+'</span>'+TX_ICON+'</span>';
}
let txTimer=null;
function txNeed(text){
  if(!S.meta.aiEnabled || !apiUrl() || navigator.onLine===false) return;
  S.txWant=S.txWant||new Map(); S.txTried=S.txTried||new Set();
  const k=S.lang+"|"+txHash(text); if(S.txTried.has(k)) return;
  S.txWant.set(k,text); clearTimeout(txTimer); txTimer=setTimeout(txRun,600);
}
async function txRun(){
  if(!S.txWant||!S.txWant.size) return;
  const lang=S.lang, batch=[];
  for(const [k,text] of S.txWant){ if(k.startsWith(lang+"|")&&batch.length<40){ batch.push({id:txHash(text),text}); S.txTried.add(k); } }
  S.txWant=new Map([...S.txWant].filter(([k])=>!S.txTried.has(k)));
  if(!batch.length) return;
  try{
    const r=await api("translateText",{lang:{code:lang,name:langInfo(lang).english||lang},texts:batch},90000);
    S.trc=S.trc||{}; const c=S.trc[lang]=S.trc[lang]||{};
    for(const it of ((r&&r.result&&r.result.items)||[])) c[it.id]= it.same? {same:true} : {t:it.text};
    await IDB.put("kv","trc",S.trc);
    if(lang===S.lang && !sheetOpen() && ["journal","library","stats"].includes(currentView())) route();
  }catch(e){ /* offline or no credit: originals stay; tried again next time the app opens */ }
  if(S.txWant.size) txTimer=setTimeout(txRun,300);
}
document.addEventListener("click",ev=>{ const x=ev.target.closest("[data-tx]"); if(!x) return; ev.stopPropagation(); ev.preventDefault();
  const tt=x.querySelector(".tt"), to=x.querySelector(".to"); const showOrig=to.hidden; to.hidden=!showOrig; tt.hidden=showOrig; x.classList.toggle("orig",showOrig); },true);
function itemName(it,lang){
  lang=lang||S.lang;
  const own=(it.names&&it.names[lang]) || (lang==="kn"&&it.kn) || (lang==="en"&&it.en);
  if(own) return own;
  if(lang===S.lang){ const l=tOr("item."+it.key); if(l) return l; }
  else { const f=(lang==="en"?I18N.en:I18N.files[lang])||{}; if(f["item."+it.key]) return f["item."+it.key]; }
  return (it.names&&it.names.en) || it.en || (I18N.en["item."+it.key]) || it.kn || (it.names&&Object.values(it.names).find(Boolean)) || it.key;
}
function itemByKey(k){ return items().find(i=>i.key===k); }
function entries(){ return Object.values(S.map); }
function isPlog(e){ return !!e && e.type!=="rest" && e.type!=="pickup"; }

/* ---- pickups: what has been handed over to the panchayat / municipality ---- */
/* a day's item kinds: its category keys with a count, plus "_other" for unlisted items */
function itemKeysOf(e){ const ks=Object.keys(e.counts||{}).filter(k=>num(e.counts[k])>0); if((e.extras||[]).some(x=>num(x.count)>0)) ks.push("_other"); return ks; }
function keyCount(e,k){ return k==="_other" ? (e.extras||[]).reduce((s,x)=>s+num(x.count),0) : num((e.counts||{})[k]); }
function pickups(){ return entries().filter(e=>e.type==="pickup").sort((a,b)=>(a.date+(a.start||"")+a.id).localeCompare(b.date+(b.start||"")+b.id)); }
/* for every plogging day: which item kinds have gone, with which pickup, and what is still waiting.
   A pickup with no "keys" takes everything from the days it covers. */
function collection(excludeId){
  const res={};
  for(const e of entries()) if(isPlog(e)) res[e.id]={by:{},last:null,status:"none",waiting:[],waitingCount:0};
  for(const p of pickups()){ if(p.id===excludeId) continue;
    for(const id of (p.covers||[])){ const e=S.map[id], r=res[id]; if(!e||!r) continue;
      for(const k of itemKeysOf(e)) if(!r.by[k] && (!p.keys||!p.keys.length||p.keys.includes(k))) r.by[k]=p;
      r.last=p; } }
  for(const id in res){ const e=S.map[id], r=res[id], ks=itemKeysOf(e);
    r.waiting=ks.filter(k=>!r.by[k]); r.waitingCount=r.waiting.reduce((s,k)=>s+keyCount(e,k),0);
    r.status= !ks.length? "empty" : !r.waiting.length? "all" : r.waiting.length===ks.length? "none" : "part"; }
  return res;
}
/* items a given pickup actually took (each item counted once, by the first pickup that covered it) */
function pickupItems(p,col){ let n=0; for(const id of (p.covers||[])){ const e=S.map[id], r=col[id]; if(!e||!r) continue; for(const k in r.by) if(r.by[k]===p) n+=keyCount(e,k); } return n; }
function agencyLabel(p,raw){ const a={panchayat:"agPanchayat",municipal:"agMunicipal",scrap:"agScrap",other:"agOther"}[p.agency]; return [a?t(a):"",p.agencyName?(raw?p.agencyName:txPlain(p.agencyName)):""].filter(Boolean).join(" · "); }
/* entries saved before videos were supported kept pictures in "photos" */
function norm(e){ if(e && !e.media){ e.media=(e.photos||[]).map(p=>Object.assign({kind:"image"},p)); } if(e) delete e.photos; return e; }
function normMap(m){ for(const k in m) norm(m[k]); return m; }
function entryTotal(e){ let n=0; for(const k in (e.counts||{})) n+=num(e.counts[k]); for(const x of (e.extras||[])) n+=num(x.count); return n; }
function peopleCount(e){ return (e.people||[]).length + num(e.others); }
function apiUrl(){ return (lsGet("plog.api") || (window.PLOG_CONFIG && window.PLOG_CONFIG.apiUrl) || "").trim(); }
function passcode(){ return (lsGet("plog.key")||"").trim(); }
function isPending(id){ return S.outbox.some(o=>o.id===id && o.t!=="config"); }
function dayNumbers(){
  const map={}; let prev=0;
  const sorted=entries().filter(isPlog).sort((a,b)=>(a.date+(a.start||"")+a.id).localeCompare(b.date+(b.start||"")+b.id));
  for(const e of sorted){ const n = e.dayNo? num(e.dayNo) : prev+1; map[e.id]=n; prev=n; }
  return map;
}

/* ================================================================ YouTube */
function ytId(u){
  try{
    const url=new URL(String(u).trim());
    const h=url.hostname.replace(/^www\.|^m\./,"");
    let id=null;
    if(h==="youtu.be") id=url.pathname.slice(1).split("/")[0];
    else if(h==="youtube.com"||h==="music.youtube.com"){
      if(url.pathname==="/watch") id=url.searchParams.get("v");
      else { const m=url.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/); if(m) id=m[2]; }
    }
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  }catch(e){ return null; }
}
function ytThumb(id){ return "https://img.youtube.com/vi/"+id+"/mqdefault.jpg"; }

/* ================================================================ IndexedDB */
const IDB = {
  db:null, mem:{kv:{},blobs:{}},
  open(){ return new Promise(res=>{
    try{
      const r=indexedDB.open("plogging",1);
      r.onupgradeneeded=()=>{ const d=r.result; if(!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); if(!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); };
      r.onsuccess=()=>{ this.db=r.result; res(true); };
      r.onerror=()=>res(false); r.onblocked=()=>res(false);
    }catch(e){ res(false); }
  }); },
  req(store,mode,fn){ return new Promise((res,rej)=>{
    if(!this.db){ res(fn(null)); return; }
    const tx=this.db.transaction(store,mode); const q=fn(tx.objectStore(store));
    tx.oncomplete=()=>res(q&&q.result); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error);
  }); },
  async get(store,k){ if(!this.db) return this.mem[store][k]; return this.req(store,"readonly",s=>s.get(k)); },
  async put(store,k,v){ if(!this.db){ this.mem[store][k]=v; return; } return this.req(store,"readwrite",s=>s.put(v,k)); },
  async del(store,k){ if(!this.db){ delete this.mem[store][k]; return; } return this.req(store,"readwrite",s=>s.delete(k)); },
  async keys(store){ if(!this.db) return Object.keys(this.mem[store]); return this.req(store,"readonly",s=>s.getAllKeys()); }
};
async function persist(){ await IDB.put("kv","lib",S.lib); await IDB.put("kv","map",S.map); await IDB.put("kv","outbox",S.outbox); await IDB.put("kv","config",S.config); await IDB.put("kv","meta",S.meta); }

/* ================================================================ server API */
async function api(action,payload,timeoutMs){
  const url=apiUrl(); if(!url) throw {code:"none"};
  const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(), timeoutMs||30000);
  let res;
  try{
    res=await fetch(url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},redirect:"follow",signal:ctrl.signal,
      body:JSON.stringify(Object.assign({action:action,key:passcode()},payload||{}))});
  }catch(e){ throw {code:"network"}; }
  finally{ clearTimeout(tm); }
  if(!res.ok) throw {code:"http",message:"HTTP "+res.status};
  let j; try{ j=await res.json(); }catch(e){ throw {code:"http",message:"bad response"}; }
  if(!j.ok) throw {code: j.error==="unauthorized"?"auth":"server", message:j.error};
  return j;
}
function blobToBase64(b){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(",")[1]||""); r.onerror=()=>rej(r.error); r.readAsDataURL(b); }); }

/* ================================================================ local changes */
function queue(op){
  if(op.t==="save"){ if(!S.outbox.some(o=>o.t==="save"&&o.id===op.id)) S.outbox.push(op); }
  else if(op.t==="delete"){ S.outbox=S.outbox.filter(o=>o.id!==op.id); S.outbox.push(op); }
  else if(op.t==="config"){ S.outbox=S.outbox.filter(o=>o.t!=="config"); S.outbox.push(op); }
  else if(op.t==="topic"||op.t==="file"){ if(!S.outbox.some(o=>o.t===op.t&&o.id===op.id)) S.outbox.push(op); }
  else if(op.t==="topicDel"||op.t==="fileDel"){
    const created=S.outbox.some(o=>(o.t==="topic"||o.t==="file")&&o.id===op.id&&o.isNew);
    S.outbox=S.outbox.filter(o=>o.id!==op.id);
    if(!created) S.outbox.push(op);          // never reached the server: nothing to delete there
  }
}
async function localSave(e){
  e.updatedAt=new Date().toISOString();
  const up=S.meta.up||{};
  for(const p of (e.media||[])) if(p.pending && up[p.cid]){ p.id=up[p.cid]; delete p.pending; delete p.session; delete p.offset; } S.map[e.id]=e; queue({t:"save",id:e.id}); await persist(); kickSync(); }
async function localDelete(id){
  const e=S.map[id];
  if(e) for(const p of (e.media||[])) if(p.pending){ await IDB.del("blobs",p.cid); dropBlobUrl(p.cid); }
  delete S.map[id]; queue({t:"delete",id}); await persist(); kickSync();
}
async function localConfig(c){ S.config=c; queue({t:"config"}); await persist(); kickSync(); }
function dropBlobUrl(cid){ if(S.blobUrls[cid]){ URL.revokeObjectURL(S.blobUrls[cid]); delete S.blobUrls[cid]; } }

/* ================================================================ translation of item names */
/* Names typed in one language (one-off items on a day, new categories) are translated into the
   app's other languages by Claude, through the script. Machine translations are marked, and any
   correction made in the app replaces them. Without an API key nothing happens: names show as typed. */
function missingNames(){
  const langs=enabledLangs(), want=[];
  for(const e of entries()) (e.extras||[]).forEach((x,i)=>{ if(!(x.name||"").trim()) return; const has=x.names||{};
    if(langs.some(c=>!has[c] && !(c===(x.src||"")))) want.push({id:"e:"+e.id+":"+i,text:x.name,kind:"extra",e,x}); });
  for(const it of ((S.config&&S.config.items)||[])){ if(it.i18n||!it.names) continue;
    const given=Object.keys(it.names).filter(c=>(it.names[c]||"").trim()); if(!given.length) continue;
    if(langs.some(c=>!(it.names[c]||"").trim())){ const src=it.src&&it.names[it.src]? it.src : given[0];
      want.push({id:"i:"+it.key,text:it.names[src],kind:"item",it,src}); } }
  return want;
}
async function translateMissing(){
  if(!S.meta.aiEnabled) return;
  if(S.meta.trFailAt && Date.now()-S.meta.trFailAt<10*60*1000) return;   // after a failure, wait 10 minutes
  S.trTried=S.trTried||new Set();
  const want=missingNames().filter(w=>!S.trTried.has(w.id+"|"+w.text)); if(!want.length) return;
  want.slice(0,40).forEach(w=>S.trTried.add(w.id+"|"+w.text));   // once per session, even if a language comes back empty
  const langs=enabledLangs().map(c=>({code:c,name:langInfo(c).english||c}));
  let r;
  try{ r=await api("translate",{texts:want.slice(0,40).map(w=>({id:w.id.replace(/[^A-Za-z0-9_.:-]/g,"_").slice(0,80),text:w.text})),langs},90000); }
  catch(err){ if(err&&err.code==="network") throw err; S.meta.trFailAt=Date.now(); await persist(); return; }
  S.meta.trFailAt=0;
  const byId={}; for(const it of ((r&&r.result&&r.result.items)||[])) byId[it.id]=it;
  const touched=new Set(); let cfg=false;
  for(const w of want.slice(0,40)){
    const got=byId[w.id.replace(/[^A-Za-z0-9_.:-]/g,"_").slice(0,80)]; if(!got) continue;
    if(w.kind==="extra"){
      const e=S.map[w.e.id]; if(!e||!(e.extras||[]).includes(w.x)||w.x.name!==w.text) continue;   // changed meanwhile
      const x=w.x; x.names=x.names||{}; x.mt=x.mt||{};
      if(!x.src) x.src= got.source && langs.some(l=>l.code===got.source)? got.source : S.lang;
      if(!x.names[x.src]) x.names[x.src]=x.name;
      for(const c in got.names) if(!x.names[c]){ x.names[c]=got.names[c]; if(c!==x.src) x.mt[c]=true; }
      touched.add(e.id);
    } else {
      const it=w.it; if(!S.config||!(S.config.items||[]).includes(it)) continue;
      it.mt=it.mt||{}; it.src=it.src||w.src;
      for(const c in got.names) if(!(it.names[c]||"").trim()){ it.names[c]=got.names[c]; it.mt[c]=true; }
      it.en=itemName(it,"en"); it.kn=itemName(it,"kn"); cfg=true;
    }
  }
  for(const id of touched){ S.map[id].updatedAt=new Date().toISOString(); queue({t:"save",id}); }
  if(cfg) queue({t:"config"});
  if(touched.size||cfg){ await persist(); refreshPassive(); }
}

/* a category from names given in some languages; with Claude available the gaps are translated
   at the next sync, otherwise the first name given fills them */
function newCategory(names,langs,haz){
  const nm={}; let src="";
  for(const c of langs){ const v=(names[c]||"").trim(); if(v){ nm[c]=v; if(!src) src= c===S.lang? c : src; } }
  const first=Object.values(nm)[0]; if(!src) src=Object.keys(nm)[0];
  if(!S.meta.aiEnabled) for(const c of langs) if(!nm[c]) nm[c]=first;
  const key=((nm.en||first).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")||"item")+"_"+uid(3);
  return {key,names:nm,src,en:nm.en||first,kn:nm.kn||first,hazard:!!haz};
}
/* edit a category's name in each language (also how a machine translation gets corrected) */
function renameItem(it,langs,done){
  const body=langs.map(c=>'<label class="f">'+esc(langInfo(c).name)+(itemMT(it,c)?' '+mtMark(true):"")+'</label><input type="text" data-rn="'+esc(c)+'" lang="'+esc(c)+'" value="'+esc(itemName(it,c))+'">').join("")+
    (it.mt&&Object.keys(it.mt).length?'<p class="hint" style="margin-top:8px">'+esc(t("mtNote"))+'</p>':"")+
    '<div class="row" style="margin-top:14px"><button type="button" class="btn ghost" data-x>'+esc(t("cancel"))+'</button><button type="button" class="btn" data-ok>'+esc(t("libSave"))+'</button></div>';
  openSheet(t("renameCat"),body,(el,close)=>{
    el.querySelector("[data-x]").onclick=close;
    el.querySelector("[data-ok]").onclick=()=>{
      it.names=it.names||{}; it.mt=it.mt||{};
      el.querySelectorAll("[data-rn]").forEach(i=>{ const c=i.dataset.rn, v=i.value.trim(); if(v && v!==itemName(it,c)){ it.names[c]=v; delete it.mt[c]; } });
      it.en=itemName(it,"en"); it.kn=itemName(it,"kn"); close(); done(); };
  });
}
/* one-off items that keep coming back, grouped across languages (by their English name when known) */
function repeatedExtras(cats){
  const known=new Set(); for(const it of cats) for(const c of Object.keys(I18N.files).concat(["en","kn"])) known.add(String(itemName(it,c)).trim().toLowerCase());
  const g={};
  for(const e of entries()) for(const x of (e.extras||[])){
    if(!(x.name||"").trim()) continue;
    const names=Object.assign({},x.names||{}); if(x.src&&!names[x.src]) names[x.src]=x.name;
    const keys=[...new Set(Object.values(names).concat([x.name]).map(v=>String(v).trim().toLowerCase()).filter(Boolean))];
    if(keys.some(v=>known.has(v))) continue;
    // the same thing may be spelt in different languages on different days: any shared name joins the groups
    let r=null; for(const k of keys) if(g[k]){ const o=g[k]; if(r&&o!==r){ for(const d of o.days) r.days.add(d); r.total+=o.total; r.x.push(...o.x); for(const c in o.names) if(!r.names[c]){ r.names[c]=o.names[c]; r.mt[c]=o.mt[c]; } for(const kk in g) if(g[kk]===o) g[kk]=r; } else r=o; }
    if(!r) r={days:new Set(),total:0,names:{},mt:{},x:[]};
    for(const k of keys) g[k]=r;
    r.days.add(e.id); r.total+=num(x.count); r.x.push({e,x});
    for(const c in names) if(!r.names[c]||(r.mt[c]&&!(x.mt||{})[c])){ r.names[c]=names[c]; r.mt[c]=!!(x.mt||{})[c]; }
  }
  return [...new Set(Object.values(g))].filter(r=>r.days.size>=2).map(r=>Object.assign(r,{label:r.names[S.lang]||r.x[0].x.name})).sort((a,b)=>b.days.size-a.days.size||b.total-a.total).slice(0,10);
}
/* make a category of a repeated one-off item and move the past days' counts into it */
function promoteExtras(g,sDraft,configOut){
  if(!g) return;
  const langs=sDraft.languages;
  const body='<p class="hint" style="margin-top:0">'+esc(t("promoteSheetHint").replace("{d}",fmt(g.days.size,0)).replace("{n}",fmt(g.total,0)))+'</p>'+
    langs.map(c=>'<label class="f">'+esc(langInfo(c).name)+(g.mt[c]?' '+mtMark(true):"")+'</label><input type="text" data-pn="'+esc(c)+'" lang="'+esc(c)+'" value="'+esc(g.names[c]||"")+'">').join("")+
    '<label class="small" style="display:block;margin-top:10px"><input type="checkbox" id="pn_haz"> '+esc(t("hazard"))+'</label>'+
    '<div class="row" style="margin-top:14px"><button type="button" class="btn ghost" data-x>'+esc(t("cancel"))+'</button><button type="button" class="btn" data-ok>'+esc(t("promoteBtn"))+'</button></div>';
  openSheet(t("promoteT"),body,(el,close)=>{
    el.querySelector("[data-x]").onclick=close;
    el.querySelector("[data-ok]").onclick=async()=>{
      const names={}; el.querySelectorAll("[data-pn]").forEach(i=>{ names[i.dataset.pn]=i.value; });
      if(!Object.values(names).some(v=>v.trim())){ toast(t("libNeedName")); return; }
      const it=newCategory(names,langs,el.querySelector("#pn_haz").checked);
      it.mt={}; for(const c in it.names) if(g.mt[c] && it.names[c]===g.names[c]) it.mt[c]=true;   // untouched machine translations stay marked
      sDraft.items.push(it);
      await localConfig(configOut());
      // move the counts: each day's one-off entries become the new category
      const moved=new Set();
      for(const {e,x} of g.x){ const cur=S.map[e.id]; if(!cur) continue; const i=(cur.extras||[]).indexOf(x); if(i<0) continue;
        cur.counts=cur.counts||{}; cur.counts[it.key]=num(cur.counts[it.key])+num(x.count); cur.extras.splice(i,1); moved.add(e.id); }
      // pickups that took "other items" from those days also took this category
      for(const pk of pickups()) if(Array.isArray(pk.keys)&&pk.keys.includes("_other")&&(pk.covers||[]).some(id=>moved.has(id))&&!pk.keys.includes(it.key)){ pk.keys.push(it.key); moved.add(pk.id); }
      for(const id of moved){ S.map[id].updatedAt=new Date().toISOString(); queue({t:"save",id}); }
      await persist(); kickSync(); settingsDirty=false; close();
      toast(t("promoteDone").replace("{d}",fmt(g.days.size,0))); renderSettings();
    };
  });
}

/* ================================================================ sync */
let syncing=false, retryT=null, wakeLock=null;
const CHUNK_DIRECT=2*1024*1024, CHUNK_PROXY=4*1024*1024;   // multiples of 256 KiB, as Drive requires
function kickSync(delay){ clearTimeout(retryT); retryT=setTimeout(sync, delay||300); }
function wifiBlocked(){ if(lsGet("plog.wifiOnly")!=="1") return false; const c=navigator.connection; return !!(c && c.type && c.type!=="wifi" && c.type!=="ethernet"); }
async function holdWake(on){
  try{
    if(on && !wakeLock && navigator.wakeLock && document.visibilityState==="visible"){ wakeLock=await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release",()=>{ wakeLock=null; }); }
    else if(!on && wakeLock){ const w=wakeLock; wakeLock=null; await w.release(); }
  }catch(e){}
}
function setProgress(p){ S.progress = p==null? null : Math.min(99,Math.floor(p*100)); renderSyncPill(); }

async function sync(){
  if(syncing) return;
  if(!apiUrl()||!passcode()){ setSync("none"); return; }
  if(navigator.onLine===false){ setSync("offline"); return; }
  syncing=true; S.waitingWifi=false; setSync("syncing");
  try{
    await translateMissing();
    for(const op of S.outbox.slice()){
      if(!S.outbox.includes(op)) continue;            // replaced meanwhile (e.g. the day was deleted)
      let done=true;
      if(op.t==="save") done=await syncEntry(op.id);
      else if(op.t==="delete") await api("delete",{id:op.id});
      else if(op.t==="config"){ if(S.config) await api("saveConfig",{config:S.config}); }
      else if(op.t==="topic"){ const tp=S.lib.topics[op.id]; if(tp) await api("saveTopic",{topic:tp}); }
      else if(op.t==="topicDel"){ try{ await api("deleteTopic",{id:op.id}); }catch(err){ if(!(err&&err.code==="server"&&/not_empty/.test(err.message||""))) throw err; } }
      else if(op.t==="file") done=await syncLibFile(op.id);
      else if(op.t==="fileDel") await api("deleteFile",{id:op.id});
      if(done){ S.outbox=S.outbox.filter(o=>o!==op); await persist(); }
      refreshPassive();
    }
    await pull();
    setSync("idle");
    if(S.outbox.length && !S.waitingWifi) kickSync(5000);   // changes made while this run was busy
  }catch(err){
    if(err&&err.code==="auth") setSync("auth");
    else if(err&&err.code==="none") setSync("none");
    else { setSync(navigator.onLine===false?"offline":"error"); kickSync(navigator.onLine===false?60000:30000); }
  }finally{ syncing=false; setProgress(null); holdWake(false); }
}

/* Saves one day: its text first (so others see it at once), then its waiting photos and videos. */
async function syncEntry(id){
  let e=S.map[id]; if(!e) return true;
  await api("save",{entry:cleanEntry(e)});
  let savedRev=e.updatedAt, deferred=false, uploaded=false;
  S.meta.up=S.meta.up||{};
  for(const m of (e.media||[]).filter(m=>m.pending)){
    const live=()=>{ const c=S.map[id]; return c && (c.media||[]).find(x=>x.cid===m.cid); };
    if(!S.map[id]) return true;
    if(!live()||!live().pending) continue;
    let driveId=S.meta.up[m.cid];
    if(!driveId){
      const blob=await IDB.get("blobs",m.cid);
      if(!blob){ const c=S.map[id]; c.media=c.media.filter(x=>x.cid!==m.cid); await persist(); continue; }
      if(m.kind==="video"||m.kind==="audio"){
        if(m.kind==="video" && wifiBlocked()){ deferred=true; S.waitingWifi=true; continue; }
        driveId=await uploadVideo(id,m.cid,blob);
        if(!driveId) continue;
      } else {
        const r=await api("upload",{clientId:m.cid,date:S.map[id].date,mimeType:blob.type||"image/jpeg",data:await blobToBase64(blob)},180000);
        driveId=r.file.id;
      }
      S.meta.up[m.cid]=driveId;
    }
    const x=live(); if(x){ x.id=driveId; delete x.pending; delete x.session; delete x.offset; }
    uploaded=true;
    await persist(); await IDB.del("blobs",m.cid); refreshPassive();
  }
  e=S.map[id]; if(!e) return true;
  if(uploaded || e.updatedAt!==savedRev) await api("save",{entry:cleanEntry(e)});
  return !deferred && !(e.media||[]).some(m=>m.pending && !(S.meta.up||{})[m.cid]);
}

/* Video upload with Drive's resumable protocol. The file goes up in small pieces;
   after an interruption Drive is asked how much it already has, and the upload continues from there. */
async function uploadVideo(id,cid,blob){
  const live=()=>{ const c=S.map[id]; return c && (c.media||[]).find(x=>x.cid===cid); };
  return uploadResumable({ blob,
    alive:()=>!!live(),
    get:k=>{ const x=live(); return x? x[k] : undefined; },
    set:async f=>{ const x=live(); if(x) Object.assign(x,f); await persist(); },
    start:()=>api("startVideo",{clientId:cid,date:S.map[id].date,mimeType:blob.type||(live()||{}).mime||"video/mp4",size:blob.size,origin:location.origin}),   // also voice notes
    finish:async fid=>{ await api("finishVideo",{id:fid}); return fid; } });
}
/* Drive's resumable protocol: the file goes up in small pieces; after an interruption Drive is
   asked how much it already has and the upload continues from there. o.get/o.set keep the
   session and offset on the owning record so a closed app resumes where it stopped. */
async function uploadResumable(o){
  const blob=o.blob, total=blob.size;
  const done=async fid=>{
    if(!fid){ const st=await api("videoStatus",{session:o.get("session"),total}); fid=st.id; }
    return await o.finish(fid);
  };
  holdWake(true);
  for(let round=0; round<3; round++){
    if(!o.alive()) return null;            // removed meanwhile
    if(!o.get("session")){
      const r=await o.start();
      if(r.status==="done") return await done(r.id);
      await o.set({session:r.session,offset:0});
    } else {
      const st=await api("videoStatus",{session:o.get("session"),total});
      if(st.status==="done") return await done(st.id);
      if(st.status==="expired"){ await o.set({session:null,offset:0}); continue; }
      await o.set({offset:st.offset});
    }
    let off=o.get("offset")||0;
    while(off<total){
      if(!o.alive()) return null;
      setProgress(off/total);
      const direct=(S.meta.videoMode||"direct")==="direct";
      const end=Math.min(total, off+(direct?CHUNK_DIRECT:CHUNK_PROXY));
      const piece=blob.slice(off,end);
      let res;
      if(direct){
        try{ res=await directPut(o.get("session"),off,end,total,piece); if(S.meta.directFails){ S.meta.directFails=0; } }
        catch(err){
          // the network, or a browser that won't send straight to Drive? Ask through the script.
          if(navigator.onLine===false) throw {code:"network"};
          res=await api("videoStatus",{session:o.get("session"),total});
          if(res.status==="incomplete" && res.offset<=off){
            S.meta.directFails=(S.meta.directFails||0)+1;
            if(S.meta.directFails>=2) S.meta.videoMode="proxy";   // from now on, send pieces through the script
          }
        }
      } else {
        res=await api("videoChunk",{session:o.get("session"),start:off,total,data:await blobToBase64(piece)},180000);
      }
      if(res.status==="done") return await done(res.id);
      if(res.status==="expired"){ await o.set({session:null,offset:0}); break; }
      off=res.offset; await o.set({offset:off});
    }
    if(o.get("session") && off>=total){ const st=await api("videoStatus",{session:o.get("session"),total}); if(st.status==="done") return await done(st.id); }
  }
  throw {code:"server",message:"upload_failed"};
}
/* a Library file: upload it (if still on the phone), then save its details */
async function syncLibFile(id){
  let f=S.lib.files[id]; if(!f) return true;
  if(f.pending){
    const blob=await IDB.get("blobs",id);
    if(!blob){ delete S.lib.files[id]; await persist(); return true; }
    if((f.mime||"").startsWith("video/") && wifiBlocked()){ S.waitingWifi=true; return false; }
    const fid=await uploadResumable({ blob,
      alive:()=>!!S.lib.files[id],
      get:k=>(S.lib.files[id]||{})[k],
      set:async v=>{ if(S.lib.files[id]) Object.assign(S.lib.files[id],v); await persist(); },
      start:()=>api("startFile",{clientId:id,topic:S.lib.files[id].topic||"",mimeType:f.mime||"application/octet-stream",size:blob.size,name:f.name,origin:location.origin}),
      finish:async x=>x });
    if(!fid) return true;
    f=S.lib.files[id]; if(!f) return true;
    f.driveId=fid; delete f.pending; delete f.session; delete f.offset; await persist(); await IDB.del("blobs",id);
  }
  f=S.lib.files[id]; if(!f) return true;
  const out={}; for(const k of ["id","topic","driveId","name","mime","size","title","note","entryId","addedAt"]) out[k]=f[k];
  await api("saveFile",{file:out});
  return true;
}
async function directPut(session,start,end,total,piece){
  const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),120000);
  try{
    const r=await fetch(session,{method:"PUT",headers:{"Content-Range":"bytes "+start+"-"+(end-1)+"/"+total},body:piece,signal:ctrl.signal});
    if(r.status===308){ const rg=r.headers.get("Range"); const m=rg&&/bytes=0-(\d+)/.exec(rg); return {status:"incomplete",offset:m?Number(m[1])+1:end}; }
    if(r.status===200||r.status===201){ let j={}; try{ j=await r.json(); }catch(e){} return {status:"done",id:j.id}; }
    if(r.status===404||r.status===410) return {status:"expired"};
    throw new Error("drive "+r.status);
  } finally { clearTimeout(tm); }
}
async function pull(){
  const r=await api("list",{});
  const pend=new Set(S.outbox.filter(o=>o.t!=="config").map(o=>o.id));
  const next={};
  for(const e of (r.entries||[])){ if(!e||!e.id) continue; next[e.id] = pend.has(e.id) ? S.map[e.id] : norm(e); }
  for(const id of pend){ if(S.map[id]) next[id]=S.map[id]; else delete next[id]; }
  for(const id in next) if(!next[id]) delete next[id];
  S.map=next;
  if(!S.outbox.some(o=>o.t==="config")) S.config=r.config||S.config;
  if(r.library){
    const lt={}, lf={};
    for(const tp of (r.library.topics||[])) if(tp&&tp.id) lt[tp.id]= pend.has(tp.id)? S.lib.topics[tp.id] : tp;
    for(const f of (r.library.files||[])) if(f&&f.id) lf[f.id]= pend.has(f.id)? S.lib.files[f.id] : f;
    for(const id of pend){ if(S.lib.topics[id]) lt[id]=S.lib.topics[id]; else if(id in lt && S.outbox.some(o=>o.id===id&&o.t==="topicDel")) delete lt[id];
                           if(S.lib.files[id]) lf[id]=S.lib.files[id]; else if(id in lf && S.outbox.some(o=>o.id===id&&o.t==="fileDel")) delete lf[id]; }
    for(const k in lt) if(!lt[k]) delete lt[k]; for(const k in lf) if(!lf[k]) delete lf[k];
    S.lib={topics:lt,files:lf};
  }
  S.meta.lastSync=new Date().toISOString(); S.meta.sheetUrl=r.sheetUrl; S.meta.folderUrl=r.folderUrl; S.meta.aiEnabled=!!r.aiEnabled; S.meta.strings=r.strings||{}; S.meta.scriptVersion=r.version||"";
  await persist(); refreshPassive(true);
}
function cleanEntry(e){ const c=JSON.parse(JSON.stringify(e)); c.media=(c.media||[]).filter(m=>m.id).map(m=>({id:m.id,cid:m.cid,kind:m.kind||"image"})); delete c.photos; return c; }
function setSync(s){ S.sync=s; renderSyncPill(); renderBanner(); }
window.addEventListener("online",()=>kickSync(500));
window.addEventListener("offline",()=>setSync("offline"));
if(navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener("change",()=>kickSync(1500));
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") kickSync(500); });
setInterval(()=>{ if(S.outbox.length && !syncing) kickSync(10); }, 120000);

/* ================================================================ chrome */
const ICONS = {
  journal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/></svg>',
  library:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>',
  stats:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  settings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>'
};
function renderChrome(){
  document.documentElement.lang=S.lang;
  const title=(S.config&&S.config.title)||t("appSub");
  $("#apptitle").innerHTML='<img src="icons/logo.svg" alt="" class="logo"><span>'+esc(t("appTitle"))+(title?"<small>"+esc(title)+"</small>":"")+'</span>';
  const langs=enabledLangs(), other=langs.length===2? langs.find(c=>c!==S.lang) : null;
  $("#langbtn").textContent= other? langInfo(other).short : langInfo(S.lang).short+" ▾";
  $("#langbtn").setAttribute("aria-label",t("langMenu"));
  $("#langbtn").style.display= langs.length>1? "" : "none";
  const v=currentView();
  $("#tabs").innerHTML=tab("journal",ICONS.journal,t("journal"),v)+
    '<a href="#add" class="addtab'+(v==="add"?" on":"")+'"><span class="plus">+</span><span>'+esc(t("add"))+'</span></a>'+
    tab("library",ICONS.library,t("library"),v)+tab("stats",ICONS.stats,t("stats"),v)+tab("settings",ICONS.settings,t("settings"),v);
  renderSyncPill(); renderBanner();
}
function tab(id,ic,label,v){ return '<a href="#'+id+'" class="'+(v===id?"on":"")+'">'+ic+'<span>'+esc(label)+'</span></a>'; }
function renderSyncPill(){
  const el=$("#syncpill"); if(!el) return;
  const n=S.outbox.length; let cls="ok", txt=t("syncOk");
  // with nothing of ours to send, a sync only fetches others' changes: stay quiet, just pulse the dot
  if(S.sync==="syncing" && !n && S.progress==null){ cls="ok checking"; txt= S.meta.lastSync? t("syncOk") : t("syncCheck"); }
  else if(S.sync==="syncing"){ cls="pending"; txt= S.progress!=null ? "⬆ "+S.progress+"%" : t("syncing"); }
  else if(S.sync==="none"){ cls="err"; txt=t("syncNone"); }
  else if(S.sync==="auth"){ cls="err"; txt=t("syncAuth"); }
  else if(S.sync==="offline"){ cls=n?"pending":""; txt=t("syncOffline")+(n?" · "+n:""); }
  else if(S.sync==="error"){ cls="err"; txt=t("syncErr")+(n?" · "+n:""); }
  else if(n){ cls="pending"; txt=n+" "+t("syncPending")+(S.waitingWifi?" · Wi-Fi":""); }
  el.className="syncpill "+cls; el.innerHTML='<span class="dot"></span>'+esc(txt);
}
$("#syncpill").addEventListener("click",()=>{ if(S.sync==="none"||S.sync==="auth"){ location.hash="settings"; } else kickSync(10); });
function renderBanner(){
  let h="";
  if(!S.storageOk) h+='<div class="banner warn">'+esc(t("storageWarn"))+'</div>';
  if(S.sync==="none") h+='<div class="banner warn">'+esc(t("setupBanner"))+'</div>';
  else if(S.sync==="auth") h+='<div class="banner warn">'+esc(t("authBanner"))+'</div>';
  else if(S.sync==="offline" && S.outbox.length) h+='<div class="banner">'+esc(t("offlineBanner"))+'</div>';
  else if(S.sync==="error") h+='<div class="banner warn">'+esc(t("errBanner"))+'</div>';
  $("#banner").innerHTML=h;
}
async function switchLang(code){ if(currentView()==="add") readFormSafe(); await setLang(code); route(true); }
$("#langbtn").addEventListener("click",async()=>{
  const langs=enabledLangs();
  if(langs.length===2) return switchLang(langs.find(c=>c!==S.lang)||langs[0]);
  const choice=await pickBox(t("langMenu"),langs.map(c=>({value:c,label:langInfo(c).name+(c!=="en"?"  ·  "+langInfo(c).english:"")})));
  if(choice) switchLang(choice);
});
function pickBox(title,opts){ return new Promise(res=>{
  const m=$("#picker"); m.querySelector("p").textContent=title;
  m.querySelector(".opts").innerHTML=opts.map(o=>'<button type="button" class="btn ghost block" data-v="'+esc(o.value)+'">'+esc(o.label)+'</button>').join("");
  m.style.display="flex";
  const done=v=>{ m.style.display="none"; m.onclick=null; res(v); };
  m.onclick=e=>{ const b=e.target.closest("[data-v]"); if(b) done(b.dataset.v); else if(e.target===m) done(null); };
});}

let toastT=null;
function toast(msg){ const el=$("#toast"); el.textContent=msg; el.style.display="block"; clearTimeout(toastT); toastT=setTimeout(()=>el.style.display="none",2800); }
function confirmBox(msg,yes,no){ return new Promise(res=>{
  $("#modalmsg").textContent=msg; $("#modalyes").textContent=yes; $("#modalno").textContent=no;
  const m=$("#modal"); m.style.display="flex";
  const done=v=>{ m.style.display="none"; $("#modalyes").onclick=null; $("#modalno").onclick=null; m.onclick=null; res(v); };
  $("#modalyes").onclick=()=>done(true); $("#modalno").onclick=()=>done(false); m.onclick=e=>{ if(e.target===m) done(false); };
});}

/* ================================================================ routing */
const VIEWS=["journal","add","library","stats","settings"];
function currentView(){ const h=(location.hash||"").slice(1); return VIEWS.includes(h)?h:"journal"; }
function route(keepDraft){
  renderChrome();
  const v=currentView();
  if(v==="journal") renderJournal();
  else if(v==="add") renderForm(keepDraft);
  else if(v==="stats") renderStats();
  else if(v==="library") renderLibrary();
  else renderSettings();
}
/* refresh views that only display data; never clobber a form being filled */
function refreshPassive(){ renderSyncPill(); renderBanner(); const v=currentView(); if(sheetOpen()) return; if(v==="journal"||v==="stats"||v==="library") route(); else if(v==="settings"&&!settingsDirty) route(); }
window.addEventListener("hashchange",()=>{ if(currentView()!=="journal") setPkBar(0,0);  if(currentView()!=="add"){ S.editing=null; S.draft=null; } settingsDirty=false; route(); window.scrollTo(0,0); });

/* ================================================================ media */
function driveId(p){ return p.id || (S.meta.up && S.meta.up[p.cid]) || ""; }
function photoSrc(p){ if(S.blobUrls[p.cid]) return S.blobUrls[p.cid]; const id=driveId(p); return id? "https://drive.google.com/thumbnail?id="+encodeURIComponent(id)+"&sz=w1200" : ""; }
function photoLink(p){ const id=driveId(p); return id? "https://drive.google.com/file/d/"+encodeURIComponent(id)+"/view" : photoSrc(p); }
/* small preview tile for a photo or video (journal and form) */
function mediaTile(m){
  if(m.kind==="audio") return '<span class="at">🎙<small>'+(m.dur?esc(fmtDur(m.dur)):"")+'</small></span>';
  if(m.kind==="video"){
    if(S.blobUrls[m.cid]) return '<span class="vt"><video src="'+esc(S.blobUrls[m.cid])+'#t=0.5" preload="metadata" muted playsinline></video><i>▶</i></span>';
    const id=driveId(m); if(!id) return "";
    return '<span class="vt"><img src="'+esc(photoSrc(m))+'" loading="lazy" alt="" onerror="this.style.visibility=\'hidden\'"><i>▶</i></span>';
  }
  const src=photoSrc(m); return src? '<img src="'+esc(src)+'" loading="lazy" alt="" onerror="this.style.visibility=\'hidden\'">' : "";
}
/* full-size view when a day is opened */
function mediaFull(m){
  const id=driveId(m);
  if(m.kind==="audio"){
    if(S.blobUrls[m.cid]) return '<div class="afull">🎙 <audio src="'+esc(S.blobUrls[m.cid])+'" controls preload="metadata"></audio></div>';
    return id? '<iframe class="aframe" src="https://drive.google.com/file/d/'+esc(encodeURIComponent(id))+'/preview" loading="lazy"></iframe>' : "";
  }
  if(m.kind==="video"){
    return S.blobUrls[m.cid]||id? vplayer(S.blobUrls[m.cid],id) : "";
  }
  const src=photoSrc(m); if(!src) return "";
  return '<img src="'+esc(src)+'" loading="lazy" alt="">';
}
async function shrinkImage(file){
  const bmp = await createImageBitmap(file);
  const max=1600, sc=Math.min(1,max/Math.max(bmp.width,bmp.height));
  const c=document.createElement("canvas"); c.width=Math.round(bmp.width*sc); c.height=Math.round(bmp.height*sc);
  c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
  if(bmp.close) bmp.close();
  return await new Promise((r,j)=>c.toBlob(b=>b?r(b):j(new Error("toBlob")),"image/jpeg",0.8));
}

/* a slim bar above the bottom tabs while collected trash waits for pickup: counts + one button */
function setPkBar(n,d){
  const bar=$("#pkbar"); if(!bar) return;
  if(!(n>0) || currentView()!=="journal"){ bar.innerHTML=""; document.body.classList.remove("haspk"); return; }
  bar.innerHTML='<div class="pkin"><span class="pkc" title="'+esc(t("stWaiting"))+'"><i></i>🚛 '+esc(t("pkBarCount").replace("{n}",fmt(n,0)).replace("{d}",fmt(d,0)))+'</span><button type="button" class="btn" id="pk_new">'+esc(t("pkRecord"))+'</button></div>';
  document.body.classList.add("haspk");
  $("#pk_new").onclick=()=>{ S.editing=null; S.draft=blankEntry(); S.draft.type="pickup"; location.hash="add"; };
}

/* ================================================================ video player */
/* The browser's own controls put a big play button over the middle of the picture. This player
   keeps a slim bar along the bottom (play, time, seek, sound, full screen) that fades while playing.
   Videos only in Drive stream straight from Drive; if Drive won't hand the file over (very large
   files), Drive's own player is used instead. */
function vplayer(local,drive,lazy){
  const src= local || (drive? "https://drive.google.com/uc?export=download&id="+encodeURIComponent(drive) : "");
  const fb= drive? "https://drive.google.com/file/d/"+encodeURIComponent(drive)+"/preview" : "";
  return '<div class="vp" data-fb="'+esc(fb)+'"><video '+(lazy?'data-src':'src')+'="'+esc(src)+(local?"#t=0.1":"")+'" playsinline preload="'+(local?"metadata":"none")+'"></video>'+
    '<button type="button" class="vp-big" data-vp="play" aria-label="▶">▶</button>'+
    '<div class="vp-bar"><button type="button" data-vp="play" class="vp-pp" aria-label="▶">▶</button><span class="vp-t">0:00</span>'+
    '<input type="range" class="vp-seek" min="0" max="1000" value="0" aria-label="seek"><span class="vp-d">'+(local?"":"")+'</span>'+
    '<button type="button" data-vp="mute" class="vp-m" aria-label="sound">🔊</button><button type="button" data-vp="fs" aria-label="full screen">⛶</button></div></div>';
}
(function(){
  const box=v=>v&&v.closest&&v.closest(".vp");
  const show=b=>{ b.classList.add("ui"); clearTimeout(b._h); const v=b.querySelector("video"); if(v&&!v.paused) b._h=setTimeout(()=>b.classList.remove("ui"),2500); };
  const sync=b=>{ const v=b.querySelector("video"); if(!v) return; const playing=!v.paused&&!v.ended;
    b.classList.toggle("playing",playing); b.querySelector(".vp-pp").textContent=playing?"❚❚":"▶";
    b.querySelector(".vp-m").textContent=v.muted||v.volume===0?"🔇":"🔊";
    const d=isFinite(v.duration)?v.duration:0; b.querySelector(".vp-t").textContent=fmtDur(v.currentTime)+(d?" / "+fmtDur(d):"");
    if(!b._drag) b.querySelector(".vp-seek").value=d? Math.round(v.currentTime/d*1000):0; };
  const fallback=b=>{ const fb=b.dataset.fb; if(!fb){ b.classList.add("broken"); return; }
    b.outerHTML='<iframe src="'+esc(fb)+'" allow="autoplay; fullscreen" allowfullscreen></iframe>'; };
  const ensure=v=>{ if(!v.getAttribute("src")&&v.dataset.src){ v.src=v.dataset.src; } };
  document.addEventListener("click",ev=>{
    const btn=ev.target.closest("[data-vp]"), b=box(ev.target); if(!b) return;
    ev.stopPropagation(); const v=b.querySelector("video");
    if(!btn){ if(ev.target.tagName==="VIDEO"){ if(b.classList.contains("ui")||v.paused){ v.paused? (ensure(v),v.play()) : v.pause(); } show(b); } return; }
    const a=btn.dataset.vp;
    if(a==="play"){ ensure(v); if(v.paused||v.ended) v.play().catch(()=>fallback(b)); else v.pause(); }
    else if(a==="mute"){ v.muted=!v.muted; }
    else if(a==="fs"){ const el=b; if(document.fullscreenElement) document.exitFullscreen(); else if(el.requestFullscreen) el.requestFullscreen().catch(()=>{}); else if(v.webkitEnterFullscreen) v.webkitEnterFullscreen(); }
    show(b); sync(b);
  },true);
  for(const t of ["play","pause","ended","timeupdate","loadedmetadata","volumechange"])
    document.addEventListener(t,ev=>{ const b=box(ev.target); if(b&&ev.target.tagName==="VIDEO"){ sync(b); if(t==="play"){ show(b); b.classList.add("started"); } if(t==="pause"||t==="ended") b.classList.add("ui"); } },true);
  document.addEventListener("error",ev=>{ const b=box(ev.target); if(b&&ev.target.tagName==="VIDEO"&&ev.target.getAttribute("src")) fallback(b); },true);
  document.addEventListener("input",ev=>{ if(!ev.target.classList||!ev.target.classList.contains("vp-seek")) return; const b=box(ev.target), v=b.querySelector("video");
    b._drag=true; const d=isFinite(v.duration)?v.duration:0; if(d) v.currentTime=ev.target.value/1000*d; show(b); },true);
  document.addEventListener("change",ev=>{ if(ev.target.classList&&ev.target.classList.contains("vp-seek")){ const b=box(ev.target); if(b) b._drag=false; } },true);
  document.addEventListener("pointerdown",ev=>{ const b=box(ev.target); if(b) show(b); },true);
})();

/* ================================================================ version */
/* Bump APP_VERSION together with VERSION in sw.js for every release (tools/bump.sh does both). */
const APP_VERSION="v41", APP_DATE="2026-11-14";
async function latestVersion(){
  try{ const r=await fetch("sw.js?check="+Date.now(),{cache:"no-store"}); const m=/VERSION\s*=\s*"([^"]+)"/.exec(await r.text()); return m?m[1]:null; }catch(e){ return null; }
}
function versionCard(){
  return '<div class="card"><h3>'+esc(t("aboutT"))+'</h3><div class="verrow"><span>'+esc(t("appVersion"))+' <b>'+esc(APP_VERSION)+'</b> · '+esc(fmtDate(APP_DATE,{day:"numeric",month:"long",year:"numeric"}))+'</span><span id="ver_state" class="muted small">'+esc(t("verChecking"))+'</span></div>'+
    '<div class="verrow small muted"><span>'+esc(t("scriptVersion"))+' <b>'+esc(S.meta.scriptVersion||"—")+'</b></span></div></div>';
}
async function checkVersion(){
  const el=$("#ver_state"); if(!el) return;
  const v=await latestVersion(); if(!$("#ver_state")) return;
  if(!v){ el.textContent=t("verOffline"); return; }
  if(v===APP_VERSION){ el.innerHTML='<span style="color:var(--green)">✓ '+esc(t("verLatest"))+'</span>'; return; }
  el.innerHTML='<button type="button" class="linkbtn" id="ver_up">'+esc(t("verUpdate").replace("{v}",v))+'</button>';
  $("#ver_up").onclick=async()=>{ el.textContent=t("verChecking");
    try{ const reg=await navigator.serviceWorker.getRegistration(); if(reg){ await reg.update(); } }catch(e){}
    setTimeout(()=>location.reload(),1500); };
}

/* ================================================================ share a day */
/* A short post in the reader's language (with the day's photos where the phone can attach them),
   handed to the phone's share sheet: WhatsApp, Instagram, Facebook, X, … */
function shareText(e,withNames){
  const nums=dayNumbers(), L=[];
  if(e.type==="pickup"){
    L.push("🚛 "+t("pkShort")+" · "+fmtDate(e.date,{day:"numeric",month:"long",year:"numeric"}));
    const col=collection(); L.push(t("pkBarCount").replace("{n}",fmt(pickupItems(e,col),0)).replace("{d}",fmt((e.covers||[]).length,0)));
    if(agencyLabel(e)) L.push(agencyLabel(e));
  } else {
    L.push("🌿 "+t("appTitle")+" · "+t("day")+" "+fmt(nums[e.id],0)+" · "+fmtDate(e.date,{weekday:"long",day:"numeric",month:"long",year:"numeric"}));
    if(e.place) L.push("📍 "+txPlain(e.place));
    const parts=[]; for(const it of items()){ const c=num((e.counts||{})[it.key]); if(c) parts.push(itemName(it)+" "+fmt(c,0)); }
    for(const x of (e.extras||[])) if(num(x.count)&&x.name) parts.push(extraName(x)+" "+fmt(num(x.count),0));
    L.push("🗑️ "+t("shareTotal").replace("{n}",fmt(entryTotal(e),0)).replace(/[.।]\s*$/,"")+(parts.length?":":""));
    if(parts.length) L.push(parts.map(p=>"• "+p).join("\n"));
    const extra=[]; if(num(e.distanceKm)) extra.push(fmt(num(e.distanceKm))+" km"); const m=minutes(e); if(m) extra.push(fmt(m/60)+" h");
    if(extra.length) L.push("🚶 "+extra.join(" · "));
    if(withNames && (e.people||[]).length) L.push("👥 "+e.people.map(txPlain).join(", ")+(num(e.others)?" + "+fmt(num(e.others),0):""));
    else if(peopleCount(e)) L.push("👥 "+t("sharePeople").replace("{n}",fmt(peopleCount(e),0)));
  }
  if((e.notes||"").trim()) L.push("“"+txPlain(e.notes)+"”");
  L.push("#plogging #ಜಲಗಾರ");
  return L.join("\n");
}
async function dayFiles(e){
  const ms=dayMedia(e).filter(m=>m.kind==="image"||!m.kind).slice(0,6), files=[], need=[];
  for(const m of ms){
    try{ const b=await IDB.get("blobs",m.cid); if(b){ files.push(new File([b],(m.name||m.cid)+".jpg",{type:b.type||"image/jpeg"})); continue; } }catch(x){}
    if(driveId(m)) need.push(driveId(m));
  }
  if(need.length && apiUrl() && navigator.onLine!==false){
    try{ const r=await api("shareMedia",{ids:need},60000);
      for(const f of (r.files||[])){ const bin=atob(f.data), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); files.push(new File([u],f.name||"photo.jpg",{type:f.mime||"image/jpeg"})); } }
    catch(x){ /* offline: share the text alone */ }
  }
  return files;
}
function shareDay(id){
  const e=S.map[id]; if(!e) return;
  const nPhotos=dayMedia(e).filter(m=>m.kind==="image"||!m.kind).length;
  const canFiles=!!(navigator.canShare && navigator.canShare({files:[new File(["x"],"x.jpg",{type:"image/jpeg"})]}));
  const hasNames=(e.people||[]).length>0;
  const body='<textarea id="sh_text" rows="9" style="font-size:.9rem"></textarea>'+
    (hasNames?'<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="sh_names" checked> '+esc(t("shareNames"))+'</label>':"")+
    (nPhotos&&canFiles?'<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="sh_ph" checked> '+esc(t("sharePhotos").replace("{n}",fmt(Math.min(6,nPhotos),0)))+'</label>':"")+
    '<div class="row" style="margin-top:14px;flex-wrap:wrap"><button type="button" class="btn ghost" data-x>'+esc(t("cancel"))+'</button>'+
    '<button type="button" class="btn ghost" data-copy>'+esc(t("shareCopy"))+'</button>'+
    (navigator.share?'<button type="button" class="btn" data-go>↗ '+esc(t("share"))+'</button>':'<a class="btn" data-wa target="_blank" rel="noopener">WhatsApp</a>')+'</div>';
  openSheet(t("share"),body,(el,close)=>{
    const ta=el.querySelector("#sh_text"), nm=el.querySelector("#sh_names");
    const fill=()=>{ ta.value=shareText(e,!nm||nm.checked); const wa=el.querySelector("[data-wa]"); if(wa) wa.href="https://wa.me/?text="+encodeURIComponent(ta.value); };
    fill(); if(nm) nm.onchange=fill; ta.oninput=()=>{ const wa=el.querySelector("[data-wa]"); if(wa) wa.href="https://wa.me/?text="+encodeURIComponent(ta.value); };
    el.querySelector("[data-x]").onclick=close;
    el.querySelector("[data-copy]").onclick=async()=>{ try{ await navigator.clipboard.writeText(ta.value); toast(t("shareCopied")); }catch(x){ ta.select(); document.execCommand&&document.execCommand("copy"); toast(t("shareCopied")); } };
    const go=el.querySelector("[data-go]");
    if(go) go.onclick=async()=>{
      go.disabled=true; const old=go.textContent; const ph=el.querySelector("#sh_ph");
      let files=[]; if(ph&&ph.checked){ go.textContent="…"; files=await dayFiles(e); }
      const data={text:ta.value}; if(files.length && navigator.canShare({files})) data.files=files;
      try{ await navigator.share(data); close(); }
      catch(err){ if(err&&err.name!=="AbortError"){ try{ await navigator.share({text:ta.value}); close(); }catch(x){} } }
      go.disabled=false; go.textContent=old;
    };
  });
}

/* ================================================================ media viewer + photos view */
/* the media of a day that can actually be shown (local copy or uploaded) */
function dayMedia(e){ return (e.media||[]).filter(m=> m.kind==="video"||m.kind==="audio" ? !!(S.blobUrls[m.cid]||driveId(m)) : !!photoSrc(m)); }
function dayTitle(e,nums){
  const d=fmtDate(e.date,{weekday:"short",day:"numeric",month:"short",year:"numeric"});
  return e.type==="pickup"? "🚛 "+t("pkShort")+" · "+d : e.type==="rest"? t("restLabel")+" · "+d : t("day")+" "+fmt(nums[e.id],0)+" · "+d;
}
function journalSwitch(){
  const m=S.jmode==="photos";
  return '<div class="seg" role="tablist"><button type="button" data-jmode="list" class="'+(m?"":"on")+'">'+esc(t("jList"))+'</button><button type="button" data-jmode="photos" class="'+(m?"on":"")+'">'+esc(t("jPhotos"))+'</button></div>';
}
function bindJournalSwitch(){ $$("[data-jmode]").forEach(b=>b.addEventListener("click",()=>{ if(S.jmode===b.dataset.jmode) return; S.jmode=b.dataset.jmode; renderJournal(); window.scrollTo(0,0); })); }
function galleryHtml(list,nums){
  let h="", n=0, lastMonth="";
  for(const e of list){
    const ms=dayMedia(e); if(!ms.length) continue;
    const mo=e.date.slice(0,7);
    if(mo!==lastMonth){ lastMonth=mo; h+='<div class="monthhd">'+esc(fmtDate(mo+"-01",{month:"long",year:"numeric"}))+'</div>'; }
    h+='<div class="gday"><button type="button" class="gdayhd" data-gday="'+esc(e.id)+'"><span>'+esc(dayTitle(e,nums))+'</span><span class="muted">'+fmt(ms.length,0)+' ›</span></button><div class="ggrid">'+
      ms.map(m=>'<button type="button" class="gtile" data-gi="'+(n++)+'">'+mediaTile(m)+'</button>').join("")+'</div></div>';
  }
  return h || '<div class="empty">'+esc(t("noPhotos"))+'</div>';
}
function bindGallery(list,nums){
  const all=[]; for(const e of list) for(const m of dayMedia(e)) all.push({m,e});
  $$("[data-gi]").forEach(b=>b.addEventListener("click",()=>openViewer(all,+b.dataset.gi,nums,true)));
  $$("[data-gday]").forEach(b=>b.addEventListener("click",()=>goToDay(b.dataset.gday)));
}
function goToDay(id){ S.jmode="list"; S.openId=id; S.scrollTo=id; if(currentView()!=="journal") location.hash="journal"; else renderJournal(); }

/* full-screen viewer: swipe between items, pinch or double-tap to zoom photos */
function openViewer(items,start,nums,showDay){
  if(!items.length) return;
  const v=$("#viewer");
  v.innerHTML='<div class="vtop"><span class="vcount"></span><span class="vcap"></span><button type="button" class="vx" aria-label="'+esc(t("close"))+'">✕</button></div>'+
    '<div class="vtrack">'+items.map(({m})=>'<div class="vslide">'+viewerSlide(m)+'</div>').join("")+'</div>'+
    '<button type="button" class="vnav prev" aria-label="‹">‹</button><button type="button" class="vnav next" aria-label="›">›</button>'+
    (showDay?'<div class="vbot"><button type="button" class="btn ghost vday">'+esc(t("openDay"))+'</button></div>':"");
  v.style.display="block"; document.body.classList.add("noscroll");
  const track=v.querySelector(".vtrack"), slides=[...track.children];
  let cur=-1;
  const show=i=>{
    i=Math.max(0,Math.min(items.length-1,i));
    if(i!==cur){ slides.forEach((sl,j)=>{ if(j!==i){ const vd=sl.querySelector("video"); if(vd) vd.pause(); resetZoom(sl); } });
      // load iframes lazily: only the visible one and its neighbours
      slides.forEach((sl,j)=>{ const f=sl.querySelector("iframe[data-src]"); if(f&&Math.abs(j-i)<=1&&!f.src) f.src=f.dataset.src; const vv=sl.querySelector("video[data-src]"); if(vv&&Math.abs(j-i)<=1&&!vv.getAttribute("src")){ vv.preload="metadata"; vv.src=vv.dataset.src; } }); }
    cur=i;
    v.querySelector(".vcount").textContent=fmt(i+1,0)+" / "+fmt(items.length,0);
    v.querySelector(".vcap").textContent=dayTitle(items[i].e,nums);
    v.querySelector(".prev").style.visibility=i>0?"visible":"hidden";
    v.querySelector(".next").style.visibility=i<items.length-1?"visible":"hidden";
  };
  const go=i=>{ track.scrollTo({left:Math.max(0,Math.min(items.length-1,i))*track.clientWidth,behavior:"smooth"}); };
  requestAnimationFrame(()=>{ track.scrollLeft=start*track.clientWidth; show(start); });
  let st; track.addEventListener("scroll",()=>{ clearTimeout(st); st=setTimeout(()=>show(Math.round(track.scrollLeft/track.clientWidth)),60); });
  const close=()=>{ v.querySelectorAll("video").forEach(x=>x.pause()); v.style.display="none"; v.innerHTML=""; document.body.classList.remove("noscroll"); document.removeEventListener("keydown",key); window.removeEventListener("popstate",pop); };
  const key=ev=>{ if(ev.key==="Escape") history.back(); else if(ev.key==="ArrowRight") go(cur+1); else if(ev.key==="ArrowLeft") go(cur-1); };
  const pop=()=>close();
  document.addEventListener("keydown",key);
  history.pushState({viewer:1},"",location.href); window.addEventListener("popstate",pop);   // the phone's Back button closes the viewer
  v.querySelector(".vx").onclick=()=>history.back();
  v.querySelector(".prev").onclick=()=>go(cur-1); v.querySelector(".next").onclick=()=>go(cur+1);
  const vd=v.querySelector(".vday"); if(vd) vd.onclick=()=>{ const id=items[cur].e.id; history.back(); setTimeout(()=>goToDay(id),30); };
  slides.forEach(sl=>{ const img=sl.querySelector("img.vimg"); if(img) zoomable(img,track); });
}
function viewerSlide(m){
  const id=driveId(m);
  if(m.kind==="audio"){
    if(S.blobUrls[m.cid]) return '<div class="vaudio">🎙<audio src="'+esc(S.blobUrls[m.cid])+'" controls preload="metadata"></audio></div>';
    return '<iframe class="aframe" data-src="https://drive.google.com/file/d/'+esc(encodeURIComponent(id))+'/preview"></iframe>';
  }
  if(m.kind==="video"){
    return vplayer(S.blobUrls[m.cid],id,true);
  }
  const src= S.blobUrls[m.cid] || "https://drive.google.com/thumbnail?id="+encodeURIComponent(id)+"&sz=w2000";
  return '<img class="vimg" src="'+esc(src)+'" alt="" draggable="false">';
}
function resetZoom(sl){ const img=sl.querySelector("img.vimg"); if(img&&img._z){ img._z.reset(); } }
function zoomable(img,track){
  let sc=1, tx=0, ty=0; const pts=new Map(); let base=null, lastTap=0;
  const apply=()=>{ img.style.transform="translate("+tx+"px,"+ty+"px) scale("+sc+")"; track.classList.toggle("locked",sc>1.01); img.style.touchAction=sc>1.01?"none":"pan-x"; };
  const clamp=()=>{ const r=img.parentElement.getBoundingClientRect(); const mx=r.width*(sc-1)/2, my=r.height*(sc-1)/2; tx=Math.max(-mx,Math.min(mx,tx)); ty=Math.max(-my,Math.min(my,ty)); };
  img._z={reset:()=>{ sc=1; tx=0; ty=0; apply(); }};
  img.addEventListener("pointerdown",ev=>{
    pts.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
    if(pts.size===1){ const now=Date.now(); if(now-lastTap<300){ if(sc>1.01){ sc=1; tx=0; ty=0; } else { sc=2.5; const r=img.getBoundingClientRect(); tx=(r.left+r.width/2-ev.clientX)*1.5; ty=(r.top+r.height/2-ev.clientY)*1.5; clamp(); } apply(); lastTap=0; return; } lastTap=now; }
    if(pts.size===2||sc>1.01){ try{ img.setPointerCapture(ev.pointerId); }catch(e){} }
    base=snap();
  });
  const snap=()=>{ const a=[...pts.values()]; return {sc,tx,ty, d: a.length>1? Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y):0, cx:a.reduce((s,p)=>s+p.x,0)/a.length, cy:a.reduce((s,p)=>s+p.y,0)/a.length, n:a.length}; };
  img.addEventListener("pointermove",ev=>{
    if(!pts.has(ev.pointerId)) return; pts.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
    const now=snap(); if(!base||now.n!==base.n){ base=now; return; }
    if(now.n===2&&base.d>0){ sc=Math.max(1,Math.min(5,base.sc*now.d/base.d)); tx=base.tx+(now.cx-base.cx); ty=base.ty+(now.cy-base.cy); clamp(); apply(); ev.preventDefault(); }
    else if(now.n===1&&sc>1.01){ tx=base.tx+(now.cx-base.cx); ty=base.ty+(now.cy-base.cy); clamp(); apply(); ev.preventDefault(); }
  });
  const up=ev=>{ pts.delete(ev.pointerId); base=snap(); if(sc<1.05){ sc=1; tx=0; ty=0; apply(); } };
  img.addEventListener("pointerup",up); img.addEventListener("pointercancel",up);
  img.addEventListener("wheel",ev=>{ ev.preventDefault(); sc=Math.max(1,Math.min(5,sc*(ev.deltaY<0?1.15:1/1.15))); if(sc<1.05){ sc=1; tx=0; ty=0; } clamp(); apply(); },{passive:false});
  apply();
}

/* ================================================================ journal */
function renderJournal(){
  const nums=dayNumbers();
  const list=entries().sort((a,b)=>(b.date+(b.start||"")+b.id).localeCompare(a.date+(a.start||"")+a.id));
  if(!list.length){
    $("#view").innerHTML='<div class="empty"><p>'+esc(t("noEntries"))+'</p><a class="btn" href="#add" style="display:inline-block;text-decoration:none">'+esc(t("firstEntry"))+'</a></div>';
    return;
  }
  const plog=list.filter(isPlog);
  const tot=plog.reduce((s,e)=>s+entryTotal(e),0);
  const col=collection();
  const wDays=Object.values(col).filter(r=>r.waitingCount>0), wItems=wDays.reduce((s,r)=>s+r.waitingCount,0);
  // one slim line: the totals so far, and the Days | Photos switch
  let h='<div class="jhead"><span class="jsum">'+esc(t("jSum")).replace("{d}","<b>"+fmt(plog.length,0)+"</b>").replace("{n}","<b>"+fmt(tot,0)+"</b>")+'</span>'+journalSwitch()+'</div>';
  if(S.jmode==="photos"){ $("#view").innerHTML=h+galleryHtml(list,nums); bindJournalSwitch(); bindGallery(list,nums); setPkBar(0,0); return; }
  setPkBar(wItems,wDays.length);

  let lastMonth="";
  for(const e of list){
    const mo=e.date.slice(0,7);
    if(mo!==lastMonth){ lastMonth=mo; h+='<div class="monthhd">'+esc(fmtDate(mo+"-01",{month:"long",year:"numeric"}))+'</div>'; }
    h+=entryCard(e,nums[e.id],col);
  }
  $("#view").innerHTML=h;
  bindJournalSwitch();
  $$("[data-view]").forEach(b=>b.addEventListener("click",ev=>{ ev.stopPropagation(); const e=S.map[b.dataset.view]; if(!e) return;
    openViewer(dayMedia(e).map(m=>({m,e})), +b.dataset.vi||0, nums, false); }));
  if(S.scrollTo){ const el=document.querySelector('.entry[data-id="'+CSS.escape(S.scrollTo)+'"]'); S.scrollTo=null; if(el) el.scrollIntoView({block:"start"}); }
  $$("[data-libfile]").forEach(b=>b.addEventListener("click",()=>{ const f=S.lib.files[b.dataset.libfile]; if(!f) return; S.libAt=f.topic||""; S.libQ=""; location.hash="library"; setTimeout(()=>openFile(f.id),50); }));
  $$(".entry").forEach(el=>el.addEventListener("click",ev=>{
    if(ev.target.closest("button,a,video,iframe")) return;
    S.openId = S.openId===el.dataset.id? null : el.dataset.id; renderJournal();
  }));
  $$("[data-edit]").forEach(b=>b.addEventListener("click",()=>{ S.editing=b.dataset.edit; S.draft=null; location.hash="add"; }));
  $$("[data-share]").forEach(b=>b.addEventListener("click",ev=>{ ev.stopPropagation(); shareDay(b.dataset.share); }));
  $$("[data-del]").forEach(b=>b.addEventListener("click",async()=>{
    if(!await confirmBox(t("confirmDel"),t("yes"),t("no"))) return;
    await localDelete(b.dataset.del); toast(t("deleted")); renderJournal();
  }));
}
function entryCard(e,n,col){
  const open=S.openId===e.id, pend=isPending(e.id)?'<span class="pendbadge">⏳ '+esc(t("pendingTag"))+'</span>':"";
  col=col||collection();
  if(e.type==="pickup") return pickupCard(e,col,open,pend);
  if(e.type==="rest"){
    return '<div class="card entry rest'+(open?" open":"")+'" data-id="'+esc(e.id)+'"><div class="hd"><span class="dayno">'+esc(t("restLabel"))+'</span><span class="dt">'+esc(fmtDate(e.date))+'</span>'+pend+'</div>'+
      (e.notes?'<div class="notes">'+tx(e.notes)+'</div>':"")+actions(e)+'</div>';
  }
  const m=minutes(e), meta=[];
  if(e.place) meta.push("📍 "+tx(e.place));
  if(e.start) meta.push("🕒 "+esc(e.start)+(e.end?"–"+esc(e.end):"")+(m!=null?" ("+esc(fmtDur(m))+")":""));
  if(num(e.distanceKm)) meta.push("🚶 "+fmt(num(e.distanceKm))+" "+esc(t("km")));
  const pc=peopleCount(e); if(pc) meta.push("👥 "+fmt(pc,0)+" "+esc(t("ppl")));
  if(num(e.bags)) meta.push("🪣 "+fmt(num(e.bags),0));
  if(num(e.weightKg)) meta.push("⚖️ "+fmt(num(e.weightKg))+" kg");
  const cs=col[e.id];
  const status= !cs||cs.status==="empty"||cs.status==="none" ? "" : cs.status==="all" ? '<span class="pkst done">✓ '+esc(t("stDone"))+' · '+esc(fmtDate(cs.last.date,{day:"numeric",month:"short"}))+(agencyLabel(cs.last)?' · '+esc(agencyLabel(cs.last)):"")+'</span>'
    : cs.status==="part" ? '<span class="pkst part">◐ '+esc(t("stPart"))+' · '+fmt(cs.waitingCount,0)+' '+esc(t("pcs"))+'</span>' : '<span class="pkst wait">🕓 '+esc(t("stWaiting"))+'</span>';
  const st=!cs||cs.status==="empty"? "" : cs.status;
  const totCls= st==="all"?" st-done" : st==="part"?" st-part" : st==="none"?" st-wait" : "";
  const totTip= st==="all"? t("stDone") : st==="part"? t("stPart")+" · "+fmt(cs.waitingCount,0)+" "+t("pcs") : st==="none"? t("stWaiting") : "";
  const chips=[];
  for(const it of items()){ const c=num((e.counts||{})[it.key]); if(c) chips.push('<span class="chip static">'+esc(itemName(it))+mtMark(itemMT(it))+' <b>'+fmt(c,0)+'</b></span>'); }
  for(const k in (e.counts||{})){ if(!itemByKey(k) && num(e.counts[k])) chips.push('<span class="chip static">'+esc(k)+' <b>'+fmt(num(e.counts[k]),0)+'</b></span>'); }
  for(const x of (e.extras||[])){ if(x.name) chips.push('<span class="chip static">'+esc(extraName(x))+mtMark(extraMT(x))+' <b>'+fmt(num(x.count),0)+'</b></span>'); }
  const ppl=(e.people||[]).length? '<div class="small muted" style="margin-top:6px">'+e.people.map(tx).join(", ")+(num(e.others)?" + "+fmt(num(e.others),0):"")+'</div>':"";
  const tiles=dayMedia(e).map((m,i)=>{ const h=open?mediaFull(m):mediaTile(m); return !h? "" : (m.kind==="video"||m.kind==="audio")&&open? h : '<button type="button" class="mtile" data-view="'+esc(e.id)+'" data-vi="'+i+'">'+h+'</button>'; }).filter(Boolean);
  const ph=tiles.length? '<div class="thumbs">'+tiles.join("")+'</div>':"";
  const vids=(e.videos||[]).map(v=>ytId(v.url)).filter(Boolean);
  const vh=vids.length? '<div class="vidrow">'+vids.map(id=>'<a href="https://youtu.be/'+esc(id)+'" target="_blank" rel="noopener"><img src="'+esc(ytThumb(id))+'" loading="lazy" alt=""></a>').join("")+'</div>':"";
  return '<div class="card entry'+(open?" open":"")+'" data-id="'+esc(e.id)+'"><div class="hd"><span class="dayno">'+esc(t("day"))+" "+fmt(n,0)+'</span><span class="dt">'+esc(fmtDate(e.date))+'</span>'+pend+'<span class="tot'+totCls+'" title="'+esc(totTip)+'">'+(totCls===" st-done"?"✓ ":"")+fmt(entryTotal(e),0)+'</span></div>'+
    (meta.length?'<div class="meta">'+meta.map(x=>"<span>"+x+"</span>").join("")+'</div>':"")+
    (chips.length?'<div class="chips">'+chips.join("")+'</div>':"")+(status&&open?'<div class="pkrow">'+status+'</div>':"")+ppl+
    (e.notes?'<div class="notes">'+tx(e.notes)+'</div>':"")+ph+vh+actions(e)+'</div>';
}
function linkedFiles(id){
  const fs=Object.values(S.lib.files).filter(f=>f.entryId===id); if(!fs.length) return "";
  return '<div class="chips" style="margin-top:8px">'+fs.map(f=>'<button type="button" class="chip static libjump" data-libfile="'+esc(f.id)+'">📎 '+esc(f.title?txPlain(f.title):f.name)+'</button>').join("")+'</div>';
}
function pickupCard(p,col,open,pend){
  const meta=[], n=pickupItems(p,col);
  if(p.start) meta.push("🕒 "+esc(p.start));
  meta.push("📅 "+fmt((p.covers||[]).length,0)+" "+esc(t("colDays")));
  if(num(p.bags)) meta.push("🪣 "+fmt(num(p.bags),0));
  if(num(p.weightKg)) meta.push("⚖️ "+fmt(num(p.weightKg))+" kg");
  const keys=(p.keys&&p.keys.length)? '<div class="chips">'+p.keys.map(k=>'<span class="chip static">'+esc(k==="_other"?t("pkOther"):itemName(itemByKey(k)||{key:k}))+'</span>').join("")+'</div>' : "";
  const days=open? '<div class="small muted" style="margin-top:6px">'+esc(t("pkCovers"))+': '+(p.covers||[]).map(id=>S.map[id]?esc(fmtDate(S.map[id].date,{day:"numeric",month:"short"})):"").filter(Boolean).join(", ")+'</div>' : "";
  const tiles=dayMedia(p).map((m,i)=>{ const h=open?mediaFull(m):mediaTile(m); return !h? "" : (m.kind==="video"||m.kind==="audio")&&open? h : '<button type="button" class="mtile" data-view="'+esc(p.id)+'" data-vi="'+i+'">'+h+'</button>'; }).filter(Boolean);
  return '<div class="card entry pickup'+(open?" open":"")+'" data-id="'+esc(p.id)+'"><div class="hd"><span class="dayno pk">🚛 '+esc(t("pkShort"))+'</span><span class="dt">'+esc(fmtDate(p.date))+'</span>'+pend+'<span class="tot">'+fmt(n,0)+'</span></div>'+
    (agencyLabel(p)?'<div class="pkwho">'+esc(agencyLabel(p))+'</div>':"")+
    '<div class="meta">'+meta.map(x=>"<span>"+x+"</span>").join("")+'</div>'+keys+days+
    (p.notes?'<div class="notes">'+tx(p.notes)+'</div>':"")+(tiles.length?'<div class="thumbs">'+tiles.join("")+'</div>':"")+actions(p)+'</div>';
}
function actions(e){ return (S.openId===e.id?linkedFiles(e.id):"")+'<div class="acts">'+(e.type!=="rest"?'<button class="btn ghost" type="button" data-share="'+esc(e.id)+'">↗ '+esc(t("share"))+'</button>':"")+'<button class="btn ghost" type="button" data-edit="'+esc(e.id)+'">'+esc(t("edit"))+'</button><button class="btn danger" type="button" data-del="'+esc(e.id)+'">'+esc(t("del"))+'</button></div>'; }

/* ================================================================ form */
function blankEntry(){
  const nums=dayNumbers(); const max=Object.values(nums).reduce((a,b)=>Math.max(a,b),0);
  return {id:null,type:"plog",date:todayStr(),dayNo:"",start:"",end:"",distanceKm:"",place:"",people:[],others:"",counts:{},extras:[],bags:"",weightKg:"",notes:"",media:[],videos:[],_suggestDay:max+1};
}
function renderForm(keepDraft){
  if(!S.draft || !keepDraft){
    if(S.editing && S.map[S.editing]){ const e=norm(JSON.parse(JSON.stringify(S.map[S.editing]))); S.draft=Object.assign(blankEntry(),e,{dayNo:e.dayNo||"",distanceKm:e.distanceKm==null?"":e.distanceKm,bags:e.bags==null?"":e.bags,weightKg:e.weightKg==null?"":e.weightKg,others:e.others||""}); }
    else { S.editing=null; if(!S.draft) S.draft=blankEntry(); }
  }
  const d=S.draft, rest=d.type==="rest";
  if(d.type==="pickup") return renderPickupForm(d);
  const placesDl=[...new Set(entries().map(e=>e.place).filter(Boolean))];
  const peopleAll=[...new Set(entries().flatMap(e=>e.people||[]))];
  const peopleDl=peopleAll.filter(p=>!(d.people||[]).includes(p));
  let h='<h2>'+esc(S.editing?t("editEntry"):t("newEntry"))+'</h2>';
  h+='<div class="seg"><button type="button" data-type="plog" class="'+(!rest?"on":"")+'">'+esc(t("plogDay"))+'</button><button type="button" data-type="rest" class="'+(rest?"on":"")+'">'+esc(t("restDay"))+'</button><button type="button" data-type="pickup">'+esc(t("pkType"))+'</button></div>';
  h+='<div class="card"><div class="row"><div class="field"><label class="f" for="f_date">'+esc(t("date"))+'</label><input type="date" id="f_date" max="'+todayStr()+'" value="'+esc(d.date)+'"></div>';
  if(!rest) h+='<div class="field" style="max-width:120px"><label class="f" for="f_dayno">'+esc(t("dayNo"))+'</label><input type="number" inputmode="numeric" id="f_dayno" min="1" value="'+esc(d.dayNo)+'" placeholder="'+esc(S.editing?(dayNumbers()[S.editing]||""):d._suggestDay)+'"></div>';
  h+='</div><div id="dupwarn" class="hint" style="color:var(--warn)"></div>';
  if(rest){
    h+='<div class="field"><label class="f" for="f_notes">'+esc(t("reason"))+'</label><input type="text" id="f_notes" value="'+esc(d.notes)+'" placeholder="'+esc(t("reasonPh"))+'"></div></div>';
  } else {
    h+='<div class="row"><div class="field"><label class="f" for="f_start">'+esc(t("start"))+'</label><input type="time" id="f_start" value="'+esc(d.start)+'"></div><div class="field"><label class="f" for="f_end">'+esc(t("end"))+'</label><input type="time" id="f_end" value="'+esc(d.end)+'"></div></div>';
    h+='<div class="row"><div class="field" style="max-width:130px"><label class="f" for="f_dist">'+esc(t("distance"))+'</label><input type="number" inputmode="decimal" step="0.1" min="0" id="f_dist" value="'+esc(d.distanceKm)+'"></div>';
    h+='<div class="field"><label class="f" for="f_place">'+esc(t("place"))+'</label><input type="text" id="f_place" list="dl_place" value="'+esc(d.place)+'" placeholder="'+esc(t("placePh"))+'"><datalist id="dl_place">'+placesDl.map(p=>'<option value="'+esc(p)+'">').join("")+'</datalist></div></div></div>';
    h+='<div class="card"><label class="f">'+esc(t("people"))+'</label><div class="chips">'+(d.people||[]).map((p,i)=>'<span class="chip">'+txMark(p)+'<button type="button" data-rmp="'+i+'" aria-label="remove">✕</button></span>').join("")+'</div>';
    h+='<div class="row" style="margin-bottom:10px"><input type="text" id="f_person" list="dl_people" placeholder="'+esc(t("personPh"))+'" enterkeyhint="done"><button class="btn ghost" type="button" id="addperson" style="flex:none">'+esc(t("addBtn"))+'</button></div><datalist id="dl_people">'+peopleDl.map(p=>'<option value="'+esc(p)+'">').join("")+'</datalist>';
    if(peopleDl.length) h+='<div class="chips">'+peopleDl.slice(0,12).map(p=>'<button type="button" class="chip static" style="border:0" data-addp="'+esc(p)+'">+ '+txMark(p)+'</button>').join("")+'</div>';
    h+='<div class="item"><div class="nm">'+esc(t("others"))+'</div>'+stepper("others",d.others)+'</div></div>';
    h+='<div class="card"><h3>'+esc(t("items"))+'</h3>'+aiBox(d);
    for(const it of items()){ if(it.hidden && !num((d.counts||{})[it.key])) continue;
      h+='<div class="item"><div class="nm">'+esc(itemName(it))+(it.hazard?'<span class="haz">⚠</span>':"")+'</div>'+stepper("c:"+it.key,(d.counts||{})[it.key])+'</div>'; }
    h+='<div style="margin-top:12px"><label class="f">'+esc(t("extras"))+'</label><div>'+(d.extras||[]).map((x,i)=>'<div class="extra"><input type="text" data-xn="'+i+'" value="'+esc(extraName(x))+'" placeholder="'+esc(t("extraName"))+'"'+(extraMT(x)?' class="mtin" title="'+esc(t("mtNote"))+'"':"")+'><input type="number" inputmode="numeric" min="0" data-xc="'+i+'" value="'+esc(x.count)+'"><button type="button" class="iconbtn" data-xr="'+i+'" aria-label="remove">✕</button></div>').join("")+'</div><button type="button" class="btn ghost block" id="addextra">'+esc(t("addExtra"))+'</button></div>';
    h+='<div style="margin-top:14px"><label class="f">'+esc(t("volume"))+'</label><div class="row"><div><input type="number" inputmode="numeric" min="0" id="f_bags" value="'+esc(d.bags)+'"><div class="hint">'+esc(t("bags"))+'</div></div><div><input type="number" inputmode="decimal" step="0.1" min="0" id="f_kg" value="'+esc(d.weightKg)+'"><div class="hint">'+esc(t("weight"))+'</div></div></div></div></div>';
    h+='<div class="card"><div class="field"><label class="f" for="f_notes">'+esc(t("notes"))+'</label><textarea id="f_notes" placeholder="'+esc(t("notesPh"))+'">'+esc(d.notes)+'</textarea></div>';
    h+='<label class="f">'+esc(t("media"))+'</label><div class="photos" style="margin-bottom:8px">'+(d.media||[]).map((p,i)=>'<div class="ph">'+mediaTile(p)+(p.pending?'<span class="pend">⏳</span>':"")+'<button type="button" data-rmph="'+i+'" aria-label="remove">✕</button></div>').join("")+'</div>';
    if((d.videos||[]).length) h+='<div class="vids">'+d.videos.map((v,i)=>{ const id=ytId(v.url); return '<div class="vid"><img src="'+esc(id?ytThumb(id):"")+'" alt=""><span>'+esc(v.url)+'</span><button type="button" class="iconbtn" data-rmv="'+i+'" aria-label="remove">✕</button></div>'; }).join("")+'</div>';
    h+=mediaButtons()+'<div class="hint">'+esc(t("mediaHint"))+'</div>';
    h+='</div>';
  }
  h+='<div class="row" style="margin-top:6px"><button class="btn ghost" type="button" id="cancel">'+esc(t("cancel"))+'</button><button class="btn" type="button" id="save">'+esc(t("save"))+'</button></div>';
  $("#view").innerHTML=h;
  bindForm(); checkDup();
}
function stepper(key,val){ return '<div class="step"><button type="button" data-dec="'+esc(key)+'" aria-label="−">−</button><input type="number" inputmode="numeric" min="0" data-cnt="'+esc(key)+'" value="'+esc(val==null||val===0?"":val)+'" placeholder="0"><button type="button" data-inc="'+esc(key)+'" aria-label="+">+</button></div>'; }
function readForm(){
  const d=S.draft; if(!d) return; const v=id=>{ const el=$("#"+id); return el? el.value : undefined; };
  if(v("f_date")!==undefined) d.date=v("f_date");
  if(d.type==="pickup"){
    d.start=v("f_start")||""; d.agencyName=(v("f_agname")||"").trim(); d.bags=v("f_bags")||""; d.weightKg=v("f_kg")||"";
    if(v("f_notes")!==undefined) d.notes=v("f_notes");
    return;
  }
  if(d.type!=="rest" && $("#f_start")){
    d.dayNo=v("f_dayno")||""; d.start=v("f_start")||""; d.end=v("f_end")||""; d.distanceKm=v("f_dist")||""; d.place=(v("f_place")||"").trim();
    d.bags=v("f_bags")||""; d.weightKg=v("f_kg")||"";
    d.counts=d.counts||{};
    $$("[data-cnt]").forEach(inp=>{ const k=inp.dataset.cnt, n=Math.max(0,Math.round(num(inp.value)));
      if(k==="others") d.others=n||""; else { const key=k.slice(2); if(n) d.counts[key]=n; else delete d.counts[key]; } });
    $$("[data-xn]").forEach(inp=>setExtraName(d.extras[+inp.dataset.xn],inp.value));
    $$("[data-xc]").forEach(inp=>{ d.extras[+inp.dataset.xc].count=inp.value; });
  }
  if(v("f_notes")!==undefined) d.notes=v("f_notes");
}
function readFormSafe(){ try{ readForm(); }catch(e){} }
function bindForm(){
  const d=S.draft;
  $$("[data-type]").forEach(b=>b.addEventListener("click",()=>{ readForm(); const ty=b.dataset.type; if(ty===d.type) return;
    const fresh=blankEntry(); for(const k in fresh) if(d[k]===undefined) d[k]=fresh[k]; d.type=ty; d._init=false; if(ty==="pickup") d.covers=null; renderForm(true); }));
  $$("[data-inc],[data-dec]").forEach(b=>b.addEventListener("click",()=>{
    const k=b.dataset.inc||b.dataset.dec, inp=$('[data-cnt="'+CSS.escape(k)+'"]');
    inp.value=Math.max(0,Math.round(num(inp.value))+(b.dataset.inc?1:-1))||"";
  }));
  const addP=name=>{ name=(name||"").trim(); if(!name) return; readForm(); if(!d.people.includes(name)) d.people.push(name); renderForm(true); const f=$("#f_person"); if(f) f.focus(); };
  const ap=$("#addperson"); if(ap) ap.addEventListener("click",()=>addP($("#f_person").value));
  const fp=$("#f_person"); if(fp) fp.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===","){ e.preventDefault(); addP(fp.value); } });
  $$("[data-addp]").forEach(b=>b.addEventListener("click",()=>addP(b.dataset.addp)));
  $$("[data-rmp]").forEach(b=>b.addEventListener("click",()=>{ readForm(); d.people.splice(+b.dataset.rmp,1); renderForm(true); }));
  const ax=$("#addextra"); if(ax) ax.addEventListener("click",()=>{ readForm(); d.extras.push({name:"",count:""}); renderForm(true); const l=$$("[data-xn]"); if(l.length) l[l.length-1].focus(); });
  $$("[data-xr]").forEach(b=>b.addEventListener("click",()=>{ readForm(); d.extras.splice(+b.dataset.xr,1); renderForm(true); }));
  $$("[data-rmph]").forEach(b=>b.addEventListener("click",()=>{ readForm(); const p=d.media.splice(+b.dataset.rmph,1)[0]; if(p&&p.pending&&!isSavedPhoto(p.cid)){ IDB.del("blobs",p.cid); dropBlobUrl(p.cid); } renderForm(true); }));
  $$("[data-rmv]").forEach(b=>b.addEventListener("click",()=>{ readForm(); d.videos.splice(+b.dataset.rmv,1); renderForm(true); }));
  const fd=$("#f_date"); if(fd) fd.addEventListener("change",checkDup);
  $$("input.mediain").forEach(inp=>inp.addEventListener("change",async()=>{ const files=Array.from(inp.files||[]); inp.value=""; readForm(); await addPicked(d,files); }));
  const rb=$("#rec_btn"); if(rb) rb.addEventListener("click",()=>{ readForm(); recordAudio(async f=>{ await addPicked(d,[f]); }); });
  bindAi(d);
  $("#cancel").addEventListener("click",()=>{ discardDraftPhotos(); S.draft=null; S.editing=null; location.hash="journal"; });
  $("#save").addEventListener("click",saveForm);
}
/* media chosen, photographed, filmed or recorded: kept on the phone until it uploads */
function mediaKind(f){
  const ty=f.type||"", n=f.name||"";
  if(ty.startsWith("video/")||/\.(mp4|mov|3gp|webm|mkv)$/i.test(n) && !ty.startsWith("audio/")) return "video";
  if(ty.startsWith("audio/")||/\.(m4a|mp3|aac|ogg|opus|amr|wav|weba)$/i.test(n)) return "audio";
  return "image";
}
async function addPicked(d,files){
  for(const f of files){
    const kind=mediaKind(f);
    if(kind!=="image" && f.size>500*1024*1024){ toast(t("videoBig")); continue; }
    let blob;
    try{ blob = kind==="image" ? await shrinkImage(f) : f; }catch(e){ toast(t("photoFail")); continue; }
    const cid=uid(10);
    try{ await IDB.put("blobs",cid,blob); }catch(e){ toast(t("phoneFull")); continue; }
    S.blobUrls[cid]=URL.createObjectURL(blob);
    if(kind==="image") d.media.push({cid,pending:true,kind:"image"});
    else { const m={cid,pending:true,kind,mime:f.type||(kind==="audio"?"audio/mp4":"video/mp4"),size:f.size}; if(f.dur) m.dur=f.dur;
      else if(kind==="audio") m.dur=await new Promise(res=>{ const a=new Audio(); a.preload="metadata"; a.onloadedmetadata=()=>res(isFinite(a.duration)?Math.round(a.duration):0); a.onerror=()=>res(0); setTimeout(()=>res(0),3000); a.src=S.blobUrls[cid]; });
      d.media.push(m); }
  }
  if(currentView()==="add") renderForm(true);
}
/* camera, video camera and voice recorder buttons, plus choosing from the phone */
function mediaButtons(){
  const rec=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder);
  return '<div class="mbtns">'+
    '<label class="mbtn">📷<span>'+esc(t("takePhoto"))+'</span><input type="file" class="mediain" accept="image/*" capture="environment"></label>'+
    '<label class="mbtn">🎥<span>'+esc(t("takeVideo"))+'</span><input type="file" class="mediain" accept="video/*" capture="environment"></label>'+
    (rec?'<button type="button" class="mbtn" id="rec_btn">🎙<span>'+esc(t("recAudio"))+'</span></button>':'')+
    '<label class="mbtn">🖼️<span>'+esc(t("fromPhone"))+'</span><input type="file" class="mediain" id="f_files" accept="image/*,video/*,audio/*" multiple></label>'+
  '</div>';
}
/* a voice note recorded inside the app */
function fmtDur(s){ s=Math.round(s||0); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
function recordAudio(done){
  const MAX=10*60;
  const body='<div class="rec"><div class="rec-time" id="rec_t">0:00</div><div class="rec-lvl"><i id="rec_l"></i></div>'+
    '<button type="button" class="rec-go" id="rec_go" aria-label="'+esc(t("recStart"))+'"><span></span></button><div class="hint" id="rec_h">'+esc(t("recHint"))+'</div>'+
    '<audio id="rec_play" controls hidden></audio></div>'+
    '<div class="row" style="margin-top:12px"><button type="button" class="btn ghost" data-x>'+esc(t("cancel"))+'</button><button type="button" class="btn" data-ok disabled>'+esc(t("recAttach"))+'</button></div>';
  let stream=null, mr=null, chunks=[], t0=0, timer=null, blob=null, raf=0, ac=null;
  const stopAll=()=>{ try{ if(mr&&mr.state!=="inactive") mr.stop(); }catch(e){} if(stream) stream.getTracks().forEach(x=>x.stop()); stream=null; clearInterval(timer); cancelAnimationFrame(raf); try{ ac&&ac.close(); }catch(e){} ac=null; holdWake(false); };
  openSheet(t("recAudio"),body,(el,close0)=>{
    const close=()=>{ stopAll(); close0(); };
    const go=el.querySelector("#rec_go"), tEl=el.querySelector("#rec_t"), hEl=el.querySelector("#rec_h"), play=el.querySelector("#rec_play"), ok=el.querySelector("[data-ok]"), lvl=el.querySelector("#rec_l");
    el.querySelector("[data-x]").onclick=close;
    $("#sheet").onclick=ev=>{ if(ev.target.id==="sheet") close(); };
    go.onclick=async()=>{
      if(mr && mr.state==="recording"){ mr.stop(); return; }
      try{ stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}}); }
      catch(e){ hEl.textContent=t("recDenied"); return; }
      const types=["audio/mp4","audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"];
      const mime=types.find(x=>window.MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(x))||"";
      chunks=[]; blob=null; play.hidden=true; ok.disabled=true;
      mr=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:64000}:undefined);
      mr.ondataavailable=ev=>{ if(ev.data&&ev.data.size) chunks.push(ev.data); };
      mr.onstop=()=>{ const ty=(mr.mimeType||mime||"audio/webm").split(";")[0]; blob=new Blob(chunks,{type:ty}); const secs=(Date.now()-t0)/1000;
        stopAll(); go.classList.remove("on"); go.setAttribute("aria-label",t("recStart"));
        play.src=URL.createObjectURL(blob); play.hidden=false; ok.disabled=false; hEl.textContent=t("recAgain");
        ok.onclick=()=>{ const ext=/mp4/.test(ty)?"m4a":/ogg/.test(ty)?"ogg":"webm"; const f=new File([blob],"voice-"+Date.now()+"."+ext,{type:ty}); f.dur=Math.round(secs); close0(); done(f); }; };
      mr.start(1000); t0=Date.now(); go.classList.add("on"); go.setAttribute("aria-label",t("recStop")); hEl.textContent=t("recStopHint"); holdWake(true);
      timer=setInterval(()=>{ const s=(Date.now()-t0)/1000; tEl.textContent=fmtDur(s); if(s>=MAX) mr.stop(); },250);
      try{ ac=new (window.AudioContext||window.webkitAudioContext)(); const an=ac.createAnalyser(); an.fftSize=256; ac.createMediaStreamSource(stream).connect(an); const buf=new Uint8Array(an.fftSize);
        const tick=()=>{ an.getByteTimeDomainData(buf); let mx=0; for(const v of buf) mx=Math.max(mx,Math.abs(v-128)); lvl.style.width=Math.min(100,mx/1.28)+"%"; raf=requestAnimationFrame(tick); }; tick(); }catch(e){}
    };
  });
}
function isSavedPhoto(cid){ return entries().some(e=>(e.media||[]).some(p=>p.cid===cid)); }
function discardDraftPhotos(){ const d=S.draft; if(!d) return; for(const p of (d.media||[])) if(p.pending && !isSavedPhoto(p.cid)){ IDB.del("blobs",p.cid); dropBlobUrl(p.cid); } }
/* Another day entry on the same date? (A pickup on the same day is normal and doesn't count.)
   New entry: offer to open the existing one instead. Editing: say there's a second one and offer to open it. */
function checkDup(){
  const el=$("#dupwarn"), fd=$("#f_date"); if(!el||!fd||!S.draft) return;
  const other=entries().find(e=>e.date===fd.value && e.id!==S.draft.id && e.type!=="pickup");
  if(!other){ el.innerHTML=""; return; }
  el.innerHTML=esc(S.editing? t("dupOther") : t("dupDate"))+' <button type="button" class="linkbtn" id="dup_open">'+esc(t("dupOpen"))+'</button>';
  $("#dup_open").onclick=async()=>{
    readForm(); const d=S.draft;
    const typed= entryTotal(d)>0 || (d.notes||"").trim() || (d.place||"").trim() || (d.media||[]).length;
    if(typed && !await confirmBox(t("dupDiscard"),t("dupYes"),t("no"))) return;
    discardDraftPhotos(); S.editing=other.id; S.draft=null; renderForm(); window.scrollTo(0,0);
  };
}
async function saveForm(){
  readForm();
  const d=S.draft;
  if(!d.date){ toast(t("needDate")); return; }
  if(d.date>todayStr()){ toast(t("futureDate")); return; }
  if(d.type==="pickup") return savePickup(d);
  const old=d.id && S.map[d.id];
  const e={ id: d.id || (d.date+"-"+uid(6)), type:d.type, date:d.date, notes:(d.notes||"").trim(), createdAt:(old&&old.createdAt)||new Date().toISOString() };
  if(d.type!=="rest"){
    Object.assign(e,{
      dayNo: d.dayNo? Math.round(num(d.dayNo)) : null,
      start:d.start||"", end:d.end||"", distanceKm: d.distanceKm!==""? num(d.distanceKm):null,
      place:d.place||"", people:d.people||[], others: num(d.others)||0,
      counts:d.counts||{}, extras:(d.extras||[]).filter(x=>(x.name||"").trim()).map(x=>{ const o={name:x.name.trim(),count:Math.max(0,Math.round(num(x.count)))};
        if(x.src) o.src=x.src; if(x.names){ o.names={}; for(const c in x.names) if((x.names[c]||"").trim()) o.names[c]=x.names[c].trim(); }
        if(x.mt&&Object.keys(x.mt).some(c=>x.mt[c])){ o.mt={}; for(const c in x.mt) if(x.mt[c]) o.mt[c]=true; } return o; }),
      bags: d.bags!==""? num(d.bags):null, weightKg: d.weightKg!==""? num(d.weightKg):null,
      ai: d.ai || undefined,
      media:(d.media||[]).map(p=>{ const o={cid:p.cid,kind:p.kind||"image"}; if(p.pending){ o.pending=true; if(p.mime) o.mime=p.mime; if(p.size) o.size=p.size; if(p.session){ o.session=p.session; o.offset=p.offset||0; } } else o.id=p.id; return o; }),
      videos:(d.videos||[]).filter(v=>ytId(v.url)).map(v=>({url:v.url}))
    });
  } else {
    // a day switched to "no plogging": drop its waiting photos
    for(const p of (d.media||[])) if(p.pending){ IDB.del("blobs",p.cid); dropBlobUrl(p.cid); }
  }
  if(old) for(const p of (old.media||[])) if(p.pending && !(e.media||[]).some(x=>x.cid===p.cid)){ IDB.del("blobs",p.cid); dropBlobUrl(p.cid); }
  await localSave(e);
  toast(navigator.onLine===false||!apiUrl()? t("savedLocal") : t("saved"));
  S.draft=null; S.editing=null; S.openId=e.id; location.hash="journal";
}

/* ================================================================ pickup form */
function renderPickupForm(d){
  const col=collection(d.id||null);
  // days that still have something waiting (ignoring this pickup), plus the days this pickup already covers
  const cand=entries().filter(e=>isPlog(e) && ((col[e.id]&&col[e.id].waitingCount>0) || (d.covers||[]).includes(e.id)))
    .sort((a,b)=>a.date.localeCompare(b.date));
  if(!d._init){ d._init=true; d.agency=d.agency||"panchayat"; if(!d.covers) d.covers=cand.filter(e=>e.date<=d.date).map(e=>e.id); }
  const nums=dayNumbers();
  const keysAvail=[...new Set(cand.filter(e=>d.covers.includes(e.id)).flatMap(e=>col[e.id]?col[e.id].waiting.concat(Object.keys(col[e.id].by).filter(k=>col[e.id].by[k]&&col[e.id].by[k].id===d.id)):[]))];
  const allKeys=!d.keys||!d.keys.length;
  let h='<h2>'+esc(S.editing?t("pkEditTitle"):t("pkTitle"))+'</h2>';
  if(!S.editing) h+='<div class="seg"><button type="button" data-type="plog">'+esc(t("plogDay"))+'</button><button type="button" data-type="rest">'+esc(t("restDay"))+'</button><button type="button" data-type="pickup" class="on">'+esc(t("pkType"))+'</button></div>';
  h+='<div class="card"><div class="row"><div class="field"><label class="f" for="f_date">'+esc(t("date"))+'</label><input type="date" id="f_date" max="'+todayStr()+'" value="'+esc(d.date)+'"></div><div class="field" style="max-width:140px"><label class="f" for="f_start">'+esc(t("pkTime"))+'</label><input type="time" id="f_start" value="'+esc(d.start||"")+'"></div></div>';
  h+='<label class="f">'+esc(t("pkWho"))+'</label><div class="chips">'+["panchayat","municipal","scrap","other"].map(a=>'<button type="button" class="chip static agchip'+(d.agency===a?" on":"")+'" data-ag="'+a+'">'+esc(t({panchayat:"agPanchayat",municipal:"agMunicipal",scrap:"agScrap",other:"agOther"}[a]))+'</button>').join("")+'</div>';
  h+='<input type="text" id="f_agname" value="'+esc(d.agencyName||"")+'" placeholder="'+esc(t("pkNamePh"))+'"></div>';
  h+='<div class="card"><div class="row" style="align-items:center"><h3 style="flex:1;margin:0">'+esc(t("pkDays"))+'</h3><button type="button" class="btn ghost" id="pk_all" style="flex:none;min-height:36px;padding:6px 10px">'+esc(t("pkAll"))+'</button><button type="button" class="btn ghost" id="pk_none" style="flex:none;min-height:36px;padding:6px 10px">'+esc(t("pkNone"))+'</button></div><p class="hint">'+esc(t("pkDaysHint"))+'</p>';
  if(!cand.length) h+='<p class="muted">'+esc(t("pkNoPending"))+'</p>';
  for(const e of cand){ const r=col[e.id]; const n=r? r.waitingCount : 0;
    h+='<label class="pkday"><input type="checkbox" data-cov="'+esc(e.id)+'"'+(d.covers.includes(e.id)?" checked":"")+'><span class="nm">'+esc(fmtDate(e.date))+' <span class="muted small">· '+esc(t("day"))+' '+fmt(nums[e.id],0)+'</span>'+(r&&r.status==="part"?' <span class="pkst part">◐</span>':"")+'</span><b>'+fmt(n||entryTotal(e),0)+'</b></label>'; }
  h+='</div>';
  if(keysAvail.length){
    h+='<div class="card"><h3>'+esc(t("pkKeys"))+'</h3><p class="hint" style="margin-top:-6px">'+esc(t("pkKeysHint"))+'</p><div class="chips">'+
      keysAvail.map(k=>'<button type="button" class="chip static agchip'+(allKeys||d.keys.includes(k)?" on":"")+'" data-pkkey="'+esc(k)+'">'+esc(k==="_other"?t("pkOther"):itemName(itemByKey(k)||{key:k}))+'</button>').join("")+'</div></div>';
  }
  h+='<div class="card"><label class="f">'+esc(t("volume"))+'</label><div class="row"><div><input type="number" inputmode="numeric" min="0" id="f_bags" value="'+esc(d.bags)+'"><div class="hint">'+esc(t("bags"))+'</div></div><div><input type="number" inputmode="decimal" step="0.1" min="0" id="f_kg" value="'+esc(d.weightKg)+'"><div class="hint">'+esc(t("weight"))+'</div></div></div>';
  h+='<div class="field" style="margin-top:12px"><label class="f" for="f_notes">'+esc(t("notes"))+'</label><textarea id="f_notes" placeholder="'+esc(t("pkNotesPh"))+'">'+esc(d.notes||"")+'</textarea></div>';
  h+='<label class="f">'+esc(t("media"))+'</label><div class="photos" style="margin-bottom:8px">'+(d.media||[]).map((p,i)=>'<div class="ph">'+mediaTile(p)+(p.pending?'<span class="pend">⏳</span>':"")+'<button type="button" data-rmph="'+i+'" aria-label="remove">✕</button></div>').join("")+'</div>';
  h+=mediaButtons()+'<div class="hint">'+esc(t("mediaHint"))+'</div></div>';
  h+='<div class="row" style="margin-top:6px"><button class="btn ghost" type="button" id="cancel">'+esc(t("cancel"))+'</button><button class="btn" type="button" id="save">'+esc(t("save"))+'</button></div>';
  $("#view").innerHTML=h;
  bindForm();
  $$("[data-ag]").forEach(b=>b.addEventListener("click",()=>{ readForm(); d.agency=b.dataset.ag; renderForm(true); }));
  $$("[data-cov]").forEach(cb=>cb.addEventListener("change",()=>{ readForm(); const id=cb.dataset.cov; d.covers=cb.checked? d.covers.concat(id) : d.covers.filter(x=>x!==id); renderForm(true); }));
  $("#pk_all").addEventListener("click",()=>{ readForm(); d.covers=cand.map(e=>e.id); renderForm(true); });
  $("#pk_none").addEventListener("click",()=>{ readForm(); d.covers=[]; renderForm(true); });
  $$("[data-pkkey]").forEach(b=>b.addEventListener("click",()=>{ readForm(); const k=b.dataset.pkkey;
    let ks=(!d.keys||!d.keys.length)? keysAvail.slice() : d.keys.slice();
    ks= ks.includes(k)? ks.filter(x=>x!==k) : ks.concat(k);
    d.keys= ks.length===keysAvail.length? null : ks; if(d.keys&&!d.keys.length) d.keys=["__none__"]; renderForm(true); }));
  const fd=$("#f_date"); fd.addEventListener("change",()=>{ readForm(); if(!S.editing){ d.covers=cand.filter(e=>e.date<=d.date).map(e=>e.id); } renderForm(true); });
}
async function savePickup(d){
  if(!d.date){ toast(t("needDate")); return; }
  if(d.date>todayStr()){ toast(t("futureDate")); return; }
  if(!(d.covers||[]).length){ toast(t("pkNeedDays")); return; }
  if(d.keys && (!d.keys.length || d.keys.includes("__none__"))){ toast(t("pkNeedKeys")); return; }
  const old=d.id && S.map[d.id];
  const e={ id:d.id||(d.date+"-pk"+uid(5)), type:"pickup", date:d.date, start:d.start||"", agency:d.agency||"panchayat", agencyName:d.agencyName||"",
    covers:d.covers.slice(), keys:d.keys&&d.keys.length? d.keys.slice() : null,
    bags: d.bags!==""&&d.bags!=null? num(d.bags):null, weightKg: d.weightKg!==""&&d.weightKg!=null? num(d.weightKg):null,
    notes:(d.notes||"").trim(), createdAt:(old&&old.createdAt)||new Date().toISOString(),
    media:(d.media||[]).map(p=>{ const o={cid:p.cid,kind:p.kind||"image"}; if(p.pending){ o.pending=true; if(p.mime) o.mime=p.mime; if(p.size) o.size=p.size; if(p.session){ o.session=p.session; o.offset=p.offset||0; } } else o.id=p.id; return o; }) };
  if(old) for(const p of (old.media||[])) if(p.pending && !e.media.some(x=>x.cid===p.cid)){ IDB.del("blobs",p.cid); dropBlobUrl(p.cid); }
  await localSave(e);
  toast(navigator.onLine===false||!apiUrl()? t("savedLocal") : t("saved"));
  S.draft=null; S.editing=null; S.openId=e.id; location.hash="journal";
}

/* ================================================================ AI suggestions */
const AI_MAX_IMAGES=6;
let aiBusy=false;
function aiBox(d){
  if(!S.meta.aiEnabled || !apiUrl() || !passcode()) return "";
  const has=(d.media||[]).length>0, online=navigator.onLine!==false;
  let h='<div class="aibox">';
  if(d._ai){
    const r=d._ai;
    h+='<div class="aipanel"><b>'+esc(t("aiTitle"))+'</b>';
    if(!r.counts.length && !r.others.some(o=>o.count>0)) h+='<p class="small">'+esc(t("aiNone"))+'</p>';
    r.counts.forEach((c,i)=>{ const it=itemByKey(c.key); const cur=num((d.counts||{})[c.key]);
      h+='<label class="airow"><input type="checkbox" data-aic="'+i+'"'+(cur?"":" checked")+'><span class="nm">'+esc(it?itemName(it):c.key)+'<small>'+esc(t("conf"+c.confidence))+(c.visible_only?" · "+esc(t("aiVisible")):"")+'</small></span><span class="cur">'+esc(t("aiNow"))+' '+fmt(cur,0)+'</span><b class="sug">'+fmt(c.count,0)+'</b></label>'; });
    r.others.forEach((o,i)=>{ if(!(o.count>0)) return;
      h+='<label class="airow"><input type="checkbox" data-aio="'+i+'" checked><span class="nm">'+esc(S.lang!=="en"?(o.name_local||o.name_en):o.name_en)+(o.hazard?' <span style="color:var(--warn)">⚠</span>':"")+'<small>'+esc(t("aiNew"))+'</small></span><span class="cur"></span><b class="sug">'+fmt(o.count,0)+'</b></label>'; });
    if((r.hazards||[]).length) h+='<p class="small" style="color:var(--warn)">⚠ '+esc(t("aiHaz"))+' '+esc(r.hazards.join(", "))+'</p>';
    if(r.reliable===false) h+='<p class="small" style="color:var(--accent)">'+esc(t("aiUnreliable"))+'</p>';
    const note=S.lang!=="en"?(r.note_local||r.note_en):(r.note_en||r.note_local); if(note) h+='<p class="small">'+esc(note)+'</p>';
    h+='<div class="row"><button type="button" class="btn ghost" id="ai_no">'+esc(t("aiDismiss"))+'</button><button type="button" class="btn" id="ai_yes">'+esc(t("aiApply"))+'</button></div></div>';
  } else {
    h+='<button type="button" class="btn ghost block" id="ai_go"'+(!has||!online||aiBusy?" disabled":"")+'>'+esc(aiBusy?t("aiWorking"):t("aiBtn"))+'</button>';
    h+='<div class="hint">'+esc(!has?t("aiNeedMedia"):!online?t("aiOffline"):t("photoTip"))+'</div>';
  }
  return h+'</div>';
}
function bindAi(d){
  const go=$("#ai_go");
  if(go) go.addEventListener("click",async()=>{
    readForm(); aiBusy=true; renderForm(true);
    try{
      const images=await collectAiImages(d);
      if(!images.length) throw {message:t("aiNeedMedia")};
      const L=langInfo(S.lang==="en"?(enabledLangs().find(c=>c!=="en")||"kn"):S.lang);
      const r=await api("analyze",{images,lang:L.code,langName:L.english,items:items().filter(i=>!i.hidden).map(i=>({key:i.key,en:itemName(i,"en"),local:itemName(i,L.code),hazard:!!i.hazard}))},150000);
      const res=r.result||{}; res.counts=res.counts||[]; res.others=res.others||[];
      if(S.draft===d) d._ai=res;
    }catch(err){ toast(t("aiFail")+((err&&(err.message||err.code))||"")); }
    aiBusy=false; if(currentView()==="add" && S.draft===d) renderForm(true);
  });
  const no=$("#ai_no"); if(no) no.addEventListener("click",()=>{ readForm(); delete d._ai; renderForm(true); });
  const yes=$("#ai_yes"); if(yes) yes.addEventListener("click",()=>{
    readForm(); const r=d._ai; d.counts=d.counts||{}; d.extras=d.extras||[];
    $$("[data-aic]").forEach(cb=>{ if(cb.checked){ const c=r.counts[+cb.dataset.aic]; d.counts[c.key]=c.count; } });
    $$("[data-aio]").forEach(cb=>{ if(cb.checked){ const o=r.others[+cb.dataset.aio]; const name=S.lang!=="en"?(o.name_local||o.name_en):o.name_en;
      const ex=d.extras.find(x=>extraName(x).trim().toLowerCase()===name.trim().toLowerCase()); if(ex) ex.count=o.count;
      else { const x={name,count:o.count,src:S.lang,names:{},mt:{}}; x.names[S.lang]=name;
             if(S.lang!=="en"&&o.name_en){ x.names.en=o.name_en; x.mt.en=true; } d.extras.push(x); } } });
    d.ai={at:new Date().toISOString(),model:r.model,counts:r.counts.map(c=>({key:c.key,count:c.count,confidence:c.confidence,visible_only:c.visible_only})),
          others:r.others.map(o=>({name:o.name_en,count:o.count})),hazards:r.hazards||[],reliable:r.reliable};
    delete d._ai; toast(t("aiApplied")); renderForm(true);
  });
}
async function localBlob(cid){
  let b=null; try{ b=await IDB.get("blobs",cid); }catch(e){}
  if(!b && S.blobUrls[cid]){ try{ b=await (await fetch(S.blobUrls[cid])).blob(); }catch(e){} }
  return b;
}
async function collectAiImages(d){
  const out=[], media=d.media||[];
  for(const m of media.filter(m=>m.kind==="image"||!m.kind)){
    if(out.length>=AI_MAX_IMAGES) break;
    const b=await localBlob(m.cid);
    if(b) out.push({data:await blobToBase64(b),mime:b.type||"image/jpeg",source:"photo"});
    else if(driveId(m)) out.push({driveId:driveId(m),source:"photo"});
  }
  const vids=media.filter(m=>m.kind==="video");
  for(const v of vids){
    const room=AI_MAX_IMAGES-out.length; if(room<=0) break;
    const b=await localBlob(v.cid); if(!b) continue;   // already uploaded and no longer on this phone
    const per=Math.max(1,Math.min(2,Math.floor(room/Math.max(1,vids.length))||1));
    for(const f of await videoFrames(b,per)) if(out.length<AI_MAX_IMAGES) out.push({data:f,mime:"image/jpeg",source:"video"});
  }
  return out;
}
/* grabs n still frames (spread through the clip) from a local video, as base64 JPEG */
function videoFrames(blob,n){
  return new Promise(resolve=>{
    const url=URL.createObjectURL(blob), v=document.createElement("video"), frames=[];
    v.muted=true; v.playsInline=true; v.preload="auto"; v.src=url;
    let i=0; const done=()=>{ clearTimeout(tm); URL.revokeObjectURL(url); resolve(frames); };
    const tm=setTimeout(done,20000);
    const next=()=>{ if(i>=n||!isFinite(v.duration)) return done(); v.currentTime=v.duration*(i+1)/(n+1); };
    v.addEventListener("seeked",()=>{
      try{
        const sc=Math.min(1,1280/Math.max(v.videoWidth,v.videoHeight)); const c=document.createElement("canvas");
        c.width=Math.round(v.videoWidth*sc); c.height=Math.round(v.videoHeight*sc); c.getContext("2d").drawImage(v,0,0,c.width,c.height);
        frames.push(c.toDataURL("image/jpeg",0.8).split(",")[1]);
      }catch(e){}
      i++; next();
    });
    v.addEventListener("loadedmetadata",next,{once:true});
    v.addEventListener("error",done,{once:true});
  });
}

/* ================================================================ library */
/* Collaterals filed under a tree of topics; each topic is a Drive folder, so Drive mirrors the tree. */
const LIB_MAX=500*1024*1024;
function topicName(tp){ const n=tp.names||{}; return n[S.lang] || txPlain(tOrFallback(n)) || "—"; }
function tOrFallback(n){ return n.en || n.kn || Object.values(n).find(Boolean) || ""; }
function children(pid){ return Object.values(S.lib.topics).filter(tp=>(tp.parent||"")===(pid||"")).sort((a,b)=>(a.order||0)-(b.order||0)||topicName(a).localeCompare(topicName(b))); }
function filesIn(pid){ return Object.values(S.lib.files).filter(f=>(f.topic||"")===(pid||"")).sort((a,b)=>String(b.addedAt||"").localeCompare(String(a.addedAt||""))); }
function trail(id){ const out=[]; let cur=S.lib.topics[id], g=0; while(cur&&g++<50){ out.unshift(cur); cur=cur.parent?S.lib.topics[cur.parent]:null; } return out; }
function descendants(id){ const out=new Set([id]); let grew=true; while(grew){ grew=false; for(const tp of Object.values(S.lib.topics)) if(out.has(tp.parent||"")&&!out.has(tp.id)){ out.add(tp.id); grew=true; } } return out; }
function topicCounts(id){ const ds=descendants(id); return {topics:ds.size-1, files:Object.values(S.lib.files).filter(f=>ds.has(f.topic||"")).length}; }
function fileKind(f){ const m=f.mime||""; return m.startsWith("image/")?"image": m.startsWith("video/")?"video": m==="application/pdf"||/\.pdf$/i.test(f.name||"")?"pdf":"other"; }
function fileExt(f){ const m=/\.([A-Za-z0-9]{1,5})$/.exec(f.name||""); return m?m[1].toUpperCase():"FILE"; }
function fileThumb(f){
  const k=fileKind(f), local=S.blobUrls[f.id], drive=f.driveId? "https://drive.google.com/thumbnail?id="+encodeURIComponent(f.driveId)+"&sz=w600" : "";
  const icon={image:"🖼️",video:"🎬",pdf:"📄",other:"📎"}[k];
  let inner='<span class="ficon">'+icon+'<small>'+esc(k==="other"?fileExt(f):k==="pdf"?"PDF":"")+'</small></span>';
  if(k==="image"&&(local||drive)) inner='<img src="'+esc(local||drive)+'" loading="lazy" alt="" onerror="this.remove()">'+inner;
  else if(k==="video"&&local) inner='<video src="'+esc(local)+'#t=0.5" preload="metadata" muted playsinline></video><i class="play">▶</i>';
  else if((k==="video"||k==="pdf")&&drive) inner='<img src="'+esc(drive)+'" loading="lazy" alt="" onerror="this.remove()">'+inner+(k==="video"?'<i class="play">▶</i>':"");
  return inner;
}
function fmtSize(n){ n=num(n); return n>=1048576? fmt(n/1048576)+" MB" : fmt(Math.max(1,n/1024),0)+" KB"; }

function renderLibrary(){
  const at=S.lib.topics[S.libAt]? S.libAt : ""; S.libAt=at;
  const q=(S.libQ||"").trim().toLowerCase();
  let h='<div class="libhead"><nav class="crumbs"><button type="button" data-go="">'+esc(t("library"))+'</button>'+trail(at).map(tp=>'<span>›</span><button type="button" data-go="'+esc(tp.id)+'">'+esc(topicName(tp))+'</button>').join("")+'</nav>'+
    '<input type="search" id="lib_q" placeholder="'+esc(t("libSearch"))+'" value="'+esc(S.libQ||"")+'"></div>';
  if(q){
    const tps=Object.values(S.lib.topics).filter(tp=>Object.values(tp.names||{}).some(n=>String(n).toLowerCase().includes(q)));
    const fs=Object.values(S.lib.files).filter(f=>[f.title,f.note,f.name].concat(trail(f.topic).map(topicName)).some(x=>String(x||"").toLowerCase().includes(q)));
    h+= !tps.length&&!fs.length ? '<div class="empty">'+esc(t("libNoMatch"))+'</div>' : "";
    h+=tps.map(tp=>topicRow(tp,true)).join("");
    if(fs.length) h+='<div class="fgrid">'+fs.map(f=>fileTile(f,true)).join("")+'</div>';
  } else {
    h+='<div class="libacts"><button type="button" class="btn ghost" id="lib_newtopic">+ '+esc(t("libNewTopic"))+'</button>'+
       '<label class="btn libadd">+ '+esc(t("libAddFiles"))+'<input type="file" id="lib_files" multiple accept="image/*,video/*,application/pdf,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.ods,.odp,.txt,.csv,.zip"></label>'+
       (at?'<button type="button" class="iconbtn" id="lib_topicmenu" aria-label="'+esc(t("libTopicMenu"))+'">⋯</button>':"")+'</div>';
    const kids=children(at), fs=filesIn(at);
    if(!kids.length&&!fs.length) h+='<div class="empty">'+esc(at?t("libEmptyTopic"):t("libEmpty"))+'</div>';
    h+=kids.map(tp=>topicRow(tp,false)).join("");
    if(fs.length) h+='<div class="fgrid">'+fs.map(f=>fileTile(f,false)).join("")+'</div>';
  }
  $("#view").innerHTML=h;
  $$("[data-go]").forEach(b=>b.addEventListener("click",()=>{ S.libAt=b.dataset.go; S.libQ=""; renderLibrary(); window.scrollTo(0,0); }));
  $$("[data-topic]").forEach(b=>b.addEventListener("click",()=>{ S.libAt=b.dataset.topic; S.libQ=""; renderLibrary(); window.scrollTo(0,0); }));
  $$("[data-file]").forEach(b=>b.addEventListener("click",()=>openFile(b.dataset.file)));
  const qi=$("#lib_q"); qi.addEventListener("input",()=>{ S.libQ=qi.value; const pos=qi.selectionStart; renderLibrary(); const n=$("#lib_q"); n.focus(); try{ n.setSelectionRange(pos,pos); }catch(e){} });
  const nt=$("#lib_newtopic"); if(nt) nt.addEventListener("click",()=>editTopic(null));
  const tm=$("#lib_topicmenu"); if(tm) tm.addEventListener("click",()=>topicMenu(at));
  const lf=$("#lib_files"); if(lf) lf.addEventListener("change",()=>addLibFiles(Array.from(lf.files||[]),at));
}
function topicRow(tp,withPath){
  const c=topicCounts(tp.id), pend=isPending(tp.id)?' <span class="pendbadge">⏳</span>':"";
  const path=withPath? '<small>'+esc(trail(tp.parent).map(topicName).join(" › ")||t("library"))+'</small>' : "";
  return '<button type="button" class="trow" data-topic="'+esc(tp.id)+'"><span class="fold">📁</span><span class="nm">'+esc(topicName(tp))+pend+path+'</span><span class="cnt">'+
    (c.topics?fmt(c.topics,0)+' 📁 ':"")+fmt(c.files,0)+' 📎</span><span class="chev">›</span></button>';
}
function fileTile(f,withPath){
  return '<button type="button" class="ftile" data-file="'+esc(f.id)+'"><span class="thumb k-'+fileKind(f)+'">'+fileThumb(f)+(f.pending?'<span class="pend">⏳</span>':"")+'</span>'+
    '<span class="ft">'+(f.title?txMark(f.title):esc(f.name))+'</span>'+(withPath?'<small>'+esc(trail(f.topic).map(topicName).join(" › ")||t("library"))+'</small>':"")+'</button>';
}

/* ---- a small bottom sheet for forms (topic names, file details, move) */
function sheetOpen(){ const m=$("#sheet"); return !!m && m.style.display==="flex"; }
function openSheet(title,body,bind){
  const m=$("#sheet"); m.querySelector("h3").textContent=title; m.querySelector(".body").innerHTML=body; m.style.display="flex";
  const close=()=>{ m.style.display="none"; m.onclick=null; m.querySelector(".body").innerHTML=""; if(currentView()==="library") renderLibrary(); };
  m.onclick=e=>{ if(e.target===m) close(); };
  bind(m.querySelector(".body"),close);
}
function editTopic(id){
  const tp=id? S.lib.topics[id] : null, langs=enabledLangs();
  const body=langs.map(c=>'<label class="f">'+esc(langInfo(c).name)+'</label><input type="text" data-tn="'+esc(c)+'" value="'+esc(tp&&tp.names&&tp.names[c]||"")+'" lang="'+esc(c)+'">').join("")+
    '<div class="row" style="margin-top:14px"><button type="button" class="btn ghost" data-x>'+esc(t("cancel"))+'</button><button type="button" class="btn" data-ok>'+esc(t("libSave"))+'</button></div>';
  openSheet(id?t("libRenameTopic"):t("libNewTopic"),body,(el,close)=>{
    const first=el.querySelector("[data-tn]"); if(first) first.focus();
    el.querySelector("[data-x]").onclick=close;
    el.querySelector("[data-ok]").onclick=async()=>{
      const names={}; el.querySelectorAll("[data-tn]").forEach(i=>{ const v=i.value.trim(); if(v) names[i.dataset.tn]=v; });
      if(!Object.keys(names).length){ toast(t("libNeedName")); return; }
      if(tp){ tp.names=Object.assign({},tp.names,names); for(const c of langs) if(!names[c]) delete tp.names[c]; queue({t:"topic",id:tp.id}); }
      else { const nid="tp"+uid(10), sib=children(S.libAt); S.lib.topics[nid]={id:nid,parent:S.libAt||"",names,order:sib.length?Math.max(...sib.map(x=>x.order||0))+1:1,createdAt:new Date().toISOString()};
             S.outbox.push({t:"topic",id:nid,isNew:true}); }
      await persist(); kickSync(); close();
    };
  });
}
async function topicMenu(id){
  const tp=S.lib.topics[id]; if(!tp) return;
  const c=topicCounts(id);
  const choice=await pickBox(topicName(tp),[{value:"rename",label:"✏️ "+t("libRenameTopic")},{value:"move",label:"↪ "+t("libMove")},{value:"up",label:"↑ "+t("libMoveUp")},{value:"del",label:"🗑 "+t("libDeleteTopic")}]);
  if(choice==="rename") editTopic(id);
  else if(choice==="move") moveTo(t("libMove")+": "+topicName(tp),descendants(id),tp.parent||"",async dest=>{ tp.parent=dest; tp.order=children(dest).length+1; queue({t:"topic",id}); await persist(); kickSync(); S.libAt=id; });
  else if(choice==="up"){ const sib=children(tp.parent); const i=sib.findIndex(x=>x.id===id); if(i>0){ sib.splice(i,1); sib.splice(i-1,0,tp); sib.forEach((x,j)=>{ if(x.order!==j+1){ x.order=j+1; queue({t:"topic",id:x.id}); } }); await persist(); kickSync(); } S.libAt=tp.parent||""; renderLibrary(); }
  else if(choice==="del"){
    if(c.topics||c.files){ toast(t("libNotEmpty")); return; }
    if(!await confirmBox(t("libConfirmDelTopic").replace("{name}",topicName(tp)),t("yes"),t("no"))) return;
    delete S.lib.topics[id]; queue({t:"topicDel",id}); S.libAt=tp.parent||""; await persist(); kickSync(); renderLibrary();
  }
}
/* choose a destination topic; `exclude` holds topics that can't be chosen (a topic and its own subtopics) */
function moveTo(title,exclude,current,done){
  const rows=[]; const walk=(pid,depth)=>{ for(const tp of children(pid)){ if(exclude.has(tp.id)) continue; rows.push({id:tp.id,depth,name:topicName(tp)}); walk(tp.id,depth+1); } }; walk("",1);
  const body='<div class="tree"><button type="button" class="trow small'+(current===""?" cur":"")+'" data-dest=""><span class="fold">🏠</span><span class="nm">'+esc(t("library"))+'</span></button>'+
    rows.map(r=>'<button type="button" class="trow small'+(current===r.id?" cur":"")+'" data-dest="'+esc(r.id)+'" style="padding-left:'+(10+r.depth*18)+'px"><span class="fold">📁</span><span class="nm">'+esc(r.name)+'</span></button>').join("")+'</div>'+
    '<div class="row" style="margin-top:12px"><button type="button" class="btn ghost" data-x>'+esc(t("cancel"))+'</button></div>';
  openSheet(title,body,(el,close)=>{ el.querySelector("[data-x]").onclick=close;
    el.querySelectorAll("[data-dest]").forEach(b=>b.onclick=async()=>{ await done(b.dataset.dest); close(); }); });
}
async function addLibFiles(list,topic){
  let n=0;
  for(const f of list){
    if(f.size>LIB_MAX){ toast(t("libTooBig")); continue; }
    const id="fi"+uid(12);
    try{ await IDB.put("blobs",id,f); }catch(e){ toast(t("phoneFull")); continue; }
    S.blobUrls[id]=URL.createObjectURL(f);
    S.lib.files[id]={id,topic:topic||"",name:f.name||"file",mime:f.type||"",size:f.size,title:(f.name||"").replace(/\.[^.]+$/,""),note:"",entryId:"",pending:true,addedAt:new Date().toISOString()};
    S.outbox.push({t:"file",id,isNew:true}); n++;
  }
  await persist(); kickSync(); renderLibrary();
  if(n) toast(t("libAdded").replace("{n}",n));
}
function openFile(id){
  const f=S.lib.files[id]; if(!f) return;
  const k=fileKind(f), local=S.blobUrls[f.id], drive=f.driveId;
  let pv="";
  if(k==="image") pv='<img src="'+esc(local||("https://drive.google.com/thumbnail?id="+encodeURIComponent(drive)+"&sz=w1600"))+'" alt="">';
  else if(k==="video") pv= vplayer(local,drive);
  else if(k==="pdf"&&drive) pv='<iframe src="https://drive.google.com/file/d/'+esc(encodeURIComponent(drive))+'/preview"></iframe>';
  else pv='<div class="bigicon">'+({pdf:"📄",other:"📎"}[k])+'<small>'+esc(f.name)+'</small></div>';
  const days=entries().slice().sort((a,b)=>b.date.localeCompare(a.date)), nums=dayNumbers();
  const dayLabel=e=> fmtDate(e.date,{day:"numeric",month:"short",year:"numeric"})+" · "+(e.type==="pickup"?t("pkShort"):e.type==="rest"?t("restLabel"):t("day")+" "+fmt(nums[e.id],0));
  const body='<div class="fview">'+pv+'</div>'+
    '<div class="small muted" style="margin:6px 0 10px">'+esc(f.name)+' · '+esc(fmtSize(f.size))+(f.pending?' · ⏳ '+esc(t("pendingTag")):"")+' · '+esc(trail(f.topic).map(topicName).join(" › ")||t("library"))+'</div>'+
    '<label class="f">'+esc(t("libTitle"))+'</label><input type="text" id="lf_title" value="'+esc(f.title||"")+'">'+
    '<label class="f" style="margin-top:10px">'+esc(t("libNote"))+'</label><textarea id="lf_note" placeholder="'+esc(t("libNotePh"))+'">'+esc(f.note||"")+'</textarea>'+
    '<label class="f" style="margin-top:10px">'+esc(t("libLinkDay"))+'</label><select id="lf_day"><option value="">—</option>'+days.map(e=>'<option value="'+esc(e.id)+'"'+(f.entryId===e.id?" selected":"")+'>'+esc(dayLabel(e))+'</option>').join("")+'</select>'+
    '<div class="row" style="margin-top:14px;flex-wrap:wrap"><button type="button" class="btn ghost" data-mv>↪ '+esc(t("libMove"))+'</button><button type="button" class="btn danger" data-del>🗑 '+esc(t("del"))+'</button>'+
    (drive?'<a class="btn ghost" href="https://drive.google.com/file/d/'+esc(encodeURIComponent(drive))+'/view" target="_blank" rel="noopener">Drive ↗</a>':"")+'</div>'+
    '<div class="row" style="margin-top:8px"><button type="button" class="btn ghost" data-x>'+esc(t("cancel"))+'</button><button type="button" class="btn" data-ok>'+esc(t("libSave"))+'</button></div>';
  openSheet(f.title?txPlain(f.title):f.name,body,(el,close)=>{
    el.querySelector("[data-x]").onclick=close;
    el.querySelector("[data-ok]").onclick=async()=>{ f.title=el.querySelector("#lf_title").value.trim(); f.note=el.querySelector("#lf_note").value.trim(); f.entryId=el.querySelector("#lf_day").value;
      queue({t:"file",id}); await persist(); kickSync(); toast(t("libSaved")); close(); };
    el.querySelector("[data-mv]").onclick=()=>{ close(); moveTo(t("libMove")+": "+(f.title||f.name),new Set(),f.topic||"",async dest=>{ f.topic=dest; queue({t:"file",id}); await persist(); kickSync(); }); };
    el.querySelector("[data-del]").onclick=async()=>{ close(); if(!await confirmBox(t("libConfirmDelFile").replace("{name}",f.title||f.name),t("yes"),t("no"))) return;
      delete S.lib.files[id]; queue({t:"fileDel",id}); IDB.del("blobs",id); dropBlobUrl(id); await persist(); kickSync(); renderLibrary(); };
  });
}

/* ================================================================ stats */
function rangeBounds(){
  const today=parseDate(todayStr());
  if(S.range==="7"){ const a=new Date(today); a.setDate(a.getDate()-6); return [dstr(a),dstr(today)]; }
  if(S.range==="30"){ const a=new Date(today); a.setDate(a.getDate()-29); return [dstr(a),dstr(today)]; }
  if(S.range==="month") return [dstr(new Date(today.getFullYear(),today.getMonth(),1)),dstr(today)];
  if(S.range==="year") return [today.getFullYear()+"-01-01",dstr(today)];
  if(S.range==="custom") return [S.from||"0000-01-01",S.to||"9999-12-31"];
  return ["0000-01-01","9999-12-31"];
}
function renderStats(){
  const [a,b]=rangeBounds();
  const inR=entries().filter(e=>e.date>=a && e.date<=b);
  const plog=inR.filter(isPlog), rest=inR.filter(e=>e.type==="rest"), pks=inR.filter(e=>e.type==="pickup");
  const col=collection();
  let h='<div class="ranges">'+[["7","r7"],["30","r30"],["month","rMonth"],["year","rYear"],["all","rAll"],["custom","rCustom"]].map(([k,l])=>'<button type="button" data-range="'+k+'" class="'+(S.range===k?"on":"")+'">'+esc(t(l))+'</button>').join("")+'</div>';
  if(S.range==="custom") h+='<div class="row" style="margin-bottom:12px"><div><label class="f" for="r_from">'+esc(t("from"))+'</label><input type="date" id="r_from" value="'+esc(S.from)+'"></div><div><label class="f" for="r_to">'+esc(t("to"))+'</label><input type="date" id="r_to" value="'+esc(S.to)+'"></div></div>';
  if(!plog.length && !rest.length && !pks.length){ h+='<div class="empty">'+esc(t("noData"))+'</div>'; $("#view").innerHTML=h; bindStats(); return; }
  const byItem={}, extraNames={}; let total=0, km=0, kmDays=0, kmItems=0, mins=0, minDays=0, bags=0, kg=0, haz=0;
  const persons={}, places={}, daily={};
  for(const e of plog){
    const tot=entryTotal(e); total+=tot;
    for(const k in (e.counts||{})){ const n=num(e.counts[k]); byItem[k]=(byItem[k]||0)+n; const it=itemByKey(k); if(it&&it.hazard) haz+=n; }
    for(const x of (e.extras||[])){ const nm=(x.name||"").trim(); if(!nm) continue; const key=nm.toLowerCase(); if(!extraNames[key]) extraNames[key]={name:(x.names&&x.names[S.lang])||txPlain(nm),n:0}; extraNames[key].n+=num(x.count); }
    if(num(e.distanceKm)){ km+=num(e.distanceKm); kmDays++; kmItems+=tot; }
    const m=minutes(e); if(m!=null){ mins+=m; minDays++; }
    bags+=num(e.bags); kg+=num(e.weightKg);
    for(const p of (e.people||[])) persons[p]=(persons[p]||0)+1;
    const pl=(e.place||"").trim(); if(pl){ if(!places[pl]) places[pl]={d:0,n:0}; places[pl].d++; places[pl].n+=tot; }
    daily[e.date]=(daily[e.date]||0)+tot;
  }
  const nPeople=Object.keys(persons).length;
  const kpi=(v,l,cls)=>'<div class="kpi'+(cls?" "+cls:"")+'"><div class="v">'+v+'</div><div class="l">'+esc(l)+'</div></div>';
  h+='<div class="kpis">'+kpi(fmt(plog.length,0),t("kOutings"))+kpi(fmt(total,0),t("kItems"))+kpi(fmt(plog.length?total/plog.length:0,0),t("kPerDay"))+
     kpi(kmDays?fmt(km):"—",t("kKm"))+kpi(kmDays?fmt(kmItems/km,0):"—",t("kPerKm"))+kpi(minDays?fmt(mins/60):"—",t("kHours"))+
     kpi(nPeople?fmt(nPeople,0):"—",t("kPeople"))+(haz?kpi(fmt(haz,0),t("kHaz"),"haz"):"")+(rest.length?kpi(fmt(rest.length,0),t("kRest")):"")+
     (bags?kpi(fmt(bags,0),t("kBags")):"")+(kg?kpi(fmt(kg),t("kKg")):"")+'</div>';
  // pickups: handed over in this period, waiting right now, how long things wait
  const allWaiting=Object.values(col).reduce((s,r)=>s+r.waitingCount,0);
  if(pks.length || allWaiting){
    const handed=pks.reduce((s,p)=>s+pickupItems(p,col),0);
    const waits=[]; for(const e of plog){ const r=col[e.id]; if(r&&r.status==="all"){ const last=Object.values(r.by).reduce((m,p)=>p.date>m?p.date:m,""); waits.push((parseDate(last)-parseDate(e.date))/864e5); } }
    h+='<div class="kpis">'+kpi(fmt(pks.length,0),t("kPickups"))+kpi(fmt(handed,0),t("kHanded"))+kpi(fmt(allWaiting,0),t("kWaiting"),allWaiting?"wait":"")+
       (waits.length?kpi(fmt(waits.reduce((a,b)=>a+b,0)/waits.length),t("kWait")):"")+'</div>';
    const ag={}; for(const p of pks){ const k=agencyLabel(p)||"—"; ag[k]=ag[k]||{n:0,items:0}; ag[k].n++; ag[k].items+=pickupItems(p,col); }
    const agr=Object.entries(ag).sort((a,b)=>b[1].items-a[1].items);
    if(agr.length) h+='<div class="card"><h3>'+esc(t("byAgency"))+'</h3><table class="t"><thead><tr><th>'+esc(t("pkWho"))+'</th><th class="n">'+esc(t("colPickups"))+'</th><th class="n">'+esc(t("colItems"))+'</th></tr></thead><tbody>'+agr.map(([k,v])=>'<tr><td>'+esc(k)+'</td><td class="n">'+fmt(v.n,0)+'</td><td class="n">'+fmt(v.items,0)+'</td></tr>').join("")+'</tbody></table></div>';
  }
  if((kmDays&&kmDays<plog.length)||(minDays&&minDays<plog.length)) h+='<p class="hint" style="margin-top:-4px">'+esc(t("partial"))+'</p>';
  const rows=[];
  for(const it of items()){ if(byItem[it.key]) rows.push({name:itemName(it),n:byItem[it.key],haz:!!it.hazard}); }
  for(const k in byItem){ if(!itemByKey(k)) rows.push({name:k,n:byItem[k]}); }
  for(const k in extraNames) rows.push({name:extraNames[k].name,n:extraNames[k].n});
  rows.sort((x,y)=>y.n-x.n);
  const maxN=rows.reduce((m,r)=>Math.max(m,r.n),0)||1;
  if(rows.length) h+='<div class="card"><h3>'+esc(t("byItem"))+'</h3><div class="bars">'+rows.map(r=>'<div class="b'+(r.haz?" haz":"")+'"><div class="t"><span>'+esc(r.name)+(r.haz?' <span style="color:var(--warn)">⚠</span>':"")+'</span><span>'+fmt(r.n,0)+'</span></div><div class="track"><div class="fill" style="width:'+Math.max(1,r.n/maxN*100).toFixed(1)+'%"></div></div></div>').join("")+'</div></div>';
  const days=Object.keys(daily).sort();
  if(days.length) h+='<div class="card"><h3>'+esc(t("byDay"))+'</h3><div class="chartbox" id="chart">'+dailyChart(days,daily)+'</div></div>';
  const pl=Object.entries(places).sort((x,y)=>y[1].n-x[1].n);
  if(pl.length) h+='<div class="card"><h3>'+esc(t("byPlace"))+'</h3><table class="t"><thead><tr><th>'+esc(t("colPlace"))+'</th><th class="n">'+esc(t("colDays"))+'</th><th class="n">'+esc(t("colItems"))+'</th></tr></thead><tbody>'+pl.map(([p,v])=>'<tr><td>'+tx(p)+'</td><td class="n">'+fmt(v.d,0)+'</td><td class="n">'+fmt(v.n,0)+'</td></tr>').join("")+'</tbody></table></div>';
  const pp=Object.entries(persons).sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]));
  if(pp.length) h+='<div class="card"><h3>'+esc(t("byPerson"))+'</h3><table class="t"><thead><tr><th>'+esc(t("colName"))+'</th><th class="n">'+esc(t("colDays"))+'</th></tr></thead><tbody>'+pp.map(([p,n])=>'<tr><td>'+tx(p)+'</td><td class="n">'+fmt(n,0)+'</td></tr>').join("")+'</tbody></table></div>';
  $("#view").innerHTML=h;
  bindStats();
}
function dailyChart(days,daily){
  const W=600,H=220,pl=36,pr=8,pt=12,pb=28;
  const max=Math.max(...days.map(d=>daily[d]))||1;
  const step=niceStep(max/4), top=Math.ceil(max/step)*step||step;
  const iw=W-pl-pr, ih=H-pt-pb, bw=iw/days.length, gap=Math.min(6,bw*0.25);
  let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(t("byDay"))+'">';
  for(let v=0; v<=top; v+=step){ const y=pt+ih-(v/top)*ih; s+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line)" stroke-width="1"/><text x="'+(pl-6)+'" y="'+(y+4)+'" text-anchor="end">'+fmt(v,0)+'</text>'; }
  const every=Math.ceil(days.length/7);
  days.forEach((d,i)=>{
    const v=daily[d], bh=Math.max(1,(v/top)*ih), x=pl+i*bw+gap/2, y=pt+ih-bh, w=Math.max(2,bw-gap), r=Math.min(4,w/2,bh);
    s+='<path d="M'+x+','+(pt+ih)+'V'+(y+r)+'Q'+x+','+y+' '+(x+r)+','+y+'H'+(x+w-r)+'Q'+(x+w)+','+y+' '+(x+w)+','+(y+r)+'V'+(pt+ih)+'Z" fill="var(--green2)"/>';
    s+='<rect class="hit" data-d="'+d+'" data-v="'+v+'" x="'+(pl+i*bw)+'" y="'+pt+'" width="'+bw+'" height="'+ih+'" fill="transparent"/>';
    if(i%every===0) s+='<text x="'+(x+w/2)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(fmtDate(d,{day:"numeric",month:"short"}))+'</text>';
  });
  return s+'</svg>';
}
function niceStep(x){ if(x<=1) return 1; const p=Math.pow(10,Math.floor(Math.log10(x))), f=x/p; return (f<=1?1:f<=2?2:f<=5?5:10)*p; }
function bindStats(){
  $$("[data-range]").forEach(b=>b.addEventListener("click",()=>{ S.range=b.dataset.range; renderStats(); }));
  const rf=$("#r_from"), rt=$("#r_to");
  if(rf) rf.addEventListener("change",()=>{ S.from=rf.value; renderStats(); });
  if(rt) rt.addEventListener("change",()=>{ S.to=rt.value; renderStats(); });
  const box=$("#chart"), tip=$("#tip");
  if(box){
    const show=ev=>{ const r=ev.target.closest(".hit"); if(!r){ tip.style.display="none"; return; }
      const bb=r.getBoundingClientRect(); tip.innerHTML='<b>'+esc(fmtDate(r.dataset.d,{day:"numeric",month:"short",year:"numeric"}))+'</b> · '+fmt(+r.dataset.v,0)+' '+esc(t("pcs"));
      tip.style.left=(bb.left+bb.width/2+window.scrollX)+"px"; tip.style.top=(bb.top+window.scrollY+8)+"px"; tip.style.display="block"; };
    box.addEventListener("pointermove",show); box.addEventListener("click",show);
    box.addEventListener("pointerleave",()=>tip.style.display="none");
  }
}

/* ================================================================ settings */
let settingsDirty=false, sDraft=null;
function renderSettings(){
  if(!settingsDirty || !sDraft) sDraft={ title:(S.config&&S.config.title)||"", items: JSON.parse(JSON.stringify(items())), languages: enabledLangs().slice() };
  let h='<h2>'+esc(t("settings"))+'</h2>';
  // connection
  const last=S.meta.lastSync? new Date(S.meta.lastSync).toLocaleString(intlLocale(),{dateStyle:"medium",timeStyle:"short"}) : "—";
  const baked=window.PLOG_CONFIG && window.PLOG_CONFIG.apiUrl;
  h+='<div class="card"><h3>'+esc(t("connection"))+'</h3>';
  h+='<div class="field"'+(baked&&!lsGet("plog.api")?' style="display:none"':'')+'><label class="f" for="c_url">'+esc(t("apiUrl"))+'</label><input type="url" id="c_url" value="'+esc(apiUrl())+'" placeholder="https://script.google.com/macros/s/…/exec"></div>';
  h+='<div class="field"><label class="f" for="c_key">'+esc(t("passcode"))+'</label><input type="text" id="c_key" autocapitalize="off" autocomplete="off" spellcheck="false" value="'+esc(passcode())+'"></div>';
  h+='<button type="button" class="btn block" id="c_go">'+esc(t("connect"))+'</button>';
  h+='<p class="hint">'+esc(t("lastSync"))+': '+esc(last)+(S.outbox.length?' · '+esc(t("pendingN"))+S.outbox.length:'')+'</p>';
  h+='<button type="button" class="btn ghost block" id="c_sync">'+esc(t("syncNow"))+'</button>';
  h+='<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="c_wifi"'+(lsGet("plog.wifiOnly")==="1"?" checked":"")+'> '+esc(t("wifiOnly"))+'</label>';
  if(S.meta.aiEnabled) h+='<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="c_tx"'+(lsGet("plog.txOff")==="1"?"":" checked")+'> <span>'+esc(t("txSetting"))+' '+TX_ICON+'</span></label>';
  if(S.meta.sheetUrl||S.meta.folderUrl) h+='<div class="linkrow">'+(S.meta.sheetUrl?'<a class="btn ghost" href="'+esc(S.meta.sheetUrl)+'" target="_blank" rel="noopener">📊 '+esc(t("openSheet"))+'</a>':'')+(S.meta.folderUrl?'<a class="btn ghost" href="'+esc(S.meta.folderUrl)+'" target="_blank" rel="noopener">🖼️ '+esc(t("openFolder"))+'</a>':'')+'</div>';
  // Samsung Internet wraps installed web apps in an outdated package that Play Protect blocks; Chrome's works
  const samsung=/SamsungBrowser/i.test(navigator.userAgent) && /Android/i.test(navigator.userAgent);
  if(samsung && !(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)){
    const u=location.href.replace(/^https?:\/\//,"").replace(/#.*$/,"");
    h+='<div class="hint" style="margin-top:10px">'+esc(t("samsungHint"))+'</div><a class="btn ghost block" style="margin-top:6px;text-align:center" href="intent://'+esc(u)+'#Intent;scheme=https;package=com.android.chrome;end">📲 '+esc(t("openChrome"))+'</a>';
  } else if(/iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && !(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)){
    // iOS has no install button for web apps: it's done from the Share menu
    h+='<div class="hint" style="margin-top:10px">📲 '+esc(t("iosHint"))+'</div>';
  } else if(S.installEvt) h+='<button type="button" class="btn ghost block" id="c_install" style="margin-top:10px">📲 '+esc(t("install"))+'</button>';
  h+='</div>';
  // categories
  h+='<div class="card"><div class="field"><label class="f" for="s_title">'+esc(t("sTitle"))+'</label><input type="text" id="s_title" value="'+esc(sDraft.title)+'"></div>';
  h+='<h3>'+esc(t("sItems"))+'</h3><p class="hint" style="margin-top:-6px">'+esc(t("sItemsHint"))+'</p>';
  sDraft.items.forEach((it,i)=>{
    h+='<div class="setitem'+(it.hidden?" hidden":"")+'"><button type="button" class="nm linkish" data-ren="'+i+'">'+esc(itemName(it))+mtMark(itemMT(it))+(S.lang!=="en"?' <span class="muted small">· '+esc(itemName(it,"en"))+mtMark(itemMT(it,"en"))+'</span>':"")+''+(it.hazard?' <span style="color:var(--warn)">⚠</span>':"")+'</button>'+
      '<button type="button" class="iconbtn" data-up="'+i+'" aria-label="up"'+(i===0?" disabled":"")+'>↑</button><button type="button" class="iconbtn" data-haz="'+i+'" title="'+esc(t("hazard"))+'">⚠</button><button type="button" class="iconbtn" data-hide="'+i+'" title="'+esc(it.hidden?t("show"):t("hide"))+'">'+(it.hidden?"👁":"✕")+'</button></div>';
  });
  h+='<div style="margin-top:12px"><label class="f">'+esc(t("newItem"))+'</label><div style="display:grid;gap:8px;margin-bottom:8px">'+sDraft.languages.map(c=>'<input type="text" data-niname="'+esc(c)+'" placeholder="'+esc(t("catName").replace("{lang}",langInfo(c).name))+'">').join("")+'</div><label class="small"><input type="checkbox" id="ni_haz"> '+esc(t("hazard"))+'</label> <button type="button" class="btn ghost block" id="ni_add" style="margin-top:8px">+ '+esc(t("newItem"))+'</button></div>';
  const groups=repeatedExtras(sDraft.items);
  if(groups.length) h+='<div class="promote"><h4>'+esc(t("promoteT"))+'</h4><p class="hint">'+esc(t("promoteHint"))+'</p>'+groups.map((g,i)=>
    '<div class="setitem"><div class="nm">'+esc(g.label)+' <span class="muted small">· '+esc(t("promoteCount").replace("{d}",fmt(g.days.size,0)).replace("{n}",fmt(g.total,0)))+'</span></div><button type="button" class="btn ghost small" data-promote="'+i+'">'+esc(t("promoteBtn"))+'</button></div>').join("")+'</div>';
  h+='<button type="button" class="btn block" id="s_save" style="margin-top:14px">'+esc(t("saveSettings"))+'</button></div>';
  // languages and labels
  h+='<div class="card"><h3>'+esc(t("langsTitle"))+'</h3><p class="hint" style="margin-top:-6px">'+esc(t("langsHint"))+'</p><div class="langgrid">'+
    I18N.langs.map(L=>'<label class="small"><input type="checkbox" data-lang="'+esc(L.code)+'"'+(sDraft.languages.includes(L.code)?" checked":"")+(L.code==="en"?" disabled":"")+'> <span lang="'+esc(L.code)+'">'+esc(L.name)+'</span>'+(L.code!=="en"?' <span class="muted">· '+esc(L.english)+'</span>':"")+'</label>').join("")+
    '</div><button type="button" class="btn ghost block" id="l_save" style="margin-top:10px">'+esc(t("saveLangs"))+'</button></div>';
  h+='<div class="card"><h3>'+esc(t("labelsTitle"))+'</h3><p class="hint" style="margin-top:-6px">'+esc(t("labelsHint"))+'</p><button type="button" class="btn ghost block" id="l_seed">'+esc(t("seedLabels"))+'</button>'+
    (S.meta.sheetUrl?'<div class="linkrow"><a class="btn ghost" href="'+esc(S.meta.sheetUrl)+'" target="_blank" rel="noopener">📊 '+esc(t("openSheet"))+'</a></div>':"")+'</div>';
  // export / import
  h+='<div class="card"><h3>'+esc(t("export"))+'</h3><div class="row"><button type="button" class="btn ghost" id="x_csv">'+esc(t("csv"))+'</button><button type="button" class="btn ghost" id="x_json">'+esc(t("json"))+'</button></div></div>';
  h+='<div class="card"><h3>'+esc(t("importT"))+'</h3><label class="filebtn">'+esc(t("importBtn"))+'<input type="file" id="i_file" accept="application/json,.json"></label></div>';
  h+=versionCard();
  $("#view").innerHTML=h; checkVersion();
  bindSettings();
}
function bindSettings(){
  const mark=()=>{ settingsDirty=true; };
  $("#c_go").addEventListener("click",async()=>{
    const u=$("#c_url").value.trim(), k=$("#c_key").value.trim();
    const baked=window.PLOG_CONFIG && window.PLOG_CONFIG.apiUrl;
    if(u && u!==baked) lsSet("plog.api",u); else { try{ localStorage.removeItem("plog.api"); }catch(e){} }
    lsSet("plog.key",k);
    const b=$("#c_go"); b.disabled=true;
    try{ await api("ping",{}); toast(t("connected")); kickSync(10); }
    catch(err){ toast(err&&err.code==="auth"? t("wrongPass") : t("connFail")+((err&&(err.message||err.code))||"")); setSync(err&&err.code==="auth"?"auth":(navigator.onLine===false?"offline":"error")); }
    b.disabled=false;
  });
  $("#c_sync").addEventListener("click",()=>kickSync(10));
  $("#c_wifi").addEventListener("change",ev=>{ lsSet("plog.wifiOnly",ev.target.checked?"1":"0"); kickSync(500); });
  const ctx=$("#c_tx"); if(ctx) ctx.addEventListener("change",ev=>lsSet("plog.txOff",ev.target.checked?"0":"1"));
  const ci=$("#c_install"); if(ci) ci.addEventListener("click",async()=>{ const e=S.installEvt; S.installEvt=null; try{ await e.prompt(); }catch(x){} renderSettings(); });
  const st=$("#s_title"); st.addEventListener("input",()=>{ sDraft.title=st.value; mark(); });
  $$("[data-up]").forEach(b=>b.addEventListener("click",()=>{ const i=+b.dataset.up; if(i>0){ const a=sDraft.items; [a[i-1],a[i]]=[a[i],a[i-1]]; mark(); renderSettings(); } }));
  $$("[data-haz]").forEach(b=>b.addEventListener("click",()=>{ const it=sDraft.items[+b.dataset.haz]; it.hazard=!it.hazard; mark(); renderSettings(); }));
  $$("[data-hide]").forEach(b=>b.addEventListener("click",()=>{ const it=sDraft.items[+b.dataset.hide]; it.hidden=!it.hidden; mark(); renderSettings(); }));
  /* a new category gets a name per offered language; the first name given fills the gaps */
  const add=(names,haz)=>{
    const vals=Object.values(names).map(v=>(v||"").trim()).filter(Boolean); if(!vals.length) return;
    sDraft.items.push(newCategory(names,sDraft.languages,haz)); mark(); renderSettings(); };
  $("#ni_add").addEventListener("click",()=>{ const names={}; $$("[data-niname]").forEach(i=>names[i.dataset.niname]=i.value); add(names,$("#ni_haz").checked); });
  $$("[data-ren]").forEach(b=>b.addEventListener("click",()=>renameItem(sDraft.items[+b.dataset.ren],sDraft.languages,()=>{ mark(); renderSettings(); })));
  $$("[data-promote]").forEach(b=>b.addEventListener("click",()=>promoteExtras(repeatedExtras(sDraft.items)[+b.dataset.promote],sDraft,configOut)));
  const configOut=()=>({title:sDraft.title.trim(),languages:sDraft.languages,
    items:sDraft.items.map(it=>Object.assign({},it,{en:itemName(it,"en"),kn:itemName(it,"kn")}))});   // en/kn copies keep the Sheet's column titles readable
  $("#s_save").addEventListener("click",async()=>{ await localConfig(configOut()); settingsDirty=false; toast(t("setSaved")); route(); });
  $$("[data-lang]").forEach(cb=>cb.addEventListener("change",()=>{ const c=cb.dataset.lang;
    sDraft.languages = cb.checked ? sDraft.languages.concat(c) : sDraft.languages.filter(x=>x!==c);
    if(!sDraft.languages.includes("en")) sDraft.languages.push("en"); mark(); }));
  $("#l_save").addEventListener("click",async()=>{
    for(const c of sDraft.languages) await loadLangFile(c);
    await localConfig(configOut()); settingsDirty=false;
    if(!enabledLangs().includes(S.lang)) await setLang(enabledLangs()[0]);
    toast(t("setSaved")); route(); });
  $("#l_seed").addEventListener("click",async ev=>{
    const b=ev.target; b.disabled=true;
    try{
      const ctx=await fetchJSON("i18n/_context.json").catch(()=>({}));
      const langs=I18N.langs.map(l=>l.code).filter(c=>c==="en"||sDraft.languages.includes(c));
      for(const c of langs) await loadLangFile(c);
      const keys=Object.keys(I18N.en);
      const rows=keys.map(k=>{ const r={key:k,where:(ctx[k]&&ctx[k].where)||""}; for(const c of langs) r[c]=(c==="en"?I18N.en:I18N.files[c]||{})[k]||""; return r; });
      const r=await api("seedStrings",{langs,rows});
      toast(t("seedDone")+r.added); kickSync(500);
    }catch(err){ toast(t("connFail")+((err&&(err.message||err.code))||"")); }
    b.disabled=false;
  });
  $("#x_csv").addEventListener("click",()=>download("plogging-"+todayStr()+".csv",toCSV(),"text/csv;charset=utf-8"));
  $("#x_json").addEventListener("click",()=>download("plogging-backup-"+todayStr()+".json",JSON.stringify({version:1,exported:new Date().toISOString(),config:S.config,entries:entries().map(cleanEntry)},null,1),"application/json"));
  $("#i_file").addEventListener("change",async ev=>{
    const f=ev.target.files&&ev.target.files[0]; ev.target.value=""; if(!f) return;
    try{
      const data=JSON.parse(await f.text()); const list=Array.isArray(data)?data:(data.entries||[]);
      let n=0;
      for(const e of list){ if(!e||!/^\d{4}-\d{2}-\d{2}$/.test(e.date||"")) continue; e.id=e.id||(e.date+"-"+uid(6)); if(S.map[e.id]) continue; norm(e); e.media=(e.media||[]).filter(p=>p.id); S.map[e.id]=e; queue({t:"save",id:e.id}); n++; }
      if(data.config && !S.config){ S.config=data.config; queue({t:"config"}); }
      await persist(); kickSync(); toast(t("imported")+n); route();
    }catch(e){ toast(t("importFail")); }
  });
}
function download(name,data,mime){
  const url=URL.createObjectURL(new Blob([data],{type:mime}));
  const a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
function toCSV(){
  const its=items(); const keys=[...new Set(its.map(i=>i.key).concat(entries().flatMap(e=>Object.keys(e.counts||{}))))];
  const nums=dayNumbers();
  const col=collection();
  const head=["date","day_no","type","start","end","minutes","distance_km","place","people","others","participants"].concat(keys.map(k=>{ const it=itemByKey(k); return it? itemName(it,"en") : k; })).concat(["other_items","total_items","bags","weight_kg","notes","photos","videos","pickup_status","collected_on","collected_by","pickup_by","pickup_days","pickup_items"]);
  const q=v=>{ v=v==null?"":String(v); if(/^[=+\-@]/.test(v)) v="'"+v; return /[",\n]/.test(v)? '"'+v.replace(/"/g,'""')+'"' : v; };
  const rows=[head.map(q).join(",")];
  for(const e of entries().sort((a,b)=>a.date.localeCompare(b.date))){
    const rest=!isPlog(e);
    const r=[e.date,rest?"":nums[e.id],e.type||"plog",e.start,e.end,minutes(e),e.distanceKm,e.place,(e.people||[]).join("; "),e.others,rest?"":peopleCount(e)]
      .concat(keys.map(k=>(e.counts||{})[k]||""))
      .concat([(e.extras||[]).map(x=>x.name+": "+x.count).join("; "),rest?"":entryTotal(e),e.bags,e.weightKg,e.notes,
        (e.media||[]).filter(p=>p.id&&p.kind!=="video").map(p=>"https://drive.google.com/file/d/"+p.id+"/view").join(" "),
        (e.media||[]).filter(p=>p.id&&p.kind==="video").map(p=>"https://drive.google.com/file/d/"+p.id+"/view").concat((e.videos||[]).map(v=>v.url)).join(" ")])
      .concat(isPlog(e)&&col[e.id]? [col[e.id].status, col[e.id].last?col[e.id].last.date:"", col[e.id].last?agencyLabel(col[e.id].last,true):"","","",""]
             : e.type==="pickup"? ["","","",agencyLabel(e,true),(e.covers||[]).length,pickupItems(e,col)] : ["","","","","",""]);
    rows.push(r.map(q).join(","));
  }
  return "﻿"+rows.join("\n");
}

/* ================================================================ start */
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); S.installEvt=e; if(currentView()==="settings"&&!settingsDirty) renderSettings(); });
/* the splash stays until the first screen is drawn; from the home screen it gets time to finish growing */
function hideSplash(){
  const sp=document.getElementById("splash"); if(!sp||sp.dataset.going) return; sp.dataset.going="1";
  const standalone=window.matchMedia&&matchMedia("(display-mode: standalone)").matches;
  const wait=Math.max(0,(standalone?1700:300)-performance.now());
  setTimeout(()=>{ sp.classList.add("out"); setTimeout(()=>sp.remove(),350); },wait);
}
async function init(){
  try{ I18N.langs=await fetchJSON("i18n/languages.json"); }catch(e){ I18N.langs=[{code:"kn",name:"ಕನ್ನಡ",english:"Kannada",short:"ಕ",intl:"kn-IN",font:"Noto Sans Kannada"},{code:"en",name:"English",english:"English",short:"EN",intl:"en-IN",font:"Noto Sans"}]; }
  try{ I18N.en=await fetchJSON("i18n/en.json"); I18N.files.en=I18N.en; }catch(e){}
  S.storageOk = await IDB.open();
  try{
    S.map = normMap((await IDB.get("kv","map")) || {});
    S.lib = (await IDB.get("kv","lib")) || {topics:{},files:{}};
    S.trc = (await IDB.get("kv","trc")) || {};
    S.outbox = (await IDB.get("kv","outbox")) || [];
    S.config = (await IDB.get("kv","config")) || null;
    S.meta = (await IDB.get("kv","meta")) || {};
  }catch(e){}
  // demo/preview builds can name a sample file to show on first open (never queued for upload)
  const demo=window.PLOG_CONFIG && window.PLOG_CONFIG.demoSeed;
  if(demo && !Object.keys(S.map).length && lsGet("plog.demoLoaded")!=="1"){
    try{ const d=await fetchJSON(demo); for(const e of (d.entries||[])){ if(e&&e.id&&e.date){ S.map[e.id]=norm(e); } } lsSet("plog.demoLoaded","1"); await persist(); }catch(e){}
  }
  // previews for photos still waiting to upload
  for(const f of Object.values(S.lib.files)) if(f.pending){ try{ const b=await IDB.get("blobs",f.id); if(b) S.blobUrls[f.id]=URL.createObjectURL(b); }catch(x){} }
  for(const e of entries()) for(const p of (e.media||[])) if(p.pending){
    try{ const b=await IDB.get("blobs",p.cid); if(b) S.blobUrls[p.cid]=URL.createObjectURL(b); }catch(x){}
  }
  if(!apiUrl()||!passcode()) S.sync="none"; else if(navigator.onLine===false) S.sync="offline";
  const want=lsGet("plog.lang")||enabledLangs()[0]||"kn";
  await setLang(I18N.langs.some(l=>l.code===want)? want : "kn");
  route(); hideSplash();
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
  if("serviceWorker" in navigator && location.protocol!=="file:"){
    // look for a new version each time the app is opened or comes back to the front
    navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).then(reg=>{
      document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") reg.update().catch(()=>{}); });
    }).catch(()=>{});
    // when the new version takes over, reload, but never in the middle of filling a form
    let had=!!navigator.serviceWorker.controller, reloading=false;
    const reloadSoon=()=>{ if(reloading) return;
      const busy=()=>currentView()==="add"||sheetOpen()||($("#viewer")&&$("#viewer").style.display==="block");
      if(!busy()){ reloading=true; location.reload(); }
      else window.addEventListener("hashchange",function h(){ if(!busy()){ window.removeEventListener("hashchange",h); reloading=true; location.reload(); } }); };
    navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(had) reloadSoon(); had=true; });
  }
  kickSync(200);
}
init().catch(err=>{ console.error(err); }).finally(()=>hideSplash());
setTimeout(hideSplash,10000);   // never leave the splash up, whatever happens
