/**
 * 도면 하자 핀 앱 공유 서버 (Google Apps Script)
 * - 도면·핀 목록: 구글 시트 「도면 하자 핀」 (시트 '도면', '핀')
 * - 도면 PDF·사진: 구글 드라이브 「도면 하자 핀」 폴더 (도면/, 사진/<도면 이름>/)
 * 같은 웹 앱 URL·PIN을 넣은 휴대폰끼리 같은 도면과 핀을 함께 보고 고친다.
 *
 * 설치: script.google.com → 새 프로젝트 → 이 코드 붙여넣기 → 아래 PIN 바꾸기 → 저장
 *      → 위쪽 함수 선택에서 setup 실행(권한 승인)
 *      → 배포 > 새 배포 > 유형: 웹 앱, 실행: 나, 액세스 권한: 모든 사용자 → 배포 → 웹 앱 URL 복사
 *      → 앱의 '구글 공유'에 URL과 PIN 입력
 *
 * 사람별 비밀번호: 앱에서 이름과 비밀번호를 처음 넣으면 시트 '사용자'에 등록된다(비밀번호는 암호화해서 저장).
 *   - 맨 처음 등록한 사람이 관리자가 된다. 관리자를 바꾸려면 '사용자' 시트의 admin 칸에 true / false 를 적는다.
 *   - 비밀번호를 잊으면 관리자가 '사용자' 시트에서 그 사람의 줄을 지운다 → 다시 넣는 비밀번호로 새로 등록된다.
 *   - 도면 쪽마다 이름(예: 지하 4층)을 붙이면 사진대지의 위치에 함께 나온다.
 *   - 다른 사람의 핀은 관리자만 고치거나 지울 수 있다. 다른 사람은 조치완료(되돌리기 포함)만 할 수 있고,
 *     완료를 누른 사람 이름과 시각이 저장된다.
 *   - 핀마다 팀(공사·안전·품질)이 저장되고, 앱에서 팀별 색으로 보인다. 사진마다 대표 사진(★) 표시가 저장된다.
 */
const PIN = '0000';   // ← 앱에서 입력할 비밀번호. 꼭 바꿔 주세요. 함께 쓸 사람에게만 알려 주세요.

const SS_NAME = '도면 하자 핀';
const ROOT_NAME = '도면 하자 핀';
const D_COLS = ['id', 'name', 'pages', 'fileId', 'created', 'updated', 'deleted', 'by', 'ver', 'pageNames'];
const U_COLS = ['name', 'salt', 'hash', 'admin', 'created', 'lastLogin'];
const P_COLS = ['id', 'drawingId', 'no', 'page', 'status', 'trade', 'text', 'by', 'editor', 'created', 'updated', 'doneAt', 'deleted', 'data(JSON)'];

