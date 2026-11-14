/**
 * ಜಲಗಾರ · Jalagara (plogging journal) — Google Apps Script backend
 *
 * Stores each day's entry as one row of a Google Sheet ("Entries") and
 * photos and videos in a Google Drive folder. The web app talks to this script with
 * POST requests carrying a shared passcode.
 *
 * First-time setup (see README.md):
 *   1. Run setup() once from the editor and authorise it.
 *   2. Read the passcode, spreadsheet and folder links from the execution log.
 *   3. Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *   4. Optional, for AI counting suggestions: Project Settings → Script properties →
 *      add ANTHROPIC_API_KEY (your Claude API key). CLAUDE_MODEL and CLAUDE_EFFORT
 *      can override the defaults below.
 */

const SHEET_ENTRIES = 'Entries';
const SHEET_CONFIG = 'Config';
const FIXED_HEADERS = [
  'id', 'date', 'type', 'day_no', 'start', 'end', 'minutes', 'distance_km', 'place',
  'people', 'others', 'participants', 'total_items', 'hazardous_items', 'other_items',
  'bags', 'weight_kg', 'notes', 'photos', 'videos', 'updated_at', 'json',
  'collected_on', 'collected_by', 'pickup_days', 'pickup_items'
];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/* ------------------------------------------------------------------ setup */

function setup() {
  const props = PropertiesService.getScriptProperties();
  let ss;
  const ssId = props.getProperty('SHEET_ID');
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
  } else {
    ss = SpreadsheetApp.create('ಜಲಗಾರ · Jalagara');
    props.setProperty('SHEET_ID', ss.getId());
  }
  ensureSheets_(ss);

  let folderId = props.getProperty('FOLDER_ID');
  if (!folderId) {
    folderId = DriveApp.createFolder('ಜಲಗಾರ · Jalagara — photos & videos').getId();
    props.setProperty('FOLDER_ID', folderId);
  }

  let passcode = props.getProperty('PASSCODE');
  if (!passcode) {
    passcode = randomCode_();
    props.setProperty('PASSCODE', passcode);
  }

  Logger.log('Spreadsheet:  ' + ss.getUrl());
  Logger.log('Photo folder: ' + DriveApp.getFolderById(folderId).getUrl());
  Logger.log('PASSCODE:     ' + passcode);
}

/** Run this to replace the passcode (everyone must enter the new one). */
function changePasscode() {
  const passcode = randomCode_();
  PropertiesService.getScriptProperties().setProperty('PASSCODE', passcode);
  Logger.log('New PASSCODE: ' + passcode);
}

/* -------------------------------------------------------------- endpoints */

function doGet() {
  return out_({ ok: true, app: 'jalagara' });
}

function doPost(e) {
  let req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return out_({ ok: false, error: 'bad_json' });
  }
  return handle_(req);
}

