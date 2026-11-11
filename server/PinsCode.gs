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
 */
const PIN = '1234';   // ← 앱에서 입력할 비밀번호. 꼭 바꿔 주세요. 함께 쓸 사람에게만 알려 주세요.

const SS_NAME = '도면 하자 핀';
const ROOT_NAME = '도면 하자 핀';
const D_COLS = ['id', 'name', 'pages', 'fileId', 'created', 'updated', 'deleted', 'by'];
const P_COLS = ['id', 'drawingId', 'no', 'page', 'status', 'trade', 'text', 'by', 'editor', 'created', 'updated', 'doneAt', 'deleted', 'data(JSON)'];

function doGet() { return out_({ ok: true, app: 'drawing-pins', time: Date.now() }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (String(req.pin) !== String(PIN)) return out_({ ok: false, error: 'PIN이 맞지 않습니다' });
    if (req.action === 'drawingFile') return out_({ ok: true, data: drawingFile_(req.id) });   // 읽기만 하는 큰 요청은 잠금 없이
    if (req.action === 'photo') return out_({ ok: true, data: photo_(req.id) });
    const lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      switch (req.action) {
        case 'ping': ss_(); return out_({ ok: true, time: Date.now() });
        case 'drawings': return out_({ ok: true, drawings: drawings_() });
        case 'uploadDrawing': return out_({ ok: true, drawing: uploadDrawing_(req.drawing, req.data, req.by) });
        case 'renameDrawing': return out_({ ok: true, drawing: patchDrawing_(req.id, { name: req.name }) });
        case 'deleteDrawing': return out_({ ok: true, drawing: patchDrawing_(req.id, { deleted: true }) });
        case 'pins': return out_({ ok: true, pins: pins_(req.drawingId), time: Date.now() });
        case 'savePin': return out_({ ok: true, pin: savePin_(req.item, req.photos || {}) });
        case 'deletePin': return out_({ ok: true, pin: deletePin_(req.id, req.by) });
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
  const cols = name === '도면' ? D_COLS : P_COLS;
  const v = sh.getRange(2, 1, n - 1, cols.length).getValues();
  return { sh, list: v.map((r, i) => { const o = {}; cols.forEach((c, j) => o[c] = r[j]); o._row = i + 2; return o; }) };
}
function writeRow_(sh, cols, row, o) {
  const vals = [cols.map(c => o[c] === undefined || o[c] === null ? '' : o[c])];
  if (!row) row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, cols.length).setNumberFormat('@').setValues(vals.map(r => r.map(x => typeof x === 'string' ? x : String(x))));
  return row;
}

/* ---------- 도면 ---------- */
function drawingOut_(o) {
  return { id: o.id, name: o.name, pages: +o.pages || 1, created: +o.created || 0, updated: +o.updated || 0, deleted: o.deleted === 'true' || o.deleted === true, by: o.by || '' };
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
  const extra = { nx: p.nx, ny: p.ny, px: p.px, py: p.py, photos: (p.photos || []).map(x => ({ k: x.k, id: x.id, w: x.w, h: x.h })) };
  return Object.assign({}, p, { deleted: p.deleted ? 'true' : 'false', doneAt: p.doneAt || '', 'data(JSON)': JSON.stringify(extra) });
}
function savePin_(p, photos) {
  const { sh, list } = rows_('핀');
  const ex = list.find(o => o.id === p.id);
  if (ex && ex.deleted === 'true') return pinOut_(ex);   // 다른 사람이 지운 핀은 되살리지 않는다
  // 번호: 새 핀이 이미 쓰인 번호를 달고 오면(동시에 찍은 경우) 다음 번호로 바꾼다
  const others = list.filter(o => o.drawingId === p.drawingId && o.id !== p.id);
  if (!ex && others.some(o => +o.no === +p.no)) p.no = others.reduce((m, o) => Math.max(m, +o.no), 0) + 1;
  if (ex) p.no = +ex.no;
  // 사진: 새로 온 사진은 드라이브에 저장, 앱에서 지운 사진은 휴지통으로
  const dname = (rows_('도면').list.find(o => o.id === p.drawingId) || {}).name || p.drawingId;
  const before = ex ? (pinOut_(ex).photos || []) : [];
  p.photos = (p.photos || []).map((x, i) => {
    if (!x.id && photos[x.k]) {
      const blob = Utilities.newBlob(Utilities.base64Decode(photos[x.k]), 'image/jpeg', p.no + '번 핀 ' + (i + 1) + '.jpg');
      x.id = folder_(['사진', dname]).createFile(blob).getId();
    }
    return x;
  }).filter(x => x.id);
  const keep = p.photos.map(x => x.id);
  before.forEach(x => { if (x.id && keep.indexOf(x.id) < 0) { try { DriveApp.getFileById(x.id).setTrashed(true); } catch (e) {} } });
  p.updated = Date.now();
  writeRow_(sh, P_COLS, ex ? ex._row : 0, pinRow_(p));
  return pinOut_(pinRow_(p));
}
function deletePin_(id, by) {
  const { sh, list } = rows_('핀');
  const o = list.find(x => x.id === id); if (!o) return null;
  const p = pinOut_(o);
  (p.photos || []).forEach(x => { try { DriveApp.getFileById(x.id).setTrashed(true); } catch (e) {} });
  p.deleted = true; p.editor = by || p.editor; p.updated = Date.now(); p.photos = [];
  writeRow_(sh, P_COLS, o._row, pinRow_(p));
  return p;
}
function photo_(id) { return Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()); }

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* 배포 전 한 번 실행하면 시트·폴더를 만들고 권한을 승인받는다 */
function setup() { ss_(); folder_([]); Logger.log('시트: ' + ss_().getUrl()); }