function doGet() { return out_({ ok: true, app: 'drawing-pins', time: Date.now() }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (String(req.pin) !== String(PIN)) return out_({ ok: false, error: 'PIN이 맞지 않습니다' });
    if (req.action === 'drawingFile') { auth_(req); return out_({ ok: true, data: drawingFile_(req.id) }); }   // 읽기만 하는 큰 요청은 잠금 없이
    if (req.action === 'photo') { auth_(req); return out_({ ok: true, data: photo_(req.id) }); }
    const lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      if (req.action === 'login') return out_(Object.assign({ ok: true }, login_(req)));
      const me = auth_(req);
      switch (req.action) {
        case 'ping': ss_(); return out_({ ok: true, time: Date.now(), me: me });
        case 'drawings': return out_({ ok: true, drawings: drawings_(), me: me });
        case 'uploadDrawing': return out_({ ok: true, drawing: uploadDrawing_(req.drawing, req.data, me.name) });
        case 'renameDrawing': return out_({ ok: true, drawing: patchDrawing_(req.id, { name: req.name }) });
        case 'deleteDrawing': return out_({ ok: true, drawing: patchDrawing_(req.id, { deleted: true }) });
        case 'replaceDrawingFile': return out_({ ok: true, drawing: replaceDrawingFile_(req.id, req.data, req.pages, req.map || {}, me, req.names) });
        case 'setPageNames': return out_({ ok: true, drawing: setPageNames_(req.id, req.names) });
        case 'pins': return out_({ ok: true, pins: pins_(req.drawingId), ver: drawingVer_(req.drawingId), time: Date.now() });
        case 'savePin': return out_({ ok: true, pin: savePin_(req.item, req.photos || {}, me) });
        case 'deletePin': return out_({ ok: true, pin: deletePin_(req.id, me) });
        default: return out_({ ok: false, error: '알 수 없는 요청' });
      }
    } finally { lock.releaseLock(); }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- 시트·폴더 ---------- */
function ss_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('PINS_SS_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(SS_NAME);
    const d = ss.getSheets()[0]; d.setName('도면');
    d.getRange(1, 1, 1, D_COLS.length).setValues([D_COLS]); d.setFrozenRows(1);
    const p = ss.insertSheet('핀');
    p.getRange(1, 1, 1, P_COLS.length).setValues([P_COLS]); p.setFrozenRows(1);
    props.setProperty('PINS_SS_ID', ss.getId());
  }
  const dh = ss.getSheetByName('도면').getRange(1, 1, 1, D_COLS.length);   // 예전 시트에 새 칸(ver) 머리글 추가
  if (dh.getValues()[0][D_COLS.length - 1] !== D_COLS[D_COLS.length - 1]) dh.setValues([D_COLS]);
  if (!ss.getSheetByName('사용자')) {   // 예전 버전에서 만든 시트에는 '사용자' 시트가 없다
    const u = ss.insertSheet('사용자');
    u.getRange(1, 1, 1, U_COLS.length).setValues([U_COLS]); u.setFrozenRows(1);
  }
  return ss;
}
function folder_(parts) {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('PINS_ROOT_ID'), f = null;
  if (id) { try { f = DriveApp.getFolderById(id); } catch (e) { f = null; } }
  if (!f) { f = DriveApp.createFolder(ROOT_NAME); props.setProperty('PINS_ROOT_ID', f.getId()); }
  parts.forEach(p => { p = String(p).replace(/[\\/]/g, '_'); const it = f.getFoldersByName(p); f = it.hasNext() ? it.next() : f.createFolder(p); });
  return f;
}
function rows_(name) {   // [{row, obj}]
  const sh = ss_().getSheetByName(name), n = sh.getLastRow();
  if (n < 2) return { sh, list: [] };
  const cols = name === '도면' ? D_COLS : name === '사용자' ? U_COLS : P_COLS;
  const v = sh.getRange(2, 1, n - 1, cols.length).getValues();
  return { sh, list: v.map((r, i) => { const o = {}; cols.forEach((c, j) => o[c] = r[j]); o._row = i + 2; return o; }) };
}
function writeRow_(sh, cols, row, o) {
  const vals = [cols.map(c => o[c] === undefined || o[c] === null ? '' : o[c])];
  if (!row) row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, cols.length).setNumberFormat('@').setValues(vals.map(r => r.map(x => typeof x === 'string' ? x : String(x))));
  return row;
}

