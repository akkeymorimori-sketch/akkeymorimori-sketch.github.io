'use strict';
// ケミマージ：物理・ゲームの流れ・画面（分子のデータと描画は chem.js、アプリの機能は native.js）

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};

// 図鑑の説明
const DESC = [
  '水素の原子核。宇宙でいちばん多い材料。',
  '星の中で陽子が核融合してできる。陽子2個と中性子2個。',
  'ヘリウム3つが星の中で融合してできる（トリプルアルファ反応）。生命のもと。',
  '天然ガスの主成分。炭素1つに水素が4つ。',
  '炭素6つの正六角形。電子が環全体に広がって安定している（芳香族）。',
  'ベンゼンにニトロ基（–NO₂）がついた。染料の原料アニリンのもと。',
  'トルエンにニトロ基が3つ（トリニトロトルエン）。爆薬として有名。',
  'ベンゼン環が3つ一列に並んだ形。紫外線で青く光る。',
  '環が7つ集まった花のような形。グラフェンの小さなかけら。',
  '炭素60個のサッカーボール。発見者は1996年にノーベル化学賞。',
];

// ---------- サウンド（Web Audio で合成。音のファイルはなし） ----------
const snd = (() => {
  let ac = null, on = store.get('cm.sound', true);
  const ctxA = () => {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { } }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  };
  function tone(freq, dur, type = 'sine', vol = .2, slide = 0, delay = 0) {
    if (!on) return;
    const a = ctxA(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .02);
  }
  return {
    get on() { return on; },
    toggle() { on = !on; store.set('cm.sound', on); if (on) ctxA(); return on; },
    unlock() { if (on) ctxA(); },
    drop() { tone(520, .08, 'triangle', .1, .6); },
    merge(lv) { const f = 900 * Math.pow(.9, lv); tone(f, .18, 'sine', .22, 1.5); tone(f * 1.5, .12, 'triangle', .07, 1.2, .03); },
    discover() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .3, 'triangle', .13, 1, i * .07)); },
    over() { [392, 330, 262].forEach((f, i) => tone(f, .3, 'sine', .18, .9, i * .15)); },
    click() { tone(700, .04, 'square', .04); },
  };
})();

// ---------- キャンバス ----------
const cv = $('c'), ctx = cv.getContext('2d');
let DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  const st = $('stage');
  const k = Math.min(st.clientWidth / W, st.clientHeight / H);
  cv.style.width = W * k + 'px'; cv.style.height = H * k + 'px';
  cv.width = Math.round(W * k * DPR); cv.height = Math.round(H * k * DPR);
  cv.k = k;
  // 回転ボタンをビーカーの右上に置く
  st.style.setProperty('--cw', W * k / 2 + 'px');
  st.style.setProperty('--ct', (st.clientHeight - H * k) / 2 + 'px');
}
addEventListener('resize', resize);

// ---------- 物理（Planck.js = Box2D） ----------
// 1分子 = 1剛体。原子1個ずつを円フィクスチャとして載せるので、当たり判定は分子の形そのもの。
const world = new planck.World({ gravity: Vec2(0, 26) });
const ground = world.createBody();
const wallBox = (cx, cy, w, h) => ground.createFixture({ shape: planck.Box(w / 2 / SC, h / 2 / SC, Vec2(cx / SC, cy / SC)), friction: .4 });
// 床と壁は外側に厚く取って、すり抜けを防ぐ
wallBox(W / 2, H - WALL + 150, W + 600, 300);
wallBox(WALL - 150, H / 2 - 300, 300, H + 1200);
wallBox(W - WALL + 150, H / 2 - 300, 300, H + 1200);

