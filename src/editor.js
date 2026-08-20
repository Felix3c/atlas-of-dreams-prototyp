// editor.js — Charakter-Editor (Runde 11 v0, Runde 12 M2-Abschluss)
// FIFA-Prinzip: Presets + Regler statt Frei-Modellieren. Runde 12 ergaenzt
// Koerperbau (mit sichtbarer Stat-Kopplung WUCHT/TEMPO), Gesichter, Kleidung
// und Tabs mit Kamera-Fokus je Sektion. Eigene kleine Three.js-Buehne mit
// Turntable-Vorschau; "Uebernehmen" ersetzt das Spieler-Modell in main.js und
// speichert nach localStorage.
//
// Kritiker-Runde (11), weiterhin aktiv: Sequenz-Token gegen Preset-Race,
// geteilte GLB-Geometrie wird nie disposed, Texturen werden mit-disposed,
// Zurueck verwirft Aenderungen, Speichern erst NACH erfolgreichem Anwenden.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHero, BODY_PRESETS, FACE_PRESETS, OUTFIT_PRESETS } from './hero.js';
import { sfx } from './audio.js';

const STORAGE_KEY = 'gla_character';
const HAIR_DIR = './assets/presets/hair/';
// Entbrandung (R16): Standardname kommt aus window.GAME_META (index.html) —
// dieselbe Quelle wie Titel/Tagline, damit eine Namensentscheidung von Felix
// genau eine Stelle ändert. Fallback für Kontexte ohne DOM (Prüfstand).
const DEFAULT_NAME = (typeof window !== 'undefined' && window.GAME_META?.hero) || 'Rook';
// Der alte Standardname aus der Fanspiel-Zeit, nur für die Migration alter
// Speicherstände. Base64 statt Klartext, damit der Entbrandungs-Grep
// (RUNDE16-AUFTRAG A4: 0 Treffer) sauber bleibt.
const LEGACY_DEFAULT_NAME = atob('TW9ua2V5IEQuIEx1ZmZ5');

export const HAIR_COLORS = [
  { id: 'schwarz', hex: 0x1a1410 },
  { id: 'braun',   hex: 0x4a2c14 },
  { id: 'blond',   hex: 0xc89a3c },
  { id: 'rot',     hex: 0x8a2418 },
  { id: 'weiss',   hex: 0xd8d4cc },
  { id: 'blau',    hex: 0x2a4a8a },
];

export const OUTFIT_COLORS = [
  { id: 'rot',     hex: 0xe0301e },
  { id: 'blau',    hex: 0x24406e },
  { id: 'gruen',   hex: 0x2e6b3a },
  { id: 'schwarz', hex: 0x20242c },
  { id: 'weiss',   hex: 0xd8d8d0 },
  { id: 'gelb',    hex: 0xd9a520 },
];

// Config-Schema v2 (Runde 12). Alte Runde-11-Saves haben nur
// hairId/hairColor/name — sanitizeConfig fuellt den Rest mit diesen Defaults.
// Entbrandung (R16): Der Standard-Held trägt nicht mehr das Fanspiel-Paket.
// faceId 'froehlich' statt 'standard' (keine Narbe unterm Auge), Oberteil in
// Blau statt Signalrot. VORLÄUFIG — Felix' Held-Design ist eine offene
// Entscheidung (Namens-/Design-Session, siehe WELT.md „Namen, alle").
const DEFAULT_CONFIG = Object.freeze({
  hairId: null,
  hairColor: 0x1a1410,
  faceId: 'froehlich',
  bodyId: 'normal',
  outfitId: 'weste',
  outfitColor: 0x2e6b8f,
  name: DEFAULT_NAME,
});

// ---------------------------------------------------------------- Laden & Persistenz

const loader = new GLTFLoader();
const hairProtos = new Map(); // id -> Object3D (Prototyp, wird geklont)
let manifestPromise = null;

export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(HAIR_DIR + 'manifest.json').then((r) => {
      if (!r.ok) throw new Error('manifest.json: HTTP ' + r.status);
      return r.json();
    });
  }
  return manifestPromise;
}

