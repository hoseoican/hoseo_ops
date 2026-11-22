#!/usr/bin/env python3
"""화면 만들기: src/ 의 원본으로 저장소 맨 위 app.html(운영 관리 화면)과 index.html(메인 페이지)을 만든다.
   python3 src/build.py
 1) to_gas.py : src2.html(화면 원본) + data.json → Lib.html(화면 코드) · Styles.html(디자인)
 2) App.html(껍데기)에 둘을 넣고, 앱스 스크립트 표시를 없애고, 서버 호출을 config.js 의 OPS_API 로 보내게 바꿈
"""
import os, re, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
tmp = tempfile.mkdtemp()
subprocess.run([sys.executable, 'to_gas.py'], cwd=HERE, check=True, env=dict(os.environ, GAS_OUT=tmp), stdout=subprocess.DEVNULL)
lib = open(os.path.join(tmp, 'Lib.html'), encoding='utf-8').read()
if '//' in lib: sys.exit('Lib.html 에 // 가 남아 있습니다 (to_gas.py 확인)')
rd = lambda p: open(p, encoding='utf-8').read()
SHIM = open(os.path.join(HERE, 'shim.html'), encoding='utf-8').read()
app = rd(os.path.join(HERE, 'App.html'))
app = app.replace("<?!= include('Styles') ?>", rd(os.path.join(tmp, 'Styles.html'))).replace("<?!= include('Lib') ?>", lib)
body = re.search(r'<body data-mode=.*?aname \?>">', app).group(0)
app = app.replace(body, '<body data-mode="teacher" data-token="" data-key="" data-link="" data-biz="" data-trole="" data-aname="">\n' + SHIM)
app = app.replace('<base target="_top">\n', '')
if '<?' in app: sys.exit('앱스 스크립트 표시(<? ?>)가 남아 있습니다')
open(os.path.join(ROOT, 'app.html'), 'w', encoding='utf-8').write(app)
open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(rd(os.path.join(HERE, 'portal.html')))
print('app.html', len(app), '자 + index.html(메인)')