let now = 0;
function createMol(lv, x, y, ang) {
  const L = LEVELS[lv];
  const b = world.createBody({ type: 'dynamic', position: Vec2(x / SC, y / SC), angle: ang, angularDamping: .05, linearDamping: .05, bullet: true });
  // 少し跳ねて転がるように。1粒のもの（陽子・炭素）は摩擦を低めにして、くぼみで急停止しにくくする
  const fix = (shape) => b.createFixture({ shape, density: 1, friction: L.atoms && L.atoms.length === 1 ? .15 : .3, restitution: .2 });
  if (L.c60) fix(planck.Circle(L.R / SC));
  else for (const a of L.atoms) fix(planck.Circle(Vec2(a.x / SC, a.y / SC), a.r / SC));
  b.level = lv; b.born = now; b.spin = Math.random() * 6;
  return b;
}
const bpos = b => { const p = b.getPosition(); return { x: p.x * SC, y: p.y * SC }; };
function topY(b) {
  let m = Infinity;
  for (let f = b.getFixtureList(); f; f = f.getNext()) {
    const sh = f.getShape(), p = b.getWorldPoint(sh.getCenter());
    m = Math.min(m, (p.y - sh.getRadius()) * SC);
  }
  return m;
}
function mols() { const r = []; for (let b = world.getBodyList(); b; b = b.getNext()) if (b.level !== undefined) r.push(b); return r; }

// ---------- ゲームの状態 ----------
let mode = 'title'; // title | play | pause | over
let score = 0, best = store.get('cm.best', 0), maxLv = 0, revived = false, submitted = true;
let discovered = new Set(store.get('cm.disc10', []));
// フラーレン2個がくっつくと光って消えてボーナス
const C60_BONUS = 1000; // 1ゲームの平均がボットで約3600点。2個消しは6回に1回くらい
let c60Count = store.get('cm.c60', 0); // 今までにフラーレンを作った回数（図鑑に出す）
let cur = 0, next = 0, aimX = W / 2, heldAng = 0, cooldown = 0, danger = 0;
const mergeQ = [], fx = [], texts = [];
// 陽子〜ニトロベンゼンが落ちてくる（大きいほど出にくい。合計100）。ボットで平均270個・6回に1回フラーレン2個消し
const SPAWN_W = [22, 20, 18, 16, 14, 10];
for (let i = 0; i < SPAWN_W.length; i++) discovered.add(i); // 落ちてくる分子は最初から図鑑に
function rndLevel() { let r = Math.random() * 100; for (let i = 0; i < SPAWN_W.length; i++) { if ((r -= SPAWN_W[i]) < 0) return i; } return 0; }

// ---------- 画面（オーバーレイ） ----------
const OVS = ['title', 'pause', 'over', 'dex', 'rank', 'howto'];
let ovBack = null; // 図鑑・ランキングを閉じたら戻る先
function show(id) { OVS.forEach(o => $(o).hidden = o !== id); }
function openSub(id) { ovBack = OVS.find(o => !$(o).hidden) || null; show(id); }
function closeSub() { if (ovBack) show(ovBack); else show(null); ovBack = null; }

let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1900); }

function updateHud() {
  $('score').textContent = score; $('best').textContent = best;
  const nc = $('nextc'), g = nc.getContext('2d'), L = LEVELS[next];
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, nc.width, nc.height);
  drawTemplate(g, next, nc.width / 2, nc.height / 2, 0, nc.width * .42 / L.R);
}

// 下の合成ルートの帯
const chainCv = [];
LEVELS.forEach((L, i) => {
  if (i) $('chain').insertAdjacentHTML('beforeend', '<span class="arr">›</span>');
  const c = document.createElement('canvas'); c.width = c.height = 104;
  $('chain').appendChild(c); chainCv.push(c);
});
function drawChain() {
  chainCv.forEach((c, i) => {
    const known = discovered.has(i), key = known ? 1 : 0;
    if (c.drawn === key) return;
    const g = c.getContext('2d'); g.clearRect(0, 0, 104, 104);
    if (!known) { g.fillStyle = '#4a5666'; g.font = 'bold 48px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 52, 55); }
    else drawTemplate(g, i, 52, 52, 0, 48 / LEVELS[i].R, .6);
    c.classList.toggle('locked', !known); c.drawn = key;
  });
}

// 図鑑
function openDex() {
  const box = $('dexList'); box.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const known = discovered.has(i);
    const d = document.createElement('div'); d.className = 'dexItem' + (known ? '' : ' locked');
    const c = document.createElement('canvas'); c.width = c.height = 120;
    d.appendChild(c);
    d.insertAdjacentHTML('beforeend', known
      ? `<div><div class="n">${i + 1}. ${L.name} <span class="f">${L.f}</span></div><div class="d">${DESC[i]}</div>${i === LAST ? `<div class="cnt">作った回数：${c60Count}回</div>` : ''}</div>`
      : `<div><div class="n">${i + 1}. ？？？</div><div class="d">まだ合成していない</div></div>`);
    box.appendChild(d);
    const g = c.getContext('2d');
    if (known) drawTemplate(g, i, 60, 60, 0, 54 / L.R, .6);
    else { g.fillStyle = '#4a5666'; g.font = 'bold 50px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 60, 64); }
  });
  $('dexCount').textContent = `${discovered.size} / ${LEVELS.length}`;
  openSub('dex');
}

