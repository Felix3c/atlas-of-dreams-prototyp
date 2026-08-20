// minimap.js — R18 Aufgabe C: Minimap + Quest-Tracker.
//
// Reines Canvas-2D-HTML-Overlay, KEIN zweiter WebGL-Render (Auftragsvorgabe).
// update() throttlet auf 10 Hz (Auftrag) statt jeden rAF zu zeichnen — main.js
// ruft es trotzdem jeden Frame, das Modul zaehlt die Zeit selbst.
//
// R23 Aufgabe B.3: AUTO-ZOOM. Im Dorf gilt der alte Dorf-Massstab (Markt/Platz/
// Brunnen bleiben lesbar — R21-Begruendung), draussen zoomt die Karte weich auf
// die GANZE Insel heraus (echte Kuestenkontur aus coastWalkRadius, POI-Punkte der
// Entdeckungs-Orte aus island/discover.js). Der statische Offscreen-Layer aus R18
// ist dafuer einem dynamischen 10-Hz-Zeichnen gewichen: ~120 Pfad-Operationen auf
// einem 180-px-Canvas sind gegen einen WebGL-Frame unmessbar, und ein Zoom mit
// zwei Massstaeben braeuchte sonst zwei Layer-Caches samt Umschalt-Logik.
//
// Ecke per ?map=left|right (Default rechts, Felix entscheidet endgueltig).
import { WALK_RADIUS, PIER, EXPLORE_RADIUS, coastWalkRadius } from './arena.js';

const params = new URLSearchParams(location.search);
const CORNER = params.get('map') === 'left' ? 'left' : 'right';

const SIZE = 180;        // Aussendurchmesser in CSS-Pixeln (Auftrag: ~180 px)
const THROTTLE_S = 0.1;  // 10 Hz — Auftragsvorgabe, keine Zeichnung pro rAF

// Feste Orte in Weltkoordinaten, aus den bestehenden Insel-Modulen abgelesen.
const WORLD_MAX = WALK_RADIUS + 14;        // Dorf-Massstab (wie R18-R22)
const ISLAND_MAX = EXPLORE_RADIUS + 6;     // Insel-Massstab (R23, ganze Kueste im Bild)
const ZOOM_OUT_R = WORLD_MAX - 4;          // ab hier zoomt die Karte heraus …
const ZOOM_IN_R = WORLD_MAX - 12;          // … und erst hier wieder hinein (Hysterese)
const PLAZA = { x: 0, z: 6 };              // Brunnen/Platzmitte (village.js wellX/wellZ)
const MARKET = { x: 10, z: 30 };           // Marktstaende (village.js)
const HARBOUR = { x: PIER.x, z: PIER.shoreZ + 2 }; // Stegkopf (arena.js PIER)

// Kuesten-Kontur einmal abtasten — coastWalkRadius ist eine reine Funktion,
// die Form aendert sich zur Laufzeit nie.
const COAST_PTS = [];
for (let i = 0; i < 96; i++) {
  const a = (i / 96) * Math.PI * 2;
  const dx = Math.sin(a), dz = Math.cos(a);
  const r = coastWalkRadius(dx, dz);
  COAST_PTS.push([dx * r, dz * r]);
}

function dpr() { return Math.min(2, window.devicePixelRatio || 1); }

