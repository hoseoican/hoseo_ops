/* 강사가 낸 서류(ZIP·HWP·HWPX·PDF·이미지)를 읽어 입력 칸을 미리 채운다 */
(function (root) {
  'use strict';

  /* ---------- 파일 이름 ---------- */
  function isUtf8(bytes) { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch (e) { return false; } }
  // 윈도우에서 만든 ZIP 은 한글 이름이 EUC-KR(CP949) 로 들어 있다
  function decodeName(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (isUtf8(u)) return new TextDecoder('utf-8').decode(u);
    try { return new TextDecoder('euc-kr').decode(u); } catch (e) { return new TextDecoder('utf-8').decode(u); }
  }
  function base(path) { return path.split('/').pop(); }
  function extOf(path) { var m = base(path).match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : ''; }

  /* ---------- 문서 보기(HWP·HWPX 공통): {paras:[{text, cell}], pics:[{para, ext, bytes, w, h}]} ---------- */
  function viewHwp(env, bytes) {
    var d = new env.HwpCore.Doc(env.deps, bytes);
    return { paras: d.paras.map(function (p) { return { text: p.text, cell: p.cell }; }), pics: d.pictures().map(function (p) { return { para: p.para ? { text: p.para.text, cell: p.para.cell } : null, ext: p.ext, bytes: p.bytes, w: p.w, h: p.h }; }) };
  }
  async function viewHwpx(env, bytes) {
    var zip = await env.JSZip.loadAsync(bytes), paras = [], pics = [];
    var hpf = zip.file('Contents/content.hpf') ? await zip.file('Contents/content.hpf').async('string') : '';
    var href = {}; (hpf.match(/<opf:item [^>]+>/g) || []).forEach(function (t) { var id = (t.match(/id="([^"]+)"/) || [])[1], h = (t.match(/href="([^"]+)"/) || [])[1]; if (id && h) href[id] = h; });
    var names = Object.keys(zip.files).filter(function (n) { return /^Contents\/section\d+\.xml$/.test(n); }).sort();
    var tableNo = -1;
    for (var s = 0; s < names.length; s++) {
      var xml = await zip.file(names[s]).async('string');
      var dom = new env.DOMParser().parseFromString(xml, 'text/xml');
      var visit = function (c, cell) {
        var ln = (c.localName || c.nodeName).replace(/^.*:/, '');
        if (ln === 'tbl') { tableNo++; walk(c, null); return; }
        if (ln === 'tc') {
          var addr = null; for (var a = c.firstChild; a; a = a.nextSibling) if (a.nodeType === 1 && (a.localName || a.nodeName).replace(/^.*:/, '') === 'cellAddr') addr = a;
          walk(c, { table: tableNo, row: addr ? +addr.getAttribute('rowAddr') : 0, col: addr ? +addr.getAttribute('colAddr') : 0, n: 0 });
          return;
        }
        if (ln === 'p') {
          var para = { text: '', cell: cell ? { table: cell.table, row: cell.row, col: cell.col, n: cell.n++ } : null }, txt = '';
          paras.push(para);
          var inner = function (n) {
            for (var k = n.firstChild; k; k = k.nextSibling) {
              if (k.nodeType !== 1) continue;
              var kn = (k.localName || k.nodeName).replace(/^.*:/, '');
              if (kn === 't') txt += k.textContent;
              else if (kn === 'tbl') visit(k, null);
              else if (kn === 'pic') {
                var img = k.getElementsByTagName('hc:img')[0] || k.getElementsByTagName('img')[0], sz = k.getElementsByTagName('hp:curSz')[0] || k.getElementsByTagName('curSz')[0];
                if (img) pics.push({ para: para, ref: img.getAttribute('binaryItemIDRef'), w: sz ? +sz.getAttribute('width') / (7200 / 25.4) : 0, h: sz ? +sz.getAttribute('height') / (7200 / 25.4) : 0 });
              }
              else inner(k);
            }
          };
          inner(c); para.text = txt; return;
        }
        walk(c, cell);
      };
      var walk = function (node, cell) { for (var c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) visit(c, cell); };
      walk(dom.documentElement, null);
    }
    for (var i = 0; i < pics.length; i++) {
      var h = href[pics[i].ref], f = h && zip.file(h);
      if (f) { pics[i].bytes = await f.async('uint8array'); pics[i].ext = extOf(h).replace('jpeg', 'jpg'); }
    }
    return { paras: paras, pics: pics.filter(function (p) { return p.bytes; }) };
  }

  /* ---------- 어떤 서류인지 ---------- */
  function kindOf(text, path) {
    var t = text.replace(/\s+/g, ''), n = base(path).replace(/\s+/g, '');
    if (/학력사항/.test(t) && /경력사항/.test(t)) return 'resume';
    if (/성범죄경력및아동학대관련범죄전력조회동의서/.test(t)) return 'f0';
    if (/신분증사본/.test(t) && /통장사본/.test(t)) return 'f2';
    if (/제3자제공/.test(t) && /개인정보/.test(t)) return 'f3';
    if (/청렴서약서/.test(t)) return 'f7';
    if (/부존재/.test(t)) return 'f8';
    if (/보안서약서/.test(t)) return 'f9';
    if (/중립성/.test(t)) return 'f10';
    if (/안전관리/.test(t) && /서약/.test(t)) return 'f11';
    if (/강사서약서/.test(t)) return 'f12';
    if (/이력서/.test(n)) return 'resume';
    return 'other';
  }
  function pdfSlot(path) {
    var s = path.replace(/\s+/g, '');
    var b = base(path).replace(/\s+/g, '');
    if (/이력서/.test(b)) return { skip: '이력서' };
    if (/신분증|통장/.test(b)) return { skip: '신분증·통장 사본' };
    if (/동의서|서약서/.test(b)) return { skip: '동의서·서약서' };
    if (/신체검사|채용신체|건강검진|검진결과/.test(b) && /결핵|IGRA/i.test(b)) return { k: 'exam', both: true };
    if (/신체검사|채용신체|건강검진|검진결과/.test(b)) return { k: 'exam' };
    if (/결핵|IGRA/i.test(b)) return { k: 'tb' };
    if (/졸업|학력|학위|재학|성적/.test(b)) return { k: 'grad' };
    if (/경력|자격|재직|활동|확인서|증명|수료|지도사|교사|면허/.test(b)) return { k: 'cert' };
    // 이름으로 모르면 폴더 이름으로
    if (/신체검사/.test(s) && !/결핵/.test(b)) return { k: 'exam' };
    if (/학력/.test(s)) return { k: 'grad' };
    return { k: 'cert' };
  }

  /* ---------- 글자 정리 ---------- */
  var RRN = /(\d{6})\s*-\s*([1-8]\d{6})/;
  function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function cleanName(s) { s = String(s || '').replace(/\s+/g, ''); var m = s.match(/[가-힣]{2,5}/); return m ? m[0] : ''; }
  function badSchool(s) { return /^(OO|○○|000|0+|ㅇㅇ)/.test(s) || /^초등학교$/.test(s); }
  function schoolsIn(text) {
    var out = [], re = /([가-힣A-Za-z0-9]{2,20}초등학교)(?=장|의|\s|$|에|와|,)/g, m;
    while ((m = re.exec(text))) { var v = m[1].replace(/^(본인은|이용기관명칭:?|는)/, ''); if (!badSchool(v) && out.indexOf(v) < 0) out.push(v); }
    return out;
  }
  function cellMap(view) {
    var map = {};
    view.paras.forEach(function (p) { if (!p.cell) return; var k = p.cell.table + ',' + p.cell.row + ',' + p.cell.col; (map[k] = map[k] || []).push(p.text); });
    return function (t, r, c) { return squash((map[t + ',' + r + ',' + c] || []).join(' ')); };
  }
  function dateIso(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + (d || 1)).slice(-2); }

  /* ---------- 사진 크기·종류 ---------- */
  function hash(bytes) { var h = 2166136261 >>> 0, step = Math.max(1, Math.floor(bytes.length / 4096)); for (var i = 0; i < bytes.length; i += step) h = Math.imul(h ^ bytes[i], 16777619) >>> 0; return h.toString(16) + ':' + bytes.length; }
  function jpegSize(b) {
    for (var i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xFF) { i++; continue; }
      var m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      i += 2 + len;
    }
    return null;
  }
  function pngSize(b) { return b.length > 24 && b[1] === 0x50 ? { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 } : null; }
  function imgSize(bytes, ext) { return ext === 'png' ? pngSize(bytes) : jpegSize(bytes); }

  /* ---------- JPG → PDF (A4 한 쪽, 여백 10mm) ---------- */
  function jpegToPdf(jpg) {
    var sz = jpegSize(jpg) || { w: 1000, h: 1400 }, comps = 3;
    for (var i = 2; i + 9 < jpg.length;) { if (jpg[i] !== 0xFF) { i++; continue; } var m = jpg[i + 1]; if (m >= 0xC0 && m <= 0xC2) { comps = jpg[i + 9]; break; } i += 2 + ((jpg[i + 2] << 8) | jpg[i + 3]); }
    var PW = 595.28, PH = 841.89, M = 28.35, s = Math.min((PW - 2 * M) / sz.w, (PH - 2 * M) / sz.h), dw = sz.w * s, dh = sz.h * s, x = (PW - dw) / 2, y = (PH - dh) / 2;
    var cs = comps === 1 ? '/DeviceGray' : comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    var content = 'q ' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im0 Do Q';
    var enc = new TextEncoder(), parts = [], offs = [], len = 0;
    function push(x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; }
    push('%PDF-1.4\n%\xE2\xE3\n'.replace(/[\u0080-ÿ]/g, ''));
    function obj(n, body) { offs[n] = len; push(n + ' 0 obj\n'); body(); push('\nendobj\n'); }
    obj(1, function () { push('<< /Type /Catalog /Pages 2 0 R >>'); });
    obj(2, function () { push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); });
    obj(3, function () { push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'); });
    obj(4, function () { push('<< /Type /XObject /Subtype /Image /Width ' + sz.w + ' /Height ' + sz.h + ' /ColorSpace ' + cs + ' /BitsPerComponent 8 /Filter /DCTDecode' + (comps === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '') + ' /Length ' + jpg.length + ' >>\nstream\n'); push(jpg); push('\nendstream'); });
    obj(5, function () { push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'); });
    var xref = len, x2 = 'xref\n0 6\n0000000000 65535 f \n';
    for (var n = 1; n <= 5; n++) x2 += ('000000000' + offs[n]).slice(-10) + ' 00000 n \n';
    push(x2 + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(len), p = 0; parts.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }

  /* ---------- 한 사람 묶음 읽기 ---------- */
  // files: [{path, bytes}] (path 는 그 사람 폴더 기준), hint: 폴더 이름
  async function readPerson(env, files, hint, tplResume) {
    var r = { name: '', role: '', rrn: '', phone: '', address: '', email: '', birth: '', schools: [], edu: [], career: [], cert: [], imgs: {}, pdfs: {}, examDate: '', notes: [], filled: [] };
    hint = hint || '';
    if (/보조/.test(hint)) r.role = '보조강사'; else if (/주강사/.test(hint)) r.role = '주강사';
    var sigCount = {}, sigPics = {}, kinds = {};
    var tplVals = {};
    if (tplResume) tplResume.paras.forEach(function (p) { if (p.cell && p.text.trim()) tplVals[squash(p.text)] = 1; });
    for (var i = 0; i < files.length; i++) {
      var f = files[i], ext = extOf(f.path), view = null;
      try {
        if (ext === 'hwp') view = viewHwp(env, f.bytes);
        else if (ext === 'hwpx') view = await viewHwpx(env, f.bytes);
      } catch (e) { r.notes.push('「' + base(f.path) + '」을(를) 읽지 못했습니다 (' + (e.message || e) + ')'); continue; }
      if (view) {
        var all = view.paras.map(function (p) { return p.text; }).join('\n'), kind = kindOf(all, f.path);
        kinds[kind] = (kinds[kind] || 0) + 1;
        if (!r.rrn) { var m = all.match(RRN); if (m) r.rrn = m[1] + '-' + m[2]; }
        if (kind !== 'resume') schoolsIn(all).forEach(function (s) { if (r.schools.indexOf(s) < 0) r.schools.push(s); });
        if (kind === 'f11' || kind === 'f12') r.role = r.role || '주강사';
        if (kind === 'resume') readResume(view, r, tplVals);
        if (kind === 'f0') {
          var c0 = cellMap(view), nm = cleanName(view.paras.filter(function (p) { return p.cell && p.cell.table === 0 && p.cell.row === 3 && p.cell.col === 1 && p.cell.n > 0; }).map(function (p) { return p.text; }).join(''));
          if (nm && !r.name) r.name = nm;
          var ph = c0(0, 5, 1).match(/01\d[-\s.]?\d{3,4}[-\s.]?\d{4}/); if (ph && !r.phone) r.phone = ph[0];
        }
        if (kind === 'f2') {
          var ps = view.pics.slice().sort(function (a, b) { return ((a.para && a.para.cell ? a.para.cell.row : 0) - (b.para && b.para.cell ? b.para.cell.row : 0)); });
          if (ps[0]) r.imgs.idcard = picOut(ps[0]);
          if (ps[1]) r.imgs.bank = picOut(ps[1]);
        }
        view.pics.forEach(function (p) {
          if (kind === 'f2') return;
          var k = hash(p.bytes);
          sigCount[k] = (sigCount[k] || 0) + (kind === 'resume' && isPhotoShape(p) ? 0 : 1); sigPics[k] = p;
          if (kind === 'resume' && isPhotoShape(p) && !r.imgs.photo) r.imgs.photo = picOut(p);
        });
        continue;
      }
      if (ext === 'pdf' || ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
        var slot = pdfSlot(f.path);
        if (slot.skip) { r.notes.push('「' + base(f.path) + '」: ' + slot.skip + ' 파일이 ' + ext.toUpperCase() + '라 내용을 읽을 수 없습니다. 직접 입력해 주세요'); continue; }
        var data = f.bytes, name = base(f.path);
        if (ext !== 'pdf') {
          var jpg = f.bytes;
          if (ext === 'png') {
            // PNG는 화면(브라우저)에서 JPEG로 바꾼 뒤 PDF로
            if (env.imageToJpeg) { try { jpg = await env.imageToJpeg(f.bytes, 'image/png'); } catch (e) { jpg = null; } } else jpg = null;
          }
          if (jpg) { data = jpegToPdf(jpg); name = name.replace(/\.(jpe?g|png)$/i, '.pdf'); r.notes.push('「' + base(f.path) + '」: 이미지 파일을 PDF로 변환했습니다'); }
          else r.notes.push('「' + name + '」: 이미지를 PDF로 변환하지 못해 원본 그대로 넣었습니다');
        }
        if (slot.both) { r.tbIn41 = true; r.notes.push('「' + base(f.path) + '」: 채용신체검사서와 잠복결핵 검사 확인서가 한 파일에 있어 4-1에 넣고 4-2는 「4-1에 포함」으로 처리했습니다. 증빙서류(PDF) 화면의 「쪽 나누기」로 분리할 수 있습니다'); }
        (r.pdfs[slot.k] = r.pdfs[slot.k] || []).push({ name: name, type: 'application/pdf', data: data, from: f.path, at: f.at || 0 });
        if (slot.k === 'exam' && !r.examDate) {
          var dm = base(f.path).match(/(20\d{2})\s*[.\-년]\s*(\d{1,2})(?:\s*[.\-월]\s*(\d{1,2}))?/);
          if (dm) { r.examDate = dateIso(dm[1], dm[2], dm[3] || 1); r.examGuess = !dm[3]; }
        }
        continue;
      }
      if (ext !== 'txt' && ext !== 'ds_store' && !/^\./.test(base(f.path))) r.notes.push('「' + base(f.path) + '」: 모르는 파일이라 건너뜁니다');
    }
    // 서명: 여러 서류에 똑같이 들어간 그림
    var photoKey = r.imgs.photo ? hash(r.imgs.photo.data) : '';
    var best = null; Object.keys(sigCount).forEach(function (k) { if (k !== photoKey && sigCount[k] >= 2 && (!best || sigCount[k] > sigCount[best])) best = k; });
    if (best) r.imgs.sign = picOut(sigPics[best]);
    if (!r.name) r.name = cleanName(hint.replace(/\(.*?\)|_?주강사|_?보조강사|보조|\d+/g, ''));
    if (!r.birth && r.rrn) r.birth = '';
    if (!kinds.resume) r.notes.push('한글 이력서가 없어 이력 칸은 비워 둡니다');
    if (!kinds.f2) r.notes.push('한글 신분증·통장 사본이 없어 이미지를 못 가져왔습니다');
    return r;
  }
  function isPhotoShape(p) { var ratio = p.h / (p.w || 1); return p.w > 12 && p.w < 45 && ratio > 1.15 && ratio < 1.7; }
  function picOut(p) { var sz = imgSize(p.bytes, p.ext) || { w: Math.round(p.w * 12) || 300, h: Math.round(p.h * 12) || 400 }; return { data: p.bytes, ext: p.ext === 'png' ? 'png' : 'jpg', pxW: sz.w, pxH: sz.h }; }
  function readResume(view, r, tplVals) {
    var c = cellMap(view);
    var keep = function (v) { v = squash(v); return v && !tplVals[v] && !/^\(.*작성\)$/.test(v) ? v : ''; };
    var nm = cleanName(c(0, 0, 2)); if (nm) r.name = nm;
    var ph = keep(c(0, 1, 2)); if (ph) r.phone = ph;
    var ad = keep(c(0, 2, 2)); if (ad) r.address = ad;
    var em = keep(c(0, 3, 2)); if (em) r.email = em;
    r.birth = keep(c(0, 0, 6));
    function rows(r0, keys) {
      var out = [];
      for (var i = 0; i < 3; i++) { var o = {}, any = false; [0, 3, 5].forEach(function (col, j) { var v = keep(c(0, r0 + i, col)); o[keys[j]] = v; if (v) any = true; }); out.push(any ? o : {}); }
      return out;
    }
    r.edu = rows(6, ['period', 'school', 'major']);
    r.career = rows(11, ['period', 'place', 'note']);
    r.cert = rows(16, ['date', 'name', 'issuer']);
  }

  /* ---------- ZIP·파일 묶음 → 사람별 ---------- */
  // items: [{path, bytes}] (ZIP 은 풀어서 넣는다)
  function groupPeople(items) {
    items = items.filter(function (f) { return !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i.test(f.path) && !/\/$/.test(f.path); });
    var segs = items.map(function (f) { return f.path.split('/').filter(Boolean); });
    // 모든 파일이 같이 들어 있는 바깥 폴더는 벗긴다
    var strip = 0;
    while (segs.length && segs.every(function (s) { return s.length > strip + 1 && s[strip] === segs[0][strip]; })) strip++;
    var wrapper = strip ? segs[0][strip - 1] : '';
    var top = {}, loose = [];
    items.forEach(function (f, i) { var s = segs[i].slice(strip); if (s.length === 1) loose.push(f); else (top[s[0]] = top[s[0]] || []).push({ path: s.slice(1).join('/'), bytes: f.bytes, at: f.at }); });
    var isPersonDir = function (n) { return /[가-힣]{2,4}/.test(n.replace(/초등학교|스캔본|증명서|서류|자격|경력|학력|신체|결핵|사본|이력|동의|서약/g, '')) && !/초등학교|스캔본|증명|사본/.test(n); };
    var dirs = Object.keys(top), personDirs = dirs.filter(isPersonDir);
    var hasForms = loose.some(function (f) { return /\.(hwpx?)$/i.test(f.path); });
    if (personDirs.length >= 1 && !hasForms && (personDirs.length >= 2 || dirs.length === 1)) {
      return personDirs.map(function (d) { return { hint: d, files: top[d] }; });
    }
    var all = loose.map(function (f) { return { path: segs[items.indexOf(f)].slice(strip).join('/'), bytes: f.bytes, at: f.at }; });
    dirs.forEach(function (d) { top[d].forEach(function (f) { all.push({ path: d + '/' + f.path, bytes: f.bytes, at: f.at }); }); });
    return [{ hint: wrapper, files: all }];
  }
  async function expand(env, files, onProg) {
    // files: [{name, bytes}] 브라우저에서 놓은 것 그대로. ZIP 은 풀어서 path 로
    var out = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (onProg) onProg('expand', i, files.length, f.name);
      if (/\.zip$/i.test(f.name)) {
        var zip = await env.JSZip.loadAsync(f.bytes, { decodeFileName: decodeName });
        var names = Object.keys(zip.files);
        // 폴더 안에 있던 ZIP 이나, 안에 폴더 없이 파일만 든 ZIP 은 ZIP 이름을 폴더 이름으로 붙인다
        var fnames = names.filter(function (n) { return !zip.files[n].dir && !/(^|\/)(__MACOSX|\.DS_Store)/i.test(n); });
        var loose = fnames.some(function (n) { return n.indexOf('/') < 0; });
        var zbase = String(f.path || f.name).replace(/\.zip$/i, '');
        var pre = !f.nested && (loose || zbase.indexOf('/') >= 0) ? zbase + '/' : '';
        for (var j = 0; j < names.length; j++) {
          var e = zip.files[names[j]]; if (e.dir) continue;
          var b = await e.async('uint8array'), eat = f.at || (e.date ? e.date.getTime() : 0);
          if (/\.zip$/i.test(names[j])) { (await expand(env, [{ name: names[j], bytes: b, nested: true }])).forEach(function (x) { out.push({ path: pre + names[j].replace(/\.zip$/i, '') + '/' + x.path, at: eat, bytes: x.bytes }); }); }
          else out.push({ path: pre + names[j], bytes: b, at: eat });
        }
      } else out.push({ path: f.path || f.name, bytes: f.bytes, at: f.at || 0 });
    }
    return out;
  }
  // 아는 강사 이름(운영현황·강사 목록)이 들어간 폴더를 강사 폴더로 본다. 학기·학교 폴더처럼 강사 폴더가 깊이 있어도 찾는다.
  // 강사 폴더가 2개 이상 나올 때만 쓰고, 아니면 기존 방식(groupPeople)
  function groupByKnown(items, known) {
    if (!known || !known.length) return null;
    var names = known.filter(function (n) { return n && n.length >= 2; }).sort(function (a, b) { return b.length - a.length; });
    var groups = {}, order = [], rest = [];
    items.forEach(function (f) {
      if (/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i.test(f.path) || /\/$/.test(f.path)) return;
      var segs = f.path.split('/').filter(Boolean), hit = -1, who = '';
      for (var i = 0; i < segs.length - 1 && hit < 0; i++) { var sq = segs[i].replace(/\s/g, ''); for (var k = 0; k < names.length; k++) if (sq.indexOf(names[k]) >= 0) { hit = i; who = names[k]; break; } }
      if (hit < 0) { rest.push(f); return; }
      var key = segs.slice(0, hit + 1).join('/');
      if (!groups[key]) { groups[key] = { hint: segs[hit], who: who, files: [] }; order.push(key); }
      groups[key].files.push({ path: segs.slice(hit + 1).join('/'), bytes: f.bytes, at: f.at });
    });
    if (order.length < 2) return null;
    var out = order.map(function (k) { return groups[k]; });
    if (rest.length) out = out.concat(groupPeople(rest));
    return out;
  }
  async function readDrop(env, files, tplResumeBytes, onProg) {
    var items = await expand(env, files, onProg), groups = groupByKnown(items, env.known) || groupPeople(items), tpl = null;
    if (onProg) onProg('expand', files.length, files.length, '');
    try { if (tplResumeBytes) tpl = viewHwp(env, tplResumeBytes); } catch (e) { tpl = null; }
    var people = [];
    for (var g = 0; g < groups.length; g++) {
      if (onProg) onProg('read', g, groups.length, String(groups[g].hint || '').split('/').pop());
      var rp = await readPerson(env, groups[g].files, groups[g].hint, tpl), who = groups[g].who;
      if (who && (!rp.name || rp.name.length > 4 || rp.name.indexOf(who) >= 0)) rp.name = who;
      rp.at = groups[g].files.reduce(function (m, f) { return Math.max(m, f.at || 0); }, 0);
      people.push(rp);
      // 화면이 멈추지 않게 강사 한 명마다 한 번 쉰다
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    if (onProg) onProg('read', groups.length, groups.length, '');
    var names = people.map(function (p) { return p.name; }).filter(Boolean);
    people.forEach(function (p) {
      Object.keys(p.pdfs).forEach(function (k) { p.pdfs[k].forEach(function (f) {
        names.forEach(function (n) { if (n !== p.name && f.name.indexOf(n) >= 0 && f.name.indexOf(p.name) < 0) p.notes.push('「' + f.name + '」에 다른 강사(' + n + ') 이름이 들어 있습니다. 잘못 넣은 파일인지 확인해 주세요'); });
      }); });
    });
    return people;
  }

  var api = { readDrop: readDrop, readPerson: readPerson, groupPeople: groupPeople, expand: expand, viewHwp: viewHwp, viewHwpx: viewHwpx, kindOf: kindOf, pdfSlot: pdfSlot, jpegToPdf: jpegToPdf, decodeName: decodeName, schoolsIn: schoolsIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Importer = api;
})(typeof self !== 'undefined' ? self : this);