/* ---------- 사용자 ---------- */
function hash_(salt, pw) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8));
}
function userOut_(u) { return { name: u.name, admin: u.admin === 'true' || u.admin === true || String(u.admin).toUpperCase() === 'TRUE' }; }
function auth_(req) {
  const name = String(req.user || '').trim(), pw = String(req.pw || '');
  if (!name || !pw) throw new Error('로그인이 필요합니다');
  const u = rows_('사용자').list.find(x => String(x.name).trim() === name);
  if (!u) throw new Error('등록되지 않은 이름입니다');
  if (hash_(u.salt, pw) !== u.hash) throw new Error('비밀번호가 맞지 않습니다');
  return userOut_(u);
}
function login_(req) {
  const name = String(req.user || '').trim(), pw = String(req.pw || '');
  if (!name) throw new Error('이름을 넣어 주세요');
  if (pw.length < 4) throw new Error('비밀번호는 4자 이상으로 해 주세요');
  const { sh, list } = rows_('사용자');
  const u = list.find(x => String(x.name).trim() === name);
  if (u) {
    if (hash_(u.salt, pw) !== u.hash) throw new Error('비밀번호가 맞지 않습니다');
    u.lastLogin = Date.now(); writeRow_(sh, U_COLS, u._row, u);
    return { me: userOut_(u), time: Date.now() };
  }
  if (!req.register) return { newUser: true };   // 처음 보는 이름: 앱에서 한 번 더 확인받고 등록
  const salt = Utilities.getUuid(), now = Date.now();
  const o = { name: name, salt: salt, hash: hash_(salt, pw), admin: list.length ? 'false' : 'true', created: now, lastLogin: now };   // 첫 사용자 = 관리자
  writeRow_(sh, U_COLS, 0, o);
  return { me: userOut_(o), created: true, time: now };
}

/* ---------- 도면 ---------- */
function drawingOut_(o) {
  return { id: o.id, name: o.name, pages: +o.pages || 1, created: +o.created || 0, updated: +o.updated || 0, deleted: o.deleted === 'true' || o.deleted === true, by: o.by || '', ver: o.ver || '', pageNames: names_(o.pageNames) };
}
function drawings_() {
  const pins = rows_('핀').list.filter(p => p.deleted !== 'true');
  return rows_('도면').list.map(o => {
    const d = drawingOut_(o), mine = pins.filter(p => p.drawingId === o.id);
    d.open = mine.filter(p => p.status !== 'done').length; d.done = mine.length - d.open;
    return d;
  });
}
function uploadDrawing_(d, data, by) {
  const { sh, list } = rows_('도면');
  const ex = list.find(o => o.id === d.id);
  if (ex) return drawingOut_(ex);   // 이미 올라간 도면
  const blob = Utilities.newBlob(Utilities.base64Decode(data), 'application/pdf', String(d.name).replace(/[\\/]/g, '_') + '.pdf');
  const file = folder_(['도면']).createFile(blob);
  const now = Date.now();
  const o = { id: d.id, name: d.name, pages: d.pages || 1, fileId: file.getId(), created: d.created || now, updated: now, deleted: 'false', by: by || '' };
  writeRow_(sh, D_COLS, 0, o);
  return drawingOut_(o);
}
function patchDrawing_(id, patch) {
  const { sh, list } = rows_('도면');
  const o = list.find(x => x.id === id); if (!o) throw new Error('도면이 없습니다');
  if (patch.name) o.name = patch.name;
  if (patch.deleted) o.deleted = 'true';   // 시트 기록과 드라이브 파일은 지우지 않고 '삭제' 표시만 한다
  o.updated = Date.now();
  writeRow_(sh, D_COLS, o._row, o);
  return drawingOut_(o);
}
function names_(v) { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(x => String(x || '')) : []; } catch (e) { return []; } }
function setPageNames_(id, names) {
  const { sh, list } = rows_('도면');
  const o = list.find(x => x.id === id); if (!o) throw new Error('도면이 없습니다');
  o.pageNames = JSON.stringify((names || []).map(x => String(x || '').slice(0, 40))); o.updated = Date.now();
  writeRow_(sh, D_COLS, o._row, o);
  return drawingOut_(o);
}
function drawingVer_(id) { const o = rows_('도면').list.find(x => x.id === id); return o ? (o.ver || '') : ''; }
/* 쪽 더하기·빼기·순서 바꾸기: 새 PDF로 바꾸고, 핀의 쪽 번호를 map(예전 쪽 → 새 쪽)대로 옮긴다.
   예전 PDF 파일은 드라이브에 그대로 남겨 둔다. */
