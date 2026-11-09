'use strict';
// ケミマージ：分子のデータと描画（物理やゲームの流れは game.js）
const { Vec2 } = planck;
const SC = 30; // 物理世界の 1m = 30px

// ---------- 定数 ----------
const W = 440, H = 680, WALL = 20, LINE_Y = 125, DROP_Y = 62;
const EL = {
  C: { r: .48, col: '#3b414b', hi: '#9aa3b0', lo: '#15181d' },
  H: { r: .34, col: '#d8dde4', hi: '#ffffff', lo: '#8c949e' },
  N: { r: .46, col: '#3060d8', hi: '#9db8ff', lo: '#122a6a' },
  O: { r: .44, col: '#d93a40', hi: '#ffa3a3', lo: '#6a1216' },
  p: { r: .5, col: '#e8743c', hi: '#ffd0a8', lo: '#7a2a08' }, // 陽子
  n: { r: .5, col: '#7f8c9c', hi: '#dfe6ee', lo: '#2c333c' }, // 中性子
  // 芳香環の中心（π電子雲）。見えない当たり判定で環の穴をふさぎ、小さい粒子が入り込まないようにする
  pi: { r: .56, hidden: true },
};
// 分子は全部同じ縮尺（C–C結合 = BOND_PX px）なので、炭素原子の大きさはどの分子でも同じ
const BOND_PX = 20; // フラーレン2個を作って消せる大きさ（ボットで確認。フラーレンの直径164px＝盤面の幅の41%）
const CH = .85; // C-H 結合長（C-C = 1）

// ---------- 分子ビルダー ----------
const M = () => ({ atoms: [], bonds: [] });
function add(m, el, x, y) { m.atoms.push({ el, x, y }); return m.atoms.length - 1; }
function bond(m, i, j) { m.bonds.push([i, j]); }
function addAt(m, el, i, th, d) {
  const a = m.atoms[i];
  const j = add(m, el, a.x + Math.cos(th) * d, a.y + Math.sin(th) * d);
  bond(m, i, j); return j;
}
const hFan = (m, i, th) => { addAt(m, 'H', i, th, CH); addAt(m, 'H', i, th + 1.15, CH); addAt(m, 'H', i, th - 1.15, CH); };
const methyl = (m, i, th) => { const c = addAt(m, 'C', i, th, 1); hFan(m, c, th); };
const nitro = (m, i, th) => { const n = addAt(m, 'N', i, th, .95); addAt(m, 'O', n, th + 1.05, .85); addAt(m, 'O', n, th - 1.05, .85); };
const vAng = k => -Math.PI / 2 + k * Math.PI / 3; // 環の頂点角（k=0 が真上）

// 縮合ベンゼン環（六角格子の中心リスト）
function rings(centers, noH) {
  const m = M(), map = new Map(), owners = new Map(), bset = new Set();
  m.ring = [];
  for (const [cx, cy] of centers) {
    const r = [];
    for (let k = 0; k < 6; k++) {
      const x = cx + Math.cos(vAng(k)), y = cy + Math.sin(vAng(k));
      const key = Math.round(x * 100) + ',' + Math.round(y * 100);
      let i = map.get(key);
      if (i === undefined) { i = add(m, 'C', x, y); map.set(key, i); owners.set(i, []); }
      owners.get(i).push([cx, cy]); r.push(i);
    }
    for (let k = 0; k < 6; k++) {
      const a = r[k], b = r[(k + 1) % 6], bk = Math.min(a, b) + '-' + Math.max(a, b);
      if (!bset.has(bk)) { bset.add(bk); bond(m, a, b); }
    }
    m.ring.push(r);
  }
  if (!noH) for (const [i, os] of owners) if (os.length === 1) {
    const a = m.atoms[i]; addAt(m, 'H', i, Math.atan2(a.y - os[0][1], a.x - os[0][0]), CH);
  }
  for (const [cx, cy] of centers) add(m, 'pi', cx, cy);
  return m;
}
// 一置換・多置換ベンゼン: subs[k] = 'H' | 'CH3' | 'NO2'
function benzene(subs) {
  const m = rings([[0, 0]], true), r = m.ring[0];
  subs.forEach((s, k) => {
    if (s === 'H') addAt(m, 'H', r[k], vAng(k), CH);
    else if (s === 'CH3') methyl(m, r[k], vAng(k));
    else if (s === 'NO2') nitro(m, r[k], vAng(k));
  });
  return m;
}
const S3 = Math.sqrt(3);