function handle_(req) {
  try {
    checkKey_(req.key);
    switch (req.action) {
      case 'ping':
        return out_({ ok: true });
      case 'list':
        return out_({
          ok: true,
          entries: listEntries_(),
          config: getConfig_(),
          sheetUrl: spreadsheet_().getUrl(),
          folderUrl: folder_().getUrl(),
          aiEnabled: !!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),
          strings: getStrings_(),
          library: listLibrary_(),
          version: SCRIPT_VERSION,
          serverTime: new Date().toISOString()
        });
      case 'save':
        return out_({ ok: true, entry: withLock_(() => saveEntry_(req.entry)) });
      case 'delete':
        withLock_(() => deleteEntry_(req.id));
        return out_({ ok: true });
      case 'saveConfig':
        withLock_(() => saveConfig_(req.config));
        return out_({ ok: true });
      case 'shareMedia':
        return out_({ ok: true, files: shareMedia_(req) });
      case 'upload':
        return out_({ ok: true, file: upload_(req) });
      case 'startVideo':
        return out_(Object.assign({ ok: true }, startVideo_(req)));
      case 'videoChunk':
        return out_(Object.assign({ ok: true }, videoChunk_(req)));
      case 'videoStatus':
        return out_(Object.assign({ ok: true }, videoStatus_(req)));
      case 'finishVideo':
        return out_({ ok: true, file: finishVideo_(req) });
      case 'saveTopic':
        return out_({ ok: true, topic: withLock_(() => saveTopic_(req.topic)) });
      case 'deleteTopic':
        withLock_(() => deleteTopic_(req.id));
        return out_({ ok: true });
      case 'startFile':
        return out_(Object.assign({ ok: true }, startFile_(req)));
      case 'saveFile':
        return out_({ ok: true, file: withLock_(() => saveFile_(req.file)) });
      case 'deleteFile':
        withLock_(() => deleteFile_(req.id));
        return out_({ ok: true });
      case 'seedStrings':
        return out_(Object.assign({ ok: true }, withLock_(() => seedStrings_(req))));
      case 'analyze':
        return out_({ ok: true, result: analyze_(req) });
      case 'translate':
        return out_({ ok: true, result: translate_(req) });
      case 'translateText':
        return out_({ ok: true, result: translateText_(req) });
      default:
        return out_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ------------------------------------------------------------------ helpers */

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey_(key) {
  const pc = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!pc || String(key || '') !== pc) {
    Utilities.sleep(1500); // slows down guessing
    throw new Error('unauthorized');
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function randomCode_() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('not_set_up');
  return SpreadsheetApp.openById(id);
}

function folder_() {
  const id = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  if (!id) throw new Error('not_set_up');
  return DriveApp.getFolderById(id);
}

function ensureSheets_(ss) {
  let sh = ss.getSheetByName(SHEET_ENTRIES);
  if (!sh) sh = ss.insertSheet(SHEET_ENTRIES);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, FIXED_HEADERS.length).setValues([FIXED_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_CONFIG)) ss.insertSheet(SHEET_CONFIG);
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
}

function entriesSheet_() {
  const ss = spreadsheet_();
  ensureSheets_(ss);
  return ss.getSheetByName(SHEET_ENTRIES);
}

/** Adds any standard column an older sheet lacks (new columns go at the end). */
function ensureFixedHeaders_(sh) {
  let headers = headers_(sh);
  FIXED_HEADERS.forEach(function (h) {
    if (headers.indexOf(h) < 0) { sh.getRange(1, headers.length + 1).setValue(h).setFontWeight('bold'); headers = headers_(sh); }
  });
  return headers;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

/** A text cell must not be read by Sheets as a formula. */
function txt_(v) {
  const s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function num_(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

function minutes_(e) {
  if (!e.start || !e.end) return '';
  const a = String(e.start).split(':').map(Number), b = String(e.end).split(':').map(Number);
  let m = (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
  if (m < 0) m += 1440;
  return isFinite(m) ? m : '';
}

function itemHeader_(key, cfg) {
  const it = ((cfg && cfg.items) || []).filter(function (i) { return i.key === key; })[0];
  return ((it && (it.en || it.kn)) || key) + ' [' + key + ']';
}

function keyOfHeader_(h) {
  const m = /\[([^\]]+)\]$/.exec(h);
  return m ? m[1] : null;
}

/* -------------------------------------------------------------- entries */

function listEntries_() {
  const sh = entriesSheet_();
  if (sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const ji = values[0].map(String).indexOf('json');
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const s = values[r][ji];
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch (err) { /* skip a hand-edited, broken row */ }
  }
  return out;
}

function validEntry_(e) {
  return e && typeof e === 'object' &&
    typeof e.id === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(e.id) &&
    typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date);
}

function saveEntry_(e) {
  if (!validEntry_(e)) throw new Error('invalid_entry');
  e.updatedAt = new Date().toISOString();
  const json = JSON.stringify(e);
  if (json.length > 45000) throw new Error('entry_too_large');

  const cfg = getConfig_();
  const sh = entriesSheet_();
  let headers = ensureFixedHeaders_(sh);

  // one column per trash category, added the first time it is used
  const counts = e.counts || {};
  Object.keys(counts).forEach(function (k) {
    if (!headers.some(function (h) { return keyOfHeader_(h) === k; })) {
      sh.getRange(1, headers.length + 1).setValue(itemHeader_(k, cfg)).setFontWeight('bold');
      headers = headers_(sh);
    }
  });

  const hazardKeys = ((cfg && cfg.items) || []).filter(function (i) { return i.hazard; }).map(function (i) { return i.key; });
  let total = 0, hazard = 0;
  Object.keys(counts).forEach(function (k) {
    total += num_(counts[k]);
    if (hazardKeys.indexOf(k) >= 0) hazard += num_(counts[k]);
  });
  (e.extras || []).forEach(function (x) { total += num_(x.count); });
  const rest = e.type === 'rest', pickup = e.type === 'pickup';
  const media = e.media || e.photos || [];
  if (pickup) { total = 0; hazard = 0; }

  const vals = {
    id: e.id,
    date: e.date,
    type: e.type || 'plog',
    day_no: rest ? '' : (e.dayNo || ''),
    start: e.start || '',
    end: e.end || '',
    minutes: minutes_(e),
    distance_km: e.distanceKm == null ? '' : e.distanceKm,
    place: txt_(e.place),
    people: txt_((e.people || []).join(', ')),
    others: e.others || '',
    participants: (rest || pickup) ? '' : ((e.people || []).length + num_(e.others)),
    total_items: (rest || pickup) ? '' : total,
    hazardous_items: (rest || pickup) ? '' : hazard,
    other_items: txt_((e.extras || []).map(function (x) { return x.name + ': ' + x.count; }).join('; ')),
    bags: e.bags == null ? '' : e.bags,
    weight_kg: e.weightKg == null ? '' : e.weightKg,
    notes: txt_(e.notes),
    photos: media.filter(function (m) { return m.id && m.kind !== 'video'; })
      .map(function (m) { return 'https://drive.google.com/file/d/' + m.id + '/view'; }).join('\n'),
    videos: media.filter(function (m) { return m.id && m.kind === 'video'; })
      .map(function (m) { return 'https://drive.google.com/file/d/' + m.id + '/view'; })
      .concat((e.videos || []).map(function (v) { return v.url; })).join('\n'),
    updated_at: new Date(),
    json: json,
    collected_by: pickup ? txt_(pickupWho_(e)) : '',
    pickup_days: pickup ? (e.covers || []).length : '',
    pickup_items: pickup ? txt_(e.keys && e.keys.length ? e.keys.join(', ') : 'all') : ''
  };
  // keep what the day's row says about collection (filled in by refreshCollected_) when the day is re-saved
  if (!pickup) {
    const old = findRow_(sh, e.id);
    if (old) {
      const oldRow = sh.getRange(old, 1, 1, headers.length).getValues()[0];
      vals.collected_on = oldRow[headers.indexOf('collected_on')];
      vals.collected_by = oldRow[headers.indexOf('collected_by')];
    }
  }
  const row = headers.map(function (h) {
    if (Object.prototype.hasOwnProperty.call(vals, h)) return vals[h];
    const k = keyOfHeader_(h);
    return k ? (counts[k] || '') : '';
  });

  const r = findRow_(sh, e.id);
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  if (pickup) refreshCollected_();
  return e;
}

/* ---------------------------------------------------------------- pickups */
/*
 * A pickup entry (type "pickup") records the panchayat / municipal body (or a
 * scrap dealer…) taking away what was plogged. It lists the days it covers
 * (e.covers) and, optionally, only some categories (e.keys; empty = all).
 * The days' own rows get "collected_on / collected_by" so the Sheet shows it.
 */
function pickupWho_(e) {
  const names = { panchayat: 'Gram Panchayat', municipal: 'Municipality', scrap: 'Scrap dealer' };
  const who = names[e.agency] || '';
  return [who, e.agencyName || ''].filter(String).join(' — ');
}

function refreshCollected_() {
  const sh = entriesSheet_();
  const headers = ensureFixedHeaders_(sh);
  if (sh.getLastRow() < 2) return;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues();
  const ji = headers.indexOf('json'), ci = headers.indexOf('collected_on'), bi = headers.indexOf('collected_by');
  const entries = v.map(function (row) { try { return JSON.parse(row[ji]); } catch (err) { return null; } });
  const pickups = entries.filter(function (e) { return e && e.type === 'pickup'; })
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  const on = {}, by = {}, partly = {};
  pickups.forEach(function (p) {
    (p.covers || []).forEach(function (id) {
      on[id] = p.date; by[id] = pickupWho_(p);
      if (p.keys && p.keys.length) partly[id] = true;
    });
  });
  const colOn = [], colBy = [];
  entries.forEach(function (e, i) {
    const id = e && e.id, isDay = e && e.type !== 'pickup' && e.type !== 'rest';
    colOn.push([isDay && on[id] ? on[id] + (partly[id] ? ' (part)' : '') : (isDay ? '' : v[i][ci])]);
    colBy.push([isDay && on[id] ? by[id] : (isDay ? '' : v[i][bi])]);
  });
  sh.getRange(2, ci + 1, colOn.length, 1).setValues(colOn);
  sh.getRange(2, bi + 1, colBy.length, 1).setValues(colBy);
}

function findRow_(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function deleteEntry_(id) {
  if (typeof id !== 'string' || !id) throw new Error('invalid_id');
  const sh = entriesSheet_();
  const r = findRow_(sh, id);
  if (!r) return;
  let wasPickup = false;
  try { wasPickup = JSON.parse(sh.getRange(r, headers_(sh).indexOf('json') + 1).getValue()).type === 'pickup'; } catch (err) { /* ignore */ }
  sh.deleteRow(r); // photos stay in Drive on purpose
  if (wasPickup) refreshCollected_();
}

/* --------------------------------------------------------------- config */

function getConfig_() {
  const sh = spreadsheet_().getSheetByName(SHEET_CONFIG);
  if (!sh) return null;
  const s = sh.getRange(1, 1).getValue();
  if (!s) return null;
  try { return JSON.parse(s); } catch (err) { return null; }
}

function saveConfig_(cfg) {
  if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.items)) throw new Error('invalid_config');
  const ss = spreadsheet_();
  ensureSheets_(ss);
  const sh = ss.getSheetByName(SHEET_CONFIG);
  sh.clear();
  sh.getRange(1, 1).setValue(JSON.stringify(cfg));
  sh.getRange(2, 1).setValue('↑ The app reads row 1. The table below is for reading only.');
  const table = [['key', 'kannada', 'english', 'hazardous', 'hidden']].concat(
    cfg.items.map(function (i) { return [i.key, txt_(i.kn), txt_(i.en), i.hazard ? 'yes' : '', i.hidden ? 'yes' : '']; })
  );
  sh.getRange(4, 1, table.length, 5).setValues(table);
  sh.getRange(4, 1, 1, 5).setFontWeight('bold');

  // keep item column titles in step with the names in the app
  const es = ss.getSheetByName(SHEET_ENTRIES);
  const headers = headers_(es);
  headers.forEach(function (h, i) {
    const k = keyOfHeader_(h);
    if (k) {
      const nh = itemHeader_(k, cfg);
      if (nh !== h) es.getRange(1, i + 1).setValue(nh);
    }
  });
}

/* --------------------------------------------------------------- photos */

function upload_(req) {
  const mime = String(req.mimeType || '');
  if (!/^image\//.test(mime)) throw new Error('images_only');
  const clientId = String(req.clientId || '');
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(clientId)) throw new Error('invalid_client_id');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.date || '') ? req.date : Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error('bad_size');

  const folder = monthFolder_(date);

  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const name = date + '_' + clientId + '.' + ext;
  const existing = folder.getFilesByName(name); // a retried upload returns the first copy
  const file = existing.hasNext() ? existing.next() : folder.createFile(Utilities.newBlob(bytes, mime, name));

  let shared = true;
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    shared = false; // some Workspace domains forbid link sharing
  }
  return { id: file.getId(), url: file.getUrl(), shared: shared };
}

