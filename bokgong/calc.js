/* 복공 구조 안정성 검토 계산 엔진
 * 원본: 복공구조계산서(기술관리부) 의 계산 절차를 그대로 따른다.
 *   1. 복공판 검토  2. 주형보 설계  3. 주형지지보 설계  4. 중간말뚝 설계
 * 브라우저(window.Bokgong)와 node(require) 양쪽에서 쓴다.
 */
(function (root) {
  'use strict';

  var G_TON = 9.80665; // 지지력 tonf → kN (계산서: 148.500 tonf = 1456.29 kN)

  // H형강 단면 (KS D 3503 기준값. 계산서에 나온 단면은 계산서 값으로 맞춤)
  // w: kN/m, A: cm², Ix: cm⁴, Zx: cm³, rx·ry: cm, H·B·tw·tf: mm
  var H_SECTIONS = {
    'H-200x200x8x12':   { H: 200, B: 200, tw: 8,  tf: 12, w: 0.499, A: 63.53,  Ix: 4720,   Zx: 472,  rx: 8.62, ry: 5.02 },
    'H-250x250x9x14':   { H: 250, B: 250, tw: 9,  tf: 14, w: 0.724, A: 92.18,  Ix: 10800,  Zx: 867,  rx: 10.8, ry: 6.29 },
    'H-300x300x10x15':  { H: 300, B: 300, tw: 10, tf: 15, w: 0.940, A: 119.80, Ix: 20400,  Zx: 1360, rx: 13.0, ry: 7.51 },
    'H-350x350x12x19':  { H: 350, B: 350, tw: 12, tf: 19, w: 1.370, A: 173.90, Ix: 40200,  Zx: 2300, rx: 15.2, ry: 8.84 },
    'H-400x400x13x21':  { H: 400, B: 400, tw: 13, tf: 21, w: 1.720, A: 218.70, Ix: 66600,  Zx: 3330, rx: 17.5, ry: 10.1 },
    'H-588x300x12x20':  { H: 588, B: 300, tw: 12, tf: 20, w: 1.510, A: 192.50, Ix: 118000, Zx: 4020, rx: 24.8, ry: 6.85 },
    'H-700x300x13x24':  { H: 700, B: 300, tw: 13, tf: 24, w: 1.850, A: 235.50, Ix: 201000, Zx: 5750, rx: 29.3, ry: 6.78 },
    'H-800x300x14x26':  { H: 800, B: 300, tw: 14, tf: 26, w: 2.100, A: 267.40, Ix: 292000, Zx: 7290, rx: 33.0, ry: 6.62 },
    'H-900x300x16x28':  { H: 900, B: 300, tw: 16, tf: 28, w: 2.430, A: 309.80, Ix: 411000, Zx: 9140, rx: 36.4, ry: 6.40 }
  };
  // 웨브 단면적 Aw = (H - 2tf) x tw (계산서 84.76 / 37.44 / 27.00 과 같은 식)
  function webArea(s) { return (s.H - 2 * s.tf) * s.tw / 100; }

  // 계산서 예제 장비 (『가설 구조물의 해설』 참고, 계산서 표 값)
  var EQUIP_PRESETS = [
    { name: '크롤러크레인 50t', vehicle: 475.0, load: 30.0,  factor: 0.85, note: '굴토시 고려, 달아올리는 방향에 따라 접지압이 다름' },
    { name: '덤프트럭',          vehicle: 255.0, load: 145.0, factor: 0.4,  note: '전후륜 하중비율 2:8' },
    { name: '하이드로크레인 100t + 백호 0.8㎥', vehicle: 602.0, load: 215.0, factor: 0.7, note: '굴토완료 후 장비 인양' },
    { name: '펌프카 (HCP52.18)', vehicle: 429.5, load: 30.0,  factor: 0.7,  note: '콘크리트 타설시' },
    { name: '레미콘',            vehicle: 119.0, load: 138.0, factor: 0.4,  note: '콘크리트 타설시' }
  ];

  function defaultExtras() {
    return [
      { name: '버팀보',           w: 0.144, len: 4.20, rows: 1, tiers: 5 },
      { name: '버팀보(추가)',     w: 0,     len: 0,    rows: 0, tiers: 0 },
      { name: '받침빔',           w: 0.654, len: 4.20, rows: 1, tiers: 5 },
      { name: '수평 브레이싱',    w: 0.654, len: 4.20, rows: 0, tiers: 0 },
      { name: '중간말뚝 보강브레이싱', w: 0.133, len: 4.80, rows: 2, tiers: 4 },
      { name: '피스브라켓',       w: 0.654, len: 0.40, rows: 1, tiers: 5 },
      { name: '피스브라켓(추가)', w: 0.94,  len: 0.40, rows: 1, tiers: 1 }
    ];
  }

  // 계산서 1번 예제(토공시) 입력값
  function defaultInput() {
    return {
      equip: [clone(EQUIP_PRESETS[0]), clone(EQUIP_PRESETS[1])],
      impactDeck: 0.4,
      widthFactor: 0.15,
      outrigger: { D: 0.40, b: 0.70, h: 0.70, k: 0.4 },
      deck: { name: '1-B:750x1990x200', w: 280.0, B: 0.75, L: 1.99, Ix: 6413, A: 138.06, Zx: 443.00, E: 210000 },
      girder: { section: 'H-700x300x13x24', w: 1.850, A: 235.50, Ix: 201000, Zx: 5750, Aw: 84.76, Bf: 300, E: 210000,
                L: 5.80, Lb: 2.00, other: 0.50, impactMax: 0.3 },
      beam: { section: 'H-350x350x12x19', rows: 2, w: 1.370, A: 173.90, Ix: 40200, Zx: 2300, Aw: 37.44, Bf: 350,
              L: 4.20, s: 2.00, rail: 0.10, boltGrade: 'F10T', boltD: 22, boltFsa: 125, boltN: 16 },
      pile: { section: 'H-300x300x10x15', w: 0.940, A: 119.80, Zx: 1360, Bf: 300, ry: 7.51, rx: 13.0,
              h: 17.70, h1: 3.50, e: 0.325, nGirder: 2, nBeam: 2, extras: defaultExtras(),
              N: 50, Ns: 50, Nc: 0, Ls: 3.0, Lc: 0, Ap: 0.09, U: 1.2, Fs: 2.0 },
      allow: { inc: 1.5, red: 0.9, fb0: 160, fbk: 1.93, fs0: 90, fc0: 160, fck: 1.0, Euler: 1200000,
               deckDeflMax: 5, girderDeflMax: 25, deflDiv: 400 }
    };
  }

  // 계산서의 세 가지 검토 경우
  var CASES = {
    earth: { title: '토공시 (크롤러크레인·덤프트럭)', equip: [0, 1], h1: 3.50, e: 0.325 },
    lift:  { title: '장비인양시 (하이드로크레인)',     equip: [2],    h1: 3.50, e: 0.30 },
    pour:  { title: '펌프카 타설시 (펌프카·레미콘)',   equip: [3, 4], h1: 4.75, e: 0.30 }
  };
  function caseInput(key) {
    var c = CASES[key], inp = defaultInput();
    inp.equip = c.equip.map(function (i) { return clone(EQUIP_PRESETS[i]); });
    inp.pile.h1 = c.h1; inp.pile.e = c.e;
    return inp;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function r2(x) { return Math.round(x * 100 + 1e-9) / 100; }
  function f(x, d) { if (d === undefined) d = 2; if (!isFinite(x)) return '—'; return x.toFixed(d); }

  // 허용휨응력 (계산서: 4.5 < ℓ/B ≤ 30 범위 식)
  function allowBend(a, lb, B) {
    var ratio = lb * 1000 / B, k = a.inc * a.red, out = { ratio: ratio };
    if (ratio <= 4.5) { out.v = k * a.fb0; out.range = 'ℓ/B ≤ 4.5'; out.expr = a.inc + ' × ' + a.red + ' × ' + a.fb0; }
    else {
      out.v = k * (a.fb0 - a.fbk * (ratio - 4.5)); out.range = '4.5 < ℓ/B ≤ 30';
      out.expr = a.inc + ' × ' + a.red + ' × ( ' + a.fb0 + ' - ' + a.fbk + ' × ( ' + f(ratio) + ' - 4.5 ) )';
      if (ratio > 30) { out.outOfRange = true; out.range = 'ℓ/B > 30 (계산서 식 적용 범위 밖)'; }
    }
    return out;
  }
  // 허용압축응력 (계산서: 20 < L/r ≤ 90 범위 식)
  function allowComp(a, L, r) {
    var lr = L * 100 / r, k = a.inc * a.red, out = { lr: lr };
    if (lr <= 20) { out.v = k * a.fc0; out.range = 'L/r ≤ 20'; out.expr = a.inc + ' × ' + a.red + ' × ' + a.fc0; }
    else {
      out.v = k * (a.fc0 - a.fck * (lr - 20)); out.range = '20 < L/r ≤ 90';
      out.expr = a.inc + ' × ' + a.red + ' × ( ' + a.fc0 + ' - ' + f(a.fck) + ' × ( ' + f(lr) + ' - 20.0 ) )';
      if (lr > 90) { out.outOfRange = true; out.range = 'L/r > 90 (계산서 식 적용 범위 밖)'; }
    }
    return out;
  }

  function check(name, demand, cap, unit, extra) {
    var o = { name: name, demand: demand, cap: cap, unit: unit, ok: demand <= cap + 1e-9,
              ratio: cap > 0 ? demand / cap : Infinity, sf: demand > 0 ? cap / demand : Infinity };
    if (extra) for (var k in extra) o[k] = extra[k];
    if (o.outOfRange) o.ok = false;
    return o;
  }

  /* 메인 계산. Pmax 를 직접 주면(opts.Pmax) 장비 표 대신 그 값을 쓴다(최대 허용 하중 역산용). */
  function compute(inp, opts) {
    opts = opts || {};
    var a = inp.allow, K = a.inc * a.red, sections = [], checks = [], warn = [];

    // ---------- 0. 작업하중 ----------
    var eqRows = (inp.equip || []).map(function (e) {
      var tot = (+e.vehicle || 0) + (+e.load || 0);
      return { name: e.name, vehicle: +e.vehicle || 0, load: +e.load || 0, total: tot, factor: +e.factor || 0, P: (+e.factor || 0) * tot };
    });
    var Pmax, govern = null;
    if (opts.Pmax !== undefined) Pmax = opts.Pmax;
    else {
      Pmax = 0;
      eqRows.forEach(function (r) { if (r.P > Pmax) { Pmax = r.P; govern = r; } });
    }

    // ---------- 1. 복공판 ----------
    var d = inp.deck, Ld = d.L;
    var wd = d.w * 0.01 / Ld;                         // kN/m (계산서: 280.0 x 1 / 1.99 = 1.41)
    var Pdeck = Pmax * (1 + inp.impactDeck) * inp.widthFactor;
    var Md = wd * Ld * Ld / 8 + Pdeck * Ld / 4;
    var Sd = wd * Ld / 2 + Pdeck;
    var fbd = Md * 1000 / d.Zx, tad = Sd * 10 / d.A;
    var fbaD = K * a.fb0, fsa = K * a.fs0;
    var EId = d.E * 1000 * d.Ix * 1e-8;              // kN·m²
    var deltaD = (5 * wd * Math.pow(Ld, 4) / (384 * EId) + Pdeck * Math.pow(Ld, 3) / (48 * EId)) * 1000;
    var deltaDa = Math.min(Ld * 1000 / a.deflDiv, a.deckDeflMax);
    var o = inp.outrigger, oA = Math.PI * o.D * o.D / 4, padA = o.b * o.h, wfCalc = oA / padA * o.k;

    sections.push({ key: 'deck', title: '1. 복공판 검토', spec: d.name, lines: [
      { h: '가. 설계제원' },
      { t: 'w = ' + f(d.w, 1) + ' kg/piece,  Ix = ' + d.Ix + ' cm⁴,  A = ' + f(d.A) + ' cm²,  Zx = ' + f(d.Zx) + ' cm³,  E = ' + d.E + ' MPa,  지간 L = ' + f(Ld) + ' m' },
      { h: '나. 단면력 산정' },
      { t: '(1) 고정하중  wd = ' + f(d.w, 1) + ' × 0.01 / ' + f(Ld) + ' = ' + f(wd, 3) + ' kN/m' },
      { t: '(2) 작업하중  (장비별 P = 하중분담계수 × 총중량)' },
      { table: 'equip', rows: eqRows, Pmax: Pmax, govern: govern ? govern.name : (opts.Pmax !== undefined ? '직접 입력' : '—') },
      { t: '(3) 충격하중을 고려한 최대하중  (복공판 활하중 충격계수 I = ' + inp.impactDeck + ', 서울지하철 설계기준)' },
      { t: 'P = Pmax × (1.0 + I) × 폭에 대한 영향계수 = ' + f(Pmax) + ' × (1.0 + ' + inp.impactDeck + ') × ' + inp.widthFactor + ' = ' + f(Pdeck) + ' kN' },
      { note: '폭에 대한 영향계수 참고값: 아웃트리거 접지면적 π×' + f(o.D) + '²/4 = ' + f(oA, 3) + ' m², 고임목 ' + f(o.b) + '×' + f(o.h) + ' = ' + f(padA, 3) + ' m² → (' + f(oA, 3) + ' / ' + f(padA, 3) + ') × ' + o.k + ' = ' + f(wfCalc) + ' (계산서는 0.10 → use 0.15)' },
      { t: '(4) 최대 휨모멘트  Mmax = wd·L²/8 + P·L/4 = ' + f(wd, 3) + '×' + f(Ld) + '²/8 + ' + f(Pdeck) + '×' + f(Ld) + '/4 = ' + f(Md) + ' kN·m' },
      { t: '(5) 최대 전단력 (작업하중이 단부)  Smax = wd·L/2 + P = ' + f(wd, 3) + '×' + f(Ld) + '/2 + ' + f(Pdeck) + ' = ' + f(Sd) + ' kN' },
      { h: '다. 작용응력' },
      { t: 'fb = Mmax / Zx = ' + f(Md) + ' × 1000 / ' + f(d.Zx) + ' = ' + f(fbd) + ' MPa' },
      { t: 'τ = Smax / A = ' + f(Sd) + ' × 10 / ' + f(d.A) + ' = ' + f(tad) + ' MPa' },
      { h: '라. 허용응력  (가시설 증가계수 ' + a.inc + ' × 재사용·부식 보정계수 ' + a.red + ')' },
      { t: 'fba = ' + a.inc + ' × ' + a.red + ' × ' + a.fb0 + ' = ' + f(fbaD) + ' MPa,   τa = ' + a.inc + ' × ' + a.red + ' × ' + a.fs0 + ' = ' + f(fsa) + ' MPa' },
      { h: '마. 처짐 (작업하중이 복공판 중앙)' },
      { t: 'δ = 5·wd·L⁴/(384·E·I) + P·L³/(48·E·I) = ' + f(deltaD) + ' mm,   δa = Min(L/' + a.deflDiv + ', ' + a.deckDeflMax + 'mm) = ' + f(deltaDa) + ' mm' }
    ]});
    checks.push(check('복공판 휨응력', fbd, fbaD, 'MPa', { sec: 'deck' }));
    checks.push(check('복공판 전단응력', tad, fsa, 'MPa', { sec: 'deck' }));
    checks.push(check('복공판 처짐', deltaD, deltaDa, 'mm', { sec: 'deck' }));

    // ---------- 2. 주형보 ----------
    var g = inp.girder, b = inp.beam, Lg = g.L;
    var gDeck = d.w * 0.01 / d.B;                      // kN/m (계산서 3.73)
    var wg = gDeck + g.w + g.other;
    var Ig = Math.min(15 / (40 + Lg), g.impactMax);
    var Pg = Pmax * (1 + Ig);
    var Mg = wg * Lg * Lg / 8 + Pg * Lg / 4;
    var Sg = wg * Lg / 2 + Pg;
    var fbg = Mg * 1000 / g.Zx, tag = Sg * 10 / g.Aw;
    var fbaG = allowBend(a, g.Lb, g.Bf);
    var EIg = g.E * 1000 * g.Ix * 1e-8;
    var deltaG = 5 * wg * Math.pow(Lg, 4) / (384 * EIg) * 1000;               // 계산서: 작업하중이 단부 → P항 0
    var deltaGc = deltaG + Pg * Math.pow(Lg, 3) / (48 * EIg) * 1000;          // 참고: 작업하중이 중앙
    var deltaGa = Math.min(Lg * 1000 / a.deflDiv, a.girderDeflMax);
    sections.push({ key: 'girder', title: '2. 주형보 설계', spec: g.section, lines: [
      { h: '가. 설계제원' },
      { t: 'w = ' + f(g.w, 3) + ' kN/m,  A = ' + f(g.A) + ' cm²,  Ix = ' + g.Ix + ' cm⁴,  Zx = ' + f(g.Zx) + ' cm³,  Aw = ' + f(g.Aw) + ' cm²,  설계지간 ' + f(Lg) + ' m,  브레이싱 간격 ' + f(g.Lb) + ' m' },
      { h: '나. 단면력 산정' },
      { t: '(1) 고정하중  복공판 ' + f(d.w, 1) + '×0.01/' + f(d.B) + ' = ' + f(gDeck) + ' + 주형보 ' + f(g.w) + ' + 기타 ' + f(g.other) + ' = ' + f(wg) + ' kN/m' },
      { t: '(2) 충격계수 I = 15/(40+L) = 15/(40+' + f(Lg) + ') = ' + f(15 / (40 + Lg)) + ' → 사용 ' + f(Ig) + ' (최대 ' + g.impactMax + ')' },
      { t: 'P = Pmax × (1 + I) = ' + f(Pmax) + ' × ' + f(1 + Ig) + ' = ' + f(Pg) + ' kN' },
      { t: '(3) 최대 휨모멘트  Mmax = wd·L²/8 + P·L/4 = ' + f(wg, 3) + '×' + f(Lg) + '²/8 + ' + f(Pg) + '×' + f(Lg) + '/4 = ' + f(Mg) + ' kN·m' },
      { t: '(4) 최대 전단력 (작업하중이 단부)  Smax = wd·L/2 + P = ' + f(Sg) + ' kN' },
      { h: '다. 작용응력' },
      { t: 'fb = ' + f(Mg) + ' × 1000 / ' + f(g.Zx) + ' = ' + f(fbg) + ' MPa,   τ = Smax / Aw = ' + f(Sg) + ' × 10 / ' + f(g.Aw) + ' = ' + f(tag) + ' MPa' },
      { h: '라. 허용응력' },
      { t: 'ℓ/B = ' + f(g.Lb * 1000, 0) + ' / ' + g.Bf + ' = ' + f(fbaG.ratio) + '  (' + fbaG.range + ')' },
      { t: 'fba = ' + fbaG.expr + ' = ' + f(fbaG.v) + ' MPa,   τa = ' + f(fsa) + ' MPa' },
      { h: '마. 처짐 (계산서: 작업하중이 주형보 단부 → 고정하중만)' },
      { t: 'δ = 5·wd·L⁴/(384·E·I) = ' + f(deltaG) + ' mm,   δa = Min(L/' + a.deflDiv + ', ' + a.girderDeflMax + 'mm) = ' + f(deltaGa) + ' mm' },
      { note: '참고(계산서에 없음): 작업하중이 지간 중앙에 올 때 δ = ' + f(deltaGc) + ' mm' }
    ]});
    checks.push(check('주형보 휨응력', fbg, fbaG.v, 'MPa', { sec: 'girder', outOfRange: fbaG.outOfRange }));
    checks.push(check('주형보 전단응력', tag, fsa, 'MPa', { sec: 'girder' }));
    checks.push(check('주형보 처짐', deltaG, deltaGa, 'mm', { sec: 'girder' }));
    checks.push(check('주형보 처짐 (참고: 중앙 재하)', deltaGc, deltaGa, 'mm', { sec: 'girder', ref: true }));

    // ---------- 3. 주형지지보 ----------
    var Lb = b.L, s = b.s;
    var dk = gDeck * Lb, gw = g.w * Lb, rail = b.rail * Lb;
    var W1 = dk / 2 + gw + rail, W2 = dk + gw;
    var wb = b.w * b.rows;
    var Pb = Pg;                                       // 계산서: P = 0.7 Wt × 1.3 (= 주형보 P)
    var Mb = wb * Lb * Lb / 8 + W2 * (Lb - 2 * s) / 2 + W2 * Lb / 4 + Pb * Lb / 4;
    var B1 = Lb - s, B2 = Lb - 2 * s;
    var Sb = wb * Lb / 2 + (W1 + Pb + W2 * B1 / Lb + W2 * Math.max(B2, 0) / Lb);
    var Zb = b.Zx * b.rows, Awb = b.Aw * b.rows;
    var fbb = Mb * 1000 / Zb, tab = Sb * 10 / Awb;
    var fbaB = allowBend(a, Lb, b.Bf);
    var boltFa = K * b.boltFsa, boltArea = Math.PI * b.boltD * b.boltD / 4;
    var nreq = Sb * 1000 / (boltFa * boltArea);
    if (B2 < 0) warn.push('주형지지보 지간이 주형보 간격의 2배보다 짧습니다. 계산서 식(주형보 3개 배치)을 그대로 쓸 수 없으니 확인이 필요합니다.');
    sections.push({ key: 'beam', title: '3. 주형지지보 설계', spec: b.section + ' ' + b.rows + '열', lines: [
      { h: '가. 설계제원' },
      { t: 'w = ' + f(b.w, 3) + ' kN/m,  Zx = ' + f(b.Zx) + ' cm³,  Aw = ' + f(b.Aw) + ' cm² (× ' + b.rows + '열),  설계지간 ' + f(Lb) + ' m,  주형보 간격 ' + f(s) + ' m' },
      { h: '나. 단면력 산정' },
      { t: '(1) 고정하중  복공판 ' + f(gDeck) + '×' + f(Lb) + ' = ' + f(dk) + ' kN,  주형보 ' + f(g.w) + '×' + f(Lb) + ' = ' + f(gw) + ' kN,  난간 ' + f(b.rail) + '×' + f(Lb) + ' = ' + f(rail) + ' kN' },
      { t: 'W1 = ' + f(dk) + '/2 + ' + f(gw) + ' + ' + f(rail) + ' = ' + f(W1) + ' kN,   W2 = ' + f(dk) + ' + ' + f(gw) + ' = ' + f(W2) + ' kN,   지지보 자중 ' + f(b.w) + ' × ' + b.rows + '열 = ' + f(wb) + ' kN/m' },
      { t: '(2) 적재하중 + 충격 (장비 하중이 직접 지지보에 작용)  P = ' + f(Pmax) + ' × ' + f(1 + Ig) + ' = ' + f(Pb) + ' kN' },
      { t: '(3) Mmax = wd·L²/8 + W2·(L−2s)/2 + W2·L/4 + P·L/4 = ' + f(wb, 3) + '×' + f(Lb) + '²/8 + ' + f(W2) + '×' + f(Lb - 2 * s) + '/2 + ' + f(W2) + '×' + f(Lb) + '/4 + ' + f(Pb) + '×' + f(Lb) + '/4 = ' + f(Mb) + ' kN·m' },
      { t: '(4) Smax (작업하중이 단부) = wd·L/2 + (W1 + P + W2·B1/L + W2·B2/L) = ' + f(wb * Lb / 2) + ' + (' + f(W1) + ' + ' + f(Pb) + ' + ' + f(W2 * B1 / Lb) + ' + ' + f(W2 * Math.max(B2, 0) / Lb) + ') = ' + f(Sb) + ' kN' },
      { h: '다. 작용응력' },
      { t: 'fb = ' + f(Mb) + ' × 1000 / ' + f(Zb) + ' = ' + f(fbb) + ' MPa,   τ = ' + f(Sb) + ' × 10 / ' + f(Awb) + ' = ' + f(tab) + ' MPa' },
      { h: '라. 허용응력' },
      { t: 'ℓ/B = ' + f(Lb * 1000, 0) + ' / ' + b.Bf + ' = ' + f(fbaB.ratio) + '  (' + fbaB.range + '),  fba = ' + fbaB.expr + ' = ' + f(fbaB.v) + ' MPa,  τa = ' + f(fsa) + ' MPa' },
      { h: '마. 볼트개수 (' + b.boltGrade + ', M' + b.boltD + ')' },
      { t: '허용전단응력 = ' + a.inc + ' × ' + a.red + ' × ' + b.boltFsa + ' = ' + f(boltFa) + ' MPa,   n req = ' + f(Sb * 1000, 0) + ' / (' + f(boltFa) + ' × π × ' + b.boltD + '² / 4) = ' + f(nreq) + ' ea,   사용 ' + b.boltN + ' ea' }
    ]});
    checks.push(check('주형지지보 휨응력', fbb, fbaB.v, 'MPa', { sec: 'beam', outOfRange: fbaB.outOfRange }));
    checks.push(check('주형지지보 전단응력', tab, fsa, 'MPa', { sec: 'beam' }));
    checks.push(check('주형지지보 볼트 개수', nreq, b.boltN, 'ea', { sec: 'beam' }));

    // ---------- 4. 중간말뚝 ----------
    var p = inp.pile;
    var deckUnit = r2(gDeck / s);                      // 계산서 1.87 kN/m² (소수 둘째 자리 값으로 곱함)
    var dl = [
      { name: '복공판', expr: f(deckUnit) + ' × ' + f(Lg) + ' × ' + f(Lb), v: deckUnit * Lg * Lb },
      { name: '주형보', expr: f(g.w) + ' × ' + f(p.nGirder) + ' × ' + f(Lg), v: g.w * p.nGirder * Lg },
      { name: '주형지지보', expr: f(b.w) + ' × ' + f(p.nBeam) + ' × ' + f(Lb), v: b.w * p.nBeam * Lb },
      { name: '중간말뚝', expr: f(p.w) + ' × ' + f(p.h), v: p.w * p.h }
    ];
    (p.extras || []).forEach(function (x) {
      var v = (+x.w || 0) * (+x.len || 0) * (+x.rows || 0) * (+x.tiers || 0);
      dl.push({ name: x.name, expr: '(' + x.w + ' × ' + f(+x.len) + ' × ' + x.rows + '열 × ' + x.tiers + '단)', v: v });
    });
    var Ps = dl.reduce(function (t, x) { return t + x.v; }, 0);
    var Pl = Sb;
    var div = Lb >= 4 ? 2 : 3;
    var SP = (Ps + Pl) / div;
    var Mp = SP * p.e;
    var fbp = Mp * 1000 / p.Zx, fcp = SP * 10 / p.A;
    var fbaP = allowBend(a, p.h1, p.Bf);
    var fcaP = allowComp(a, p.h1, p.ry);
    var lrx = p.h1 * 100 / p.rx;
    var fea = K * a.Euler / (lrx * lrx);
    var inter = fcp / fcaP.v + fbp / (fbaP.v * (1 - fcp / fea));
    var QuT = 25 * p.N * p.Ap + 0.2 * p.Ns * p.U * p.Ls + 0.5 * p.Nc * p.U * p.Lc;
    var Qu = QuT * G_TON, Qa = Qu / p.Fs;
    sections.push({ key: 'pile', title: '4. 중간말뚝 설계', spec: p.section, lines: [
      { h: '가. 설계제원' },
      { t: 'w = ' + f(p.w, 3) + ' kN/m,  A = ' + f(p.A) + ' cm²,  Zx = ' + f(p.Zx) + ' cm³,  ry = ' + f(p.ry) + ' cm,  rx = ' + f(p.rx) + ' cm,  설치간격 ' + f(Lb) + ' m,  길이 h = ' + f(p.h) + ' m,  최대수직지간 h1 = ' + f(p.h1) + ' m' },
      { h: '나. 단면력 산정' },
      { table: 'dead', rows: dl, sum: Ps },
      { t: '주형지지보 최대반력 Pl = ' + f(Pl, 3) + ' kN (주형지지보 최대전단력)' },
      { t: '∑P = (∑Ps + Pl) / ' + div + ' = (' + f(Ps, 4) + ' + ' + f(Pl) + ') / ' + div + ' = ' + f(SP) + ' kN' },
      { note: '말뚝 간격 4m 이상: 최대반력의 1/2,  4m 미만: 1/3 (서울지하철 설계기준). 트러스 보강이 없는 중간말뚝은 단독으로 연직하중을 지지.' },
      { h: '다. 작용응력' },
      { t: 'Mmax = ∑P × e = ' + f(SP, 3) + ' × ' + p.e + ' = ' + f(Mp, 3) + ' kN·m' },
      { t: 'fb = ' + f(Mp) + ' × 1000 / ' + f(p.Zx) + ' = ' + f(fbp) + ' MPa,   fc = ' + f(SP) + ' × 10 / ' + f(p.A) + ' = ' + f(fcp) + ' MPa' },
      { h: '라. 허용응력' },
      { t: 'ℓ/B = ' + f(p.h1 * 1000, 0) + ' / ' + p.Bf + ' = ' + f(fbaP.ratio) + '  (' + fbaP.range + '),  fba = ' + fbaP.expr + ' = ' + f(fbaP.v) + ' MPa' },
      { t: 'L/ry = ' + f(p.h1 * 100, 0) + ' / ' + f(p.ry) + ' = ' + f(fcaP.lr) + '  (' + fcaP.range + '),  fca = ' + fcaP.expr + ' = ' + f(fcaP.v) + ' MPa' },
      { h: '마. 합성응력' },
      { t: 'fea = ' + a.inc + ' × ' + a.red + ' × ' + a.Euler.toLocaleString() + ' ÷ (L/rx)² = ' + f(K * a.Euler) + ' ÷ ' + f(lrx) + '² = ' + f(fea, 3) + ' MPa (Euler 좌굴응력)' },
      { t: 'fc/fca + fb/(fba·(1 − fc/fea)) = ' + f(fcp) + '/' + f(fcaP.v) + ' + ' + f(fbp) + '/(' + f(fbaP.v) + '×(1 − ' + f(fcp) + '/' + f(fea) + ')) = ' + f(inter) + ' ≤ 1.0' },
      { h: '바. 지지력 (선굴착 최종경타 공법)' },
      { t: 'Qu = 25·N·Ap + 0.2·Ns·U·Ls + 0.5·Nc·U·Lc = 25×' + p.N + '×' + f(p.Ap, 4) + ' + 0.2×' + p.Ns + '×' + f(p.U, 3) + '×' + f(p.Ls, 3) + ' + 0.5×' + p.Nc + '×' + f(p.U, 3) + '×' + f(p.Lc, 3) + ' = ' + f(QuT, 3) + ' tonf = ' + f(Qu) + ' kN' },
      { t: 'Qa = Qu / Fs = ' + f(Qu) + ' / ' + f(p.Fs, 1) + ' = ' + f(Qa, 3) + ' kN' }
    ]});
    checks.push(check('중간말뚝 압축응력', fcp, fcaP.v, 'MPa', { sec: 'pile', outOfRange: fcaP.outOfRange }));
    checks.push(check('중간말뚝 휨응력', fbp, fbaP.v, 'MPa', { sec: 'pile', outOfRange: fbaP.outOfRange }));
    checks.push(check('중간말뚝 합성응력', inter, 1.0, '', { sec: 'pile' }));
    checks.push(check('중간말뚝 지지력', SP, Qa, 'kN', { sec: 'pile' }));

    if (fbaG.outOfRange || fbaB.outOfRange || fbaP.outOfRange || fcaP.outOfRange)
      warn.push('세장비(ℓ/B 또는 L/r)가 계산서 허용응력 식의 적용 범위를 넘었습니다. 해당 항목은 NG로 표시하며 별도 검토가 필요합니다.');

    var main = checks.filter(function (c) { return !c.ref; });
    var worst = main.reduce(function (w, c) { return (!w || c.ratio > w.ratio) ? c : w; }, null);
    return {
      Pmax: Pmax, govern: govern, eqRows: eqRows, sections: sections, checks: checks, warn: warn,
      ok: main.every(function (c) { return c.ok; }), worst: worst,
      v: { wd: wd, Pdeck: Pdeck, Md: Md, Sd: Sd, fbd: fbd, tad: tad, deltaD: deltaD, deltaDa: deltaDa,
           wg: wg, Ig: Ig, Pg: Pg, Mg: Mg, Sg: Sg, fbg: fbg, tag: tag, fbaG: fbaG.v, deltaG: deltaG,
           W1: W1, W2: W2, Mb: Mb, Sb: Sb, fbb: fbb, tab: tab, fbaB: fbaB.v, nreq: nreq,
           Ps: Ps, SP: SP, Mp: Mp, fbp: fbp, fcp: fcp, fbaP: fbaP.v, fcaP: fcaP.v, fea: fea, inter: inter, Qu: Qu, Qa: Qa }
    };
  }

  /* 이 복공 구조가 견딜 수 있는 최대 Pmax (분담계수 적용 후 하중) 를 이분법으로 찾는다. */
  function maxPmax(inp) {
    var lo = 0, hi = 20000;
    if (!compute(inp, { Pmax: 0 }).ok) return 0;
    if (compute(inp, { Pmax: hi }).ok) return hi;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (compute(inp, { Pmax: mid }).ok) lo = mid; else hi = mid;
    }
    return lo;
  }

  var api = { compute: compute, maxPmax: maxPmax, defaultInput: defaultInput, caseInput: caseInput, CASES: CASES,
              EQUIP_PRESETS: EQUIP_PRESETS, H_SECTIONS: H_SECTIONS, webArea: webArea, defaultExtras: defaultExtras, clone: clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Bokgong = api;
})(this);
