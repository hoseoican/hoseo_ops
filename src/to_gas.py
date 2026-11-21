import json, re
src=open('src2.html').read()
d=json.load(open('data.json'))
style=src[src.index('<style>'):src.index('</style>')+8]
js=src[src.index('<script>\nconst SEED'):]
js=js[len('<script>\n'):js.rindex('</script>')]
def rep(old,new,cnt=1):
    global js
    assert old in js, 'MISSING: '+old[:120]
    js=js.replace(old,new,cnt)
def cut(start,end_marker,new=''):
    global js
    a=js.index(start); b=js.index(end_marker,a)+len(end_marker)
    js=js[:a]+new+js[b:]

rep("const SEED = /*SEED*/null;","const OP_HEADER = "+json.dumps(d['header'][:65],ensure_ascii=False)+";\nconst DEFAULT_ADDR = "+json.dumps(d['schools'],ensure_ascii=False)+";")
js=re.sub(r"const STORE = '[^']+';\n","",js)
# ids unique per import batch
rep("id:(O1?'o':'r')+(i+1), no,","id:(O1?'o':'r')+(i+1)+'-'+BATCH, no,")
rep("function buildRows(raw,opt){\n  const O=!!(opt&&opt.out);\n","function buildRows(raw,opt){\n  const O=!!(opt&&opt.out), BATCH=Date.now().toString(36);\n")
# freshState -> defaultSettings
cut("function freshState(){","  S.rows=buildRows(SEED.raw);\n}\n","""function defaultSettings(){
  return {programs:defaultPrograms(),holidays:['2026-12-25','2027-01-01','2027-02-05','2027-02-08'],
    seasons:[{k:'2026-1',name:'2026 1학기',link:''},{k:'2026-s',name:'2026 여름방학',link:''},{k:'2026-2',name:'2026 2학기',link:''},{k:'2026-w',name:'2026 겨울방학',link:WINTER_LINK}],
    season:'2026-w',retention:'해당 차수 운영 종료 후 1년',ops:{...DEFAULT_OPS},recruitLink:RECRUIT_LINK,addr:{...DEFAULT_ADDR},file:'',webAppUrl:'',joinMail:null,joinSms:null,activeOrgs:['호서대학교'],applyWin:{},asstWin:{},fileOut:'',kpi:{targets:{}},joinAutoMail:true,mailFromName:'충남 1권역 앵커늘봄(호서대학교)',mailReplyTo:'iniini@hoseo.edu',resultMail:null,tScore:null,applyWinOrg:null,outRules:null,formCfg:null};
}
const SETTING_KEYS=['programs','holidays','seasons','season','retention','ops','recruitLink','addr','file','webAppUrl','joinMail','joinSms','activeOrgs','joinAutoMail','mailFromName','mailReplyTo','resultMail','applyWin','asstWin','fileOut','kpi','tScore','applyWinOrg','outRules','formCfg'];
""")
cut("function demoSeed(){","  S.demo=true;\n}\n","")
cut("function save(){","return false; }\n","function save(){ if(typeof persist==='function') persist(); }\n")
# routing via S.ui.view
rep("function route(){ const h=location.hash.slice(1), ok=routesOf(S.ui.role).map(x=>x[0]); return ok.includes(h)?h:homeView(S.ui.role); }",
    "function route(){ const ok=routesOf(S.ui.role).map(x=>x[0]); return ok.includes(S.ui.view)?S.ui.view:homeView(S.ui.role); }")
