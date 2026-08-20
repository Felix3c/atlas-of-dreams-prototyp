// episode.js — R18 Umbau: die erste Story-Episode "The Arrest" (v4, nach Felix'
// Playtest der v3-Fassung "The Levy"). Design: RUNDE18-EPISODE-DESIGN.md (BINDEND).
//
// Struktur (v4): Akt 1 = zwei Vignetten im Dorf (Spieler behaelt volle Kontrolle,
// Statisten + 1-Satz-HUD-Zeile) -> Akt 2 = die Verhaftung auf dem Platz, endet in
// einem Handgemenge gegen 2 Marines mit dem ECHTEN Kampfsystem -> Akt 3 = der
// Fremde am Brunnen (Dialog + Richtungswahl) -> Akt 4 = Tat-Sequenz + Nachhall-Karte.
// Kai gehoert NICHT mehr zur Episode (bleibt Kampf-Begleiter, siehe main.js).
//
// TRIGGER-SICHERHEIT (unveraendert hart): sim/run.mjs importiert dieses Modul nie
// (eigene Welt aus sim/gen/, siehe sim/world.mjs) — kann es also strukturell nicht
// laden. Akt 1/2 zuenden aus dem idle-Update ueber einen reinen Abstandsvergleich
// (kein Zufall, kein Seiteneffekt ausserhalb des DOM/der Szene); Akt 3 startet
// weiterhin AUSSCHLIESSLICH aus dem echten 'keydown'-E-Event (tryStartEpisode(),
// von main.js aufgerufen). villagers.js/village.js/sim/ bleiben unberuehrt.
import * as THREE from 'three';
import { PIER } from './arena.js';
import { buildMarine } from './enemies.js';
import { sfx } from './audio.js'; // R22 Aufgabe B.3: Gemurmel-Bett der Schaulustigen

const DREAM_KEY = 'aod_dream'; // 'freedom' | 'fame' | 'throne' | 'revenge'

// ---------- Test-Reset (Auftrag Punkt 7): ?resetdream=1 loescht den Traum-Zustand
// beim Laden, bevor irgendeine der Funktionen unten ihn liest — die Episode laesst
// sich damit beliebig oft neu spielen, ohne localStorage von Hand zu leeren. Alle
// anderen Fortschritts-Flags (v1Seen/v2Seen/arrestDone) leben ohnehin nur im
// Modul-Zustand unten und sind nach jedem Neuladen automatisch zurueckgesetzt.
let CALL_NOW = false; // Test-Werkzeug R19: ?callnow=1 ueberspringt das Entdeckungsfenster
if (typeof location !== 'undefined' && typeof localStorage !== 'undefined') {
  const qp = new URLSearchParams(location.search);
  if (qp.get('resetdream') === '1') localStorage.removeItem(DREAM_KEY);
  CALL_NOW = qp.get('callnow') === '1';
}

// ---------- Texte (WOERTLICH aus RUNDE18-EPISODE-DESIGN.md, v4) ----------
const STRANGER_QUESTION = "Saw you tangle with that patrol, boy. So tell me — what do you want from this world?";
const ANSWERS = [
  { id: 'freedom', text: "Nothing from it. I just want all of it — every open mile." },
  { id: 'fame', text: 'That one day, every board in every port knows my name.' },
  { id: 'throne', text: "Somebody out there gives the orders. One day, that's me." },
  { id: 'revenge', text: 'That kid stole for his sister. Somebody should make them pay for that.' },
];
const ECHOES = {
  freedom: 'He rowed past the harbour lights and back before dawn. By morning, the fishermen were telling it like a story.',
  fame: 'By noon, half of Malis had seen the grinning poster. The Marines tore it down. Too late.',
  throne: 'The patrol found the tower lantern burning at dawn. Nobody had stood watch but the boy.',
  revenge: 'No charge sheet, no case. The boy walked free at sunrise. The Marines wrote it off as wind.',
};
// Erkennungsstück-Farben — VORSCHLAG, Felix entscheidet endgueltig (RUNDE18-EPISODE-
// DESIGN.md "Erkennungsstuecke"). Bis dahin bloss unterscheidbare Platzhalter-Primitive.
const TOKEN_COLOR = { freedom: 0xf2efe6, fame: 0xe6d9a8, throne: 0x9aa2ac, revenge: 0x8a6a44 };

// R20 Aufgabe A: Mini-Dialoge der Vignetten — 2-3 Wechselzeilen zwischen den
// Akteuren MIT Sprecher-Label (Label-Zeile ueber dem Text, Stil #episode-speaker;
// Felix' offener Punkt 3). Die R19-Beschreibungszeilen sind raus — der Dialog
// traegt die Doppeldeutigkeit selbst (V1: hilft UND notiert den Bestand; V2:
// netto-gut, sie bringen ihn wirklich heim). Englisch, Feinschliff = Felix.
const V1_SCRIPT = [
  { s: 'Merchant', t: 'Easy with that crate — easy! ...Thank you, sir.' },
  { s: 'Marine', t: 'Glad to help. Three crates of medicine, was it?' },
  { s: 'Merchant', t: '...Two, sir. Just the two.' },
];
const V2_SCRIPT = [
  { s: 'Drunk', t: "I can walk! The pier's right... that way." },
  { s: 'Marine', t: "The pier's behind you, friend. Come on — we'll see you home." },
  { s: 'Drunk', t: "...You're buying next round, then." },
];
// Akt-2-Beats: die Anklage SPRICHT jetzt der Officer (Auftrag A.4), die zweite
// Zeile bleibt Erzaehler.
const ARREST_LINE_1 = "Medicine, taken off the stall — that's theft. Take the boy.";
const ARREST_LINE_2 = 'In the crush, a Marine grabs Milo instead.';
const BRAWL_LINE = 'A Marine has you by the arm — fight your way free!';
const WHISTLE_LINE = 'Fall back!';
// R19 Aufgabe A: die Zeile des Ruf-Moments — setzt den Ton, ohne zu spoilern.
const CALL_LINE = 'Something is happening in the village.';
const BRAWL_GOAL = 'Fight your way free!';

// ---------- Szenen-Anker ----------
// Markt/Wegkreuzung: exakte Punkte aus island/village.js pathDefs (Marktstand-Kurve
// bzw. Abzweig Richtung Nordwest-Haus) — ein echter Wegknoten, keine erfundene Stelle.
const MARKET_POS = new THREE.Vector3(9.77, 0, 24.78);
const CROSSROADS_POS = new THREE.Vector3(9.69, 0, 31.76);
// Platz: village.js baut Brunnen/Platz um den Weltursprung (arena.js: "plaza r<9").
const PLAZA_POS = new THREE.Vector3(0, 0, 0);
const WELL_POS = new THREE.Vector3(0, 0, 6); // village.js wellX/wellZ (Kollider r=1.35)
const WELL_TALK_POS = new THREE.Vector3(1.8, 0, 7.2); // Fremder steht hier, ausserhalb des Brunnenrings
const BOARD_POS = new THREE.Vector3(4.2, 0, 2.6); // Aushangbrett am Platzrand
const TOWER_BASE_POS = new THREE.Vector3(0, 0, -27.2); // vor dem Wachturm-Kollider (0,-30, r=2.6)
const TOWER_TOP_POS = new THREE.Vector3(0, 9.48, -30); // Turmplattform (village.js obstacle topY)
const LANTERN_POS = new THREE.Vector3(3.6, 0, 8.6); // vorhandener Laternenpfosten (main.js SPAWN_POS-Kommentar)

const VIGNETTE_TRIGGER_R = 5.0;
const PLAZA_TRIGGER_R = 8.0;
const TRIGGER_R = 3.2;      // Akt-3-Prompt (Fremder am Brunnen)
const TRIGGER_EXIT_R = 4.4;

const BRAWL_HIT_TARGET = 6;   // gelandete Spielertreffer, danach pfeift der Officer ab
const BRAWL_TIME_LIMIT = 25;  // s — harte Obergrenze (Auftrag, hart)

// R19 Aufgabe A: stille Entdeckungsphase nach Spielstart — KEIN Marker, KEIN
// Quest-Eintrag, bis der Ruf-Moment gespielt hat.
// R21 Aufgabe B.2: das Fenster ist auf ~2 Minuten gestreckt (Felix: erst mal
// rumlaufen, sich mit der Welt vertraut machen). Die Weg-Bedingung (40 m) ist WEG —
// wer laeuft, findet jetzt von selbst den Markt (V1 zuendet seit R21 auch vor dem
// Ruf-Moment, s. updateIdle); der Ruf-Moment ist nur noch das Sicherheitsnetz fuer
// den, der zwei Minuten lang nichts mitbekommen hat.
const DISCOVER_MIN_T = 120;   // s freies Spiel, dann greift das Sicherheitsnetz
const BRAWL_MARINE_HP = 9999; // "nicht toedlich": die 2 Marines duerfen im Handgemenge nicht sterben
export const BRAWL_DAMAGE_MULT = 0.15; // main.js skaliert eingehenden Schaden waehrend isBrawlActive()

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
}
function shadow(m) {
  m.castShadow = true;
  return m;
}
function lerp(a, b, k) { return a + (b - a) * k; }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function easeInOut(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
function dist2D(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// ---------- generischer Statist (Markt-Haendler, Betrunkener, Dieb, der Fremde) —
// ein primitiver Figuren-Baukasten im Stil von villagers.js' Palette, aber eigen-
// staendig (villagers.js bleibt unangetastet, Auftragskopf). ----------
function buildFigure(opts = {}) {
  const {
    skin = 0xd39a6a, shirt = 0x7a8f5c, pants = 0x555f6e,
    hair = 0x3a2e22, hat = null, coat = null, scale = 1,
  } = opts;
  const g = new THREE.Group();
  const skinMat = mat(skin);
  const shirtMat = mat(shirt, { roughness: 0.95 });
  const pantsMat = mat(pants);

  const torso = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), shirtMat));
  torso.position.y = 1.02;
  torso.scale.set(0.92, 1, 0.9);
  torso.rotation.x = 0.1;
  g.add(torso);

  if (coat) {
    const coatMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.62, 4, 8), mat(coat, { roughness: 0.95 }));
    coatMesh.position.y = 0.98;
    coatMesh.scale.set(1, 1, 0.95);
    g.add(coatMesh);
  }

  const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skinMat));
  head.position.set(0, 1.56, 0.05);
  g.add(head);

  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), mat(hair));
  hairMesh.position.copy(head.position);
  hairMesh.position.y += 0.02;
  g.add(hairMesh);

  if (hat === 'straw') {
    const strawMat = mat(0xd9bc7a, { roughness: 0.95 });
    const brim = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.16, 10), strawMat));
    brim.position.set(0, 1.74, 0.05);
    g.add(brim);
  }

  for (const s of [-1, 1]) {
    const arm = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 4, 6), skinMat));
    arm.position.set(0.28 * s, 0.95, 0);
    arm.rotation.z = 0.2 * s;
    g.add(arm);
    const leg = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 4, 6), pantsMat));
    leg.position.set(0.12 * s, 0.35, 0);
    g.add(leg);
  }
  g.scale.setScalar(scale);
  return g;
}

// ---------- Aushangbrett + Bescheid-Blatt (Akt 2, bleibt bis Akt 4 sichtbar) ----------
function noticeTexture(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8dfc4';
  ctx.fillRect(0, 0, 128, 96);
  ctx.strokeStyle = '#3a3226';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 120, 88);
  ctx.fillStyle = '#2a2420';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 64, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildBoard() {
  const g = new THREE.Group();
  const woodMat = mat(0x6b4a2b);
  const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8), woodMat));
  post.position.y = 0.8;
  g.add(post);
  const board = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.06), woodMat));
  board.position.y = 1.55;
  g.add(board);

  // Charge-Sheet: startet unsichtbar, snappt beim Establish-Beat auf (Akt 2)
  const noticeMat = new THREE.MeshBasicMaterial({ map: noticeTexture('CHARGED'), transparent: true });
  const notice = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), noticeMat);
  notice.position.set(-0.12, 1.58, 0.035);
  notice.scale.setScalar(0.001);
  board.add(notice);

  // FAME-Tat: Milos eigenes Grinse-Blatt, DANEBEN genagelt (nicht darueber — v4)
  const posterMat = new THREE.MeshBasicMaterial({ map: noticeTexture('ME'), transparent: true });
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), posterMat);
  poster.position.set(0.12, 1.58, 0.045);
  poster.scale.setScalar(0.001);
  board.add(poster);

  g.userData.notice = notice;
  g.userData.poster = poster;
  return g;
}