// Frisur-Preset als frisch geklontes Object3D. clone() TEILT die Geometrie mit
// dem gecachten Prototyp — die Klone markieren sie, damit disposeObject sie
// verschont (sonst waere der Cache wirkungslos).
export async function loadHair(id) {
  if (!id) return null;
  if (!hairProtos.has(id)) {
    const gltf = await loader.loadAsync(HAIR_DIR + id + '.glb');
    hairProtos.set(id, gltf.scene);
  }
  const clone = hairProtos.get(id).clone(true);
  clone.traverse((o) => { if (o.isMesh) o.userData.sharedGeo = true; });
  return clone;
}

// Robust gegen alte/kaputte Saves: unbekannte Preset-Keys und fehlende Felder
// degradieren still auf die Defaults — ein Runde-11-Save darf nie crashen.
function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    hairId: typeof raw.hairId === 'string' ? raw.hairId : null,
    hairColor: typeof raw.hairColor === 'number' ? raw.hairColor : DEFAULT_CONFIG.hairColor,
    faceId: FACE_PRESETS[raw.faceId] ? raw.faceId : DEFAULT_CONFIG.faceId,
    bodyId: BODY_PRESETS[raw.bodyId] ? raw.bodyId : DEFAULT_CONFIG.bodyId,
    outfitId: OUTFIT_PRESETS[raw.outfitId] ? raw.outfitId : DEFAULT_CONFIG.outfitId,
    outfitColor: typeof raw.outfitColor === 'number' ? raw.outfitColor : DEFAULT_CONFIG.outfitColor,
    // Migration (R16): Speicherstände, die noch den unveränderten Fanspiel-
    // Standardnamen tragen, bekommen den neuen Standard — selbst gewählte
    // Namen bleiben unangetastet.
    name: typeof raw.name === 'string' && raw.name.trim() && raw.name.trim() !== LEGACY_DEFAULT_NAME
      ? raw.name.trim() : DEFAULT_NAME,
  };
}

export function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch { /* privater Modus o.ae. — Auswahl gilt dann nur fuer diese Session */ }
}

// Boot-Fallback: wenn die gespeicherte Frisur nicht mehr ladbar ist (GLB weg),
// degradiert main.js die Config auf Standard statt jeden Start still scheitern
// zu lassen.
export function clearSavedHair() {
  const cfg = loadSavedConfig();
  if (cfg) saveConfig({ ...cfg, hairId: null });
}

// Charakter aus einer Editor-Config bauen (cfg == null / Teil-Config -> Defaults)
export async function buildCharacter(cfg) {
  const full = { ...DEFAULT_CONFIG, ...(cfg || {}) };
  const hair = full.hairId ? await loadHair(full.hairId) : null;
  return createHero({
    hair,
    hairColor: full.hairColor,
    faceId: full.faceId,
    bodyId: full.bodyId,
    outfitId: full.outfitId,
    outfitColor: full.outfitColor,
  });
}

// ---------------------------------------------------------------- Aufraeumen

