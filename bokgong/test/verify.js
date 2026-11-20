// 원본 구조계산서 3가지 경우의 결과값과 비교한다.  node bokgong/test/verify.js
const B = require('../calc.js');
const expect = {
  earth: { Pmax: 429.25, Pdeck: 90.14, Md: 45.54, Sd: 91.54, fbd: 102.80, tad: 6.63, deltaD: 1.12,
           Pg: 558.03, Mg: 834.72, Sg: 575.67, fbg: 145.17, tag: 67.92, fbaG: 210.35, deltaG: 0.21,
           W1: 16.03, W2: 23.45, Mb: 618.94, Sb: 593.21, fbb: 134.55, tab: 79.22, fbaB: 196.46, nreq: 9.25,
           Ps: 118.71, SP: 355.96, Mp: 115.69, fbp: 85.06, fcp: 29.71, fbaP: 197.33, fcaP: 180.08, fea: 2234.94, inter: 0.60, Qu: 1456.29, Qa: 728.14 },
  lift:  { Pmax: 571.90, Pdeck: 120.10, Md: 60.45, Sd: 121.50, fbd: 136.45, tad: 8.80, deltaD: 1.49,
           Pg: 743.47, Mg: 1103.61, Sg: 761.11, fbg: 191.93, tag: 89.80, fbaG: 210.35, deltaG: 0.21,
           Mb: 813.65, Sb: 778.65, fbb: 176.88, tab: 103.99, nreq: 12.14,
           SP: 448.68, Mp: 134.60, fbp: 98.97, fcp: 37.45, fcaP: 180.08, inter: 0.72, Qa: 728.14 },
  pour:  { Pmax: 321.65, Pdeck: 67.55, Md: 34.30, Sd: 68.95, fbd: 77.43, tad: 4.99, deltaD: 0.84,
           Pg: 418.15, Mg: 631.89, Sg: 435.79, fbg: 109.89, tag: 51.41, deltaG: 0.21,
           Mb: 472.06, Sb: 453.33, fbb: 102.62, tab: 60.54, nreq: 7.07,
           SP: 286.02, Mp: 85.81, fbp: 63.09, fcp: 23.87, fbaP: 186.47, fcaP: 157.61, fea: 1213.43, inter: 0.50 }
};
let fail = 0, n = 0;
for (const k of Object.keys(expect)) {
  const r = B.compute(B.caseInput(k));
  for (const [key, want] of Object.entries(expect[k])) {
    n++;
    const got = r.Pmax !== undefined && key === 'Pmax' ? r.Pmax : r.v[key];
    const dp = Math.abs(want) >= 1000 ? 2 : 2;
    const ok = Math.abs(got - want) <= 0.0051 + 1e-9 || Math.abs(got.toFixed(2) - want) < 1e-9;
    if (!ok) { fail++; console.log(`✗ ${k}.${key}: 계산 ${got.toFixed(4)} / 계산서 ${want}`); }
  }
  console.log(`${k}: 전체 ${r.ok ? 'O.K' : 'N.G'}, 최대 사용률 ${r.worst.name} ${(r.worst.ratio*100).toFixed(1)}%, 허용 최대 Pmax ${B.maxPmax(B.caseInput(k)).toFixed(1)} kN`);
}
console.log(`${n - fail}/${n} 항목 일치`);
process.exit(fail ? 1 : 0);
