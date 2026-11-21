/* 경력증명서·출강증명서: 한글(HWP 5.0) 빈 양식의 칸 글자만 바꿔 넣는다. 표·서식은 원본 그대로 */
(function (root) {
  'use strict';
  var T = { PARA_HEADER: 66, PARA_TEXT: 67, PARA_CHAR_SHAPE: 68, PARA_LINE_SEG: 69, LIST_HEADER: 72, TABLE: 77 };
  /* ---------- HWP 레코드 ---------- */
  function parseRecords(buf) {
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), recs = [], p = 0;
    while (p < buf.length) {
      var hd = dv.getUint32(p, true); p += 4;
      var size = hd >>> 20, tag = hd & 0x3ff, level = (hd >>> 10) & 0x3ff;
      if (size === 0xfff) { size = dv.getUint32(p, true); p += 4; }
      recs.push({ tag: tag, level: level, data: buf.slice(p, p + size) }); p += size;
    }
    return recs;
  }
  function buildRecords(recs) {
    var total = 0; recs.forEach(function (r) { total += r.data.length + (r.data.length >= 0xfff ? 8 : 4); });
    var out = new Uint8Array(total), dv = new DataView(out.buffer), p = 0;
    recs.forEach(function (r) {
      var n = r.data.length;
      dv.setUint32(p, (r.tag | (r.level << 10) | (Math.min(n, 0xfff) << 20)) >>> 0, true); p += 4;
      if (n >= 0xfff) { dv.setUint32(p, n, true); p += 4; }
      out.set(r.data, p); p += n;
    });
    return out;
  }
  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }
  function w16(d, o, v) { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; }
  function w32(d, o, v) { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; d[o + 2] = (v >>> 16) & 255; d[o + 3] = (v >>> 24) & 255; }
  var INLINE = [0, 24, 25, 26, 27, 28, 29, 30, 31];
  function indexParagraphs(recs) {
    var paras = [], tableNo = -1, cell = null, cellLevel = -1;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.tag === T.TABLE) tableNo++;
      if (r.tag === T.LIST_HEADER && r.data.length >= 26) { cell = { table: tableNo, col: u16(r.data, 8), row: u16(r.data, 10), n: 0 }; cellLevel = r.level; }
      if (r.tag !== T.PARA_HEADER) continue;
      if (cell && r.level < cellLevel) cell = null;
      var text = '', hasCtrl = false, ti = -1, ci = -1, li = -1;
      for (var j = i + 1; j < recs.length && recs[j].level > r.level; j++) {
        if (recs[j].level !== r.level + 1) continue;
        if (recs[j].tag === T.PARA_TEXT) {
          ti = j; var d = recs[j].data;
          for (var k = 0; k + 1 < d.length; k += 2) {
            var ch = u16(d, k);
            if (ch < 32 && ch !== 13 && ch !== 10 && ch !== 9) { hasCtrl = true; if (INLINE.indexOf(ch) < 0) k += 14; }
            else if (ch !== 13) text += String.fromCharCode(ch);
          }
        }
        if (recs[j].tag === T.PARA_CHAR_SHAPE) ci = j;
        if (recs[j].tag === T.PARA_LINE_SEG) li = j;
      }
      paras.push({ i: i, ti: ti, ci: ci, li: li, text: text, hasCtrl: hasCtrl, level: r.level, cell: cell ? { table: cell.table, row: cell.row, col: cell.col, n: cell.n++ } : null });
    }
    return paras;
  }
  function setText(recs, para, text, dropLineSeg) {
    if (para.hasCtrl) throw new Error('수정할 수 없는 문단입니다: ' + para.text);
    var hdr = recs[para.i].data, n = text.length + 1, ops = [];
    w32(hdr, 0, ((u32(hdr, 0) & 0x80000000) | n) >>> 0);
    var td = new Uint8Array(n * 2);
    for (var k = 0; k < text.length; k++) w16(td, k * 2, text.charCodeAt(k));
    w16(td, text.length * 2, 13);
    if (para.ci >= 0) { var cs = recs[para.ci]; cs.data = cs.data.slice(0, 8); w32(cs.data, 0, 0); w16(hdr, 12, 1); }
    if (para.ti >= 0) recs[para.ti].data = td; else ops.push({ at: para.i + 1, ins: { tag: T.PARA_TEXT, level: para.level + 1, data: td } });
    if (dropLineSeg && para.li >= 0) { w16(hdr, 16, 0); ops.push({ at: para.li, del: true }); }
    return ops;
  }
  function cellp(t, r, c, n) { n = n || 0; return function (p) { return p.cell && p.cell.table === t && p.cell.row === r && p.cell.col === c && p.cell.n === n; }; }

  // d: {kind:'경력'|'출강', docNo, name, birth, address, period, rows[], issueDate, project1, project2, org, staffLine, staffTel, headTitle, headName}
  function certEdits(d) {
    var e = [
      { name: '문서번호', find: function (p) { return p.text.indexOf('문서번호') === 0; }, text: '문서번호 ' + d.docNo },
      { name: '성명', find: cellp(0, 0, 2), text: d.name }, { name: '생년월일', find: cellp(0, 0, 4), text: d.birth },
      { name: '주소', find: cellp(0, 1, 2), text: d.address },
      { name: '구분', find: cellp(0, 2, 0), text: d.kind + '사항' },
      { name: '사업명1', find: cellp(0, 2, 2, 0), text: d.project1 }, { name: '사업명2', find: cellp(0, 2, 2, 1), text: d.project2 },
      { name: '근무기간', find: cellp(0, 3, 2), text: d.period },
      { name: '발급일', find: function (p) { return !p.cell && /^\d{4}년 \d+월 \d+일$/.test(p.text); }, text: d.issueDate },
      { name: '소속', find: cellp(1, 1, 0, 0), text: d.org }, { name: '담당자', find: cellp(1, 1, 0, 1), text: d.staffLine },
      { name: '문의', find: cellp(1, 1, 0, 2), text: '(문의. ' + d.staffTel + ')' },
      { name: '센터장직함', find: cellp(2, 0, 0, 1), text: d.headTitle }, { name: '센터장', find: cellp(2, 0, 0, 2), text: d.headName + ' (인)' }
    ];
    var rows = d.rows.map(function (r) { return [r.place, r.program, r.target, r.role, r.hours]; });
    if (rows.length > 5) throw new Error('한 장에는 실적을 5줄까지 넣을 수 있습니다.');
    if (rows.length < 5) rows.push(['이하 여백']);
    // 프로그램명: 「[분야] 이름」이면 첫째 줄 분야, 둘째 줄 이름 (칸 안 줄바꿈 = 문자 10)
    function prog(v) { var m = String(v).match(/^\s*(\[[^\]]*\])\s*(.+)$/); return m ? m[1] + '\n' + m[2] : String(v); }
    rows.forEach(function (r, i) { r.forEach(function (v, j) { if (v) e.push({ name: '실적' + (i + 1), find: cellp(0, 5 + i, 1 + j), text: j === 1 ? prog(v) : String(v) }); }); });
    return e;
  }
  // deps: {CFB, pako}. template: Uint8Array. 반환: Uint8Array(.hwp)
  function fillHwp(deps, template, edits, dropLineSeg) {
    var cfb = deps.CFB.read(template, { type: 'array' });
    var sec = deps.CFB.find(cfb, '/BodyText/Section0');
    var recs = parseRecords(deps.pako.inflateRaw(new Uint8Array(sec.content)));
    var paras = indexParagraphs(recs), ops = [];
    edits.forEach(function (e) {
      var p = paras.filter(e.find)[0];
      if (!p) throw new Error('양식에서 "' + e.name + '" 칸을 찾지 못했습니다.');
      if (p.text === e.text) return;
      ops = ops.concat(setText(recs, p, e.text, dropLineSeg || e.text.indexOf('\n') >= 0));   // 칸 안 줄바꿈은 늘 다시 계산
    });
    ops.sort(function (a, b) { return b.at - a.at || (a.del ? -1 : 1); });
    ops.forEach(function (o) { if (o.del) recs.splice(o.at, 1); else recs.splice(o.at, 0, o.ins); });
    var packed = deps.pako.deflateRaw(buildRecords(recs));
    sec.content = packed; sec.size = packed.length;
    // 미리보기 텍스트도 맞춰 둠
    var prv = deps.CFB.find(cfb, '/PrvText');
    if (prv) { var txt = indexParagraphs(recs).map(function (p) { return p.text; }).filter(Boolean).join('\r\n'); var pb = new Uint8Array(txt.length * 2); for (var k = 0; k < txt.length; k++) w16(pb, k * 2, txt.charCodeAt(k)); prv.content = pb; prv.size = pb.length; }
    return new Uint8Array(deps.CFB.write(cfb, { type: 'array' }));
  }

  function b64ToBytes(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  var api = { certEdits: certEdits, fillHwp: fillHwp, b64ToBytes: b64ToBytes, indexParagraphs: indexParagraphs, parseRecords: parseRecords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Certs = api;
})(typeof self !== 'undefined' ? self : this);