function replaceDrawingFile_(id, data, pages, map, me, names) {
  const { sh, list } = rows_('도면');
  const o = list.find(x => x.id === id); if (!o) throw new Error('도면이 없습니다');
  const P = rows_('핀'), mine = P.list.filter(x => x.drawingId === id && x.deleted !== 'true');
  const lost = mine.filter(x => !map[+x.page]);
  if (lost.length) throw new Error('빼려는 쪽에 핀이 있습니다 (' + lost.map(x => x.no + '번').join(', ') + '). 새로 고친 뒤 다시 해 주세요');
  const now = Date.now(), stamp = Utilities.formatDate(new Date(now), 'Asia/Seoul', 'yyMMdd HHmm');
  const blob = Utilities.newBlob(Utilities.base64Decode(data), 'application/pdf', String(o.name).replace(/[\\/]/g, '_') + ' (' + stamp + ').pdf');
  o.fileId = folder_(['도면']).createFile(blob).getId();
  o.pages = +pages || 1; o.updated = now; o.ver = String(now); o.by = o.by || me.name;
  if (names) o.pageNames = JSON.stringify(names.map(x => String(x || '').slice(0, 40)));
  writeRow_(sh, D_COLS, o._row, o);
  mine.forEach(x => {
    const np = +map[+x.page];
    if (np !== +x.page) { const q = pinOut_(x); q.page = np; q.updated = now; writeRow_(P.sh, P_COLS, x._row, pinRow_(q)); }
  });
  return drawingOut_(o);
}
function drawingFile_(id) {
  const o = rows_('도면').list.find(x => x.id === id); if (!o) throw new Error('도면이 없습니다');
  return Utilities.base64Encode(DriveApp.getFileById(o.fileId).getBlob().getBytes());
}