// ---------- kleine Laterne (REVENGE-Tat: Verbrennungsstelle) ----------
function buildFlame() {
  const g = new THREE.Group();
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.22, 8),
    new THREE.MeshStandardMaterial({ color: 0xff8a3c, emissive: 0xff6a1a, emissiveIntensity: 1.4, roughness: 0.4 }),
  );
  flame.position.y = 0.11;
  flame.scale.setScalar(0.001);
  g.add(flame);
  g.userData.flame = flame;
  return g;
}

// ---------- R20 Aufgabe B: Episoden-Ruderboot (Freedom-Tat) ----------
// Gleiche Silhouette wie das Hafen-Boot aus island/harbor.js (halbe Kugel-Schale,
// Dollbord, Baenke), aber eigenstaendig und unbeleuchtet — es faehrt nur in der
// Tat-Sequenz und wird danach mit den uebrigen Statisten entsorgt.
// Das vertaeute Arena-Boot finden, OHNE harbor.js anzufassen (die Datei steht im
// Sim-Manifest — jede Aenderung dort braeche die bindende Bit-Exaktheit des
// Pruefstand-Outputs). Es ist die einzige Group an seiner Liegeposition
// (harbor.js: BOAT_X = PIER.x + 4.3, BOAT_Z = PIER.endZ - 3; nur y/Rotation duempeln).
function findHarborBoat() {
  const bx = PIER.x + 4.3, bz = PIER.endZ - 3;
  for (const o of ctx.scene.children) {
    if (o.isGroup && Math.abs(o.position.x - bx) < 0.01 && Math.abs(o.position.z - bz) < 0.01) return o;
  }
  return null;
}

function buildRowboat() {
  const g = new THREE.Group();
  const wood = mat(0x6b4a2b, { roughness: 0.9 });
  const hull = shadow(new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, side: THREE.DoubleSide }),
  ));
  hull.scale.set(1.05, 0.62, 2.4);
  g.add(hull);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 6, 24), wood);
  rim.rotation.x = -Math.PI / 2;
  rim.scale.set(1.05, 2.4, 1);
  g.add(rim);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 3.4), wood);
  floor.position.y = -0.34;
  g.add(floor);
  for (const bz of [-0.75, 0.75]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.42), wood);
    bench.position.set(0, -0.08, bz);
    g.add(bench);
  }
  return g;
}

// =====================================================================================
// ---------- Modul-Zustand ----------
// =====================================================================================
let ctx = null; // { scene, camera, player, getHero, kai, enemyManager, isPlaying,
                 //   isPeaceCalm, exitPointerLock, requestPointerLock, setBanter, showBanner }
// R19-Ablauf: idle(Entdeckung) -> call/callOut (Ruf-Moment) -> idle -> vignette/
// vignetteOut (x2) -> idle -> arrestIntro -> arrestOut -> brawl -> whistle/whistleOut
// -> idle -> dialogWell -> fadeToAct -> act -> fadeToCard -> card -> fadeOut -> idle(done)
let phase = 'idle';
let t = 0;
let chosen = null;
let promptVisible = false;

let v1Seen = false;
let v2Seen = false;
let arrestDone = false;
let activeVignette = null; // 'v1' | 'v2'

let brawlHits = 0;
let brawlMarines = [];

// R19 Aufgabe A: Entdeckungsfenster -> Ruf-Moment
let callSeen = false;
let discoverT = 0; // R21: nur noch Zeit — die Weg-Messung (discoverDist) ist mit der Weg-Bedingung entfallen
let callActors = [];
let callSpawned = false;
let callLineShown = false;

// R19 Aufgabe B: Vignetten-Kamera (Anflug ab aktueller Kameraposition)
const _vigStartPos = new THREE.Vector3();
const _vigStartLook = new THREE.Vector3();
// R20 Aufgabe A: Dialog-Playback der Vignette — Skript, aktueller Zeilenindex,
// Gesamtdauer (Summe der Standzeiten; ersetzt das harte VIG_HOLD aus R19).
let vigScript = [];
let vigLineIdx = -1;
let vigHold = 0;

// R19 Aufgabe D: Verwechslungs-Statist (Establish) + Pfiff-Rueckzug
let grabMarine = null;
const _grabFrom = new THREE.Vector3();
const _grabTo = new THREE.Vector3();
const _retreatDir = new THREE.Vector3();
let retreatFigs = [];   // { obj, from } — Figuren, die beim Pfiff sichtbar ablaufen
const _lookB = new THREE.Vector3();
const _dir = new THREE.Vector3();

// R22 Aufgabe B: Tumult — Schaulustige, Absperr-Marines, umgestoßener Stand.
// Alles über das EIGENE Statisten-System (buildFigure/spawnActor), nichts davon
// überlebt die Szene: die Menge zerstreut sich beim Pfiff sichtbar und wird in
// beginWhistleOut() entsorgt (R20-Muster), der Stand mit ihr.
let crowdFigs = [];      // { obj, spawn:V3, ring:V3, scatter:V3(dir), phase, face }
let barrierMarines = []; // { obj, base:V3, lat:V3(seitliche Pendel-Richtung), face }
let tippedStand = null;

// DOM
let promptEl, promptTextEl, dialogEl, speakerEl, lineEl, optionsEl, cardEl, cardTextEl, fadeEl;
let subtitleEl, objectiveEl; // R19: Untertitel unten Mitte + Kampfziel-Zeile
let subSpeakerEl, subTextEl; // R20 Aufgabe A: Sprecher-Label + Textzeile im Untertitel
let domReady = false;
let optionButtons = [];

// spawned decorative actors (disposed am Episodenende) — die 2 echten Brawl-Marines
// leben NICHT hier, sondern in enemyManager.enemies (siehe beginBrawl/endBrawl).
const actors = [];
let officer = null, thief = null, board = null, stranger = null, vignetteActors = [];
// R27 Aufgabe A (Felix: "Weltszenen statt Verschwinde-Cutscenes"): Nachleben der
// Vignetten-Statisten. Nach der Szene despawnt NIEMAND im Bild — die Akteure werden
// zu Walkern, die echte Wegknoten ablaufen (v1-Marine die Gasse hoch Richtung
// Kreuzung/Pier, Haendler zurueck an seinen Stand, v2-Trio Richtung Pier "heim")
// und erst AUSSER SICHT still entfernt werden (Option a, von Felix entschieden).
// { obj, pts:[V3...], i, speed, bobPhase, walkT, face?, outT }
let afterlifeWalkers = [];
// R20 Aufgabe B: das Episoden-Ruderboot der Freedom-Tat + das versteckte Arena-Boot
// (harbor.js vertaeut seins am Steg und duempelt es per Updater — es laesst sich
// nicht sauber bewegen, also spawnt die Episode ein eigenes und blendet das
// Arena-Boot solange aus, damit keine zwei Boote im Bild liegen; Auftrag B.1).
let epBoat = null;
let harborBoat = null;

const _savedHeroPos = new THREE.Vector3();

function isDreamSetInternal() { return typeof localStorage !== 'undefined' && !!localStorage.getItem(DREAM_KEY); }

// ---------- DOM einrichten ----------
function bindDom() {
  if (domReady) return;
  promptEl = document.getElementById('episode-prompt');
  promptTextEl = document.getElementById('episode-prompt-text');
  dialogEl = document.getElementById('episode-dialog');
  speakerEl = document.getElementById('episode-speaker');
  lineEl = document.getElementById('episode-line');
  optionsEl = document.getElementById('episode-options');
  cardEl = document.getElementById('episode-card');
  cardTextEl = document.getElementById('episode-card-text');
  fadeEl = document.getElementById('episode-fade');
  subtitleEl = document.getElementById('episode-subtitle');
  subSpeakerEl = document.getElementById('episode-subtitle-speaker');
  subTextEl = document.getElementById('episode-subtitle-text');
  objectiveEl = document.getElementById('episode-objective');
  domReady = !!(promptEl && dialogEl && speakerEl && lineEl && optionsEl && cardEl && cardTextEl && fadeEl
    && subtitleEl && subSpeakerEl && subTextEl && objectiveEl);
}

// ---------- R19 Aufgabe C: Untertitel-System (Story-Zeilen unten Mitte) ----------
// ALLE Episoden-Story-Zeilen laufen hierueber; Kais Banter-Zeile unten links bleibt
// Kai vorbehalten. Standzeit: ~0,06 s/Zeichen, mindestens 2,5 s (Auftrag C.3).
let subTimer = 0;

// Standzeit einer Zeile (Auftrag A.2: ~0,06 s/Zeichen, min. 2,5 s) — auch die
// Vignetten-Dauer rechnet damit (Kamera haelt, bis alle Zeilen durch sind).
function lineHold(text) { return Math.max(2.5, text.length * 0.06); }

// R20 Aufgabe A: optionales Sprecher-Label — Erzaehler-Zeilen lassen es leer
// (#episode-subtitle-speaker:empty blendet die Label-Zeile im CSS aus).
function showSubtitle(text, extraHold = 0, speaker = '') {
  if (!subtitleEl) return;
  subSpeakerEl.textContent = speaker;
  subTextEl.textContent = text;
  subtitleEl.classList.add('show');
  subTimer = lineHold(text) + extraHold;
}

function hideSubtitle() {
  subTimer = 0;
  subtitleEl?.classList.remove('show');
}

function updateSubtitle(rawDt) {
  if (subTimer <= 0) return;
  subTimer -= rawDt;
  if (subTimer <= 0) subtitleEl.classList.remove('show');
}

// R19 Aufgabe D.2: EINE klare Kampfziel-Anzeige — Zeile + Trefferfortschritt
// (brawlHits existiert schon; der Countdown bleibt bewusst unsichtbar).
function setObjective(text) {
  if (!objectiveEl) return;
  if (text) {
    objectiveEl.textContent = text;
    objectiveEl.classList.add('show');
  } else {
    objectiveEl.classList.remove('show');
  }
}

function setFade(v) {
  if (fadeEl) fadeEl.style.opacity = String(clamp01(v));
}

function setPromptVisible(v) {
  if (promptVisible === v) return;
  promptVisible = v;
  if (promptEl) promptEl.classList.toggle('show', v);
}

// ---------- Actor-Verwaltung (dekorative Statisten/Props) ----------
function spawnActor(obj) {
  ctx.scene.add(obj);
  actors.push(obj);
  return obj;
}

function disposeObject3D(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
}

function despawnActor(obj) {
  ctx.scene.remove(obj);
  disposeObject3D(obj);
  const idx = actors.indexOf(obj);
  if (idx >= 0) actors.splice(idx, 1);
}

function despawnAllActors() {
  for (const obj of actors) {
    ctx.scene.remove(obj);
    disposeObject3D(obj);
  }
  actors.length = 0;
  officer = thief = board = stranger = null;
  grabMarine = null;
  vignetteActors = [];
  callActors = [];
  retreatFigs = [];
  // R22: Tumult-Statisten sind normale actors und damit oben schon entsorgt —
  // hier nur die Verwaltungslisten leeren und das Gemurmel sicher beenden.
  // R23: eine evtl. laufende NPC-Borgung zurueckgeben (geborgte Figuren stehen
  // NICHT in actors und ueberleben das Entsorgen — genau richtig).
  ctx?.releaseAmbient?.();
  afterlifeWalkers = []; // R27: Walker-Objekte stehen in actors und sind oben schon entsorgt
  crowdFigs = [];
  barrierMarines = [];
  tippedStand = null;
  sfx.murmurStop();
  // R20 Aufgabe B: Episoden-Boot ist ueber actors bereits entsorgt; das Arena-Boot
  // kommt zurueck ins Bild (despawnAllActors laeuft bei finishEpisode UND resetDream).
  epBoat = null;
  if (harborBoat) { harborBoat.visible = true; harborBoat = null; }
}

