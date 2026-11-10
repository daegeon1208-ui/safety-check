/* 일일안전보건점검표 → 원본 엑셀 양식(A3 가로 2쪽) PDF
   layout.json: 엑셀에서 뽑은 칸 위치(pt), 테두리, 글꼴, 정렬, 고정 문구
   values: [{주소:문자열}, {주소:문자열}]  photos: [{주소:jpeg 바이트}, {...}] (시트별) */
(function (root) {
  function hex(c, rgb) { const n = parseInt(c.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); }

  function wrapLines(text, font, size, maxW, wrap) {
    const out = [];
    String(text).split(/\r?\n/).forEach(par => {
      if (!wrap || font.widthOfTextAtSize(par, size) <= maxW) { out.push(par); return; }
      // 단어 단위로 끊고, 한 단어가 너무 길면 글자 단위로 끊는다 (엑셀과 같은 방식)
      const tokens = par.match(/\S+\s*|\s+/g) || [""];
      let line = "";
      for (const tk of tokens) {
        const t = line + tk;
        if (font.widthOfTextAtSize(t.replace(/\s+$/, ""), size) <= maxW) { line = t; continue; }
        if (line.trim()) { out.push(line.replace(/\s+$/, "")); line = ""; }
        let w = tk;
        while (font.widthOfTextAtSize(w.replace(/\s+$/, ""), size) > maxW && w.length > 1) {
          let k = w.length;
          while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > maxW) k--;
          out.push(w.slice(0, k)); w = w.slice(k);
        }
        line = w;
      }
      out.push(line.replace(/\s+$/, ""));
    });
    return out;
  }

  async function buildPdf(PDFLib, fontkit, fontBytes, layout, values, photos) {
    const { PDFDocument, rgb, LineCapStyle } = PDFLib;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const fonts = {
      B: await doc.embedFont(fontBytes.B, { subset: true }),
      M: await doc.embedFont(fontBytes.M, { subset: true })
    };
    doc.setTitle("일일안전보건점검표");
    for (let si = 0; si < layout.length; si++) {
      const S = layout[si], vals = (values && values[si]) || {}, pics = (photos && photos[si]) || {};
      const [PW, PH] = S.page;
      const page = doc.addPage([PW, PH]);
      const aw = PW - S.margin.l - S.margin.r, ah = PH - S.margin.t - S.margin.b;
      // 엑셀 "한 페이지에 맞춤": 너비(그리고 지정 시 높이)에 맞춰 축소, 가운데 정렬
      let k = aw / S.W; if (S.fitHeight) k = Math.min(k, ah / S.H);
      const ox = S.margin.l + (S.hc ? (aw - S.W * k) / 2 : 0);
      const oyTop = S.margin.t + (S.vc ? (ah - S.H * k) / 2 : 0);
      const X = x => ox + x * k, Y = y => PH - (oyTop + y * k);

      // 1) 칸 배경
      for (const c of S.cells) if (c.fill && c.fill.toUpperCase() !== "#FFFFFF")
        page.drawRectangle({ x: X(c.x), y: Y(c.y + c.h), width: c.w * k, height: c.h * k, color: hex(c.fill, rgb) });

      // 2) 사진
      for (const c of S.cells) {
        const bytes = pics[c.a]; if (!bytes) continue;
        let img; try { img = await doc.embedJpg(bytes); } catch (e) { try { img = await doc.embedPng(bytes); } catch (e2) { continue; } }
        // 칸에 꽉 차게 늘려 넣는다 (비율 무시, 테두리만 남김)
        const pad = 0.75, bw = c.w * k - pad * 2, bh = c.h * k - pad * 2;
        page.drawImage(img, { x: X(c.x) + pad, y: Y(c.y + c.h) + pad, width: bw, height: bh });
      }

      // 3) 테두리
      for (const [x1, y1, x2, y2, w] of S.edges)
        page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: w * k, color: rgb(0, 0, 0), lineCap: LineCapStyle ? LineCapStyle.Projecting : undefined });

      // 4) 글자
      for (const c of S.cells) {
        const t = (c.a in vals) ? vals[c.a] : c.t;
        if (t == null || t === "") continue;
        const font = fonts[c.font] || fonts.M;
        const typed = (c.a in vals);  // 앱에서 입력한 값: 칸 안에 들어가도록 줄바꿈하고 넘치면 글자를 줄인다
        const padX = 2.25 * k, maxW = c.w * k - padX * 2;
        let size = ((vals.__sz && vals.__sz[c.a]) || c.sz) * k, lines, lh;
        for (;;) {
          lines = wrapLines(t, font, size, maxW, c.wrap || typed);
          lh = font.heightAtSize(size);
          if (!typed || lh * lines.length <= c.h * k - 2 * k || size <= 5 * k) break;
          size -= 0.5 * k;
        }
        const asc = font.heightAtSize(size, { descender: false });
        const blockH = lh * lines.length;
        let top;
        const cy = Y(c.y), ch = c.h * k;
        if (c.va === "top") top = cy - 1.5 * k;
        else if (c.va === "bottom") top = cy - ch + blockH + 1.5 * k;
        else top = cy - (ch - blockH) / 2;
        const color = c.color ? hex(c.color, rgb) : rgb(0, 0, 0);
        lines.forEach((ln, i) => {
          const w = font.widthOfTextAtSize(ln, size);
          let x;
          const ha = c.ha === "general" ? (typed ? "center" : "left") : c.ha;
          if (ha === "center" || ha === "centerContinuous") x = X(c.x) + (c.w * k - w) / 2;
          else if (ha === "right") x = X(c.x) + c.w * k - padX - w;
          else x = X(c.x) + padX;
          const base = top - i * lh - asc;
          page.drawText(ln, { x, y: base, size, font, color });
          // 엑셀은 '굵게'가 켜진 칸을 한 번 더 굵게 찍는다 (KoPub돋움체 Bold + 굵게)
          if (c.b) page.drawText(ln, { x: x + size * 0.03, y: base, size, font, color });
          if (c.u) page.drawLine({ start: { x, y: base - size * 0.12 }, end: { x: x + w, y: base - size * 0.12 }, thickness: Math.max(0.4, size * 0.05), color });
        });
      }
    }
    return await doc.save();
  }
  root.SafetyPrint = { buildPdf, wrapLines };
  if (typeof module !== "undefined") module.exports = root.SafetyPrint;
})(typeof window !== "undefined" ? window : globalThis);