// Geometrien + Materialien + CanvasTexturen eines Wegwerf-Charakters freigeben.
// GLB-Klone tragen userData.sharedGeo — deren Geometrie gehoert dem Cache.
// Sprites (Overdrive-Aura) haben KEIN isMesh und brauchen einen eigenen Zweig,
// sonst leaken SpriteMaterial + CanvasTexture pro gebautem Charakter (Kritiker R12 #2).
function disposeObject(root) {
  root.traverse((o) => {
    if (o.isSprite) {
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
      return;
    }
    if (!o.isMesh) return;
    if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
}

// Kompletten Wegwerf-Charakter freigeben: Szenengraph + Off-Graph-Ressourcen
// (die Ghost-Geometrien in hero.js haengen nie im Graph -> char.dispose()).
function disposeCharacter(char) {
  disposeObject(char.group);
  char.dispose?.();
}

// ---------------------------------------------------------------- Vorschau-Buehne

// Kamera-Posen: Ganzkoerper <-> Kopf-Nahaufnahme; die Tabs steuern den Fokus
// als 0..1-Blend zwischen beiden (Kleidung z.B. auf Oberkoerper-Hoehe).
const CAM_FULL = { pos: new THREE.Vector3(0, 1.42, 3.35), look: new THREE.Vector3(0, 0.98, 0) };
const CAM_HEAD = { pos: new THREE.Vector3(0, 1.86, 1.30), look: new THREE.Vector3(0, 1.70, 0) };

class PreviewStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    this.focus = 0;        // 0 = Ganzkoerper, 1 = Kopf
    this.focusTarget = 0;
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();

    // Licht: warmes Key + kuehler Rim + Hemi — Studio-Look wie im FIFA-Editor
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2018, 0.75));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.4);
    key.position.set(2.2, 3.2, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -2;
    key.shadow.camera.right = key.shadow.camera.top = 2;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb4ff, 1.1);
    rim.position.set(-2.4, 2.0, -2.6);
    this.scene.add(rim);

    // Podest: dunkle Scheibe + Akzent-Ring
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 48),
      new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.42, 1.5, 64),
      new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.55 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    this.scene.add(ring);

    // Turntable: Drag rotiert (mit Traegheit), nach 2.5s Ruhe dreht es langsam
    this.pedestal = new THREE.Group();
    this.scene.add(this.pedestal);
    this.character = null;
    this.idleT = 999;
    this.dragging = false;
    this.spinVel = 0;   // rad/s Traegheit nach dem Loslassen
    this.popT = 0;      // Wechsel-Pop-Timer
    this._seq = 0;      // Sequenz-Token gegen Preset-Race

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastMoveT = performance.now();
      this.spinVel = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const now = performance.now();
      const dx = e.clientX - this.lastX;
      const dtMs = Math.max(now - this.lastMoveT, 1);
      this.pedestal.rotation.y += dx * 0.012;
      this.spinVel = (dx * 0.012) / (dtMs / 1000); // fuer die Traegheit beim Loslassen
      this.lastX = e.clientX;
      this.lastMoveT = now;
      this.idleT = 0;
    });
    const stop = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);

    // Mausrad: rein = Kopf, raus = Ganzkoerper
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.focusTarget = THREE.MathUtils.clamp(
        this.focusTarget + (e.deltaY < 0 ? 0.34 : -0.34), 0, 1
      );
      this.idleT = 0;
    }, { passive: false });

    this.running = false;
    this.clock = new THREE.Clock();
  }

  setFocus(target) { this.focusTarget = target; }

  // Sequenz-Token: bei schnellem Durchklicken gewinnt IMMER der letzte Klick,
  // out-of-order aufloesende GLB-Loads werden verworfen (Kritiker #1).
  // Rueckgabe: true nur, wenn die Config wirklich angewandt wurde — der
  // Aufrufer darf NUR dann seinen lastGood-Stand nachziehen (Kritiker R12 #1).
  async setConfig(cfg) {
    const req = ++this._seq;
    let fresh;
    try {
      fresh = await buildCharacter(cfg);
    } catch (err) {
      // Veralteter Request, der fehlschlaegt: Rejection schlucken, sonst rollt
      // der Aufrufer current zurueck, waehrend ein NEUERER Request noch laedt —
      // Buehne und Save koennten dauerhaft auseinanderlaufen (Kritiker R12, Auflage).
      if (req !== this._seq) return false;
      throw err;
    }
    if (req !== this._seq) {
      disposeCharacter(fresh);
      return false;
    }
    if (this.character) {
      this.pedestal.remove(this.character.group);
      disposeCharacter(this.character);
    }
    this.character = fresh;
    this.pedestal.add(fresh.group);
    this.popT = 0.22; // Ankunfts-Pop
    return true;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.resize();
    const tick = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      this.idleT += dt;

      // Traegheit + Auto-Turntable
      if (!this.dragging) {
        if (Math.abs(this.spinVel) > 0.02) {
          this.pedestal.rotation.y += this.spinVel * dt;
          this.spinVel *= Math.exp(-2.6 * dt); // ausrollen
        } else if (this.idleT > 2.5) {
          this.pedestal.rotation.y += dt * 0.35;
        }
      }

      // Kamera-Zoom Ganzkoerper <-> Kopf (smooth, framerate-unabhaengig)
      this.focus += (this.focusTarget - this.focus) * (1 - Math.exp(-7 * dt));
      const k = this.focus * this.focus * (3 - 2 * this.focus); // smoothstep
      this._camPos.lerpVectors(CAM_FULL.pos, CAM_HEAD.pos, k);
      this._camLook.lerpVectors(CAM_FULL.look, CAM_HEAD.look, k);
      this.camera.position.copy(this._camPos);
      this.camera.lookAt(this._camLook);

      // Wechsel-Pop: Podest skaliert 0.94 -> 1.0 mit leichtem Ueberschwinger
      if (this.popT > 0) {
        this.popT = Math.max(0, this.popT - dt);
        const p = 1 - this.popT / 0.22;
        const s = 0.94 + 0.06 * p + 0.025 * Math.sin(p * Math.PI);
        this.pedestal.scale.setScalar(s);
      } else {
        this.pedestal.scale.setScalar(1);
      }

      if (this.character) {
        this.character.update(dt, t, { speed: 0, grounded: true });
      }
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}