/* --------------------------------------------------------------- videos */
/*
 * Videos are too large to pass through this script in one piece, so they use
 * Google Drive's resumable upload: this script opens an upload session in the
 * project folder, and the phone sends the file in small pieces, either
 * straight to Drive or (if the browser refuses that) through videoChunk_.
 * An interrupted upload continues from the last piece Drive confirmed.
 */

const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

function monthFolder_(date) {
  const root = folder_();
  const month = String(date).slice(0, 7);
  const it = root.getFoldersByName(month);
  return it.hasNext() ? it.next() : root.createFolder(month);
}

function videoExt_(mime) {
  if (/^audio\//.test(mime)) return /mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /mpeg|mp3/.test(mime) ? 'mp3' : /wav/.test(mime) ? 'wav' : /amr/.test(mime) ? 'amr' : 'webm';
  if (/quicktime/.test(mime)) return 'mov';
  if (/webm/.test(mime)) return 'webm';
  if (/3gpp/.test(mime)) return '3gp';
  if (/matroska/.test(mime)) return 'mkv';
  return 'mp4';
}

function checkSession_(url) {
  url = String(url || '');
  if (url.indexOf(DRIVE_UPLOAD + '?') !== 0 || url.indexOf('upload_id=') < 0) throw new Error('invalid_session');
  return url;
}

function header_(res, name) {
  const h = res.getHeaders();
  const k = Object.keys(h).filter(function (x) { return x.toLowerCase() === name.toLowerCase(); })[0];
  return k ? String(h[k]) : '';
}

/** Interprets Drive's answer to a chunk or status request. */
function sessionState_(res) {
  const code = res.getResponseCode();
  if (code === 200 || code === 201) {
    const body = JSON.parse(res.getContentText() || '{}');
    return { status: 'done', id: body.id };
  }
  if (code === 308) {
    const m = /bytes=0-(\d+)/.exec(header_(res, 'Range'));
    return { status: 'incomplete', offset: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 404 || code === 410) return { status: 'expired' };
  throw new Error('drive_' + code);
}

function startVideo_(req) {
  const mime = String(req.mimeType || 'video/mp4');
  if (!/^(video|audio)\//.test(mime)) throw new Error('videos_only');   // voice notes travel the same way
  const clientId = String(req.clientId || '');
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(clientId)) throw new Error('invalid_client_id');
  const size = Number(req.size);
  if (!(size > 0 && size <= MAX_VIDEO_BYTES)) throw new Error('bad_size');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.date || '') ? req.date : Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const origin = /^https?:\/\/[A-Za-z0-9.:-]+$/.test(req.origin || '') ? req.origin : '';

  const folder = monthFolder_(date);
  const name = date + '_' + clientId + '.' + videoExt_(mime);
  const existing = folder.getFilesByName(name); // already finished earlier
  if (existing.hasNext()) return { status: 'done', id: existing.next().getId() };

  const headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'X-Upload-Content-Type': mime,
    'X-Upload-Content-Length': String(size)
  };
  if (origin) headers.Origin = origin; // lets the phone send pieces straight to Drive
  const res = UrlFetchApp.fetch(DRIVE_UPLOAD + '?uploadType=resumable&fields=id', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: headers,
    payload: JSON.stringify({ name: name, parents: [folder.getId()], mimeType: mime }),
    muteHttpExceptions: true
  });
  const session = header_(res, 'Location');
  if (res.getResponseCode() !== 200 || !session) throw new Error('drive_session_' + res.getResponseCode());
  return { status: 'started', session: session };
}

