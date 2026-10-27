/* ひろい姫 — 積算ロジック（純関数）。座標は図面ピクセル、mmPerPx で実寸に変換する。 */
(function (root) {
  'use strict';

  var DEFAULT_SPEC = {
    direction: 'yoko',      // yoko=横張り(縦胴縁) / tate=縦張り(横胴縁)
    lossBody: 12, lossTrim: 10, lossFurring: 8,   // %
    openingDeduct: 0.5,     // ㎡以上の開口を面積控除
    furringPitch: 455,      // 胴縁ピッチ mm
    furringEnds: true,      // 上下端の横受け胴縁を含める
    insulMode: 'integrated',// integrated=断熱一体型 / board=断熱ボード別貼り
    existingThk: 30,        // 既存外壁厚 mm
    embed: 40,              // 躯体への埋込 mm
    screwPitch: 303,        // ビスピッチ mm
    jointMode: 'through',   // through=通し目地 / stagger=千鳥ピース
    wrap: false,            // 透湿防水シートを拾う
    overhead: 10,           // 諸経費 %
    obst: { hood: 0.8, pipe: 0.4, meter: 1.0, gutter: 0, ac: 0.3, other: 0.5 } // 障害物まわり見切り m/箇所
  };

  // 材料マスタ定義（表示順）。fields: [key, label, default]
  var MAT_DEF = [
    { key: 'body', group: '本体', label: '金属サイディング 本体', unit: '枚', fields: [['workWidth', '働き幅 mm', 370], ['len', '定尺長 mm', 3788], ['thick', '厚み mm', 15], ['perCase', 'ケース入数 枚', 8]] },
    { key: 'insul', group: '本体', label: '外張り断熱ボード（別貼り時）', unit: '枚', fields: [['thick', '厚み mm', 50], ['w', '幅 mm', 910], ['len', '長さ mm', 1820]] },
    { key: 'wrap', group: '本体', label: '透湿防水シート', unit: '巻', fields: [['w', '幅 mm', 1000], ['len', '長さ m/巻', 50]] },
    { key: 'furring', group: '下地', label: '下地胴縁', unit: '本', fields: [['w', '幅 mm', 45], ['thick', '厚み mm', 18], ['len', '定尺 mm', 4000]] },
    { key: 'screw', group: '下地', label: '胴縁ビス', unit: '箱', fields: [['len', '長さ mm', 0], ['dia', '径 mm', 0], ['perCase', '入数 本/箱', 0]] },
    { key: 'baseFlash', group: '水切り', label: '土台水切り', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'baseCorner', group: '水切り', label: '土台水切り コーナー役物', unit: '個', fields: [] },
    { key: 'parapetFlash', group: '水切り', label: '笠木下水切り', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'middleFlash', group: '水切り', label: '中間水切り', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'eaveTrim', group: '見切り', label: '軒天見切り（上部張りじまい）', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'winTop', group: '見切り', label: '窓上水切り', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'winSide', group: '見切り', label: '開口 左右見切り', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'winBot', group: '見切り', label: '窓下水切り', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'band', group: '見切り', label: '幕板', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'otherTrim', group: '見切り', label: 'その他見切り（障害物まわり含む）', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'cornerOut', group: '役物', label: '出隅材', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'cornerCap', group: '役物', label: '出隅キャップ', unit: '個', fields: [] },
    { key: 'cornerIn', group: '役物', label: '入隅材', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'joint', group: '役物', label: '目地ジョイナー', unit: '本', fields: [['len', '定尺 mm', 3030]] },
    { key: 'sealant', group: '付帯', label: 'シーリング材', unit: '本', fields: [['cov', '使用量 m/本', 4]] }
  ];
  var MAT_TEXT_FIELDS = [['maker', 'メーカー'], ['name', '品名・品番'], ['color', '色・柄'], ['size', 'サイズ・形状（自由記入）'], ['note', '備考']];

  // 部位（面の種類）。bottom/top はその面の下辺・上辺を何として拾うかの既定値
  //   bottom: base=土台水切り / middle=中間水切り / none=拾わない
  //   top:    eave=軒天見切り（上部張りじまい） / parapet=笠木下水切り / none=拾わない
  var PARTS = [
    { key: 'wall', label: '外壁 一般部', short: '外壁', bottom: 'base', top: 'eave' },
    { key: 'gable', label: '妻三角（切妻・片流れの三角部）', short: '妻三角', bottom: 'none', top: 'eave' },
    { key: 'geya', label: '下屋まわり（1階屋根上の壁）', short: '下屋', bottom: 'none', top: 'eave' },
    { key: 'balcony_out', label: 'ベランダ手すり壁 外側', short: 'ベランダ外', bottom: 'middle', top: 'parapet' },
    { key: 'balcony_in', label: 'ベランダ手すり壁 内側', short: 'ベランダ内', bottom: 'none', top: 'none' },
    { key: 'roofbal_out', label: 'ルーフバルコニー手すり壁 外側', short: 'ルーフバル外', bottom: 'middle', top: 'parapet' },
    { key: 'roofbal_in', label: 'ルーフバルコニー手すり壁 内側', short: 'ルーフバル内', bottom: 'none', top: 'none' },
    { key: 'garage', label: 'ビルトインガレージ 内部壁', short: 'ガレージ', bottom: 'base', top: 'eave' },
    { key: 'porch', label: '玄関ポーチ 柱型・壁', short: 'ポーチ', bottom: 'base', top: 'eave' },
    { key: 'baywindow', label: '出窓まわり', short: '出窓', bottom: 'middle', top: 'eave' },
    { key: 'dormer', label: 'ドーマー・小屋裏', short: 'ドーマー', bottom: 'none', top: 'eave' },
    { key: 'parapet', label: 'パラペット立ち上がり（陸屋根）', short: 'パラペット', bottom: 'none', top: 'parapet' },
    { key: 'sodekabe', label: '袖壁・目隠し壁', short: '袖壁', bottom: 'base', top: 'parapet' },
    { key: 'stairwell', label: '階段室・吹抜け外壁', short: '階段室', bottom: 'none', top: 'eave' },
    { key: 'annex', label: '離れ・物置・別棟', short: '別棟', bottom: 'base', top: 'eave' },
    { key: 'other', label: 'その他', short: 'その他', bottom: 'base', top: 'eave' }
  ];
  var FLOORS = [['', '階なし／全体'], ['1F', '1階'], ['2F', '2階'], ['3F', '3階']];
  var EDGE_BOTTOM = [['base', '土台水切り'], ['middle', '中間水切り'], ['none', '下辺なし']];
  var EDGE_TOP = [['eave', '軒天見切り'], ['parapet', '笠木下水切り'], ['none', '上辺なし']];
  function partOf(key) { return PARTS.filter(function (p) { return p.key === key; })[0] || PARTS[0]; }
  // 部位＋階からの既定値。階で分けた面は、階の境目を二重に拾わないようにする
  function faceDefaults(part, floor) {
    var p = partOf(part), d = { bottom: p.bottom, top: p.top };
    if (part === 'wall' || part === 'other' || part === 'annex') {
      if (floor === '2F' || floor === '3F') d.bottom = 'none';
      if (floor === '1F') d.top = 'none';
    }
    return d;
  }
  var OBST_LABEL = { hood: '換気フード', pipe: '配管貫通', meter: 'メーター', gutter: '樋金具', ac: 'エアコン配管', other: 'その他' };
  var LINE_LABEL = { parapet: '笠木下水切り', middle: '中間水切り', band: '幕板', other: 'その他見切り' };

  function defaultMat() {
    var m = {};
    MAT_DEF.forEach(function (d) {
      var r = { maker: '', name: '', color: '', size: '', note: '', price: '' };
      d.fields.forEach(function (f) { r[f[0]] = f[2]; });
      m[d.key] = r;
    });
    return m;
  }
  function mergeMat(mat) {
    var base = defaultMat();
    if (mat) Object.keys(base).forEach(function (k) { if (mat[k]) Object.assign(base[k], mat[k]); });
    return base;
  }
  function num(v, d) { var n = Number(v); return isFinite(n) && v !== '' && v !== null ? n : (d || 0); }
  function sum(arr, f) { return arr.reduce(function (s, x) { return s + (f ? f(x) : x); }, 0); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function mtr(mm) { return r1(mm / 1000); }
  function pcs(lenMM, loss, stdLen) { return stdLen > 0 && lenMM > 0 ? Math.ceil(lenMM * loss / stdLen) : 0; }

  // 面ポリゴンの幾何：幅・高さ・面積・底辺・上辺（軒先や登り）・縦辺
  function faceGeometry(face, mm) {
    var pts = (face.pts || []).map(function (p) { return { x: p.x * mm, y: p.y * mm }; });
    if (pts.length < 3 || !(mm > 0)) return { W: 0, H: 0, grossArea: 0, bottom: 0, top: 0, vert: 0 };
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var W = maxX - minX, H = maxY - minY;
    var a = 0, i, p, q;
    for (i = 0; i < pts.length; i++) { p = pts[i]; q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
    a = Math.abs(a) / 2;
    var bottom = 0, top = 0, vert = 0, tol = Math.max(H * 0.04, 40);
    for (i = 0; i < pts.length; i++) {
      p = pts[i]; q = pts[(i + 1) % pts.length];
      var dx = q.x - p.x, dy = q.y - p.y, len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      if (Math.abs(dx) <= len * 0.18) vert += len;                   // ほぼ垂直 → 角
      else if (maxY - p.y <= tol && maxY - q.y <= tol) bottom += len; // 最下段 → 下辺
      else top += len;                                                // それ以外 → 上辺（軒先・登り）
    }
    if (bottom <= 0) bottom = W;
    return { W: W, H: H, grossArea: a, bottom: bottom, top: top, vert: vert };
  }
  function openingDims(o, mm) { return { w: Math.abs(o.x2 - o.x1) * mm, h: Math.abs(o.y2 - o.y1) * mm }; }

  function compute(state) {
    var mm = state.scale && state.scale.mmPerPx, scaled = !!(mm && mm > 0);
    if (!scaled) mm = 0;
    var S = Object.assign({}, DEFAULT_SPEC, state.spec || {});
    S.obst = Object.assign({}, DEFAULT_SPEC.obst, (state.spec && state.spec.obst) || {});
    var M = mergeMat(state.mat), lens = state.lens || {};
    var rows = [];
    // lenInfo: { len: 自動延長mm(ロス前), loss, std: 定尺mm, perPiece: 箇所ごとに切上げ }
    function add(key, group, name, qty, unit, note, matKey, lenInfo) {
      rows.push({ key: key, group: group, name: name, qty: isFinite(qty) ? qty : 0, unit: unit, note: note || '', mat: matKey || null, len: lenInfo || null });
    }

    var faces = (state.faces || []).map(function (f) {
      var g = faceGeometry(f, mm);
      var part = f.part || 'wall', floor = f.floor || '', inc = f.include !== false, dfl = faceDefaults(part, floor);
      var openings = (f.openings || []).map(function (o) {
        var d = openingDims(o, mm), area = d.w * d.h / 1e6;
        return { id: o.id, type: o.type, w: d.w, h: d.h, area: area, deduct: area >= num(S.openingDeduct, 0) };
      });
      var deducted = sum(openings, function (o) { return o.deduct ? o.area : 0; });
      var gross = g.grossArea / 1e6;
      return { id: f.id, name: f.name, page: f.page, part: part, partLabel: partOf(part).label, partShort: partOf(part).short, floor: floor, include: inc,
        bottomAs: f.bottomAs || dfl.bottom, topAs: f.topAs || dfl.top,
        W: g.W, H: g.H, gross: gross, bottom: g.bottom, top: g.top, openings: openings, deducted: deducted, net: Math.max(0, gross - deducted) };
    });
    var active = faces.filter(function (f) { return f.include; });
    var allOpen = [].concat.apply([], active.map(function (f) { return f.openings; }));
    var windows = allOpen.filter(function (o) { return o.type !== 'door'; });
    var doors = allOpen.filter(function (o) { return o.type === 'door'; });
    var corners = (state.corners || []).map(function (c) { return { type: c.type, h: Math.abs(c.y2 - c.y1) * mm }; });
    var outs = corners.filter(function (c) { return c.type === 'out'; }), ins = corners.filter(function (c) { return c.type === 'in'; });
    var lines = (state.lines || []).map(function (l) { return { type: l.type, len: Math.sqrt(Math.pow(l.x2 - l.x1, 2) + Math.pow(l.y2 - l.y1, 2)) * mm }; });
    function lineLen(t) { return sum(lines.filter(function (l) { return l.type === t; }), function (l) { return l.len; }); }
    var obst = state.obstacles || [];

    var lossB = 1 + num(S.lossBody) / 100, lossT = 1 + num(S.lossTrim) / 100, lossF = 1 + num(S.lossFurring) / 100;
    var net = sum(active, function (f) { return f.net; }), gross = sum(active, function (f) { return f.gross; });
    var perim = sum(active, function (f) { return f.bottomAs === 'base' ? f.bottom : 0; });
    var middleF = sum(active, function (f) { return f.bottomAs === 'middle' ? f.bottom : 0; });
    var eave = sum(active, function (f) { return f.topAs === 'eave' ? f.top : 0; });
    var parapetF = sum(active, function (f) { return f.topAs === 'parapet' ? f.top : 0; });
    var maxH = active.length ? Math.max.apply(null, active.map(function (f) { return f.H; })) : 0;
    var yoko = S.direction !== 'tate';

    // ---- 本体
    var wW = num(M.body.workWidth), pL = num(M.body.len), perCase = Math.max(1, num(M.body.perCase, 1));
    var sheetArea = wW * pL / 1e6, orderArea = net * lossB;
    var sheets = sheetArea > 0 ? Math.ceil(orderArea / sheetArea) : 0, cases = Math.ceil(sheets / perCase);
    var layoutSheets = sum(active, function (f) {
      return wW > 0 && pL > 0 ? (yoko ? Math.ceil(f.H / wW) * Math.ceil(f.W / pL) : Math.ceil(f.W / wW) * Math.ceil(f.H / pL)) : 0;
    });
    add('body', '本体', '金属サイディング 本体', sheets, '枚',
      '有効' + r2(net) + '㎡ × ロス' + num(S.lossBody) + '% ＝ ' + r2(orderArea) + '㎡ ÷ ' + r2(sheetArea) + '㎡/枚（働き幅' + wW + '×' + pL + '）｜ 割付法 ' + layoutSheets + '枚 ｜ ' + cases + 'ケース（' + perCase + '枚入）', 'body');
    add('body_labor', '本体', '本体 張り手間', r2(net), '㎡', '総面積' + r2(gross) + '㎡ − 開口控除' + r2(gross - net) + '㎡（' + num(S.openingDeduct) + '㎡以上を控除）');
    if (S.insulMode === 'board') {
      var bw = num(M.insul.w), bl = num(M.insul.len), bArea = net * 1.05, bSheet = bw * bl / 1e6;
      if (bSheet > 0) add('insul', '本体', '外張り断熱ボード ' + num(M.insul.thick) + 'mm', Math.ceil(bArea / bSheet), '枚', r2(bArea) + '㎡（有効面積×1.05）÷ ' + r2(bSheet) + '㎡/枚', 'insul');
      else add('insul', '本体', '外張り断熱ボード ' + num(M.insul.thick) + 'mm', r2(bArea), '㎡', '有効面積×1.05', 'insul');
    }
    if (S.wrap) {
      var wArea = gross * 1.1, roll = num(M.wrap.w) / 1000 * num(M.wrap.len);
      if (roll > 0) add('wrap', '本体', '透湿防水シート', Math.ceil(wArea / roll), '巻', r2(wArea) + '㎡（総面積×1.1）÷ ' + r2(roll) + '㎡/巻', 'wrap');
      else add('wrap', '本体', '透湿防水シート', r2(wArea), '㎡', '総面積×1.1', 'wrap');
    }

    // ---- 下地
    var pitch = Math.max(1, num(S.furringPitch, 455)), furMain = 0;
    active.forEach(function (f) {
      if (yoko) { furMain += (Math.ceil(f.W / pitch) + 1) * (f.W > 0 ? f.gross * 1e6 / f.W : 0); }
      else { furMain += (Math.ceil(f.H / pitch) + 1) * (f.H > 0 ? f.gross * 1e6 / f.H : 0); }
    });
    var openPer = sum(allOpen, function (o) { return 2 * (o.w + o.h); });
    var cornerLen = sum(corners, function (c) { return c.h; });
    var ends = (S.furringEnds && yoko) ? sum(active, function (f) { return f.bottom + f.top; }) : 0;
    var furRaw = furMain + openPer + 2 * cornerLen + ends, furTotal = furRaw * lossF;
    var fLen = num(M.furring.len, 4000);
    add('furring', '下地', '下地胴縁（' + (yoko ? '縦' : '横') + '胴縁 @' + pitch + '）', pcs(furTotal, 1, fLen), '本',
      mtr(furTotal) + 'm ＝（本体' + mtr(furMain) + ' ＋ 開口周り' + mtr(openPer) + ' ＋ 角' + mtr(2 * cornerLen) + ' ＋ 上下端' + mtr(ends) + '）× ロス' + num(S.lossFurring) + '% → 定尺' + fLen, 'furring', { len: furRaw, loss: lossF, std: fLen });
    var screwLen = num(M.furring.thick) + (S.insulMode === 'board' ? num(M.insul.thick) : 0) + num(S.existingThk) + num(S.embed);
    var screwN = Math.ceil(furTotal / Math.max(1, num(S.screwPitch, 303)) * 1.1);
    var sPer = num(M.screw.perCase), sWarn = num(M.screw.len) > 0 && num(M.screw.len) < screwLen ? ' ⚠ 登録ビス' + num(M.screw.len) + 'mmは短い' : '';
    var sNote = '推奨長さ ' + screwLen + 'mm以上（胴縁' + num(M.furring.thick) + '＋断熱' + (S.insulMode === 'board' ? num(M.insul.thick) : 0) + '＋既存壁' + num(S.existingThk) + '＋埋込' + num(S.embed) + '）｜ @' + num(S.screwPitch) + '×1.1 ＝ ' + screwN + '本' + sWarn;
    if (sPer > 0) add('screw', '下地', '胴縁ビス', Math.ceil(screwN / sPer), '箱', sNote + '（' + sPer + '本入）', 'screw');
    else add('screw', '下地', '胴縁ビス', screwN, '本', sNote, 'screw');

    // ---- 水切り
    var doorW = sum(doors, function (o) { return o.w; }), baseLen = Math.max(0, perim - doorW);
    add('base_flash', '水切り', '土台水切り', pcs(baseLen, lossT, num(M.baseFlash.len)), '本', mtr(baseLen) + 'm（下辺＝土台の面 ' + mtr(perim) + 'm − ドア幅' + mtr(doorW) + 'm）× ロス → 定尺' + num(M.baseFlash.len), 'baseFlash', { len: baseLen, loss: lossT, std: num(M.baseFlash.len) });
    add('base_corner', '水切り', '土台水切り コーナー役物', outs.length + ins.length, '個', '出隅' + outs.length + ' ＋ 入隅' + ins.length + '（地面まで届く角だけ採用）', 'baseCorner');
    var parapetL = lineLen('parapet'), parapet = parapetL + parapetF;
    add('parapet', '水切り', '笠木下水切り（バルコニー・袖壁）', pcs(parapet, lossT, num(M.parapetFlash.len)), '本', mtr(parapet) + 'm（手すり壁の上辺' + mtr(parapetF) + ' ＋ 線で拾った分' + mtr(parapetL) + '）', 'parapetFlash', { len: parapet, loss: lossT, std: num(M.parapetFlash.len) });
    var middleL = lineLen('middle'), middle = middleL + middleF;
    add('middle', '水切り', '中間水切り', pcs(middle, lossT, num(M.middleFlash.len)), '本', mtr(middle) + 'm（部位の下辺' + mtr(middleF) + ' ＋ 線で拾った分' + mtr(middleL) + '）', 'middleFlash', { len: middle, loss: lossT, std: num(M.middleFlash.len) });

    // ---- 見切り
    add('eave', '見切り', '軒天見切り（上部張りじまい）', pcs(eave, lossT, num(M.eaveTrim.len)), '本', mtr(eave) + 'm（上辺＝軒天の面。妻の登り・下屋の軒含む）', 'eaveTrim', { len: eave, loss: lossT, std: num(M.eaveTrim.len) });
    var topW = sum(allOpen, function (o) { return o.w; }), sideH = sum(allOpen, function (o) { return 2 * o.h; }), botW = sum(windows, function (o) { return o.w; });
    add('win_top', '見切り', '窓上水切り（開口上辺）', pcs(topW, lossT, num(M.winTop.len)), '本', '開口' + allOpen.length + '箇所 ' + mtr(topW) + 'm', 'winTop', { len: topW, loss: lossT, std: num(M.winTop.len) });
    add('win_side', '見切り', '開口 左右見切り', pcs(sideH, lossT, num(M.winSide.len)), '本', mtr(sideH) + 'm', 'winSide', { len: sideH, loss: lossT, std: num(M.winSide.len) });
    add('win_bot', '見切り', '窓下水切り（窓下辺）', pcs(botW, lossT, num(M.winBot.len)), '本', '窓' + windows.length + '箇所 ' + mtr(botW) + 'm（ドアは除外）', 'winBot', { len: botW, loss: lossT, std: num(M.winBot.len) });
    var band = lineLen('band');
    add('band', '見切り', '幕板', pcs(band, lossT, num(M.band.len)), '本', mtr(band) + 'm', 'band', { len: band, loss: lossT, std: num(M.band.len) });
    var otherL = lineLen('other');
    add('other_trim', '見切り', 'その他見切り', pcs(otherL, lossT, num(M.otherTrim.len)), '本', mtr(otherL) + 'm', 'otherTrim', { len: otherL, loss: lossT, std: num(M.otherTrim.len) });

    // ---- 役物
    var cL = num(M.cornerOut.len), outPcs = sum(outs, function (c) { return cL > 0 ? Math.ceil(c.h / cL) : 0; }), outLen = sum(outs, function (c) { return c.h; });
    add('corner_out', '役物', '出隅材', outPcs, '本', outs.length + '箇所 計' + mtr(outLen) + 'm ｜ 箇所ごとに定尺' + cL + 'で切上げ', 'cornerOut', { len: outLen, loss: 1, std: cL, perPiece: true });
    add('corner_cap', '役物', '出隅キャップ（上下）', outs.length * 2, '個', outs.length + '箇所 × 2', 'cornerCap');
    var iL = num(M.cornerIn.len), inPcs = sum(ins, function (c) { return iL > 0 ? Math.ceil(c.h / iL) : 0; }), inLen = sum(ins, function (c) { return c.h; });
    add('corner_in', '役物', '入隅材', inPcs, '本', ins.length + '箇所 計' + mtr(inLen) + 'm', 'cornerIn', { len: inLen, loss: 1, std: iL, perPiece: true });
    var jL = num(M.joint.len), jointLen = 0, jointPcs = 0, jointCols = 0, jointName, jointUnit, jointNote, jointLenInfo = null;
    if (yoko) {
      active.forEach(function (f) {
        var cols = pL > 0 ? Math.max(0, Math.ceil(f.W / pL) - 1) : 0;
        jointCols += cols; jointLen += cols * f.H;
        if (S.jointMode === 'stagger') jointPcs += (wW > 0 ? Math.ceil(f.H / wW) : 0) * cols;
        else jointPcs += cols * (jL > 0 ? Math.ceil(f.H / jL) : 0);
      });
      if (S.jointMode === 'stagger') { jointName = '目地ジョイント（千鳥ピース）'; jointUnit = '個'; jointNote = '継ぎ目' + jointCols + '列 × 段数'; }
      else { jointName = '目地ジョイナー（通し目地）'; jointUnit = '本'; jointNote = '継ぎ目' + jointCols + '列 ' + mtr(jointLen) + 'm ｜ 列ごとに定尺' + jL + 'で切上げ'; jointLenInfo = { len: jointLen, loss: 1, std: jL, perPiece: true }; }
    } else {
      active.forEach(function (f) {
        var rws = pL > 0 ? Math.max(0, Math.ceil(f.H / pL) - 1) : 0;
        jointCols += rws; jointLen += rws * f.W; jointPcs += rws * (jL > 0 ? Math.ceil(f.W / jL) : 0);
      });
      jointName = '横ジョイント水切り（縦張り）'; jointUnit = '本'; jointNote = '横目地' + jointCols + '段 ' + mtr(jointLen) + 'm'; jointLenInfo = { len: jointLen, loss: 1, std: jL, perPiece: true };
    }
    add('joint', '役物', jointName, jointPcs, jointUnit, jointNote, 'joint', jointLenInfo);

    // ---- 付帯
    var counts = {};
    obst.forEach(function (o) { counts[o.type] = (counts[o.type] || 0) + 1; });
    var obstTrimM = sum(Object.keys(counts), function (t) { return counts[t] * num(S.obst[t]); });
    var obstList = Object.keys(counts).map(function (t) { return (OBST_LABEL[t] || t) + counts[t]; }).join('・');
    add('obst_trim', '付帯', '障害物まわり見切り', pcs(obstTrimM * 1000, lossT, num(M.otherTrim.len)), '本', r1(obstTrimM) + 'm（' + (obstList || 'なし') + '）', 'otherTrim', { len: obstTrimM * 1000, loss: lossT, std: num(M.otherTrim.len) });
    var removeN = sum(Object.keys(counts), function (t) { return t === 'pipe' ? 0 : counts[t]; });
    add('obst_remove', '付帯', '障害物 脱着（フード・メーター・樋など）', removeN, '箇所', obstList || '');
    var sealMM = openPer + cornerLen + (yoko && S.jointMode === 'through' ? jointLen : 0) + parapet + obstTrimM * 1000;
    var cov = num(M.sealant.cov);
    if (cov > 0) add('seal', '付帯', 'シーリング', Math.ceil(sealMM / 1000 / cov), '本', mtr(sealMM) + 'm（開口周り＋角＋通し目地＋笠木取合い＋障害物）÷ ' + cov + 'm/本', 'sealant', { len: sealMM, loss: 1, std: cov * 1000 });
    else add('seal', '付帯', 'シーリング（参考）', mtr(sealMM), 'm', '開口周り＋角＋通し目地＋笠木取合い＋障害物', 'sealant', { len: sealMM, loss: 1, std: 0 });
    add('scaffold', '付帯', '足場（参考）', r1((perim / 1000 + 8) * (maxH / 1000 + 1)), '㎡', '（外周＋8m）×（最高高さ＋1m）');

    // ---- 手拾い長さ（lens[key] = [{label, v(m)}]）があれば、その行の延長を置き換える
    rows.forEach(function (r) {
      if (!r.len) return;
      var list = (lens[r.key] || []).filter(function (e) { return num(e.v) > 0; });
      r.autoQty = r.qty; r.autoLenM = mtr(r.len.len); r.manual = null;
      if (!list.length) return;
      var totalMM = sum(list, function (e) { return num(e.v) * 1000; }), q;
      if (r.len.perPiece) q = sum(list, function (e) { return r.len.std > 0 ? Math.ceil(num(e.v) * 1000 / r.len.std) : 0; });
      else if (r.len.std > 0) q = Math.ceil(totalMM * r.len.loss / r.len.std);
      else q = mtr(totalMM);
      r.manual = { n: list.length, totalM: mtr(totalMM), items: list.map(function (e) { return (e.label ? e.label + ' ' : '') + num(e.v) + 'm'; }).join('、') };
      r.qty = q;
      r.note = '手拾い' + list.length + '件 合計' + r.manual.totalM + 'm を採用（自動' + r.autoLenM + 'm）｜ ' + r.manual.items;
    });

    // ---- 部位別集計（対象外の面も表示）
    var partsMap = {};
    faces.forEach(function (f) {
      var key = f.part + '|' + f.floor;
      var e = partsMap[key] || (partsMap[key] = { part: f.part, label: f.partLabel, short: f.partShort, floor: f.floor, n: 0, gross: 0, deducted: 0, net: 0, openN: 0, include: true, names: [] });
      e.n++; e.gross += f.gross; e.deducted += f.deducted; e.net += f.net; e.openN += f.openings.length; e.names.push(f.name); e.include = e.include && f.include;
    });
    var order = PARTS.map(function (p) { return p.key; });
    var parts = Object.keys(partsMap).map(function (k) { return partsMap[k]; }).sort(function (a, b) {
      return (order.indexOf(a.part) - order.indexOf(b.part)) || (a.floor > b.floor ? 1 : a.floor < b.floor ? -1 : 0);
    });
    parts.forEach(function (e) { e.sheets = (e.include && sheetArea > 0) ? Math.ceil(e.net * lossB / sheetArea) : 0; e.gross = r2(e.gross); e.deducted = r2(e.deducted); e.net = r2(e.net); });

    return {
      ok: true, scaled: scaled, rows: rows, faces: faces, parts: parts,
      info: { net: r2(net), gross: r2(gross), perim: mtr(perim), eave: mtr(eave), maxH: mtr(maxH), openN: allOpen.length, outN: outs.length, inN: ins.length, sheets: sheets, cases: cases, layoutSheets: layoutSheets, screwLen: screwLen, excluded: faces.length - active.length }
    };
  }

  var api = { DEFAULT_SPEC: DEFAULT_SPEC, MAT_DEF: MAT_DEF, MAT_TEXT_FIELDS: MAT_TEXT_FIELDS, PARTS: PARTS, FLOORS: FLOORS, EDGE_BOTTOM: EDGE_BOTTOM, EDGE_TOP: EDGE_TOP, OBST_LABEL: OBST_LABEL, LINE_LABEL: LINE_LABEL, partOf: partOf, faceDefaults: faceDefaults, defaultMat: defaultMat, mergeMat: mergeMat, faceGeometry: faceGeometry, openingDims: openingDims, compute: compute, r1: r1, r2: r2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HH_CALC = api;
})(typeof window !== 'undefined' ? window : this);