// ランキング
let rankTime = 'all';
function openRank() { openSub('rank'); loadRank(); }
async function loadRank() {
  const box = $('rankList'), gcOk = Native.gc.available();
  $('rankTabs').hidden = !gcOk; $('gcBtn').hidden = !gcOk;
  document.querySelectorAll('#rankTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === rankTime));
  box.innerHTML = '<p class="muted">読み込み中…</p>';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const res = gcOk ? await Native.gc.top(rankTime) : null;
  if (res) {
    const rows = res.entries || [];
    let html = rows.map(e => `<li class="${e.me ? 'me' : ''}"><span class="rk">${e.rank}</span><span class="nm">${esc(e.name)}</span><span class="sc">${e.score}</span></li>`).join('');
    if (res.local && !rows.some(e => e.me)) html += `<li class="me sep"><span class="rk">${res.local.rank}</span><span class="nm">${esc(res.local.name)}</span><span class="sc">${res.local.score}</span></li>`;
    box.innerHTML = rows.length ? `<ol>${html}</ol>` : '<p class="muted">まだ記録がありません。最初の1人になろう！</p>';
  } else {
    const loc = Native.gc.localTop();
    box.innerHTML = (gcOk ? '<p class="muted">Game Center にログインすると、世界ランキングが見られます。</p>' : '<p class="muted">この端末の記録</p>') +
      (loc.length ? '<ol>' + loc.map((e, i) => `<li><span class="rk">${i + 1}</span><span class="nm">${new Date(e.at).toLocaleDateString('ja-JP')}</span><span class="sc">${e.score}</span></li>`).join('') + '</ol>'
        : '<p class="muted">まだ記録がありません。</p>');
  }
}

function refreshShop() {
  const own = Native.iap.owned;
  const web = Native.webPublic; // Web 版は課金なし
  $('buyBtn').hidden = own || web; $('restoreBtn').hidden = own || web;
  $('adfreeMark').hidden = !own || web;
  $('buyPrice').textContent = Native.iap.price ? `（${Native.iap.price}）` : '';
  $('soundBtn').textContent = snd.on ? 'サウンド：ON' : 'サウンド：OFF';
  $('testAdMark').hidden = !(Native.isApp && Native.CFG.AD_TEST);
}
addEventListener('native-change', refreshShop);

// ---------- ゲームの流れ ----------
function startGame() {
  for (const b of mols()) world.destroyBody(b);
  score = 0; maxLv = 0; revived = false; submitted = false; danger = 0; cooldown = 0;
  mergeQ.length = fx.length = texts.length = 0;
  cur = rndLevel(); next = rndLevel(); heldAng = 0; aimX = W / 2;
  mode = 'play'; show(null); updateHud();
  snd.unlock();
  Native.ads.start(); // はじめての人には、ここで「トラッキングを許可」を聞く
}

function gameOver() {
  mode = 'over';
  snd.over(); Native.haptic('error');
  const isBest = score > 0 && score >= best;
  $('finalScore').textContent = score;
  $('finalBest').textContent = isBest ? 'ベスト更新！' : 'BEST ' + best;
  $('finalBest').classList.toggle('new', isBest);
  const L = LEVELS[maxLv], g = $('finalMol').getContext('2d');
  g.clearRect(0, 0, 160, 160); drawTemplate(g, maxLv, 80, 80, 0, 70 / L.R, .6);
  $('finalMolName').textContent = `${L.name}（${L.f}）まで合成`;
  const canRevive = !revived && (!Native.isApp || Native.ads.available());
  $('reviveBtn').hidden = !canRevive; $('reviveBtn').disabled = false;
  if (Native.webPublic) $('reviveBtn').innerHTML = '▶ 復活する<small>上のほうの分子を消して続ける（1回だけ）</small>';
  show('over');
}

// ゲームが本当に終わったら記録を送る（復活したらまだ送らない）
function finishGame() {
  if (submitted) return;
  submitted = true;
  Native.gc.submit(score);
}

async function revive() {
  $('reviveBtn').disabled = true;
  const ok = await Native.ads.rewarded();
  if (!ok) { $('reviveBtn').disabled = false; toast('動画を最後まで見ると復活できます'); return; }
  revived = true;
  // 危険ラインの近くにある分子を消す（なければ高いところから3つ）
  let gone = mols().filter(b => topY(b) < LINE_Y + 90);
  if (!gone.length) gone = mols().sort((a, b) => topY(a) - topY(b)).slice(0, 3);
  for (const b of gone) { const p = bpos(b); burst(p.x, p.y, b.level); world.destroyBody(b); }
  for (const b of mols()) b.setAwake(true);
  danger = 0; cooldown = .6; mode = 'play'; show(null);
  toast('復活！ 上の分子を消しました');
}

async function leaveOver(to) {
  finishGame();
  // 復活の動画を見たゲームのあとは、全画面広告は出さない
  if (!revived) await Native.ads.afterGame();
  if (to === 'retry') startGame();
  else goTitle();
}

function pauseGame() { if (mode !== 'play') return; mode = 'pause'; show('pause'); }
function resumeGame() { if (mode !== 'pause') return; mode = 'play'; show(null); }
function goTitle() { finishGame(); mode = 'title'; refreshShop(); show('title'); }
addEventListener('app-pause', pauseGame);
// Android の戻るボタン：図鑑などを閉じる → プレイ中なら一時停止 → タイトルならアプリを閉じる
addEventListener('app-back', () => {
  if (['dex', 'rank', 'howto'].some(o => !$(o).hidden)) closeSub();
  else if (mode === 'play') pauseGame();
  else if (mode === 'pause') resumeGame();
  else if (mode === 'over') leaveOver('title');
  else if (mode === 'title') window.Capacitor?.Plugins?.App?.exitApp?.();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ---------- 入力 ----------
function clampAim(x) { const R = LEVELS[cur].R; return Math.max(WALL + R, Math.min(W - WALL - R, x)); }
function setAim(e) { const r = cv.getBoundingClientRect(); aimX = clampAim((e.clientX - r.left) / r.width * W); }
function rotate(deg) { heldAng += deg * Math.PI / 180; }
function drop() {
  if (mode !== 'play' || cooldown > 0) return;
  createMol(cur, clampAim(aimX), DROP_Y, heldAng);
  cur = next; next = rndLevel(); cooldown = .6; heldAng = 0;
  snd.drop(); Native.haptic('light');
  updateHud();
}
let touching = false;
cv.addEventListener('pointerdown', e => {
  if (mode !== 'play') return;
  e.preventDefault(); setAim(e);
  if (e.pointerType === 'mouse') { if (e.button === 2) rotate(45); else if (e.button === 0) drop(); }
  else { touching = true; cv.setPointerCapture(e.pointerId); }
});
cv.addEventListener('pointermove', e => { if (mode === 'play' && (e.pointerType === 'mouse' || touching)) setAim(e); });
cv.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse' && touching) { touching = false; drop(); } });
cv.addEventListener('pointercancel', () => touching = false);
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => { if (mode !== 'play') return; e.preventDefault(); rotate(e.deltaY > 0 ? 15 : -15); }, { passive: false });
const keys = {};
addEventListener('keydown', e => {
  keys[e.key] = true;
  if (mode === 'play') {
    if (e.key === 'q' || e.key === 'Q') rotate(-15);
    if (e.key === 'e' || e.key === 'E') rotate(15);
    if (e.key === ' ') { e.preventDefault(); drop(); }
    if (e.key === 'Escape' || e.key === 'p') pauseGame();
  } else if (mode === 'pause' && (e.key === 'Escape' || e.key === 'p')) resumeGame();
});
addEventListener('keyup', e => keys[e.key] = false);

// ボタン
const on = (id, f) => $(id).addEventListener('click', () => { snd.click(); f(); });
on('rotBtn', () => rotate(45));
on('pauseBtn', pauseGame);
on('startBtn', startGame);
on('resumeBtn', resumeGame);
on('restartBtn', () => { finishGame(); startGame(); });
on('pTitleBtn', goTitle);
on('reviveBtn', revive);
on('retryBtn', () => leaveOver('retry'));
on('oTitleBtn', () => leaveOver('title'));
on('oRankBtn', () => { finishGame(); openRank(); });
on('rankBtn', openRank);
on('dexBtn', openDex);
on('pDexBtn', openDex);
on('chain', openDex);
on('howBtn', () => openSub('howto'));
on('gcBtn', () => Native.gc.show());
on('buyBtn', async () => { if (await Native.iap.buy()) toast('ありがとう！ 広告が出なくなりました'); refreshShop(); });
on('restoreBtn', async () => { toast((await Native.iap.restore()) ? '購入を復元しました' : '復元できる購入が見つかりませんでした'); refreshShop(); });
on('soundBtn', () => { snd.toggle(); refreshShop(); });
on('pSoundBtn', () => { snd.toggle(); $('pSoundBtn').textContent = snd.on ? 'サウンド：ON' : 'サウンド：OFF'; });
document.querySelectorAll('.closeSub').forEach(b => b.addEventListener('click', () => { snd.click(); closeSub(); }));
document.querySelectorAll('#rankTabs button').forEach(b => b.addEventListener('click', () => { snd.click(); rankTime = b.dataset.t; loadRank(); }));

// ---------- 合体 ----------
// 毎ステップ、接触中の同じ分子ペアを探す（ステップ中は剛体を消せないので後で処理）
function findMerges() {
  const used = new Set();
  for (let c = world.getContactList(); c; c = c.getNext()) {
    if (!c.isTouching()) continue;
    const a = c.getFixtureA().getBody(), b = c.getFixtureB().getBody();
    if (a === b || a.level === undefined || a.level !== b.level || used.has(a) || used.has(b)) continue;
    used.add(a); used.add(b); mergeQ.push([a, b]);
  }
}

function burst(x, y, lv) {
  const L = LEVELS[lv], cols = L.c60 ? ['#9aa3b0', '#5fd4c4'] : [...new Set(L.atoms.filter(a => !EL[a.el].hidden).map(a => EL[a.el].hi))];
  const n = 10 + lv * 2;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
    fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .6 + Math.random() * .3, max: .9, col: cols[i % cols.length], r: 2 + Math.random() * 2.5 });
  }
  fx.push({ ring: true, x, y, life: .45, max: .45, R: L.R });
}

