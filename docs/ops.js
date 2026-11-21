/* 확정 운영 목록(엑셀) → 학교·기관별 운영 현황과 강사 기준정보 */
(function (root) {
  'use strict';
  function norm(s) { return String(s == null ? '' : s).replace(/\s/g, ''); }
  function parseDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    var m = String(v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
  }
  function phones(s) {
    var out = [], re = /01\d[\s.-]?\d{3,4}[\s.-]?\d{4}|0\d{1,2}[\s.-]\d{3,4}[\s.-]\d{4}|0[2-9]\d{8,9}(?!\d)/g, m;
    while ((m = re.exec(String(s || '')))) { var d = m[0].replace(/\D/g, ''), a = /^02/.test(d) ? 2 : 3; d = d.slice(0, a) + '-' + d.slice(a, d.length - 4) + '-' + d.slice(-4); if (out.indexOf(d) < 0) out.push(d); }
    return out;
  }
  function emailOf(s) { var m = String(s || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/); return m ? m[0] : ''; }
  var STOP = { '배치': 1, '예정': 1, '미정': 1, '중복': 1, '해당': 1, '없음': 1, '학교': 1, '변경': 1, '확인': 1, '대학교지급': 1, '동물': 1, '식물': 1, '구인': 1, '구인중': 1, '모집': 1, '모집중': 1, '공석': 1 };
  // 이름 칸: "홍길동" 이면 깔끔, "1. 홍길동\n2. 김철수", "A->B", "(18일만)" 등은 확인 필요
  function namesIn(cell) {
    var s = String(cell || '').trim();
    if (!s || s === '-' || /^x$/i.test(s)) return { names: [], clean: true };
    var clean = /^[가-힣]{2,4}$/.test(s);
    var t = s.replace(/\([^)]*\)/g, ' ').replace(/[가-힣0-9]+\s*:/g, ' ').replace(/\d+\./g, ' ');
    var names = (t.match(/[가-힣]{2,4}/g) || []).filter(function (n) { return !STOP[n]; });
    return { names: names.filter(function (n, i) { return names.indexOf(n) === i; }), clean: clean };
  }

  // 「천안구성초」 → 「천안구성초등학교」 (공문에는 정식 학교명)
  function fullSchool(s) {
    s = String(s || '').replace(/\s+/g, '').replace(/\(.*?\)$/, '');
    if (/[가-힣]초$/.test(s) && s.length >= 3) return s + '등학교';
    if (/[가-힣]중$/.test(s) && s.length >= 3) return s + '학교';
    return s;
  }
  // 「김다솜 실무사」「이정옥 선생님」 → 이름만
  function contactName(s) {
    var t = String(s || '').split(/[\n,/]/)[0].replace(/\(.*?\)/g, '').trim();
    t = t.replace(/\s*(실무사|실무원|선생님|교사|부장|교감|교무|주무관|담당자?|님)\s*$/g, '').trim();
    return /^[가-힣]{2,4}$/.test(t.replace(/\s/g, '')) ? t.replace(/\s/g, '') : t;
  }
  // 머리글 찾기: 강사명(또는 주강사)이 있는 줄
  function findHeader(aoa) {
    for (var i = 0; i < Math.min(aoa.length, 15); i++) {
      var h = (aoa[i] || []).map(norm);
      if (h.some(function (x) { return x === '강사명' || x === '주강사' || x === '주강사명'; }) && h.some(function (x) { return /프로그램/.test(x); })) return i;
    }
    return -1;
  }
  // aoa: 시트 2차원 배열 → 수업 줄 목록
  function parseSheet(aoa, src) {
    var hi = findHeader(aoa);
    if (hi < 0) return null;
    var h = aoa[hi].map(norm), i, j;
    function col(test) { for (var k = 0; k < h.length; k++) if (test(h[k])) return k; return -1; }
    var c = {
      school: [/^학교명/, /^기관명/, /^(학교\/기관|학교·기관)/, /^학교$/, /^기관$/].reduce(function (f, re) { return f >= 0 ? f : col(function (x) { return re.test(x); }); }, -1),
      sigi: col(function (x) { return x === '시기' || x === '학기' || x === '운영시기'; }),
      program: col(function (x) { return x === '프로그램명' || x === '프로그램'; }),
      field: col(function (x) { return x === '분야' || x === '프로그램분야' || x === '영역'; }),
      grade: col(function (x) { return x === '학년' || x === '대상' || x === '교육대상'; }),
      total: col(function (x) { return /^총차시/.test(x); }),
      start: col(function (x) { return x === '시작일' || x === '운영시작일' || x === '개강일'; }),
      end: col(function (x) { return x === '종료일' || x === '운영종료일' || x === '종강일'; }),
      main: col(function (x) { return x === '강사명' || x === '주강사' || x === '주강사명'; }),
      cName: col(function (x) { return /담당/.test(x) && !/(연락|전화|메일|이메일|e-?mail|휴대)/i.test(x); }),
      cTel: col(function (x) { return /담당/.test(x) && /(연락|전화|휴대)/.test(x); }),
      cMail: col(function (x) { return /담당/.test(x) && /(메일|e-?mail)/i.test(x); }),
      org: col(function (x) { return x === '운영기관' || x === '운영대학'; })
    };
    // 「담당자 | 휴대폰번호 | 이메일」처럼 담당자 바로 뒤에 붙은 연락처·이메일
    if (c.cName >= 0) {
      for (var d0 = 1; d0 <= 3; d0++) { var hx = h[c.cName + d0]; if (hx == null) break;
        if (c.cTel < 0 && /(연락|전화|휴대)/.test(hx)) c.cTel = c.cName + d0;
        else if (c.cMail < 0 && /메일/.test(hx)) c.cMail = c.cName + d0;
        if (/프로그램|강사/.test(hx)) break; }
    }
    if (c.program < 0) c.program = col(function (x) { return /프로그램/.test(x); });
    var auxCols = []; for (j = 0; j < h.length; j++) if (h[j] === '보조강사' || h[j] === '보조강사명') auxCols.push(j);
    // 강사명 바로 뒤의 연락처·이메일 칸
    function near(k, test) { for (var d = 1; d <= 3; d++) { var x = h[k + d]; if (x == null) break; if (test(x)) return k + d; if (x === '보조강사' || x === '강사명') break; } return -1; }
    var mTel = c.main >= 0 ? near(c.main, function (x) { return /연락|전화|휴대/.test(x); }) : -1;
    var mMail = c.main >= 0 ? near(c.main, function (x) { return /메일/.test(x); }) : -1;
    var out = [], lastSchool = '';
    for (i = hi + 1; i < aoa.length; i++) {
      var r = aoa[i] || [], g = function (k) { return k < 0 || r[k] == null ? '' : String(r[k]).trim(); };
      if (!g(c.program) && !g(c.main)) continue;
      var school = fullSchool(g(c.school)) || lastSchool; lastSchool = school;
      var row = { src: src, school: school, sigi: g(c.sigi), program: g(c.program).replace(/\s+/g, ' '), field: g(c.field), grade: g(c.grade), total: g(c.total),
        start: parseDate(r[c.start]), end: parseDate(r[c.end]), contact: { name: contactName(g(c.cName)), tel: phones(g(c.cTel))[0] || '', email: emailOf(g(c.cMail)) }, org: g(c.org), schoolRaw: g(c.school).replace(/\s+/g, ''), people: [], open: [] };
      // 「배치 예정」「미정」「구인 중」처럼 아직 강사가 정해지지 않은 자리
      var OPEN = /배치\s*예정|미정|구인|모집|공석|섭외/;
      if (OPEN.test(g(c.main))) row.open.push('주강사');
      var mn = namesIn(g(c.main)), mt = phones(mTel >= 0 ? g(mTel) : g(c.main + 1)), me = emailOf(mMail >= 0 ? g(mMail) : g(c.main + 2));
      mn.names.forEach(function (n, k) { row.people.push({ name: n, role: '주강사', tel: mn.clean ? mt[0] || '' : (mn.names.length === mt.length ? mt[k] : ''), email: mn.clean ? me : '', flagged: !mn.clean }); });
      auxCols.forEach(function (ac) {
        var an = namesIn(g(ac)), at = phones(g(ac + 1));
        if (OPEN.test(g(ac))) row.open.push('보조강사');
        an.names.forEach(function (n, k) { row.people.push({ name: n, role: '보조강사', tel: an.names.length === at.length ? at[k] : (an.clean ? at[0] || '' : ''), email: '', flagged: !an.clean && an.names.length !== at.length }); });
      });
      if (row.school || row.program) out.push(row);
    }
    return out;
  }
  // wb: SheetJS 통합문서. 「호서대」가 들어간 시트가 있으면 그 시트만, 없으면 머리글이 맞는 모든 시트
  // 시트마다 읽어 둔다. 처음에 쓸 시트: 「호서대」가 들어간 시트(없으면 전부). 「새로나」 시트는 뺀다
  function parseWorkbook(XLSX, wb, fileName) {
    var names = wb.SheetNames.filter(function (n) { return !/새로나/.test(n); });
    var base = (fileName || '').replace(/\.(xlsx|xlsm|xls)$/i, ''), rows = [], used = [], skipped = [], sheets = [];
    names.forEach(function (n) {
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      var r = parseSheet(aoa, base + ' · ' + n);
      if (r && r.length) { r.forEach(function (x) { x.sheet = n; }); rows = rows.concat(r); used.push(n); sheets.push({ name: n, count: r.length }); } else skipped.push(n);
    });
    return { rows: rows, used: used, skipped: skipped, sheets: sheets, defaultOn: defaultOn(used) };
  }

  // 처음에 쓸 시트: 이름이 정확히 「호서대」인 시트, 없으면 「호서대」가 들어간 시트(모니터링·강사료 등 파생 탭 제외), 그것도 없으면 전부
  function defaultOn(names) {
    var exact = names.filter(function (n) { return norm(n) === '호서대'; });
    if (exact.length) return exact;
    var hs = names.filter(function (n) { return /호서대/.test(n) && !/모니터링|확인|강사료|컨설팅|피봇|연락처/.test(n); });
    return hs.length ? hs : names;
  }
  // 학교·기관별 모음
  function bySchool(rows) {
    var map = {};
    rows.forEach(function (r) {
      var s = r.school || '(학교명 없음)', o = map[s] = map[s] || { school: s, rows: [], people: {}, contact: { name: '', tel: '', email: '' }, fields: [] };
      o.rows.push(r);
      if (r.field && o.fields.indexOf(r.field) < 0) o.fields.push(r.field);
      ['name', 'tel', 'email'].forEach(function (k) { if (r.contact && r.contact[k] && !o.contact[k]) o.contact[k] = r.contact[k]; });
      r.people.forEach(function (p) { var q = o.people[p.name] = o.people[p.name] || { name: p.name, roles: [], flagged: false }; if (q.roles.indexOf(p.role) < 0) q.roles.push(p.role); if (p.flagged) q.flagged = true; });
    });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).map(function (k) { return map[k]; });
  }
  // 강사별 모음: [{name, role, tels[], emails[], schools[], classes:[row], flagged}]
  function byPerson(rows) {
    var map = {};
    rows.forEach(function (r) { r.people.forEach(function (p) {
      var o = map[p.name] = map[p.name] || { name: p.name, roles: [], tels: [], emails: [], schools: [], classes: [], flagged: false };
      if (o.roles.indexOf(p.role) < 0) o.roles.push(p.role);
      if (p.tel && o.tels.indexOf(p.tel) < 0) o.tels.push(p.tel);
      if (p.email && o.emails.indexOf(p.email) < 0) o.emails.push(p.email);
      if (r.school && o.schools.indexOf(r.school) < 0) o.schools.push(r.school);
      o.classes.push({ school: r.school, sigi: r.sigi, program: r.program, field: r.field, grade: r.grade, start: r.start, end: r.end, role: p.role, src: r.src });
      if (p.flagged) o.flagged = true;
    }); });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).map(function (k) { var o = map[k]; o.role = o.roles.indexOf('주강사') >= 0 ? '주강사' : '보조강사'; return o; });
  }
  function programText(classes, school) {
    var seen = [];
    classes.forEach(function (c) { if (school && c.school !== school) return; var t = (c.field ? '[' + c.field + '] ' : '') + c.program; if (c.program && seen.indexOf(t) < 0) seen.push(t); });
    return seen.join(', ');
  }
  // 날짜 표기: 2027. 1. 6.
  function dot(iso) { if (!iso) return ''; var p = iso.split('-'); return p[0] + '. ' + (+p[1]) + '. ' + (+p[2]) + '.'; }
  function period(classes) {
    var s = classes.map(function (c) { return c.start; }).filter(Boolean).sort()[0] || '', e = classes.map(function (c) { return c.end; }).filter(Boolean).sort().pop() || '';
    return s || e ? dot(s) + '~' + dot(e) : '';
  }

  var api = { fullSchool: fullSchool, contactName: contactName, parseSheet: parseSheet, parseWorkbook: parseWorkbook, bySchool: bySchool, byPerson: byPerson, programText: programText, period: period, phones: phones, emailOf: emailOf, parseDate: parseDate, namesIn: namesIn, norm: norm, defaultOn: defaultOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Ops = api;
})(typeof self !== 'undefined' ? self : this);
