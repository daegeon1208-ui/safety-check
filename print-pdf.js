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
        const pad = 3, bw = c.w * k - pad * 2, bh = c.h * k - pad * 2;
        const s = Math.min(bw / img.width, bh / img.height);
        const w = img.width * s, h = img.height * s;
        page.drawImage(img, { x: X(c.x) + pad + (bw - w) / 2, y: Y(c.y + c.h) + pad + (bh - h) / 2, width: w, height: h });
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
        let size = c.sz * k, lines, lh;
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
  const PHOTO_SLOTS = { "1-1": ["A5", "C13"], "1-2": ["F5", "H13"], "2-1": ["K5", "M13"], "2-2": ["P5", "R13"], "3-1": ["A15", "C23"], "3-2": ["F15", "H23"] };
  const EXTRA_SLOTS = [["A26", "C32"], ["H26", "J32"], ["O26", "Q32"]];
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
    const v2 = { A21: "중점관리사항 3-1", F21: "중점관리사항 3-2", A23: "내   용", F23: "내   용" }, ph = {};
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
        const slot = PHOTO_SLOTS[key];
        if (slot) { if (res.photo) ph[slot[0]] = res.photo; v2[slot[1]] = res.caption || ""; }
      });
    });
    (rec.extra || []).forEach((x, i) => {
      const r = 19 + i;
      if (r <= 20) Object.assign(v1, { ["A" + r]: x.sub, ["C" + r]: x.loc, ["D" + r]: x.risk, ["I" + r]: x.action, ["N" + r]: x.fix, ["O" + r]: x.fb, ["P" + r]: x.reflect, ["W" + r]: x.partner });
      const s = EXTRA_SLOTS[i]; if (s) { if (x.photo) ph[s[0]] = x.photo; v2[s[1]] = x.caption || ""; }
    });
    const photos2 = {};
    for (const a in ph) photos2[a] = typeof ph[a] === "string" ? dataUrlBytes(ph[a]) : ph[a];
    return { values: [v1, v2], photos: [{}, photos2] };
  }
  root.SafetyPrint.mapRecord = mapRecord;
})(typeof window !== "undefined" ? window : globalThis);