function processMerges() {
  if (mergeQ.length) for (const b of mols()) b.setAwake(true); // 支えが消えた分子が空中で眠らないように
  while (mergeQ.length) {
    const [a, b] = mergeQ.shift();
    const pa = bpos(a), pb = bpos(b), va = a.getLinearVelocity(), vb = b.getLinearVelocity();
    const lv = a.level, x = (pa.x + pb.x) / 2, y = (pa.y + pb.y) / 2, ang = a.getAngle(), angB = b.getAngle();
    const vx = (va.x + vb.x) / 2, vy = Math.min(0, (va.y + vb.y) / 2);
    world.destroyBody(a); world.destroyBody(b);
    if (lv === LAST) {
      score += C60_BONUS; burst(x, y, lv); burst(x, y, lv);
      fx.push({ glow: true, x: pa.x, y: pa.y, ang, life: 1.6, max: 1.6 });
      fx.push({ glow: true, x: pb.x, y: pb.y, ang: angB, life: 1.6, max: 1.6 });
      texts.push({ x, y, t: 1.8, s: `C₆₀ × 2 → 消滅！ +${C60_BONUS}` });
      snd.discover(); Native.haptic('heavy');
      continue;
    }
    const nl = lv + 1, R = LEVELS[nl].R;
    // 合体後の分子が床や壁にめり込んだ状態で生まれないよう、枠の内側に収める
    const nb = createMol(nl, Math.max(WALL + R, Math.min(W - WALL - R, x)), Math.min(y, H - WALL - R), ang);
    nb.born = now - 5; // 合体直後でもゲームオーバー判定の対象
    nb.setLinearVelocity(Vec2(vx, vy));
    score += TRI[nl]; maxLv = Math.max(maxLv, nl);
    if (nl === LAST) { c60Count++; store.set('cm.c60', c60Count); }
    burst(x, y, nl);
    texts.push({ x, y, t: 1, s: LEVELS[nl].name });
    if (!discovered.has(nl)) {
      discovered.add(nl); store.set('cm.disc10', [...discovered]);
      toast('新しい分子を合成: ' + LEVELS[nl].name + ' ' + LEVELS[nl].f);
      snd.discover(); Native.haptic('heavy');
    } else { snd.merge(nl); Native.haptic(nl >= 6 ? 'medium' : 'light'); }
  }
  if (score > best) { best = score; store.set('cm.best', best); }
}

