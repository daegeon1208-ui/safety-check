/* 일일안전보건점검표 → 원본 엑셀 양식(xlsx)에 기록과 사진을 채워 넣는다
   - 양식 templates/tpl-YYYY-MM.xlsx 의 칸 서식·병합·인쇄 설정은 그대로 두고 글자만 바꾼다
   - values/photos 는 print-pdf.js 의 mapRecord 결과를 그대로 쓴다 (PDF와 같은 내용)
   - 사진은 사진 칸(병합 범위)에 꽉 차게 늘려 넣는다 */
(function (root) {
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PNS = "http://schemas.openxmlformats.org/package/2006/relationships";
  const EMU_PX = 9525;

  const colNum = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const splitAddr = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { c: colNum(m[1]), r: +m[2] }; };
  const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // 엑셀이 받지 않는 제어문자 제거
  const clean = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  function parse(str) { return new DOMParser().parseFromString(str, "application/xml"); }
  function ser(doc) { return new XMLSerializer().serializeToString(doc); }
  function relsTarget(relsDoc, id) {
    for (const r of relsDoc.getElementsByTagNameNS(PNS, "Relationship")) if (r.getAttribute("Id") === id) return r.getAttribute("Target");
    return null;
  }

  /* 글자 크기만 다른 서식 복제 (사진대지 개선대책 칸은 양식이 6pt라 11pt로 키운다) */
  function makeStyler(stylesDoc) {
    const fonts = stylesDoc.getElementsByTagNameNS(NS, "fonts")[0];
    const xfs = stylesDoc.getElementsByTagNameNS(NS, "cellXfs")[0];
    const cache = {};
    const kids = (el, name) => Array.from(el.childNodes).filter(n => n.nodeType === 1 && n.localName === name);
    return function (s, sz) {
      const key = s + "|" + sz; if (cache[key] != null) return cache[key];
      const xf = kids(xfs, "xf")[+s || 0];
      const font = kids(fonts, "font")[+xf.getAttribute("fontId") || 0].cloneNode(true);
      let szEl = kids(font, "sz")[0];
      if (!szEl) { szEl = stylesDoc.createElementNS(NS, "sz"); font.insertBefore(szEl, font.firstChild); }
      szEl.setAttribute("val", String(sz));
      fonts.appendChild(font); fonts.setAttribute("count", kids(fonts, "font").length);
      const nx = xf.cloneNode(true);
      nx.setAttribute("fontId", kids(fonts, "font").length - 1); nx.setAttribute("applyFont", "1");
      xfs.appendChild(nx); xfs.setAttribute("count", kids(xfs, "xf").length);
      return (cache[key] = kids(xfs, "xf").length - 1);
    };
  }

  function setCells(doc, vals, styler) {
    const sd = doc.getElementsByTagNameNS(NS, "sheetData")[0];
    const rows = {};
    for (const r of sd.getElementsByTagNameNS(NS, "row")) rows[r.getAttribute("r")] = r;
    function getCell(addr) {
      const { c, r } = splitAddr(addr);
      let row = rows[r];
      if (!row) {
        row = doc.createElementNS(NS, "row"); row.setAttribute("r", r);
        const after = Array.from(sd.getElementsByTagNameNS(NS, "row")).find(x => +x.getAttribute("r") > r);
        sd.insertBefore(row, after || null); rows[r] = row;
      }
      let before = null;
      for (const cell of row.getElementsByTagNameNS(NS, "c")) {
        const cc = splitAddr(cell.getAttribute("r")).c;
        if (cc === c) return cell;
        if (cc > c) { before = cell; break; }
      }
      const cell = doc.createElementNS(NS, "c"); cell.setAttribute("r", addr);
      row.insertBefore(cell, before); return cell;
    }
    for (const addr in vals) {
      if (addr === "__sz") continue;
      const cell = getCell(addr);
      while (cell.firstChild) cell.removeChild(cell.firstChild);
      cell.removeAttribute("t");
      const sz = vals.__sz && vals.__sz[addr];
      if (sz && styler) cell.setAttribute("s", styler(cell.getAttribute("s") || 0, sz));
      const t = clean(vals[addr] == null ? "" : vals[addr]);
      if (t === "") continue;
      cell.setAttribute("t", "inlineStr");
      const is = doc.createElementNS(NS, "is"), te = doc.createElementNS(NS, "t");
      te.setAttribute("xml:space", "preserve"); te.textContent = t;
      is.appendChild(te); cell.appendChild(is);
    }
  }

  function imgType(b) { return (b[0] === 0x89 && b[1] === 0x50) ? "png" : "jpeg"; }

  async function buildXlsx(JSZip, tplBytes, layout, values, photos) {
    const zip = await JSZip.loadAsync(tplBytes);
    const wb = parse(await zip.file("xl/workbook.xml").async("string"));
    const wbRels = parse(await zip.file("xl/_rels/workbook.xml.rels").async("string"));
    const stylesDoc = parse(await zip.file("xl/styles.xml").async("string"));
    const styler = makeStyler(stylesDoc);
    const ct = parse(await zip.file("[Content_Types].xml").async("string"));
    const CTNS = "http://schemas.openxmlformats.org/package/2006/content-types";
    const sheets = Array.from(wb.getElementsByTagNameNS(NS, "sheet"));
    let mediaN = 0, drawN = 0;
    const exts = new Set();

    for (let si = 0; si < layout.length && si < sheets.length; si++) {
      const target = relsTarget(wbRels, sheets[si].getAttributeNS(RNS, "id"));
      const path = "xl/" + target.replace(/^\/?xl\//, "");
      const doc = parse(await zip.file(path).async("string"));
      setCells(doc, (values && values[si]) || {}, styler);

      // 사진
      const pics = (photos && photos[si]) || {};
      const addrs = Object.keys(pics).filter(a => pics[a]);
      if (addrs.length) {
        // 사진 칸의 병합 범위 (끝 칸 다음 경계까지 꽉 채운다: 어느 프로그램에서 열어도 칸에 맞음)
        const merges = {};
        for (const m of doc.getElementsByTagNameNS(NS, "mergeCell")) { const [a1, a2] = m.getAttribute("ref").split(":"); merges[a1] = a2 || a1; }
        // 끝 칸 안쪽 오른쪽·아래 1px 를 남겨 테두리가 가려지지 않게 (열 너비는 layout 추출과 같은 MDW 9 기준)
        const fmt = doc.getElementsByTagNameNS(NS, "sheetFormatPr")[0];
        const defW = fmt && fmt.getAttribute("defaultColWidth") ? +fmt.getAttribute("defaultColWidth") : 8.43;
        const defH = fmt && fmt.getAttribute("defaultRowHeight") ? +fmt.getAttribute("defaultRowHeight") : 15;
        const colW = {}, rowH = {};
        for (const col of doc.getElementsByTagNameNS(NS, "col")) for (let i = +col.getAttribute("min"); i <= Math.min(+col.getAttribute("max"), 200); i++) colW[i] = +col.getAttribute("width");
        for (const row of doc.getElementsByTagNameNS(NS, "row")) if (row.getAttribute("ht")) rowH[row.getAttribute("r")] = +row.getAttribute("ht");
        const colPx = i => Math.floor(((colW[i] != null ? colW[i] : defW) + Math.floor(128 / 9) / 256) * 9);
        const rowEmu = i => Math.round((rowH[i] != null ? rowH[i] : defH) * 12700);
        const relsPath = path.replace(/worksheets\//, "worksheets/_rels/") + ".rels";
        const sRels = zip.file(relsPath) ? parse(await zip.file(relsPath).async("string"))
          : parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PNS}"/>`);
        const drawPath = `xl/drawings/drawing_app${++drawN}.xml`;
        const dRels = [], anchors = [];
        addrs.forEach((a, i) => {
          const bytes = pics[a], ext = imgType(bytes) === "png" ? "png" : "jpeg";
          exts.add(ext);
          const media = `image_app${++mediaN}.${ext}`;
          zip.file("xl/media/" + media, bytes);
          dRels.push(`<Relationship Id="rId${i + 1}" Type="${RNS}/image" Target="../media/${media}"/>`);
          const { c, r } = splitAddr(a), e = splitAddr(merges[a] || a);
          const pad = EMU_PX;   // 왼쪽·위 테두리가 보이도록 1px 안쪽
          anchors.push(`<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c - 1}</xdr:col><xdr:colOff>${pad}</xdr:colOff><xdr:row>${r - 1}</xdr:row><xdr:rowOff>${pad}</xdr:rowOff></xdr:from>` +
            `<xdr:to><xdr:col>${e.c - 1}</xdr:col><xdr:colOff>${Math.max(0, (colPx(e.c) - 1) * EMU_PX)}</xdr:colOff><xdr:row>${e.r - 1}</xdr:row><xdr:rowOff>${Math.max(0, rowEmu(e.r) - EMU_PX)}</xdr:rowOff></xdr:to>` +
            `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="${xmlEsc("사진 " + a)}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
            `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
            `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`);
        });
        zip.file(drawPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${RNS}">${anchors.join("")}</xdr:wsDr>`);
        zip.file(drawPath.replace("drawings/", "drawings/_rels/") + ".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PNS}">${dRels.join("")}</Relationships>`);
        const rid = "rIdApp" + drawN;
        const rel = sRels.createElementNS(PNS, "Relationship");
        rel.setAttribute("Id", rid); rel.setAttribute("Type", RNS + "/drawing"); rel.setAttribute("Target", "../drawings/" + drawPath.split("/").pop());
        sRels.documentElement.appendChild(rel);
        zip.file(relsPath, ser(sRels));
        // <drawing> 은 pageSetup·headerFooter 뒤, legacyDrawing 앞
        const dr = doc.createElementNS(NS, "drawing"); dr.setAttributeNS(RNS, "r:id", rid);
        const ws = doc.documentElement;
        const later = Array.from(ws.childNodes).find(n => n.nodeType === 1 && /^(legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)$/.test(n.localName));
        ws.insertBefore(dr, later || null);
        const ov = ct.createElementNS(CTNS, "Override");
        ov.setAttribute("PartName", "/" + drawPath); ov.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.drawing+xml");
        ct.documentElement.appendChild(ov);
      }
      zip.file(path, ser(doc));
    }
    const have = new Set(Array.from(ct.getElementsByTagNameNS(CTNS, "Default")).map(d => d.getAttribute("Extension").toLowerCase()));
    exts.forEach(e => {
      if (have.has(e)) return;
      const d = ct.createElementNS(CTNS, "Default");
      d.setAttribute("Extension", e); d.setAttribute("ContentType", "image/" + e);
      ct.documentElement.insertBefore(d, ct.documentElement.firstChild);
    });
    zip.file("[Content_Types].xml", ser(ct));
    zip.file("xl/styles.xml", ser(stylesDoc));
    return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  root.SafetyXlsx = { buildXlsx };
})(typeof window !== "undefined" ? window : globalThis);