export function createMinimap({ getHero, getQuestPos, getQuest, getPois }) {
  const wrap = document.createElement('div');
  wrap.id = 'minimap-wrap';
  wrap.className = `hud corner-${CORNER}`;

  const canvas = document.createElement('canvas');
  canvas.id = 'minimap-canvas';
  const scale = dpr();
  canvas.width = SIZE * scale;
  canvas.height = SIZE * scale;
  canvas.style.width = `${SIZE}px`;
  canvas.style.height = `${SIZE}px`;
  wrap.appendChild(canvas);

  const tracker = document.createElement('div');
  tracker.id = 'quest-tracker';
  tracker.className = 'hidden';
  tracker.innerHTML = '<div class="qt-title"></div><div class="qt-step"></div>';
  wrap.appendChild(tracker);

  document.body.appendChild(wrap);

  const ctx2d = canvas.getContext('2d');
  ctx2d.scale(scale, scale);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const R = SIZE / 2 - 6; // Rand fuer den duennen HUD-Ring

  const qtTitle = tracker.querySelector('.qt-title');
  const qtStep = tracker.querySelector('.qt-step');
  let lastQuestKey = null;

  // Zoom-Zustand: 0 = Dorf-Massstab, 1 = ganze Insel. zoomTarget mit Hysterese,
  // zoomK laeuft weich hinterher (kein Massstabs-Sprung an der Kante).
  let zoomTarget = 0;
  let zoomK = 0;
  let worldScale = R / WORLD_MAX;

  function toMap(wx, wz) {
    return [cx + wx * worldScale, cy + wz * worldScale];
  }

  function drawPlaceDot(g, pos, color, r = 3) {
    const [x, y] = toMap(pos.x, pos.z);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.globalAlpha = 0.85;
    g.fill();
    g.globalAlpha = 1;
  }

  function drawBase(g) {
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(10, 14, 20, 0.55)';
    g.fillRect(0, 0, SIZE, SIZE);

    // Insel-Kontur: die echte richtungsabhaengige Kueste (R23). Im Dorf-Massstab
    // liegt sie groesstenteils ausserhalb des Clip-Kreises — dann traegt der
    // hellere Dorf-Kreis darunter die Orientierung wie bisher.
    g.beginPath();
    for (let i = 0; i < COAST_PTS.length; i++) {
      const [x, y] = toMap(COAST_PTS[i][0], COAST_PTS[i][1]);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = 'rgba(210, 190, 150, 0.12)';
    g.fill();
    g.strokeStyle = 'rgba(210, 190, 150, 0.3)';
    g.lineWidth = 1;
    g.stroke();

    // Dorf-Scheibe (alter Umriss) als hellerer Kern
    const [ix, iy] = toMap(0, 0);
    g.beginPath();
    g.arc(ix, iy, WALK_RADIUS * worldScale, 0, Math.PI * 2);
    g.fillStyle = 'rgba(210, 190, 150, 0.14)';
    g.fill();
    g.strokeStyle = 'rgba(210, 190, 150, 0.3)';
    g.stroke();

    // Steg als schmale Linie vom Inselrand nach aussen (harbor.js PIER)
    const [px1, pz1] = toMap(PIER.x, PIER.shoreZ - 4);
    const [px2, pz2] = toMap(PIER.x, PIER.endZ);
    g.strokeStyle = 'rgba(210, 190, 150, 0.3)';
    g.lineWidth = Math.max(1.5, 3 * (1 - zoomK));
    g.beginPath();
    g.moveTo(px1, pz1);
    g.lineTo(px2, pz2);
    g.stroke();

    drawPlaceDot(g, PLAZA, '#9fd3ff');
    drawPlaceDot(g, MARKET, '#f2c46d');
    drawPlaceDot(g, HARBOUR, '#8fe0a8');
    // R23: Entdeckungs-Orte — im Insel-Massstab deutlich, im Dorf-Massstab
    // liegen sie ausserhalb des Clip-Kreises und stoeren nicht.
    const pois = getPois ? getPois() : null;
    if (pois) {
      for (const p of pois) drawPlaceDot(g, p, p.color || '#d9b06a', 2.5);
    }
    g.restore();

    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    g.lineWidth = 1;
    g.stroke();
  }

  // hero.group.rotation.y folgt im ganzen Spiel der Konvention
  // rotation.y = atan2(dirX, dirZ) — Blickrichtung ist (sin, cos).
  function drawPlayer(g, hero) {
    const pos = hero.group.position;
    // Randklemme gegen den JEWEILIGEN Kartenrand (Dorf- oder Insel-Massstab)
    const maxR = R / worldScale - 2;
    let wx = pos.x, wz = pos.z;
    const wr = Math.hypot(wx, wz);
    if (wr > maxR) {
      wx *= maxR / wr;
      wz *= maxR / wr;
    }
    const [x, y] = toMap(wx, wz);
    const facing = hero.group.rotation.y;
    const dx = Math.sin(facing);
    const dz = Math.cos(facing);
    const nx = -dz;
    const nz = dx;

    const tipLen = 8, backLen = 4, spread = 3.4;
    const tipX = x + dx * tipLen, tipY = y + dz * tipLen;
    const b1x = x - dx * backLen + nx * spread, b1y = y - dz * backLen + nz * spread;
    const b2x = x - dx * backLen - nx * spread, b2y = y - dz * backLen - nz * spread;

    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(b1x, b1y);
    g.lineTo(b2x, b2y);
    g.closePath();
    g.fillStyle = '#ff5a3c';
    g.fill();
  }

  function drawQuestMarker(g, pos) {
    const [x, y] = toMap(pos.x, pos.z);
    g.save();
    g.translate(x, y);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#ffe08a';
    g.fillRect(-3, -3, 6, 6);
    g.restore();
  }

  function redraw(dtStep) {
    // Auto-Zoom: Ziel aus der Spielerposition (Hysterese), weiches Nachziehen
    const hero = getHero && getHero();
    if (hero) {
      const hr = Math.hypot(hero.group.position.x, hero.group.position.z);
      if (hr > ZOOM_OUT_R) zoomTarget = 1;
      else if (hr < ZOOM_IN_R) zoomTarget = 0;
    }
    zoomK += (zoomTarget - zoomK) * Math.min(1, (dtStep || THROTTLE_S) * 4);
    if (Math.abs(zoomK - zoomTarget) < 0.005) zoomK = zoomTarget;
    const k = zoomK * zoomK * (3 - 2 * zoomK); // smoothstep — ruhiger Massstabswechsel
    worldScale = R / (WORLD_MAX + (ISLAND_MAX - WORLD_MAX) * k);

    ctx2d.clearRect(0, 0, SIZE, SIZE);
    drawBase(ctx2d);

    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, R, 0, Math.PI * 2);
    ctx2d.clip();

    if (hero) drawPlayer(ctx2d, hero);

    const quest = getQuest ? getQuest() : null;
    if (quest) {
      const qpos = getQuestPos && getQuestPos();
      if (qpos) drawQuestMarker(ctx2d, qpos);
    }
    ctx2d.restore();
  }

  function updateTracker(quest) {
    const key = quest && quest.title ? `${quest.title}|${quest.step}` : null;
    if (key === lastQuestKey) return;
    lastQuestKey = key;
    if (!key) {
      tracker.classList.add('hidden');
      return;
    }
    tracker.classList.remove('hidden');
    qtTitle.textContent = quest.title;
    qtStep.textContent = quest.step === 'done' ? 'Complete' : quest.step;
  }

  let acc = 0;
  function update(rawDt) {
    acc += rawDt || 0;
    if (acc < THROTTLE_S) return;
    const step = acc;
    acc = 0;
    redraw(step);
    updateTracker(getQuest ? getQuest() : null);
  }

  // sofortiger erster Zustand, bevor der erste Throttle-Tick vergangen ist
  redraw(THROTTLE_S);
  updateTracker(getQuest ? getQuest() : null);

  return { update };
}
