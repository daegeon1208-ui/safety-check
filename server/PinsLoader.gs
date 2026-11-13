/**
 * 도면 하자 핀 공유 서버 — 자동 업데이트용 짧은 코드 (Google Apps Script)
 *
 * 이 코드는 GitHub에 올라간 최신 서버 코드(server/PinsCode.gs)를 읽어서 실행한다.
 * 그래서 서버 코드가 바뀌어도 스크립트를 다시 붙여넣거나 재배포할 필요가 없다.
 *
 * 처음 한 번만:
 *   1) 스크립트 편집기에서 기존 코드를 모두 지우고 이 코드를 붙여넣는다.
 *   2) 아래 PIN을 지금 쓰는 PIN과 똑같이 적고 저장한다.
 *   3) 위쪽 함수 선택에서 setup을 고르고 실행 → 권한 승인(외부 주소 읽기 권한이 새로 추가됨).
 *   4) 배포 > 배포 관리 > 연필 > 버전: 새 버전 > 배포. (웹 앱 URL은 그대로)
 *
 * - GitHub에서 받은 코드는 5분 동안 보관했다가 다시 확인한다(고친 내용은 몇 분 뒤 반영).
 * - GitHub에 잠시 접속이 안 되면 마지막으로 받은 코드로 계속 동작한다.
 * - 저장소 daegeon1208-ui/safety-check 의 main 내용이 그대로 서버에서 실행되므로, 저장소 관리 권한은 꼭 본인만 갖는다.
 */
const PIN = '0000';   // ← 지금 앱에서 쓰는 PIN과 똑같이 적는다.

// 서버 코드를 받을 주소. 앞 주소가 안 되면(구글 서버가 GitHub에 막히는 경우 등) 다음 주소로 받는다
const SRC_URLS = [
  'https://raw.githubusercontent.com/daegeon1208-ui/safety-check/main/server/PinsCode.gs',
  'https://cdn.jsdelivr.net/gh/daegeon1208-ui/safety-check@main/server/PinsCode.gs'
];
const SRC_KEEP = 300;   // 초. 이 시간 동안은 다시 받지 않는다.

function doGet(e) { return server_().doGet(e); }
function doPost(e) { return server_().doPost(e); }
function setup() { return server_().setup(); }

/* 최신 서버 코드 읽기: 캐시(5분) → GitHub → 마지막으로 받은 코드(스크립트 속성) */
let server__ = null;
function server_() {
  if (server__) return server__;
  const code = source_();
  const body = code.replace(/^const PIN\s*=.*$/m, '') +
    '\n;return { doGet: doGet, doPost: doPost, setup: setup };';
  server__ = (new Function('PIN', body))(PIN);
  return server__;
}
function source_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('src');
  if (hit) return hit;
  let code = null; const why = [];
  for (let i = 0; i < SRC_URLS.length && !code; i++) {
    try {
      const res = UrlFetchApp.fetch(SRC_URLS[i] + '?t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
      const st = res.getResponseCode(), txt = res.getContentText('UTF-8');
      if (st === 200 && /function doPost\(/.test(txt)) code = txt;   // 이상한 내용이면 쓰지 않는다
      else why.push((i + 1) + '번 주소: 응답 ' + st);
    } catch (e) { why.push((i + 1) + '번 주소: ' + (e && e.message || e)); }
  }
  if (code) { saveBackup_(code); }
  else { code = loadBackup_(); if (!code) throw new Error('서버 코드를 GitHub에서 받지 못했습니다 (' + why.join(' / ') + ')'); }
  try { cache.put('src', code, SRC_KEEP); } catch (e) {}
  return code;
}
/* 스크립트 속성은 한 칸에 9KB까지라 8000자씩 나눠 저장한다 */
function saveBackup_(code) {
  const props = PropertiesService.getScriptProperties();
  if (loadBackup_() === code) return;
  const n = Math.ceil(code.length / 8000), o = { SRC_N: String(n) };
  for (let i = 0; i < n; i++) o['SRC_' + i] = code.slice(i * 8000, (i + 1) * 8000);
  props.setProperties(o);
}
function loadBackup_() {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty('SRC_N') || 0); if (!n) return null;
  let s = ''; for (let i = 0; i < n; i++) s += props.getProperty('SRC_' + i) || '';
  return s;
}
/* 실행하지 않는 함수. 구글이 필요한 권한(시트·드라이브·외부 주소)을 알아보도록 이름만 적어 둔다 */
function scopes_() {
  SpreadsheetApp.openById(''); SpreadsheetApp.create('');
  DriveApp.getFolderById(''); DriveApp.createFolder(''); DriveApp.getFileById('');
  UrlFetchApp.fetch('');
}