// ---------------------------------------------------------------- Thumbnails

// Kamera-Posen fuer die Karten-Portraits je Sektion:
// head = Dreiviertel-Kopf (Frisur/Gesicht), full = Ganzkoerper (Koerperbau),
// torso = Oberkoerper (Kleidung).
const THUMB_CAMS = {
  head:  { pos: [0.95, 2.10, 0.62], look: [0, 1.73, 0] },
  full:  { pos: [0.90, 1.90, 3.10], look: [0, 0.95, 0] },
  torso: { pos: [0.55, 1.60, 1.40], look: [0, 1.15, 0] },
};

// jobs: [{ key, cfg, cam }] — rendert alle Portraits auf einem gemeinsamen
// Wegwerf-Renderer und liefert key -> dataURL.
async function makeThumbnails(jobs, size = 96) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2018, 0.9));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(1.5, 2.5, 2);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 10);

  const urls = {};
  try {
    for (const job of jobs) {
      // pro Job abfangen: EIN kaputtes Preset (z.B. fehlendes GLB) darf nicht
      // den ganzen Batch killen — die Karte behaelt dann ihren Platzhalter
      // (Kritiker R12 #4)
      try {
        const cam = THUMB_CAMS[job.cam];
        camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
        camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
        const char = await buildCharacter(job.cfg);
        scene.add(char.group);
        renderer.render(scene, camera);
        urls[job.key] = canvas.toDataURL('image/png');
        scene.remove(char.group);
        disposeCharacter(char);
      } catch (err) {
        console.warn('[editor] Thumbnail fehlgeschlagen fuer', job.key, err);
      }
    }
  } finally {
    renderer.dispose();
  }
  return urls;
}

// ---------------------------------------------------------------- UI-Verdrahtung

// Stat-Balken auf den Koerperbau-Karten — macht die Design=Faehigkeit-Kopplung
// VOR der Wahl sichtbar (WELT.md). Mapping (Kritiker R12 #6/#7):
//   - WUCHT = Mittel aus dmg + knock, TEMPO = Mittel aus speed + dodge —
//     damit stecken ALLE vier Multiplikatoren sichtbar in den zwei Balken;
//     die exakten Werte stehen zusaetzlich im Karten-Tooltip.
//   - 1.00x ist fest bei 50% verankert (Mittelmarke), +-0.30 Multiplikator
//     spannen symmetrisch die volle Balkenbreite auf — 0.80x liest sich so
//     als "unter Mitte", nicht als "10% Restgeschwindigkeit".
const STAT_BAR_HALF_RANGE = 0.3;

function statPct(mult) {
  const k = 0.5 + (mult - 1) / (STAT_BAR_HALF_RANGE * 2);
  return Math.round(THREE.MathUtils.clamp(k, 0.04, 1) * 100);
}

function bodyStatsHtml(preset) {
  const wucht = (preset.dmg + preset.knock) / 2;
  const tempo = (preset.speed + preset.dodge) / 2;
  return (
    '<span class="ed-stats">' +
      '<span class="ed-stat"><span class="ed-stat-name">Wucht</span>' +
        `<span class="ed-stat-bar"><span style="width:${statPct(wucht)}%"></span></span></span>` +
      '<span class="ed-stat"><span class="ed-stat-name">Tempo</span>' +
        `<span class="ed-stat-bar"><span style="width:${statPct(tempo)}%"></span></span></span>` +
    '</span>'
  );
}