// =====================================================================================
// ---------- oeffentliche API ----------
// =====================================================================================

// einmalig aus main.js: initEpisode({ scene, camera, player, getHero, kai, enemyManager,
//   isPlaying, isPeaceCalm, exitPointerLock, requestPointerLock, setBanter, showBanner })
export function initEpisode(episodeCtx) {
  ctx = episodeCtx;
  bindDom();
  optionsEl?.addEventListener('click', onOptionsClick);
  document.addEventListener('keydown', onAnswerKeydown);
}

export function isEpisodeActive() {
  return phase !== 'idle';
}

// main.js gated hiermit Kamera/Physik/Kampf/Companion: waehrend 'vignette' und
// 'brawl' behaelt der Spieler VOLLE Kontrolle (Design v4, Punkt 2+3 — kein
// Kamera-Entfuehren in den Vignetten, echtes Kampfsystem im Handgemenge). Nur die
// inszenierten Beats (Establish, Brunnen-Dialog, Tat-Sequenz, Karte) uebernehmen.
export function isEpisodeCutscene() {
  // R19: JEDE Phase ausser 'idle' und 'brawl' uebernimmt Kamera/Spieler — auch die
  // Vignetten (Felix' Urteil kippt die R18-Entscheidung "ohne Kamera-Uebernahme")
  // und die kurzen Snap-Zurueck-Segmente (callOut/vignetteOut/arrestOut/whistleOut).
  // Im Handgemenge ('brawl') behaelt der Spieler weiterhin volle Kontrolle.
  return phase !== 'idle' && phase !== 'brawl';
}

export function isBrawlActive() {
  return phase === 'brawl';
}

export function isDreamSet() {
  return isDreamSetInternal();
}

// R23: Weltzeilen von AUSSERHALB der Episode (Flaschenpost in island/discover.js,
// Wiedererkennen-Beat der Marine-Patrouille in main.js) laufen ueber DENSELBEN
// Untertitel-Kanal wie die Episoden-Zeilen — eine Anzeige, eine Standzeit-Logik,
// kein zweites Subtitle-System. Ausserhalb des DOM-Setups ein No-Op.
export function showWorldLine(text, speaker = '') {
  if (!domReady) return;
  showSubtitle(text, 0.4, speaker);
}

// R18-Reparatur (Felix' Spaettest 14.08.): Rueckkehrer mit gesetztem Traum sahen von
// der Episode NICHTS und hatten keinen sichtbaren Weg zurueck — ?resetdream=1 ist
// Test-Werkzeug, kein Onboarding. Der "New Journey"-Knopf im Start-Screen (main.js)
// ruft dies: loescht den Traum UND die Session-Flags, damit die Episode auch nach
// einem Durchlauf in derselben Sitzung komplett von vorn laeuft.
export function resetDream() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(DREAM_KEY);
  v1Seen = false;
  v2Seen = false;
  arrestDone = false;
  activeVignette = null;
  brawlMarines = [];
  chosen = null;
  // R19: auch das Entdeckungsfenster beginnt von vorn — der Ruf-Moment gehoert
  // zum Episoden-Einstieg und muss bei "New Journey" erneut spielen.
  callSeen = false;
  discoverT = 0;
  hideSubtitle();
  setObjective(null);
  ctx?.hideLetterbox?.();
  if (ctx && actors.length) despawnAllActors(); // raeumt auch einen Rest-Fremden weg
  phase = 'idle';
  t = 0;
}

// main.js' Combat-onHit-Hook ruft dies bei JEDEM gelandeten Spielertreffer auf
// (unconditionally) — ausserhalb von 'brawl' oder gegen andere Ziele ist es ein No-Op.
export function notifyEpisodeHit(enemy) {
  if (phase !== 'brawl') return;
  if (!brawlMarines.includes(enemy)) return;
  brawlHits++;
  // R19 Aufgabe D.2: Fortschritt sichtbar machen — dieselbe Zeile, die beginBrawl setzt
  setObjective(`${BRAWL_GOAL} — ${Math.min(brawlHits, BRAWL_HIT_TARGET)} / ${BRAWL_HIT_TARGET}`);
}

// main.js ruft dies NUR aus dem echten keydown-Handler fuer 'E' auf — das startet
// ausschliesslich Akt 3 (der Brunnen-Prompt). Akt 1/2 zuenden von selbst (Naehe),
// siehe updateIdle().
export function tryStartEpisode() {
  if (!ctx || !domReady) return false;
  if (isDreamSetInternal() || isEpisodeActive()) return false;
  if (!ctx.isPlaying() || !ctx.isPeaceCalm()) return false;
  if (!arrestDone || !stranger) return false;
  const hero = ctx.getHero();
  if (dist2D(hero.group.position, WELL_TALK_POS) > TRIGGER_R) return false;
  beginDialogWell();
  return true;
}

export function getQuest() {
  if (isDreamSetInternal()) return null;
  // R19 Aufgabe A.1: waehrend des Entdeckungsfensters bleibt der Tracker LEER —
  // erst der Ruf-Moment stellt die Quest ein (Builder-Entscheidung: leer statt
  // neutraler Eintrag, damit der Ruf-Moment wirklich der erste Story-Impuls ist).
  if (!callSeen) return null;
  // R26: der Tracker fuehrt NACHEINANDER zu beiden Vignetten (Reihenfolge-agnostisch —
  // wer die Wegkreuzung zuerst findet, wird danach zum Markt geschickt und umgekehrt).
  // Erst mit v1+v2 zeigt er den Platz; das spiegelt das &&-Gate in updateIdle().
  if (!arrestDone) {
    if (!v1Seen && !v2Seen) return { title: 'The Arrest', step: 'Something is happening in the village' };
    if (!v2Seen) return { title: 'The Arrest', step: 'Another patrol, further up the lane' };
    if (!v1Seen) return { title: 'The Arrest', step: 'Voices from the market' };
    return { title: 'The Arrest', step: 'Trouble at the plaza' };
  }
  return { title: 'The Arrest', step: 'Talk to the stranger by the well' };
}

// fuer minimap.js: fester Zielpunkt zum aktuellen Quest-Schritt. R18-Reparatur
// (Felix' Design-Auftrag "mehr Leitfaden"): auch VOR der ersten Vignette gibt es
// jetzt einen Pin — auf den Markt (V1), damit der Tracker-Schritt "Something is
// happening in the village" ab Spielstart ein sichtbares Ziel hat. Das fruehere
// "Akt 1 bewusst ambient" (null) hat Felix' Spaettest als fuehrungslos verworfen.
export function getQuestTargetPos() {
  if (isDreamSetInternal()) return null;
  // R19 Aufgabe A.2: der R18-"Marker ab Sekunde 1" wird auf "Marker ab Ruf-Moment"
  // umgestellt — das hier ist das Signal aus dem neuen Ablauf.
  if (!callSeen) return null;
  // R26: Pin folgt der neuen Schritt-Folge — erst die noch fehlende Vignette, dann der Platz.
  if (!arrestDone) {
    if (!v1Seen) return MARKET_POS;
    if (!v2Seen) return CROSSROADS_POS;
    return PLAZA_POS;
  }
  return WELL_TALK_POS;
}

// main.js ruft dies JEDEN Frame in state.mode === 'playing' auf (rawDt = echte Zeit).
export function updateEpisode(rawDt) {
  if (!ctx || !domReady) return;
  updateSubtitle(rawDt); // R19: Untertitel-Standzeit laeuft in JEDER Phase (auch idle)
  updateAfterlife(rawDt); // R27: Nachleben-Walker gehen in JEDER Phase weiter (kein Einfrieren)
  if (phase === 'idle') {
    updateIdle(rawDt);
    return;
  }
  t += rawDt;
  switch (phase) {
    case 'call': updateCall(rawDt); break;
    case 'callOut': updateCallOut(rawDt); break;
    case 'vignette': updateVignette(rawDt); break;
    case 'vignetteOut': updateVignetteOut(rawDt); break;
    case 'arrestIntro': updateArrestIntro(rawDt); break;
    case 'arrestOut': updateArrestOut(rawDt); break;
    case 'brawl': updateBrawl(rawDt); break;
    case 'whistle': updateWhistle(rawDt); break;
    case 'whistleOut': updateWhistleOut(rawDt); break;
    case 'dialogWell': updateDialogWell(rawDt); break;
    case 'fadeToAct': updateFadeToAct(rawDt); break;
    case 'act': updateAct(rawDt); break;
    case 'fadeToCard': updateFadeToCard(rawDt); break;
    case 'card': updateCard(rawDt); break;
    case 'fadeOut': updateFadeOut(rawDt); break;
    default: break;
  }
}

// =====================================================================================
// ---------- idle: Trigger fuer Akt 1 (Vignetten), Akt 2 (Platz) und den Akt-3-Prompt --
// =====================================================================================
function updateIdle(rawDt) {
  if (isDreamSetInternal() || !ctx.isPlaying() || !ctx.isPeaceCalm()) {
    setPromptVisible(false);
    return;
  }
  const hero = ctx.getHero();
  const pos = hero.group.position;

  // R19 Aufgabe A / R21 Aufgabe B: Entdeckungsfenster. VOR dem Ruf-Moment zuendet
  // weiterhin kein Marker und kein Prompt — aber die MARKT-Vignette darf (R21 B.1,
  // AUSDRUECKLICH beauftragte Ausnahme vom Trigger-Tabu): wer beim Rumlaufen in
  // ihren Radius geraet, bekommt den Story-Einstieg direkt am Ort des Geschehens;
  // updateVignetteOut() setzt danach das callSeen-Aequivalent, der Ruf-Moment
  // entfaellt fuer diesen Lauf ersatzlos. Sonst greift nach DISCOVER_MIN_T das
  // Sicherheitsnetz (der Schnitt wartet wie bisher, bis der Spieler am Boden steht).
  if (!callSeen) {
    setPromptVisible(false);
    if (!v1Seen && dist2D(pos, MARKET_POS) <= VIGNETTE_TRIGGER_R) { beginVignette('v1'); return; }
    discoverT += rawDt;
    const ready = CALL_NOW || discoverT >= DISCOVER_MIN_T;
    if (ready && (ctx.isGrounded?.() ?? true)) beginCall();
    return;
  }

  if (!v1Seen && dist2D(pos, MARKET_POS) <= VIGNETTE_TRIGGER_R) { beginVignette('v1'); return; }
  if (!v2Seen && dist2D(pos, CROSSROADS_POS) <= VIGNETTE_TRIGGER_R) { beginVignette('v2'); return; }

  // R26 (Felix' Dramaturgie-Auftrag): der Platz zuendet erst, wenn BEIDE Vignetten
  // gesehen sind — der Spieler soll sich vorher ein eigenes Urteil ueber die Marine
  // bilden (v1 fragwuerdig, v2 netto-gut), dann kommt die Verhaftung als Hauptstueck.
  if (!arrestDone && v1Seen && v2Seen && dist2D(pos, PLAZA_POS) <= PLAZA_TRIGGER_R) {
    beginArrestIntro();
    return;
  }

  if (arrestDone && stranger) {
    const d = dist2D(pos, WELL_TALK_POS);
    if (promptVisible) setPromptVisible(d <= TRIGGER_EXIT_R);
    else setPromptVisible(d <= TRIGGER_R);
  } else {
    setPromptVisible(false);
  }
}

// =====================================================================================
// ---------- R19 Aufgabe A: der Ruf-Moment — Kameraschnitt zum Markt (Letterbox) ------
// =====================================================================================
// Schwarzblende -> Schnitt auf das Markt-Treiben (Marine + Haendler, hinter dem Fade
// gespawnt) -> Untertitel setzt den Ton -> Schwarzblende -> Snap zurueck zum Spieler.
// ERST DANACH erscheinen Minimap-Marker + Quest-Schritt (callSeen).
const CALL_T1 = 0.35;             // Blende zu Schwarz
const CALL_T2 = CALL_T1 + 0.3;    // Blende auf am Markt
const CALL_T3 = CALL_T2 + 3.0;    // gehaltene Einstellung: das Treiben
const CALL_T4 = CALL_T3 + 0.3;    // Blende zu Schwarz
const CALL_OUT = 0.4;             // Blende auf + Kamera-Snap zurueck zum Spieler
const CALL_CAM_POS = new THREE.Vector3(MARKET_POS.x + 3.1, 1.9, MARKET_POS.z + 2.7);
const CALL_CAM_LOOK = new THREE.Vector3(MARKET_POS.x - 0.2, 1.15, MARKET_POS.z + 0.05);

