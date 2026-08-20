// ui.js — HUD updates, wave banner, boss bar, screens
export class UI {
  constructor() {
    this.el = {
      hpFill: document.getElementById('hp-fill'),
      hpNum: document.getElementById('hp-num'),
      waveTitle: document.getElementById('wave-title'),
      waveSub: document.getElementById('wave-sub'),
      banner: document.getElementById('wave-banner'),
      bannerText: document.getElementById('banner-text'),
      bannerSub: document.getElementById('banner-sub'),
      objective: document.getElementById('hud-objective'),
      calmVal: document.getElementById('obj-calm-val'),
      calmTag: document.getElementById('obj-calm-tag'),
      towerPrompt: document.getElementById('tower-prompt'),
      boss: document.getElementById('hud-boss'),
      bossFill: document.getElementById('boss-fill'),
      damageFlash: document.getElementById('damage-flash'),
      companionTag: document.getElementById('companion-tag'),
      companionBanter: document.getElementById('companion-banter'),
      crosshair: document.getElementById('crosshair'),
      hudOverdrive: document.getElementById('hud-overdrive'),
      odFill: document.getElementById('od-fill'),
      letterboxTop: document.getElementById('letterbox-top'),
      letterboxBottom: document.getElementById('letterbox-bottom'),
      bossCard: document.getElementById('boss-intro-card'),
      bossCardTitle: document.getElementById('bic-title'),
      bossCardName: document.getElementById('bic-name'),
      victoryBanner: document.getElementById('victory-banner'),
      screens: {
        start: document.getElementById('screen-start'),
        win: document.getElementById('screen-win'),
        lose: document.getElementById('screen-lose'),
      },
      winStats: document.getElementById('win-stats'),
      loseStats: document.getElementById('lose-stats'),
      abilities: {
        pistol: document.querySelector('#ab-pistol .cd'),
        bazooka: document.querySelector('#ab-bazooka .cd'),
        gatling: document.querySelector('#ab-gatling .cd'),
      },
    };
    this._bannerTimeout = null;
    this._flashTimeout = null;
    this._companionMode = null;
    this._calmActive = false; // Objective-Strip zeigt gerade die Ruhe-Zeile
    this._towerPrompt = false; // Interakt-Angebot am Wachturm sichtbar (Friedensphase)
    this._banterHideTimeout = null;
    this._banterClearTimeout = null;
    this._resetHudCache();
  }

  // Zuletzt dargestellte Werte der Pro-Frame-Setter. Deren Ausgabe hängt nur von
  // den Argumenten ab — bei gleichen Werten bleibt das DOM unangetastet.
  _resetHudCache() {
    this._hp = { cur: null, max: null };
    this._wave = { title: null, remaining: null };
    this._calm = { title: null, sub: null };
    this._od = { frac: null, ready: null, active: null };
    this._cd = { pistol: null, bazooka: null, gatling: null };
  }

  // KAI's short banter line — shows near the companion tag, fades after ~2.5s.
  // Cooldown/selection lives in banter.js; this just handles the HUD fade.
  setBanter(text) {
    const el = this.el.companionBanter;
    if (!el) return;
    clearTimeout(this._banterHideTimeout);
    clearTimeout(this._banterClearTimeout);
    el.textContent = text;
    el.classList.add('show');
    this._banterHideTimeout = setTimeout(() => {
      el.classList.remove('show');
      this._banterClearTimeout = setTimeout(() => { el.textContent = ''; }, 400);
    }, 2500);
  }

  // companion status dot: fighting (engaged), downed, or idle (dim)
  setCompanion(mode) {
    if (mode === this._companionMode) return;
    this._companionMode = mode;
    const isFighting = mode === 'approach' || mode === 'combo' || mode === 'link' || mode === 'reposition';
    this.el.companionTag.classList.toggle('fighting', isFighting);
    this.el.companionTag.classList.toggle('downed', mode === 'downed');
  }