// ---------- 描画 ----------
function drawScene(t) {
  const k = cv.k || 1;
  ctx.setTransform(DPR * k, 0, 0, DPR * k, 0, 0);
  // 背景（ビーカー）
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#16202c'); bg.addColorStop(1, '#0d131a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const liq = ctx.createLinearGradient(0, LINE_Y, 0, H);
  liq.addColorStop(0, '#5fd4c405'); liq.addColorStop(1, '#5fd4c418');
  ctx.fillStyle = liq; ctx.fillRect(WALL, LINE_Y, W - WALL * 2, H - WALL - LINE_Y);
  ctx.strokeStyle = '#ffffff14'; ctx.lineWidth = 1; ctx.fillStyle = '#ffffff30'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  for (let y = H - WALL - 50, n = 50; y > LINE_Y + 20; y -= 50, n += 50) {
    ctx.beginPath(); ctx.moveTo(W - WALL - 14, y); ctx.lineTo(W - WALL, y); ctx.stroke();
    ctx.fillText(n, W - WALL - 17, y + 3);
  }
  ctx.fillStyle = '#c9d6e322';
  ctx.fillRect(0, 0, WALL, H); ctx.fillRect(W - WALL, 0, WALL, H); ctx.fillRect(0, H - WALL, W, WALL);
  ctx.fillStyle = '#ffffff10'; ctx.fillRect(4, 0, 4, H - WALL);

  // 危険ライン
  const pulse = danger > 0 ? .5 + .5 * Math.sin(t * .02) : 0;
  ctx.strokeStyle = danger > 0 ? `rgba(255,80,90,${.5 + pulse * .5})` : '#ff5a6455';
  ctx.setLineDash([8, 8]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(WALL, LINE_Y); ctx.lineTo(W - WALL, LINE_Y); ctx.stroke(); ctx.setLineDash([]);

  // 分子
  const ms = mols();
  for (const b of ms) { const p = bpos(b); drawTemplate(ctx, b.level, p.x, p.y, b.getAngle(), 1, t * .0005 + b.spin); }
  for (const b of ms) if (b.level >= 4) { // ベンゼンから上は化学式を出す
    const p = bpos(b), fs = Math.max(10, LEVELS[b.level].R * .2);
    ctx.font = `700 ${fs}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000a'; ctx.strokeText(LEVELS[b.level].f, p.x, p.y);
    ctx.fillStyle = '#ffffffd0'; ctx.fillText(LEVELS[b.level].f, p.x, p.y);
  }

  // エフェクト
  for (const p of fx) {
    const q = p.life / p.max;
    if (p.glow) { // フラーレン2個が消えるとき：光りながら少しふくらんで消える
      const R = LEVELS[LAST].R, u = 1 - q, a = Math.min(1, q * 2.5);
      const g = ctx.createRadialGradient(p.x, p.y, R * .2, p.x, p.y, R * (1.2 + u * .8));
      g.addColorStop(0, `rgba(255,250,210,${.9 * a})`); g.addColorStop(.5, `rgba(127,240,223,${.5 * a})`); g.addColorStop(1, 'rgba(127,240,223,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R * (1.2 + u * .8), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a; drawTemplate(ctx, LAST, p.x, p.y, p.ang + u * 2, 1 + u * .25, t * .0005); ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(255,250,210,${q})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, R * (1 + u * 1.2), 0, Math.PI * 2); ctx.stroke();
    } else if (p.ring) {
      ctx.strokeStyle = `rgba(95,212,196,${q})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.R * (1.3 - q * .6), 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.globalAlpha = q; ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const tx of texts) {
    ctx.globalAlpha = Math.min(1, tx.t * 2); ctx.font = '700 16px sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = '#000c'; ctx.strokeText(tx.s, tx.x, tx.y);
    ctx.fillStyle = '#7ff0df'; ctx.fillText(tx.s, tx.x, tx.y); ctx.globalAlpha = 1;
  }

  // 持っている分子＋ガイド
  if (mode === 'play' || mode === 'pause') {
    const x = clampAim(aimX);
    ctx.strokeStyle = '#ffffff22'; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, DROP_Y); ctx.lineTo(x, H - WALL); ctx.stroke(); ctx.setLineDash([]);
    // 落とした直後は次の分子を出さない（落下中の分子と重なって形が変わったように見えるため）
    if (cooldown <= 0) {
      ctx.globalAlpha = Math.min(1, -cooldown / .15);
      drawTemplate(ctx, cur, x, DROP_Y, heldAng, 1, t * .0005);
      ctx.globalAlpha = 1;
    }
  }
}

