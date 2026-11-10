"""원본 점검표 xlsx → 앱 엑셀 내보내기용 양식 (templates/tpl-YYYY-MM.xlsx)
- 빈 글상자 수천 개가 든 drawing(10월 양식)은 지운다 (파일이 10MB → 수십 KB)
- 열 때 다시 계산하도록 fullCalcOnLoad
사용: python3 tools/make_xlsx_template.py 원본.xlsx templates/tpl-2026-11.xlsx"""
import re, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
names = zin.namelist()
drop = {n for n in names if n.startswith('xl/drawings/')}
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
    for n in names:
        if n in drop: continue
        d = zin.read(n)
        if n.startswith('xl/worksheets/_rels/'):
            d = re.sub(rb'<Relationship [^>]*relationships/drawing"[^>]*/>', b'', d)
        elif re.match(r'xl/worksheets/sheet\d+\.xml$', n):
            d = re.sub(rb'<drawing r:id="[^"]*"/>', b'', d)
        elif n == '[Content_Types].xml':
            d = re.sub(rb'<Override PartName="/xl/drawings/[^>]*/>', b'', d)
        elif n == 'xl/workbook.xml':
            d = re.sub(rb'<calcPr ([^>]*?)/>', lambda m: b'<calcPr ' + m.group(1) + (b'' if b'fullCalcOnLoad' in m.group(1) else b' fullCalcOnLoad="1"') + b'/>', d)
        zout.writestr(zin.getinfo(n), d)
print(dst)