rep("""  document.getElementById('tabs').innerHTML=routesOf(S.ui.role).map(([k,t])=>`<a href="#${k}" class="${cur===k?'on':''}">${t}</a>`).join('');
  ['admin','school','teacher'].forEach(k=>document.getElementById('role-'+k).classList.toggle('on',S.ui.role===k));""",
"""  const tabs=routesOf(S.ui.role); document.getElementById('tabs').innerHTML=tabs.length>1?tabs.map(([k,t])=>`<button class="tabbtn ${cur===k?'on':''}" data-act="tab" data-v="${k}">${t}</button>`).join(''):'';""")
rep("  enhanceTables(cur); renderLayer(); save();\n}","  enhanceTables(cur); renderLayer(); save(); if(typeof afterRender==='function') afterRender();\n}")
# board: demo notice removal + setup link
a=js.index("  ${S.demo?`<div class=\"notice\">"); b=js.index("  ${u.pending",a); js=js[:a]+js[b:]
rep("""<a href="#setup">기준정보로 가기</a>""","""<button class="btn sm" data-act="tab" data-v="setup">기준정보로 가기</button>""")
rep("    case 'role': S.ui.role=el.dataset.v; S.ui.drawer=''; location.hash=homeView(S.ui.role); break;","    case 'tab': S.ui.view=el.dataset.v; S.ui.drawer=''; break;")
rep("    case 'clean': freshState(); toast('처음 상태로 돌렸습니다'); break;\n","")
rep("S.ui.drawer=''; location.hash='export'; break;","S.ui.drawer=''; S.ui.view='export'; break;")
rep("window.addEventListener('hashchange',render);\n","")
# school: fixed school, no picker
a=js.index("   <div class=\"notice\">학교 담당자가 문자로 받은"); b=js.index("</select></div></div>\n",a)+len("</select></div></div>\n"); js=js[:a]+js[b:]
rep("  const sch=schools.includes(S.ui.school)?S.ui.school:(schools.find(s=>rows.some(r=>r.school===s&&r.status==='proposed'))||schools[0]);","  const sch=S.ui.school;")
# teacher gate: no demo
a=js.index("   <div class=\"notice\">강사가 처음 들어오면 보이는 화면입니다."); b=js.index("</div>\n",a)+len("</div>\n"); js=js[:a]+js[b:]
rep("  const demo=S.instructors.filter(t=>t.example).slice(0,3);\n","")
# downloads
rep("""async function saveXlsx(wb,filename,msg){
  const buf=XLSX.write(wb,{type:'array',bookType:'xlsx',cellDates:true});
  const dl = window.claude ? await window.claude.use('downloads') : null;
  if(!dl){ msg.textContent='이 화면에서는 파일 저장을 쓸 수 없습니다. claude.ai에서 열어 주세요.'; return; }
  try{ await dl.save({filename,data:new Blob([buf])}); msg.textContent='저장했습니다.'; }
  catch(e){ msg.textContent = e&&e.code==='declined' ? '저장을 취소했습니다.' : '저장하지 못했습니다. 잠시 후 다시 눌러 주세요.'; }
}""","""function downloadBlob(blob,filename,msg){
  try{ const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=bizWords(filename); document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },4000);
    if(msg) msg.textContent='내려받기를 시작했습니다. 브라우저 다운로드 목록을 확인해 주세요.'; }
  catch(e){ if(msg) msg.textContent='내려받지 못했습니다. 다른 브라우저(크롬)로 다시 시도해 주세요.'; }
}
async function saveXlsx(wb,filename,msg){
  const buf=XLSX.write(wb,{type:'array',bookType:'xlsx',cellDates:true});
  downloadBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),filename,msg);
}""")
rep("""  const buf=await wb.xlsx.writeBuffer();
  const dl = window.claude ? await window.claude.use('downloads') : null;
  if(!dl){ msg.textContent='이 화면에서는 파일 저장을 쓸 수 없습니다. claude.ai에서 열어 주세요.'; return; }
  try{ await dl.save({filename:`${shortSch(sch)} ${season().name} 앵커늘봄 제출 내용.xlsx`,data:new Blob([buf])}); msg.textContent='저장했습니다.'; }
  catch(e){ msg.textContent = e&&e.code==='declined' ? '저장을 취소했습니다.' : '저장하지 못했습니다. 잠시 후 다시 눌러 주세요.'; }""",
"""  const buf=await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`${shortSch(sch)} ${season().name} 앵커늘봄 제출 내용.xlsx`,msg);""")
rep("H=SEED.header.slice(0,65)","H=OP_HEADER.slice(0,65)")
rep("""    <div class="row"><button class="btn sm" data-act="export">예전 65개 열 형식으로 내려받기</button> <span class="muted small" id="xmsg"></span></div></div></div>""",
    """    <div class="row"><button class="btn sm" data-act="export">예전 65개 열 형식으로 내려받기</button><button class="btn sm" data-act="export-sheet">구글 시트로 만들기</button> <span class="muted small" id="xmsg">내려받기가 안 되면 '구글 시트로 만들기'를 누른 뒤 [파일 > 다운로드 > xlsx]로 받으세요.</span></div></div></div>""")
# init block removal
a=js.index("if(!load()){ freshState(); demoSeed(); }"); js=js[:a]
# export: make aoa builder reusable for sheet export
# end of aoa builder: split at ws creation
# remind panel: links & mail
rep("""   <div class="muted small">아직 확인하지 않은 학교 ${pend.length}곳입니다. 실제 시스템에서는 문자·알림톡으로 학교별 링크가 한 번에 나갑니다. 이 시연에서는 문구만 복사됩니다.</div>""",
    """   <div class="muted small">아직 확인하지 않은 학교 ${pend.length}곳입니다. 문구를 복사해 공문·단톡방에 쓰고, 학교별 확인 링크는 아래 표에서 복사하세요. 이메일이 등록된 학교에는 바로 메일을 보낼 수 있습니다.</div>""")
rep("확인 링크: (학교별 링크가 자동으로 들어갑니다)","확인 링크: (학교별 링크)")
rep("""<th>운영 조건 체크</th><th>담당자</th><th>카톡방</th></tr></thead><tbody>${pend.map(s=>{const rs=rows.filter(r=>r.school===s);return `<tr><td>${esc(s)}</td>""",
    """<th>운영 조건 체크</th><th>담당자</th><th>카톡방</th><th>확인 링크</th></tr></thead><tbody>${pend.map(s=>{const rs=rows.filter(r=>r.school===s), L=(S.schoolLinks||[]).find(x=>x.school===s);return `<tr><td>${esc(s)}</td>""")
