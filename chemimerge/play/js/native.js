'use strict';
// ケミマージ：アプリの機能（広告・課金・ランキング・振動）。
// アプリ（Capacitor）ではネイティブのプラグインを使い、Web ではそれっぽい代わりの動きをする。
// game.js からは window.Native だけを使う。

(() => {
  const CAP = window.Capacitor;
  const isApp = !!CAP?.isNativePlatform?.();
  const plat = CAP?.getPlatform?.() || 'web';
  // 公開している Web 版（GitHub Pages）：広告も課金もなし。復活は広告なしで1回だけ。
  // 手元で開いたとき（file:// や localhost）は、広告の流れを試せるように偽物の広告を出す
  const webDev = !isApp && (location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname));
  const webPublic = !isApp && !webDev;
  const P = CAP?.Plugins || {};

  // ===== 設定（ストアに出す前にここを埋める） =====
  const CFG = {
    // true の間は Google のテスト広告。自分で本物の広告を押すと AdMob の規約違反になるので、開発中は true
    // ★ 審査に出すビルドの前に必ず false（store/appstore.md の「リリース手順」）。true のままだとアプリのタイトル画面に赤い表示が出る
    AD_TEST: true,
    // AdMob の広告ユニット（AdMob の「ケミマージ」iOS・Android：リワード「復活」、インタースティシャル「ゲームの合間」）
    // AD_TEST が true の間は、下の TEST_ADS（Google のテスト用）が使われる
    ADS: {
      ios: { reward: 'ca-app-pub-9369660298902208/5452814179', interstitial: 'ca-app-pub-9369660298902208/8699979956' },
      android: { reward: 'ca-app-pub-9369660298902208/6108857084', interstitial: 'ca-app-pub-9369660298902208/7421938757' },
    },
    TEST_ADS: {
      ios: { reward: 'ca-app-pub-3940256099942544/1712485313', interstitial: 'ca-app-pub-3940256099942544/4411468910' },
      android: { reward: 'ca-app-pub-3940256099942544/5224354917', interstitial: 'ca-app-pub-3940256099942544/1033173712' },
    },
    // App Store Connect で作る「広告を消す」（非消耗型）
    PRODUCT_REMOVE_ADS: 'io.github.akkeymorimori.chemimerge.removeads',
    // App Store Connect → Game Center で作るランキング
    LEADERBOARD: 'chemimerge.highscore',
    // ゲームオーバー何回ごとに全画面広告を出すか
    INTERSTITIAL_EVERY: 3,
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  };

  // ===== 振動 =====
  function haptic(kind) {
    if (!isApp || !P.Haptics) return;
    try {
      if (kind === 'heavy') P.Haptics.impact({ style: 'HEAVY' });
      else if (kind === 'medium') P.Haptics.impact({ style: 'MEDIUM' });
      else if (kind === 'error') P.Haptics.notification({ type: 'ERROR' });
      else P.Haptics.impact({ style: 'LIGHT' });
    } catch { }
  }

  // ===== 課金：広告を消す =====
  const iap = {
    owned: store.get('cm.adfree', false),
    price: '',
    ready: false,
    async init() {
      const NP = P.NativePurchases;
      if (!isApp || !NP) return;
      try {
        const { products } = await NP.getProducts({ productIdentifiers: [CFG.PRODUCT_REMOVE_ADS], productType: 'inapp' });
        const p = products?.[0];
        if (p) { iap.price = p.priceString || ''; iap.ready = true; }
      } catch { }
      // 買ってあるかを App Store に確認（端末を変えた人・入れ直した人のため）
      try {
        const { purchases } = await NP.getPurchases({ productType: 'inapp' });
        if (purchases?.some(t => t.productIdentifier === CFG.PRODUCT_REMOVE_ADS)) iap.setOwned(true);
      } catch { }
      window.dispatchEvent(new Event('native-change'));
    },
    setOwned(v) { iap.owned = v; store.set('cm.adfree', v); window.dispatchEvent(new Event('native-change')); },
    async buy() {
      const NP = P.NativePurchases;
      if (!isApp || !NP) {
        // Web 版：試しに買った扱いにできる（開発用）
        if (confirm('（Web版のテスト）広告を消す を買った扱いにしますか？')) { iap.setOwned(true); return true; }
        return false;
      }
      try {
        const t = await NP.purchaseProduct({ productIdentifier: CFG.PRODUCT_REMOVE_ADS, productType: 'inapp' });
        if (t?.productIdentifier === CFG.PRODUCT_REMOVE_ADS || t?.transactionId) { iap.setOwned(true); return true; }
      } catch (e) {
        // キャンセルもここに来る
      }
      return false;
    },
    async restore() {
      const NP = P.NativePurchases;
      if (!isApp || !NP) return iap.owned;
      try {
        await NP.restorePurchases();
        const { purchases } = await NP.getPurchases({ productType: 'inapp' });
        if (purchases?.some(t => t.productIdentifier === CFG.PRODUCT_REMOVE_ADS)) iap.setOwned(true);
      } catch { }
      return iap.owned;
    },
  };

  // ===== 広告 =====
  const ads = {
    started: false, starting: null, npa: true, overs: 0,
    ids() { const set = CFG.AD_TEST ? CFG.TEST_ADS : CFG.ADS; return set[plat] || null; },
    available() { return isApp && !!P.AdMob && !!ads.ids()?.reward; },
    // はじめて広告を使う前に「トラッキングを許可」を聞いて、AdMob を準備する
    start() {
      if (ads.started || !ads.available()) return Promise.resolve(ads.started);
      if (ads.starting) return ads.starting;
      ads.starting = (async () => {
        const AD = P.AdMob;
        try {
          // 同意画面（UMP）：ヨーロッパなど同意が必要な地域の人にだけ出る。日本では出ない。
          // AdMob の「プライバシーとメッセージ」でメッセージを作ってあるときだけ表示される
          try {
            const info = await AD.requestConsentInfo();
            if (info?.isConsentFormAvailable && info.status === 'REQUIRED') await AD.showConsentForm();
          } catch { }
          // iOS：「トラッキングを許可」（Android では何もしない）
          let st = (await AD.trackingAuthorizationStatus())?.status;
          if (st === 'notDetermined') {
            await AD.requestTrackingAuthorization();
            st = (await AD.trackingAuthorizationStatus())?.status;
          }
          ads.npa = st !== 'authorized'; // 許可しなかった人には、その人に合わせない広告
          await AD.initialize({ maxAdContentRating: 'General' });
          ads.started = true;
        } catch { }
        ads.starting = null;
        return ads.started;
      })();
      return ads.starting;
    },
    // 動画を最後まで見たら true（復活に使う。広告を消すを買った人も、復活は動画で）
    async rewarded() {
      if (webPublic) return true;
      if (!isApp) return webFakeAd('動画の広告（テスト）', true);
      if (!(await ads.start())) return false;
      const AD = P.AdMob;
      let got = false;
      const hs = [];
      try {
        hs.push(await AD.addListener('onRewardedVideoAdReward', () => { got = true; }));
        await AD.prepareRewardVideoAd({ adId: ads.ids().reward, npa: ads.npa, isTesting: CFG.AD_TEST });
        await AD.showRewardVideoAd();
      } catch { }
      hs.forEach(h => h?.remove?.());
      return got;
    },
    // ゲームオーバー何回かに1回、全画面の広告（広告を消すを買った人には出さない）
    async afterGame() {
      if (iap.owned || webPublic) return;
      ads.overs++;
      if (ads.overs % CFG.INTERSTITIAL_EVERY !== 0) return;
      if (!isApp) return webFakeAd('全画面の広告（テスト）', false);
      if (!(await ads.start())) return;
      try {
        await P.AdMob.prepareInterstitial({ adId: ads.ids().interstitial, npa: ads.npa, isTesting: CFG.AD_TEST });
        await P.AdMob.showInterstitial();
      } catch { }
    },
  };

  // Web 版で広告の流れを試すための、ただの待ち画面
  function webFakeAd(label, reward) {
    return new Promise(res => {
      const d = document.createElement('div');
      d.className = 'fakeAd';
      d.innerHTML = `<div><b>${label}</b><p>アプリでは本物の広告が出ます</p><p class="cnt">2</p></div>`;
      document.body.appendChild(d);
      let n = 2;
      const t = setInterval(() => {
        n--; d.querySelector('.cnt').textContent = n;
        if (n <= 0) { clearInterval(t); d.remove(); res(reward); }
      }, 700);
    });
  }

  // ===== ランキング（Game Center） =====
  const gc = {
    authed: false, name: '',
    available() { return isApp && plat === 'ios' && !!P.GameCenter; },
    async signIn() {
      if (!gc.available()) return false;
      try {
        const r = await P.GameCenter.signIn();
        gc.authed = !!r?.authenticated; gc.name = r?.name || '';
      } catch { gc.authed = false; }
      window.dispatchEvent(new Event('native-change'));
      return gc.authed;
    },
    async submit(score) {
      // この端末の記録（Web でも使う。上位10件）
      const local = store.get('cm.local', []);
      local.push({ score, at: Date.now() });
      local.sort((a, b) => b.score - a.score);
      store.set('cm.local', local.slice(0, 10));
      if (!gc.available() || score <= 0) return;
      if (!gc.authed && !(await gc.signIn())) return;
      try { await P.GameCenter.submitScore({ leaderboardId: CFG.LEADERBOARD, score }); } catch { }
    },
    // { entries: [{ rank, score, name, me }], local } / null（使えないとき）
    async top(time) {
      if (!gc.available()) return null;
      if (!gc.authed && !(await gc.signIn())) return null;
      try { return await P.GameCenter.topScores({ leaderboardId: CFG.LEADERBOARD, count: 20, time }); } catch { return null; }
    },
    localTop() { return store.get('cm.local', []); },
    show() { if (gc.available()) P.GameCenter.showLeaderboard({ leaderboardId: CFG.LEADERBOARD }).catch(() => { }); },
  };

  // ===== アプリが裏に回ったら一時停止 =====
  if (isApp && P.App) {
    P.App.addListener('appStateChange', s => { if (!s.isActive) window.dispatchEvent(new Event('app-pause')); });
    if (plat === 'android') P.App.addListener('backButton', () => window.dispatchEvent(new Event('app-back')));
  }

  window.Native = { isApp, plat, webPublic, haptic, iap, ads, gc, CFG };

  // 起動時：購入状況とGame Centerのログイン（どちらも失敗しても遊べる）
  iap.init();
  if (gc.available()) gc.signIn();
})();