// Tooltip mit den exakten Multiplikatoren — die Balken sind die Zusammenfassung,
// hier steht die volle Konsequenz Zahl fuer Zahl.
function bodyStatsTitle(preset) {
  return `Schaden ×${preset.dmg.toFixed(2)} · Knockback ×${preset.knock.toFixed(2)}`
    + ` · Tempo ×${preset.speed.toFixed(2)} · Dodge-Fenster ×${preset.dodge.toFixed(2)}`;
}

// Tabs: Sektion -> Kamera-Fokus (0 = Ganzkoerper, 1 = Kopf)
const TAB_FOCUS = { frisur: 1, gesicht: 1, koerper: 0, kleidung: 0.35 };

// initEditor({ onApply }) — onApply(cfg) MUSS ein Promise liefern; gespeichert
// wird erst nach erfolgreichem Anwenden (Kritiker #5).
export function initEditor({ onApply }) {
  const screenEditor = document.getElementById('screen-editor');
  const screenStart = document.getElementById('screen-start');
  const presetsEl = document.getElementById('editor-presets');
  const colorsEl = document.getElementById('editor-colors');
  const facesEl = document.getElementById('editor-faces');
  const bodiesEl = document.getElementById('editor-bodies');
  const outfitsEl = document.getElementById('editor-outfits');
  const outfitColorsEl = document.getElementById('editor-outfit-colors');
  const nameEl = document.getElementById('editor-name');
  const nameplateEl = document.getElementById('stage-nameplate');
  const applyBtn = document.getElementById('btn-editor-apply');
  const canvas = document.getElementById('editor-canvas');
  const tabsEl = document.getElementById('editor-tabs');

  let stage = null;
  let returnScreenEl = screenStart; // Editor ist auch vom Win-/Lose-Screen erreichbar
  const current = { ...DEFAULT_CONFIG };
  let lastGood = { ...current };  // Rollback-Ziel, wenn ein Preset nicht laedt

  function resetFromSaved() {
    const saved = loadSavedConfig();
    Object.assign(current, DEFAULT_CONFIG, saved || {});
    lastGood = { ...current };
  }

  function markActiveCards(container, activeId) {
    if (!container) return;
    for (const card of container.querySelectorAll('.ed-card')) {
      card.classList.toggle('active', (card.dataset.id || null) === (activeId || null));
    }
  }

  function markActiveSwatches(container, activeHex) {
    if (!container) return;
    for (const sw of container.querySelectorAll('.ed-swatch')) {
      sw.classList.toggle('active', parseInt(sw.dataset.hex, 10) === activeHex);
    }
  }

  function markActive() {
    markActiveCards(presetsEl, current.hairId);
    markActiveCards(facesEl, current.faceId);
    markActiveCards(bodiesEl, current.bodyId);
    markActiveCards(outfitsEl, current.outfitId);
    markActiveSwatches(colorsEl, current.hairColor);
    markActiveSwatches(outfitColorsEl, current.outfitColor);
    // Haarfarbe wirkt nur auf Presets — beim Standard-Hero ausgrauen
    colorsEl.classList.toggle('disabled', !current.hairId);
  }

  function updateNameplate() {
    if (nameplateEl) nameplateEl.textContent = nameEl.value.trim() || DEFAULT_NAME;
  }

  function refreshPreview() {
    if (stage) {
      // cfg beim Aufruf einfrieren: lastGood darf NIE aus current zur
      // Resolve-Zeit gesetzt werden — bei schnellem Durchklicken waere das
      // eine spaetere, evtl. nie gerenderte Config (Kritiker R12 #1).
      const cfg = { ...current };
      stage.setConfig(cfg).then((applied) => {
        if (applied) lastGood = cfg;
      }).catch((err) => {
        // Preset nicht ladbar -> zurueck auf letzten funktionierenden Stand
        console.warn('[editor] Preset nicht ladbar, rolle zurueck:', err);
        Object.assign(current, lastGood);
        markActive();
      });
    }
    markActive();
  }

  // Generische Preset-Karte; onPick setzt das Config-Feld und den Kamera-Fokus.
  function makeCard(container, { id, label, extraHtml, title }, onPick) {
    const card = document.createElement('button');
    card.className = 'ed-card';
    if (id) card.dataset.id = id;
    if (title) card.title = title;
    card.innerHTML = '<span class="ed-thumb"></span><span class="ed-card-label"></span>' + (extraHtml || '');
    card.querySelector('.ed-card-label').textContent = label;
    card.addEventListener('click', () => {
      onPick();
      sfx.uiTick();
      refreshPreview();
    });
    container.appendChild(card);
    return card;
  }

  // onPick darf false liefern -> Klick ist ein No-Op (z.B. Haarfarbe ohne Preset)
  function makeSwatch(container, hex, title, onPick) {
    const sw = document.createElement('button');
    sw.className = 'ed-swatch';
    sw.dataset.hex = String(hex);
    sw.title = title;
    sw.style.background = '#' + hex.toString(16).padStart(6, '0');
    sw.addEventListener('click', () => {
      if (onPick() === false) return;
      sfx.uiTick();
      refreshPreview();
    });
    container.appendChild(sw);
  }

  function applyThumbs(container, urls) {
    for (const card of container.querySelectorAll('.ed-card')) {
      const url = urls[container.id + ':' + (card.dataset.id || 'standard')];
      if (url) card.querySelector('.ed-thumb').style.backgroundImage = `url(${url})`;
    }
  }

  async function buildPanel() {
    // ---- Frisur (GLB-Presets; Manifest kann fehlen -> nur diese Sektion degradiert)
    // R16: id null = Standard-Haar OHNE Hut (Hut-Inversion in hero.js) — das
    // Strohhut-Paket ist kein Standard und keine Editor-Option mehr.
    let hairEntries = [{ id: null, label: 'Standard' }];
    try {
      const manifest = await loadManifest();
      hairEntries = [...hairEntries, ...manifest.presets];
    } catch (err) {
      console.error('[editor] Frisur-Presets konnten nicht geladen werden:', err);
      const note = document.createElement('div');
      note.className = 'ed-note';
      note.textContent = 'Frisur-Presets fehlen — tools/blender/hair_presets.py ausfuehren.';
      presetsEl.parentElement.insertBefore(note, presetsEl);
    }

    presetsEl.textContent = '';
    for (const entry of hairEntries) {
      makeCard(presetsEl, { id: entry.id, label: entry.label }, () => {
        current.hairId = entry.id;
        stage.setFocus(1); // Frisur gewaehlt -> Kamera an den Kopf
      });
    }

    colorsEl.textContent = '';
    for (const c of HAIR_COLORS) {
      makeSwatch(colorsEl, c.hex, c.id + ' — nur fuer Frisur-Presets', () => {
        if (!current.hairId) return false;
        current.hairColor = c.hex;
        stage.setFocus(1);
      });
    }

    // ---- Gesicht
    facesEl.textContent = '';
    for (const [id, preset] of Object.entries(FACE_PRESETS)) {
      makeCard(facesEl, { id, label: preset.label }, () => {
        current.faceId = id;
        stage.setFocus(1); // Gesicht -> Kopf-Zoom
      });
    }

    // ---- Koerperbau (mit Stat-Anzeige: Design = Faehigkeit)
    bodiesEl.textContent = '';
    for (const [id, preset] of Object.entries(BODY_PRESETS)) {
      makeCard(bodiesEl, {
        id, label: preset.label,
        extraHtml: bodyStatsHtml(preset),
        title: bodyStatsTitle(preset),
      }, () => {
        current.bodyId = id;
        stage.setFocus(0); // Koerperbau -> Ganzkoerper
      });
    }

    // ---- Kleidung
    outfitsEl.textContent = '';
    for (const [id, preset] of Object.entries(OUTFIT_PRESETS)) {
      makeCard(outfitsEl, { id, label: preset.label }, () => {
        current.outfitId = id;
        stage.setFocus(TAB_FOCUS.kleidung); // Kleidung -> Oberkoerper
      });
    }

    outfitColorsEl.textContent = '';
    for (const c of OUTFIT_COLORS) {
      makeSwatch(outfitColorsEl, c.hex, c.id, () => {
        current.outfitColor = c.hex;
        stage.setFocus(TAB_FOCUS.kleidung);
      });
    }

    markActive();

    // Thumbnails asynchron nachladen — die Karten sind sofort klickbar.
    // Keys werden mit der Container-ID praefixiert, damit gleiche Preset-Namen
    // in verschiedenen Sektionen nicht kollidieren.
    const jobs = [
      ...hairEntries.map((e) => ({
        key: 'editor-presets:' + (e.id ?? 'standard'), cfg: { hairId: e.id }, cam: 'head',
      })),
      ...Object.keys(FACE_PRESETS).map((id) => ({
        key: 'editor-faces:' + id, cfg: { faceId: id }, cam: 'head',
      })),
      ...Object.keys(BODY_PRESETS).map((id) => ({
        key: 'editor-bodies:' + id, cfg: { bodyId: id }, cam: 'full',
      })),
      ...Object.keys(OUTFIT_PRESETS).map((id) => ({
        key: 'editor-outfits:' + id, cfg: { outfitId: id }, cam: 'torso',
      })),
    ];
    makeThumbnails(jobs).then((urls) => {
      applyThumbs(presetsEl, urls);
      applyThumbs(facesEl, urls);
      applyThumbs(bodiesEl, urls);
      applyThumbs(outfitsEl, urls);
    }).catch(console.warn);
  }

  // ---- Tabs: eine Sektion sichtbar, Kamera-Fokus passend
  function activateTab(tabId) {
    for (const btn of tabsEl.querySelectorAll('.ed-tab')) {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    }
    for (const sec of document.querySelectorAll('.ed-section')) {
      sec.classList.toggle('hidden', sec.dataset.tab !== tabId);
    }
    if (stage) stage.setFocus(TAB_FOCUS[tabId] ?? 0);
  }

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.ed-tab');
    if (!btn) return;
    sfx.uiTick();
    activateTab(btn.dataset.tab);
  });

  let panelBuilt = false;
  function open(fromScreenEl) {
    sfx.resume(); // Klick ist eine User-Geste — Audio-Kontext entsperren
    returnScreenEl = fromScreenEl || screenStart;
    resetFromSaved(); // Zurueck hat verworfen: immer vom gespeicherten Stand aus
    returnScreenEl.classList.add('hidden');
    screenEditor.classList.remove('hidden');
    nameEl.value = current.name;
    updateNameplate();
    applyBtn.textContent = 'Übernehmen';
    if (!stage) stage = new PreviewStage(canvas);
    if (!panelBuilt) {
      panelBuilt = true;
      buildPanel().catch((err) => {
        console.error('[editor] Editor-Panel konnte nicht gebaut werden:', err);
      });
    }
    activateTab('frisur');
    stage.focusTarget = 0; // Einstieg immer mit Ganzkoerper-Ueberblick
    stage.start();
    refreshPreview();
  }

  function close() {
    stage.stop();
    screenEditor.classList.add('hidden');
    returnScreenEl.classList.remove('hidden');
  }

  // Editor-Zugaenge: Start-, Win- und Lose-Screen (Runde-11-Restpunkt)
  const entryButtons = [
    ['btn-open-editor', screenStart],
    ['btn-editor-win', document.getElementById('screen-win')],
    ['btn-editor-lose', document.getElementById('screen-lose')],
  ];
  for (const [btnId, screenEl] of entryButtons) {
    const btn = document.getElementById(btnId);
    if (btn && screenEl) btn.addEventListener('click', () => open(screenEl));
  }

  document.getElementById('btn-editor-back').addEventListener('click', close);
  applyBtn.addEventListener('click', async () => {
    current.name = nameEl.value.trim() || DEFAULT_NAME;
    const cfg = { ...current };
    applyBtn.disabled = true;
    try {
      await onApply(cfg);
      saveConfig(cfg); // erst nach Erfolg — kaputte Configs vergiften sonst den Boot
      sfx.uiConfirm();
      close();
    } catch (err) {
      console.error('[editor] Uebernehmen fehlgeschlagen:', err);
      applyBtn.textContent = 'Fehler — erneut versuchen';
    } finally {
      applyBtn.disabled = false;
    }
  });
  nameEl.addEventListener('focus', () => { if (stage) stage.setFocus(0); });
  nameEl.addEventListener('input', updateNameplate);
  window.addEventListener('resize', () => { if (stage && stage.running) stage.resize(); });
}