// R があるもの（陽子・ヘリウム・フラーレン）は大きさを個別指定。それ以外は BOND_PX の共通縮尺で原子数なりの大きさになる
const LEVELS = [
  { name: '陽子', f: 'p⁺', R: 7, build: () => { const m = M(); add(m, 'p', 0, 0); return m; } },
  { name: 'ヘリウム', f: '⁴He²⁺', R: BOND_PX * .5, build: () => { const m = M(); add(m, 'p', -.42, -.12); add(m, 'p', .42, .12); add(m, 'n', .12, -.42); add(m, 'n', -.12, .42); return m; } },
  { name: '炭素', f: 'C', build: () => { const m = M(); add(m, 'C', 0, 0); return m; } },
  { name: 'メタン', f: 'CH₄', build: () => { const m = M(); const c = add(m, 'C', 0, 0); for (let k = 0; k < 4; k++) addAt(m, 'H', c, Math.PI / 4 + k * Math.PI / 2, CH); return m; } },
  { name: 'ベンゼン', f: 'C₆H₆', build: () => benzene(['H', 'H', 'H', 'H', 'H', 'H']) },
  { name: 'ニトロベンゼン', f: 'C₆H₅NO₂', build: () => benzene(['NO2', 'H', 'H', 'H', 'H', 'H']) },
  { name: 'TNT', f: 'C₇H₅N₃O₆', build: () => benzene(['CH3', 'NO2', 'H', 'NO2', 'H', 'NO2']) },
  { name: 'アントラセン', f: 'C₁₄H₁₀', build: () => rings([[0, 0], [S3, 0], [2 * S3, 0]]) },
  { name: 'コロネン', f: 'C₂₄H₁₂', build: () => { const c = [[0, 0]]; for (let k = 0; k < 6; k++) c.push([S3 * Math.cos(k * Math.PI / 3), S3 * Math.sin(k * Math.PI / 3)]); return rings(c); } },
  { name: 'フラーレン', f: 'C₆₀', c60: true }, // ゴールなので例外的にコロネンより大きく表示
];
const LAST = LEVELS.length - 1;
const TRI = LEVELS.map((_, i) => (i + 1) * (i + 2) / 2);

// テンプレート化（重心＝面積重み中心にそろえ、半径Rへスケール）
for (const L of LEVELS) {
  if (L.c60) {
    const phi = (1 + Math.sqrt(5)) / 2, base = [[0, 1, 3 * phi], [1, 2 + phi, 2 * phi], [phi, 2, phi ** 3]];
    const pts = [], seen = new Set();
    for (const b of base) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const v = [b[0] * sx, b[1] * sy, b[2] * sz];
      for (let c = 0; c < 3; c++) {
        const p = [v[c], v[(c + 1) % 3], v[(c + 2) % 3]], key = p.map(n => n.toFixed(3)).join();
        if (!seen.has(key)) { seen.add(key); pts.push(p); }
      }
    }
    L.pts = pts; L.cb = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
      if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]) < 2.05) L.cb.push([i, j]);
    L.R = Math.round(LEVELS[LEVELS.indexOf(L) - 1].R * 1.08);
    L.ar = .78; L.s = L.R / (Math.hypot(1, 3 * phi) + L.ar);
    continue;
  }
  const m = L.build();
  let sw = 0, sx = 0, sy = 0;
  for (const a of m.atoms) { const w = EL[a.el].r ** 2; sw += w; sx += a.x * w; sy += a.y * w; }
  sx /= sw; sy /= sw;
  let ext = 0;
  for (const a of m.atoms) { a.x -= sx; a.y -= sy; ext = Math.max(ext, Math.hypot(a.x, a.y) + EL[a.el].r); }
  const s = L.R ? L.R / ext : BOND_PX;
  L.R = Math.round(ext * s);
  L.s = s;
  L.atoms = m.atoms.map(a => ({ el: a.el, x: a.x * s, y: a.y * s, r: EL[a.el].r * s }));
  L.bonds = m.bonds;
  L.order = L.atoms.map((_, i) => i).sort((i, j) => (L.atoms[i].el === 'H' ? 0 : 1) - (L.atoms[j].el === 'H' ? 0 : 1));
  L.atoms.forEach((a, i) => { if (a.el === 'pi') { L.order.splice(L.order.indexOf(i), 1); L.order.push(i); } });
}

