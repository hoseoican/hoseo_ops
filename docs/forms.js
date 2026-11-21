/* 강사서류 양식별 채움 규칙 */
(function (root) {
  'use strict';

  function pad2(n) { return ('0' + n).slice(-2); }
  function parts(iso) { var p = String(iso || '').split('-'); return { y: p[0] || '', m: +p[1] || '', d: +p[2] || '' }; }
  function dateKor(iso) { var p = parts(iso); return p.y + '년 ' + p.m + '월 ' + p.d + '일'; }
  function dateDot(iso) { var p = parts(iso); return p.y + '. ' + p.m + '. ' + p.d + '.'; }
  function birthFromRrn(rrn) {
    var d = String(rrn || '').replace(/\D/g, '');
    if (d.length < 7) return '';
    var g = +d[6], cent = (g === 1 || g === 2 || g === 5 || g === 6) ? 1900 : (g === 3 || g === 4 || g === 7 || g === 8) ? 2000 : (g === 9 || g === 0) ? 1800 : 1900;
    return (cent + +d.slice(0, 2)) + '. ' + (+d.slice(2, 4)) + '. ' + (+d.slice(4, 6)) + '.';
  }
  /* 날짜 표기 통일(국립국어원 문장 부호 해설 기준)
     - 연월일은 마침표로: 2025. 5. 27.  (숫자 앞 0 없음, 마침표 뒤 한 칸, 끝에도 마침표)
     - 연·월만: 2025. 5.   연도만(2023년)은 그대로 둔다
     - 두 자리 연도(24.07.17)는 네 자리로: 2024. 7. 17.
     - 기간 물결표는 앞뒤를 붙인다: 2025. 1.~2025. 4. */
  function normDates(text) {
    var s = String(text == null ? '' : text);
    if (!/\d/.test(s)) return s;
    var re = /(^|[^\d])(\d{4}|'\d{2}|\d{2}(?=\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*\d{1,2}))\s*(?:년|[.\/-])\s*(\d{1,2})(?!\d)(?:(\s*월|\s*\.|[\/-](?=\d))(?:\s*(\d{1,2})(?!\d)(?:\s*(일|\.))?)?)?/g;
    s = s.replace(re, function (all, pre, y, m, sep2, d, sep3) {
      var yy = y.replace("'", ''); if (yy.length === 2) yy = (+yy >= 50 ? '19' : '20') + yy;
      var mm = +m, dd = d == null ? null : +d;
      if (mm < 1 || mm > 12) return all;
      // 월 다음 구분자 없이 숫자가 오면(2025. 3 15명 등) 날로 보지 않는다
      if (dd != null && !sep2) { dd = null; }
      if (dd != null && (dd < 1 || dd > 31)) return all;
      var out = yy + '. ' + mm + '.' + (dd != null ? ' ' + dd + '.' : '');
      var rest = dd != null ? '' : (sep2 || d == null ? '' : '');
      // 날로 쓰지 않은 숫자는 되돌린다
      if (d != null && dd == null) rest = ' ' + d + (sep3 || '');
      return pre + out + rest;
    });
    s = s.replace(/\.\.+/g, '.');
    s = s.replace(/\s*[~∼～〜]\s*/g, '~');                 // 물결표 앞뒤 붙이기
    s = s.replace(/(\d\.)\s+-\s+(?=\d)/g, '$1~');        // 날짜 사이 ' - ' 는 물결표로
    s = s.replace(/(\d\.)(?=[가-힣])/g, '$1 ');           // 2026. 6.현재 → 2026. 6. 현재
    s = s.replace(/(\d\.)\s*,\s*(?=\d)/g, '$1, ');       // 나열 쉼표
    return s.replace(/\s{2,}/g, ' ').trim();
  }
  function fmtRrn(rrn) { var d = String(rrn || '').replace(/\D/g, ''); return d.length === 13 ? d.slice(0, 6) + '-' + d.slice(6) : String(rrn || ''); }
  function fmtPhone(t) {
    var d = String(t || '').replace(/\D/g, '');
    if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return String(t || '');
  }
  function spaced(name) { return String(name || '').split('').join(' '); }

  // "라벨:      (서명)" 처럼 빈칸 자리에 이름을 넣되, 뒤쪽 (서명) 위치가 크게 밀리지 않게 빈칸을 줄인다
  function nameInGap(text, label, name) {
    var i = text.indexOf(label);
    if (i < 0) throw new Error('"' + label + '" 을(를) 찾지 못했습니다');
    var j = i + label.length, k = j;
    while (text[k] === ' ') k++;
    var gap = k - j, w = String(name).length * 2;
    var after = Math.max(2, gap - 1 - w);
    return { old: text.slice(i, k), neu: label + ' ' + name + new Array(after + 1).join(' ') };
  }

  /*
    각 양식: file(양식 파일명), out(저장 이름), school(학교별), roles, ops
    op: {i: 문단번호, expect: 시작 글자(양식 확인용), set|rep|gap|sign|img|del}
    sign: {x,y} 서명 그림 위치(mm, 단 왼쪽·문단 위 기준), 크기는 공통 설정
  */
  var FORMS = [
    {
      no: '0', file: '0. 범죄경력조회 동의서, 행정정보 이용 동의서_강사명.hwp', out: '0. 범죄경력조회 동의서, 행정정보 이용 동의서_{name}.hwp', school: true, roles: ['주강사', '보조강사'],
      ops: [
        { i: 8, expect: '', set: function (d) { return d.name; } },
        { i: 11, expect: '', set: function (d) { return fmtRrn(d.rrn); } },
        { i: 14, expect: '', set: function (d) { return fmtPhone(d.phone); } },
        { i: 17, expect: '  본인은 000초등학교', rep: ['000초등학교', function (d, s) { return s; }] },
        { i: 18, expect: '2026년', set: function (d) { return dateKor(d.date); } },
        { i: 19, expect: '   동의자', set: function (d) { return '   동의자        ' + spaced(d.name); } },
        { i: 20, expect: ' (서명 또는 인)', sign: { x: 60, y: -4 } },
        { i: 21, expect: '             경찰서장', set: function (d) { return d.police ? '   ' + d.police.replace(/경찰서$/, '') + '경찰서장 귀하' : null; } },
        { i: 42, expect: '1. 이용기관 명칭', rep: ['○○초등학교', function (d, s) { return s; }] },
        { i: 61, expect: ' ( ■주민등록', rep: ['번호 :                            ', function (d) { return '번호 : ' + fmtRrn(d.rrn); }] },
        { i: 67, expect: '2026년', set: function (d) { return dateKor(d.date); } },
        { i: 69, expect: '             대상자', gap: ['명 :', 'name'], rep2: [['생년월일 :', function (d) { return '생년월일 : ' + birthFromRrn(d.rrn); }], ['전화번호 :', function (d) { return '전화번호 : ' + fmtPhone(d.phone); }]], sign: { x: 100, y: -4 } },
        { i: 72, expect: '○○초등학교장', rep: ['○○초등학교장', function (d, s) { return s + '장'; }] }
      ]
    },
    {
      no: '1', file: '1. 이력서 (강사명).hwp', out: '1. 이력서 ({name}).hwp', school: false, roles: ['주강사', '보조강사'],
      ops: [
        { i: 5, expect: '', set: function (d) { return d.name; } },
        { i: 7, expect: '', set: function (d) { return birthFromRrn(d.rrn); } },
        { i: 9, expect: '', set: function (d) { return fmtPhone(d.phone); } },
        { i: 11, expect: '', set: function (d) { return d.address; } },
        { i: 13, expect: '', set: function (d) { return d.email; } }
      ].concat(rowsOps([19, 22, 25], 'edu', ['period', 'school', 'major'], 23))
        .concat(rowsOps([33, 36, 39], 'career', ['period', 'place', 'note'], 37))
        .concat(rowsOps([47, 50, 53], 'cert', ['date', 'name', 'issuer'], 51))
        .concat([
          { i: 58, expect: '2026년', set: function (d) { return dateKor(d.date); } },
          { i: 60, expect: '성명 :', gap: ['성명 :', 'name'], sign: { x: 133, y: -4 } },
          // 사진 칸: 안내 글자를 지우고 사진을 넣는다 (지우기는 마지막에)
          { i: 1, expect: '사  진', set: function () { return ''; }, img: { key: 'photo', w: 22, h: 30 }, need: 'photo' },
          { i: 3, expect: '(필수)', del: true, need: 'photo' },
          { i: 2, expect: '(3×4)', del: true, need: 'photo' }
        ])
    },
    {
      no: '2', file: '2. 신분증, 통장사본 (강사명).hwp', out: '2. 신분증, 통장사본 ({name}).hwp', school: false, roles: ['주강사', '보조강사'],
      ops: [
        { i: 3, expect: '', img: { key: 'idcard', w: 150, h: 62 } },
        { i: 5, expect: '', img: { key: 'bank', w: 150, h: 110 } }
      ]
    },
    {
      no: '3', file: '3. 개인정보 수집·이용 및 제3자 제공 동의서 (강사명).hwp', out: '3. 개인정보 수집·이용 및 제3자 제공 동의서 ({name}).hwp', school: true, roles: ['주강사', '보조강사'],
      ops: [
        { i: 41, expect: '2026.', set: function (d) { return dateDot(d.date); } },
        { i: 42, expect: '본인 성명', gap: ['본인 성명', 'name'], sign: { x: 105, y: -4 } },
        { i: 44, expect: '○○초등학교장', rep: ['○○초등학교장', function (d, s) { return s + '장'; }] }
      ]
    },
    {
      no: '7', file: '7. 청렴서약서 (강사명).hwp', out: '7. 청렴서약서 ({name}).hwp', school: true, roles: ['주강사', '보조강사'],
      ops: [
        { i: 6, expect: '   충남 앵커늘봄학교', rep: ['OOO은(는) OO초등학교', function (d, s) { return d.name + '은(는) ' + s; }] },
        { i: 16, expect: '    2026.', set: function (d) { return '    ' + dateDot(d.date); } },
        { i: 18, expect: '                              서 약 자:', gap: ['서 약 자:', 'name'], sign: { x: 120, y: -4 } },
        { i: 20, expect: '   OO초등학교장', rep: ['OO초등학교장', function (d, s) { return s + '장'; }] }
      ]
    },
    {
      no: '8', file: '8. 성범죄 및 아동학대 수사여부 부존재 확인 서약서 (강사명).hwp', out: '8. 성범죄 및 아동학대 수사여부 부존재 확인 서약서 ({name}).hwp', school: true, roles: ['주강사', '보조강사'],
      ops: [
        { i: 7, expect: '  본인(OOO)은', rep: ['본인(OOO)은 OO초등학교장', function (d, s) { return '본인(' + d.name + ')은 ' + s + '장'; }] },
        { i: 10, expect: '2026년', set: function (d) { return dateKor(d.date); } },
        { i: 12, expect: '                      강  사  명:', gap: ['강  사  명:', 'name'], sign: { x: 123, y: -4 } },
        { i: 14, expect: 'OO초등학교장', rep: ['OO초등학교장', function (d, s) { return s + '장'; }] }
      ]
    },
    {
      no: '9', file: '9. 개인정보 보안서약서(수탁자) (강사명).hwp', out: '9. 개인정보 보안서약서(수탁자) ({name}).hwp', school: true, roles: ['주강사', '보조강사'],
      ops: [
        { i: 3, expect: '  본인은 온돌봄', rep: ['OO초등학교', function (d, s) { return s; }] },
        { i: 18, expect: '2026년', set: function (d) { return dateKor(d.date); } },
        { i: 21, expect: '                                    성   명', gap: ['성   명', 'name'], sign: { x: 127, y: -4 } },
        { i: 22, expect: 'OO초등학교장', rep: ['OO초등학교장', function (d, s) { return s + '장'; }] }
      ]
    },
    { no: '10', file: '10. 교육의 중립성 준수 서약서(강사명).hwpx', out: '10. 교육의 중립성 준수 서약서({name}).hwpx', school: true, roles: ['주강사', '보조강사'], hwpx: true },
    {
      no: '11', file: '11. 안전관리 서약서_OOO.hwp', out: '11. 안전관리 서약서_{name}.hwp', school: false, roles: ['주강사'], optional: true,
      ops: [
        { i: 8, expect: '(진행 프로그램 전부 작성)', set: function (d) { return d.programs || null; } },
        { i: 22, expect: '', set: function (d) { return d.name; } },
        { i: 24, expect: '', set: function (d) { return fmtPhone(d.phone); } },
        { i: 31, expect: '                            안전관리요원 :', set: function (d) { return '                            안전관리요원 :    ' + spaced(d.name) + '  (서명)'; }, sign: { x: 154, y: -4 } }
      ]
    },
    {
      no: '12', file: '12. 강사 서약서_OOO.hwp', out: '12. 강사 서약서_{name}.hwp', school: false, roles: ['주강사'], optional: true,
      ops: [
        { i: 24, expect: '강사 성명:', gap: ['강사 성명:', 'name'], sign: { x: 104, y: -4 } }
      ]
    }
  ];

  function rowsOps(idxs, key, fields, shapeFrom) {
    var ops = [];
    idxs.forEach(function (start, r) {
      fields.forEach(function (f, c) {
        ops.push({ i: start + c, shapeFrom: shapeFrom, set: function (d) { var row = (d[key] || [])[r] || {}; var v = row[f] || ''; return (f === 'period' || f === 'date') ? normDates(v) : v; } });
      });
    });
    return ops;
  }

  /* HWP 양식 하나 채우기
     env: {HwpCore, deps:{CFB,pako}}, tpl: Uint8Array, d: 강사 정보, school: 학교명, imgs: {sign, photo, idcard, bank: {bytes, ext, pxW, pxH}}
     opts: {signW, signH, signDx, signDy} */
  function fillHwp(env, form, tpl, d, school, imgs, opts) {
    opts = opts || {};
    var doc = new env.HwpCore.Doc(env.deps, tpl), warn = [];
    var paras0 = doc.paras.map(function (p) { return p.text; });
    var later = [];
    form.ops.forEach(function (op) {
      var p = doc.paras[op.i];
      if (!p || (op.expect != null && op.expect !== '' && paras0[op.i].indexOf(op.expect) !== 0) || (op.expect === '' && paras0[op.i] !== '')) {
        throw new Error(form.no + '번 양식이 예상과 다릅니다(문단 ' + op.i + ': "' + (p ? paras0[op.i] : '없음') + '")');
      }
      if (op.need && !imgs[op.need]) { if (op.img) warn.push('사진 이미지 없음'); return; }
      if (op.del) { later.push(op); return; }
      if (op.shapeFrom != null) doc.copyCharShape(doc.paras[op.i], doc.paras[op.shapeFrom]);
      if (op.set) { var v = op.set(d, school); if (v != null && v !== p.text) doc.setText(p, v); }
      if (op.rep) doc.replaceIn(doc.paras[op.i], op.rep[0], op.rep[1](d, school));
      if (op.rep2) op.rep2.forEach(function (r) { doc.replaceIn(doc.paras[op.i], r[0], r[1](d, school)); });
      if (op.gap) { var g = nameInGap(doc.paras[op.i].text, op.gap[0], d.name); doc.replaceIn(doc.paras[op.i], g.old, g.neu); }
      if (op.sign) {
        if (imgs.sign) {
          var sw = opts.signW || 24, sh = sw * imgs.sign.pxH / imgs.sign.pxW;
          if (sh > (opts.signHmax || 12)) { sh = opts.signHmax || 12; sw = sh * imgs.sign.pxW / imgs.sign.pxH; }
          var adj = (opts.signAdj && opts.signAdj[form.no]) || {};
          doc.addPicture(doc.paras[op.i], { bytes: imgs.sign.bytes, ext: imgs.sign.ext, pxW: imgs.sign.pxW, pxH: imgs.sign.pxH,
            w: sw, h: sh, x: op.sign.x + (adj.x || 0) - sw / 2, y: op.sign.y + (adj.y || 0) - (sh - 4.5) / 2 + 4, at: 0 });
        } else warn.push('서명 이미지 없음');
      }
      if (op.img) {
        var im = imgs[op.img.key];
        if (im) {
          var w = op.img.w, h = w * im.pxH / im.pxW;
          if (h > op.img.h) { h = op.img.h; w = h * im.pxW / im.pxH; }
          doc.addPicture(doc.paras[op.i], { bytes: im.bytes, ext: im.ext, pxW: im.pxW, pxH: im.pxH, w: w, h: h, inline: true });
        } else warn.push({ photo: '사진', idcard: '신분증', bank: '통장' }[op.img.key] + ' 이미지 없음');
      }
    });
    later.sort(function (a, b) { return b.i - a.i; }).forEach(function (op) { doc.deleteParagraph(doc.paras[op.i]); });
    return { bytes: doc.save(), warn: warn };
  }

  /* HWPX(10번) 채우기: env.JSZip 필요 */
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  async function fillHwpx(env, form, tpl, d, school, imgs, opts) {
    opts = opts || {};
    var zip = await env.JSZip.loadAsync(tpl), warn = [];
    var sec = await zip.file('Contents/section0.xml').async('string');
    function rep(a, b) { if (sec.indexOf(a) < 0) throw new Error('10번 양식에서 "' + a + '"를 찾지 못했습니다'); sec = sec.replace(a, b); }
    rep('<hp:t> 2026년  월  일</hp:t>', '<hp:t> ' + xmlEsc(dateKor(d.date)) + '</hp:t>');
    rep('<hp:t>            </hp:t>', '<hp:t>' + xmlEsc(spaced(d.name)) + '</hp:t>');
    rep('OO초등학교장', xmlEsc(school) + '장');
    if (imgs.sign) {
      var HU = 7200 / 25.4, im = imgs.sign;
      var sw = opts.signW || 24, sh = sw * im.pxH / im.pxW;
      if (sh > (opts.signHmax || 12)) { sh = opts.signHmax || 12; sw = sh * im.pxW / im.pxH; }
      var adj = (opts.signAdj && opts.signAdj['10']) || {};
      var W = Math.round(sw * HU), H = Math.round(sh * HU), oW = im.pxW * 75, oH = im.pxH * 75;
      var X = Math.round((45 + (adj.x || 0) - sw / 2) * HU), Y = Math.round((-2 + (adj.y || 0) - (sh - 8) / 2) * HU);
      var id = 'image' + (Date.now() % 100000);
      // 한글이 HWPX에 쓰는 그림 요소 순서와 같게: 원본 크기(orgSz) · 표시 크기(curSz) · 확대 행렬 = 표시/원본
      var pic = '<hp:pic id="' + (1900000000 + Math.floor(Math.random() * 1e8)) + '" zOrder="20" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="' + (900000000 + Math.floor(Math.random() * 1e8)) + '" reverse="0">' +
        '<hp:offset x="0" y="0"/><hp:orgSz width="' + oW + '" height="' + oH + '"/><hp:curSz width="' + W + '" height="' + H + '"/>' +
        '<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="' + (W >> 1) + '" centerY="' + (H >> 1) + '" rotateimage="1"/>' +
        '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="' + (W / oW).toFixed(6) + '" e2="0" e3="0" e4="0" e5="' + (H / oH).toFixed(6) + '" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
        '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + oW + '" y="0"/><hc:pt2 x="' + oW + '" y="' + oH + '"/><hc:pt3 x="0" y="' + oH + '"/></hp:imgRect>' +
        '<hp:imgClip left="0" right="' + oW + '" top="0" bottom="' + oH + '"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
        '<hp:imgDim dimwidth="' + oW + '" dimheight="' + oH + '"/>' +
        '<hc:img binaryItemIDRef="' + id + '" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>' +
        '<hp:sz width="' + W + '" widthRelTo="ABSOLUTE" height="' + H + '" heightRelTo="ABSOLUTE" protect="0"/>' +
        '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="' + Y + '" horzOffset="' + X + '"/>' +
        '<hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>';
      // 서약자 칸 문단의 "(인 또는 서명)" 앞에 그림 넣기
      rep('<hp:run charPrIDRef="17"><hp:t>  (인 또는 서명)</hp:t></hp:run>', '<hp:run charPrIDRef="17">' + pic + '<hp:t>  (인 또는 서명)</hp:t></hp:run>');
      zip.file('BinData/' + id + '.' + im.ext, im.bytes);
      var hpf = await zip.file('Contents/content.hpf').async('string');
      hpf = hpf.replace('</opf:manifest>', '<opf:item id="' + id + '" href="BinData/' + id + '.' + im.ext + '" media-type="image/' + (im.ext === 'jpg' ? 'jpeg' : im.ext) + '" isEmbeded="1"/></opf:manifest>');
      zip.file('Contents/content.hpf', hpf);
    } else warn.push('서명 이미지 없음');
    zip.file('Contents/section0.xml', sec);
    // mimetype 은 압축 없이 맨 앞에
    var mt = await zip.file('mimetype').async('string');
    var out = new env.JSZip();
    out.file('mimetype', mt, { compression: 'STORE' });
    zip.forEach(function (path, f) { if (path !== 'mimetype' && !f.dir) out.file(path, f.async('uint8array'), { compression: 'DEFLATE' }); });
    return { bytes: await out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), warn: warn };
  }

  var api = { FORMS: FORMS, normDates: normDates, fillHwp: fillHwp, fillHwpx: fillHwpx, dateKor: dateKor, dateDot: dateDot, birthFromRrn: birthFromRrn, fmtRrn: fmtRrn, fmtPhone: fmtPhone, nameInGap: nameInGap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Forms = api;
})(typeof self !== 'undefined' ? self : this);