function beginCall() {
  phase = 'call';
  t = 0;
  callSpawned = false;
  callLineShown = false;
  ctx.exitPointerLock?.();
  ctx.showLetterbox?.();
}

function spawnCallActors() {
  const marine = spawnActor(buildMarine('swabbie').group);
  marine.position.set(MARKET_POS.x - 0.9, 0, MARKET_POS.z + 0.3);
  marine.rotation.y = Math.PI * 0.3; // blickt Richtung Kamera-Quadrant (+x/+z) — frontal-seitlich
  const merchant = spawnActor(buildFigure({ skin: 0xc98a5c, shirt: 0x8a5a34, pants: 0x4a3a2a, hat: 'straw' }));
  merchant.position.set(MARKET_POS.x + 0.6, 0, MARKET_POS.z - 0.2);
  merchant.rotation.y = -Math.PI * 0.5;
  callActors = [marine, merchant];
}

function updateCall(rawDt) {
  const hero = ctx.getHero();
  hero.update(rawDt, t, { speed: 0, grounded: true });
  ctx.kai?.update(rawDt, t, { speed: 0, grounded: true });

  if (t < CALL_T1) { setFade(t / CALL_T1); return; } // Kamera bleibt, Bild wird schwarz
  if (!callSpawned) {
    callSpawned = true;
    spawnCallActors(); // hinter dem Fade — kein Aufpoppen im Bild (Aufgabe B.2)
  }
  ctx.camera.position.copy(CALL_CAM_POS);
  ctx.camera.lookAt(CALL_CAM_LOOK);
  const bob = Math.sin(t * 2.4) * 0.03;
  for (const a of callActors) a.position.y = bob;

  if (t < CALL_T2) { setFade(1 - (t - CALL_T1) / (CALL_T2 - CALL_T1)); }
  else if (t < CALL_T3) {
    setFade(0);
    if (!callLineShown) { callLineShown = true; showSubtitle(CALL_LINE, 0.5); }
  } else if (t < CALL_T4) { setFade((t - CALL_T3) / (CALL_T4 - CALL_T3)); }
  else {
    for (const a of callActors) despawnActor(a);
    callActors = [];
    callSeen = true; // ab jetzt: Quest-Eintrag + Minimap-Marker (getQuest/getQuestTargetPos)
    ctx.hideLetterbox?.();
    phase = 'callOut';
    t = 0;
  }
}

function updateCallOut(rawDt) {
  const hero = ctx.getHero();
  hero.update(rawDt, t, { speed: 0, grounded: true });
  ctx.kai?.update(rawDt, t, { speed: 0, grounded: true });
  ctx.snapCamera?.(rawDt); // Follow-Kamera faengt sich hinter der oeffnenden Blende
  setFade(1 - clamp01(t / CALL_OUT));
  if (t >= CALL_OUT) {
    setFade(0);
    ctx.requestPointerLock?.();
    // R20 Aufgabe C.2: Akt-Zwischentitel (AC-Stil) — wiederverwendet das vorhandene
    // Banner-Element; 1 Zeile Kontext, keine Quest-Info (die steht im Tracker).
    // Texte = Builder-Vorschlag, Felix redigiert.
    ctx.showBanner?.('The Arrest', 'Act I — Marines walk the village');
    phase = 'idle';
    t = 0;
  }
}

// =====================================================================================
// ---------- Akt 1: Vignetten — R19 Aufgabe B: kurze Kamera-Uebernahme mit Letterbox --
// =====================================================================================
// Felix' Playtest kippt die R18-Entscheidung "Vignetten ohne Kamera-Uebernahme":
// er sah nur den Ruecken des Haendlers. Jetzt: Letterbox schliesst, Kamera faehrt in
// eine Einstellung, in der BEIDE Akteure lesbar sind (Marines frontal-seitlich),
// Statisten wachsen im Anflug ein (kein hartes Aufpoppen), Untertitel unten Mitte,
// danach schrumpfen sie wieder und die Kamera snappt zurueck an den Spieler.
const VIG_IN = 0.5;    // Kamera-Anflug + Statisten-Einwachsen
// R20 Aufgabe A.2: die harten 3,6 s Standzeit aus R19 sind weg — die gehaltene
// Einstellung dauert jetzt die SUMME der Zeilen-Standzeiten (vigHold, s. beginVignette).
const VIG_LINE_GAP = 0.25; // kleine Atempause zwischen zwei Dialog-Zeilen
const VIG_OUT = 0.45;  // Statisten schrumpfen, Kamera snappt zurueck
const VIG_CAM = {
  v1: { pos: new THREE.Vector3(MARKET_POS.x + 3.1, 1.9, MARKET_POS.z + 2.7),
        look: new THREE.Vector3(MARKET_POS.x - 0.2, 1.15, MARKET_POS.z + 0.05) },
  v2: { pos: new THREE.Vector3(CROSSROADS_POS.x + 3.1, 1.9, CROSSROADS_POS.z + 2.7),
        look: new THREE.Vector3(CROSSROADS_POS.x, 1.15, CROSSROADS_POS.z) },
};

// ---------- R27 Aufgabe A: Nachleben-Walker ----------
// Wegpunkte = ECHTE pathDefs-Knoten aus island/village.js (Hafenweg-Spur:
// Kreuzung -> Wegkurve -> Ufer vor dem Steg) — dieselbe Welt, kein erfundener Pfad.
// village.js bleibt unangetastet, die Koordinaten sind hier nur ABGELESEN.
const LANE_BEND_POS = new THREE.Vector3(13.83, 0, 38.07);          // Kurve des Hafenwegs
const LANE_SHORE_POS = new THREE.Vector3(PIER.x, 0, PIER.shoreZ + 1); // Ufer vor dem Steg
// Der Haendler wendet sich seinem Stand zu (village.js: stall(9.77, 24.78, rot 2.6) —
// die Theke zeigt Richtung +x/-z, das Schild klebt bei (10.9, 24.1) daneben).
const STALL_FRONT_POS = new THREE.Vector3(10.35, 0, 23.85);
// Despawn-Regel (Option a, messbar): entfernt wird ein Walker erst, wenn seine
// Koerper-Kugel (r=1 m um die Brust) 2 s UNUNTERBROCHEN ausserhalb des Kamera-
// Frustums lag UND er weiter als 16 m von der Kamera weg ist — nie im Bild, nie
// in Bildnaehe. Ueber 80 m raeumt eine harte Kappe sofort (nicht mehr erlaufbar
// sichtbar). Kein Blickwinkel-Raten: das Frustum IST die Sicht.
const AFTERLIFE_HIDDEN_T = 2.0;  // s ununterbrochen ausser Sicht
const AFTERLIFE_NEAR_D = 16;     // m: naeher als das wird NIE still entfernt
const AFTERLIFE_FAR_D = 80;      // m: harte Distanz-Kappe
const AFTERLIFE_BODY_R = 1.0;    // m Koerper-Kugel um die Brust fuer den Sicht-Test
const AFTERLIFE_TURN = 6;        // 1/s Eindreh-Tempo in die Laufrichtung
const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _bodySphere = new THREE.Sphere(new THREE.Vector3(), AFTERLIFE_BODY_R);

function addWalker(obj, pts, speed, face) {
  afterlifeWalkers.push({ obj, pts, i: 0, speed, bobPhase: obj.position.x, walkT: 0, face, outT: 0 });
}

// weiches Eindrehen (kuerzester Winkelweg) — die Akteure standen im Dialog
// einander zugewandt und sollen sich nicht per Hard-Snap umdrehen
function turnToward(obj, target, dt) {
  let d = target - obj.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  obj.rotation.y += d * Math.min(1, AFTERLIFE_TURN * dt);
}

// Uebergabe beim Szenenende: dieselben Objekte, kein Respawn — wer hinterherlaeuft,
// folgt exakt den Figuren aus der Szene.
function beginVignetteAfterlife() {
  if (activeVignette === 'v1') {
    const [marine, merchant] = vignetteActors;
    // Marine: die Gasse hoch Richtung Kreuzung (verkauft den Tracker-Schritt
    // "Another patrol, further up the lane" als dieselbe Welt), dann weiter zum Ufer.
    // Endpunkt seitlich versetzt: der Uferknoten selbst ist das Ziel des v2-Trios —
    // ohne Versatz stuenden Marine und Betrunkener im Browser-Test exakt uebereinander.
    const watch = new THREE.Vector3(LANE_SHORE_POS.x - 1.6, 0, LANE_SHORE_POS.z - 0.8);
    addWalker(marine, [CROSSROADS_POS, LANE_BEND_POS, watch], 1.25);
    // Haendler: zurueck an die Theke, dort dem Stand zugewandt stehen bleiben
    const face = Math.atan2(MARKET_POS.x - STALL_FRONT_POS.x, MARKET_POS.z - STALL_FRONT_POS.z);
    addWalker(merchant, [STALL_FRONT_POS], 0.9, face);
  } else {
    const [drunk, m1, m2] = vignetteActors;
    // Eskorten-Tempo: alle drei gleich langsam, der Betrunkene in der Mitte,
    // die Marines seitlich versetzt (eigene Zielpunkte, kein Stapel auf der Weglinie)
    const off = (p, dx, dz) => new THREE.Vector3(p.x + dx, 0, p.z + dz);
    addWalker(drunk, [LANE_BEND_POS, LANE_SHORE_POS], 0.95);
    addWalker(m1, [off(LANE_BEND_POS, -0.7, -0.3), off(LANE_SHORE_POS, -0.8, -0.6)], 0.95);
    addWalker(m2, [off(LANE_BEND_POS, 0.7, 0.3), off(LANE_SHORE_POS, 0.8, -0.2)], 0.95);
  }
  vignetteActors = []; // Eigentum liegt jetzt bei den Walkern (Objekte bleiben in actors)
}

// laeuft JEDEN Frame in JEDER Phase (auch idle und waehrend anderer Cutscenes) —
// sonst wuerden Nachleben-Figuren einfrieren, sobald die naechste Szene zuendet.
function updateAfterlife(rawDt) {
  if (!afterlifeWalkers.length) return;
  _projScreen.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreen);
  for (let idx = afterlifeWalkers.length - 1; idx >= 0; idx--) {
    const w = afterlifeWalkers[idx];
    const obj = w.obj;
    w.walkT += rawDt;
    if (w.i < w.pts.length) {
      const p = w.pts[w.i];
      const dx = p.x - obj.position.x, dz = p.z - obj.position.z;
      const d = Math.hypot(dx, dz);
      const step = w.speed * rawDt;
      if (d <= step) {
        obj.position.x = p.x; obj.position.z = p.z;
        w.i++;
        if (w.i >= w.pts.length) obj.position.y = 0;
      } else {
        obj.position.x += (dx / d) * step;
        obj.position.z += (dz / d) * step;
        turnToward(obj, Math.atan2(dx, dz), rawDt);
        obj.position.y = Math.abs(Math.sin((w.walkT + w.bobPhase) * 10)) * 0.05; // Lauf-Wippen (Pfiff-Muster)
      }
    } else if (w.face !== undefined) {
      turnToward(obj, w.face, rawDt); // angekommen: eindrehen (Haendler -> Theke), stehen
    }
    // stiller Despawn NUR ausser Sicht (Regel oben) — nie vor den Augen des Spielers
    const dCam = dist2D(obj.position, ctx.camera.position);
    _bodySphere.center.copy(obj.position);
    _bodySphere.center.y += 1.1;
    const inView = _frustum.intersectsSphere(_bodySphere);
    if (dCam > AFTERLIFE_FAR_D) { despawnActor(obj); afterlifeWalkers.splice(idx, 1); continue; }
    if (!inView && dCam > AFTERLIFE_NEAR_D) w.outT += rawDt; else w.outT = 0;
    if (w.outT >= AFTERLIFE_HIDDEN_T) { despawnActor(obj); afterlifeWalkers.splice(idx, 1); }
  }
}

