// ==UserScript==
// @name         호서대 늘봄 문자 보내기 (i-ONE 캠퍼스 연결)
// @namespace    hoseo-anchor-sms
// @version      0.2.1
// @description  「초등방과후 프로그램 운영 관리」에서 고른 문자를 i-ONE 캠퍼스 「메시지전송(문자)」(1명씩) 또는 「개별메시지/사진 문자발송」(강사별 다른 내용을 한 번에) 화면에 채워 줍니다. 보내기는 담당자가 직접 누릅니다.
// @match        https://hoseoican.github.io/hoseo_ops/*
// @match        https://script.google.com/macros/*
// @match        https://*.googleusercontent.com/*
// @match        https://campus.ibk.co.kr/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @run-at       document-idle
// @downloadURL  https://hoseoican.github.io/hoseo_ops/hoseo-sms-bridge.user.js
// @updateURL    https://hoseoican.github.io/hoseo_ops/hoseo-sms-bridge.user.js
// ==/UserScript==
(function () {
  'use strict';
  var VER = '0.2.1';
  var CAMPUS_HOME = 'https://campus.ibk.co.kr/admin/';
  var JOB_TTL = 60 * 60 * 1000; /* 문자 목록은 1시간 동안만 유효 */
  var host = location.hostname;

  /* ================= 1. 운영 관리 화면 쪽 (깃허브 화면 · 예전 구글 Apps Script) ================= */
  if (host === 'hoseoican.github.io' || host === 'script.google.com' || /\.googleusercontent\.com$/.test(host)) {
    var src = null;
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'hs-sms-ping') { try { (e.source || window).postMessage({ type: 'hs-sms-hello', ver: VER }, '*'); } catch (x) {} return; }
      if (d.type === 'hs-sms-send' && Array.isArray(d.jobs) && d.jobs.length) {
        if (GM_getValue('hsSmsLastReq', '') === d.req) return; /* 여러 창에서 같은 요청을 두 번 받지 않게 */
        GM_setValue('hsSmsLastReq', d.req);
        src = e.source;
        if (d.mode === 'ind') { /* 개별 문자: 엑셀(개별메시지1=각자 내용)을 「개별메시지/사진 문자발송」에 올림 */
          var ij = d.jobs.slice(0, 1000).map(function (j) { return { key: String(j.key || ''), name: String(j.name || '').replace(/\s+/g, ''), phone: String(j.phone || '').replace(/\D/g, ''), body: String(j.body || '') }; })
            .filter(function (j) { return /^01\d{8,9}$/.test(j.phone) && j.body; });
          if (!ij.length || !d.file) return;
          GM_setValue('hsSmsInd', { jobs: ij, file: String(d.file), fname: String(d.fname || '개별문자.xlsx'), title: String(d.title || ''), label: String(d.label || ''), created: Date.now(), state: 'new' });
          GM_openInTab(GM_getValue('hsSmsIndUrl', '') || GM_getValue('hsSmsUrl', '') || CAMPUS_HOME, { active: true, insert: true });
          try { (e.source || window).postMessage({ type: 'hs-sms-queued', n: ij.length, mode: 'ind' }, '*'); } catch (x) {}
          return;
        }
        var jobs = d.jobs.slice(0, 300).map(function (j) {
          return { key: String(j.key || ''), name: String(j.name || '').replace(/\s+/g, ''), phone: String(j.phone || '').replace(/\D/g, ''), title: String(j.title || ''), body: String(j.body || ''), state: 'new' };
        }).filter(function (j) { return /^01\d{8,9}$/.test(j.phone) && j.body; });
        if (!jobs.length) return;
        GM_setValue('hsSmsQueue', { jobs: jobs, i: 0, created: Date.now(), label: String(d.label || '') });
        GM_openInTab(GM_getValue('hsSmsUrl', '') || CAMPUS_HOME, { active: true, insert: true });
        try { (e.source || window).postMessage({ type: 'hs-sms-queued', n: jobs.length }, '*'); } catch (x) {}
      }
    });
    GM_addValueChangeListener('hsSmsResult', function (name, oldV, v) {
      if (v && src) { try { src.postMessage({ type: 'hs-sms-sent', key: v.key, at: v.at }, '*'); } catch (x) {} }
    });
    GM_addValueChangeListener('hsSmsResults', function (name, oldV, v) {
      if (v && src && Array.isArray(v.keys)) v.keys.forEach(function (k) { try { src.postMessage({ type: 'hs-sms-sent', key: k, at: v.at }, '*'); } catch (x) {} });
    });
    return;
  }

  /* ================= 2. i-ONE 캠퍼스 쪽 ================= */
  if (host !== 'campus.ibk.co.kr') return;

  var vis = function (el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  var byPh = function (sel, re) { return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (e) { return re.test(e.getAttribute('placeholder') || '') && vis(e); })[0] || null; };
  var txt = function (el) { return String(el.textContent || '').replace(/\s+/g, ' ').trim(); };
  var byText = function (sel, re) { return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (e) { return re.test(txt(e)) && vis(e); })[0] || null; };
  var setVal = function (el, v) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    ['input', 'change'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var waitFor = async function (fn, ms) { var t = Date.now(); while (Date.now() - t < (ms || 5000)) { var v = fn(); if (v) return v; await sleep(150); } return null; };

  var F = {
    body: function () { return byPh('textarea', /내용을\s*입력/); },
    title: function () { return byPh('input', /제목을\s*입력/); },
    direct: function () { return byText('a,button,li,span,div[role=tab],[role=tab]', /^직접\s*입력$/); },
    rcptBox: function () { return byPh('textarea', /전화번호\s*\(?필수/); },
    addBtn: function () { return byText('button,a', /^수신자\s*추가$/); },
    count: function () { var el = byText('div,span,p,strong,h3,h4,label', /^수신자\s*\d+\s*명$/); var m = el && txt(el).match(/(\d+)/); return m ? +m[1] : null; },
    delBtn: function () { return byText('button,a', /^삭제/); },
    allChk: function () { var th = document.querySelector('thead input[type=checkbox]'); return th && vis(th) ? th : null; }
  };
  var onSmsPage = function () { return !!(F.body() && (F.direct() || F.rcptBox())); };

  var Q = function () { var q = GM_getValue('hsSmsQueue', null); if (!q || !q.jobs || Date.now() - q.created > JOB_TTL) return null; return q; };
  var saveQ = function (q) { GM_setValue('hsSmsQueue', q); };
  var cur = function (q) { return q && q.jobs[q.i] ? q.jobs[q.i] : null; };

  /* ---------- 안내 상자 ---------- */
  var box = document.createElement('div');
  box.id = 'hs-sms-box';
  box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;width:330px;background:#fff;border:2px solid #8c1d22;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);font:13px/1.5 "Pretendard","Malgun Gothic",sans-serif;color:#222;padding:12px 14px;display:none';
  document.body.appendChild(box);
  var steps = [];
  var draw = function (msg) {
    var q = Q(), j = cur(q);
    if (!q) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="color:#8c1d22">늘봄 문자 보내기</b><span style="color:#888;font-size:12px">' + (q.label ? q.label + ' · ' : '') + Math.min(q.i + 1, q.jobs.length) + ' / ' + q.jobs.length + '</span></div>';
    if (!j) {
      box.innerHTML = head + '<div style="margin:6px 0 10px">모든 문자를 처리했습니다.</div><button data-hs="close" style="' + bs(1) + '">닫기</button>';
      return;
    }
    var st = steps.map(function (s) { return '<div>' + (s[0] ? '완료' : '확인') + ' ' + s[1] + '</div>'; }).join('');
    box.innerHTML = head +
      '<div style="padding:8px 10px;background:#fbf1f1;border-radius:8px;margin-bottom:8px"><b>' + esc(j.name || '(이름 없음)') + '</b> <span style="font-family:monospace">' + esc(fmt(j.phone)) + '</span>' + (j.state === 'sent' ? ' <span style="color:#1f8a63">· 보냄</span>' : '') + '</div>' +
      (onSmsPage() ? '' : '<div style="color:#b3261e;margin-bottom:8px">「UMS서비스 → 메시지관리 → 메시지전송(문자)」 화면을 열어 주세요. 열리면 자동으로 채웁니다.</div>') +
      (st ? '<div style="font-size:12.5px;margin-bottom:8px">' + st + '</div>' : '') +
      (msg ? '<div style="font-size:12.5px;margin-bottom:8px;color:#444">' + msg + '</div>' : '') +
      (j.state === 'filled' ? '<div style="font-size:12.5px;margin-bottom:8px">내용을 확인하고 i-ONE 화면의 <b>전송</b> 버튼을 눌러 주세요. 보낸 뒤 <b>「보냄 · 다음」</b>을 누르면 다음 문자를 채웁니다.</div>' : '') +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button data-hs="sent" style="' + bs(1) + '">보냄 · 다음</button>' +
      '<button data-hs="refill" style="' + bs() + '">다시 채우기</button>' +
      '<button data-hs="skip" style="' + bs() + '">건너뛰기</button>' +
      '<button data-hs="stop" style="' + bs() + '">모두 중지</button></div>';
  };
  function bs(p) { return 'font:inherit;font-size:12.5px;padding:5px 10px;border-radius:7px;cursor:pointer;border:1px solid ' + (p ? '#8c1d22;background:#8c1d22;color:#fff' : '#ccc;background:#fff;color:#333'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(p) { return p.length === 11 ? p.slice(0, 3) + '-' + p.slice(3, 7) + '-' + p.slice(7) : p; }

  var markSent = function (auto) {
    var q = Q(), j = cur(q); if (!j) return;
    j.state = 'sent'; j.at = new Date().toISOString();
    GM_setValue('hsSmsResult', { key: j.key, at: j.at, ts: Date.now() });
    q.i += 1; saveQ(q); steps = [];
    draw(auto ? '보낸 것으로 확인했습니다.' : '');
    setTimeout(tick, 1200);
  };

  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-hs]'); if (!b) return;
    var a = b.getAttribute('data-hs'), q = Q(), j = cur(q);
    if (a === 'sent') markSent(false);
    else if (a === 'refill' && j) { j.state = 'new'; saveQ(q); steps = []; tick(); }
    else if (a === 'skip' && q) { q.i += 1; saveQ(q); steps = []; draw('건너뛰었습니다.'); setTimeout(tick, 500); }
    else if (a === 'stop' || a === 'close') { GM_setValue('hsSmsQueue', null); box.style.display = 'none'; }
  });

  /* ================= 개별 문자 (개별메시지/사진 문자발송) ================= */
  var IQ = function () { var q = GM_getValue('hsSmsInd', null); if (!q || !q.jobs || Date.now() - q.created > JOB_TTL) return null; return q; };
  var saveIQ = function (q) { GM_setValue('hsSmsInd', q); };
  var I = {
    page: function () { return !!(byText('h2,h3,h4,div,span,p,strong,label', /^개별\s*메시지\s*대상자\s*업로드$/) || byText('div,span,button,a,p', /^개별메시지를\s*선택하세요\.?$/)); },
    file: function () {
      var L = Array.prototype.slice.call(document.querySelectorAll('input[type=file]'));
      var xl = L.filter(function (e) { return /xls|sheet|excel/i.test(e.getAttribute('accept') || ''); })[0];
      if (xl) return xl;
      var notImg = L.filter(function (e) { return !/jpe?g|image/i.test(e.getAttribute('accept') || ''); });
      var near = notImg.filter(function (e) { var p = e; for (var k = 0; k < 6 && p; k++) { p = p.parentElement; if (p && /대상자\s*업로드|샘플다운/.test(p.textContent || '')) return true; } return false; })[0];
      return near || (notImg.length === 1 ? notImg[0] : null);
    },
    pick: function () { return byText('div,span,button,a,p,label', /^개별메시지를\s*선택하세요\.?$/); }
  };
  var b64File = function (b64, name) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); };
  var iSteps = [], iBusy = false, iPressed = 0;
  var iDraw = function (msg) {
    var q = IQ(); if (!q) return false;
    box.style.display = 'block';
    var head = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="color:#8c1d22">늘봄 개별 문자 보내기</b><span style="color:#888;font-size:12px">' + (q.label ? esc(q.label) + ' · ' : '') + q.jobs.length + '명</span></div>';
    if (q.state === 'sent') { box.innerHTML = head + '<div style="margin:6px 0 10px">' + q.jobs.length + '명에게 보낸 것으로 기록했습니다.</div><button data-hi="close" style="' + bs(1) + '">닫기</button>'; return true; }
    var st = iSteps.map(function (s) { return '<div>' + (s[0] ? '완료' : '확인') + ' ' + s[1] + '</div>'; }).join('');
    box.innerHTML = head +
      '<div style="padding:8px 10px;background:#fbf1f1;border-radius:8px;margin-bottom:8px;max-height:84px;overflow:auto">' + q.jobs.map(function (j) { return esc(j.name || '(이름 없음)'); }).join(', ') + '</div>' +
      (I.page() ? '' : '<div style="color:#b3261e;margin-bottom:8px">「개별메시지/사진 문자발송」 화면으로 이동하는 중입니다. 넘어가지 않으면 왼쪽 메뉴에서 직접 눌러 주세요. 열리면 자동으로 채웁니다.</div>') +
      (st ? '<div style="font-size:12.5px;margin-bottom:8px">' + st + '</div>' : '') +
      (msg ? '<div style="font-size:12.5px;margin-bottom:8px;color:#444">' + msg + '</div>' : '') +
      (q.state === 'filled' ? '<div style="font-size:12.5px;margin-bottom:8px">수신자 수와 미리보기 내용을 확인하고 i-ONE 화면의 <b>전송</b> 버튼을 눌러 주세요.</div>' : '') +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button data-hi="sent" style="' + bs(1) + '">보냄 처리</button>' +
      '<button data-hi="refill" style="' + bs() + '">다시 채우기</button>' +
      '<button data-hi="dl" style="' + bs() + '">엑셀 받기</button>' +
      '<button data-hi="stop" style="' + bs() + '">중지</button></div>';
    return true;
  };
  var iMarkSent = function (auto) {
    var q = IQ(); if (!q) return;
    var at = new Date().toISOString();
    GM_setValue('hsSmsResults', { keys: q.jobs.map(function (j) { return j.key; }).filter(Boolean), at: at, ts: Date.now() });
    q.state = 'sent'; q.file = ''; saveIQ(q); iSteps = []; iDraw(auto ? '보낸 것으로 확인했습니다.' : '');
  };
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-hi]'); if (!b) return;
    var a = b.getAttribute('data-hi'), q = IQ(); if (!q) return;
    if (a === 'sent') iMarkSent(false);
    else if (a === 'refill') { q.state = 'new'; saveIQ(q); iSteps = []; tick(); }
    else if (a === 'dl') { if (!q.file) return; var u = URL.createObjectURL(b64File(q.file, q.fname)), l = document.createElement('a'); l.href = u; l.download = q.fname; document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 5000); iDraw('엑셀을 받았습니다. 자동 업로드가 안 되면 「업로드」로 직접 올려 주세요.'); }
    else if (a === 'stop' || a === 'close') { GM_setValue('hsSmsInd', null); box.style.display = 'none'; }
  });
  var iFill = async function (q) {
    iBusy = true; iSteps = [];
    try {
      /* 1) 남아 있는 수신자 지우기 */
      var n0 = F.count();
      if (n0 > 0) {
        var ck = F.allChk(), del = F.delBtn();
        if (ck && !ck.checked) ck.click();
        if (del) del.click();
        await waitFor(function () { return F.count() === 0; }, 3000);
        if (F.count() > 0) { iSteps.push([false, '수신자 목록에 ' + F.count() + '명이 남아 있습니다. 직접 지운 뒤 「다시 채우기」']); q.state = 'warn'; saveIQ(q); return; }
      }
      /* 2) 엑셀 올리기 */
      var fi = I.file();
      if (!fi || !q.file) { iSteps.push([false, '엑셀 올리는 칸을 찾지 못함 · 「엑셀 받기」 후 「업로드」로 직접 올려 주세요']); q.state = 'warn'; saveIQ(q); return; }
      var dt = new DataTransfer(); dt.items.add(b64File(q.file, q.fname)); fi.files = dt.files;
      fi.dispatchEvent(new Event('input', { bubbles: true })); fi.dispatchEvent(new Event('change', { bubbles: true }));
      var ok = await waitFor(function () { return F.count() === q.jobs.length; }, 8000);
      var cn = F.count();
      iSteps.push([!!ok, ok ? '수신자 ' + cn + '명 올림' : (cn ? '수신자 ' + cn + '명 (보낼 사람 ' + q.jobs.length + '명) · 확인해 주세요' : '수신자가 올라갔는지 확인해 주세요 · 안 되면 「엑셀 받기」 후 직접 업로드')]);
      /* 3) 제목 · 본문 = {{개별메시지1}} */
      var tEl = F.title(); if (tEl && q.title) setVal(tEl, q.title.slice(0, 40));
      var bEl = F.body();
      if (!bEl) { iSteps.push([false, '내용 칸을 찾지 못함']); q.state = 'warn'; saveIQ(q); return; }
      setVal(bEl, ''); bEl.focus();
      var sel = Array.prototype.slice.call(document.querySelectorAll('select')).filter(function (x) { return Array.prototype.some.call(x.options, function (o) { return /^개별메시지1$/.test(o.text.trim()); }); })[0];
      if (sel) { var op = Array.prototype.filter.call(sel.options, function (o) { return /^개별메시지1$/.test(o.text.trim()); })[0]; sel.value = op.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      else { var pk = I.pick(); if (pk) { pk.click(); var it = await waitFor(function () { return byText('li,a,button,div,span,option', /^개별메시지1$/); }, 2000); if (it) it.click(); } }
      await sleep(400);
      if (!/개별메시지1/.test(bEl.value)) setVal(bEl, '{{개별메시지1}}');
      iSteps.push([true, '제목 · 내용(개별메시지1)']);
      q.state = 'filled'; saveIQ(q);
    } finally { iBusy = false; iDraw(); }
  };

  /* ---------- 채우기 ---------- */
  var busy = false;
  var fill = async function (q, j) {
    busy = true; steps = [];
    try {
      var tEl = F.title(), bEl = F.body();
      if (tEl && j.title) { setVal(tEl, j.title.slice(0, 40)); steps.push([true, '제목']); } else steps.push([!j.title, j.title ? '제목 칸을 찾지 못함' : '제목 없음']);
      if (bEl) { setVal(bEl, j.body); steps.push([true, '내용']); } else steps.push([false, '내용 칸을 찾지 못함']);
      /* 수신자 목록에 남은 사람이 있으면 먼저 지움 (다른 사람에게 잘못 가지 않게) */
      var n0 = F.count();
      if (n0 > 0) {
        var ck = F.allChk(), del = F.delBtn();
        if (ck && !ck.checked) ck.click();
        if (del) del.click();
        await waitFor(function () { return F.count() === 0; }, 3000);
        if (F.count() > 0) { steps.push([false, '수신자 목록에 ' + F.count() + '명이 남아 있습니다. 직접 지운 뒤 「다시 채우기」']); j.state = 'warn'; saveQ(q); return; }
      }
      var tab = F.direct(); if (tab && !F.rcptBox()) { tab.click(); }
      var rb = await waitFor(F.rcptBox, 4000);
      if (!rb) { steps.push([false, '「직접입력」 칸을 찾지 못함']); j.state = 'warn'; saveQ(q); return; }
      var nm = String(j.name || '').replace(/\s+/g, '');
      setVal(rb, j.phone + (nm ? ' ' + nm : ''));
      var add = F.addBtn();
      if (!add) { steps.push([false, '「수신자 추가」 버튼을 찾지 못함']); j.state = 'warn'; saveQ(q); return; }
      add.click();
      var ok = await waitFor(function () { return F.count() === 1; }, 4000);
      steps.push([!!ok, ok ? '받는 사람 1명 추가' : '받는 사람이 추가됐는지 확인해 주세요']);
      j.state = 'filled'; j.filledAt = Date.now(); saveQ(q);
    } finally { busy = false; draw(); }
  };

  /* 「전송」을 누른 뒤 수신자 목록이 비거나 내용 칸이 비면 보낸 것으로 봄 */
  var pressedAt = 0;
  document.addEventListener('click', function (e) {
    if (e.target.closest('#hs-sms-box')) return;
    var b = e.target.closest('button,a,input[type=button],input[type=submit]'); if (!b) return;
    var t = txt(b) || b.value || '';
    if (/^(즉시\s*)?(전송|발송|보내기|문자\s*전송)$/.test(t)) { pressedAt = Date.now(); iPressed = Date.now(); }
  }, true);

  var tick = function () {
    var iq = IQ();
    if (iq) {
      if (I.page() && location.pathname.length > 7) GM_setValue('hsSmsIndUrl', location.href);
      if (!iBusy && I.page()) {
        if (iq.state === 'new') { iFill(iq); return; }
        if (iq.state === 'filled' && iPressed && Date.now() - iPressed < 120000) { var b0 = F.body(), c0 = F.count(); if ((b0 && !b0.value.trim()) || c0 === 0) { iPressed = 0; iMarkSent(true); return; } }
      }
      /* 다른 화면에 있을 때: 1명이면 지금 보이는 「메시지전송(문자)」에서 바로 1명씩 보내기로 바꾸고,
         여러 명이면 왼쪽 메뉴 「개별메시지/사진 문자발송」을 눌러 이동 (못 찾으면 1명씩 보내기로 바꿈) */
      if (!iBusy && !I.page() && iq.state === 'new') {
        var toQueue = function () {
          GM_setValue('hsSmsQueue', { jobs: iq.jobs.map(function (j) { return { key: j.key, name: j.name, phone: j.phone, title: iq.title || '', body: j.body, state: 'new' }; }), i: 0, created: Date.now(), label: iq.label || '' });
          GM_setValue('hsSmsInd', null); setTimeout(tick, 200);
        };
        if (onSmsPage() && iq.jobs.length <= 1) { toQueue(); return; }
        var lk = byText('a,li,span', /^개별\s*메시지\s*\/\s*사진\s*문자\s*발송$/);
        if (lk && (!iq.navAt || Date.now() - iq.navAt > 15000)) { iq.navAt = Date.now(); saveIQ(iq); (lk.closest('a') || lk).click(); }
        else if (!lk && onSmsPage()) { toQueue(); return; }
      }
      if (!iBusy) iDraw();
      return;
    }
    var q = Q(); if (!q) { box.style.display = 'none'; return; }
    var j = cur(q);
    if (onSmsPage() && location.pathname.length > 7) GM_setValue('hsSmsUrl', location.href);
    if (j && !busy && onSmsPage()) {
      if (j.state === 'new') { fill(q, j); return; }
      if (j.state === 'filled' && pressedAt && Date.now() - pressedAt < 120000) {
        var b = F.body(), c = F.count();
        if ((b && !b.value.trim()) || c === 0) { pressedAt = 0; markSent(true); return; }
      }
    }
    if (!busy) draw();
  };
  setInterval(tick, 1500);
  setTimeout(tick, 600);
})();