function videoChunk_(req) {
  const session = checkSession_(req.session);
  const start = Number(req.start), total = Number(req.total);
  const bytes = Utilities.base64Decode(String(req.data || ''));
  if (!(start >= 0) || !(total > 0) || !bytes.length || start + bytes.length > total) throw new Error('bad_range');
  const res = UrlFetchApp.fetch(session, {
    method: 'put',
    contentType: 'application/octet-stream',
    headers: { 'Content-Range': 'bytes ' + start + '-' + (start + bytes.length - 1) + '/' + total },
    payload: bytes,
    muteHttpExceptions: true
  });
  return sessionState_(res);
}

function videoStatus_(req) {
  const session = checkSession_(req.session);
  const total = Number(req.total);
  if (!(total > 0)) throw new Error('bad_range');
  const res = UrlFetchApp.fetch(session, {
    method: 'put',
    headers: { 'Content-Range': 'bytes */' + total },
    muteHttpExceptions: true
  });
  return sessionState_(res);
}

/** True when the file sits somewhere under the project folder (any depth). */
/* the day's photos, for sharing to WhatsApp etc. from a phone that doesn't have them stored locally */
function shareMedia_(req) {
  const out = [];
  (req.ids || []).slice(0, 6).forEach(function (id) {
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(id || ''))) return;
    try {
      const f = DriveApp.getFileById(id);
      if (!insideRoot_(f) || f.isTrashed() || f.getSize() > 4 * 1024 * 1024 || !/^image\//.test(f.getMimeType())) return;
      const b = f.getBlob();
      out.push({ id: id, name: f.getName(), mime: f.getMimeType(), data: Utilities.base64Encode(b.getBytes()) });
    } catch (err) { /* missing or not ours: skip */ }
  });
  return out;
}

function insideRoot_(file) {
  const root = folder_().getId();
  let level = [];
  const ps = file.getParents(); while (ps.hasNext()) level.push(ps.next());
  for (let depth = 0; depth < 25 && level.length; depth++) {
    const next = [];
    for (let i = 0; i < level.length; i++) {
      if (level[i].getId() === root) return true;
      const pp = level[i].getParents(); while (pp.hasNext()) next.push(pp.next());
    }
    level = next;
  }
  return false;
}

function finishVideo_(req) {
  const id = String(req.id || '');
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) throw new Error('invalid_id');
  const file = DriveApp.getFileById(id);
  if (!insideRoot_(file)) throw new Error('not_our_file');
  let shared = true;
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    shared = false;
  }
  return { id: id, shared: shared };
}

/* ------------------------------------------------------- AI suggestions */
/*
 * Sends the day's photos (and a few frames from its videos) to Claude and asks
 * for suggested counts per trash category. The API key stays in Script
 * Properties; the phones never see it. The app shows the result as a
 * suggestion that a person confirms; nothing is saved automatically.
 */

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-5-5';
const CLAUDE_DEFAULT_EFFORT = 'low';
const AI_MAX_IMAGES = 6;

const AI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['counts', 'others', 'hazards', 'reliable', 'note_en', 'note_local'],
  properties: {
    counts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'count', 'confidence', 'visible_only'],
        properties: {
          key: { type: 'string' },
          count: { type: 'integer' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          visible_only: { type: 'boolean' }
        }
      }
    },
    others: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name_en', 'name_local', 'count', 'hazard'],
        properties: {
          name_en: { type: 'string' },
          name_local: { type: 'string' },
          count: { type: 'integer' },
          hazard: { type: 'boolean' }
        }
      }
    },
    hazards: { type: 'array', items: { type: 'string' } },
    reliable: { type: 'boolean' },
    note_en: { type: 'string' },
    note_local: { type: 'string' }
  }
};