// タイトルのフラーレン
function drawLogo(t) {
  const c = $('logoMol'); if ($('title').hidden) return;
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  drawTemplate(g, LAST, c.width / 2, c.height / 2, t * .0002, c.width * .45 / LEVELS[LAST].R, t * .0006);
}

// ---------- ループ ----------
const STEP = 1000 / 60;
let last = performance.now(), acc = 0;
function step() {
  now += STEP / 1000;
  // 1フレームを2回に分けて計算（重い分子の下で小さい分子がめり込むのを防ぐ）
  for (let k = 0; k < 2; k++) { world.step(STEP / 2000, 8, 3); findMerges(); processMerges(); }
}
function frame(t) {
  const dtMs = Math.min(50, t - last); last = t;
  const dt = dtMs / 1000;
  if (mode === 'play') {
    if (keys.ArrowLeft) aimX = clampAim(aimX - 260 * dt);
    if (keys.ArrowRight) aimX = clampAim(aimX + 260 * dt);
    acc += dtMs;
    while (acc >= STEP) { step(); acc -= STEP; }
    cooldown -= dt;
    // ゲームオーバー判定
    const hit = mols().some(b => now - b.born > 1.2 && topY(b) < LINE_Y && Math.abs(b.getLinearVelocity().y) < 3);
    danger = hit ? danger + dt : Math.max(0, danger - dt * 2);
    if (danger > 2.5) gameOver();
    $('score').textContent = score; $('best').textContent = best;
  } else acc = 0;
  if (mode !== 'pause') {
    for (const p of fx) { p.life -= dt; if (!p.ring && !p.glow) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; } }
    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].life <= 0) fx.splice(i, 1);
    for (const tx of texts) { tx.t -= dt; tx.y -= 30 * dt; }
    for (let i = texts.length - 1; i >= 0; i--) if (texts[i].t <= 0) texts.splice(i, 1);
  }
  drawScene(t);
  drawChain();
  drawLogo(t);
  requestAnimationFrame(frame);
}

resize();
refreshShop();
updateHud();
show('title');
requestAnimationFrame(frame);