// ---------- 描画ヘルパー ----------
const SPR = {};
for (const k in EL) {
  if (EL[k].hidden) continue;
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d'), e = EL[k];
  const gr = g.createRadialGradient(34, 32, 4, 48, 48, 48);
  gr.addColorStop(0, e.hi); gr.addColorStop(.45, e.col); gr.addColorStop(1, e.lo);
  g.fillStyle = gr; g.beginPath(); g.arc(48, 48, 47, 0, Math.PI * 2); g.fill();
  SPR[k] = c;
}

function drawFlat(ctx, L, pos, rad) {
  const bw = Math.max(1.5, L.s * .26);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#0c0f13'; ctx.lineWidth = bw + 2;
  ctx.beginPath();
  for (const [i, j] of L.bonds) { ctx.moveTo(pos[i].x, pos[i].y); ctx.lineTo(pos[j].x, pos[j].y); }
  ctx.stroke();
  ctx.strokeStyle = '#a7b0bb'; ctx.lineWidth = bw; ctx.stroke();
  for (const i of L.order) {
    const r = rad[i];
    if (L.atoms[i].el === 'pi') { // 芳香環の内側の丸
      ctx.strokeStyle = '#a7b0bb66'; ctx.lineWidth = Math.max(1, L.s * .05);
      ctx.beginPath(); ctx.arc(pos[i].x, pos[i].y, r * .55, 0, Math.PI * 2); ctx.stroke();
      continue;
    }
    ctx.drawImage(SPR[L.atoms[i].el], pos[i].x - r, pos[i].y - r, r * 2, r * 2);
  }
}

function drawC60(ctx, L, x, y, ang, t, k = 1) {
  const s = L.s * k, cy = Math.cos(t), sy = Math.sin(t), cx = Math.cos(.5), sx = Math.sin(.5), cz = Math.cos(ang), sz = Math.sin(ang);
  const P = L.pts.map(([px, py, pz]) => {
    const X = px * cy + pz * sy, Z = -px * sy + pz * cy;
    const Y2 = py * cx - Z * sx, Z2 = py * sx + Z * cx;
    return { x: x + (X * cz - Y2 * sz) * s, y: y + (X * sz + Y2 * cz) * s, z: Z2 };
  });
  const gl = ctx.createRadialGradient(x, y, L.R * .2, x, y, L.R * 1.05);
  gl.addColorStop(0, '#5fd4c422'); gl.addColorStop(1, '#5fd4c400');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, L.R * 1.05, 0, Math.PI * 2); ctx.fill();
  const order = P.map((_, i) => i).sort((a, b) => P[a].z - P[b].z);
  ctx.lineCap = 'round';
  const layer = (front) => {
    ctx.strokeStyle = front ? '#b8c1cc' : '#56606c'; ctx.lineWidth = Math.max(1, s * .32);
    ctx.beginPath();
    for (const [i, j] of L.cb) if ((P[i].z + P[j].z >= 0) === front) { ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[j].x, P[j].y); }
    ctx.stroke();
    for (const i of order) if ((P[i].z >= 0) === front) {
      const r = L.ar * s * (1 + P[i].z * .05);
      ctx.globalAlpha = .55 + .45 * (P[i].z + 5) / 10;
      ctx.drawImage(SPR.C, P[i].x - r, P[i].y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  };
  layer(false); layer(true);
}

function drawTemplate(ctx, lv, x, y, ang, k = 1, t = 0) {
  const L = LEVELS[lv];
  if (L.c60) return drawC60(ctx, L, x, y, ang, t, k);
  const c = Math.cos(ang), s = Math.sin(ang);
  const pos = L.atoms.map(a => ({ x: x + (a.x * c - a.y * s) * k, y: y + (a.x * s + a.y * c) * k }));
  drawFlat(ctx, L, pos, L.atoms.map(a => a.r * k));
}

