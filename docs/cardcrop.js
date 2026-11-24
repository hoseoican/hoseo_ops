/* 신분증 · 카드 자르기: 네 모서리 점을 신분증 모서리에 맞추면 비스듬히 찍힌 사진도 반듯하게 펴서 신분증만 남김
   CardCrop.open(파일|Blob|이미지 주소, { title, ratio }) → Promise<canvas | null(취소)> */
(function (G) {
  'use strict';
  var CSS = '#ccrop{position:fixed;inset:0;z-index:2147483000;background:rgba(20,20,22,.78);display:flex;align-items:center;justify-content:center;font:14px/1.5 "Pretendard","Malgun Gothic",sans-serif}' +
    '#ccrop .cc-box{background:#fff;border-radius:14px;padding:14px;width:min(760px,96vw);max-height:96vh;display:flex;flex-direction:column;gap:10px;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
    '#ccrop .cc-h{display:flex;align-items:center;gap:8px}#ccrop .cc-h b{font-size:16px;flex:1}' +
    '#ccrop .cc-tip{font-size:13px;color:#555;margin:0}' +
    '#ccrop .cc-stage{position:relative;align-self:center;touch-action:none;user-select:none;-webkit-user-select:none}' +
    '#ccrop .cc-stage canvas{display:block;border-radius:6px}' +
    '#ccrop .cc-pt{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:3px solid #fff;background:rgba(140,29,34,.9);box-shadow:0 1px 6px rgba(0,0,0,.5);cursor:grab;touch-action:none}' +
    '#ccrop .cc-loupe{position:absolute;width:110px;height:110px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.45);pointer-events:none;display:none;left:8px;top:8px}' +
    '#ccrop .cc-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '#ccrop .cc-prev{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#666}#ccrop .cc-prev canvas{border:1px solid #ddd;border-radius:6px;background:#f4f4f4}' +
    '#ccrop button{font:inherit;font-size:13.5px;padding:7px 14px;border-radius:8px;border:1px solid #ccc;background:#fff;color:#222;cursor:pointer}' +
    '#ccrop button.pri{background:#8c1d22;border-color:#8c1d22;color:#fff}';

  function loadSrc(src) {
    return new Promise(function (res, rej) {
      var im = new Image(), u = typeof src === 'string' ? src : URL.createObjectURL(src);
      im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('사진을 읽지 못했습니다. JPG·PNG 사진으로 골라 주세요.')); }; im.src = u;
    });
  }
  /* 사각형(0,0)-(w,h) → 원본 사각형 네 점으로 보내는 투영 변환 */
  function homography(w, h, q) {
    var S = [[0, 0], [w, 0], [w, h], [0, h]], A = [], B = [];
    for (var i = 0; i < 4; i++) {
      var x = S[i][0], y = S[i][1], u = q[i][0], v = q[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
    }
    for (var c = 0; c < 8; c++) {
      var p = c; for (var r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      var t = A[c]; A[c] = A[p]; A[p] = t; t = B[c]; B[c] = B[p]; B[p] = t;
      for (r = 0; r < 8; r++) { if (r === c) continue; var f = A[r][c] / A[c][c]; if (!f) continue; for (var k = c; k < 8; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
    }
    return B.map(function (b, i) { return b / A[i][i]; });
  }
  function warp(srcCanvas, q, W, H) {
    var sw = srcCanvas.width, sh = srcCanvas.height, sd = srcCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;
    var out = document.createElement('canvas'); out.width = W; out.height = H;
    var g = out.getContext('2d'), od = g.createImageData(W, H), o = od.data, m = homography(W, H, q);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var d = m[6] * x + m[7] * y + 1, u = (m[0] * x + m[1] * y + m[2]) / d, v = (m[3] * x + m[4] * y + m[5]) / d;
      var x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0, i = (y * W + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = 255; continue; }
      var a = (y0 * sw + x0) * 4, b = a + 4, c = a + sw * 4, e = c + 4;
      for (var k = 0; k < 3; k++) o[i + k] = (sd[a + k] * (1 - fx) + sd[b + k] * fx) * (1 - fy) + (sd[c + k] * (1 - fx) + sd[e + k] * fx) * fy;
      o[i + 3] = 255;
    }
    g.putImageData(od, 0, 0); return out;
  }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  function open(src, opt) {
    opt = opt || {};
    var ratio = opt.ratio || 1.586; /* 신분증 85.6×54mm */
    return loadSrc(src).then(function (im) {
      return new Promise(function (resolve) {
        if (!document.getElementById('ccrop-css')) { var st = document.createElement('style'); st.id = 'ccrop-css'; st.textContent = CSS; document.head.appendChild(st); }
        /* 원본을 작업용 캔버스로(긴 변 2400px까지) */
        var src0 = document.createElement('canvas'), s0 = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight));
        src0.width = Math.round(im.naturalWidth * s0); src0.height = Math.round(im.naturalHeight * s0); src0.getContext('2d').drawImage(im, 0, 0, src0.width, src0.height);
        var work = src0, q = null, scale = 1;
        var ov = document.createElement('div'); ov.id = 'ccrop';
        ov.innerHTML = '<div class="cc-box" role="dialog" aria-label="' + (opt.title || '신분증 자르기') + '"><div class="cc-h"><b>' + (opt.title || '신분증만 남기기') + '</b></div>' +
          '<p class="cc-tip">빨간 점 네 개를 <b>신분증 네 모서리</b>에 하나씩 끌어다 맞춰 주세요. 비스듬히 찍혀도 반듯하게 펴서 신분증만 남깁니다.</p>' +
          '<div class="cc-stage"><canvas class="cc-cv"></canvas><canvas class="cc-loupe" width="110" height="110"></canvas></div>' +
          '<div class="cc-foot"><div class="cc-prev"><canvas class="cc-pv" width="160" height="101"></canvas><span>결과 미리보기</span></div><span style="flex:1"></span>' +
          '<button type="button" data-cc="rot">돌리기</button><button type="button" data-cc="reset">처음 위치</button><button type="button" data-cc="no">취소</button><button type="button" class="pri" data-cc="ok">이대로 자르기</button></div></div>';
        document.body.appendChild(ov);
        var stage = ov.querySelector('.cc-stage'), cv = ov.querySelector('.cc-cv'), lp = ov.querySelector('.cc-loupe'), pv = ov.querySelector('.cc-pv'), pts = [];
        for (var i = 0; i < 4; i++) { var p = document.createElement('div'); p.className = 'cc-pt'; p.dataset.i = i; stage.appendChild(p); pts.push(p); }
        function initQ() { var w = work.width, h = work.height, bw = w * .8, bh = bw / ratio; if (bh > h * .8) { bh = h * .8; bw = bh * ratio; } var x = (w - bw) / 2, y = (h - bh) / 2; q = [[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]]; }
        function layout() {
          var maxW = Math.min(730, window.innerWidth * .92) , maxH = window.innerHeight * .6;
          scale = Math.min(maxW / work.width, maxH / work.height, 3);
          cv.width = Math.round(work.width * scale); cv.height = Math.round(work.height * scale); draw();
        }
        function outSize() { var w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2, L = 1000; return w >= h ? [L, Math.round(L * Math.min(h / w, 1))] : [Math.round(L * Math.min(w / h, 1)), L]; }
        var pvT = 0;
        function draw() {
          var g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(work, 0, 0, cv.width, cv.height);
          g.save(); g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.rect(0, 0, cv.width, cv.height);
          g.moveTo(q[0][0] * scale, q[0][1] * scale); for (var k = 3; k >= 0; k--) g.lineTo(q[k][0] * scale, q[k][1] * scale); g.closePath(); g.fill('evenodd');
          g.strokeStyle = '#ffd34d'; g.lineWidth = 2; g.beginPath(); q.forEach(function (c, k) { g[k ? 'lineTo' : 'moveTo'](c[0] * scale, c[1] * scale); }); g.closePath(); g.stroke(); g.restore();
          pts.forEach(function (p, k) { p.style.left = (q[k][0] * scale) + 'px'; p.style.top = (q[k][1] * scale) + 'px'; });
          clearTimeout(pvT); pvT = setTimeout(function () { var os = outSize(), f = Math.min(160 / os[0], 101 / os[1]), r = warp(work, q, Math.max(8, Math.round(os[0] * f)), Math.max(8, Math.round(os[1] * f))); pv.width = r.width; pv.height = r.height; pv.getContext('2d').drawImage(r, 0, 0); }, 60);
        }
        function loupe(k) {
          var g = lp.getContext('2d'), z = 3, c = q[k], r = 55 / z / scale;
          g.clearRect(0, 0, 110, 110); g.save(); g.beginPath(); g.arc(55, 55, 55, 0, Math.PI * 2); g.clip();
          g.drawImage(work, c[0] - r, c[1] - r, r * 2, r * 2, 0, 0, 110, 110);
          g.strokeStyle = '#e11'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(55, 40); g.lineTo(55, 70); g.moveTo(40, 55); g.lineTo(70, 55); g.stroke(); g.restore();
          lp.style.display = 'block'; lp.style.left = (c[0] * scale < cv.width / 2 ? cv.width - 118 : 8) + 'px';
        }
        var drag = -1;
        stage.addEventListener('pointerdown', function (e) {
          var t = e.target.closest('.cc-pt'), rc = cv.getBoundingClientRect(), x = (e.clientX - rc.left) / scale, y = (e.clientY - rc.top) / scale;
          if (t) drag = +t.dataset.i; else { var b = 0, bd = 1e9; q.forEach(function (c, k) { var d = dist(c, [x, y]); if (d < bd) { bd = d; b = k; } }); drag = b; q[drag] = [x, y]; draw(); }
          stage.setPointerCapture(e.pointerId); loupe(drag); e.preventDefault();
        });
        stage.addEventListener('pointermove', function (e) {
          if (drag < 0) return; var rc = cv.getBoundingClientRect();
          q[drag] = [Math.max(0, Math.min(work.width, (e.clientX - rc.left) / scale)), Math.max(0, Math.min(work.height, (e.clientY - rc.top) / scale))]; draw(); loupe(drag);
        });
        function up() { drag = -1; lp.style.display = 'none'; }
        stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
        function close(v) { window.removeEventListener('resize', layout); ov.remove(); resolve(v); }
        ov.addEventListener('click', function (e) {
          var b = e.target.closest('[data-cc]'); if (!b) return; var a = b.dataset.cc;
          if (a === 'no') close(null);
          else if (a === 'reset') { initQ(); draw(); }
          else if (a === 'rot') { var r = document.createElement('canvas'); r.width = work.height; r.height = work.width; var g = r.getContext('2d'); g.translate(r.width, 0); g.rotate(Math.PI / 2); g.drawImage(work, 0, 0); work = r; initQ(); layout(); }
          else if (a === 'ok') {
            /* 점 순서가 뒤섞여도 왼쪽 위부터 시계 방향으로 다시 정렬 */
            var cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
            var s = q.slice().sort(function (a1, b1) { return Math.atan2(a1[1] - cy, a1[0] - cx) - Math.atan2(b1[1] - cy, b1[0] - cx); });
            var st0 = 0, best = 1e18; s.forEach(function (c, k) { var v = c[0] + c[1]; if (v < best) { best = v; st0 = k; } }); q = s.slice(st0).concat(s.slice(0, st0));
            var os = outSize(); close(warp(work, q, os[0], os[1]));
          }
        });
        window.addEventListener('resize', layout);
        initQ(); layout();
      });
    });
  }
  G.CardCrop = { open: open };
})(window);