function markActorScale(a) {
  a.userData.baseScale = a.scale.x;
  a.scale.setScalar(0.001);
  return a;
}

function beginVignette(id) {
  phase = 'vignette';
  t = 0;
  activeVignette = id;
  // R20 Aufgabe A: Dialog-Skript laden; die Einstellung haelt, bis jede Zeile
  // ihre Standzeit hatte (Summe inkl. Atempausen zwischen den Zeilen).
  vigScript = id === 'v1' ? V1_SCRIPT : V2_SCRIPT;
  vigLineIdx = -1;
  vigHold = vigScript.reduce((sum, l) => sum + lineHold(l.t) + VIG_LINE_GAP, 0);
  ctx.exitPointerLock?.();
  ctx.showLetterbox?.();
  _vigStartPos.copy(ctx.camera.position);
  _vigStartLook.copy(ctx.getHero().group.position).add(new THREE.Vector3(0, 1.4, 0));
  if (id === 'v1') {
    const marine = markActorScale(spawnActor(buildMarine('swabbie').group));
    marine.position.set(MARKET_POS.x - 0.9, 0, MARKET_POS.z + 0.3);
    marine.rotation.y = Math.PI * 0.3;
    const merchant = markActorScale(spawnActor(buildFigure({ skin: 0xc98a5c, shirt: 0x8a5a34, pants: 0x4a3a2a, hat: 'straw' })));
    merchant.position.set(MARKET_POS.x + 0.6, 0, MARKET_POS.z - 0.2);
    merchant.rotation.y = -Math.PI * 0.5;
    vignetteActors = [marine, merchant];
  } else {
    const drunk = markActorScale(spawnActor(buildFigure({ skin: 0xd39a6a, shirt: 0x5a4a6e, pants: 0x3a3a3a })));
    drunk.position.set(CROSSROADS_POS.x, 0, CROSSROADS_POS.z);
    drunk.rotation.y = 0.4;
    const m1 = markActorScale(spawnActor(buildMarine('swabbie').group));
    m1.position.set(CROSSROADS_POS.x - 0.9, 0, CROSSROADS_POS.z - 0.4);
    m1.rotation.y = 0.9;
    const m2 = markActorScale(spawnActor(buildMarine('swabbie').group));
    m2.position.set(CROSSROADS_POS.x + 0.7, 0, CROSSROADS_POS.z + 0.5);
    // R18 stand er mit dem Ruecken zur neuen Kamera (-0.6); jetzt in den
    // Kamera-Quadranten gedreht — Akteure muessen lesbar sein (Aufgabe B.1)
    m2.rotation.y = 0.5;
    vignetteActors = [drunk, m1, m2];
  }
}

function updateVignette(rawDt) {
  const hero = ctx.getHero();
  hero.update(rawDt, t, { speed: 0, grounded: true });
  ctx.kai?.update(rawDt, t, { speed: 0, grounded: true });
  const cam = VIG_CAM[activeVignette] || VIG_CAM.v1;

  if (t < VIG_IN) {
    const k = easeInOut(clamp01(t / VIG_IN));
    ctx.camera.position.lerpVectors(_vigStartPos, cam.pos, k);
    _camLook.lerpVectors(_vigStartLook, cam.look, k);
    ctx.camera.lookAt(_camLook);
    const sk = clamp01(t / (VIG_IN * 0.85)); // Einwachsen endet knapp vor dem Stand der Kamera
    for (const a of vignetteActors) a.scale.setScalar(Math.max(0.001, (a.userData.baseScale || 1) * sk));
  } else {
    // R20 Aufgabe A: Dialog-Playback — Zeile fuer Zeile ueber das Untertitel-System,
    // jede mit eigener Standzeit + Atempause (waehrend der Pause blendet die
    // vorige Zeile ueber subTimer bereits aus — liest sich als Sprecherwechsel).
    let acc = VIG_IN;
    let idx = -1;
    for (let i = 0; i < vigScript.length; i++) {
      if (t >= acc) idx = i;
      acc += lineHold(vigScript[i].t) + VIG_LINE_GAP;
    }
    if (idx > vigLineIdx && idx < vigScript.length) {
      vigLineIdx = idx;
      const l = vigScript[idx];
      showSubtitle(l.t, 0, l.s);
    }
    ctx.camera.position.copy(cam.pos);
    ctx.camera.lookAt(cam.look);
    const bob = Math.sin(t * 2.4) * 0.03;
    for (const a of vignetteActors) {
      a.scale.setScalar(a.userData.baseScale || 1);
      a.position.y = bob;
    }
  }
  if (t >= VIG_IN + vigHold) {
    // R27 Aufgabe A: KEIN Schrumpf-Abgang mehr — die Akteure gehen als Walker in ihr
    // Nachleben ueber (dieselben Objekte), waehrend die Kamera zurueckschnappt.
    beginVignetteAfterlife();
    ctx.hideLetterbox?.();
    phase = 'vignetteOut';
    t = 0;
  }
}

function updateVignetteOut(rawDt) {
  const hero = ctx.getHero();
  hero.update(rawDt, t, { speed: 0, grounded: true });
  ctx.kai?.update(rawDt, t, { speed: 0, grounded: true });
  ctx.snapCamera?.(rawDt);
  if (t >= VIG_OUT) {
    if (activeVignette === 'v1') v1Seen = true; else v2Seen = true;
    activeVignette = null;
    // R21 Aufgabe B.1: kam die Markt-Vignette VOR dem Ruf-Moment (Entdeckung schlaegt
    // Sicherheitsnetz), uebernimmt sie hier dessen Rolle: callSeen-Aequivalent setzen
    // (ab jetzt Quest-Eintrag + Minimap-Marker, wie nach updateCall) und dasselbe
    // Akt-I-Banner zeigen, das sonst updateCallOut() zeigt. beginCall() ist damit
    // fuer diesen Lauf unerreichbar — der Ruf-Moment entfaellt ersatzlos (Auftrag).
    if (!callSeen) {
      callSeen = true;
      ctx.showBanner?.('The Arrest', 'Act I — Marines walk the village');
    }
    ctx.requestPointerLock?.();
    phase = 'idle';
    t = 0;
  }
}

// =====================================================================================
// ---------- Akt 2: die Verhaftung (Platz) — kurzes Establish, dann echtes Handgemenge -
// =====================================================================================
// R19 Aufgabe D.1: der Establish-Beat ZEIGT die Verwechslung — ein Marine-Statist
// laeuft sichtbar auf Milo zu, waehrend der Untertitel sie benennt. Beats leicht
// gestreckt (Aufgabe C.3), damit beide Saetze ankommen, dann Snap in den Kampf.
const ARREST_NOTICE_T = 1.6;   // Charge-Sheet snappt ans Brett (Beat unveraendert)
const ARREST_TUMULT_T = 3.9;   // Untertitel-Wechsel + der Grab-Marine setzt sich in Bewegung (Beat unveraendert)
const ARREST_GRAB_END = 6.4;   // er erreicht Milo (Beat unveraendert)
// R22 Aufgabe B.4: Establish-Ende 7.2 -> 8.7 (+1.5 s, im erlaubten 1-2-s-Rahmen):
// die Menge braucht den Zusammenlauf am Anfang und das sichtbare Zurueckweichen
// nach dem Zugriff — alle inneren Beat-Zeiten stehen unveraendert.
const ARREST_ESTABLISH = 8.7;  // Ende Establish -> Snap -> Handgemenge
const ARREST_OUT = 0.35;       // Kamera-Snap zurueck auf die Verfolgerkamera

// R22 Aufgabe B.1: die Menge — Zusammenlauf/Halbkreis/Rueckweichen
const CROWD_IN_T = 2.6;      // s: Schaulustige laufen vom Platzrand zusammen
const CROWD_RECOIL_T = 0.7;  // s: Rueckweichen beim "Take the boy"-Zugriff
const CROWD_R = 4.3;         // Halbkreis-Abstand zum Verhaftungs-Zentrum
const CROWD_RECOIL_D = 1.3;  // m sichtbares Zurueckweichen
// Halbkreis OFFEN zur Establish-Kamera (die steht Richtung Brett, Winkel ~-0.3
// vom Verhaftungszentrum aus): kein Statist verdeckt Officer/Milo im Bild.
const CROWD_ANGLES = [0.8, 1.35, 1.9, 2.5, 3.1, -2.55, -1.95, -1.45];
// Palette im villagers-Stil — jede Figur liest sich anders (Auftrag: 6-10)
const CROWD_LOOKS = [
  { skin: 0xd39a6a, shirt: 0x7a8f5c, pants: 0x555f6e },
  { skin: 0xc98a5c, shirt: 0x8a5a34, pants: 0x4a3a2a, hat: 'straw' },
  { skin: 0xb9835a, shirt: 0x5a4a6e, pants: 0x3a3a3a },
  { skin: 0xd8a878, shirt: 0xa85a4a, pants: 0x4a4a52, scale: 0.94 },
  { skin: 0xc99167, shirt: 0x4a6a52, pants: 0x5a4a3a },
  { skin: 0xd39a6a, shirt: 0xb0985f, pants: 0x3a3d40, scale: 1.05 },
  { skin: 0xbf8a5f, shirt: 0x6a8ac9, pants: 0x3a3a3a, hat: 'straw', scale: 0.9 },
  { skin: 0xd0a070, shirt: 0x9a4a44, pants: 0x555f6e },
];

const _camPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();

// R22 Aufgabe B.2: umgestossener Marktstand/Kiste als Episoden-Prop — im Gedraenge
// ist etwas zu Bruch gegangen. Gekippte Kiste, verrutschtes Brett, verstreute
// Fruechte; reine Dekoration ohne Kollider, lebt in actors (sauber entsorgt).
function buildTippedStand() {
  const g = new THREE.Group();
  const wood = mat(0x6b4a2b, { roughness: 0.9 });
  const crate = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 0.7), wood));
  crate.position.set(0, 0.28, 0);
  crate.rotation.set(0.12, 0.4, 0.62); // gekippt, liegt auf der Kante
  g.add(crate);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.34), wood);
  plank.position.set(0.7, 0.06, 0.35);
  plank.rotation.set(0, 0.8, 0.1);
  g.add(plank);
  const fruitTints = [0xe8863c, 0xd8b13a, 0xc94f3d, 0x8fb04a];
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(fruitTints[i % fruitTints.length], { roughness: 0.7 }));
    const a = (i / 6) * Math.PI * 2 + 0.5;
    f.position.set(Math.cos(a) * (0.5 + (i % 3) * 0.25), 0.09, Math.sin(a) * (0.5 + ((i + 1) % 3) * 0.22));
    g.add(f);
  }
  return g;
}

// Verhaftungs-Zentrum (Officer/Milo stehen hier herum) — Bezugspunkt der Menge
const CROWD_CX = PLAZA_POS.x + 1.2;
const CROWD_CZ = PLAZA_POS.z - 1.6;

