/**
 * 일일안전보건점검표 앱 저장 서버 (Google Apps Script)
 * - 점검 기록: 구글 시트 「일일안전보건점검 기록」 (날짜별 1행)
 * - 사진: 구글 드라이브 「일일안전보건점검 사진/YYYY-MM/YYMMDD」 폴더
 *
 * 설치: script.google.com → 새 프로젝트 → 이 코드 붙여넣기 → 맨 아래 PIN 바꾸기
 *      → 배포 > 새 배포 > 유형: 웹 앱, 실행: 나, 액세스: 모든 사용자 → 배포 → 웹 앱 URL 복사
 */
const PIN = '1234';   // ← 앱에서 입력할 비밀번호. 꼭 바꿔 주세요.

const SHEET_NAME = '일일안전보건점검 기록';
const FOLDER_NAME = '일일안전보건점검 사진';

function doGet() {
  return out_({ ok: true, app: 'daily-safety-check', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (String(req.pin) !== String(PIN)) return out_({ ok: false, error: 'PIN이 맞지 않습니다' });
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      switch (req.action) {
        case 'ping': return out_({ ok: true });
        case 'get': return out_({ ok: true, record: getRecord_(req.date, req.withPhotos !== false) });
        case 'save': return out_(Object.assign({ ok: true }, saveRecord_(req.date, req.record, req.status)));
        case 'summary': return out_({ ok: true, summary: summary_(req.ym) });
        case 'getTpl': return out_({ ok: true, tpl: getKV_('tpl:' + req.ym) });
        case 'saveTpl': setKV_('tpl:' + req.ym, req.tpl); return out_({ ok: true });
        default: return out_({ ok: false, error: '알 수 없는 요청' });
      }
    } finally { lock.releaseLock(); }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- 저장소 ---------- */
function ss_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SS_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    const r = ss.getSheets()[0]; r.setName('기록');
    r.getRange(1, 1, 1, 8).setValues([['점검일', '수정시각', '점검자', '점검(완료/전체)', '불량', '사진 수', '상태', '데이터(JSON)']]);
    r.setFrozenRows(1); r.getRange('A:A').setNumberFormat('@');
    ss.insertSheet('설정').getRange(1, 1, 1, 2).setValues([['키', '값(JSON)']]);
    props.setProperty('SS_ID', ss.getId());
  }
  return ss;
}
function folder_(parts) {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('ROOT_ID'), root = null;
  if (id) { try { root = DriveApp.getFolderById(id); } catch (e) { root = null; } }
  if (!root) { root = DriveApp.createFolder(FOLDER_NAME); props.setProperty('ROOT_ID', root.getId()); }
  let f = root;
  parts.forEach(p => { const it = f.getFoldersByName(p); f = it.hasNext() ? it.next() : f.createFolder(p); });
  return f;
}
function findRow_(sh, date) {
  const n = sh.getLastRow(); if (n < 2) return 0;
  const v = sh.getRange(2, 1, n - 1, 1).getDisplayValues();
  for (let i = 0; i < v.length; i++) if (v[i][0] === date) return i + 2;
  return 0;
}
function getKV_(key) {
  const sh = ss_().getSheetByName('설정'), n = sh.getLastRow(); if (n < 2) return null;
  const v = sh.getRange(2, 1, n - 1, 2).getValues();
  for (let i = 0; i < v.length; i++) if (v[i][0] === key) return JSON.parse(v[i][1]);
  return null;
}
function setKV_(key, val) {
  const sh = ss_().getSheetByName('설정'), n = sh.getLastRow();
  if (n >= 2) { const v = sh.getRange(2, 1, n - 1, 1).getValues();
    for (let i = 0; i < v.length; i++) if (v[i][0] === key) { sh.getRange(i + 2, 2).setValue(JSON.stringify(val)); return; } }
  sh.appendRow([key, JSON.stringify(val)]);
}

/* ---------- 사진 ---------- */
function photoSlots_(rec) {   // [{obj, label}]
  const list = [];
  Object.keys(rec.results || {}).forEach(k => list.push({ o: rec.results[k], label: '중점관리사항 ' + k }));
  (rec.extra || []).forEach((x, i) => list.push({ o: x, label: (i + 1) + '. 추가위험발굴' }));
  return list;
}
function storePhotos_(date, rec) {
  const ids = {};
  photoSlots_(rec).forEach(s => {
    const p = s.o.photo;
    if (typeof p === 'string' && p.indexOf('data:') === 0) {
      if (s.o.photoId) { try { DriveApp.getFileById(s.o.photoId).setTrashed(true); } catch (e) {} }
      const m = p.match(/^data:([^;]+);base64,(.*)$/);
      const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], date.replace(/-/g, '').slice(2) + ' ' + s.label + '.jpg');
      const f = folder_([date.slice(0, 7), date.replace(/-/g, '').slice(2)]).createFile(blob);
      s.o.photoId = f.getId();
    } else if (!p && s.o.photoId) {
      try { DriveApp.getFileById(s.o.photoId).setTrashed(true); } catch (e) {}   // 앱에서 지운 사진은 휴지통으로
      s.o.photoId = null;
    }
    s.o.photo = null;   // 시트에는 사진 데이터를 넣지 않고 드라이브 파일 ID만 둔다
    ids[s.label] = s.o.photoId || null;
  });
  return ids;
}

/* ---------- 기록 ---------- */
function saveRecord_(date, rec, status) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜 형식 오류');
  const sh = ss_().getSheetByName('기록');
  storePhotos_(date, rec);
  const res = rec.results || {}, keys = Object.keys(res);
  const done = keys.filter(k => res[k].r).length, bad = keys.filter(k => res[k].r === '불량').length;
  const photos = photoSlots_(rec).filter(s => s.o.photoId).length;
  const row = [date, new Date(), rec.inspector || '', done + '/' + keys.length, bad, photos, status || '', JSON.stringify(rec)];
  let r = findRow_(sh, date);
  if (!r) { r = sh.getLastRow() + 1; sh.getRange(r, 1).setNumberFormat('@'); }
  sh.getRange(r, 1, 1, row.length).setValues([row]);
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, row.length).sort(1);
  const ids = {};
  keys.forEach(k => ids['m:' + k] = res[k].photoId || null);
  (rec.extra || []).forEach((x, i) => ids['x:' + i] = x.photoId || null);
  return { photoIds: ids };
}
function getRecord_(date, withPhotos) {
  const sh = ss_().getSheetByName('기록'), r = findRow_(sh, date);
  if (!r) return null;
  const rec = JSON.parse(sh.getRange(r, 8).getValue());
  if (withPhotos) photoSlots_(rec).forEach(s => {
    if (!s.o.photoId) return;
    try { const b = DriveApp.getFileById(s.o.photoId).getBlob();
      s.o.photo = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()); } catch (e) { s.o.photo = null; }
  });
  return rec;
}
function summary_(ym) {
  const sh = ss_().getSheetByName('기록'), n = sh.getLastRow(), out = {};
  if (n < 2) return out;
  sh.getRange(2, 1, n - 1, 7).getDisplayValues().forEach(v => {
    if (v[0].indexOf(ym) === 0 && v[6]) out[v[0]] = v[6];
  });
  return out;
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* 배포 전 한 번 실행하면 시트·폴더를 만들고 권한을 승인받는다 */
function setup() { ss_(); folder_([]); Logger.log('시트: ' + ss_().getUrl()); }
