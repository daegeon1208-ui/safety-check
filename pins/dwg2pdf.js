// DWG(오토캐드 도면) → 그리기 목록 → PDF
// 도면 하자 핀 앱(pins/)과 DWG 견본(dwg-test/)이 함께 쓴다.
// DWG 읽기: LibreDWG 웹 버전 (lib/libredwg, GPL-3.0). 모형 공간(Model)만 그린다.
const LIB = new URL("../lib/libredwg/dist/libredwg-web.js", import.meta.url).href;
const FONT = new URL("../fonts/KoPubDotum-Medium.ttf", import.meta.url).href;
let libP = null;
/** LibreDWG를 한 번만 받아 둔다 */
export function loadLib() {
  if (!libP) libP = import(LIB).then(async m => ({ lib: await m.LibreDwg.create(), T: m.Dwg_File_Type })).catch(e => { libP = null; throw e; });
  return libP;
}
/** DWG 파일 내용 → DwgDatabase */
export async function readDwg(buf) {
  const { lib, T } = await loadLib();
  const dwg = lib.dwg_read_data(buf, T.DWG);
  if (!dwg) throw new Error("DWG 파일을 읽지 못했습니다 (지원하지 않는 버전이거나 손상된 파일)");
  try { return lib.convert(dwg); } finally { try { lib.dwg_free(dwg); } catch (e) {} }
}
export const isDwg = (name, head) => /\.dwg$/i.test(name || "") || (head && head.length >= 4 && String.fromCharCode(head[0], head[1], head[2], head[3]) === "AC10");

/* ---------- ACI 색 (오토캐드 색 번호 → RGB) ---------- */
const ACI = (() => {
  const t = [[0,0,0],[255,0,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[255,0,255],[255,255,255],[128,128,128],[192,192,192]];
  const hsv = (h, s, v) => { const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); }; return [f(5), f(3), f(1)]; };
  const vals = [1, 0.8, 0.6, 0.5, 0.3];
  for (let i = 10; i < 250; i++) { const h = Math.floor((i - 10) / 10) * 15, sub = i % 10; t[i] = hsv(h, sub % 2 ? 0.5 : 1, vals[Math.floor(sub / 2)]); }
  [51, 91, 132, 173, 214, 255].forEach((g, j) => t[250 + j] = [g, g, g]);
  return t;
})();