function spawnTumult() {
  crowdFigs = [];
  // R23 Aufgabe C.2: die Menge kommt nicht mehr aus dem Nichts. Zuerst borgt
  // sich die Episode bis zu 3 SICHTBARE Ambient-NPCs in Platznaehe (extras.js —
  // sie laufen aus ihrer Beschaeftigung herueber und werden beim Pfiff
  // zurueckgegeben); der Rest tritt aus den GASSEN-MUENDUNGEN auf die Wege,
  // nicht vom Platzrand-Ring. Beat-Zeiten von R22 stehen unveraendert.
  const borrowed = ctx.borrowAmbient ? ctx.borrowAmbient(CROWD_CX, CROWD_CZ, 32, 3) : [];
  const ALLEY_MOUTHS = [
    { x: 2.5, z: 13 },   // Hafenweg-Muendung
    { x: 8, z: 6.5 },    // Ostweg-Muendung
    { x: -6, z: 8.5 },   // Westweg-Muendung
    { x: 0.5, z: -12 },  // Turmweg (Sued)
    { x: 11, z: 9 },     // Ostweg, zweite Reihe
  ];
  for (let i = 0; i < CROWD_ANGLES.length; i++) {
    const a = CROWD_ANGLES[i];
    const dx = Math.sin(a), dz = Math.cos(a);
    const jitter = ((i * 7) % 3) * 0.35;
    const ring = new THREE.Vector3(CROWD_CX + dx * (CROWD_R + jitter), 0, CROWD_CZ + dz * (CROWD_R + jitter));
    let fig, spawn, isBorrowed = false;
    if (i < borrowed.length) {
      fig = borrowed[i].obj; // lebt in extras.js weiter — NIE despawnen (s. beginWhistleOut)
      spawn = fig.position.clone();
      spawn.y = 0;
      isBorrowed = true;
    } else {
      fig = spawnActor(buildFigure(CROWD_LOOKS[i]));
      const mouth = ALLEY_MOUTHS[(i - borrowed.length) % ALLEY_MOUTHS.length];
      spawn = new THREE.Vector3(
        mouth.x + ((i % 3) - 1) * 0.8, 0, mouth.z + (i % 2 ? 0.6 : -0.5));
      fig.position.copy(spawn);
    }
    crowdFigs.push({
      obj: fig, spawn, ring, borrowed: isBorrowed,
      scatter: new THREE.Vector3(dx, 0, dz), // zerstreut sich radial nach aussen
      phase: i * 1.37,
      face: Math.atan2(CROWD_CX - ring.x, CROWD_CZ - ring.z), // blickt auf die Verhaftung
    });
  }
  // 2 Absperr-Marines: riegeln die beiden Platz-Zugaenge (Hafenweg/Ostweg) ab und
  // druecken die Menge zurueck — Blick NACH AUSSEN, pendeln seitlich auf Posten.
  barrierMarines = [];
  // Posten stehen VOR den Wegmuendungen (0.6/8.8 statt naeher am Brunnen — der
  // Brunnenring-Kollider hat r 1.35 um (0,6), da soll niemand drinstehen).
  const posts = [
    { x: 0.6, z: 8.8, face: Math.atan2(5.28 - 0.6, 20.13 - 8.8) },  // Hafenweg-Muendung
    { x: 3.3, z: 5.2, face: Math.atan2(14.03 - 3.3, 6.15 - 5.2) },  // Ostweg-Muendung
  ];
  for (const p of posts) {
    const m = spawnActor(buildMarine('swabbie').group);
    m.position.set(p.x, 0, p.z);
    m.rotation.y = p.face;
    const lat = new THREE.Vector3(Math.cos(p.face), 0, -Math.sin(p.face)); // quer zur Blickrichtung
    barrierMarines.push({ obj: m, base: new THREE.Vector3(p.x, 0, p.z), lat, face: p.face });
  }
  // der umgestossene Stand liegt am Platzrand zwischen Menge und Brett
  tippedStand = spawnActor(buildTippedStand());
  tippedStand.position.set(2.9, 0, -3.6);
  tippedStand.rotation.y = 0.7;
}

// laeuft waehrend arrestIntro UND brawl (die Menge bleibt und tuschelt, bis der
// Pfiff sie zerstreut). tNow = Phasenzeit der jeweiligen Phase; im Handgemenge
// steht die Menge laengst im (zurueckgewichenen) Ring.
function updateTumult(tNow, inBrawl) {
  const recoilK = inBrawl ? 1 : easeInOut(clamp01((tNow - ARREST_TUMULT_T) / CROWD_RECOIL_T));
  const inK = inBrawl ? 1 : easeInOut(clamp01(tNow / CROWD_IN_T));
  // "aufflatternde Bewegung beim Griff nach Milo": kurz nach dem Zugriff wippt
  // die Menge deutlich staerker, dann beruhigt sie sich wieder
  const flutter = inBrawl ? 0 : clamp01((tNow - ARREST_TUMULT_T) / 0.15) * clamp01(1 - (tNow - ARREST_TUMULT_T - 0.15) / 1.4);
  for (const c of crowdFigs) {
    _crowdPos.lerpVectors(c.spawn, c.ring, inK);
    _crowdPos.addScaledVector(c.scatter, CROWD_RECOIL_D * recoilK); // weicht sichtbar zurueck
    const bobAmp = 0.03 + flutter * 0.06;
    c.obj.position.set(
      _crowdPos.x,
      Math.abs(Math.sin((tNow + c.phase) * (inK < 1 ? 9 : 2.2))) * (inK < 1 ? 0.05 : bobAmp),
      _crowdPos.z,
    );
    // tuscheln/gestikulieren: leichtes Hin- und Herwenden zum Nachbarn und zurueck
    c.obj.rotation.y = c.face + Math.sin((tNow * 1.1) + c.phase * 2) * 0.22;
    c.obj.rotation.z = Math.sin((tNow * 1.7) + c.phase) * 0.035;
  }
  for (let i = 0; i < barrierMarines.length; i++) {
    const b = barrierMarines[i];
    const sway = Math.sin(tNow * 0.8 + i * 2.4) * 0.6; // Posten-Pendeln quer zur Gasse
    b.obj.position.set(b.base.x + b.lat.x * sway, Math.abs(Math.sin(tNow * 6 + i)) * 0.02, b.base.z + b.lat.z * sway);
    b.obj.rotation.y = b.face + Math.sin(tNow * 0.9 + i) * 0.25;
  }
}
const _crowdPos = new THREE.Vector3();

function beginArrestIntro() {
  phase = 'arrestIntro';
  t = 0;
  ctx.exitPointerLock?.();
  ctx.showLetterbox?.(); // R19: gleiche Buehne wie Ruf-Moment/Vignetten
  setFade(1);
  spawnTumult();        // R22: Menge + Absperrung + Prop, alles hinter dem Fade
  sfx.murmurStart();    // R22 B.3: Gemurmel-Bett — reisst erst beim Pfiff ab

  officer = spawnActor(buildMarine('petty').group);
  officer.position.set(PLAZA_POS.x + 1.6, 0, PLAZA_POS.z - 1.8);
  officer.rotation.y = Math.PI * 0.8;

  thief = spawnActor(buildFigure({ skin: 0xc98a5c, shirt: 0x6a5a3a, pants: 0x3a3a3a, scale: 0.88 }));
  thief.position.set(PLAZA_POS.x + 0.9, 0, PLAZA_POS.z - 1.4);
  thief.rotation.y = Math.PI * 0.7;

  board = spawnActor(buildBoard());
  board.position.copy(BOARD_POS);
  board.rotation.y = -0.6;

  // der Verwechslungs-Statist: startet am Platzrand gegenueber von Milo und
  // marschiert ab ARREST_TUMULT_T sichtbar auf ihn zu (alles hinter dem Fade gespawnt)
  const hp = ctx.getHero().group.position;
  grabMarine = spawnActor(buildMarine('swabbie').group);
  _grabFrom.set(PLAZA_POS.x - Math.sign(hp.x || 1) * 3.0, 0, PLAZA_POS.z - 2.4);
  grabMarine.position.copy(_grabFrom);
  _dir.set(hp.x - _grabFrom.x, 0, hp.z - _grabFrom.z);
  const d = Math.max(0.001, Math.hypot(_dir.x, _dir.z));
  _grabTo.set(hp.x - (_dir.x / d) * 0.75, 0, hp.z - (_dir.z / d) * 0.75); // stoppt eine Armlaenge vor Milo
  grabMarine.rotation.y = Math.atan2(hp.x - _grabFrom.x, hp.z - _grabFrom.z);

  ctx.showBanner?.('Trouble at the plaza', 'The patrol has made an arrest');
  showSubtitle(ARREST_LINE_1, 0.4, 'Officer'); // R20 Aufgabe A.4: die Anklage wird GESPROCHEN
}

function updateArrestIntro(rawDt) {
  const hero = ctx.getHero();
  hero.update(rawDt, t, { speed: 0, grounded: true });
  ctx.kai?.update(rawDt, t, { speed: 0, grounded: true });

  const FADE_IN = 0.5;
  if (t < FADE_IN) setFade(1 - t / FADE_IN); else setFade(0);

  if (t >= ARREST_NOTICE_T) {
    const k = clamp01((t - ARREST_NOTICE_T) / 0.35);
    board.userData.notice.scale.setScalar(Math.max(0.001, k));
  }
  if (t >= ARREST_TUMULT_T && t < ARREST_TUMULT_T + rawDt + 0.001) {
    showSubtitle(ARREST_LINE_2, 0.6); // "In the crush, a Marine grabs Milo instead." — steht deutlich
  }

  updateTumult(t, false); // R22: Menge laeuft zusammen, tuschelt, weicht beim Zugriff

  const hp = hero.group.position;
  // der Grab-Marine laeuft sichtbar auf Milo zu (Aufgabe D.1: zeigen, nicht behaupten)
  if (grabMarine && t >= ARREST_TUMULT_T) {
    const k = easeInOut(clamp01((t - ARREST_TUMULT_T) / (ARREST_GRAB_END - ARREST_TUMULT_T)));
    grabMarine.position.lerpVectors(_grabFrom, _grabTo, k);
    grabMarine.position.y = Math.abs(Math.sin(t * 9)) * 0.04 * (k < 1 ? 1 : 0); // Schritt-Wippen
    grabMarine.rotation.y = Math.atan2(hp.x - grabMarine.position.x, hp.z - grabMarine.position.z);
  }

  // Kamera: erst der Platz (Verhaftung + Brett), nach dem Untertitel-Wechsel
  // Schwenk auf Milo — der Zugriff passiert IM Bild
  _camPos.set(BOARD_POS.x - 5.5, 3.4, BOARD_POS.z + 4);
  _lookB.set(PLAZA_POS.x, 1.2, PLAZA_POS.z - 1);
  const pank = easeInOut(clamp01((t - ARREST_TUMULT_T) / 1.1));
  _camLook.set(hp.x, 1.3, hp.z);
  _camLook.lerpVectors(_lookB, _camLook, pank);
  ctx.camera.position.copy(_camPos);
  ctx.camera.lookAt(_camLook);

  if (t >= ARREST_ESTABLISH) beginArrestOut();
}

// Uebergang Establish -> Handgemenge OHNE harten Schnitt (Aufgabe B.2): Letterbox
// oeffnet, Kamera snappt zurueck; der Grab-Statist wird 1:1 durch den ersten echten
// Kampf-Marine an derselben Position ersetzt (kein Pop), der zweite waechst kurz ein.
function beginArrestOut() {
  phase = 'arrestOut';
  t = 0;
  ctx.hideLetterbox?.();
  const p = ctx.getHero().group.position;
  const gx = grabMarine ? grabMarine.position.x : p.x + 2.2;
  const gz = grabMarine ? grabMarine.position.z : p.z + 0.6;
  if (grabMarine) { despawnActor(grabMarine); grabMarine = null; }
  const m1 = ctx.enemyManager.spawnMarine(gx, gz, 'swabbie');
  const m2 = ctx.enemyManager.spawnMarine(p.x - 2.0, p.z + 1.4, 'swabbie');
  // Handgemenge ist NICHT toedlich (Auftrag, hart): die beiden Marines duerfen im
  // Verlauf des Kampfs nicht durch echten Schaden fallen — die Szene endet ueber
  // Trefferzahl/Zeit, nicht ueber ihren HP-Balken.
  m1.hp = m1.maxHp = BRAWL_MARINE_HP;
  m2.hp = m2.maxHp = BRAWL_MARINE_HP;
  m2.group.scale.setScalar(0.001);
  brawlMarines = [m1, m2];
}

function updateArrestOut(rawDt) {
  ctx.snapCamera?.(rawDt);
  const k = clamp01(t / ARREST_OUT);
  if (brawlMarines[1]) brawlMarines[1].group.scale.setScalar(Math.max(0.001, k));
  if (t >= ARREST_OUT) {
    if (brawlMarines[1]) brawlMarines[1].group.scale.setScalar(1);
    beginBrawl();
  }
}

function beginBrawl() {
  phase = 'brawl';
  t = 0;
  brawlHits = 0;
  setFade(0);
  ctx.requestPointerLock?.();
  showSubtitle(BRAWL_LINE, 0.4);
  // R19 Aufgabe D.2: EINE klare Anzeige — Ziel + Trefferfortschritt (kein Countdown daneben)
  setObjective(`${BRAWL_GOAL} — 0 / ${BRAWL_HIT_TARGET}`);
}