rep("""<td class="small">${(S.contacts[s]||{}).kakao?'<span class="lv-ok">입장</span>':'<span class="muted">미입장</span>'}</td></tr>`}).join('')}</tbody></table></div>""",
    """<td class="small">${(S.contacts[s]||{}).kakao?'<span class="lv-ok">입장</span>':'<span class="muted">미입장</span>'}</td><td>${L&&L.link?`<button class="btn sm" data-act="copytext" data-t="${esc(L.link)}">링크 복사</button>`:'<span class="small muted">배포 후 생성</span>'}</td></tr>`}).join('')}</tbody></table></div>
   ${(()=>{const withMail=pend.filter(s=>(S.contacts[s]||{}).email);return `<div class="panel stack"><h3>이메일로 보내기</h3><div class="small muted">이메일이 등록된 학교 ${withMail.length}곳에 위 문구와 학교별 확인 링크를 보냅니다. 처음 차수에는 이메일이 없으니 공문·단톡방으로 링크를 안내하세요.</div><div><button class="btn" data-act="mail-send" ${withMail.length?'':'disabled'}>${withMail.length}곳에 메일 보내기</button> <span class="small muted" id="mailmsg"></span></div></div>`;})()}""")
# setup: links panel
rep("function setupLinksPanel(){ return ''; }","""function setupLinksPanel(){ return `<div class="panel stack"><div><h3><span class="stepno">7</span>웹앱 주소 · 학교 확인 링크</h3><div class="muted small" style="margin-top:2px">강사 화면은 웹앱 주소, 학교 화면은 학교마다 다른 확인 링크로 엽니다. 링크가 밖으로 새면 '새 링크'로 바꾸세요(이전 링크는 바로 막힙니다).</div></div>
   <div class="row"><label class="f" style="flex:1 1 360px">웹앱 주소 (강사 화면)<input id="webAppUrl" value="${esc(S.webAppUrl||'')}" placeholder="배포 후 자동으로 들어갑니다" inputmode="url"></label>${S.webAppUrl?`<button class="btn sm" data-act="copytext" data-t="${esc(S.webAppUrl)}">주소 복사</button>`:''}</div>
   <details><summary class="small">학교 확인 링크 ${(S.schoolLinks||[]).length}곳</summary><div class="tw" style="margin-top:8px"><table><thead><tr><th>학교</th><th>확인 링크</th><th></th></tr></thead><tbody>${(S.schoolLinks||[]).filter(x=>myRows().some(r=>r.school===x.school)).sort((a,b)=>a.school.localeCompare(b.school,'ko')).map(x=>`<tr><td class="nowrap">${esc(x.school)}</td><td class="mono small" style="word-break:break-all">${esc(x.link||'(웹앱 주소가 정해지면 생성)')}</td><td class="nowrap">${x.link?`<button class="btn sm" data-act="copytext" data-t="${esc(x.link)}">복사</button> `:''}<button class="btn sm" data-act="regen" data-s="${esc(x.school)}">새 링크</button></td></tr>`).join('')}</tbody></table></div></details></div>`; }""")
rep("  else if(t.id==='retention') S.retention=t.value;","  else if(t.id==='retention') S.retention=t.value;\n  else if(t.id==='webAppUrl') S.webAppUrl=t.value.trim();")
rep("function goView(v){ location.hash=v; }","function goView(v){ S.ui.view=v; }")
# Apps Script strips text after // inside template literals when serving; escape URL slashes (same runtime value)
js=js.replace('://', ':' + chr(92) + '/' + chr(92) + '/')
a=js.index("async function saveBinaryBuf(buf,filename,msg){"); b=js.index("\n}\n",a)+3
js=js[:a]+"async function saveBinaryBuf(buf,filename,msg){ downloadBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),filename,msg); }\n"+js[b:]
# 안전 검사: 앱스 스크립트가 // 뒤를 잘라내는 문제를 막기 위해 코드 안에 // 가 남아 있으면 빌드를 멈춤
bad=[i+1 for i,l in enumerate(js.split('\n')) if '//' in l and not l.strip().startswith('//')]
assert not bad, 'Lib에 // 가 남아 있습니다: 줄 '+str(bad[:10])
lib='<script>\n'+js+'\n</script>\n'
open(__import__('os').path.join(__import__('os').environ.get('GAS_OUT','../gas'),'Lib.html'),'w').write(lib)
style=style.replace("nav.tabs a{","nav.tabs .tabbtn{border:0;background:none;font:inherit;cursor:pointer;").replace("nav.tabs a.on{","nav.tabs .tabbtn.on{")
open(__import__('os').path.join(__import__('os').environ.get('GAS_OUT','../gas'),'Styles.html'),'w').write(style+'\n')
print(len(lib), 'location.hash' in js, 'SEED' in js, 'freshState' in js, 'demoSeed' in js, 'S.demo' in js)