/* ---------- DWG → 그리기 목록 (선·채움·글자) ---------- */
export function build(db) {
  const layers = new Map(db.tables.LAYER.entries.map(l => [l.name, l]));
  const blocks = new Map(db.tables.BLOCK_RECORD.entries.map(b => [b.name, b]));
  const strokes = new Map(), fills = new Map(), texts = [];
  let nEnt = 0;
  const add = (m, key, pts) => { if (pts.length < 2) return; (m.get(key) || m.set(key, []).get(key)).push(pts); };
  const mul = (A, B) => [A[0]*B[0]+A[2]*B[1], A[1]*B[0]+A[3]*B[1], A[0]*B[2]+A[2]*B[3], A[1]*B[2]+A[3]*B[3], A[0]*B[4]+A[2]*B[5]+A[4], A[1]*B[4]+A[3]*B[5]+A[5]];
  const tp = (M, x, y) => [M[0]*x + M[2]*y + M[4], M[1]*x + M[3]*y + M[5]];
  const rgbKey = c => c.join(",");
  function colorOf(e, lay, blockColor) {
    if (e.color != null && e.colorIndex !== 256 && e.colorIndex !== 0) return [(e.color >> 16) & 255, (e.color >> 8) & 255, e.color & 255];
    let ci = e.colorIndex;
    if (ci == null || ci === 256) { ci = lay ? Math.abs(lay.colorIndex) : 7; if (lay && lay.color != null && lay.color > 0 && (lay.colorIndex == null || lay.colorIndex === 256)) return [(lay.color >> 16) & 255, (lay.color >> 8) & 255, lay.color & 255]; }
    if (ci === 0) return blockColor || [255, 255, 255];
    return ACI[ci] || [255, 255, 255];
  }
  const bulgeArc = (out, M, a, b, bulge) => {   // 폴리선 호 구간
    const th = 4 * Math.atan(bulge), dx = b[0] - a[0], dy = b[1] - a[1], c = Math.hypot(dx, dy);
    if (c < 1e-12) return;
    const r = c / (2 * Math.sin(th / 2)), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, h = r * Math.cos(th / 2);
    const cx = mx - h * dy / c, cy = my + h * dx / c, a0 = Math.atan2(a[1] - cy, a[0] - cx);
    const n = Math.max(4, Math.min(64, Math.ceil(Math.abs(th) / (Math.PI / 24))));
    for (let i = 1; i <= n; i++) { const t = a0 + th * i / n; out.push(tp(M, cx + Math.abs(r) * Math.cos(t) * Math.sign(r) * Math.sign(r), cy + Math.abs(r) * Math.sin(t))); }
  };
  const arcPts = (M, cx, cy, rx, ry, rot, a0, a1) => {
    while (a1 <= a0) a1 += Math.PI * 2;
    const n = Math.max(8, Math.min(128, Math.ceil((a1 - a0) / (Math.PI / 36)))), out = [], cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n, x = rx * Math.cos(t), y = ry * Math.sin(t); out.push(tp(M, cx + x * cr - y * sr, cy + x * sr + y * cr)); }
    return out;
  };
  function polyPts(M, vs, closed) {
    const out = []; if (!vs.length) return out;
    out.push(tp(M, vs[0].x, vs[0].y));
    const n = closed ? vs.length : vs.length - 1;
    for (let i = 0; i < n; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      if (a.bulge) bulgeArc(out, M, [a.x, a.y], [b.x, b.y], a.bulge); else out.push(tp(M, b.x, b.y));
    }
    return out;
  }
  function bspline(cps, deg, knots, ws) {
    const n = cps.length; if (n < 2) return cps.map(p => [p.x, p.y]);
    if (!knots || knots.length !== n + deg + 1) return cps.map(p => [p.x, p.y]);
    const lo = knots[deg], hi = knots[n], out = [], steps = Math.min(400, n * 12);
    for (let s = 0; s <= steps; s++) {
      const u = Math.min(hi - 1e-10, lo + (hi - lo) * s / steps);
      let k = deg; while (k < n - 1 && knots[k + 1] <= u) k++;
      const d = []; for (let j = 0; j <= deg; j++) { const p = cps[k - deg + j], w = ws && ws.length ? ws[k - deg + j] : 1; d.push([p.x * w, p.y * w, w]); }
      for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
        const i = k - deg + j, den = knots[i + deg - r + 1] - knots[i], al = den ? (u - knots[i]) / den : 0;
        d[j] = [0, 1, 2].map(q => (1 - al) * d[j - 1][q] + al * d[j][q]);
      }
      out.push([d[deg][0] / d[deg][2], d[deg][1] / d[deg][2]]);
    }
    return out;
  }
  const stripM = s => String(s || "")
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\P/g, "\n").replace(/\\[LOlo]/g, "").replace(/\\[Ff][^;]*;/g, "")
    .replace(/\\[HhWwTtAaCcQq][^;]*;/g, "").replace(/\\S([^;]*)[\^#\/]([^;]*);/g, "$1/$2").replace(/\\p[^;]*;/g, "")
    .replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±").replace(/%%[cC]/g, "Ø").replace(/%%%/g, "%")
    .replace(/\\~/g, " ").replace(/\\\\/g, "\\").replace(/[{}]/g, "");
  const stripT = s => String(s || "").replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±").replace(/%%[cC]/g, "Ø").replace(/%%[uUoO]/g, "").replace(/%%%/g, "%");
  function addText(M, str, x, y, h, rot, ha, va, color, wf) {
    if (!str || !(h > 0)) return;
    const [px, py] = tp(M, x, y), [qx, qy] = tp(M, x + Math.cos(rot), y + Math.sin(rot));
    const sc = Math.hypot(qx - px, qy - py);
    texts.push({ s: str, x: px, y: py, h: h * sc, r: Math.atan2(qy - py, qx - px), ha, va, c: color, wf: wf || 1 });
  }
  function textEnt(M, t, color) {
    const al = (t.halign || 0) !== 0 || (t.valign || 0) !== 0;
    const p = al && t.endPoint ? t.endPoint : t.startPoint;
    const ha = [0, 0.5, 1, 0, 0.5, 0][t.halign || 0] ?? 0, va = [0, 0, 0.5, 1][t.valign || 0] ?? 0;
    if (t.halign === 4) { addText(M, stripT(t.text), p.x, p.y, t.textHeight, t.rotation || 0, 0.5, 0.5, color, t.xScale); return; }
    addText(M, stripT(t.text), p.x, p.y, t.textHeight, t.rotation || 0, ha, va, color, t.xScale);
  }
  function walk(ents, M, blockColor, parentLayer, depth) {
    if (depth > 12) return;
    for (const e of ents || []) {
      if (e.isVisible === false || e.isInPaperSpace) continue;
      const lname = e.layer === "0" && parentLayer ? parentLayer : e.layer, lay = layers.get(lname);
      if (lay && (lay.off || lay.frozen || lay.colorIndex < 0)) continue;
      const col = colorOf(e, lay, blockColor), key = rgbKey(col);
      nEnt++;
      try { switch (e.type) {
        case "LINE": add(strokes, key, [tp(M, e.startPoint.x, e.startPoint.y), tp(M, e.endPoint.x, e.endPoint.y)]); break;
        case "LWPOLYLINE": add(strokes, key, polyPts(M, e.vertices || [], !!(e.flag & 512) || !!(e.flag & 1))); break;
        case "POLYLINE2D": case "POLYLINE3D": {
          let vs = (e.vertices || []).filter(v => !(v.flag & 16));
          add(strokes, key, polyPts(M, e.type === "POLYLINE3D" ? vs.map(v => ({ x: v.x, y: v.y })) : vs, !!(e.flag & 1))); break; }
        case "ARC": add(strokes, key, arcPts(M, e.center.x, e.center.y, e.radius, e.radius, 0, e.startAngle, e.endAngle)); break;
        case "CIRCLE": add(strokes, key, arcPts(M, e.center.x, e.center.y, e.radius, e.radius, 0, 0, Math.PI * 2)); break;
        case "ELLIPSE": { const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y, rx = Math.hypot(mx, my);
          let a0 = e.startAngle, a1 = e.endAngle; if (Math.abs(a1 - a0) < 1e-9) { a0 = 0; a1 = Math.PI * 2; }
          add(strokes, key, arcPts(M, e.center.x, e.center.y, rx, rx * e.axisRatio, Math.atan2(my, mx), a0, a1)); break; }
        case "SPLINE": { const pts = e.controlPoints && e.controlPoints.length ? bspline(e.controlPoints, e.degree, e.knots, e.weights) : (e.fitPoints || []).map(p => [p.x, p.y]);
          add(strokes, key, pts.map(p => tp(M, p[0], p[1]))); break; }
        case "LEADER": add(strokes, key, (e.vertices || []).map(p => tp(M, p.x, p.y))); break;
        case "3DFACE": { const c = [e.corner1, e.corner2, e.corner3, e.corner4 || e.corner3].filter(Boolean).map(p => tp(M, p.x, p.y)); c.push(c[0]); add(strokes, key, c); break; }
        case "SOLID": case "TRACE": { const c = [e.corner1, e.corner2, e.corner4 || e.corner3, e.corner3].map(p => tp(M, p.x, p.y)); add(fills, key, c); break; }
        case "HATCH": {
          if (e.solidFill !== 1) break;   // 무늬 해치는 생략(견본)
          for (const bp of e.boundaryPaths || []) {
            let pts = [];
            if (bp.vertices) pts = polyPts(M, bp.vertices, true);
            else for (const ed of bp.edges || []) {
              if (ed.type === 1) { pts.push(tp(M, ed.start.x, ed.start.y), tp(M, ed.end.x, ed.end.y)); }
              else if (ed.type === 2) { let a0 = ed.startAngle, a1 = ed.endAngle; const p = arcPts(M, ed.center.x, ed.center.y, ed.radius, ed.radius, 0, ed.isCCW === false ? -a1 : a0, ed.isCCW === false ? -a0 : a1); pts.push(...(ed.isCCW === false ? p.reverse() : p)); }
            }
            if (pts.length > 2) add(fills, key, pts);
          }
          break; }
        case "TEXT": textEnt(M, e, col); break;
        case "MTEXT": {
          const lines = stripM(e.text).split("\n"), ap = (e.attachmentPoint || 1) - 1;
          const ha = [0, 0.5, 1][ap % 3], vrow = Math.floor(ap / 3), h = e.textHeight, ls = h * 1.66 * (e.lineSpacing || 1);
          const rot = e.direction && (e.direction.x || e.direction.y) ? Math.atan2(e.direction.y, e.direction.x) : (e.rotation || 0);
          const total = (lines.length - 1) * ls, top = vrow === 0 ? 0 : vrow === 1 ? total / 2 : total;
          lines.forEach((ln, i) => { const dy = -(i * ls) + top, x = e.insertionPoint.x - Math.sin(rot) * dy, y = e.insertionPoint.y + Math.cos(rot) * dy;
            addText(M, ln, x, y, h, rot, ha, vrow === 0 ? 1 : vrow === 1 ? 0.5 : 0, col); });
          break; }
        case "INSERT": {
          const b = blocks.get(e.name); if (!b) break;
          const bp = b.basePoint || { x: 0, y: 0 }, cr = Math.cos(e.rotation || 0), sr = Math.sin(e.rotation || 0);
          const xs = (e.xScale || 1) * (e.extrusionDirection && e.extrusionDirection.z < 0 ? -1 : 1), ys = e.yScale || 1;
          const cols = Math.max(1, e.columnCount || 1), rows = Math.max(1, e.rowCount || 1);
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const ox = c * (e.columnSpacing || 0), oy = r * (e.rowSpacing || 0);
            let ix = e.insertionPoint.x, iy = e.insertionPoint.y;
            if (e.extrusionDirection && e.extrusionDirection.z < 0) ix = -ix;
            const L = [cr * xs, sr * xs, -sr * ys, cr * ys, ix + cr * ox - sr * oy, iy + sr * ox + cr * oy];
            walk(b.entities, mul(M, mul(L, [1, 0, 0, 1, -bp.x, -bp.y])), col, lname, depth + 1);
          }
          for (const a of e.attribs || []) if (a.text && !(a.flags & 1)) textEnt(M, a.text, colorOf(a, layers.get(a.layer), col));
          break; }
        case "DIMENSION": { const b = blocks.get(e.name); if (b) walk(b.entities, M, col, lname, depth + 1); break; }
      } } catch (err) { /* 읽지 못한 개체는 건너뜀 */ }
    }
  }
  const ms = db.tables.BLOCK_RECORD.entries.find(b => /^\*model_space$/i.test(b.name));
  walk(ms && ms.entities && ms.entities.length ? ms.entities : db.entities, [1, 0, 0, 1, 0, 0], null, null, 0);
  // 범위: 멀리 떨어진 몇 개 때문에 도면이 작아지지 않게, 가운데 98% 범위의 두 배 안쪽만 센다
  const cx = [], cy = [];
  const each = f => { for (const m of [strokes, fills]) for (const arr of m.values()) for (const p of arr) for (const q of p) f(q[0], q[1]);
    for (const t of texts) { f(t.x, t.y); f(t.x + Math.cos(t.r) * t.h * t.s.length * 0.8, t.y + Math.sin(t.r) * t.h * t.s.length * 0.8); } };
  each((x, y) => { if (isFinite(x) && isFinite(y)) { cx.push(x); cy.push(y); } });
  if (!cx.length) return null;
  cx.sort((a, b) => a - b); cy.sort((a, b) => a - b);
  const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * f)))];
  const x0 = q(cx, .01), x1 = q(cx, .99), y0 = q(cy, .01), y1 = q(cy, .99);
  const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6), R = Math.max(w, h);
  let bx0 = 1e300, bx1 = -1e300, by0 = 1e300, by1 = -1e300;
  each((x, y) => { if (x > x0 - R && x < x1 + R && y > y0 - R && y < y1 + R) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; } });
  if (bx1 - bx0 < 1e-9) { bx0 -= 1; bx1 += 1; } if (by1 - by0 < 1e-9) { by0 -= 1; by1 += 1; }
  let nSeg = 0; for (const arr of strokes.values()) for (const p of arr) nSeg += p.length - 1;
  return { strokes, fills, texts, x0: bx0, y0: by0, w: bx1 - bx0, h: by1 - by0, nEnt, nSeg };
}