// main.js laesst hier Physik/Kamera/Kampf/Companion normal weiterlaufen
// (isEpisodeCutscene() ist waehrend 'brawl' false) — updateEpisode() prueft nur ab.
function updateBrawl() {
  // R22: die Menge bleibt am (zurueckgewichenen) Ring stehen und tuschelt weiter,
  // das Gemurmel-Bett laeuft — erst der Pfiff zerstreut beides.
  updateTumult(t, true);
  if (t >= BRAWL_TIME_LIMIT || brawlHits >= BRAWL_HIT_TARGET) beginWhistle();
}

// =====================================================================================
// ---------- R19 Aufgabe D.3: der Pfiff — Kamera-Cut auf den Officer, dann Abgang -----
// =====================================================================================
// Kein sofortiger Despawn mehr: Cut auf den Officer (Letterbox + Pfiff-SFX +
// Untertitel "Fall back!"), dann laufen beide Marines UND Officer + Junge sichtbar
// vom Platz (Ablauf-Lerp), erst danach werden sie entfernt — weit weg vom Bildfokus.
const WHISTLE_HOLD = 1.0;     // Standbild-Beat auf dem Officer
const WHISTLE_RETREAT = 1.7;  // Ablauf-Lerp
const WHISTLE_OUT = 0.4;      // Kamera-Snap zurueck
const WHISTLE_RETREAT_DIST = 11;

function beginWhistle() {
  phase = 'whistle';
  t = 0;
  setObjective(null);
  ctx.exitPointerLock?.();
  ctx.showLetterbox?.();
  ctx.playWhistle?.();
  showSubtitle(WHISTLE_LINE, 0.8, 'Officer'); // R20: der Pfiff-Befehl ist seine Zeile
  // Rueckzugsrichtung: vom Platzzentrum weg, am Officer vorbei nach aussen
  const op = officer ? officer.position : PLAZA_POS;
  _retreatDir.set(op.x - PLAZA_POS.x, 0, op.z - PLAZA_POS.z);
  if (_retreatDir.lengthSq() < 0.01) _retreatDir.set(0.6, 0, -0.8);
  _retreatDir.normalize();
  retreatFigs = [];
  for (const m of brawlMarines) retreatFigs.push({ obj: m.group, from: m.group.position.clone() });
  if (officer) retreatFigs.push({ obj: officer, from: officer.position.clone() });
  if (thief) retreatFigs.push({ obj: thief, from: thief.position.clone() });
  // R22: die Absperr-Marines ziehen mit dem Officer ab; das Gemurmel reisst ab,
  // und die Menge merkt sich ihren Stand fuer die Zerstreuung in updateWhistle.
  for (const b of barrierMarines) retreatFigs.push({ obj: b.obj, from: b.obj.position.clone() });
  sfx.murmurStop();
  for (const c of crowdFigs) c.spawn.copy(c.obj.position); // spawn = Startpunkt der Flucht
}

function updateWhistle(rawDt) {
  const hero = ctx.getHero();
  hero.update(rawDt, t, { speed: 0, grounded: true });
  ctx.kai?.update(rawDt, t, { speed: 0, grounded: true });

  // Cut auf den Officer: er blickt in Richtung -z/+x (rotation.y = PI*0.8) — die
  // Kamera steht in diesem Quadranten, der Pfiff kommt frontal-seitlich
  const op = officer ? officer.position : PLAZA_POS;
  _camPos.set(op.x + 1.9, 1.75, op.z - 2.6);
  _camLook.set(op.x, 1.5, op.z);
  ctx.camera.position.copy(_camPos);
  ctx.camera.lookAt(_camLook);

  if (t >= WHISTLE_HOLD) {
    const k = easeInOut(clamp01((t - WHISTLE_HOLD) / WHISTLE_RETREAT));
    for (const f of retreatFigs) {
      f.obj.position.set(
        f.from.x + _retreatDir.x * WHISTLE_RETREAT_DIST * k,
        f.from.y,
        f.from.z + _retreatDir.z * WHISTLE_RETREAT_DIST * k,
      );
      f.obj.rotation.y = Math.atan2(_retreatDir.x, _retreatDir.z);
      f.obj.position.y = Math.abs(Math.sin((t + f.from.x) * 10)) * 0.05; // Lauf-Wippen
    }
    // R22: die Menge zerstreut sich RADIAL (jeder in seine Richtung), nicht im
    // Marine-Gleichschritt — liest sich als aufgeloester Auflauf.
    for (const c of crowdFigs) {
      const ck = easeInOut(clamp01((t - WHISTLE_HOLD) / (WHISTLE_RETREAT * 1.1)));
      c.obj.position.set(
        c.spawn.x + c.scatter.x * 9 * ck,
        Math.abs(Math.sin((t + c.phase) * 10)) * 0.05,
        c.spawn.z + c.scatter.z * 9 * ck,
      );
      c.obj.rotation.y = Math.atan2(c.scatter.x, c.scatter.z);
      c.obj.rotation.z = 0;
    }
  }

  if (t >= WHISTLE_HOLD + WHISTLE_RETREAT) beginWhistleOut();
}

function beginWhistleOut() {
  // Marines erst NACH dem Ablauf-Lerp entfernen (Auftrag D.3) — sie sind jetzt ~11 m
  // vom Kampfort entfernt und ausserhalb des Bildfokus
  for (const m of brawlMarines) {
    if (m.aimLine) ctx.scene.remove(m.aimLine);
    ctx.scene.remove(m.group);
    const idx = ctx.enemyManager.enemies.indexOf(m);
    if (idx >= 0) ctx.enemyManager.enemies.splice(idx, 1);
  }
  brawlMarines = [];
  // Officer fuehrt den Jungen ab — beide verlassen die Szene endgueltig
  if (officer) { despawnActor(officer); officer = null; }
  if (thief) { despawnActor(thief); thief = null; }
  // R22: Menge, Absperrung und der umgestossene Stand raeumen mit ab — sie sind
  // jetzt ~9-11 m vom Bildfokus entfernt (R20-Muster: erst ablaufen, dann weg).
  // R23: GEBORGTE Ambient-NPCs werden NICHT despawnt, sondern an extras.js
  // zurueckgegeben — sie laufen von ihrer Zerstreuungs-Position sichtbar in
  // ihre Loops zurueck (release() blendet weich, kein Teleport-Pop).
  for (const c of crowdFigs) { if (!c.borrowed) despawnActor(c.obj); }
  ctx.releaseAmbient?.();
  crowdFigs = [];
  for (const b of barrierMarines) despawnActor(b.obj);
  barrierMarines = [];
  if (tippedStand) { despawnActor(tippedStand); tippedStand = null; }
  retreatFigs = [];
  arrestDone = true;
  spawnStranger();
  ctx.hideLetterbox?.();
  phase = 'whistleOut';
  t = 0;
}

function updateWhistleOut(rawDt) {
  const hero = ctx.getHero();
  hero.update(rawDt, t, { speed: 0, grounded: true });
  ctx.kai?.update(rawDt, t, { speed: 0, grounded: true });
  ctx.snapCamera?.(rawDt);
  if (t >= WHISTLE_OUT) {
    ctx.requestPointerLock?.();
    // R20 Aufgabe C.2: Akt-Wechsel nach dem Pfiff — Kontext, was sich veraendert hat
    // (der Platz ist leer, der Junge ist weg); KEINE Anweisung, die steht im Tracker.
    ctx.showBanner?.('The Square Falls Quiet', 'Act II — The patrol marches the boy away');
    phase = 'idle';
    t = 0;
  }
}

function spawnStranger() {
  if (stranger || isDreamSetInternal()) return;
  stranger = spawnActor(buildFigure({ skin: 0xb98f6a, shirt: 0x555a5e, pants: 0x3a3d40, hair: 0xaaaaaa, coat: 0x4a5158 }));
  stranger.position.copy(WELL_TALK_POS);
  stranger.rotation.y = Math.atan2(WELL_POS.x - WELL_TALK_POS.x, WELL_POS.z - WELL_TALK_POS.z);
}

// =====================================================================================
// ---------- Akt 3: der Fremde am Brunnen — Frage + 4 Antworten (Abend) ----------------
// =====================================================================================
function beginDialogWell() {
  phase = 'dialogWell';
  t = 0;
  chosen = null;
  ctx.exitPointerLock?.();
  setFade(1); // R19 Aufgabe B.2: kurze Blende statt hartem Schnitt in die Dialog-Kamera

  const hero = ctx.getHero();
  hero.group.position.set(WELL_TALK_POS.x + 1.1, 0, WELL_TALK_POS.z - 0.5);
  hero.group.rotation.y = Math.atan2(WELL_TALK_POS.x - hero.group.position.x, WELL_TALK_POS.z - hero.group.position.z);
  // der Fremde wendet sich Milo zu — vorher blickte er zum Brunnen
  if (stranger) {
    stranger.rotation.y = Math.atan2(
      hero.group.position.x - stranger.position.x,
      hero.group.position.z - stranger.position.z,
    );
  }

  showDialogLine('Stranger', STRANGER_QUESTION, ANSWERS);
}

// R19 Aufgabe E: Over-the-Shoulder-Framing (Felix' Vorschlag). Kamera seitlich
// hinter Milos Schulter, leicht erhoeht: der Fremde FRONTAL im Bild, Milo
// angeschnitten am Bildrand. Blickpunkt liegt ueber der Dialog-Box (bottom 8%),
// damit die Antwort-Buttons das Gesicht des Fremden nicht verdecken.
function updateDialogWell(rawDt) {
  const hero = ctx.getHero();
  hero.update(rawDt, t, { speed: 0, grounded: true });
  ctx.kai?.update(rawDt, t, { speed: 0, grounded: true });

  const FADE_IN = 0.3;
  if (t < FADE_IN) setFade(1 - t / FADE_IN); else setFade(0);

  const hp = hero.group.position;
  _dir.set(WELL_TALK_POS.x - hp.x, 0, WELL_TALK_POS.z - hp.z).normalize();
  _camPos.copy(hp).addScaledVector(_dir, -1.15); // hinter Milo
  _camPos.x += _dir.z * 0.55;                    // seitlicher Versatz ueber die Schulter
  _camPos.z += -_dir.x * 0.55;
  _camPos.y = 1.78;
  _camLook.set(WELL_TALK_POS.x, 1.38, WELL_TALK_POS.z); // Kopfhoehe des Fremden
  ctx.camera.position.copy(_camPos);
  ctx.camera.lookAt(_camLook);
}

function showDialogLine(speaker, text, answers) {
  speakerEl.textContent = speaker;
  lineEl.textContent = text;
  optionsEl.innerHTML = '';
  optionButtons = answers.map((a, i) => {
    const btn = document.createElement('button');
    btn.className = 'ep-option';
    btn.dataset.id = a.id;
    btn.innerHTML = `<span class="ep-key">${i + 1}</span><span class="ep-text">${a.text}</span>`;
    optionsEl.appendChild(btn);
    return btn;
  });
  padSel = -1; // frischer Dialog: noch keine Pad-Auswahl markiert
  dialogEl.classList.add('show');
}

// ---------- R21 Aufgabe A: D-Pad-Navigation im Brunnen-Dialog ----------
// main.js ruft dies auf Gamepad-KANTEN auf (die Gamepad-API kennt keine Events).
// Rueckgabe true = Eingabe verbraucht; ausserhalb von dialogWell immer false, damit
// A/D-Pad im freien Spiel ihre normale Bedeutung behalten. Der ERSTE Druck (D-Pad
// oder A) markiert nur die Auswahl — A bestaetigt erst eine sichtbare Markierung,
// ein Mash-A beim Dialog-Aufgehen kann also nie blind Antwort 1 waehlen.
let padSel = -1;

function updatePadSelection() {
  for (let i = 0; i < optionButtons.length; i++) {
    optionButtons[i].classList.toggle('selected', i === padSel);
  }
}