/* 앱 기록 → 엑셀 칸 주소 */
(function (root) {
  // [사진 칸, 개선대책 칸(중점관리사항 옆), 내용 칸]
  // 사진대지 칸 (왼쪽 위부터 차례로): [사진, 중점관리사항 라벨, 개선대책, 내용 라벨, 의견]
  const PHOTO_SLOTS = [
    ["A5", "A11", "C11", "A13", "C13"], ["F5", "F11", "H11", "F13", "H13"], ["K5", "K11", "M11", "K13", "M13"], ["P5", "P11", "R11", "P13", "R13"],
    ["A15", "A21", "C21", "A23", "C23"], ["F15", "F21", "H21", "F23", "H23"], ["K15", "K21", "M21", "K23", "M23"], ["P15", "P21", "R21", "P23", "R23"]];
  // 추가위험발굴: [사진, 라벨, 내용]
  const EXTRA_SLOTS = [["A26", "A32", "C32"], ["H26", "H32", "J32"], ["O26", "O32", "Q32"]];
  function dataUrlBytes(u) {
    const b = atob(u.split(",")[1]); const a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a;
  }
  function mapRecord(tpl, rec, pad2) {
    const p = n => String(n).padStart(2, "0");
    const last = new Date(tpl.year, tpl.month, 0).getDate();
    const v1 = {
      A2: `1개월간 위험성평가 일일안전보건 점검표\n(${tpl.year}년 ${tpl.month}월)`,
      C5: tpl.site, C6: rec.date.replace(/-/g, "."), K6: tpl.partner, O6: rec.inspector || "",
      C7: `${tpl.year}.${p(tpl.month)}.01 ~ ${tpl.year}.${p(tpl.month)}.${p(last)}`
    };
    const v2 = { __sz: {} }, ph = {};
    // 사진 있는 항목만 빈칸 없이 앞에서부터 채운다 → 빈 칸은 라벨도 비운다
    PHOTO_SLOTS.forEach(sl => { v2[sl[1]] = ""; v2[sl[2]] = ""; v2[sl[3]] = ""; v2[sl[4]] = ""; });
    EXTRA_SLOTS.forEach(sl => { v2[sl[1]] = ""; v2[sl[2]] = ""; });
    let pi = 0, xi = 0;
    tpl.items.forEach((it, i) => {
      const r = 10 + i * 2;
      Object.assign(v1, { ["A" + r]: it.work, ["B" + r]: it.sub, ["C" + r]: it.loc, ["D" + r]: it.risk, ["N" + r]: it.when, ["O" + r]: it.owner });
      it.measures.forEach((m, j) => {
        const rr = r + j, key = `${i + 1}-${j + 1}`, res = (rec.results && rec.results[key]) || {};
        v1["I" + rr] = m;
        // 결과를 안 누른 항목: 완료 칸 "-", 의견 "금일 해당작업 없음" / 의견은 앞에 " - "를 붙인다
        v1["P" + rr] = res.r === "완료" ? "O" : (res.r ? "" : "-"); v1["Q" + rr] = res.r === "불량" ? "O" : "";
        const note = (res.note || "").trim() || (res.r ? "" : "금일 해당작업 없음");
        v1["R" + rr] = note ? (/^-/.test(note) ? " " + note : " - " + note) : "";
        const slot = res.photo ? PHOTO_SLOTS[pi++] : null;
        if (slot && res.photo) {
          ph[slot[0]] = res.photo;
          v2[slot[1]] = "중점관리사항 " + key; v2[slot[3]] = "내   용";
          // 중점관리사항 옆: 개선대책(번호 없이), 내용: 점검 의견
          v2[slot[2]] = String(m).replace(/^\s*\d+\s*[.)]\s*/, "").replace(/\s*\n\s*/g, " ").trim();
          v2[slot[4]] = note;
          v2.__sz[slot[2]] = 11; v2.__sz[slot[4]] = 11;
        }
      });
    });
    (rec.extra || []).forEach((x, i) => {
      const r = 10 + tpl.items.length * 2 + 3 + i;   // 추가위험발굴 행: 중점관리 항목 수에 따라 달라짐 (11월 19행, 10월 27행)
      if (i < 2) Object.assign(v1, { ["A" + r]: x.sub, ["C" + r]: x.loc, ["D" + r]: x.risk, ["I" + r]: x.action, ["N" + r]: x.fix, ["O" + r]: x.fb, ["P" + r]: x.reflect, ["W" + r]: x.partner });
      const s = x.photo ? EXTRA_SLOTS[xi++] : null;
      if (s) { ph[s[0]] = x.photo; v2[s[1]] = (i + 1) + ". 추가위험발굴"; v2[s[2]] = x.caption || ""; }
    });
    const photos2 = {};
    for (const a in ph) photos2[a] = typeof ph[a] === "string" ? dataUrlBytes(ph[a]) : ph[a];
    return { values: [v1, v2], photos: [{}, photos2] };
  }
  root.SafetyPrint.mapRecord = mapRecord;
})(typeof window !== "undefined" ? window : globalThis);