/** 흰 바탕에서 안 보이는 밝은 색은 어둡게 */
export function shadeRgb(c) {
  const L = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  if (L > 0.92) return [20, 20, 20];
  if (L > 0.42) { const f = 0.42 / L; return c.map(v => Math.round(v * f)); }   // 노랑·하늘색 같은 밝은 색은 진하게
  return c;
}

/**
 * DWG → PDF (한 쪽, 선·글자 모두 벡터). PDFLib·fontkit 전역이 먼저 있어야 한다.
 * @returns {Promise<{bytes:Uint8Array, info:{nEnt:number,nSeg:number,nText:number}}>}
 */
export async function dwgToPdf(buf, progress) {
  progress && progress("DWG 읽는 프로그램 준비 중… (처음 한 번 약 6MB)");
  await loadLib();
  progress && progress("DWG 읽는 중…");
  await new Promise(r => setTimeout(r, 30));
  const db = await readDwg(buf);
  progress && progress("도면 그리는 중…");
  await new Promise(r => setTimeout(r, 30));
  const D = build(db);
  if (!D) throw new Error("DWG의 모형 공간(Model)에 그릴 내용이 없습니다");
  const { PDFDocument, rgb, degrees } = PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontBytes = await fetch(FONT).then(r => { if (!r.ok) throw new Error("글꼴을 받지 못했습니다"); return r.arrayBuffer(); });
  const font = await doc.embedFont(fontBytes, { subset: true });
  // 긴 변을 A1(841mm) 크기로
  const LONG = 2384, M = 24, s = (LONG - 2 * M) / Math.max(D.w, D.h);
  const PW = D.w * s + 2 * M, PH = D.h * s + 2 * M;
  const page = doc.addPage([PW, PH]);
  const X = x => (x - D.x0) * s + M, Yd = y => PH - ((y - D.y0) * s + M);   // drawSvgPath는 위가 0인 좌표
  const col = c => { const [r, g, b] = shadeRgb(c); return rgb(r / 255, g / 255, b / 255); };
  const f2 = v => (Math.round(v * 100) / 100).toString();
  const inPage = (x, y) => x > -PW && x < 2 * PW && y > -PH && y < 2 * PH;
  for (const [key, arr] of D.fills) {
    const c = col(key.split(",").map(Number));
    let d = "", n = 0;
    const flush = () => { if (d) page.drawSvgPath(d, { x: 0, y: PH, color: c, borderWidth: 0 }); d = ""; n = 0; };
    for (const p of arr) { const pts = p.map(q => [X(q[0]), Yd(q[1])]); if (!pts.every(q => inPage(q[0], q[1]))) continue;
      d += "M" + pts.map(q => f2(q[0]) + " " + f2(q[1])).join("L") + "Z"; if (++n > 400) flush(); }
    flush();
  }
  for (const [key, arr] of D.strokes) {
    const c = col(key.split(",").map(Number));
    let d = "", n = 0;
    const flush = () => { if (d) page.drawSvgPath(d, { x: 0, y: PH, borderColor: c, borderWidth: 0.12, borderLineCap: 1 }); d = ""; n = 0; };
    for (const p of arr) {
      let seg = "", prev = null;
      for (const q of p) { const x = X(q[0]), y = Yd(q[1]); if (!inPage(x, y)) { prev = null; continue; }
        seg += (prev ? "L" : "M") + f2(x) + " " + f2(y); prev = 1; n++; }
      d += seg; if (n > 6000) flush();
    }
    flush();
  }
  let nText = 0;
  for (const t of D.texts) {
    const sh = t.h * s; if (!(sh >= 0.25)) continue;
    const x = X(t.x), y = PH - Yd(t.y); if (x < -PW || x > 2 * PW || y < -PH || y > 2 * PH) continue;
    const size = sh / 0.72;
    let str = t.s.replace(/[\u2014]/g, "-");
    let tw; try { tw = font.widthOfTextAtSize(str, size) * (t.wf || 1); } catch (e) { continue; }
    const ox = -tw * t.ha, oy = -sh * t.va, cr = Math.cos(t.r), sr = Math.sin(t.r);
    try { page.drawText(str, { x: x + cr * ox - sr * oy, y: y + sr * ox + cr * oy, size, font, color: col(t.c), rotate: degrees(t.r * 180 / Math.PI) }); nText++; } catch (e) {}
  }
  const bytes = await doc.save();
  return { bytes, info: { nEnt: D.nEnt, nSeg: D.nSeg, nText } };
}
