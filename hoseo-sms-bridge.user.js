// ==UserScript==
// @name         호서대 늘봄 문자 보내기 (i-ONE 캠퍼스 연결)
// @namespace    hoseo-anchor-sms
// @version      0.1.1
// @description  「초등방과후 프로그램 운영 관리」에서 고른 문자를 i-ONE 캠퍼스 「메시지전송(문자)」 화면에 받는 사람·제목·내용까지 채워 줍니다. 보내기는 담당자가 직접 누릅니다.
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
  var VER = '0.1.1';
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
    var st = steps.map(function (s) { return '<div>' + (s[0] ? '✅' : '⚠️') + ' ' + s[1] + '</div>'; }).join('');
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
    if (/^(즉시\s*)?(전송|발송|보내기|문자\s*전송)$/.test(t)) pressedAt = Date.now();
  }, true);

  var tick = function () {
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
