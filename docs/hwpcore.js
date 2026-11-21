/* 강사서류 HWP 엔진: HWP 5.0 문단 글자 바꾸기 + 그림(서명/사진) 넣기 */
(function (root) {
  'use strict';
  var T = { BIN_DATA: 18, ID_MAPPINGS: 17, PARA_SHAPE: 25, CHAR_SHAPE: 21, PARA_HEADER: 66, PARA_TEXT: 67, PARA_CHAR_SHAPE: 68, PARA_LINE_SEG: 69, PARA_RANGE_TAG: 70, CTRL_HEADER: 71, LIST_HEADER: 72, TABLE: 77, SHAPE_COMPONENT: 76, SHAPE_PICTURE: 85 };
  var HU_PER_MM = 7200 / 25.4;

  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }
  function i32(d, o) { return u32(d, o) | 0; }
  function w16(d, o, v) { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; }
  function w32(d, o, v) { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; d[o + 2] = (v >>> 16) & 255; d[o + 3] = (v >>> 24) & 255; }

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

  // 글자 코드 배열(u16) <-> 보이는 글자 (확장 제어문자는 8칸)
  var EXT = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 11: 1, 12: 1, 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 23: 1 };
  function codesOf(d) { var a = []; for (var k = 0; k + 1 < d.length; k += 2) a.push(u16(d, k)); return a; }
  // visible: 보이는 문자열, map[i] = visible i 번째 글자의 코드 위치
  function visibleOf(codes) {
    var s = '', map = [];
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      if (c === 13) continue;
      if (EXT[c]) { if (c === 9) { s += '\t'; map.push(i); } i += 7; continue; }
      if (c < 32 && c !== 10) continue;
      s += String.fromCharCode(c); map.push(i);
    }
    return { s: s, map: map };
  }

  function Doc(deps, bytes) {
    this.deps = deps;
    this.cfb = deps.CFB.read(bytes, { type: 'array' });
    var fh = new Uint8Array(deps.CFB.find(this.cfb, '/FileHeader').content);
    this.compressed = (u32(fh, 36) & 1) === 1;
    this.docInfo = parseRecords(this._read('/DocInfo'));
    this.recs = parseRecords(this._read('/BodyText/Section0'));
    this.reindex();
  }
  Doc.prototype._read = function (path) {
    var e = this.deps.CFB.find(this.cfb, path), d = new Uint8Array(e.content);
    return this.compressed ? this.deps.pako.inflateRaw(d) : d;
  };
  Doc.prototype._write = function (path, data) {
    var e = this.deps.CFB.find(this.cfb, path), d = this.compressed ? this.deps.pako.deflateRaw(data) : data;
    e.content = d; e.size = d.length;
  };

  // 문단 목록 + 표 셀 정보
  Doc.prototype.reindex = function () {
    var recs = this.recs, paras = [], tableNo = -1, cellStack = [];
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      while (cellStack.length && r.level < cellStack[cellStack.length - 1].level) cellStack.pop();
      if (r.tag === T.TABLE) tableNo++;
      if (r.tag === T.LIST_HEADER && r.data.length >= 34) {
        // 같은 깊이의 이전 셀은 닫는다
        while (cellStack.length && cellStack[cellStack.length - 1].level >= r.level) cellStack.pop();
        var d = r.data;
        cellStack.push({ level: r.level, table: tableNo, col: u16(d, 8), row: u16(d, 10), w: u32(d, 16), h: u32(d, 20), n: 0 });
      }
      if (r.tag !== T.PARA_HEADER) continue;
      var info = { i: i, level: r.level, ti: -1, ci: -1, li: -1, ri: -1, end: i + 1 };
      for (var j = i + 1; j < recs.length && recs[j].level > r.level; j++) {
        if (recs[j].level === r.level + 1) {
          if (recs[j].tag === T.PARA_TEXT) info.ti = j;
          if (recs[j].tag === T.PARA_CHAR_SHAPE) info.ci = j;
          if (recs[j].tag === T.PARA_LINE_SEG) info.li = j;
          if (recs[j].tag === T.PARA_RANGE_TAG) info.ri = j;
        }
        info.end = j + 1;
      }
      var codes = info.ti >= 0 ? codesOf(recs[info.ti].data) : [13];
      var v = visibleOf(codes);
      info.codes = codes; info.text = v.s; info.map = v.map;
      info.ps = u16(r.data, 8);
      var c = cellStack.length ? cellStack[cellStack.length - 1] : null;
      info.cell = c && c.level === r.level ? { table: c.table, row: c.row, col: c.col, n: c.n++, w: c.w, h: c.h } : null;
      info.idx = paras.length;
      paras.push(info);
    }
    this.paras = paras;
  };

  // 문단의 코드 위치 from..to(끝 제외)를 newCodes 로 바꾼다
  Doc.prototype._splice = function (p, from, to, newCodes, extraMask) {
    var recs = this.recs, codes = p.codes.slice(), delta = newCodes.length - (to - from);
    Array.prototype.splice.apply(codes, [from, to - from].concat(newCodes));
    if (codes[codes.length - 1] !== 13) codes.push(13);
    var td = new Uint8Array(codes.length * 2);
    for (var k = 0; k < codes.length; k++) w16(td, k * 2, codes[k]);
    var hdr = recs[p.i].data;
    w32(hdr, 0, ((u32(hdr, 0) & 0x80000000) | codes.length) >>> 0);
    if (extraMask) w32(hdr, 4, (u32(hdr, 4) | extraMask) >>> 0);
    function shift(pos) { return pos >= to ? pos + delta : (pos > from ? from : pos); }
    var ins = 0;
    // 한글은 문단 끝 글자만 있는 빈 문단에는 PARA_TEXT 를 두지 않는다
    if (codes.length === 1) { if (p.ti >= 0) { recs.splice(p.ti, 1); ins = -1; } }
    else if (p.ti >= 0) recs[p.ti].data = td;
    else { recs.splice(p.i + 1, 0, { tag: T.PARA_TEXT, level: p.level + 1, data: td }); ins = 1; }
    var ci = p.ci >= 0 ? p.ci + ins : -1, li = p.li >= 0 ? p.li + ins : -1, ri = p.ri >= 0 ? p.ri + ins : -1;
    if (ci >= 0) {
      var cs = recs[ci].data, out = [], last = -1;
      for (var o = 0; o + 8 <= cs.length; o += 8) {
        var pos = o === 0 ? 0 : shift(u32(cs, o)), id = u32(cs, o + 4);
        if (out.length && out[out.length - 1][0] === pos) out[out.length - 1][1] = id; else out.push([pos, id]);
      }
      var nd = new Uint8Array(out.length * 8);
      out.forEach(function (x, n) { w32(nd, n * 8, x[0]); w32(nd, n * 8 + 4, x[1]); });
      recs[ci].data = nd; w16(hdr, 12, out.length);
    }
    if (li >= 0) {
      var ls = recs[li].data, segs = [];
      for (var q = 0; q + 36 <= ls.length; q += 36) {
        var s = ls.slice(q, q + 36), sp = q === 0 ? 0 : shift(u32(s, 0));
        if (q > 0 && (sp >= codes.length - 1 || sp <= u32(segs[segs.length - 1], 0))) continue;
        w32(s, 0, sp); segs.push(s);
      }
      var ld = new Uint8Array(segs.length * 36); segs.forEach(function (s, n) { ld.set(s, n * 36); });
      recs[li].data = ld; w16(hdr, 16, segs.length);
    }
    if (ri >= 0) {
      var rt = recs[ri].data;
      for (var z = 0; z + 12 <= rt.length; z += 12) { w32(rt, z, shift(u32(rt, z))); w32(rt, z + 4, shift(u32(rt, z + 4))); }
    }
    this.reindex();
  };
  function codesFromString(s) { var a = []; for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i) === 10 ? 10 : s.charCodeAt(i)); return a; }

  // 보이는 글자 기준 바꾸기: 첫 번째 oldStr 을 newStr 로
  Doc.prototype.replaceIn = function (p, oldStr, newStr) {
    var at = p.text.indexOf(oldStr);
    if (at < 0) throw new Error('"' + oldStr + '" 글자를 찾지 못했습니다: ' + p.text);
    var from = p.map[at], to = oldStr.length ? p.map[at + oldStr.length - 1] + 1 : from;
    this._splice(p, from, to, codesFromString(newStr));
  };
  // 문단 글자 전체 바꾸기(제어문자는 남김)
  Doc.prototype.setText = function (p, newStr) {
    if (!p.text.length) { var endPos = p.codes.length - 1; this._splice(p, endPos, endPos, codesFromString(newStr)); return; }
    this.replaceIn(p, p.text, newStr);
  };
  // 보이는 글자 at 위치에 끼워넣기
  Doc.prototype.insertAt = function (p, at, s) {
    var pos = at >= p.text.length ? p.codes.length - 1 : p.map[at];
    this._splice(p, pos, pos, codesFromString(s));
  };

  /* ---------- 그림 ---------- */
  Doc.prototype._addBin = function (bytes, ext) {
    var di = this.docInfo, idm = di.filter(function (r) { return r.tag === T.ID_MAPPINGS; })[0];
    var count = u32(idm.data, 0) + 1; w32(idm.data, 0, count);
    // 그림이 가리키는 번호 = BIN_DATA 순서(count), 저장 이름 번호 = 기존 번호 중 가장 큰 것 + 1
    var maxId = 0; di.forEach(function (r) { if (r.tag === T.BIN_DATA && r.data.length >= 4) maxId = Math.max(maxId, u16(r.data, 2)); });
    var sid = Math.max(count, maxId + 1);
    var bd = new Uint8Array(6 + ext.length * 2);
    w16(bd, 0, 0x0021); w16(bd, 2, sid); w16(bd, 4, ext.length);
    for (var k = 0; k < ext.length; k++) w16(bd, 6 + k * 2, ext.charCodeAt(k));
    var last = -1; di.forEach(function (r, n) { if (r.tag === T.BIN_DATA || r.tag === T.ID_MAPPINGS) last = n; });
    // BIN_DATA 는 ID_MAPPINGS 아래 한 단계(level 1). 한글은 단계가 틀리면 「손상된 파일」로 본다
    var lvl = idm.level + 1; di.forEach(function (r) { if (r.tag === T.BIN_DATA) lvl = r.level; });
    di.splice(last + 1, 0, { tag: T.BIN_DATA, level: lvl, data: bd });
    var name = 'BIN' + ('000' + sid.toString(16).toUpperCase()).slice(-4) + '.' + ext;
    this.deps.CFB.utils.cfb_add(this.cfb, '/BinData/' + name, bytes);
    return count;
  };
  // opt: {w,h (mm), x,y (mm, 문단 기준), inline:bool, at: 보이는 글자 위치(기본 끝), pxW, pxH, bytes, ext}
  Doc.prototype.addPicture = function (p, opt) {
    var binId = this._addBin(opt.bytes, opt.ext || 'png');
    var W = Math.round(opt.w * HU_PER_MM), H = Math.round(opt.h * HU_PER_MM);
    var X = Math.round((opt.x || 0) * HU_PER_MM), Y = Math.round((opt.y || 0) * HU_PER_MM);
    var oW = Math.round((opt.pxW || 100) * 75), oH = Math.round((opt.pxH || 100) * 75);
    var inst = (0x10000000 + Math.floor(Math.random() * 0x0fffffff)) >>> 0;
    var attr = opt.inline
      ? 0x042a2211 // 한글이 이력서 사진 칸에 넣은 글자처럼 취급 그림과 같은 속성(겹침 없음, 위아래 배치)
      : 0x444a2210; // 기존 양식의 서명 그림과 같은 배치 속성(문단 기준 세로, 단 기준 가로)
    // CTRL_HEADER gso
    var ch = new Uint8Array(46);
    w32(ch, 0, 0x67736f20); w32(ch, 4, attr >>> 0); w32(ch, 8, Y); w32(ch, 12, X); w32(ch, 16, W); w32(ch, 20, H);
    w32(ch, 24, 10 + binId); // z-order
    w32(ch, 36, inst); w32(ch, 40, 0); w16(ch, 44, 0);
    // SHAPE_COMPONENT — 한글이 만든 그림과 같은 구조: 처음 크기 = 원본, 지금 크기 = 표시 크기, 확대 행렬 = 표시/원본
    var sc = new Uint8Array(196), dv = new DataView(sc.buffer);
    w32(sc, 0, 0x24706963); w32(sc, 4, 0x24706963); // '$pic' (바이트: 63 69 70 24)
    w32(sc, 8, 0); w32(sc, 12, 0); w16(sc, 16, 0); w16(sc, 18, 1);
    w32(sc, 20, oW); w32(sc, 24, oH); w32(sc, 28, W); w32(sc, 32, H); w32(sc, 36, 0x24080000 >>> 0);
    w16(sc, 40, 0); w32(sc, 42, W >> 1); w32(sc, 46, H >> 1); w16(sc, 50, 1);
    function mat(off, a, b, c, d, e, f) { [a, b, c, d, e, f].forEach(function (v, n) { dv.setFloat64(off + n * 8, v, true); }); }
    mat(52, 1, 0, 0, 0, 1, 0); mat(100, W / oW, 0, 0, 0, H / oH, 0); mat(148, 1, 0, 0, 0, 1, 0);
    // SHAPE_COMPONENT_PICTURE
    var pc = new Uint8Array(91);
    [[0, 0], [oW, 0], [oW, oH], [0, oH]].forEach(function (pt, n) { w32(pc, 12 + n * 8, pt[0]); w32(pc, 16 + n * 8, pt[1]); });
    w32(pc, 44, 0); w32(pc, 48, 0); w32(pc, 52, oW); w32(pc, 56, oH);
    w16(pc, 71, binId); pc[73] = 0; w32(pc, 74, (inst + 1) >>> 0); w32(pc, 78, 0); w32(pc, 82, oW); w32(pc, 86, oH); pc[90] = 0;
    // 문단 글자에 gso 자리 넣기
    var at = opt.at == null ? p.text.length : opt.at;
    var pos = at >= p.text.length ? p.codes.length - 1 : p.map[at];
    var ctrlCodes = [11, 0x6f20, 0x6773, 0, 0, 0, 0, 11];
    // 새 컨트롤의 레코드 위치: 문단 안에서 pos 이전에 있는 컨트롤 수를 세어 그 다음
    var before = 0;
    for (var k = 0; k < pos; k++) { if (EXT[p.codes[k]]) { if (p.codes[k] !== 9 || true) before++; k += 7; } }
    var level = p.level + 1, ctrlIdx = [], j;
    for (j = p.i + 1; j < p.end; j++) if (this.recs[j].level === level && this.recs[j].tag === T.CTRL_HEADER) ctrlIdx.push(j);
    // 탭(9)은 CTRL_HEADER 가 없으므로 세지 않는다
    before = 0; for (k = 0; k < pos; k++) { var cc = p.codes[k]; if (EXT[cc]) { if (cc !== 9) before++; k += 7; } }
    var insAt = before < ctrlIdx.length ? ctrlIdx[before] : p.end;
    this.recs.splice(insAt, 0,
      { tag: T.CTRL_HEADER, level: level, data: ch },
      { tag: T.SHAPE_COMPONENT, level: level + 1, data: sc },
      { tag: T.SHAPE_PICTURE, level: level + 2, data: pc });
    this.reindex();
    this._splice(this.paras[p.idx], pos, pos, ctrlCodes, 0x800);
    // 글자처럼 취급한 그림: 줄 높이를 그림 높이에 맞춘다(한글이 저장하는 값과 같게)
    var np = this.paras[p.idx];
    if (opt.inline && np.li >= 0 && this.recs[np.li].data.length === 36) {
      var ls = this.recs[np.li].data;
      if (u32(ls, 8) < H) { w32(ls, 8, H); w32(ls, 12, H); w32(ls, 16, Math.round(H * 0.85)); }
    }
  };

  // 표 셀 안 문단 지우기 (셀의 문단 수도 줄임)
  Doc.prototype.deleteParagraph = function (p) {
    var recs = this.recs, lh = -1;
    for (var k = p.i - 1; k >= 0; k--) { if (recs[k].tag === T.LIST_HEADER && recs[k].level === p.level) { lh = k; break; } if (recs[k].level < p.level) break; }
    if (lh < 0) throw new Error('셀 문단이 아닙니다');
    var cnt = u16(recs[lh].data, 0);
    if (cnt <= 1) throw new Error('셀의 마지막 문단은 지울 수 없습니다');
    var wasLast = (u32(recs[p.i].data, 0) & 0x80000000) !== 0;
    recs.splice(p.i, p.end - p.i);
    w16(recs[lh].data, 0, cnt - 1);
    this.reindex();
    if (wasLast) {
      var prev = this.paras[p.idx - 1], hd = recs[prev.i].data;
      w32(hd, 0, (u32(hd, 0) | 0x80000000) >>> 0);
    }
  };

  // 문단 글자 모양을 다른 문단의 첫 글자 모양 하나로 통일
  Doc.prototype.copyCharShape = function (p, src) {
    var recs = this.recs;
    if (p.ci < 0 || src.ci < 0) return;
    var id = u32(recs[src.ci].data, 4), nd = new Uint8Array(8);
    w32(nd, 0, 0); w32(nd, 4, id); recs[p.ci].data = nd; w16(recs[p.i].data, 12, 1);
  };

  // 문서 안 그림 목록: [{para, binId, ext, bytes, w, h}]
  Doc.prototype.pictures = function () {
    var recs = this.recs, out = [], bins = {}, order = 0;
    // 그림의 binItemID 는 DocInfo BIN_DATA 의 순서(1부터), 저장 이름은 그 레코드 안의 번호
    this.docInfo.forEach(function (r) {
      if (r.tag !== T.BIN_DATA) return;
      order++;
      var d = r.data, type = u16(d, 0) & 0xf;
      if (type !== 1 && type !== 2) return;
      var id = u16(d, 2), n = u16(d, 4), ext = '';
      for (var k = 0; k < n; k++) ext += String.fromCharCode(u16(d, 6 + k * 2));
      bins[order] = { id: id, ext: ext.toLowerCase(), compress: (u16(d, 0) >> 4) & 3 };
    });
    var paraAt = {}; this.paras.forEach(function (p) { paraAt[p.i] = p; });
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].tag !== T.SHAPE_PICTURE || recs[i].data.length < 73) continue;
      var binId = u16(recs[i].data, 71), b = bins[binId];
      if (!b) continue;
      var para = null;
      for (var j = i - 1; j >= 0; j--) { if (recs[j].tag === T.PARA_HEADER && recs[j].level < recs[i].level - 2) { para = paraAt[j]; break; } }
      var ctrl = null; for (j = i - 1; j >= 0; j--) if (recs[j].tag === T.CTRL_HEADER) { ctrl = recs[j]; break; }
      var name = '/BinData/BIN' + ('000' + b.id.toString(16).toUpperCase()).slice(-4) + '.' + b.ext;
      var e = this.deps.CFB.find(this.cfb, name);
      if (!e) continue;
      var bytes = new Uint8Array(e.content);
      var comp = b.compress === 1 || (b.compress === 0 && this.compressed);
      if (comp) { try { bytes = this.deps.pako.inflateRaw(bytes); } catch (er) { /* 압축 안 된 그림 */ } }
      out.push({ para: para, binId: binId, ext: b.ext === 'jpeg' ? 'jpg' : b.ext, bytes: bytes,
        w: ctrl ? u32(ctrl.data, 16) / HU_PER_MM : 0, h: ctrl ? u32(ctrl.data, 20) / HU_PER_MM : 0 });
    }
    return out;
  };

  Doc.prototype.find = function (test) {
    var r = this.paras.filter(test);
    return r[0];
  };
  Doc.prototype.save = function () {
    this._write('/DocInfo', buildRecords(this.docInfo));
    this._write('/BodyText/Section0', buildRecords(this.recs));
    var prv = this.deps.CFB.find(this.cfb, '/PrvText');
    if (prv) {
      var txt = this.paras.map(function (p) { return p.text; }).filter(Boolean).join('\r\n').slice(0, 1000);
      var pb = new Uint8Array(txt.length * 2); for (var k = 0; k < txt.length; k++) w16(pb, k * 2, txt.charCodeAt(k));
      prv.content = pb; prv.size = pb.length;
    }
    return new Uint8Array(this.deps.CFB.write(this.cfb, { type: 'array', fileType: 'cfb' }));
  };

  var api = { Doc: Doc, parseRecords: parseRecords, buildRecords: buildRecords, T: T, HU_PER_MM: HU_PER_MM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HwpCore = api;
})(typeof self !== 'undefined' ? self : this);