function aiPrompt_(items, nImages, kinds, langName) {
  const list = items.map(function (i) {
    const local = i.local || i.kn || '';
    return '- ' + i.key + ': ' + (i.en || i.key) + (local && local !== i.en ? ' (' + local + ')' : '') + (i.hazard ? ' [hazardous]' : '');
  }).join('\n');
  return [
    'These ' + nImages + ' images document one day of plogging (picking up roadside litter while walking) in a village in Karnataka, India.',
    'Image sources, in order: ' + kinds.join(', ') + '. Frames taken from the same video show the same scene.',
    '',
    'Count the collected trash items by category. Categories (use these keys):',
    list,
    '',
    'Rules:',
    '- Count only items you can actually see. Several photos or frames may show the same pile from different angles: do not add those up; use the highest count seen for that pile. Add counts only across clearly different piles, bags or buckets.',
    '- Items hidden inside bags or buried under others cannot be counted. When a category is only partly visible, give the visible count and set visible_only to true.',
    '- Use confidence "low" when items are crushed, dirty, overlapping or hard to tell apart.',
    '- Snack wrappers, chip packets and other loose plastic usually cannot be counted one by one. If they are present but no category fits, add one entry to "others" with an estimated count, or 0 with the amount described in the note (for example "about two buckets").',
    '- Put anything that fits no category into "others", with a short English name (name_en) and its name in ' + langName + ' (name_local).',
    '- List sharp, medical, chemical or electrical waste (needles and syringes, broken glass, CFL or tube lights, batteries) in "hazards" in plain English.',
    '- Set "reliable" to false when much of the trash is piled or bagged so that counts are likely well below the true numbers.',
    '- note_en and note_local: one or two short sentences for the volunteers, in English and in simple ' + langName + '. Say what was hard to count and, if useful, how to photograph it next time so counting is accurate (for example spread each type in a single layer on the tarp and take one photo from above).',
    '- Only include categories with a count above zero in "counts".'
  ].join('\n');
}

function analyze_(req) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ai_not_configured');
  const images = (req.images || []).slice(0, AI_MAX_IMAGES);
  if (!images.length) throw new Error('no_images');
  const items = (req.items || []).filter(function (i) { return i && /^[A-Za-z0-9_]{1,60}$/.test(i.key || ''); }).slice(0, 40);

  const blocks = [], kinds = [];
  images.forEach(function (im) {
    let data, mime;
    if (im.driveId) {
      if (!/^[A-Za-z0-9_-]{10,100}$/.test(im.driveId)) throw new Error('invalid_id');
      const blob = DriveApp.getFileById(im.driveId).getBlob();
      mime = blob.getContentType(); data = Utilities.base64Encode(blob.getBytes());
    } else {
      mime = String(im.mime || 'image/jpeg'); data = String(im.data || '');
    }
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new Error('images_only');
    if (!data || data.length > 7 * 1024 * 1024) throw new Error('bad_size');
    blocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: data } });
    kinds.push(im.source === 'video' ? 'video frame' : 'photo');
  });
  const langName = /^[A-Za-z ()-]{2,40}$/.test(req.langName || '') ? req.langName : 'Kannada';
  blocks.push({ type: 'text', text: aiPrompt_(items, blocks.length, kinds, langName) });

  const r = claudeJson_(blocks, AI_SCHEMA, 8000);
  const out = r.out, model = r.model;
  const known = {};
  items.forEach(function (i) { known[i.key] = true; });
  out.counts = (out.counts || []).filter(function (c) { return known[c.key] && c.count > 0; });
  out.model = model;
  out.usage = r.usage;
  return out;
}

