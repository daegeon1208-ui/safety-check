import openpyxl, json, re, sys, colorsys
from openpyxl.utils import column_index_from_string as ci, get_column_letter as L
from openpyxl.styles.colors import COLOR_INDEX
import zipfile
SRC=sys.argv[1]; OUT=sys.argv[2]
z=zipfile.ZipFile(SRC)
MDW=9
def colpx(w): return int((w+ (128//MDW)/256)*MDW)
# theme colors
th=z.read('xl/theme/theme1.xml').decode()
clr=re.search(r'<a:clrScheme.*?</a:clrScheme>',th,re.S).group(0)
vals=re.findall(r'<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>.*?(?:val|lastClr)="([0-9A-Fa-f]{6})"',clr,re.S)
d=dict(vals); THEME=[d['lt1'],d['dk1'],d['lt2'],d['dk2']]+[d[f'accent{i}'] for i in range(1,7)]+[d['hlink'],d['folHlink']]
def tint(hexs,t):
  r,g,b=[int(hexs[i:i+2],16)/255 for i in (0,2,4)]
  h,l,s=colorsys.rgb_to_hls(r,g,b)
  l = l*(1+t) if t<0 else l*(1-t)+t
  r,g,b=colorsys.hls_to_rgb(h,l,s); return '%02X%02X%02X'%tuple(round(x*255) for x in (r,g,b))
def color(c):
  if c is None: return None
  try:
    if c.type=='theme': return '#'+tint(THEME[c.theme], c.tint or 0)
    if c.type=='indexed':
      if c.indexed in (64,65): return None
      return '#'+COLOR_INDEX[c.indexed][-6:]
    if c.type=='rgb' and c.rgb and c.rgb!='00000000': return '#'+c.rgb[-6:]
  except Exception: return None
  return None
def raw_cols(name):
  x=z.read(name).decode(); out={}
  for m in re.finditer(r'<col min="(\d+)" max="(\d+)" width="([\d.]+)"',x):
    for i in range(int(m[1]),min(int(m[2]),200)+1): out[i]=float(m[3])
  return out
def bw(s): return {'thin':0.75,'hair':0.4,'medium':1.5,'thick':2.25,'dotted':0.75,'dashed':0.75}.get(s,0.75) if s else 0
wb=openpyxl.load_workbook(SRC)
sheets=[]
for idx,ws in enumerate(wb.worksheets[:2]):
  area=ws.print_area if isinstance(ws.print_area,str) else ws.print_area[0]
  a=area.split('!')[-1].replace('$','')
  c1,r1,c2,r2=re.match(r'([A-Z]+)(\d+):([A-Z]+)(\d+)',a).groups()
  C1,C2,R1,R2=ci(c1),ci(c2),int(r1),int(r2)
  cw=raw_cols(f'xl/worksheets/sheet{idx+1}.xml')
  dcw=ws.sheet_format.defaultColWidth
  cols=[colpx(cw.get(c,dcw))*0.75 for c in range(C1,C2+1)]
  rows=[(ws.row_dimensions[r].height if ws.row_dimensions[r].height is not None else ws.sheet_format.defaultRowHeight) for r in range(R1,R2+1)]
  xs=[0];[xs.append(xs[-1]+w) for w in cols]; ys=[0];[ys.append(ys[-1]+h) for h in rows]
  merges={}; covered=set()
  for m in ws.merged_cells.ranges:
    merges[(m.min_row,m.min_col)]=(m.max_row,m.max_col)
    for r in range(m.min_row,m.max_row+1):
      for c in range(m.min_col,m.max_col+1):
        if (r,c)!=(m.min_row,m.min_col): covered.add((r,c))
  def mergeof(r,c):
    for (ar,ac),(br,bc) in merges.items():
      if ar<=r<=br and ac<=c<=bc: return (ar,ac,br,bc)
    return (r,c,r,c)
  cells=[]
  for r in range(R1,R2+1):
    for c in range(C1,C2+1):
      if (r,c) in covered: continue
      cell=ws.cell(r,c); br,bc=merges.get((r,c),(r,c))
      f=cell.font; al=cell.alignment
      fill=color(cell.fill.fgColor) if cell.fill.fill_type=='solid' else None
      v=cell.value
      if v is None and fill is None and (r,c) not in merges and not f.name.startswith('KoPub'): continue
      cells.append({'a':f'{L(c)}{r}','x':xs[c-C1],'y':ys[r-R1],'w':xs[min(bc,C2)-C1+1]-xs[c-C1],'h':ys[min(br,R2)-R1+1]-ys[r-R1],
        'font':'B' if 'Bold' in (f.name or '') else 'M','sz':f.sz or 11,'b':bool(f.b),'u':bool(f.u),'color':color(f.color) if f.color is not None else None,
        'fill':fill,'ha':al.horizontal or 'general','va':al.vertical or 'bottom','wrap':bool(al.wrap_text),
        't':None if v is None else str(v)})
  # edges: horizontal grid line between row r-1 and r, per column
  H={};V={}
  def setmax(D,k,s):
    if s and bw(s)>=bw(D.get(k)): D[k]=s
  for r in range(R1,R2+1):
    for c in range(C1,C2+1):
      b=ws.cell(r,c).border
      setmax(H,(r,c),b.top.style); setmax(H,(r+1,c),b.bottom.style)
      setmax(V,(r,c),b.left.style); setmax(V,(r,c+1),b.right.style)
  edges=[]
  for (r,c),s in H.items():
    if r<R1 or r>R2+1 or c>C2: continue
    if r>R1 and r<=R2:
      m1=mergeof(r-1,c); m2=mergeof(r,c)
      if m1==m2: continue
    edges.append([xs[c-C1],ys[r-R1],xs[c-C1+1],ys[r-R1],bw(s)])
  for (r,c),s in V.items():
    if c<C1 or c>C2+1 or r>R2: continue
    if c>C1 and c<=C2 and mergeof(r,c-1)==mergeof(r,c): continue
    edges.append([xs[c-C1],ys[r-R1],xs[c-C1],ys[r-R1+1],bw(s)])
  pm=ws.page_margins
  sheets.append({'name':ws.title,'W':xs[-1],'H':ys[-1],'page':({9:[841.89,595.28],8:[1190.55,841.89]}[int(ws.page_setup.paperSize or 9)] if ws.page_setup.orientation=='landscape' else {9:[595.28,841.89],8:[841.89,1190.55]}[int(ws.page_setup.paperSize or 9)]),'scale':ws.page_setup.scale,
    'margin':{'l':pm.left*72,'r':pm.right*72,'t':pm.top*72,'b':pm.bottom*72},
    'fitHeight': ws.page_setup.fitToHeight!=0 and ws.page_setup.fitToHeight!='0',
    'hc':bool(ws.print_options.horizontalCentered),'vc':bool(ws.print_options.verticalCentered),
    'cells':cells,'edges':edges})
json.dump(sheets,open(OUT,'w'),ensure_ascii=False,separators=(',',':'))
for s in sheets: print(s['name'],round(s['W'],1),round(s['H'],1),len(s['cells']),len(s['edges']),s['fitHeight'])