export function padDialogInput(action) {
  if (phase !== 'dialogWell' || !optionButtons.length) return false;
  const n = optionButtons.length;
  if (action === 'up' || action === 'down') {
    if (padSel < 0) padSel = action === 'down' ? 0 : n - 1;
    else padSel = (padSel + (action === 'down' ? 1 : n - 1)) % n;
    updatePadSelection();
  } else if (action === 'confirm') {
    if (padSel < 0) { padSel = 0; updatePadSelection(); }
    else pickAnswer(optionButtons[padSel].dataset.id);
  }
  return true;
}

function hideDialog() {
  dialogEl.classList.remove('show');
  optionsEl.innerHTML = '';
  optionButtons = [];
}

function onOptionsClick(e) {
  const btn = e.target.closest('.ep-option');
  if (!btn || phase !== 'dialogWell') return;
  pickAnswer(btn.dataset.id);
}

function onAnswerKeydown(e) {
  if (phase !== 'dialogWell') return;
  const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
  if (n === undefined || !optionButtons[n]) return;
  pickAnswer(optionButtons[n].dataset.id);
}

function pickAnswer(id) {
  chosen = id;
  hideDialog();
  phase = 'fadeToAct';
  t = 0;
}

// =====================================================================================
// ---------- Akt 4: fade -> Tat-Sequenz (neu, v4) -> fade -> Nachhall-Karte -----------
// =====================================================================================
const ACT_FADE = 0.5;

function updateFadeToAct(rawDt) {
  setFade(clamp01(t / ACT_FADE));
  if (t >= ACT_FADE) { phase = 'act'; t = 0; setFade(1); beginAct(); }
}

// R20 Aufgabe B: die Route liegt jetzt IM WASSER neben dem Steg (linke Seite —
// rechts liegt das vertaeute Arena-Boot samt Festmacherleine), nicht mehr auf den
// Planken: der R18-Platzhalter "laeuft uebers Meer" ist ersetzt, Milo sitzt im Boot.
const BOAT_Y = -0.42; // Bordkante ~0.28 ueber der Wasserlinie (-0.7), wie das Hafen-Boot
const ROW_START = new THREE.Vector3(PIER.x - 4.3, BOAT_Y, PIER.endZ - 3);
const ROW_OUT = new THREE.Vector3(PIER.x - 4.3, BOAT_Y, PIER.endZ + 9); // "hinter die Hafenlichter"
const _boatPos = new THREE.Vector3();

function beginAct() {
  const hero = ctx.getHero();
  setFade(1);
  if (chosen === 'freedom') {
    // R20 Aufgabe B: Milo sitzt IM Boot, das Boot faehrt (kein Schritt aufs Wasser).
    epBoat = spawnActor(buildRowboat());
    epBoat.position.copy(ROW_START);
    harborBoat = findHarborBoat();
    if (harborBoat) harborBoat.visible = false; // keine zwei Boote im Bild (Auftrag B.1)
    hero.group.position.set(ROW_START.x, BOAT_Y - 0.3, ROW_START.z);
    hero.group.rotation.y = 0;
  } else if (chosen === 'fame' || chosen === 'revenge') {
    hero.group.position.set(BOARD_POS.x - 1.2, 0, BOARD_POS.z - 0.6);
    hero.group.rotation.y = -0.6;
  } else {
    hero.group.position.copy(TOWER_BASE_POS);
    hero.group.rotation.y = Math.PI;
  }
  if (chosen === 'revenge' && !ctx.scene.getObjectByName('ep-flame')) {
    const flame = buildFlame();
    flame.name = 'ep-flame';
    flame.position.copy(LANTERN_POS).setY(1.05);
    spawnActor(flame);
  }
}

const ACT_DURATION = { freedom: 10, fame: 8, throne: 9, revenge: 9 };

function updateAct(rawDt) {
  const hero = ctx.getHero();
  const dur = ACT_DURATION[chosen] || 9;
  const k = clamp01(t / dur);
  if (t < dur - 0.3) setFade(0);
  // R20 Aufgabe B: in der Freedom-Tat sitzt Milo im Boot — kein Geh-Zyklus
  // (speed 0), das Boot traegt die Bewegung; die anderen Taten gehen weiter.
  const walking = chosen !== 'freedom' && k < 0.9;
  hero.update(rawDt, t, { speed: walking ? 0.4 : 0, grounded: true });
  ctx.kai?.update(rawDt, t, { speed: 0, grounded: true });

  if (chosen === 'freedom') actFreedom(hero, t);
  else if (chosen === 'fame') actFame(hero, t);
  else if (chosen === 'throne') actThrone(hero, t);
  else actRevenge(hero, t);

  if (t >= dur) {
    grantToken(hero);
    phase = 'fadeToCard';
    t = 0;
  }
}

// FREEDOM (R20 Aufgabe B): das BOOT lerpt hinter die Hafenlichter und zurueck,
// Milo faehrt mit (steht im Rumpf, kein Schritt aufs Wasser); sanftes Wellen-Bob
// im Takt des Hafen-Boots. Schluss-Bild ("Wind faengt den Hut") + Kamera wie R18:
// die Kamera folgt weiter Milos Position, die Blenden setzt updateAct/updateFadeToCard.
function actFreedom(hero, at) {
  const OUT_T = 6;
  if (at < OUT_T) {
    const lk = easeInOut(clamp01(at / OUT_T));
    _boatPos.lerpVectors(ROW_START, ROW_OUT, lk);
  } else {
    const lk = easeInOut(clamp01((at - OUT_T) / (ACT_DURATION.freedom - OUT_T)));
    _boatPos.lerpVectors(ROW_OUT, ROW_START, lk);
  }
  const bob = Math.sin(at * 0.9) * 0.05;
  if (epBoat) {
    epBoat.position.set(_boatPos.x, BOAT_Y + bob, _boatPos.z);
    epBoat.rotation.z = Math.sin(at * 0.7) * 0.04;
    epBoat.rotation.x = Math.sin(at * 0.55 + 1.3) * 0.025;
  }
  // Milo steht im Rumpf (Bodenbretter ~0.34 unter der Bordkante) und dreht sich
  // am Wendepunkt WEICH um (0,6 s), statt hart zu snappen wie der R18-Platzhalter.
  hero.group.position.set(_boatPos.x, BOAT_Y - 0.3 + bob, _boatPos.z);
  hero.group.rotation.y = Math.PI * easeInOut(clamp01((at - OUT_T + 0.3) / 0.6));
  _camPos.set(hero.group.position.x - 4.5, 3.0, hero.group.position.z - 1.5);
  _camLook.copy(hero.group.position).add(new THREE.Vector3(0, 1.2, 0));
  ctx.camera.position.copy(_camPos);
  ctx.camera.lookAt(_camLook);
}

// FAME: Milo nagelt bei Laternenlicht sein eigenes Blatt DANEBEN ans Brett.
function actFame(hero, at) {
  const HOLD = 3.5;
  hero.group.position.set(BOARD_POS.x - 1.2, 0, BOARD_POS.z - 0.6);
  hero.group.rotation.y = -0.6;
  if (at >= HOLD) {
    const pk = clamp01((at - HOLD) / 1.2);
    board.userData.poster.scale.setScalar(Math.max(0.001, pk));
  }
  const zk = clamp01((at - HOLD - 1.2) / 2.4);
  _camPos.lerpVectors(
    new THREE.Vector3(BOARD_POS.x - 2.2, 2.2, BOARD_POS.z + 2.2),
    new THREE.Vector3(BOARD_POS.x - 0.4, 1.65, BOARD_POS.z + 0.5),
    zk,
  );
  _camLook.set(BOARD_POS.x, 1.55, BOARD_POS.z);
  ctx.camera.position.copy(_camPos);
  ctx.camera.lookAt(_camLook);
}

// THE THRONE: Milo steigt nachts auf den Wachturm (abstrahiert: geht zum Fuss, hebt
// dann auf die Plattform) und sitzt dort mit der Laterne, Blick uebers Dorf.
function actThrone(hero, at) {
  const CLIMB_T = 4;
  if (at < CLIMB_T) {
    const lk = easeInOut(clamp01(at / CLIMB_T));
    hero.group.position.lerpVectors(TOWER_BASE_POS, new THREE.Vector3(TOWER_BASE_POS.x, TOWER_TOP_POS.y, TOWER_BASE_POS.z), lk);
  } else {
    hero.group.position.copy(TOWER_TOP_POS);
    hero.group.rotation.y = 0;
  }
  _camPos.set(TOWER_TOP_POS.x + 3.4, TOWER_TOP_POS.y + 1.6, TOWER_TOP_POS.z + 3.4);
  _camLook.set(TOWER_TOP_POS.x, TOWER_TOP_POS.y + 0.6, TOWER_TOP_POS.z);
  ctx.camera.position.copy(_camPos);
  ctx.camera.lookAt(_camLook);
}

// REVENGE: Milo zieht den Charge-Sheet vom Brett und verbrennt ihn an der Laterne.
function actRevenge(hero, at) {
  const PULL_T = 2.5;
  const WALK_T = 6;
  if (at < PULL_T) {
    hero.group.position.set(BOARD_POS.x - 1.2, 0, BOARD_POS.z - 0.6);
    hero.group.rotation.y = -0.6;
    const pk = clamp01(at / PULL_T);
    if (board) board.userData.notice.scale.setScalar(Math.max(0.001, 1 - pk));
  } else if (at < WALK_T) {
    const lk = easeInOut(clamp01((at - PULL_T) / (WALK_T - PULL_T)));
    const from = new THREE.Vector3(BOARD_POS.x - 1.2, 0, BOARD_POS.z - 0.6);
    hero.group.position.lerpVectors(from, LANTERN_POS, lk);
    hero.group.rotation.y = Math.atan2(LANTERN_POS.x - from.x, LANTERN_POS.z - from.z);
  } else {
    hero.group.position.copy(LANTERN_POS);
    const flameObj = ctx.scene.getObjectByName('ep-flame');
    if (flameObj) {
      const fk = clamp01((at - WALK_T) / (ACT_DURATION.revenge - WALK_T));
      flameObj.userData.flame.scale.setScalar(Math.max(0.001, fk));
      flameObj.userData.flame.material.emissiveIntensity = 1.2 + Math.sin(at * 24) * 0.4;
    }
  }
  _camPos.set(hero.group.position.x + 2.6, 1.9, hero.group.position.z + 2.2);
  _camLook.copy(hero.group.position).add(new THREE.Vector3(0, 1.1, 0));
  ctx.camera.position.copy(_camPos);
  ctx.camera.lookAt(_camLook);
}

// ---------- Erkennungsstueck: Platzhalter-Primitive am Hut/Handgelenk ----------
function grantToken(hero) {
  const color = TOKEN_COLOR[chosen] || 0xffffff;
  const token = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.06),
    mat(color, { roughness: 0.5, metalness: 0.15 }),
  );
  token.position.set(0.16, 1.72, 0.12); // grob "am Hutrand" — Felix entscheidet Design/Platz spaeter
  hero.group.add(token);
}

const CARD_FADE = 0.6;
const CARD_HOLD = 3.2;

function updateFadeToCard(rawDt) {
  setFade(clamp01(t / CARD_FADE));
  if (t >= CARD_FADE) {
    phase = 'card';
    t = 0;
    setFade(1);
    cardTextEl.textContent = ECHOES[chosen] || '';
    cardEl.classList.add('show');
  }
}

function updateCard(rawDt) {
  if (t >= CARD_HOLD) {
    cardEl.classList.remove('show');
    phase = 'fadeOut';
    t = 0;
  }
}

function updateFadeOut(rawDt) {
  if (t === rawDt) finishEpisode(); // einmalig beim Betreten der Phase
  const FADE_OUT = 0.6;
  setFade(1 - clamp01(t / FADE_OUT));
  if (t >= FADE_OUT) { phase = 'idle'; t = 0; setFade(0); }
}

function finishEpisode() {
  despawnAllActors();
  hideSubtitle();
  setObjective(null);
  const hero = ctx.getHero();
  hero.group.position.set(WELL_TALK_POS.x, 0, WELL_TALK_POS.z + 1.5);
  hero.group.rotation.y = 0;
  ctx.player.pos.copy(hero.group.position);
  localStorage.setItem(DREAM_KEY, chosen);
  ctx.requestPointerLock?.();
}