/* One request to Claude that must answer with JSON matching `schema`. */
function claudeJson_(content, schema, maxTokens) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ai_not_configured');
  const model = props.getProperty('CLAUDE_MODEL') || CLAUDE_DEFAULT_MODEL;
  const body = {
    model: model,
    max_tokens: maxTokens,
    output_config: {
      effort: props.getProperty('CLAUDE_EFFORT') || CLAUDE_DEFAULT_EFFORT,
      format: { type: 'json_schema', schema: schema }
    },
    messages: [{ role: 'user', content: content }]
  };
  const res = UrlFetchApp.fetch(CLAUDE_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  let j = {};
  try { j = JSON.parse(res.getContentText() || '{}'); } catch (err) { /* fall through */ }
  if (code !== 200) {
    const msg = (j.error && j.error.message) || ('HTTP ' + code);
    throw new Error('ai_error: ' + msg.slice(0, 200));
  }
  if (j.stop_reason === 'refusal') throw new Error('ai_refused');
  const text = (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  try { return { out: JSON.parse(text), model: model, usage: j.usage || null }; }
  catch (err) { throw new Error(j.stop_reason === 'max_tokens' ? 'ai_too_long' : 'ai_bad_output'); }
}

/* ------------------------------------------------------------- content translation */
/*
 * Free text (notes, places, Library titles…) shown in another language than it was written in.
 * Translations are kept in a 'Translations' tab, so each text is translated once for everyone.
 * req.lang: {code, name}; req.texts: [{id, text}] (id = the app's hash of the text, up to 40).
 */
/* shown in the app's Settings → About, to see whether the deployed script is up to date */
const SCRIPT_VERSION = '2026-11-14b';

const TT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['id', 'already_in_target_language', 'translation'],
    properties: { id: { type: 'string' }, already_in_target_language: { type: 'boolean' }, translation: { type: 'string' } } } } }
};
function trSheet_() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  let sh = ss.getSheetByName('Translations');
  if (!sh) { sh = ss.insertSheet('Translations'); sh.getRange(1, 1, 1, 6).setValues([['key', 'lang', 'original', 'translation', 'same', 'at']]); sh.setFrozenRows(1); }
  return sh;
}
function translateText_(req) {
  const lang = req.lang || {};
  if (!/^[a-z]{2,3}$/.test(lang.code || '') || !/^[^<>{}]{2,40}$/.test(lang.name || '')) throw new Error('bad_lang');
  const texts = (req.texts || []).filter(function (x) {
    return x && /^[A-Za-z0-9_.:-]{1,80}$/.test(String(x.id || '')) && String(x.text || '').trim();
  }).slice(0, 40).map(function (x) { return { id: String(x.id), text: String(x.text).trim().slice(0, 2000) }; });
  if (!texts.length) return { items: [] };
  const sh = trSheet_();
  const known = {};
  const n = sh.getLastRow();
  if (n > 1) sh.getRange(2, 1, n - 1, 5).getValues().forEach(function (r) { known[r[0]] = { t: String(r[3]), same: r[4] === true || r[4] === 'TRUE' }; });
  const out = [], todo = [];
  texts.forEach(function (x) {
    const k = x.id + '|' + lang.code;
    if (known[k]) out.push({ id: x.id, text: known[k].t, same: known[k].same }); else todo.push(x);
  });
  if (todo.length) {
    const prompt = [
      'These short texts come from a village plogging (litter-picking) journal in Karnataka, India: notes, impressions, place names, titles and captions.',
      'Translate each into ' + lang.name + ' (' + lang.code + '), in its own script, in a natural everyday register.',
      'Rules:',
      '- Names of people, villages, roads and landmarks: transliterate into the target script, do not translate their meaning. A text that is only a person\'s name (e.g. ಕವಿತಾ) is transliterated (Kavitha), never translated.',
      '- Keep numbers, dates, times and brand names as they are. Keep line breaks.',
      '- If a text is already in ' + lang.name + ', set already_in_target_language to true and return it unchanged.',
      '- Return every id given.',
      '',
      'Texts (JSON):',
      JSON.stringify(todo)
    ].join('\n');
    const r = claudeJson_([{ type: 'text', text: prompt }], TT_SCHEMA, 8000);
    const ids = {}; todo.forEach(function (x) { ids[x.id] = x; });
    const rows = [], now = new Date().toISOString();
    (r.out.items || []).forEach(function (it) {
      const x = ids[it.id]; if (!x) return;
      const same = !!it.already_in_target_language;
      const t = same ? x.text : String(it.translation || '').trim().slice(0, 4000);
      if (!t) return;
      out.push({ id: x.id, text: t, same: same });
      rows.push([x.id + '|' + lang.code, lang.code, x.text, t, same, now]);
      delete ids[it.id];
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }
  return { items: out };
}

/* ------------------------------------------------------------- translation */
/*
 * Names of trash items, typed by volunteers in whichever language they use, are
 * translated into the app's other languages so everyone sees them in their own.
 * req.texts: [{id, text}] (up to 40), req.langs: [{code, name}] (up to 12).
 */
const TR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'source_lang', 'names'],
        properties: {
          id: { type: 'string' },
          source_lang: { type: 'string' },
          names: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['lang', 'text'],
              properties: { lang: { type: 'string' }, text: { type: 'string' } }
            }
          }
        }
      }
    }
  }
};

function translate_(req) {
  const texts = (req.texts || []).filter(function (x) {
    return x && /^[A-Za-z0-9_.:-]{1,80}$/.test(String(x.id || '')) && String(x.text || '').trim();
  }).slice(0, 40).map(function (x) { return { id: String(x.id), text: String(x.text).trim().slice(0, 120) }; });
  const langs = (req.langs || []).filter(function (l) {
    return l && /^[a-z]{2,3}$/.test(l.code || '') && /^[^<>{}]{2,40}$/.test(l.name || '');
  }).slice(0, 12);
  if (!texts.length || !langs.length) return { items: [] };
  const prompt = [
    'Volunteers in a village in Karnataka, India, pick up roadside litter (plogging) and record what they collect.',
    'Below are names of kinds of trash they typed, each in whatever language they were using.',
    'Give each name in every one of these languages: ' + langs.map(function (l) { return l.code + ' (' + l.name + ')'; }).join(', ') + '.',
    '',
    'Rules:',
    '- Use the plain everyday words a villager would use, in that language\'s own script. Common English loanwords (bottle, can, CFL, PVC, tube light) are fine where people actually say them.',
    '- Keep it a short noun phrase, plural where the original is plural. Keep brand names and abbreviations as they are.',
    '- For the language the name was typed in, return the text unchanged. Set source_lang to that language\'s code.',
    '- Return every id given, with one entry per language code listed.',
    '',
    'Names (id: text):'
  ].concat(texts.map(function (x) { return x.id + ': ' + x.text; })).join('\n');
  const r = claudeJson_([{ type: 'text', text: prompt }], TR_SCHEMA, 4000);
  const want = {}; langs.forEach(function (l) { want[l.code] = true; });
  const ids = {}; texts.forEach(function (x) { ids[x.id] = true; });
  const items = (r.out.items || []).filter(function (it) { return ids[it.id]; }).map(function (it) {
    const names = {};
    (it.names || []).forEach(function (n) { if (want[n.lang] && String(n.text || '').trim()) names[n.lang] = String(n.text).trim().slice(0, 120); });
    return { id: it.id, source: String(it.source_lang || ''), names: names };
  });
  return { items: items, model: r.model };
}

/** Run once from the editor to check the API key and model work. */
function testClaude() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) { Logger.log('Add ANTHROPIC_API_KEY under Project Settings → Script properties first.'); return; }
  const res = UrlFetchApp.fetch(CLAUDE_URL, {
    method: 'post', contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: PropertiesService.getScriptProperties().getProperty('CLAUDE_MODEL') || CLAUDE_DEFAULT_MODEL,
      max_tokens: 200, messages: [{ role: 'user', content: 'Reply with the word ok.' }] }),
    muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
}

/* ------------------------------------------------------------- labels */
/*
 * Optional tab "Strings": one row per label key, one column per language
 * (key | where | en | kn | hi | …). Non-empty cells override the labels built
 * into the app, on every phone, at the next sync. The app's Settings screen
 * fills this tab with "Copy labels to the spreadsheet"; existing rows are
 * never overwritten, so edits made in the sheet are kept.
 */