  setHealth(cur, max) {
    // unveränderter Zustand => kein DOM-Write (Heilung bei vollem Leben ruft das
    // pro Frame auf). Breite, Zahl und Balkenfarbe hängen nur an cur/max.
    if (cur === this._hp.cur && max === this._hp.max) return;
    this._hp.cur = cur;
    this._hp.max = max;
    const frac = Math.max(0, cur) / max;
    this.el.hpFill.style.width = `${frac * 100}%`;
    this.el.hpNum.textContent = `${Math.max(0, Math.ceil(cur))} / ${max}`;
    // shift bar hue toward deep red when low
    this.el.hpFill.style.background = frac < 0.3
      ? 'linear-gradient(90deg, #d92b1c, #a01208)'
      : 'linear-gradient(90deg, #ff7a52, #ff5a3c)';
  }

  // Friedensphase (main.js): der Objective-Strip zeigt statt Wave/Marines/K.O. eine
  // ruhige Zeile. Schreibt bewusst NICHT in #obj-src — der MutationObserver dort liest
  // Zahlen aus Titel/Sub und würde einen zahlenlosen Titel als "BOSS" darstellen.
  setCalmObjective(title, sub) {
    if (title === this._calm.title && sub === this._calm.sub) return;
    this._calm.title = title;
    this._calm.sub = sub;
    this._calmActive = true;
    this.el.calmVal.textContent = title;
    this.el.calmTag.textContent = sub;
    this.el.objective.classList.add('calm');
  }

  // Friedensphase: das Interakt-Angebot am Wachturm ("[E] Die Marine rufen"). Wird pro Frame
  // aus updatePeace() gesetzt — deshalb der Zustands-Vergleich, sonst schriebe es jeden
  // Frame dieselbe Klasse. Der Zustand ist echt (nicht nur Cache): er wird in hideScreens()
  // und endPeace() aktiv auf false gezogen, damit kein Prompt in einen Kampf hineinsteht.
  setTowerPrompt(visible) {
    if (visible === this._towerPrompt) return;
    this._towerPrompt = visible;
    if (this.el.towerPrompt) this.el.towerPrompt.classList.toggle('show', visible);
  }

  setWave(title, remaining) {
    // erste Welle nach der Friedensphase: Zahlen-Spalten wieder einblenden. Steht VOR
    // dem Cache-Check, damit der Strip garantiert umschaltet.
    if (this._calmActive) {
      this._calmActive = false;
      this._calm.title = null;
      this._calm.sub = null;
      this.el.objective.classList.remove('calm');
    }
    // läuft pro Frame, ändert sich nur bei Wave-Wechsel/K.O. — der Objective-Strip
    // in index.html hängt an einem MutationObserver, den identische Writes sonst
    // jeden Frame unnötig aufwecken (hideScreens() leert den Cache pro Run)
    if (title === this._wave.title && remaining === this._wave.remaining) return;
    this._wave.title = title;
    this._wave.remaining = remaining;
    this.el.waveTitle.textContent = title;
    this.el.waveSub.textContent = `Marines remaining — ${remaining}`;
  }

  // OVERDRIVE meter — meterFrac (0..1) while charging, activeFrac (0..1, time left / duration)
  // once activated; ready = true when full and not yet activated (glow + pulse cue for "press F").
  setOverdrive(meterFrac, ready, active, activeFrac) {
    // gegen den GEKLEMMTEN Wert vergleichen: voller/leerer Meter schreibt sonst
    // jeden Frame dieselbe Breite (Glow und Aktiv-Zustand hängen an ready/active)
    const frac = Math.max(0, Math.min(1, active ? activeFrac : meterFrac));
    if (frac === this._od.frac && ready === this._od.ready && active === this._od.active) return;
    this._od.frac = frac;
    this._od.ready = ready;
    this._od.active = active;
    this.el.odFill.style.width = `${frac * 100}%`;
    this.el.hudOverdrive.classList.toggle('ready', ready);
    this.el.hudOverdrive.classList.toggle('active', active);
  }