/* ---------- 핀 ---------- */
function pinOut_(o) {
  let extra = {}; try { extra = JSON.parse(o['data(JSON)'] || '{}'); } catch (e) {}
  return Object.assign(extra, {
    id: o.id, drawingId: o.drawingId, no: +o.no, page: +o.page, status: o.status || 'open', trade: o.trade || '', text: o.text || '',
    by: o.by || '', editor: o.editor || '', created: +o.created || 0, updated: +o.updated || 0, doneAt: +o.doneAt || null,
    deleted: o.deleted === 'true'
  });
}
function pins_(drawingId) { return rows_('핀').list.filter(o => o.drawingId === drawingId).map(pinOut_); }
function pinRow_(p) {
  const ph = x => { const o = { k: x.k, id: x.id, w: x.w, h: x.h }; if (x.rep) o.rep = true; return o; };
  const extra = { nx: p.nx, ny: p.ny, px: p.px, py: p.py, shape: p.shape || null, doneBy: p.doneBy || '', team: p.team || '',
    photos: (p.photos || []).map(ph), donePhotos: (p.donePhotos || []).map(ph) };
  return Object.assign({}, p, { deleted: p.deleted ? 'true' : 'false', doneAt: p.doneAt || '', 'data(JSON)': JSON.stringify(extra) });
}
// 사진 묶음(list) 정리: 새로 온 사진은 드라이브에 저장, 앱에서 지운 사진은 휴지통으로
function syncPhotos_(list, before, photos, folderParts, prefix) {
  const out = (list || []).map((x, i) => {
    if (!x.id && photos[x.k]) {
      const blob = Utilities.newBlob(Utilities.base64Decode(photos[x.k]), 'image/jpeg', prefix + ' ' + (i + 1) + '.jpg');
      x.id = folder_(folderParts).createFile(blob).getId();
    }
    const o = { k: x.k, id: x.id, w: x.w, h: x.h }; if (x.rep) o.rep = true;
    return o;
  }).filter(x => x.id);
  const keep = out.map(x => x.id);
  (before || []).forEach(x => { if (x.id && keep.indexOf(x.id) < 0) { try { DriveApp.getFileById(x.id).setTrashed(true); } catch (e) {} } });
  return out;
}
function savePin_(p, photos, me) {
  const { sh, list } = rows_('핀');
  const ex = list.find(o => o.id === p.id);
  if (ex && ex.deleted === 'true') return pinOut_(ex);   // 다른 사람이 지운 핀은 되살리지 않는다
  const now = Date.now(), old = ex ? pinOut_(ex) : null;
  // 상태: 조치완료로 바뀌면 누른 사람과 시각을 서버에서 적는다
  const setDone = (q, status) => {
    const was = old ? old.status : 'open';
    q.status = status === 'done' ? 'done' : 'open';
    if (q.status === 'done' && was !== 'done') { q.doneAt = now; q.doneBy = me.name; }
    else if (q.status === 'done') { q.doneAt = old.doneAt; q.doneBy = old.doneBy || ''; }
    else { q.doneAt = ''; q.doneBy = ''; }
  };
  const dname = (rows_('도면').list.find(o => o.id === p.drawingId) || {}).name || p.drawingId;
  // 다른 사람의 핀: 관리자가 아니면 상태(조치완료)와 조치완료 사진만 바꾼다
  if (old && old.by && old.by !== me.name && !me.admin) {
    const q = Object.assign({}, old);
    setDone(q, p.status);
    const dp = syncPhotos_(p.donePhotos, old.donePhotos, photos, ['사진', dname], old.no + '번 핀 조치완료');
    const dpChanged = JSON.stringify(dp.map(x => [x.id, !!x.rep])) !== JSON.stringify((old.donePhotos || []).map(x => [x.id, !!x.rep]));
    q.donePhotos = dp;
    if (q.status !== old.status || dpChanged) { q.editor = me.name; q.updated = now; }
    writeRow_(sh, P_COLS, ex._row, pinRow_(q));
    return pinOut_(pinRow_(q));
  }
  p.by = old ? (old.by || me.name) : me.name;   // 만든 사람은 바뀌지 않는다
  p.editor = me.name;
  setDone(p, p.status);
  // 번호: 새 핀이 이미 쓰인 번호를 달고 오면(동시에 찍은 경우) 다음 번호로 바꾼다
  const others = list.filter(o => o.drawingId === p.drawingId && o.id !== p.id);
  if (!ex && others.some(o => +o.no === +p.no)) p.no = others.reduce((m, o) => Math.max(m, +o.no), 0) + 1;
  if (ex) p.no = +ex.no;
  // 사진(조치 전)과 조치완료 사진
  p.photos = syncPhotos_(p.photos, old ? old.photos : [], photos, ['사진', dname], p.no + '번 핀');
  p.donePhotos = syncPhotos_(p.donePhotos, old ? old.donePhotos : [], photos, ['사진', dname], p.no + '번 핀 조치완료');
  p.updated = now;
  writeRow_(sh, P_COLS, ex ? ex._row : 0, pinRow_(p));
  return pinOut_(pinRow_(p));
}
function deletePin_(id, me) {
  const { sh, list } = rows_('핀');
  const o = list.find(x => x.id === id); if (!o) return null;
  const p = pinOut_(o);
  if (p.by && p.by !== me.name && !me.admin) return p;   // 다른 사람의 핀은 지우지 않는다(앱은 다음 동기화 때 다시 받는다)
  (p.photos || []).concat(p.donePhotos || []).forEach(x => { try { DriveApp.getFileById(x.id).setTrashed(true); } catch (e) {} });
  p.deleted = true; p.editor = me.name; p.updated = Date.now(); p.photos = []; p.donePhotos = [];
  writeRow_(sh, P_COLS, o._row, pinRow_(p));
  return p;
}
function photo_(id) { return Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()); }

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* 배포 전 한 번 실행하면 시트·폴더를 만들고 권한을 승인받는다 */
function setup() { ss_(); folder_([]); Logger.log('시트: ' + ss_().getUrl()); }