const SHEET_STRINGS = 'Strings';

function getStrings_() {
  const sh = spreadsheet_().getSheetByName(SHEET_STRINGS);
  if (!sh || sh.getLastRow() < 2) return {};
  const v = sh.getDataRange().getValues();
  const head = v[0].map(String);
  const out = {};
  head.forEach(function (h, c) {
    if (c < 2 || !/^[a-z]{2,3}$/.test(h)) return;
    const m = {};
    for (let r = 1; r < v.length; r++) {
      const k = String(v[r][0] || ''), val = v[r][c];
      if (k && val !== '' && val != null) m[k] = String(val).replace(/^'/, '');
    }
    out[h] = m;
  });
  return out;
}

function seedStrings_(req) {
  const langs = (req.langs || []).filter(function (l) { return /^[a-z]{2,3}$/.test(l); });
  if (langs.indexOf('en') < 0) langs.unshift('en');
  const rows = (req.rows || []).filter(function (r) { return r && /^[A-Za-z0-9_.]{1,80}$/.test(r.key || ''); });
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(SHEET_STRINGS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_STRINGS);
    sh.getRange(1, 1, 1, 2).setValues([['key', 'where']]);
    sh.setFrozenRows(1);
  }
  let head = headers_(sh);
  langs.forEach(function (l) {
    if (head.indexOf(l) < 0) { sh.getRange(1, head.length + 1).setValue(l); head = headers_(sh); }
  });
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  const have = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { have[String(r[0])] = true; });
  const add = rows.filter(function (r) { return !have[r.key]; }).map(function (r) {
    return head.map(function (h) { return h === 'key' ? r.key : txt_(r[h] || ''); });
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, head.length).setValues(add);
  return { added: add.length, url: ss.getUrl() + '#gid=' + sh.getSheetId() };
}

/* ---------------------------------------------------------------- library */
/*
 * Collaterals (images, PDFs, videos, documents) filed under a tree of topics.
 * Each topic is a Drive folder inside "Library" (so Drive mirrors the tree),
 * plus a row in the "Topics" tab; each file is a row in the "Library" tab.
 * The app reads the json column of both tabs; the other columns are for people.
 */
const SHEET_TOPICS = 'Topics';
const SHEET_LIBRARY = 'Library';
const TOPIC_HEADERS = ['id', 'parent', 'path', 'name', 'order', 'folder', 'updated_at', 'json'];
const FILE_HEADERS = ['id', 'topic', 'title', 'note', 'file_name', 'type', 'size_mb', 'linked_day', 'link', 'added_at', 'json'];
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

