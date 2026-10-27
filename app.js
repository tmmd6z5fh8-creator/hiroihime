/* ひろい姫 — UI */
(function () {
  'use strict';
  var C = window.HH_CALC;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  var PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var FONT = "'Zen Kaku Gothic New','Hiragino Sans','Noto Sans JP',sans-serif";
  var FACE_NAMES = ['南面', '東面', '北面', '西面', '妻面', 'その他'];
  var SUBS = {
    opening: [['window', '窓'], ['door', 'ドア']],
    corner: [['out', '出隅'], ['in', '入隅']],
    line: [['parapet', '笠木下水切り'], ['middle', '中間水切り'], ['band', '幕板'], ['other', 'その他見切り']],
    obst: [['hood', '換気フード'], ['pipe', '配管貫通'], ['meter', 'メーター'], ['gutter', '樋金具'], ['ac', 'エアコン配管'], ['other', 'その他']]
  };
  var HINTS = {
    face: '部位と階を選んで、壁の角を順にタップ → 「閉じる」（1点目に戻ってタップでもOK）',
    opening: '窓・ドアの対角2点をタップ（面の内側に）',
    corner: '角の上端 → 下端の2点をタップ。各角は1回だけ',
    line: '水切り・見切りの始点 → 終点をタップ',
    obst: '障害物の位置をタップ',
    measure: '2点をタップすると距離が出るよ（記録はしない）',
    erase: '消したい要素をタップ'
  };
  var SPEC_FIELDS = [
    { g: '張り方・ロス', k: 'direction', l: '張り方向', t: 'select', o: [['yoko', '横張り（縦胴縁）'], ['tate', '縦張り（横胴縁）']] },
    { g: '張り方・ロス', k: 'lossBody', l: '本体ロス %' }, { g: '張り方・ロス', k: 'lossTrim', l: '役物ロス %' }, { g: '張り方・ロス', k: 'lossFurring', l: '胴縁ロス %' },
    { g: '張り方・ロス', k: 'openingDeduct', l: '開口控除 ㎡以上', s: 0.1 },
    { g: '張り方・ロス', k: 'jointMode', l: '目地ジョイント', t: 'select', o: [['through', '通し目地（長尺）'], ['stagger', '千鳥（ピース）']] },
    { g: '下地・断熱', k: 'furringPitch', l: '胴縁ピッチ mm' },
    { g: '下地・断熱', k: 'furringEnds', l: '上下端の横胴縁', t: 'bool' },
    { g: '下地・断熱', k: 'insulMode', l: '外張り断熱', t: 'select', o: [['integrated', '断熱一体型（裏打ち）'], ['board', '断熱ボード別貼り']] },
    { g: '下地・断熱', k: 'existingThk', l: '既存外壁厚 mm' }, { g: '下地・断熱', k: 'embed', l: '躯体への埋込 mm' }, { g: '下地・断熱', k: 'screwPitch', l: 'ビスピッチ mm' },
    { g: '下地・断熱', k: 'wrap', l: '透湿防水シート', t: 'bool' },
    { g: '下地・断熱', k: 'overhead', l: '諸経費 %' }
  ];

  var state = {
    src: null, pdf: null, pages: {}, page: 1, zoom: 1, step: 1,
    tool: 'face', sub: { opening: 'window', corner: 'out', line: 'parapet', obst: 'hood' }, draft: [],
    faces: [], corners: [], lines: [], obstacles: [],
    scale: { mmPerPx: null, method: '2pt', ratio: 100, pts: [] },
    spec: Object.assign({}, C.DEFAULT_SPEC, LS.get('hh.spec', {})),
    mat: C.mergeMat(LS.get('hh.mat', {})),
    labor: LS.get('hh.labor', {}),
    overrides: {}, lens: {}, lensOpen: {}, partSel: 'wall', floorSel: '', nextId: 1, faceIdx: 0, restored: null, lastRows: [], lastParts: []
  };
  state.spec.obst = Object.assign({}, C.DEFAULT_SPEC.obst, state.spec.obst || {});
  var history = [];

  var base = $('#base'), overlay = $('#overlay'), stageScroll = $('#stageScroll'), stageInner = $('#stageInner');
  var toastT = null;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return 'e' + (state.nextId++); }
  function fmtQ(v) { return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100); }
  function yen(v) { return '¥' + Math.round(v).toLocaleString('ja-JP'); }
  function mtr(mm) { return (Math.round(mm / 100) / 10).toFixed(1); }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#f00'; }

  // ---------- 保存・復元
  function persist() {
    LS.set('hh.project', {
      srcName: state.src ? state.src.name : (state.restored ? state.restored.name : ''),
      scale: { mmPerPx: state.scale.mmPerPx, method: state.scale.method, ratio: state.scale.ratio },
      faces: state.faces, corners: state.corners, lines: state.lines, obstacles: state.obstacles,
      overrides: state.overrides, lens: state.lens, nextId: state.nextId, faceIdx: state.faceIdx
    });
  }
  function restore() {
    var s = LS.get('hh.project', null);
    if (!s) return;
    var n = (s.faces || []).length + (s.corners || []).length + (s.lines || []).length + (s.obstacles || []).length + Object.keys(s.lens || {}).length;
    if (!n) return;
    state.faces = s.faces || []; state.corners = s.corners || []; state.lines = s.lines || []; state.obstacles = s.obstacles || [];
    state.overrides = s.overrides || {}; state.lens = s.lens || {}; state.nextId = s.nextId || 1; state.faceIdx = s.faceIdx || 0;
    if (s.scale && s.scale.mmPerPx) { state.scale.mmPerPx = s.scale.mmPerPx; state.scale.method = s.scale.method || '2pt'; state.scale.ratio = s.scale.ratio || 100; }
    state.restored = { name: s.srcName || '（名前なし）', faces: state.faces.length };
    $('#restoreText').textContent = '前回の拾いを復元中：' + state.restored.name + '（面' + state.faces.length + '・開口' + state.faces.reduce(function (a, f) { return a + f.openings.length; }, 0) + '）。同じ図面を読み込むと図面上に出るよ。';
    $('#restoreBanner').hidden = false;
  }
  function snapshot() {
    history.push(JSON.stringify({ faces: state.faces, corners: state.corners, lines: state.lines, obstacles: state.obstacles, draft: state.draft, faceIdx: state.faceIdx }));
    if (history.length > 40) history.shift();
  }
  function undo() {
    if (!history.length) { toast('戻せる操作がないよ'); return; }
    var s = JSON.parse(history.pop());
    state.faces = s.faces; state.corners = s.corners; state.lines = s.lines; state.obstacles = s.obstacles; state.draft = s.draft; state.faceIdx = s.faceIdx;
    afterChange(); toast('1つ戻したよ');
  }
  function afterChange() { redraw(); renderElements(); updateDrawCtl(); persist(); if (state.step === 5) renderDetail(); }

  // ---------- 図面読込
  function loadFile(file) {
    if (!file) return;
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    toast('読み込み中…');
    var p = isPdf ? loadPdf(file) : loadImage(file);
    p.then(function () {
      $('#srcInfo').textContent = file.name + '（' + (state.src.kind === 'pdf' ? state.src.pageCount + 'ページ' : '画像') + '）';
      $('#stageEmpty').hidden = true; state.zoom = 1; applyZoom();
      if (state.restored && state.restored.name !== file.name) toast('前回とは別の図面みたい。合わなければ「破棄」で消してね');
      else toast('読み込んだよ。次はスケール合わせ');
      if (!state.scale.mmPerPx) setStep(2); else { setStep(state.step < 3 ? 3 : state.step); }
      renderScalePanel(); renderSteps();
    }).catch(function (e) {
      console.error(e);
      toast(isPdf ? 'PDFを読めなかった…図面をスクショして画像で読み込んでみて' : '画像を読めなかった…別の形式で試してみて');
    });
  }
  function loadPdf(file) {
    if (!window.pdfjsLib) return Promise.reject(new Error('pdfjs missing'));
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
    return file.arrayBuffer().then(function (buf) {
      return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (doc) {
      state.pdf = doc; state.pages = {};
      state.src = { kind: 'pdf', name: file.name, pageCount: doc.numPages };
      return renderPage(1);
    });
  }
  function renderPage(n) {
    if (state.pages[n]) { showPage(n); return Promise.resolve(); }
    return state.pdf.getPage(n).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 });
      var baseScale = Math.min(4, Math.max(1, 2400 / vp1.width));
      var vp = page.getViewport({ scale: baseScale });
      var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        state.pages[n] = { canvas: c, width: c.width, height: c.height, ptPerPx: 1 / baseScale };
        showPage(n);
      });
    });
  }
  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(1, 2400 / img.naturalWidth);
        var c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        state.pdf = null; state.src = { kind: 'image', name: file.name, pageCount: 1 };
        state.pages = { 1: { canvas: c, width: c.width, height: c.height, ptPerPx: null } };
        showPage(1); res();
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('image')); };
      img.src = url;
    });
  }
  function showPage(n) {
    var pg = state.pages[n]; if (!pg) return;
    state.page = n;
    base.width = pg.width; base.height = pg.height; base.getContext('2d').drawImage(pg.canvas, 0, 0);
    overlay.width = pg.width; overlay.height = pg.height;
    $('#pageLabel').textContent = n + ' / ' + state.src.pageCount;
    $('#pager').hidden = state.src.pageCount <= 1;
    applyZoom();
  }
  function gotoPage(d) {
    if (!state.src || state.src.kind !== 'pdf') return;
    var n = state.page + d; if (n < 1 || n > state.src.pageCount) return;
    state.draft = []; renderPage(n).then(function () { updateDrawCtl(); renderElements(); });
  }

  // ---------- 表示・ズーム
  function applyZoom() {
    if (!state.src) return;
    var fit = (stageScroll.clientWidth || 360) / base.width, w = base.width * fit * state.zoom, h = base.height * fit * state.zoom;
    [base, overlay].forEach(function (c) { c.style.width = w + 'px'; c.style.height = h + 'px'; });
    stageInner.style.width = w + 'px'; stageInner.style.height = h + 'px';
    redraw();
  }
  function setZoom(z) {
    z = Math.max(1, Math.min(8, z));
    if (!state.src) { state.zoom = z; return; }
    var r = base.getBoundingClientRect(), cx = (stageScroll.scrollLeft + stageScroll.clientWidth / 2) / (r.width || 1), cy = (stageScroll.scrollTop + stageScroll.clientHeight / 2) / (r.height || 1);
    state.zoom = z; applyZoom();
    var r2 = base.getBoundingClientRect();
    stageScroll.scrollLeft = cx * r2.width - stageScroll.clientWidth / 2;
    stageScroll.scrollTop = cy * r2.height - stageScroll.clientHeight / 2;
  }
  function k() { var r = base.getBoundingClientRect(); return base.width / Math.max(1, r.width); } // 図面px / 表示px
  function toBase(e) { var r = base.getBoundingClientRect(); return { x: (e.clientX - r.left) * base.width / r.width, y: (e.clientY - r.top) * base.height / r.height }; }

  function redraw() {
    var ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!state.src) return;
    var kk = k(), lw = 2 * kk, fs = 12 * kk, pg = state.page, mm = state.scale.mmPerPx;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.font = '600 ' + fs + 'px ' + FONT; ctx.textBaseline = 'middle';
    var col = { face: cssVar('steel'), window: cssVar('win'), door: cssVar('door'), out: cssVar('cout'), 'in': cssVar('cin'), line: cssVar('flash'), obst: cssVar('obst'), draft: cssVar('draft'), hb: cssVar('hint-bg'), hi: cssVar('hint-ink') };
    function label(text, x, y, color) {
      var w = ctx.measureText(text).width + 10 * kk, h = fs * 1.5;
      ctx.fillStyle = color; ctx.globalAlpha = 0.92; ctx.fillRect(x - w / 2, y - h / 2, w, h); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(text, x, y);
    }
    function dot(x, y, color, r) { ctx.beginPath(); ctx.arc(x, y, r || 4 * kk, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = lw * 0.6; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    function poly(pts, color, close, dash) {
      if (!pts.length) return;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (close) ctx.closePath();
      ctx.setLineDash(dash ? [6 * kk, 5 * kk] : []); ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]);
    }
    state.faces.forEach(function (f) {
      if (f.page !== pg) return;
      ctx.beginPath(); ctx.moveTo(f.pts[0].x, f.pts[0].y); f.pts.forEach(function (p) { ctx.lineTo(p.x, p.y); }); ctx.closePath();
      ctx.fillStyle = col.face; ctx.globalAlpha = 0.10; ctx.fill(); ctx.globalAlpha = 1;
      poly(f.pts, col.face, true);
      var cx = 0, cy = 0; f.pts.forEach(function (p) { cx += p.x; cy += p.y; }); cx /= f.pts.length; cy /= f.pts.length;
      var g = mm ? C.faceGeometry(f, mm) : null;
      label(f.name + ' ' + C.partOf(f.part || 'wall').short + (f.floor ? f.floor : '') + (g ? ' ' + C.r2(g.grossArea / 1e6) + '㎡' : '') + (f.include === false ? '（対象外）' : ''), cx, cy, col.face);
      f.openings.forEach(function (o) {
        var c = o.type === 'door' ? col.door : col.window, x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2), w = Math.abs(o.x2 - o.x1), h = Math.abs(o.y2 - o.y1);
        ctx.fillStyle = c; ctx.globalAlpha = 0.18; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
        ctx.lineWidth = lw; ctx.strokeStyle = c; ctx.strokeRect(x, y, w, h);
        if (mm) { var d = C.openingDims(o, mm); label((o.type === 'door' ? 'D ' : 'W ') + mtr(d.w) + '×' + mtr(d.h), x + w / 2, y + h / 2, c); }
      });
    });
    state.corners.forEach(function (c) {
      if (c.page !== pg) return; var color = c.type === 'out' ? col.out : col['in'];
      poly([{ x: c.x, y: c.y1 }, { x: c.x, y: c.y2 }], color, false); dot(c.x, c.y1, color); dot(c.x, c.y2, color);
      if (mm) label((c.type === 'out' ? '出隅 ' : '入隅 ') + mtr(Math.abs(c.y2 - c.y1) * mm), c.x, (c.y1 + c.y2) / 2, color);
    });
    state.lines.forEach(function (l) {
      if (l.page !== pg) return;
      poly([{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }], col.line, false); dot(l.x1, l.y1, col.line); dot(l.x2, l.y2, col.line);
      if (mm) label(C.LINE_LABEL[l.type] + ' ' + mtr(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * mm), (l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2, col.line);
    });
    state.obstacles.forEach(function (o) {
      if (o.page !== pg) return; dot(o.x, o.y, col.obst, 7 * kk); label(C.OBST_LABEL[o.type], o.x, o.y - 14 * kk, col.obst);
    });
    // スケール点
    var sp = state.scale.pts.filter(function (p) { return p.page === pg; });
    if (state.step === 2 && sp.length) {
      poly(sp, col.draft, false, true);
      sp.forEach(function (p, i) { dot(p.x, p.y, col.draft, 6 * kk); label('点' + (i + 1), p.x, p.y - 14 * kk, col.draft); });
    }
    // 作図中
    if (state.draft.length) {
      poly(state.draft, col.draft, false, true);
      if (state.tool === 'face' && state.draft.length >= 3) poly([state.draft[state.draft.length - 1], state.draft[0]], col.draft, false, true);
      if (state.tool === 'opening' && state.draft.length === 1) dot(state.draft[0].x, state.draft[0].y, col.draft, 6 * kk);
      state.draft.forEach(function (p, i) { dot(p.x, p.y, col.draft, 5 * kk); if (state.tool === 'face') label(String(i + 1), p.x, p.y - 13 * kk, col.draft); });
    }
  }

  // ---------- タップ処理
  var down = null;
  stageInner.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  stageInner.addEventListener('pointerup', function (e) {
    if (!down) return; var d = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = Date.now() - down.t; down = null;
    if (d > 10 || dt > 700) return; onTap(e);
  });
  stageInner.addEventListener('pointercancel', function () { down = null; });

  function snapR() { return 14 * k(); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function anchors() {
    var a = []; state.faces.forEach(function (f) { if (f.page === state.page) a = a.concat(f.pts); }); return a;
  }
  function snap(p, ref, anc) {
    var R = snapR(), best = null, bd = R;
    (anc || []).forEach(function (q) { var d = dist(p, q); if (d < bd) { bd = d; best = q; } });
    if (best) return { x: best.x, y: best.y };
    var x = p.x, y = p.y;
    if (ref) { if (Math.abs(x - ref.x) < R) x = ref.x; if (Math.abs(y - ref.y) < R) y = ref.y; }
    return { x: x, y: y };
  }
  function pointInPoly(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function distSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
  }
  function onTap(e) {
    if (!state.src) return;
    var p = toBase(e);
    if (state.step === 2) {
      if (state.scale.method !== '2pt') { toast('「2点合わせ」を選ぶと図面上に点を打てるよ'); return; }
      var pts = state.scale.pts; if (pts.length >= 2) pts.length = 0;
      var sp = pts.length ? snap(p, pts[0]) : p; pts.push({ x: sp.x, y: sp.y, page: state.page });
      redraw(); renderScalePanel(); return;
    }
    if (state.step !== 3) { if (state.step === 1) setStep(3); else return; }
    if (!state.scale.mmPerPx && state.tool !== 'erase') { toast('先に②でスケールを合わせてね'); setStep(2); return; }
    var last = state.draft[state.draft.length - 1], R = snapR();
    switch (state.tool) {
      case 'face':
        if (state.draft.length >= 3 && dist(p, state.draft[0]) < R) { closeFace(); return; }
        state.draft.push(snap(p, last, anchors())); break;
      case 'opening':
        state.draft.push(last ? snap(p, last) : p);
        if (state.draft.length === 2) { addOpening(state.draft[0], state.draft[1]); state.draft = []; }
        break;
      case 'corner':
        state.draft.push(last ? { x: last.x, y: snap(p, null, anchors()).y } : snap(p, null, anchors()));
        if (state.draft.length === 2) { addCorner(state.draft[0], state.draft[1]); state.draft = []; }
        break;
      case 'line':
        state.draft.push(last ? snap(p, last) : snap(p, null, anchors()));
        if (state.draft.length === 2) { addLine(state.draft[0], state.draft[1]); state.draft = []; }
        break;
      case 'measure':
        state.draft.push(last ? snap(p, last) : p);
        if (state.draft.length === 2) { toast('距離 ' + mtr(dist(state.draft[0], state.draft[1]) * state.scale.mmPerPx) + ' m'); state.draft = []; }
        break;
      case 'obst':
        snapshot(); state.obstacles.push({ id: uid(), page: state.page, type: state.sub.obst, x: p.x, y: p.y }); break;
      case 'erase': eraseAt(p); break;
    }
    afterChange();
  }
  function closeFace() {
    if (state.draft.length < 3) { toast('角を3点以上タップしてね'); return; }
    snapshot();
    var name = ($('#faceName').value || '').trim() || FACE_NAMES[Math.min(state.faceIdx, FACE_NAMES.length - 1)];
    var part = $('#facePart').value || 'wall', floor = $('#faceFloor').value || '', dfl = C.faceDefaults(part, floor);
    state.faces.push({ id: uid(), page: state.page, name: name, part: part, floor: floor, include: true, bottomAs: dfl.bottom, topAs: dfl.top, pts: state.draft.map(function (p) { return { x: p.x, y: p.y }; }), openings: [] });
    state.draft = []; state.faceIdx++;
    $('#faceName').value = FACE_NAMES[Math.min(state.faceIdx, FACE_NAMES.length - 1)];
    toast(name + '（' + C.partOf(part).short + (floor ? ' ' + floor : '') + '）を登録したよ。続けて開口を拾ってね');
    afterChange();
  }
  function faceAt(p) {
    var hit = null; state.faces.forEach(function (f) { if (f.page === state.page && pointInPoly(p, f.pts)) hit = f; });
    if (!hit) { var onPage = state.faces.filter(function (f) { return f.page === state.page; }); hit = onPage[onPage.length - 1] || null; }
    return hit;
  }
  function addOpening(a, b) {
    var f = faceAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    if (!f) { toast('先に面（壁の輪郭）を作ってね'); return; }
    if (Math.abs(a.x - b.x) < 2 || Math.abs(a.y - b.y) < 2) { toast('対角の2点をタップしてね'); return; }
    snapshot(); f.openings.push({ id: uid(), type: state.sub.opening, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  function addCorner(a, b) {
    if (Math.abs(a.y - b.y) < 5) { toast('上端と下端の2点をタップしてね'); return; }
    snapshot(); state.corners.push({ id: uid(), page: state.page, type: state.sub.corner, x: a.x, y1: a.y, y2: b.y });
  }
  function addLine(a, b) {
    if (dist(a, b) < 5) return;
    snapshot(); state.lines.push({ id: uid(), page: state.page, type: state.sub.line, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  function eraseAt(p) {
    var pg = state.page, R = snapR() * 1.3, i;
    i = state.obstacles.findIndex(function (o) { return o.page === pg && dist(o, p) < R; });
    if (i >= 0) { snapshot(); state.obstacles.splice(i, 1); toast('障害物を消したよ'); return; }
    i = state.corners.findIndex(function (c) { return c.page === pg && distSeg(p, { x: c.x, y: c.y1 }, { x: c.x, y: c.y2 }) < R; });
    if (i >= 0) { snapshot(); state.corners.splice(i, 1); toast('角を消したよ'); return; }
    i = state.lines.findIndex(function (l) { return l.page === pg && distSeg(p, { x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }) < R; });
    if (i >= 0) { snapshot(); state.lines.splice(i, 1); toast('線を消したよ'); return; }
    for (var fi = 0; fi < state.faces.length; fi++) {
      var f = state.faces[fi]; if (f.page !== pg) continue;
      var oi = f.openings.findIndex(function (o) { return p.x >= Math.min(o.x1, o.x2) && p.x <= Math.max(o.x1, o.x2) && p.y >= Math.min(o.y1, o.y2) && p.y <= Math.max(o.y1, o.y2); });
      if (oi >= 0) { snapshot(); f.openings.splice(oi, 1); toast('開口を消したよ'); return; }
    }
    i = state.faces.findIndex(function (f) { return f.page === pg && pointInPoly(p, f.pts); });
    if (i >= 0) { snapshot(); var rf = state.faces.splice(i, 1)[0]; toast(rf.name + 'を消したよ（開口' + rf.openings.length + 'も一緒に）'); return; }
    toast('近くに消せる要素がないよ');
  }

  // ---------- パネル描画
  function renderSteps() {
    $$('#steps button').forEach(function (b) {
      var n = Number(b.dataset.step); b.setAttribute('aria-current', n === state.step ? 'step' : 'false');
      var done = (n === 1 && !!state.src) || (n === 2 && !!state.scale.mmPerPx) || (n === 3 && state.faces.length > 0);
      b.classList.toggle('done', done);
    });
  }
  function setStep(n) {
    var wasHidden = $('#stage').hidden;
    state.step = n; state.draft = [];
    for (var i = 1; i <= 5; i++) $('#p' + i).hidden = i !== n;
    $('#stage').hidden = n > 3;
    renderSteps(); updateHint(); updateDrawCtl();
    if (n <= 3 && state.src && wasHidden) applyZoom(); else redraw();
    if (n === 3) renderElements();
    if (n === 4) renderSpecForm();
    if (n === 5) renderDetail();
  }
  function updateHint() {
    var h = $('#hint');
    if (!state.src) { h.hidden = true; return; }
    h.hidden = false;
    if (state.step === 1) h.textContent = '読み込みOK。②でスケール合わせへ';
    else if (state.step === 2) h.textContent = state.scale.method === '2pt' ? '寸法が分かる2点をタップ（例：寸法線の両端）' : '下の「適用」を押してね';
    else if (state.step === 3) { var t = HINTS[state.tool] || ''; if (['opening', 'corner', 'line', 'obst'].indexOf(state.tool) >= 0) t = '【' + subLabel(state.tool, state.sub[state.tool]) + '】' + t; h.textContent = t; }
    else h.hidden = true;
  }
  function subLabel(tool, id) { var e = (SUBS[tool] || []).filter(function (x) { return x[0] === id; })[0]; return e ? e[1] : id; }
  function updateDrawCtl() {
    var dc = $('#drawctl'); dc.hidden = !(state.step === 3 && state.src && state.draft.length > 0);
    $('#closeFace').hidden = state.tool !== 'face';
  }
  function renderTools() {
    $$('#tools button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tool === state.tool ? 'true' : 'false'); });
    var subs = SUBS[state.tool] || [], el = $('#subtools');
    el.innerHTML = subs.map(function (s) { return '<button type="button" data-sub="' + s[0] + '" aria-pressed="' + (state.sub[state.tool] === s[0]) + '">' + s[1] + '</button>'; }).join('');
    el.hidden = !subs.length;
    $('#faceNameRow').hidden = state.tool !== 'face';
    updateHint(); updateDrawCtl();
  }
  function renderScalePanel() {
    var sc = state.scale, st = $('#scaleStatus');
    if (sc.mmPerPx) { st.className = 'status ok'; st.innerHTML = '設定済み：図面1px ＝ <b>' + C.r2(sc.mmPerPx) + '</b> mm（' + (sc.method === '2pt' ? '2点合わせ' : '尺度 1/' + sc.ratio) + '）'; }
    else { st.className = 'status'; st.textContent = '未設定。図面上で2点をタップして実寸を入れてね'; }
    $$('#scaleMethod button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.m === sc.method ? 'true' : 'false'); });
    $('#scale2pt').style.display = sc.method === '2pt' ? 'grid' : 'none';
    $('#scaleRatio').style.display = sc.method === 'ratio' ? 'grid' : 'none';
    var n = sc.pts.length;
    $('#dot1').classList.toggle('on', n >= 1); $('#dot2').classList.toggle('on', n >= 2);
    $('#dotDist').textContent = n === 2 ? '図面上 ' + Math.round(dist(sc.pts[0], sc.pts[1])) + 'px' : '';
    $('#applyScale').disabled = !(n === 2 && Number($('#scaleMM').value) > 0);
    updateHint();
  }
  function applyScale2pt() {
    var sc = state.scale, mmv = Number($('#scaleMM').value);
    if (sc.pts.length !== 2 || !(mmv > 0)) return;
    if (sc.pts[0].page !== sc.pts[1].page) { toast('2点は同じページでタップしてね'); return; }
    var d = dist(sc.pts[0], sc.pts[1]); if (d < 5) { toast('2点が近すぎるよ'); return; }
    sc.mmPerPx = mmv / d; sc.method = '2pt'; persist(); renderScalePanel(); renderSteps(); afterChange();
    toast('スケールOK。③で壁の輪郭から拾ってね'); setStep(3);
  }
  function applyRatio() {
    var pg = state.pages[state.page]; if (!pg || !pg.ptPerPx) { toast('画像は尺度が分からないので2点合わせを使ってね'); return; }
    var ratio = Number($('#ratioSel').value) || 100;
    state.scale.mmPerPx = pg.ptPerPx * 25.4 / 72 * ratio; state.scale.ratio = ratio; state.scale.method = 'ratio';
    persist(); renderScalePanel(); renderSteps(); afterChange(); toast('1/' + ratio + 'として設定したよ。③の「測る」で確認してね'); setStep(3);
  }

  function renderElements() {
    var mm = state.scale.mmPerPx, el = $('#elist'), h = '', nOpen = 0;
    var dotc = function (v) { return '<span class="dot" style="background:var(--' + v + ')"></span>'; };
    var opts = function (list, cur) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); };
    var partOpts = C.PARTS.map(function (p) { return [p.key, p.label]; });
    state.faces.forEach(function (f) {
      var g = mm ? C.faceGeometry(f, mm) : null; nOpen += f.openings.length;
      var part = f.part || 'wall', floor = f.floor || '', dfl = C.faceDefaults(part, floor), inc = f.include !== false;
      h += '<div class="fcard' + (inc ? '' : ' off') + '">';
      h += '<div class="erow">' + dotc('steel') + '<input class="ename" type="text" data-face="' + f.id + '" value="' + esc(f.name) + '" aria-label="面の名前"><span class="num">' + (g ? mtr(g.W) + '×' + mtr(g.H) + 'm ' + C.r2(g.grossArea / 1e6) + '㎡' : '') + '</span><span class="pg">p' + f.page + '</span><button type="button" class="del" data-del="face:' + f.id + '" aria-label="削除">×</button></div>';
      h += '<div class="fctl"><select data-fpart="' + f.id + '" aria-label="部位">' + opts(partOpts, part) + '</select><select data-ffloor="' + f.id + '" aria-label="階">' + opts(C.FLOORS, floor) + '</select>' +
        '<select data-fbottom="' + f.id + '" aria-label="下辺の扱い">' + opts(C.EDGE_BOTTOM, f.bottomAs || dfl.bottom) + '</select><select data-ftop="' + f.id + '" aria-label="上辺の扱い">' + opts(C.EDGE_TOP, f.topAs || dfl.top) + '</select>' +
        '<button type="button" class="tiny" data-finc="' + f.id + '" aria-pressed="' + inc + '">' + (inc ? '積算に含める' : '対象外（参考のみ）') + '</button></div>';
      f.openings.forEach(function (o) {
        var d = mm ? C.openingDims(o, mm) : null;
        h += '<div class="erow sub">' + dotc(o.type === 'door' ? 'door' : 'win') + '<button type="button" class="tiny" data-toggle="' + o.id + '">' + (o.type === 'door' ? 'ドア' : '窓') + '</button><span class="num">' + (d ? mtr(d.w) + '×' + mtr(d.h) + 'm ' + C.r2(d.w * d.h / 1e6) + '㎡' : '') + '</span><button type="button" class="del" data-del="open:' + o.id + '" aria-label="削除">×</button></div>';
      });
      h += '</div>';
    });
    state.corners.forEach(function (c) {
      h += '<div class="erow">' + dotc(c.type === 'out' ? 'cout' : 'cin') + '<span>' + (c.type === 'out' ? '出隅' : '入隅') + '</span><span class="num">' + (mm ? '高さ ' + mtr(Math.abs(c.y2 - c.y1) * mm) + 'm' : '') + '</span><span class="pg">p' + c.page + '</span><button type="button" class="del" data-del="corner:' + c.id + '" aria-label="削除">×</button></div>';
    });
    state.lines.forEach(function (l) {
      h += '<div class="erow">' + dotc('flash') + '<span>' + C.LINE_LABEL[l.type] + '</span><span class="num">' + (mm ? mtr(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * mm) + 'm' : '') + '</span><span class="pg">p' + l.page + '</span><button type="button" class="del" data-del="line:' + l.id + '" aria-label="削除">×</button></div>';
    });
    var oc = {}; state.obstacles.forEach(function (o) { oc[o.type] = (oc[o.type] || 0) + 1; });
    Object.keys(oc).forEach(function (t) {
      h += '<div class="erow">' + dotc('obst') + '<span>' + C.OBST_LABEL[t] + '</span><span class="num">× ' + oc[t] + '</span><button type="button" class="del" data-del="obst:' + t + '" aria-label="1つ削除">×</button></div>';
    });
    el.innerHTML = h || '<p class="muted">まだ何も拾ってないよ。図面をタップして壁の輪郭から始めてね。</p>';
    var res = C.compute(state), s = $('#esum');
    if (res.ok) {
      var outN = state.corners.filter(function (c) { return c.type === 'out'; }).length;
      s.innerHTML = '<span>面 <b>' + state.faces.length + '</b></span><span>有効面積 <b>' + res.info.net + '</b>㎡</span><span>開口 <b>' + nOpen + '</b></span><span>出隅 <b>' + outN + '</b> 入隅 <b>' + (state.corners.length - outN) + '</b></span><span>外周 <b>' + res.info.perim + '</b>m</span>';
    } else s.innerHTML = '';
    renderSteps();
  }

  // ---------- 仕様・材料マスタ
  function renderSpecForm() {
    var form = $('#specForm'); if (form.dataset.built) { return; }
    var groups = {}; SPEC_FIELDS.forEach(function (f) { (groups[f.g] = groups[f.g] || []).push(f); });
    var h = '';
    Object.keys(groups).forEach(function (g) {
      h += '<fieldset><legend>' + g + '</legend><div class="grid2">';
      groups[g].forEach(function (f) {
        var v = state.spec[f.k], id = 'sp-' + f.k;
        h += '<div class="field"><label for="' + id + '">' + f.l + '</label>';
        if (f.t === 'select') h += '<select id="' + id + '" data-spec="' + f.k + '">' + f.o.map(function (o) { return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
        else if (f.t === 'bool') h += '<select id="' + id + '" data-spec="' + f.k + '" data-bool="1"><option value="1"' + (v ? ' selected' : '') + '>含める</option><option value="0"' + (!v ? ' selected' : '') + '>含めない</option></select>';
        else h += '<input id="' + id + '" type="number" inputmode="decimal" step="' + (f.s || 1) + '" data-spec="' + f.k + '" value="' + esc(v) + '">';
        h += '</div>';
      });
      h += '</div></fieldset>';
    });
    h += '<fieldset><legend>障害物まわりの見切り周長（m/箇所）</legend><div class="grid2">';
    Object.keys(C.OBST_LABEL).forEach(function (t) { h += '<div class="field"><label for="ob-' + t + '">' + C.OBST_LABEL[t] + '</label><input id="ob-' + t + '" type="number" inputmode="decimal" step="0.1" data-obst="' + t + '" value="' + esc(state.spec.obst[t]) + '"></div>'; });
    h += '</div></fieldset>';
    h += '<h2>材料マスタ</h2><p class="muted">使う部材のメーカー・品番・サイズ・単価を部材ごとに記録。定尺や働き幅は明細の計算にそのまま使うよ。</p>';
    var lastG = '';
    C.MAT_DEF.forEach(function (d) {
      if (d.group !== lastG) { lastG = d.group; h += '<p class="muted" style="margin-top:4px;font-weight:700">' + d.group + '</p>'; }
      var m = state.mat[d.key];
      h += '<details class="mat" data-mat="' + d.key + '"><summary><span>' + d.label + '</span><span class="num" id="matsum-' + d.key + '">' + esc(matSummary(d, m)) + '</span></summary><div class="grid2" style="margin-top:8px">';
      C.MAT_TEXT_FIELDS.forEach(function (f) {
        h += '<div class="field"' + (f[0] === 'note' || f[0] === 'size' ? ' style="grid-column:1/-1"' : '') + '><label for="m-' + d.key + '-' + f[0] + '">' + f[1] + '</label><input id="m-' + d.key + '-' + f[0] + '" type="text" data-mk="' + d.key + '" data-mf="' + f[0] + '" value="' + esc(m[f[0]]) + '"></div>';
      });
      d.fields.forEach(function (f) {
        h += '<div class="field"><label for="m-' + d.key + '-' + f[0] + '">' + f[1] + '</label><input id="m-' + d.key + '-' + f[0] + '" type="number" inputmode="decimal" step="any" data-mk="' + d.key + '" data-mf="' + f[0] + '" value="' + esc(m[f[0]]) + '"></div>';
      });
      h += '<div class="field"><label for="m-' + d.key + '-price">材料単価 円/' + d.unit + '</label><input id="m-' + d.key + '-price" type="number" inputmode="decimal" step="any" data-mk="' + d.key + '" data-mf="price" value="' + esc(m.price) + '"></div>';
      h += '</div></details>';
    });
    h += '<div class="row" style="margin-top:6px"><button type="button" class="btn" id="copyMat">マスタをコピー（他の端末へ）</button><button type="button" class="btn" id="showImport">マスタを貼り付けて取込</button></div>';
    h += '<div id="importBox" hidden style="display:grid;gap:6px"><textarea id="importText" rows="4" style="font:inherit;font-size:14px;padding:8px;border:1px solid var(--line-2);border-radius:6px;background:var(--paper);color:var(--ink)" placeholder="コピーしたマスタをここに貼り付け"></textarea><button type="button" class="btn primary" id="doImport">取り込む</button></div>';
    form.innerHTML = h; form.dataset.built = '1';
  }
  function matSummary(d, m) {
    var parts = [];
    if (m.maker || m.name) parts.push([m.maker, m.name].filter(Boolean).join(' '));
    var dims = d.fields.map(function (f) { return m[f[0]]; }).filter(function (v) { return v !== '' && v != null && Number(v) !== 0; });
    if (dims.length) parts.push(dims.join('×'));
    if (m.price) parts.push(Number(m.price).toLocaleString('ja-JP') + '円');
    return parts.join('　') || '未登録';
  }
  function matLine(key) {
    var d = C.MAT_DEF.filter(function (x) { return x.key === key; })[0]; if (!d) return '';
    var m = state.mat[key], parts = [m.maker, m.name, m.color].filter(Boolean);
    var dims = d.fields.map(function (f) { return m[f[0]]; }).filter(function (v) { return v !== '' && v != null && Number(v) !== 0; }).join('×');
    if (m.size) parts.push(m.size); else if (dims) parts.push(dims);
    return parts.join(' ');
  }
  function onSpecInput(e) {
    var t = e.target;
    if (t.dataset.spec) {
      var v = t.value; if (t.dataset.bool) v = v === '1'; else if (t.type === 'number') v = v === '' ? C.DEFAULT_SPEC[t.dataset.spec] : Number(v);
      state.spec[t.dataset.spec] = v; LS.set('hh.spec', state.spec);
    } else if (t.dataset.obst) { state.spec.obst[t.dataset.obst] = Number(t.value) || 0; LS.set('hh.spec', state.spec); }
    else if (t.dataset.mk) {
      state.mat[t.dataset.mk][t.dataset.mf] = t.type === 'number' ? (t.value === '' ? '' : Number(t.value)) : t.value;
      LS.set('hh.mat', state.mat);
      var d = C.MAT_DEF.filter(function (x) { return x.key === t.dataset.mk; })[0];
      $('#matsum-' + t.dataset.mk).textContent = matSummary(d, state.mat[t.dataset.mk]);
    }
  }

  // ---------- 明細
  function renderDetail() {
    var res = C.compute(state), wrap = $('#detail'), ds = $('#dsum'), fsum = $('#faceSummary');
    state.lastRows = res.rows; state.lastParts = res.parts;
    var i = res.info;
    ds.innerHTML = ['有効面積', i.net + '<small>㎡</small>', '本体', i.sheets + '<small>枚</small>', '外周', i.perim + '<small>m</small>', '開口', i.openN + '<small>箇所</small>', '出隅', i.outN + '<small>箇所</small>'].reduce(function (a, v, idx, arr) { return idx % 2 ? a + '<div class="stat"><span>' + arr[idx - 1] + '</span><b>' + v + '</b></div>' : a; }, '');
    var h = '';
    if (!res.scaled) h += '<div class="banner">スケール未設定なので図面からの数量は0。各行の「長さの手拾い」に入れた長さだけで計算しているよ。</div>';
    // 部位別集計
    h += '<details open><summary style="font-weight:700;font-size:14px;cursor:pointer">部位別集計（' + res.parts.length + '区分' + (i.excluded ? '・対象外' + i.excluded + '面' : '') + '）</summary>';
    if (res.parts.length) {
      h += '<div class="tbl-wrap"><table class="parts"><thead><tr><th>部位</th><th>階</th><th>面</th><th class="num">総㎡</th><th class="num">控除㎡</th><th class="num">有効㎡</th><th class="num">本体枚</th></tr></thead><tbody>';
      var tg = 0, td = 0, tn = 0, ts = 0;
      res.parts.forEach(function (p) {
        if (p.include) { tg += p.gross; td += p.deducted; tn += p.net; ts += p.sheets; }
        h += '<tr class="' + (p.include ? '' : 'zero') + '"><td>' + esc(p.label) + (p.include ? '' : '（対象外）') + '</td><td>' + (p.floor || '—') + '</td><td><span class="note">' + esc(p.names.join('・')) + '</span></td><td class="num">' + p.gross + '</td><td class="num">' + p.deducted + '</td><td class="num">' + p.net + '</td><td class="num">' + (p.include ? p.sheets : '—') + '</td></tr>';
      });
      h += '<tr class="grp"><td colspan="3">合計（対象のみ）</td><td class="num">' + C.r2(tg) + '</td><td class="num">' + C.r2(td) + '</td><td class="num">' + C.r2(tn) + '</td><td class="num">' + ts + '</td></tr></tbody></table></div>';
      h += '<p class="muted">部位ごとの枚数は区分ごとに切り上げた参考値。発注は下の明細（全体を合算してから切り上げ）を使ってね。</p>';
    } else h += '<p class="muted">③で面を拾うと部位ごとに出るよ。</p>';
    h += '</details>';
    fsum.innerHTML = res.faces.map(function (f) { return esc(f.name) + '〔' + esc(f.partShort) + (f.floor ? f.floor : '') + '〕' + mtr(f.W) + '×' + mtr(f.H) + 'm 総' + C.r2(f.gross) + '㎡ 控除' + C.r2(f.deducted) + '㎡ → <b class="num">' + C.r2(f.net) + '㎡</b>' + (f.include ? '' : '（対象外）'); }).join('　／　');
    // 明細（合算）
    h += '<h2 style="font-size:14px;margin-top:6px">明細（全部位 合算）</h2>';
    h += '<div class="tbl-wrap"><table><thead><tr><th>項目</th><th class="num">自動</th><th class="num">採用</th><th>単位</th><th class="num">材料単価</th><th class="num">手間単価</th><th class="num">金額</th></tr></thead><tbody>';
    var g = '';
    res.rows.forEach(function (r) {
      if (r.group !== g) { g = r.group; h += '<tr class="grp"><td colspan="7">' + g + '</td></tr>'; }
      var ov = state.overrides[r.key], qty = (ov !== undefined && ov !== '' && ov !== null) ? Number(ov) : r.qty;
      var pm = r.mat ? Number(state.mat[r.mat].price) || 0 : 0, pl = Number((state.labor[r.key] || 0)) || 0, ml = r.mat ? matLine(r.mat) : '';
      h += '<tr class="' + (qty ? '' : 'zero') + '" data-row="' + r.key + '"><td><div>' + esc(r.name) + (r.manual ? ' <span style="color:var(--accent)">📏手拾い</span>' : '') + '</div>' + (ml ? '<div class="note" style="color:var(--steel)">' + esc(ml) + '</div>' : '') + '<div class="note">' + esc(r.note) + '</div></td>' +
        '<td class="num">' + fmtQ(r.qty) + '</td>' +
        '<td class="num"><input id="ov-' + r.key + '" type="number" inputmode="decimal" step="any" data-ov="' + r.key + '" value="' + (ov != null ? esc(ov) : '') + '" placeholder="' + fmtQ(r.qty) + '" aria-label="採用数量"></td>' +
        '<td>' + r.unit + '</td>' +
        '<td class="num">' + (r.mat ? '<input id="pm-' + r.key + '" type="number" inputmode="decimal" step="any" data-pm="' + r.mat + '" value="' + (state.mat[r.mat].price !== '' ? esc(state.mat[r.mat].price) : '') + '" placeholder="0" aria-label="材料単価">' : '—') + '</td>' +
        '<td class="num"><input id="pl-' + r.key + '" type="number" inputmode="decimal" step="any" data-pl="' + r.key + '" value="' + (state.labor[r.key] != null ? esc(state.labor[r.key]) : '') + '" placeholder="0" aria-label="手間単価"></td>' +
        '<td class="num amt">' + yen(qty * (pm + pl)) + '</td></tr>';
      if (r.len) h += lensEditor(r);
    });
    wrap.innerHTML = h + '</tbody></table></div>';
    updateAmounts();
  }
  // 行ごとの「長さの手拾い」エディタ（箇所名＋長さm を何件でも記録）
  function lensEditor(r) {
    var list = state.lens[r.key] || [], open = !!state.lensOpen[r.key];
    var sum = list.reduce(function (a, e) { return a + (Number(e.v) || 0); }, 0);
    var h = '<tr class="lens"><td colspan="7"><details data-lopen="' + r.key + '"' + (open ? ' open' : '') + '><summary>📏 長さの手拾い　' + (list.length ? list.length + '件・合計 ' + C.r1(sum) + 'm（自動 ' + r.autoLenM + 'm）' : '未入力（自動 ' + r.autoLenM + 'm' + (r.len.std > 0 ? '・定尺' + r.len.std : '') + '）') + '</summary><div class="lenlist">';
    list.forEach(function (e, idx) {
      h += '<div class="lenrow"><input type="text" id="ll-' + r.key + '-' + idx + '" data-llabel="' + r.key + ':' + idx + '" value="' + esc(e.label || '') + '" placeholder="箇所（例：南面 2F）"><input type="number" id="lv-' + r.key + '-' + idx + '" inputmode="decimal" step="0.01" data-lval="' + r.key + ':' + idx + '" value="' + esc(e.v == null ? '' : e.v) + '" placeholder="m"><span class="muted">m</span><button type="button" class="del" data-ldel="' + r.key + ':' + idx + '" aria-label="削除">×</button></div>';
    });
    h += '<div><button type="button" class="tiny" data-ladd="' + r.key + '">＋ 長さを追加</button>' + (r.len.perPiece ? '<span class="muted" style="margin-left:8px">1件＝1箇所で定尺に切り上げ</span>' : '<span class="muted" style="margin-left:8px">合計×ロス÷定尺で本数</span>') + '</div>';
    return h + '</div></details></td></tr>';
  }
  function rowQty(r) { var ov = state.overrides[r.key]; return (ov !== undefined && ov !== '' && ov !== null) ? Number(ov) : r.qty; }
  function updateAmounts() {
    var mat = 0, lab = 0;
    state.lastRows.forEach(function (r) {
      var qty = rowQty(r), pm = r.mat ? Number(state.mat[r.mat].price) || 0 : 0, pl = Number(state.labor[r.key]) || 0;
      mat += qty * pm; lab += qty * pl;
      var tr = $('tr[data-row="' + r.key + '"]'); if (tr) { $('.amt', tr).textContent = yen(qty * (pm + pl)); tr.classList.toggle('zero', !qty); }
    });
    var sub = mat + lab, oh = sub * (Number(state.spec.overhead) || 0) / 100, t = $('#totals');
    t.hidden = false;
    t.innerHTML = '<div><span>材料計</span><span>' + yen(mat) + '</span></div><div><span>手間計</span><span>' + yen(lab) + '</span></div><div><span>小計</span><span>' + yen(sub) + '</span></div><div><span>諸経費 ' + (Number(state.spec.overhead) || 0) + '%</span><span>' + yen(oh) + '</span></div><div class="grand"><span>合計（税別）</span><span>' + yen(sub + oh) + '</span></div>';
  }
  function copyText(text, ok) {
    var done = function () { toast(ok); }, fail = function () {
      try { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.focus(); ta.select(); var r = document.execCommand('copy'); document.body.removeChild(ta); r ? done() : toast('コピーできなかった…長押しで選択してね'); } catch (e) { toast('コピーできなかった…'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail); else fail();
  }
  function partsLines(sep) {
    var out = [['部位', '階', '面', '総㎡', '控除㎡', '有効㎡', '本体枚（参考）', '対象'].join(sep)], tg = 0, td = 0, tn = 0;
    state.lastParts.forEach(function (p) {
      if (p.include) { tg += p.gross; td += p.deducted; tn += p.net; }
      out.push([p.label, p.floor || '', p.names.join('・'), p.gross, p.deducted, p.net, p.include ? p.sheets : '', p.include ? '対象' : '対象外'].join(sep));
    });
    out.push(['合計（対象のみ）', '', '', C.r2(tg), C.r2(td), C.r2(tn), '', ''].join(sep));
    return out;
  }
  function buildTsv() {
    var lines = ['【部位別集計】'].concat(partsLines('\t'), ['', '【明細（全部位 合算）】', '項目\tメーカー・品名\tサイズ\t自動数量\t採用数量\t単位\t材料単価\t手間単価\t金額\t根拠']);
    state.lastRows.forEach(function (r) {
      var m = r.mat ? state.mat[r.mat] : null, qty = rowQty(r), pm = m ? Number(m.price) || 0 : 0, pl = Number(state.labor[r.key]) || 0;
      var d = m ? C.MAT_DEF.filter(function (x) { return x.key === r.mat; })[0] : null;
      var dims = d ? d.fields.map(function (f) { return m[f[0]]; }).filter(function (v) { return v !== '' && v != null && Number(v) !== 0; }).join('×') : '';
      lines.push([r.name, m ? [m.maker, m.name, m.color].filter(Boolean).join(' ') : '', m ? (m.size || dims) : '', fmtQ(r.qty), fmtQ(qty), r.unit, pm || '', pl || '', Math.round(qty * (pm + pl)), r.note].join('\t'));
    });
    return lines.join('\n');
  }
  function buildText() {
    var res = C.compute(state), out = ['【金属サイディング 拾い出し】' + (state.src ? state.src.name : (state.restored ? state.restored.name : '')), '有効面積 ' + res.info.net + '㎡（総' + res.info.gross + '㎡）／外周 ' + res.info.perim + 'm／開口 ' + res.info.openN + '箇所／出隅 ' + res.info.outN + '・入隅 ' + res.info.inN, ''];
    out.push('■ 部位別');
    state.lastParts.forEach(function (p) { out.push('　' + p.label + (p.floor ? ' ' + p.floor : '') + '：' + p.names.join('・') + '　有効' + p.net + '㎡（総' + p.gross + '・控除' + p.deducted + '）' + (p.include ? '' : '【対象外】')); });
    res.faces.forEach(function (f) { out.push('　　' + f.name + '〔' + f.partShort + (f.floor || '') + '〕' + mtr(f.W) + '×' + mtr(f.H) + 'm ' + C.r2(f.net) + '㎡（開口' + f.openings.length + '）' + (f.include ? '' : '【対象外】')); });
    out.push('　合計 有効' + res.info.net + '㎡');
    out.push('', '■ 合算 明細');
    var g = '';
    state.lastRows.forEach(function (r) {
      var qty = rowQty(r); if (!qty) return;
      if (r.group !== g) { g = r.group; out.push('▼ ' + g); }
      var ml = r.mat ? matLine(r.mat) : '';
      out.push('　' + r.name + '　' + fmtQ(qty) + r.unit + (ml ? '　' + ml : ''));
    });
    return out.join('\n');
  }

  // ---------- イベント
  $$('input[type=file]').forEach(function (i) { i.addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (f) loadFile(f); e.target.value = ''; }); });
  $('#steps').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setStep(Number(b.dataset.step)); });
  $('#zoomIn').addEventListener('click', function () { setZoom(state.zoom * 1.5); });
  $('#zoomOut').addEventListener('click', function () { setZoom(state.zoom / 1.5); });
  $('#zoomFit').addEventListener('click', function () { setZoom(1); });
  $('#prevPage').addEventListener('click', function () { gotoPage(-1); });
  $('#nextPage').addEventListener('click', function () { gotoPage(1); });
  $('#undoPt').addEventListener('click', function () { state.draft.pop(); redraw(); updateDrawCtl(); });
  $('#closeFace').addEventListener('click', closeFace);
  $('#undoBtn').addEventListener('click', undo);
  $('#discardRestore').addEventListener('click', function () { clearAll(true); $('#restoreBanner').hidden = true; state.restored = null; });
  $('#scaleMethod').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.scale.method = b.dataset.m; renderScalePanel(); redraw(); });
  $('#scaleMM').addEventListener('input', renderScalePanel);
  $('#applyScale').addEventListener('click', applyScale2pt);
  $('#resetScalePts').addEventListener('click', function () { state.scale.pts = []; renderScalePanel(); redraw(); });
  $('#applyRatio').addEventListener('click', applyRatio);
  $('#tools').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.tool = b.dataset.tool; state.draft = []; renderTools(); redraw(); });
  $('#subtools').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.sub[state.tool] = b.dataset.sub; renderTools(); });
  $('#elist').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.toggle) { snapshot(); state.faces.forEach(function (f) { f.openings.forEach(function (o) { if (o.id === b.dataset.toggle) o.type = o.type === 'door' ? 'window' : 'door'; }); }); afterChange(); return; }
    if (!b.dataset.del) return;
    var kind = b.dataset.del.split(':')[0], id = b.dataset.del.split(':')[1]; snapshot();
    if (kind === 'face') state.faces = state.faces.filter(function (f) { return f.id !== id; });
    else if (kind === 'open') state.faces.forEach(function (f) { f.openings = f.openings.filter(function (o) { return o.id !== id; }); });
    else if (kind === 'corner') state.corners = state.corners.filter(function (c) { return c.id !== id; });
    else if (kind === 'line') state.lines = state.lines.filter(function (l) { return l.id !== id; });
    else if (kind === 'obst') { var idx = -1; state.obstacles.forEach(function (o, i) { if (o.type === id) idx = i; }); if (idx >= 0) state.obstacles.splice(idx, 1); }
    afterChange();
  });
  $('#elist').addEventListener('change', function (e) {
    var t = e.target, id = t.dataset.face || t.dataset.fpart || t.dataset.ffloor || t.dataset.fbottom || t.dataset.ftop; if (!id) return;
    state.faces.forEach(function (f) {
      if (f.id !== id) return;
      if (t.dataset.face) f.name = t.value.trim() || f.name;
      else if (t.dataset.fpart || t.dataset.ffloor) {
        if (t.dataset.fpart) f.part = t.value; else f.floor = t.value;
        var d = C.faceDefaults(f.part || 'wall', f.floor || ''); f.bottomAs = d.bottom; f.topAs = d.top; // 部位を変えたら辺の扱いも既定に戻す
      }
      else if (t.dataset.fbottom) f.bottomAs = t.value;
      else if (t.dataset.ftop) f.topAs = t.value;
    });
    afterChange();
  });
  $('#elist').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-finc]'); if (!b) return;
    state.faces.forEach(function (f) { if (f.id === b.dataset.finc) f.include = f.include === false; });
    afterChange();
  });
  $('#facePart').innerHTML = C.PARTS.map(function (p) { return '<option value="' + p.key + '">' + p.label + '</option>'; }).join('');
  $('#faceFloor').innerHTML = C.FLOORS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
  var clearArmed = null;
  function clearAll(silent) {
    state.faces = []; state.corners = []; state.lines = []; state.obstacles = []; state.draft = []; state.overrides = {}; state.lens = {}; state.lensOpen = {}; state.faceIdx = 0; history.length = 0;
    $('#faceName').value = FACE_NAMES[0]; LS.del('hh.project'); afterChange(); if (!silent) toast('全部消したよ');
  }
  $('#clearAll').addEventListener('click', function () {
    var b = $('#clearAll');
    if (clearArmed) { clearTimeout(clearArmed); clearArmed = null; b.textContent = '全部消す'; clearAll(); return; }
    b.textContent = 'もう一度押すと消えるよ'; clearArmed = setTimeout(function () { clearArmed = null; b.textContent = '全部消す'; }, 3000);
  });
  $('#toDetail').addEventListener('click', function () { setStep(5); });
  $('#specForm').addEventListener('input', onSpecInput);
  $('#specForm').addEventListener('change', onSpecInput);
  $('#specForm').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'copyMat') copyText(JSON.stringify({ spec: state.spec, mat: state.mat, labor: state.labor }), 'マスタをコピーしたよ。別の端末で「貼り付けて取込」');
    else if (b.id === 'showImport') $('#importBox').hidden = !$('#importBox').hidden;
    else if (b.id === 'doImport') {
      try {
        var j = JSON.parse($('#importText').value);
        if (j.spec) { state.spec = Object.assign({}, C.DEFAULT_SPEC, j.spec); state.spec.obst = Object.assign({}, C.DEFAULT_SPEC.obst, j.spec.obst || {}); LS.set('hh.spec', state.spec); }
        if (j.mat) { state.mat = C.mergeMat(j.mat); LS.set('hh.mat', state.mat); }
        if (j.labor) { state.labor = j.labor; LS.set('hh.labor', state.labor); }
        $('#specForm').dataset.built = ''; renderSpecForm(); toast('マスタを取り込んだよ');
      } catch (err) { toast('貼り付けた内容を読めなかった…コピーし直してみて'); }
    }
  });
  $('#detail').addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.ov !== undefined) { if (t.value === '') delete state.overrides[t.dataset.ov]; else state.overrides[t.dataset.ov] = t.value; persist(); }
    else if (t.dataset.pm) { state.mat[t.dataset.pm].price = t.value === '' ? '' : Number(t.value); LS.set('hh.mat', state.mat); $$('input[data-pm="' + t.dataset.pm + '"]').forEach(function (i) { if (i !== t) i.value = t.value; }); }
    else if (t.dataset.pl) { state.labor[t.dataset.pl] = t.value === '' ? '' : Number(t.value); LS.set('hh.labor', state.labor); }
    else return;
    updateAmounts();
  });
  $('#detail').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ladd) { (state.lens[b.dataset.ladd] = state.lens[b.dataset.ladd] || []).push({ label: '', v: '' }); state.lensOpen[b.dataset.ladd] = true; persist(); renderDetail(); var nx = $('#lv-' + b.dataset.ladd + '-' + (state.lens[b.dataset.ladd].length - 1)); if (nx) nx.focus(); }
    else if (b.dataset.ldel) { var p = b.dataset.ldel.split(':'); if (state.lens[p[0]]) { state.lens[p[0]].splice(Number(p[1]), 1); if (!state.lens[p[0]].length) delete state.lens[p[0]]; } persist(); renderDetail(); }
  });
  $('#detail').addEventListener('change', function (e) {
    var t = e.target, key = t.dataset.llabel || t.dataset.lval; if (!key) return;
    var p = key.split(':'), list = state.lens[p[0]]; if (!list || !list[Number(p[1])]) return;
    if (t.dataset.llabel) list[Number(p[1])].label = t.value; else list[Number(p[1])].v = t.value === '' ? '' : Number(t.value);
    state.lensOpen[p[0]] = true; persist(); renderDetail();
  });
  $('#detail').addEventListener('toggle', function (e) { var d = e.target; if (d.dataset && d.dataset.lopen) state.lensOpen[d.dataset.lopen] = d.open; }, true);
  $('#copyTsv').addEventListener('click', function () { if (!state.lastRows.length) { toast('明細がまだないよ'); return; } copyText(buildTsv(), 'Excelに貼り付けられる形でコピーしたよ'); });
  $('#copyText').addEventListener('click', function () { if (!state.lastRows.length) { toast('明細がまだないよ'); return; } copyText(buildText(), 'テキストでコピーしたよ'); });
  window.addEventListener('resize', applyZoom);
  if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', redraw); else if (mq.addListener) mq.addListener(redraw); }

  // ---------- 起動
  restore();
  renderTools(); renderScalePanel(); renderElements(); setStep(1);
  if (state.restored) { $('#srcInfo').textContent = '前回：' + state.restored.name + '（図面は再読込してね）'; }
})();