  setCooldowns(cd) {
    // die drei Balken stehen die meiste Zeit still (bereit = 0) — nur bei Änderung schreiben
    if (cd.pistol === this._cd.pistol && cd.bazooka === this._cd.bazooka && cd.gatling === this._cd.gatling) return;
    this._cd.pistol = cd.pistol;
    this._cd.bazooka = cd.bazooka;
    this._cd.gatling = cd.gatling;
    this.el.abilities.pistol.style.transform = `scaleY(${cd.pistol})`;
    this.el.abilities.bazooka.style.transform = `scaleY(${cd.bazooka})`;
    this.el.abilities.gatling.style.transform = `scaleY(${cd.gatling})`;
  }

  showBanner(text, sub = '') {
    this.el.bannerText.textContent = text;
    this.el.bannerSub.textContent = sub;
    this.el.banner.classList.add('show');
    clearTimeout(this._bannerTimeout);
    this._bannerTimeout = setTimeout(() => this.el.banner.classList.remove('show'), 2200);
  }

  showBossBar() { this.el.boss.style.display = 'block'; }
  hideBossBar() { this.el.boss.style.display = 'none'; }
  setBossHealth(frac) {
    this.el.bossFill.style.width = `${Math.max(0, frac) * 100}%`;
  }

  // ---- boss-intro presentation (Runde 9): letterbox + anime name-card ----
  showLetterbox() {
    this.el.letterboxTop.classList.add('show');
    this.el.letterboxBottom.classList.add('show');
  }
  hideLetterbox() {
    this.el.letterboxTop.classList.remove('show');
    this.el.letterboxBottom.classList.remove('show');
  }
  showBossNameCard(title, name) {
    this.el.bossCardTitle.textContent = title;
    this.el.bossCardName.textContent = name;
    this.el.bossCard.classList.add('show');
  }
  hideBossNameCard() {
    this.el.bossCard.classList.remove('show');
  }

  // ---- victory presentation (Runde 9): big "SIEG" banner during the win pose ----
  showVictoryBanner(text) {
    this.el.victoryBanner.textContent = text;
    this.el.victoryBanner.classList.add('show');
  }
  hideVictoryBanner() {
    this.el.victoryBanner.classList.remove('show');
  }

  flashDamage() {
    this.el.damageFlash.classList.add('active');
    clearTimeout(this._flashTimeout);
    this._flashTimeout = setTimeout(() => this.el.damageFlash.classList.remove('active'), 90);
  }

  setCrosshair(visible) {
    this.el.crosshair.style.display = visible ? 'block' : 'none';
  }

  showScreen(name, statsText = '') {
    for (const key of Object.keys(this.el.screens)) {
      this.el.screens[key].classList.toggle('hidden', key !== name);
    }
    if (name === 'win') this.el.winStats.textContent = statsText;
    if (name === 'lose') this.el.loseStats.textContent = statsText;
    this.setCrosshair(false);
    this.setTowerPrompt(false); // kein Turm-Angebot über einem Endbildschirm
  }

  hideScreens() {
    for (const key of Object.keys(this.el.screens)) {
      this.el.screens[key].classList.add('hidden');
    }
    this.setCrosshair(true);
    // vor dem Cache-Reset: der Prompt hängt an echtem DOM-Zustand, nicht nur am Cache
    this.setTowerPrompt(false);
    // neuer Run: HUD-Cache leeren, damit jeder Setter garantiert einmal ins DOM
    // schreibt (der Objective-Strip baut seinen Zählerstand aus diesen Writes auf)
    this._resetHudCache();
    // defensive reset: never carry a stuck letterbox/name-card/victory-banner into a new run
    this.hideLetterbox();
    this.hideBossNameCard();
    this.hideVictoryBanner();
  }
}