function libSheet_(name, headers) {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readJsonRows_(sh) {
  if (sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const ji = v[0].map(String).indexOf('json');
  const out = [];
  for (let r = 1; r < v.length; r++) { try { if (v[r][ji]) out.push(JSON.parse(v[r][ji])); } catch (err) { /* skip */ } }
  return out;
}

function listLibrary_() {
  const ss = spreadsheet_();
  const t = ss.getSheetByName(SHEET_TOPICS), f = ss.getSheetByName(SHEET_LIBRARY);
  return { topics: t ? readJsonRows_(t) : [], files: f ? readJsonRows_(f) : [] };
}

function libraryRoot_() {
  const root = folder_();
  const it = root.getFoldersByName('Library');
  return it.hasNext() ? it.next() : root.createFolder('Library');
}

function validId_(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{4,60}$/.test(id); }

function topicName_(t) {
  const n = t.names || {};
  return n.en || n.kn || Object.keys(n).map(function (k) { return n[k]; }).filter(String)[0] || t.id;
}

function topicsById_() {
  const map = {};
  readJsonRows_(libSheet_(SHEET_TOPICS, TOPIC_HEADERS)).forEach(function (t) { map[t.id] = t; });
  return map;
}

function topicPath_(id, map) {
  const parts = []; let cur = map[id], guard = 0;
  while (cur && guard++ < 50) { parts.unshift(topicName_(cur)); cur = cur.parent ? map[cur.parent] : null; }
  return parts.join(' › ');
}

function folderForTopic_(id, map) {
  if (!id) return libraryRoot_();
  const t = map[id];
  if (!t || !t.folderId) throw new Error('parent_missing');
  return DriveApp.getFolderById(t.folderId);
}

function upsertRow_(sh, headers, id, vals) {
  const row = headers.map(function (h) { return Object.prototype.hasOwnProperty.call(vals, h) ? vals[h] : ''; });
  const r = findRow_(sh, id);
  if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

/** Creates or updates a topic (rename, reorder, move under another parent). Drive follows. */
function saveTopic_(t) {
  if (!t || !validId_(t.id)) throw new Error('invalid_topic');
  if (t.parent && !validId_(t.parent)) throw new Error('invalid_parent');
  if (t.parent === t.id) throw new Error('invalid_parent');
  const names = {};
  Object.keys(t.names || {}).forEach(function (k) {
    if (/^[a-z]{2,3}$/.test(k) && t.names[k]) names[k] = String(t.names[k]).slice(0, 120);
  });
  if (!Object.keys(names).length) throw new Error('topic_needs_name');
  const sh = libSheet_(SHEET_TOPICS, TOPIC_HEADERS);
  const map = topicsById_();
  // refuse to move a topic inside its own subtree
  let p = t.parent ? map[t.parent] : null, guard = 0;
  while (p && guard++ < 50) { if (p.id === t.id) throw new Error('invalid_parent'); p = p.parent ? map[p.parent] : null; }

  const old = map[t.id];
  const parentFolder = folderForTopic_(t.parent || '', map);
  let folder;
  if (old && old.folderId) {
    folder = DriveApp.getFolderById(old.folderId);
    if ((old.parent || '') !== (t.parent || '')) folder.moveTo(parentFolder);
  } else {
    folder = parentFolder.createFolder(names.en || names.kn || topicName_({ names: names, id: t.id }));
  }
  const label = names.en && names.kn && names.en !== names.kn ? names.kn + ' · ' + names.en : (names.en || names.kn || topicName_({ names: names, id: t.id }));
  if (folder.getName() !== label) folder.setName(label);

  const rec = { id: t.id, parent: t.parent || '', names: names, order: Number(t.order) || 0,
                folderId: folder.getId(), createdAt: (old && old.createdAt) || t.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString() };
  map[t.id] = rec;
  upsertRow_(sh, TOPIC_HEADERS, t.id, {
    id: t.id, parent: rec.parent, path: txt_(topicPath_(t.id, map)), name: txt_(label), order: rec.order,
    folder: folder.getUrl(), updated_at: new Date(), json: JSON.stringify(rec)
  });
  return rec;
}

/** Deletes an empty topic (no subtopics, no files). Its Drive folder goes to the trash. */
function deleteTopic_(id) {
  if (!validId_(id)) throw new Error('invalid_id');
  const map = topicsById_();
  const t = map[id];
  if (!t) return;
  if (Object.keys(map).some(function (k) { return map[k].parent === id; })) throw new Error('topic_not_empty');
  if (readJsonRows_(libSheet_(SHEET_LIBRARY, FILE_HEADERS)).some(function (f) { return f.topic === id; })) throw new Error('topic_not_empty');
  const sh = libSheet_(SHEET_TOPICS, TOPIC_HEADERS);
  const r = findRow_(sh, id);
  if (r) sh.deleteRow(r);
  try { if (t.folderId) DriveApp.getFolderById(t.folderId).setTrashed(true); } catch (err) { /* already gone */ }
}

function safeName_(s) { return String(s || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120); }

/** Opens a resumable upload of a library file straight into its topic's folder. */
function startFile_(req) {
  const id = String(req.clientId || '');
  if (!validId_(id)) throw new Error('invalid_client_id');
  const mime = String(req.mimeType || 'application/octet-stream');
  if (!/^[a-z]+\/[A-Za-z0-9.+-]+$/.test(mime)) throw new Error('bad_type');
  const size = Number(req.size);
  if (!(size > 0 && size <= MAX_FILE_BYTES)) throw new Error('bad_size');
  const origin = /^https?:\/\/[A-Za-z0-9.:-]+$/.test(req.origin || '') ? req.origin : '';
  const folder = folderForTopic_(req.topic || '', topicsById_());
  const name = id + '_' + safeName_(req.name);
  const existing = folder.getFilesByName(name);
  if (existing.hasNext()) return { status: 'done', id: existing.next().getId() };
  const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) };
  if (origin) headers.Origin = origin;
  const res = UrlFetchApp.fetch(DRIVE_UPLOAD + '?uploadType=resumable&fields=id', {
    method: 'post', contentType: 'application/json; charset=UTF-8', headers: headers,
    payload: JSON.stringify({ name: name, parents: [folder.getId()], mimeType: mime }), muteHttpExceptions: true
  });
  const session = header_(res, 'Location');
  if (res.getResponseCode() !== 200 || !session) throw new Error('drive_session_' + res.getResponseCode());
  return { status: 'started', session: session };
}

/** Saves a library file's details; moves the Drive file if its topic changed. */
function saveFile_(f) {
  if (!f || !validId_(f.id)) throw new Error('invalid_file');
  if (f.topic && !validId_(f.topic)) throw new Error('invalid_topic');
  if (!f.driveId || !/^[A-Za-z0-9_-]{10,100}$/.test(f.driveId)) throw new Error('not_uploaded');
  const map = topicsById_();
  const file = DriveApp.getFileById(f.driveId);
  if (!insideRoot_(file)) throw new Error('not_our_file');
  const target = folderForTopic_(f.topic || '', map);
  const ps = file.getParents(); let here = false;
  while (ps.hasNext()) if (ps.next().getId() === target.getId()) here = true;
  if (!here) file.moveTo(target);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { /* domain policy */ }
  const rec = {
    id: f.id, topic: f.topic || '', driveId: f.driveId, name: safeName_(f.name), mime: String(f.mime || ''),
    size: Number(f.size) || 0, title: String(f.title || '').slice(0, 200), note: String(f.note || '').slice(0, 2000),
    entryId: validId_(f.entryId || '') || /^[A-Za-z0-9_.:-]{1,80}$/.test(f.entryId || '') ? (f.entryId || '') : '',
    addedAt: f.addedAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  const json = JSON.stringify(rec);
  if (json.length > 45000) throw new Error('file_note_too_long');
  upsertRow_(libSheet_(SHEET_LIBRARY, FILE_HEADERS), FILE_HEADERS, f.id, {
    id: f.id, topic: txt_(topicPath_(rec.topic, map) || '—'), title: txt_(rec.title), note: txt_(rec.note),
    file_name: txt_(rec.name), type: rec.mime, size_mb: Math.round(rec.size / 104857.6) / 10,
    linked_day: txt_(rec.entryId), link: file.getUrl(), added_at: rec.addedAt, json: json
  });
  return rec;
}

/** Removes a file from the library; the Drive file goes to the trash (recoverable for 30 days). */
function deleteFile_(id) {
  if (!validId_(id)) throw new Error('invalid_id');
  const sh = libSheet_(SHEET_LIBRARY, FILE_HEADERS);
  const rec = readJsonRows_(sh).filter(function (f) { return f.id === id; })[0];
  const r = findRow_(sh, id);
  if (r) sh.deleteRow(r);
  if (rec && rec.driveId) { try { const fl = DriveApp.getFileById(rec.driveId); if (insideRoot_(fl)) fl.setTrashed(true); } catch (err) { /* gone */ } }
}
