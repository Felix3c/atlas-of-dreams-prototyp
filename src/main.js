// main.js — renderer, game loop, input, player physics, third-person camera, state machine
import * as THREE from 'three';
// ZUERST: perf.js ersetzt im Mess-/Schussmodus Math.random durch einen gesetzten
// Generator. Das muss geschehen, bevor irgendein Weltmodul seinen Rumpf ausfuehrt.
import { createPerf, PERF_ACTIVE, WANT_AA, DPR_CAP } from './perf.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createArena, clampToWalkable, groundHeightAt, ARENA_RADIUS, WALK_RADIUS } from './arena.js';
import { buildFlair } from './island/flair.js';
import { buildDiscover } from './island/discover.js';
import { buildExtras } from './island/extras.js';
import { createPatrol } from './island/patrol.js';
import { createHero } from './hero.js';
import { initEditor, buildCharacter, loadSavedConfig, clearSavedHair } from './editor.js';
import { createKai } from './kai.js';
import { createCompanion } from './crew.js';
import { EnemyManager, WAVES } from './enemies.js';
import { Combat } from './combat.js';
import { UI } from './ui.js';
import { sfx, music } from './audio.js';
import { banter } from './banter.js';
import {
  initEpisode, updateEpisode, isEpisodeCutscene, isBrawlActive,
  isDreamSet, resetDream, notifyEpisodeHit, tryStartEpisode, getQuest, getQuestTargetPos,
  padDialogInput, BRAWL_DAMAGE_MULT, showWorldLine,
} from './episode.js';
import { createMinimap } from './minimap.js';
import { initHanami, updateHanami } from './hanami.js';

// ---------- renderer / scene ----------
const canvas = document.getElementById('game-canvas');
// Runde 15 (gemessen): gl.SAMPLES=4 wurde bezahlt, aber wirkungslos — die Szene
// zeichnet in die (nicht multisampled) EffectComposer-Rendertargets; ins
// Default-Framebuffer schreibt nur ein kantenloses Vollbild-Dreieck des letzten
// Passes. MSAA glaettet dort nichts, kostet aber den Aufloesungsschritt jeden
// Frame. Standard jetzt: kein MSAA; ?aa schaltet es zum Vergleich wieder an.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: WANT_AA });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_CAP));
renderer.shadowMap.enabled = true;
// R16 Aufgabe B: PCFSoft ist ZURÜCK. Der R15-Wechsel auf PCF entfernte mit
// sun.shadow.radius = 4 (arena.js) die einzige Kantenweichzeichnung — drei
// blinde Kritiker fanden daraufhin 8–15-px-Treppenstufen in jeder Penumbra
// (RUNDE15-STAND.md, Nachtrag 2); der Filterwechsel-Gewinn war nie einzeln
// gemessen, nur der ganze Schattenpass (2,88 ms von 27 ms GPU).
// ?pcf erzwingt den harten Filter — AUSSCHLIESSLICH als Messhebel für
// gepaarte A/B-Aufnahmen und Kostenvergleiche im selben Build (wie ?novillagers).
renderer.shadowMap.type = new URLSearchParams(location.search).has('pcf')
  ? THREE.PCFShadowMap
  : THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 600);

// ---------- post-processing (bloom + output + film grade) ----------
// Runde 15 (gemessen): OutputPass (ACES-Tonemapping + sRGB-Konvertierung) und der
// Grade-Pass (warmer Push, Saettigung, Schwarzanhebung, Vignette, Korn) liefen als
// zwei getrennte Vollbild-Passes hintereinander; der Grade-Pass allein kostet 2,29 ms
// (7,8 %). Beide sind jetzt EIN Pass. Reihenfolge unveraendert: Tonemapping + sRGB
// ZUERST, danach die Grade-Mathematik. Der Tonemapping/Colorspace-Teil ist exakt
// three's eigener OutputPass (dieselben ShaderChunks, dieselben Funktionsaufrufe,
// dieselbe toneMappingExposure-Uniform) — kein eigener Nachbau der Formeln.
const GradeOutputShader = {
  uniforms: {
    tDiffuse: { value: null },
    toneMappingExposure: { value: renderer.toneMappingExposure },
    uGradeOn: { value: 1 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uGradeOn;
    uniform float uTime;

    // KEIN manueller Kopier-Einbau von tonemapping_pars_fragment/colorspace_pars_fragment
    // mehr hier: three's WebGLProgram fuegt genau diese beiden Chunks (inkl. der
    // "uniform float toneMappingExposure;"-Deklaration und ALLEN Tonemapping-/
    // Colorspace-Funktionskoerpern wie ACESFilmicToneMapping()/sRGBTransferOETF())
    // bei jedem nicht-rohen ShaderMaterial automatisch in den Fragment-Shader-Header
    // ein, sobald material.toneMapped (Material-Default: true, hier nicht ueberschrieben)
    // und der Pass auf den Screen zeichnet (renderToScreen, hier: letzter Pass im
    // Composer) — geprueft in WebGLPrograms.js/WebGLProgram.js (three@0.160.0). Die
    // handkopierten Zeilen dupplizierten diese Deklarationen 1:1 und waren die
    // Ursache der "redefinition"/"function already has a body"-Fehler. Die
    // #define-Gates unten bleiben: eigene, kollisionsfreie Namen (nicht das
    // three-interne TONE_MAPPING-Define), sie schalten nur, ob main() die
    // (automatisch bereitgestellten) Funktionen aufruft — dieselbe #ifdef-Weiche wie
    // im echten OutputShader.js.
    #define ACES_FILMIC_TONE_MAPPING
    #define SRGB_TRANSFER

    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // ---- OutputPass-Aequivalent: Tonemapping ZUERST, danach sRGB ----
      // #ifdef-Weiche statt direktem Aufruf: identisch zu OutputShader.js, damit
      // die Defines oben nicht nur Dokumentation sind, sondern echte Gates.
      #ifdef ACES_FILMIC_TONE_MAPPING
      c.rgb = ACESFilmicToneMapping(c.rgb);
      #endif
      #ifdef SRGB_TRANSFER
      c = sRGBTransferOETF(c);
      #endif

      // ---- Grade: warmer Push, Saettigung, Schwarzanhebung, Vignette, Korn ----
      // Per Uniform abschaltbar statt per Pass.enabled: die Sonde (perf.js) schaltet
      // ?nograde / ab=grade ueber passes.grade.enabled um. Wuerde das den ganzen Pass
      // ueberspringen, fiele auch die Tonemapping/sRGB-Konvertierung weg (das war
      // vorher der IMMER aktive OutputPass) — das Bild ginge unkonvertiert raus.
      if (uGradeOn > 0.5) {
        // warm grade + gentle saturation boost
        c.rgb *= vec3(1.05, 1.00, 0.92);
        float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(luma), c.rgb, 1.08);
        // gentle black lift (filmic floor)
        c.rgb = c.rgb * 0.97 + 0.008;
        // vignette (kept subtle: the HUD adds a CSS vignette on top)
        float d = length(vUv - 0.5) * 2.0;
        c.rgb *= 1.0 - 0.22 * smoothstep(0.45, 1.4, d);
        // animated film grain — dithers the flat sand gradients
        float g = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
        c.rgb += (g - 0.5) * 0.035;
      }
      gl_FragColor = c;
    }`,
};

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, DPR_CAP));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
// Runde 15 (gemessen): Bloom kostet 5,0 ms (17 %). Eingang halbiert -> ~1/4 der Kosten.
// Schwelle/Staerke/Radius unveraendert, wie vom Auftrag verlangt.
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
  0.3,   // low strength — only genuine highlights glow
  0.6,   // radius
  0.85,  // threshold keeps sand/buildings clean
);
composer.addPass(bloomPass);
const gradePass = new ShaderPass(GradeOutputShader);
composer.addPass(gradePass);

// Sonden-Fassade fuer perf.js: gradePass.enabled bleibt fest true (der Pass macht ab
// jetzt auch das Pflicht-Tonemapping/sRGB, s.o. — ihn zu ueberspringen waere kein
// gueltiger Ablationszustand mehr). Dieses Objekt bildet .enabled stattdessen auf die
// uGradeOn-Uniform ab; createPerf() bekommt es unten als passes.grade.
const gradeControl = {
  get enabled() { return gradePass.uniforms.uGradeOn.value !== 0; },
  set enabled(v) { gradePass.uniforms.uGradeOn.value = v ? 1 : 0; },
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth / 2, window.innerHeight / 2); // mit der halben Bloom-Aufloesung mitziehen
});

// ---------- world ----------
const arena = createArena(scene);
// R22 Aufgabe A: Welt-Schmuck ("Die Insel lebt") — bewusst von HIER aufgerufen,
// nicht aus arena.js: main.js steht nicht im Sim-Manifest, und die sim/gen-Kopie
// von arena.js darf kein Modul importieren, das build.mjs nicht mitkopiert.
buildFlair(arena.ctx);
// R23 Aufgabe B: Entdeckungs-Orte + Strandgut (gleiches Aufruf-Muster). Die
// Flaschenpost-Zeile laeuft ueber den Untertitel-Kanal der Episode.
const discover = buildDiscover(arena.ctx, { showLine: (text, speaker) => showWorldLine(text, speaker) });
// R23 Aufgabe C: Ambient-NPCs (belebte Welt). Ihr Loop-Updater haengt an
// arena.ctx.updaters und laeuft damit ueber arena.update() mit — kein eigener
// Tick-Ast. Die Verhaftungs-Episode borgt sich dorfnahe Statisten (s. initEpisode).
const extras = buildExtras(arena.ctx);
// R23 Aufgabe D: die Marine-Patrouille — reine Inszenierung vor dem bestehenden
// endPeace('timeout'); begin()/recognize()/clear() steuert updatePeace unten.
const patrol = createPatrol(arena.ctx);

// depth haze: exponential falloff melts the tower/far houses into the sky
// (same warm tone the arena uses for its background, so the horizon stays seamless)
// R22 Aufgabe A.2: heller/goldener (vorher 0xf0b285 @ 0.0075) und einen Hauch
// klarer — "goldene Stunde" statt Staubschleier, die Abendstimmung bleibt.
scene.fog = new THREE.FogExp2(0xf6c9a0, 0.0068);

// hot sun core: small toneMapped-false sprite at the sun's position so the
// bloom pass has a genuine >threshold highlight to bite (blown-out hotspot)
{
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = 256;
  const ctx = cnv.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 246, 224, 1)');
  grad.addColorStop(0.25, 'rgba(255, 240, 205, 0.85)');
  grad.addColorStop(1, 'rgba(255, 240, 205, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, fog: false, toneMapped: false, depthWrite: false,
    transparent: true, blending: THREE.AdditiveBlending,
  }));
  sunCore.position.set(-260, 105, -190); // matches the arena's sun disc / light dir
  sunCore.scale.setScalar(34);
  scene.add(sunCore);
}

let hero = createHero();
scene.add(hero.group);

const enemyManager = new EnemyManager(scene, arena.obstacles);
const ui = new UI();

// ---------- companion: KAI (crew.js adds kai.group to the scene) ----------
const kai = createKai();
const companion = createCompanion({
  scene,
  kai,
  getEnemies: () => enemyManager.enemies,
  obstacles: arena.obstacles, // Kai kollidiert wie die Marines mit Häusern/Props (R13-Kritik #6)
});
// debug handle, same spirit as window.__hitStop — lets the console inspect the AI
window.__companion = companion;
window.__kai = kai;
window.__enemyManager = enemyManager;
window.__hero = hero;
window.__arena = arena; // Konsole kann Flucht/Rueckkehr der Bewohner direkt ausloesen
banter.init((text) => ui.setBanter(text));

// ---------- game state ----------
const PLAYER_MAX_HP = 100;
const state = {
  mode: 'menu',          // menu | playing | alarmBeat | bossIntro | victory | win | lose
  hp: PLAYER_MAX_HP,
  waveIndex: 0,
  kills: 0,
  startTime: 0,
  waveTransition: 0,     // countdown between waves
  invuln: 0,
  overdrive: 0,           // 0..OVERDRIVE_MAX meter, never decays while charging
  overdriveActive: false, // true for the 8s buff window
  overdriveTimeLeft: 0,   // seconds left in the buff window
};

const combat = new Combat(scene, camera, hero, enemyManager, {
  onKill: () => { state.kills++; },
  onHit: (enemy) => { addOverdriveMeter(OVERDRIVE_GAIN_HIT); notifyEpisodeHit(enemy); },
});

// ---------- Charakter-Editor (Runde 11, M2 v0) ----------
// "Uebernehmen" im Editor ersetzt das komplette Spieler-Modell: neues
// createHero() mit Frisur-GLB, altes Modell raus, Referenzen umhaengen.
const playerLabelEl = document.querySelector('#hud-player > .label');

// Wegwerf-Modell vollstaendig freigeben (Geometrie, Materialien, CanvasTexturen).
// GLB-Klone tragen userData.sharedGeo — deren Geometrie gehoert dem Editor-Cache.
// Sprites (Overdrive-Aura) sind keine Meshes und brauchen einen eigenen Zweig,
// sonst leaken SpriteMaterial + Aura-Textur pro Charakter-Wechsel (Kritiker R12 #2).
function disposeCharacter(char) {
  char.group.traverse((o) => {
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
  // Off-Graph-Ressourcen (Ghost-Geometrien in hero.js) haengen nicht im Graph
  char.dispose?.();
}

async function applyCharacter(cfg) {
  const fresh = await buildCharacter(cfg);
  fresh.group.position.copy(hero.group.position);
  fresh.group.rotation.copy(hero.group.rotation);
  fresh.group.rotation.order = 'YXZ'; // wie beim Original (Dodge-Lean)
  fresh.setOverdrive(state.overdriveActive);
  scene.remove(hero.group);
  disposeCharacter(hero);
  hero = fresh;
  scene.add(hero.group);
  combat.hero = hero; // Combat haelt eine eigene Referenz (liest stats.dmg/knock)
  window.__hero = hero;
  // Koerperbau-Kopplung (Runde 12): Move-Speed sofort auf den neuen Body umstellen,
  // laufender Overdrive-Buff bleibt dabei erhalten
  player.speed = basePlayerSpeed() * (state.overdriveActive ? OVERDRIVE_SPEED_MULT : 1);
  if (playerLabelEl && cfg && cfg.name) playerLabelEl.textContent = cfg.name;
}
initEditor({ onApply: (cfg) => applyCharacter(cfg) }); // editor.js awaited das Promise
const savedCharacter = loadSavedConfig();
// R16 (Entbrandung): auch OHNE Speicherstand einmal durch applyCharacter —
// buildCharacter(null) füllt mit editor.js DEFAULT_CONFIG auf (froehlich,
// blaues Oberteil), damit der Fresh-Start denselben Standard trägt wie der
// Editor statt der nackten createHero()-Defaults (rote Weste, Narbe).
// ACHTUNG Reihenfolge: NICHT sofort aufrufen, sondern erst nach compileAsync
// (Aufruf unten in dessen .finally()). disposeObject() des Wegwerf-Modells,
// während der Compiler seine Material-Liste abarbeitet, ließ three.js'
// checkMaterialsReady auf undefined laufen — beim GLB-freien Standardpfad
// deterministisch, bei Speicherständen als latenter Race.
function applyBootCharacter() {
  return applyCharacter(savedCharacter).catch((err) => {
    // Frisur-GLB weg/kaputt -> nur die Frisur degradieren und den Rest der
    // Config (Koerperbau/Gesicht/Outfit/Name + Stats) SOFORT erneut anwenden —
    // vorher ging die komplette Auswahl still verloren (Kritiker R12 #5)
    console.warn('[main] Gespeicherter Charakter nicht ladbar, degradiere Frisur:', err);
    clearSavedHair();
    return applyCharacter({ ...savedCharacter, hairId: null });
  }).catch((err) => {
    // auch ohne Frisur nicht baubar -> Standard-Hero bleibt stehen
    console.error('[main] Charakter auch ohne Frisur nicht ladbar, Standard-Hero:', err);
  });
}

// ---------- OVERDRIVE ----------
function addOverdriveMeter(amount) {
  if (state.mode !== 'playing' || state.overdriveActive) return;
  state.overdrive = Math.min(OVERDRIVE_MAX, state.overdrive + amount);
}

let overdriveHeartbeatT = 0;
let overdriveSteamT = 0;
const _overdriveSteamOffset = new THREE.Vector3();
const _overdriveSteamPos = new THREE.Vector3();

function tryActivateOverdrive() {
  if (state.mode !== 'playing' || state.overdriveActive || state.overdrive < OVERDRIVE_MAX) return;
  state.overdriveActive = true;
  state.overdriveTimeLeft = OVERDRIVE_DURATION;
  player.speed = basePlayerSpeed() * OVERDRIVE_SPEED_MULT;
  combat.overdriveActive = true;
  hero.setOverdrive(true);
  overdriveHeartbeatT = 0;
  overdriveSteamT = 0;
  // the "moment": brief slow-mo flash + FOV kick + activation snarl (reuses existing systems)
  window.__slowMo?.(0.12, 0.3);
  window.__fovKick?.();
  sfx.overdriveActivate();
}

function endOverdrive() {
  state.overdriveActive = false;
  state.overdrive = 0;
  state.overdriveTimeLeft = 0;
  player.speed = basePlayerSpeed();
  combat.overdriveActive = false;
  hero.setOverdrive(false);
  _overdriveSteamPos.copy(hero.group.position).add(new THREE.Vector3(0, 1.1, 0));
  combat.particles.burst(_overdriveSteamPos, 0xe8e0d8, 16, 3.5, 1.4);
  sfx.overdriveEnd();
}

// runs on raw time so the buff duration/heartbeat stay steady through hit-stop/slow-mo
function updateOverdrive(rawDt) {
  if (!state.overdriveActive) return;
  state.overdriveTimeLeft = Math.max(0, state.overdriveTimeLeft - rawDt);

  overdriveHeartbeatT -= rawDt;
  if (overdriveHeartbeatT <= 0) {
    overdriveHeartbeatT = OVERDRIVE_HEARTBEAT_INTERVAL;
    sfx.overdriveHeartbeat();
  }

  // rising steam puffs off the body, reusing combat's particle pool — dense enough
  // to read as a body-wrapping haze even alongside the hero.js aura shell
  overdriveSteamT -= rawDt;
  if (overdriveSteamT <= 0) {
    overdriveSteamT = OVERDRIVE_STEAM_INTERVAL;
    _overdriveSteamOffset.set((Math.random() - 0.5) * 0.6, 0.7 + Math.random() * 1.1, (Math.random() - 0.5) * 0.6);
    _overdriveSteamPos.copy(hero.group.position).add(_overdriveSteamOffset);
    combat.particles.burst(_overdriveSteamPos, 0xffcfc0, 4, 1.8, 0.6);
  }

  if (state.overdriveTimeLeft <= 0) endOverdrive();
}

// ---------- input ----------
const keys = {};
let yaw = 0;
let pitch = -0.18;
let pointerLocked = false;

// dodge input: Shift, or double-tap a movement direction
const DODGE_TAP_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1 };
const DOUBLE_TAP_MS = 250;
const lastTap = {};

document.addEventListener('keydown', (e) => {
  setInputDevice('kb'); // R21 Aufgabe A.3: Prompts zeigen die zuletzt benutzte Eingabeart
  const wasDown = keys[e.code];
  keys[e.code] = true;
  if (e.code === 'KeyQ' && state.mode === 'playing' && !isEpisodeCutscene()) combat.tryGatling();
  if (e.code === 'KeyF' && state.mode === 'playing' && !isEpisodeCutscene()) tryActivateOverdrive();
  // Friedensphase: E am Wachturm startet Welle 1. Der Radius allein tut es NICHT —
  // sonst beendet jeder, der von der Startposition aus stumpf W hält, die Ruhe nach
  // knapp 4 s, ohne die Regel je gelesen zu haben. peace.atTower spiegelt genau den
  // Prompt, der gerade im HUD steht: sichtbares Angebot = wirksame Taste. Es trägt
  // seit PEACE_PROMPT_MIN_T auch die Zeitbedingung, damit hier kein zweiter,
  // abweichender Torwächter entsteht (updatePeace ist die einzige Quelle).
  // R18 Aufgabe A: "Talk to Kai" hat Vorrang vor dem Turm-Angebot — tryStartEpisode()
  // greift nur, solange die Episode noch nicht gespielt wurde (episode.js prueft das
  // selbst über localStorage) und der Spieler nah genug an Kai steht; sonst tut es
  // nichts und die Turm-Taste bleibt unveraendert wirksam.
  if (e.code === 'KeyE') interactPressed();
  // Friedensphase: R schaltet zwischen Gehen und Rennen um (Begründung der Tastenwahl
  // bei peace.run). !e.repeat ist Pflicht — die Auto-Repeat-Kette einer gehaltenen Taste
  // würde den Zustand sonst mehrmals pro Sekunde umklappen. Außerhalb von 'calm' tut R
  // nichts: der Kampf läuft ausschließlich auf basePlayerSpeed().
  if (e.code === 'KeyR' && !e.repeat) toggleRun();
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) tryDodge();
  if (DODGE_TAP_KEYS[e.code] && !wasDown) {
    const now = performance.now();
    if (now - (lastTap[e.code] || -1e9) < DOUBLE_TAP_MS) tryDodge();
    lastTap[e.code] = now;
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

// Die geteilten Aktionsfunktionen (Tastatur-E/R UND Gamepad-Y/L3 rufen sie auf):
// die Torwaechter-Logik lebt genau EINMAL, sichtbares Angebot = wirksame Taste
// bleibt wahr, egal von welchem Geraet die Bestaetigung kommt.
function interactPressed() {
  if (state.mode !== 'playing' || peace.phase !== 'calm') return;
  if (tryStartEpisode()) return;
  // R23 Aufgabe B.5: Strandgut hat Vorrang vor dem Turm — beide Prompts koennen
  // nie gleichzeitig gelten (Strandgut liegt an den Straenden, der Turm bei r 30),
  // die Reihenfolge ist also nur Torwaechter-Hygiene, kein echter Konflikt.
  // R25.1: erfolgreicher Fund -> der Held bueckt sich kurz (hero.js pickupBend;
  // das Fundstueck bleibt am Boden — Felix: Animation ja, Schweben nein)
  if (discover.tryPickup(player.pos)) { hero.pickupBend?.(); return; }
  if (peace.atTower) endPeace('tower');
}
function toggleRun() {
  if (state.mode !== 'playing' || peace.phase !== 'calm') return;
  peace.run = !peace.run;
  player.speed = peace.run ? basePlayerSpeed() : peaceWalkSpeed();
}

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  setInputDevice('kb');
  yaw -= e.movementX * 0.0024;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.1, Math.min(0.5, pitch));
});

document.addEventListener('mousedown', (e) => {
  setInputDevice('kb');
  if (state.mode !== 'playing' || !pointerLocked) return;
  if (e.button === 0) combat.tryPistol();
  else if (e.button === 2) {
    combat.tryBazooka();
    // tryBazooka is gated by cooldown/attack — only kick if it actually fired
    if (combat.attack && combat.attack.type === 'bazooka' && combat.attack.t === 0) {
      window.__fovKick();
    }
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked && state.mode === 'playing') {
    // pause-ish: nothing formal in v0, player can click canvas to relock
  }
});
canvas.addEventListener('click', () => {
  if (state.mode === 'playing' && !pointerLocked) requestPointerLockSafe();
});

// requestPointerLock returns a Promise in Chromium and rejects when the
// browser denies it (e.g. no user engagement) — swallow, the click handler retries
function requestPointerLockSafe() {
  const p = canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

// ---------- Gamepad (R21 Aufgabe A) ----------
// Standard-Mapping der Gamepad-API, im Spieltick gepollt (die API ist Polling-only,
// es gibt keine Button-Events). Der Controller ist ZUSAETZLICH: kein Tastatur-/
// Maus-Pfad wird ersetzt, beide Geraete sind jederzeit gleichzeitig wirksam.
// Belegung laut Auftrag: linker Stick Laufen, rechter Stick Kamera, A Springen,
// X Angriff, B Ausweichen, Y Interakt (E), Start Pause/Start, D-Pad+A Dialog.
// Builder-Zugabe darueber hinaus (sonst waere ein Pad-Spieler von Gatling/Bazooka/
// Overdrive/Renn-Umschalter ausgesperrt — Felix urteilt): RT Bazooka, LT Gatling,
// RB Overdrive, L3 Renn-Umschalter. Feintuning (Deadzone/Tempo) = Felix' Pad-Hand.
const PAD_BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  START: 9, L3: 10, DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15,
};
const PAD_DEADZONE = 0.2;       // linker Stick, radial — Drift-Schutz
const PAD_CAM_DEADZONE = 0.24;  // rechter Stick etwas groesser (Kamera darf nie kriechen)
const PAD_CAM_YAW_SPEED = 2.9;  // rad/s bei Vollausschlag …
const PAD_CAM_PITCH_SPEED = 1.7; // … Pitch langsamer, wie das Maus-Verhaeltnis (24:22 ist er nicht — Kamera-Kurve wiegt mit)
const pad = {
  active: false,          // in diesem Frame ein Pad gefunden
  moveX: 0, moveY: 0,     // linker Stick nach Deadzone (Betrag 0..1)
  jumpHeld: false,        // A gehalten — Spring-Aequivalent zu keys['Space']
  prev: [],               // Button-Zustand des Vorframes fuer Kanten-Erkennung
};

// "Zuletzt benutztes Eingabegeraet" — schaltet die sichtbaren Tasten-Prompts um
// (Auftrag A.3). Text reicht: E<->Y am Turm-/Brunnen-Prompt, [R]<->[L3] im Strip.
let lastInputDevice = 'kb'; // 'kb' | 'pad'
const towerPromptKeyEl = document.querySelector('#tower-prompt .key');
const episodePromptKeyEl = document.querySelector('#episode-prompt .key');
const discoverPromptKeyEl = document.querySelector('#discover-prompt .key'); // R23: Strandgut

function setInputDevice(dev) {
  if (dev === lastInputDevice) return;
  lastInputDevice = dev;
  const key = dev === 'pad' ? 'Y' : 'E';
  if (towerPromptKeyEl) towerPromptKeyEl.textContent = key;
  if (episodePromptKeyEl) episodePromptKeyEl.textContent = key;
  if (discoverPromptKeyEl) discoverPromptKeyEl.textContent = key;
  // calmObjectiveSub() liest lastInputDevice; updatePeace() schreibt den Strip pro
  // Frame und ui.js cached — der [R]/[L3]-Wechsel zieht im naechsten Frame nach.
}

// Radiale Deadzone + Re-Skalierung: ab der Deadzone waechst der Betrag linear von 0
// auf 1 — kein Sprung an der Zonenkante, kein Drift innerhalb.
const _stick = { x: 0, y: 0, m: 0 };
function readStick(ax, ay, dz) {
  const m = Math.hypot(ax, ay);
  if (m < dz) { _stick.x = 0; _stick.y = 0; _stick.m = 0; return _stick; }
  const k = Math.min(1, (m - dz) / (1 - dz));
  _stick.x = (ax / m) * k;
  _stick.y = (ay / m) * k;
  _stick.m = k;
  return _stick;
}

// R22 Aufgabe C.1: "der sichtbare Menue-Knopf" fuer Pad-A/Start ist jetzt der
// PRIMAERE — fuer Rueckkehrer also New Journey (Auftrag: er ist der Hauptweg),
// sonst wie bisher der Start-Knopf. applyMenuMode() haelt die Sichtbarkeit synchron.
function menuPrimaryClick() {
  const nj = document.getElementById('btn-new-journey');
  if (nj && !nj.classList.contains('hidden')) nj.click();
  else document.getElementById('btn-start')?.click();
}

// window.__padGamepads: Test-Werkzeug im Muster von ?callnow (R19) — der Browser-
// Pruefstand stubbt damit ein Pad, ohne navigator anzufassen; echtes Pad = Felix.
function getGamepads() {
  if (window.__padGamepads) return window.__padGamepads();
  return navigator.getGamepads ? navigator.getGamepads() : [];
}

function pollGamepad(rawDt) {
  let gp = null;
  const list = getGamepads();
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].connected !== false) { gp = list[i]; break; }
  }
  pad.active = !!gp;
  if (!gp) {
    pad.moveX = 0; pad.moveY = 0; pad.jumpHeld = false;
    pad.prev.length = 0;
    return;
  }

  const down = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const just = (i) => down(i) && !pad.prev[i];
  const axes = gp.axes || [];

  // linker Stick -> Laufen (gelesen von readMoveInput, analog: Betrag skaliert
  // Tempo). ACHTUNG: readStick() recycelt EIN Objekt — Werte muessen VOR dem
  // zweiten Aufruf herauskopiert sein, sonst liest der Geraete-Flag-Check unten
  // die Werte des RECHTEN Sticks (der Prompt blieb so beim ersten Wurf auf "E").
  const mv = readStick(axes[0] || 0, axes[1] || 0, PAD_DEADZONE);
  pad.moveX = mv.x;
  pad.moveY = mv.y;
  const mvM = mv.m;

  // rechter Stick -> Kamera. Quadratische Antwortkurve auf den Betrag (Auftrag A.2):
  // kleine Auslenkung zielt fein, ein Flick reisst die Kamera nicht — bei halbem
  // Ausschlag dreht sie mit einem Viertel des Maximaltempos.
  const cv = readStick(axes[2] || 0, axes[3] || 0, PAD_CAM_DEADZONE);
  if (cv.m > 0 && state.mode === 'playing' && !isEpisodeCutscene() && !paused) {
    yaw -= cv.x * cv.m * PAD_CAM_YAW_SPEED * rawDt;
    pitch -= cv.y * cv.m * PAD_CAM_PITCH_SPEED * rawDt;
    pitch = Math.max(-1.1, Math.min(0.5, pitch));
  }

  // Geraete-Flag: jede echte Pad-Aktivitaet (Stick ausserhalb der Deadzone oder
  // irgendein Knopf) schaltet die Prompts um — blosses Angestecktsein nicht.
  let anyDown = false;
  for (let i = 0; i < gp.buttons.length; i++) { if (down(i)) { anyDown = true; break; } }
  if (anyDown || mvM > 0 || cv.m > 0) setInputDevice('pad');

  // A haelt den Sprung (kontinuierlich gelesen wie keys['Space']); die KANTE von A
  // bestaetigt zuerst den Brunnen-Dialog (falls offen), sonst den sichtbaren
  // Menue-Knopf — genau eine Wirkung pro Druck.
  pad.jumpHeld = down(PAD_BTN.A);
  if (just(PAD_BTN.A)) {
    if (padDialogInput('confirm')) pad.jumpHeld = false;
    else if (state.mode === 'menu') menuPrimaryClick();
    else if (state.mode === 'win') document.getElementById('btn-restart-win')?.click();
    else if (state.mode === 'lose') document.getElementById('btn-restart-lose')?.click();
  }

  if (just(PAD_BTN.B)) tryDodge(); // eigene Torwaechter (playing, kein Cutscene, Cooldown)
  if (just(PAD_BTN.X) && state.mode === 'playing' && !isEpisodeCutscene()) combat.tryPistol();
  if (just(PAD_BTN.RT) && state.mode === 'playing' && !isEpisodeCutscene()) {
    combat.tryBazooka();
    if (combat.attack && combat.attack.type === 'bazooka' && combat.attack.t === 0) {
      window.__fovKick(); // gleicher Kick wie der Rechtsklick-Pfad
    }
  }
  if (just(PAD_BTN.LT) && state.mode === 'playing' && !isEpisodeCutscene()) combat.tryGatling();
  if (just(PAD_BTN.RB) && state.mode === 'playing' && !isEpisodeCutscene()) tryActivateOverdrive();
  if (just(PAD_BTN.Y)) interactPressed();
  if (just(PAD_BTN.L3)) toggleRun();
  if (just(PAD_BTN.START)) {
    if (state.mode === 'playing') togglePause();
    else if (state.mode === 'menu') menuPrimaryClick();
    else if (state.mode === 'win') document.getElementById('btn-restart-win')?.click();
    else if (state.mode === 'lose') document.getElementById('btn-restart-lose')?.click();
  }

  // D-Pad navigiert die Dialog-Antworten (A bestaetigt, s. o.); ausserhalb des
  // Dialogs tut das D-Pad nichts — padDialogInput() verweigert dann selbst.
  if (just(PAD_BTN.DUP) || just(PAD_BTN.DLEFT)) padDialogInput('up');
  if (just(PAD_BTN.DDOWN) || just(PAD_BTN.DRIGHT)) padDialogInput('down');

  pad.prev.length = 0;
  for (let i = 0; i < gp.buttons.length; i++) pad.prev[i] = down(i);
}

// ---------- Pause (R21 Aufgabe A: Start-Knopf) ----------
// Minimal und robust: waehrend der Pause laeuft NUR renderFrame() — kein Update,
// kein Input-Handler wirkt (tick kehrt vorher um), die Uhr klemmt beim Fortsetzen
// ohnehin auf max. 0,05 s dt. Musik/DOM-Timer (Banner) laufen weiter — bewusst
// hingenommen, ein voller Audio-/Timer-Freeze waere ein eigener Umbau.
// Nur im Modus 'playing' erreichbar; endGame()/startGame() raeumen den Zustand ab.
let paused = false;
const pauseOverlayEl = document.getElementById('pause-overlay');

function setPaused(v) {
  if (paused === v) return;
  paused = v;
  if (pauseOverlayEl) pauseOverlayEl.classList.toggle('show', v);
  if (v) document.exitPointerLock();
  else if (state.mode === 'playing') requestPointerLockSafe();
}
function togglePause() {
  if (state.mode !== 'playing') return;
  setPaused(!paused);
}

// ---------- player physics ----------
const JUMP_VEL = 9.0;    // apex ~1.7m — enough to mount crates/barrels/the well
const GRAVITY = 24;
const STEP_EPS = 0.25;   // auto-step / edge tolerance for standable tops
const LAND_PAD = 0.15;   // footprint forgiveness when landing on a top

// dodge (Spider-Man style): short roll with full i-frames, perfect-dodge reward
const DODGE_TIME = 0.35;
const DODGE_SPEED = 10;         // ~3.5m over the roll
const DODGE_CD = 0.8;
const PERFECT_WINDOW = 0.15;    // strike absorbed here = perfect dodge

// OVERDRIVE — Runde 7 Overdrive-Ultimate (Felix' Auftrag): "gear-2" feel ultimate,
// charged by Perfect Dodges + landed hits, activated with F once full.
const OVERDRIVE_MAX = 100;
const OVERDRIVE_GAIN_PERFECT = 34;   // meter gained per Perfect Dodge
const OVERDRIVE_GAIN_HIT = 2;        // meter gained per landed player hit
const OVERDRIVE_DURATION = 8;        // seconds the buff lasts once activated
const OVERDRIVE_SPEED_MULT = 1.4;    // movement speed while active (combat.js scales attack tempo/damage)
const OVERDRIVE_HEARTBEAT_INTERVAL = 0.85; // seconds between the low thump/steam sfx ticks
const OVERDRIVE_STEAM_INTERVAL = 0.045;    // seconds between rising steam particle puffs (dense, per Kritiker)

const PLAYER_BASE_SPEED = 8.5;

// Koerperbau-Kopplung (Runde 12, WELT.md): klein & flink -> schneller,
// gross & massig -> langsamer. hero.stats kommt aus BODY_PRESETS in hero.js.
function basePlayerSpeed() {
  return PLAYER_BASE_SPEED * (hero.stats?.speed ?? 1);
}

// ---- Startpunkt des Spielers (Runde 16) ----
// Er liegt bewusst NICHT mehr auf x = 0. Playtest-Befund: gehaltenes W — die
// natürlichste erste Eingabe, die es gibt — lief vom alten Spawn (0, 10) nach 2,2 m
// in den Brunnenrand (village.js: Kollider (0, 6), r = 1.35) und blieb dort STEHEN.
// Kein Abgleiten, echter Stillstand: das Push-out in updatePlayer() schiebt radial aus
// dem Kollider heraus, und bei dx = 0 zeigt "radial" exakt der Laufrichtung entgegen —
// der Spieler klebt auf z = 6 + 1.35 + hero.radius fest, solange er W hält.
// 2,4 m nach Osten legt die Blickachse in die Gasse zwischen Brunnenrand (x = 1.35) und
// der Laterne bei (3.6, 8.6) (Kollider r = 0.25). Gemessen gegen die echte Kollider-
// Liste des Spiels: engste Stelle 0.50 m Luft (Körperbau "Normal", hero.radius = 0.45)
// bzw. 0.43 m für den "Riesen" (0.522) — und dahinter läuft W 38,05 m frei bis an den
// Turm-Kollider selbst. Gehaltenes W führt damit ZUM Ziel, statt gegen eine Wand.
// Die beiden verworfenen Alternativen, damit sie niemand erneut durchspielen muss:
//   - Brunnen versetzen: zöge Bodenplatten, Pfosten, Querbalken UND den Bewohner-Anker
//     'well' (villagers.js) mit — vier Baustellen für etwas, das 2,4 m Versatz lösen.
//   - Blickrichtung drehen: um den 4 m voraus stehenden Brunnen zu verfehlen, braucht es
//     mindestens 27° Gierwinkel. Über die 40 m zum Turm sind das 18 m Versatz — der Turm
//     stünde dann gerade NICHT mehr "geradeaus", also das Gegenteil von CALM_OBJECTIVE_TITLE.
// Reiner Seitenversatz heisst: die Entfernung zum Turm wächst um 7 cm (40.00 -> 40.07 m),
// der Fussweg bis zum Turm-Angebot von 32,00 m auf 32,37 m. Die Tempo-Rechnung der
// Friedensphase (PEACE_WALK_SPEED) bleibt damit gültig: 8,00 s -> 8,09 s.
const SPAWN_POS = { x: 2.4, z: 10 };

const player = {
  pos: new THREE.Vector3(SPAWN_POS.x, 0, SPAWN_POS.z),
  vel: new THREE.Vector3(),
  grounded: true,
  speed: PLAYER_BASE_SPEED,
  // i-frame flag: enemies/main damage path reads dodge.active off this object
  dodge: { active: false, t: 0, cd: 0, dir: new THREE.Vector3(), rewarded: false },
};

const _move = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

hero.group.rotation.order = 'YXZ'; // yaw first, so the dodge lean is a clean local tilt

function readMoveInput() {
  _fwd.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-1);
  _right.set(-_fwd.z, 0, _fwd.x);
  _move.set(0, 0, 0);
  if (keys['KeyW']) _move.add(_fwd);
  if (keys['KeyS']) _move.sub(_fwd);
  if (keys['KeyD']) _move.add(_right);
  if (keys['KeyA']) _move.sub(_right);
  // R21 Aufgabe A: linker Stick additiv zur Tastatur (Stick-Y ist oben negativ).
  // Der Betrag bleibt erhalten — updatePlayer normalisiert nur noch ueber 1, damit
  // ein halber Stick-Ausschlag wirklich langsamer laeuft (Tastatur: unveraendert 1).
  if (pad.active && (pad.moveX !== 0 || pad.moveY !== 0)) {
    _move.addScaledVector(_fwd, -pad.moveY);
    _move.addScaledVector(_right, pad.moveX);
  }
  return _move.lengthSq() > 0;
}

function tryDodge() {
  if (state.mode !== 'playing' || isEpisodeCutscene()) return;
  const dodge = player.dodge;
  if (dodge.active || dodge.cd > 0) return;
  if (readMoveInput()) dodge.dir.copy(_move).normalize();
  else dodge.dir.copy(_fwd).negate(); // idle: hop backward
  dodge.active = true;
  dodge.t = 0;
  dodge.rewarded = false;
  ghostTimer = 0; // spawn a ghost immediately
}

// ---- dodge ghost trail: cheap transparent copies of the current pose ----
const ghosts = [];
let ghostTimer = 0;
const GHOST_LIFE = 0.22;
const GHOST_INTERVAL = 0.07;
const GHOST_OPACITY = 0.3;

function spawnGhost() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: GHOST_OPACITY,
    depthWrite: false,
  });
  const g = hero.group.clone(true);
  // Sprites (Overdrive-Aura) aus dem Klon werfen: clone() TEILT deren LIVE-
  // SpriteMaterial mit dem echten Hero — im Ghost wuerden sie leuchten und
  // nie verblassen. Nur entfernen, NICHT disposen (Material gehoert dem
  // Original). (Kritiker R12 #8)
  const sprites = [];
  g.traverse((n) => {
    if (n.isSprite) {
      sprites.push(n);
    } else if (n.isMesh) {
      n.material = mat;
      n.castShadow = false;
      n.receiveShadow = false;
    }
  });
  for (const s of sprites) s.removeFromParent();
  scene.add(g);
  ghosts.push({ g, mat, life: GHOST_LIFE });
}

function updateGhosts(rawDt) {
  for (let i = ghosts.length - 1; i >= 0; i--) {
    const gh = ghosts[i];
    gh.life -= rawDt;
    if (gh.life <= 0) {
      scene.remove(gh.g);
      gh.mat.dispose(); // pro Ghost alloziertes MeshBasicMaterial freigeben (Kritiker R12 #8)
      ghosts.splice(i, 1);
    } else {
      gh.mat.opacity = GHOST_OPACITY * (gh.life / GHOST_LIFE);
    }
  }
  if (player.dodge.active) {
    ghostTimer -= rawDt;
    if (ghostTimer <= 0) {
      spawnGhost();
      ghostTimer = GHOST_INTERVAL;
    }
  }
}

// highest standable surface under (x, z), considering only tops at or barely
// above foot height (allows a small auto-step, never teleports up a wall)
function supportHeightAt(x, z, footY) {
  let h = groundHeightAt(x, z); // Relief/Steg statt flacher y=0-Boden (R13-Kritik #2)
  for (const o of arena.obstacles) {
    if (o.topY === undefined || o.topY <= h) continue;
    if (o.topY > footY + STEP_EPS) continue;
    if (Math.hypot(x - o.x, z - o.z) <= o.radius + LAND_PAD) h = o.topY;
  }
  return h;
}

const _prevPos = { x: 0, z: 0 }; // letzte gültige Position für den Grenz-Slide

function updatePlayer(dt) {
  const dodge = player.dodge;
  dodge.cd = Math.max(0, dodge.cd - dt);
  _prevPos.x = player.pos.x;
  _prevPos.z = player.pos.z;

  const moving = readMoveInput();
  // Tastatur-Vektoren haben Laenge >= 1 (normalisieren wie bisher); der Analog-Stick
  // liefert < 1 und behaelt seinen Betrag — analoges Gehen ohne eigenen Codepfad.
  const moveMag = moving ? Math.min(1, _move.length()) : 0;
  if (moving && _move.lengthSq() > 1) _move.normalize();

  if (dodge.active) {
    dodge.t += dt;
    player.pos.x += dodge.dir.x * DODGE_SPEED * dt;
    player.pos.z += dodge.dir.z * DODGE_SPEED * dt;
    if (dodge.t >= DODGE_TIME) {
      dodge.active = false;
      dodge.cd = DODGE_CD;
    }
  } else {
    player.pos.x += _move.x * player.speed * dt;
    player.pos.z += _move.z * player.speed * dt;
  }

  // jump (Tastatur ODER Pad-A — beide werden kontinuierlich gelesen)
  if ((keys['Space'] || pad.jumpHeld) && player.grounded) {
    player.vel.y = JUMP_VEL;
    player.grounded = false;
  }
  const prevY = player.pos.y;
  if (!player.grounded) {
    player.vel.y -= GRAVITY * dt;
    player.pos.y += player.vel.y * dt;
    if (player.vel.y <= 0) {
      // falling: land on the terrain (Relief/Steg), or an obstacle top we were above
      let landY = groundHeightAt(player.pos.x, player.pos.z);
      for (const o of arena.obstacles) {
        if (o.topY === undefined || o.topY <= landY) continue;
        if (o.topY > prevY + 0.001) continue;
        if (Math.hypot(player.pos.x - o.x, player.pos.z - o.z) <= o.radius + LAND_PAD) {
          landY = o.topY;
        }
      }
      if (player.pos.y <= landY) {
        player.pos.y = landY;
        player.vel.y = 0;
        player.grounded = true;
      }
    }
  } else {
    // grounded: follow the support surface; walking off an edge = fall
    const support = supportHeightAt(player.pos.x, player.pos.z, player.pos.y);
    if (support < player.pos.y - 0.05) {
      player.grounded = false;
      player.vel.y = 0;
    } else {
      player.pos.y = support;
    }
  }

  // Insel-Grenze: Slide gegen die letzte gültige Position statt radialem Teleport
  // (Korridor-Logik lebt in arena.js/clampToWalkable — keine unsichtbaren Wände auf der Insel)
  clampToWalkable(player.pos, _prevPos);

  // obstacle push-out (skipped when standing on / jumping over that obstacle's top)
  for (const o of arena.obstacles) {
    if (o.topY !== undefined && player.pos.y >= o.topY - STEP_EPS) continue;
    const dx = player.pos.x - o.x;
    const dz = player.pos.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.radius + hero.radius;
    if (d < min && d > 0.001) {
      player.pos.x = o.x + (dx / d) * min;
      player.pos.z = o.z + (dz / d) * min;
    }
  }

  hero.group.position.copy(player.pos);

  // face: dodge direction, camera direction while attacking, else movement
  if (dodge.active) {
    hero.group.rotation.y = Math.atan2(dodge.dir.x, dodge.dir.z);
    // rolling lean: dip forward through the dodge, spring back at the end
    hero.group.rotation.x = Math.sin(Math.PI * Math.min(1, dodge.t / DODGE_TIME)) * 0.55;
  } else {
    hero.group.rotation.x *= Math.max(0, 1 - dt * 14); // ease lean back out
    if (combat.attack) {
      hero.group.rotation.y = yaw + Math.PI;
    } else if (moving) {
      const targetYaw = Math.atan2(_move.x, _move.z);
      let d = targetYaw - hero.group.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      hero.group.rotation.y += d * Math.min(1, dt * 12);
    }
  }

  // Locomotion-Blend statt An/Aus: hero.js skaliert Schrittfrequenz UND Schrittweite
  // mit diesem Wert (phase += dt * (4 + speed * 9)). Mit hartem 1 ruderte die Figur im
  // Renn-Takt durchs gehende Dorf. Im Kampf ist player.speed === basePlayerSpeed(),
  // der Quotient also 1 und die Animation bitgleich zu vorher; Overdrive (1,4x) klemmt
  // auf 1, die Rolle behält ihre volle Amplitude.
  const locoRef = basePlayerSpeed();
  const loco = locoRef > 0 ? Math.min(1, player.speed / locoRef) : 1;
  hero.update(dt, clock.elapsedTime, {
    // moveMag skaliert die Animation mit dem Stick-Betrag (Tastatur: exakt 1 wie bisher)
    speed: dodge.active ? 1 : (moving ? loco * moveMag : 0),
    grounded: player.grounded,
  });

  return moving;
}

// ---------- camera ----------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const shakeOff = new THREE.Vector3();
const CAM_DIST = 6.2;
const CAM_HEIGHT = 2.6;
// over-shoulder offset: shift BOTH the camera and its look target along the
// camera-local right axis, so Hero stands left-of-center and punches toward
// the crosshair are not hidden behind his own body
const SHOULDER_X = 0.85;
const LOOK_HEIGHT = 1.35; // slightly below head height — was 1.55

function updateCamera(dt) {
  const cy = Math.cos(pitch);
  // camera-local right axis (perpendicular to view yaw, flat on XZ)
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  camPos.set(
    player.pos.x + Math.sin(yaw) * CAM_DIST * cy + rx * SHOULDER_X,
    player.pos.y + CAM_HEIGHT - Math.sin(pitch) * CAM_DIST,
    player.pos.z + Math.cos(yaw) * CAM_DIST * cy + rz * SHOULDER_X,
  );
  // keep camera above ground
  if (camPos.y < 0.6) camPos.y = 0.6;

  // camera trails slightly during a dodge — sells the burst of speed
  camera.position.lerp(camPos, Math.min(1, dt * (player.dodge.active ? 5.5 : 10)));
  combat.getShakeOffset(shakeOff);
  camera.position.add(shakeOff);

  camTarget.set(
    player.pos.x + rx * SHOULDER_X,
    player.pos.y + LOOK_HEIGHT,
    player.pos.z + rz * SHOULDER_X,
  );
  camera.lookAt(camTarget);
}

// ---------- game feel: hit-stop + FOV kick ----------
// window.__hitStop(ms): scale game delta to ~0.05 for the given ms, then ease
// back to 1 over ~80ms. Queued hit-stops are capped so chains never freeze
// the game longer than 250ms.
const HITSTOP_SCALE = 0.05;
const HITSTOP_EASE = 0.08;   // seconds to ease back to full speed
const HITSTOP_CAP = 0.25;    // max accumulated hold, seconds
const hitStop = { hold: 0, ease: 0 };

window.__hitStop = (ms) => {
  const s = Math.max(0, (ms || 0) / 1000);
  hitStop.hold = Math.min(HITSTOP_CAP, hitStop.hold + s);
};

function hitStopTimeScale(rawDt) {
  if (hitStop.hold > 0) {
    hitStop.hold = Math.max(0, hitStop.hold - rawDt);
    hitStop.ease = HITSTOP_EASE;
    return HITSTOP_SCALE;
  }
  if (hitStop.ease > 0) {
    hitStop.ease = Math.max(0, hitStop.ease - rawDt);
    const k = 1 - hitStop.ease / HITSTOP_EASE; // 0 -> 1 as ease drains
    return HITSTOP_SCALE + (1 - HITSTOP_SCALE) * (k * k); // quad ease-in back to 1
  }
  return 1;
}

// ---------- game feel: perfect-dodge slow-mo ----------
// window.__slowMo(scale, seconds): scale gameplay delta for a short burst.
// Stacks multiplicatively with hit-stop (hit-stop dominates while it holds).
const slowMo = { t: 0, scale: 1 };

window.__slowMo = (scale, seconds) => {
  slowMo.scale = Math.max(0.05, scale || 0.35);
  slowMo.t = Math.max(slowMo.t, seconds || 0.5);
};

function slowMoTimeScale(rawDt) {
  if (slowMo.t <= 0) return 1;
  slowMo.t = Math.max(0, slowMo.t - rawDt);
  return slowMo.scale;
}

// ---------- Gefahrensinn: "dodge NOW" cue ----------
// Fired by the enemy manager when a windup enters its final DANGER_LEAD stretch.
// Three channels at once so the beat is unmissable: a spark above Hero's head,
// a red screen-edge pulse, and the sfx danger ping.
const SPARK_LIFE = 0.5;
const sparkCue = { t: 0 };
const dangerVignetteEl = document.getElementById('danger-vignette');
const overdriveVignetteEl = document.getElementById('overdrive-vignette');

function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  // jagged lightning bolt — der Gefahrensinn-Blitz ueberm Kopf
  g.strokeStyle = '#7fdbff';
  g.lineWidth = 10;
  g.lineJoin = 'miter';
  g.shadowColor = '#bfefff';
  g.shadowBlur = 18;
  g.beginPath();
  g.moveTo(76, 12);
  g.lineTo(50, 62);
  g.lineTo(70, 62);
  g.lineTo(44, 116);
  g.stroke();
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const sparkSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeSparkTexture(),
  transparent: true, opacity: 0, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending,
}));
sparkSprite.renderOrder = 999; // always readable, never clipped by geometry
sparkSprite.visible = false;
scene.add(sparkSprite);

function triggerDangerCue() {
  sparkCue.t = SPARK_LIFE;
  sfx.danger();
}

function updateDangerCue(rawDt) {
  // runs on raw time so the cue stays crisp through hit-stop/slow-mo
  if (sparkCue.t <= 0) { sparkSprite.visible = false; return; }
  sparkCue.t = Math.max(0, sparkCue.t - rawDt);
  const k = 1 - sparkCue.t / SPARK_LIFE;              // 0 -> 1
  sparkSprite.visible = true;
  sparkSprite.position.set(player.pos.x, player.pos.y + 2.55 + k * 0.25, player.pos.z);
  const pop = 0.55 + 0.5 * Math.sin(Math.min(1, k * 3) * Math.PI * 0.5); // fast pop-in
  sparkSprite.scale.set(pop, pop, 1);
  sparkSprite.material.opacity = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
  if (dangerVignetteEl) {
    dangerVignetteEl.style.opacity = (0.7 * (1 - k)).toFixed(3);
  }
}

// FOV kick: 68 -> 74 over 120ms, back over 200ms (used on Bazooka fire)
const FOV_BASE = 68;
const FOV_PEAK = 74;
const FOV_UP = 0.12;
const FOV_DOWN = 0.2;
const fovKick = { t: -1 }; // -1 = idle, else elapsed seconds

window.__fovKick = () => { fovKick.t = 0; };

function updateFovKick(rawDt) {
  if (fovKick.t < 0) return;
  fovKick.t += rawDt;
  let fov;
  if (fovKick.t < FOV_UP) {
    const k = fovKick.t / FOV_UP;
    fov = FOV_BASE + (FOV_PEAK - FOV_BASE) * (1 - (1 - k) * (1 - k)); // ease-out up
  } else if (fovKick.t < FOV_UP + FOV_DOWN) {
    const k = (fovKick.t - FOV_UP) / FOV_DOWN;
    fov = FOV_PEAK + (FOV_BASE - FOV_PEAK) * (k * k * (3 - 2 * k)); // smoothstep down
  } else {
    fov = FOV_BASE;
    fovKick.t = -1;
  }
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

// ---------- boss intro (Runde 9, Felix' Auftrag): Pirate-Warriors-style cold open ----------
// Letterbox closes, input is paused (state.mode leaves 'playing' so every input
// handler already gates on it), the camera flies to the boss over BOSS_INTRO_FLY,
// the boss brandishes its weapon while the name card reveals, then the camera
// snaps back and the fight opens for real. Timer-driven, not event-driven, so a
// restart mid-intro (startGame() forces mode back to 'playing') can never softlock.
const BOSS_INTRO_FLY = 2.0;   // seconds: camera travel to the boss shot
const BOSS_INTRO_HOLD = 1.3;  // seconds: held shot — weapon show + name card
const BOSS_INTRO_SNAP = 0.28; // seconds: fast snap back to the gameplay camera
const BOSS_INTRO_TOTAL = BOSS_INTRO_FLY + BOSS_INTRO_HOLD + BOSS_INTRO_SNAP;
const BOSS_INTRO_TITLE = 'Marine-Kapitän';
const BOSS_INTRO_NAME = 'Axthand Vargo';

const bossIntro = {
  active: false,
  t: 0,
  nameShown: false,
  slamShook: false,
  snapStarted: false,
  startPos: new THREE.Vector3(),
  startLook: new THREE.Vector3(),
};
const _biCamPos = new THREE.Vector3();
const _biLook = new THREE.Vector3();
const BOSS_INTRO_FALLBACK_POS = new THREE.Vector3(0, 0, -24); // boss spawn point (enemies.js spawnBoss)

function easeInOutQuad(k) {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

function startBossIntro() {
  state.mode = 'bossIntro';
  bossIntro.active = true;
  bossIntro.t = 0;
  bossIntro.nameShown = false;
  bossIntro.slamShook = false;
  bossIntro.snapStarted = false;
  bossIntro.startPos.copy(camera.position);
  bossIntro.startLook.copy(camTarget);
  ui.showLetterbox();
  music.duckForIntro(); // silence beat — the tension cue
  // the boss+guards are already spawned, so the combat-layer diff check in tick()
  // would fire setCombat(true) THIS frame and override the duck — mark the state
  // as already-combat so the layer stays silent until the intro releases it
  lastMusicCombatActive = true;
}

function updateBossIntro(rawDt) {
  bossIntro.t += rawDt;
  const boss = enemyManager.boss;
  const bossPos = boss ? boss.group.position : BOSS_INTRO_FALLBACK_POS;
  _biCamPos.set(bossPos.x + 5.5, bossPos.y + 4.4, bossPos.z + 8.5);
  _biLook.set(bossPos.x, bossPos.y + 2.6, bossPos.z);

  if (bossIntro.t < BOSS_INTRO_FLY) {
    const k = easeInOutQuad(Math.min(1, bossIntro.t / BOSS_INTRO_FLY));
    camera.position.lerpVectors(bossIntro.startPos, _biCamPos, k);
    camTarget.lerpVectors(bossIntro.startLook, _biLook, k);
    camera.lookAt(camTarget);
  } else if (bossIntro.t < BOSS_INTRO_FLY + BOSS_INTRO_HOLD) {
    if (!bossIntro.nameShown) {
      bossIntro.nameShown = true;
      ui.showBossNameCard(BOSS_INTRO_TITLE, BOSS_INTRO_NAME);
    }
    camera.position.copy(_biCamPos);
    camTarget.copy(_biLook);
    camera.lookAt(camTarget);
    // weapon show: axe raises, slams down, settles back to guard — Felix' "Boss macht Pose"
    const hk = (bossIntro.t - BOSS_INTRO_FLY) / BOSS_INTRO_HOLD; // 0..1 across the hold
    if (boss && boss.axeArm) {
      let rot;
      if (hk < 0.55) {
        const k = hk / 0.55;
        rot = -0.25 + (-2.35 - -0.25) * (1 - (1 - k) * (1 - k)); // ease-out raise
      } else if (hk < 0.85) {
        const k = (hk - 0.55) / 0.3;
        rot = -2.35 + (0.9 - -2.35) * (k * k * (3 - 2 * k)); // smoothstep slam
        if (k > 0.85 && !bossIntro.slamShook) {
          bossIntro.slamShook = true;
          combat.addShake(0.2); // the slam lands — sell it with a camera thud
        }
      } else {
        const k = (hk - 0.85) / 0.15;
        rot = 0.9 + (-0.25 - 0.9) * k; // settle back into the guard stance
      }
      boss.axeArm.rotation.x = rot;
      boss.group.rotation.x = hk < 0.85 ? -0.05 * Math.sin(hk * Math.PI) : 0;
    }
  } else if (bossIntro.t < BOSS_INTRO_TOTAL) {
    if (!bossIntro.snapStarted) {
      bossIntro.snapStarted = true;
      ui.hideLetterbox();
      ui.hideBossNameCard();
      music.resumeAmbient();
      // release the combat layer we held silent during the intro: the diff check
      // in tick() sees lastMusicCombatActive already true, so fire it explicitly
      music.setCombat(true, true);
    }
    // fast snap back onto the normal follow camera (boosted dt collapses the lerp
    // in ~2 frames — still eases rather than teleporting, so it reads as a snap-cut)
    updateCamera(rawDt * 6);
  } else {
    finishBossIntro();
  }
}

function finishBossIntro() {
  bossIntro.active = false;
  state.mode = 'playing';
  ui.showBossBar();
  ui.setBossHealth(1);
  ui.setWave('Boss Fight', enemyManager.aliveCount);
  banter.trigger('waveStart');
}

// ---------- victory sequence (Runde 9): slow-mo pose orbit before the win screen ----------
const VICTORY_DURATION = 3.0; // seconds — camera orbits player + Kai in their win pose
const victorySeq = { active: false, t: 0, center: new THREE.Vector3(), startAngle: 0 };

function startVictorySequence() {
  state.mode = 'victory';
  victorySeq.active = true;
  victorySeq.t = 0;
  victorySeq.center.set(
    (player.pos.x + kai.group.position.x) * 0.5,
    1.3,
    (player.pos.z + kai.group.position.z) * 0.5,
  );
  victorySeq.startAngle = Math.atan2(
    camera.position.x - victorySeq.center.x,
    camera.position.z - victorySeq.center.z,
  );
  ui.showVictoryBanner('Sieg');
  window.__slowMo?.(0.4, 0.5); // brief slow-mo into the pose, reuses the perfect-dodge system
}

function updateVictorySequence(rawDt) {
  victorySeq.t += rawDt;
  const k = Math.min(1, victorySeq.t / VICTORY_DURATION);
  const angle = victorySeq.startAngle + k * Math.PI * 0.7; // slow ~126° sweep around the pose
  const radius = 5.5;
  const height = 2.9 - k * 0.7; // gentle downward drift — a settling cinematic move
  camera.position.set(
    victorySeq.center.x + Math.sin(angle) * radius,
    victorySeq.center.y + height,
    victorySeq.center.z + Math.cos(angle) * radius,
  );
  camTarget.copy(victorySeq.center);
  camera.lookAt(camTarget);

  hero.update(rawDt, clock.elapsedTime, { speed: 0, grounded: true, victory: true });
  kai.update(rawDt, clock.elapsedTime, { speed: 0, grounded: true, victory: true });

  if (victorySeq.t >= VICTORY_DURATION) finishVictorySequence();
}

function finishVictorySequence() {
  victorySeq.active = false;
  ui.hideVictoryBanner();
  state.mode = 'win';
  const seconds = Math.round((performance.now() - state.startTime) / 1000);
  ui.hideBossBar();
  ui.showScreen('win', `${state.kills} marines defeated — ${seconds}s`);
}

// ---------- damage to player ----------
// The enemy API only hands us the strike's origin (melee: the enemy's own
// position, ranged: the tracer's impact point) — resolve it back to the
// nearest live, spawned enemy so the link strike has a real target.
function findAttacker(fromPos) {
  if (!fromPos) return null;
  let best = null;
  let bestD = Infinity;
  for (const e of enemyManager.enemies) {
    if (!e.alive || e.spawnT > 0) continue;
    const dx = e.group.position.x - fromPos.x;
    const dz = e.group.position.z - fromPos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

const _knockDir = new THREE.Vector3();
function damagePlayer(amount, fromPos) {
  if (state.mode !== 'playing' || state.invuln > 0) return;
  // dodge i-frames: the whole roll evades everything; a strike absorbed in the
  // opening window is a PERFECT dodge — hit-stop + slow-mo reward
  if (player.dodge.active) {
    // Koerperbau-Kopplung: kleine/flinke Builds bekommen ein etwas grosszuegigeres
    // Perfect-Dodge-Fenster (stats.dodge aus BODY_PRESETS, 0.9..1.2)
    const perfectWindow = PERFECT_WINDOW * (hero.stats?.dodge ?? 1);
    if (player.dodge.t < perfectWindow && !player.dodge.rewarded) {
      player.dodge.rewarded = true;
      window.__hitStop?.(180);
      window.__slowMo?.(0.35, 0.5);
      sfx.perfect();
      addOverdriveMeter(OVERDRIVE_GAIN_PERFECT);
      banter.trigger('perfectDodge');
      // FF15 link strike: Kai dashes the enemy whose attack was just evaded
      const attacker = findAttacker(fromPos);
      if (attacker) companion.linkStrike(attacker);
    }
    return;
  }
  // R18 Umbau: das Akt-2-Handgemenge nutzt das echte Kampfsystem, ist aber laut
  // Auftrag nicht toedlich — eingehender Marine-Schaden wird waehrend isBrawlActive()
  // stark reduziert (BRAWL_DAMAGE_MULT, episode.js), statt den Kampf eigens abzufangen.
  const dmgAmount = isBrawlActive() ? amount * BRAWL_DAMAGE_MULT : amount;
  state.hp -= dmgAmount;
  state.invuln = 0.35;
  sfx.hurt();
  ui.flashDamage();
  ui.setHealth(state.hp, PLAYER_MAX_HP);
  combat.addShake(0.18);
  if (state.hp / PLAYER_MAX_HP < 0.3) banter.trigger('lowHp');
  // knockback away from attacker
  _knockDir.set(player.pos.x - fromPos.x, 0, player.pos.z - fromPos.z).normalize();
  player.pos.addScaledVector(_knockDir, 0.7);
  if (state.hp <= 0) {
    endGame(false);
  }
}

// ---------- waves ----------
function currentWave() { return WAVES[state.waveIndex]; }

// enemies.js legt den Spawn-Fächer (3 Richtungen, 16–20 m) um einen Mittelpunkt. Der war
// früher fest der WELTURSPRUNG. Das war richtig, solange startGame() den Spieler auf
// (0,0,10) festnagelte — 10 m von der Mitte. Die Friedensphase löst ihn davon: am
// Wachturm steht er 30 m weiter nördlich. Dann spawnte ein Marine fast auf ihm und zwei
// liefen 40 m (20 s) an. Der Fächer bekommt deshalb einen ANKER, der zum Spieler wandert.
//
// Voriger Versuch und warum er falsch war: der fertige Fächer wurde NACH dem Spawn als
// Ganzes verschoben. Damit galt die Freiraum-Prüfung in enemies.js (_findSpawnPoint rollt
// jeden Punkt gegen die Kollider) für Punkte, an denen am Ende kein Marine stand — die
// Garantie war wertlos, ein Marine konnte im Haus landen. Der Kommentar behauptete, das
// Push-out repariere es "im selben Frame vor dem ersten composer.render()"; tatsächlich
// läuft enemyManager.update() in tick() VOR updateWaves()/updatePeace(), das Push-out also
// erst einen Frame später — der erste sichtbare Marine wurde im Haus gerendert und sprang
// danach heraus. Jetzt geht der Anker VORWÄRTS in die Suche: enemies.js prüft genau den
// Punkt, an dem der Marine wirklich stehen wird, und fällt auf den Ursprungsring zurück,
// wenn um den Anker nichts frei ist. Verschoben wird hinterher nichts mehr.
//
// Der Boss bleibt unangetastet: seine feste Position (0,-24) trägt den Kamera-Anflug
// aus startBossIntro() — startWave() ignoriert den Anker für Boss-Wellen.
const SPAWN_ANCHOR_MAX_R = WALK_RADIUS - 20; // 20 = SPAWN_RING_MAX: so bleibt JEDER Ringpunkt
                                             // an Land, auch wenn der Spieler am Strand steht
const SPAWN_RECENTER_MIN = 4;                // darunter lohnt das Verschieben nicht — der
                                             // Normalfall (Spieler am Dorfplatz) bleibt bitgleich
const _spawnAnchor = { x: 0, z: 0 };         // wiederverwendet: eine Wave-Start-Allokation weniger

function spawnAnchorForPlayer() {
  let ax = player.pos.x;
  let az = player.pos.z;
  const r = Math.hypot(ax, az);
  if (r > SPAWN_ANCHOR_MAX_R) { // Steg/Strand: Anker ins Inselinnere ziehen, nie ins Wasser
    ax *= SPAWN_ANCHOR_MAX_R / r;
    az *= SPAWN_ANCHOR_MAX_R / r;
  }
  if (Math.hypot(ax, az) < SPAWN_RECENTER_MIN) { ax = 0; az = 0; }
  _spawnAnchor.x = ax;
  _spawnAnchor.z = az;
  return _spawnAnchor;
}

function beginWave(index) {
  state.waveIndex = index;
  const wave = WAVES[index];
  arena.villagers.flee(); // Dorfbewohner rennen in die Häuser — und stehen im Kampf nicht im Weg
  const anchor = spawnAnchorForPlayer();
  enemyManager.startWave(index, anchor.x, anchor.z);
  if (wave.boss) {
    // presentation takes over from here: startBossIntro() shows the boss bar,
    // sets the wave label, and fires the waveStart banter once the intro ends
    startBossIntro();
  } else {
    banter.trigger('waveStart');
    ui.showBanner(wave.label, 'Marines incoming');
    ui.setWave(wave.label, enemyManager.aliveCount);
  }
}

function updateWaves(dt) {
  const wave = currentWave();
  ui.setWave(wave.boss ? 'Boss Fight' : wave.label, enemyManager.aliveCount);

  if (wave.boss && enemyManager.boss) {
    ui.setBossHealth(enemyManager.boss.hp / enemyManager.boss.maxHp);
  }

  if (wave.boss && enemyManager.aliveCount === 0) {
    endGame(true);
    return;
  }

  if (enemyManager.aliveCount === 0 && enemyManager.enemies.length === 0) {
    if (state.waveTransition <= 0) {
      state.waveTransition = 2.2;
      ui.showBanner('Wave Cleared', 'Recover and get ready');
    }
    state.waveTransition -= dt;
    if (state.waveTransition <= 0) {
      beginWave(state.waveIndex + 1);
    }
  }
}

// ---------- Friedensphase (Runde 15) ----------
// "Erst der Ort, dann der Plot": Ein Run beginnt jetzt RUHIG. Die Bewohner gehen ihrer
// Arbeit nach, kein Marine ist gespawnt, der Objective-Strip zeigt statt der Welle eine
// ruhige Zeile. Welle 1 startet auf genau zwei Wegen:
//   (a) der Spieler geht zum Wachturm und drückt dort E — bewusste Entscheidung, siehe
//       PEACE_PROMPT_R. Der Turmweg aus village.js endet 3,4 m vor dem Turm, das Angebot
//       steht also direkt am sichtbaren Wegende.
//   (b) nach PEACE_MAX_T Sekunden von selbst, sobald der Spieler in der Kampfzone steht.
const TOWER_POS = { x: 0, z: -30 }; // village.js: Wachturm-Kollider (radius 2.6) am Nordende

// Der Turm-Trigger war zuerst reine NÄHE. Das war der Fehler: startGame() setzt den Spieler
// mit yaw 0 ab — also mit Blick auf den Turm —, der Turmweg aus village.js läuft
// schnurgerade dorthin, und bei 8,5 m/s ist der Ring nach ~3,9 s erreicht. Wer einfach W
// hielt, beendete die Friedensphase, ohne je erfahren zu haben, dass der Turm sie beendet.
// Jetzt bietet der Turm den Start nur AN; auslösen muss der Spieler ihn mit E.
const PEACE_PROMPT_R = 8;       // m um die Turmmitte: ab hier steht das Angebot im HUD
const PEACE_PROMPT_EXIT_R = 10; // m — Hysterese, damit der Prompt an der Kante nicht flackert
// R22 Aufgabe C.2: 45 s waren mit der grossen R21-Insel zu knapp — Felix wurde beim
// Erkunden ueberfallen. 180 s ist ein Vorschlag (Felix urteilt); der Timeout greift
// ohnehin nur fuer Rueckkehrer-Runs (isDreamSet), Erstspieler wartet die Ruhephase
// weiterhin unbegrenzt (R18-Trigger-Fix unten). Dazu eine Kai-Vorwarnzeile
// PEACE_WARN_LEAD Sekunden vorher, damit der Angriff angekuendigt ist.
// R23: ?peacefast=1 ist ein reines TEST-Werkzeug (Muster ?callnow/?novillagers):
// staucht den Timeout auf 45 s, damit der Browser-Prüfstand die Patrouillen-
// Landung ohne 3-Minuten-Wartezeit fotografieren kann. Ohne Parameter: 180 s.
const PEACE_MAX_T = new URLSearchParams(location.search).has('peacefast') ? 45 : 180;
                                // s — Obergrenze; danach kommen die Marines von allein
const PEACE_WARN_LEAD = 20;     // s vor PEACE_MAX_T: Kais Vorwarnung + Patrouillen-Landung

// ---- Tempo-Boden der Friedensphase ----
// Das E allein reichte nicht. Gerechnet: Start (2.4, 10) -> Turmmitte (0,-30) = 40,07 m;
// auf der Laufgeraden nach Norden ist das Angebot (PEACE_PROMPT_R = 8 m) nach 32,37 m
// erreicht. Mit den 8,5 m/s der Kampf-Grundgeschwindigkeit sind das 3,81 s — wer W hält
// und E tippt, hätte die Friedensphase in 3,81 s hinter sich, also genau in der Dauer,
// gegen die sie gebaut wurde. Zwei Stellschrauben, KEINE Wartesperre:
//   1. Im Dorf wird GEGANGEN (PEACE_WALK_SPEED). 32,37 m / 4,0 m/s = 8,09 s statt 3,81 s.
//      Wer es eilig hat, schaltet mit R aufs Rennen und läuft die vollen 8,5 m/s — es
//      wird niemandem etwas weggenommen, der Standardweg ist nur nicht mehr der Sprint.
//   2. Das Angebot am Turm existiert erst ab PEACE_PROMPT_MIN_T, also NACH Kais Zeile,
//      die erklärt, was der Turm auslöst (PEACE_LINES[1], 5,5 s). Damit ist die alte
//      6-s-Untergrenze wieder da — aber als Inhalt statt als Sperre: der Gehende ist
//      erst nach 8,09 s am Turm und merkt nie etwas davon; nur der R-Renner steht
//      2,19 s am Turm, und in genau dieser Zeit läuft Kais Erklärung.
const PEACE_WALK_SPEED = 4.0;   // m/s Gehtempo im ruhigen Dorf (Kampfwert: PLAYER_BASE_SPEED)
const PEACE_PROMPT_MIN_T = 6;   // s — vorher gibt es am Turm kein Angebot (und E tut nichts)

// Gehtempo mit derselben Körperbau-Kopplung wie basePlayerSpeed() — ein Riese geht
// langsamer als ein Schmächtiger, sonst wäre die Friedensphase der einzige Ort, an dem
// der Körperbau nicht zählt.
function peaceWalkSpeed() {
  return PEACE_WALK_SPEED * (hero.stats?.speed ?? 1);
}

// ---- Renn-Umschalter: R, und zwar als TOGGLE, nicht als Halte-Taste ----
// Hier stand zuerst Strg. Das war ein Fehlgriff, der den Ausweg für Eilige komplett
// zerstört hätte: Strg+W (vorwärts rennen) SCHLIESST in Chrome/Edge/Firefox den Tab,
// und zwar unabfangbar — preventDefault greift bei reservierten Browser-Kürzeln nicht,
// und ohne Fullscreen/Keyboard-Lock (gibt es hier beides nicht) führt kein Weg daran
// vorbei. Strg+S (rückwärts), Strg+D (rechts) und Strg+A (links) öffnen Dialoge, die
// den Fokus stehlen: das keyup kommt nie an, keys[...] bleibt true, und der Spieler
// kehrt zu einer Figur zurück, die von allein seitwärts sprintet. Auf macOS ist
// Strg+Klick zusätzlich ein echter Rechtsklick — aus der Pistole würde die Bazooka.
// Warum kein Halten? Ein Halte-Modifier bräuchte eine bequeme Daumen-/Kleinfinger-Taste,
// aber alle sind vergeben oder reserviert: Shift = Ausweichrolle, Strg/Alt = Browser,
// Space = Sprung. R liegt zwar gut erreichbar über D — aber unter DEMSELBEN Zeigefinger,
// der D drückt: "R halten und seitwärts laufen" ginge nicht. Als Umschalter entfällt
// das Problem ganz, und ein hängengebliebener Tastenzustand kann gar nicht entstehen.
// R ist frei (belegt sind WASD, Space, Shift, Q, E, F) und hat für sich allein keine
// Browser-Bedeutung — nur Strg+R lädt neu, und Strg drückt hier niemand mehr.
// Der Zustand lebt in peace.run: beginPeace() setzt ihn zurück, endPeace() holt über
// basePlayerSpeed() ohnehin die Kampfwerte — der Kampf spürt von alldem nichts.
const PEACE_ALARM_LEAD = 1.2;   // s Alarm-Vorlauf vor beginWave(0), gezählt NACH dem Alarm-Beat
                                //   (der Countdown in updatePeace() läuft nur in state.mode
                                //   'playing', der Beat pausiert ihn also von selbst). Die alte
                                //   Aufgabe dieses Werts — das Alarm-Banner (2.2 s in ui.js) vor
                                //   dem Wellen-Banner auslesen lassen — übernimmt jetzt der Beat
                                //   selbst (ALARM_BEAT_TOTAL = 2.68 s > 2.2 s); der Rest-Vorlauf
                                //   gibt dem Spieler nach dem Kamera-Snap einen Moment zum
                                //   Neu-Orientieren, bevor der Spawn-Ring besetzt wird.

// Kais Zeilen für die Ruhe-Phase. Sie stehen hier statt in banter.js, weil banter.js in
// dieser Runde einem anderen Auftrag gehört; ui.setBanter() ist exakt der Kanal, den
// banter.init() selbst bespielt. Umzug später: LINES.peace + trigger('peace').
// Die Turm-Zeile (Index 1, 5,5 s) muss VOR dem Angebot stehen. Früher war das nur eine
// Hoffnung und rechnerisch falsch: die Ankunft lag bei 3,76 s, also 1,7 s VOR der Zeile.
// PEACE_PROMPT_MIN_T = 6 s macht die Reihenfolge jetzt hart — wer immer diese Liste
// umsortiert, muss die Turm-Zeile unter PEACE_PROMPT_MIN_T halten.
// Zeile 0 nennt die Renn-Taste, bevor irgendeine Strecke zurückgelegt ist.
const PEACE_LINES = [
  [1.6, 'Ruhig hier. Lass dir Zeit — R, wenn du rennen willst.'],
  [5.5, 'Am Wachturm im Norden rufst du sie her. Wann — das entscheidest du.'],
  [20, 'Sieh dich um. So bleibt das nicht.'],
  [33, 'Ich trau der Ruhe nicht.'],
];

// phase: 'calm' = Dorf in Ruhe | 'alarm' = Vorlauf, Bewohner fliehen | 'off' = Wellen laufen
// atTower: Spieler im Prompt-Radius (Hysterese) — nur dann wirkt E
// overdue: PEACE_MAX_T ist um, aber der Spieler steht außerhalb der Kampfzone (s. updatePeace)
// run: Renn-Umschalter (R). Jeder Run beginnt im Gehtempo.
// warned: R22 — die Vorwarnzeile (PEACE_WARN_LEAD) ist einmal pro Ruhephase gefallen
// recogT: R23 — Restzeit des Wiedererkennen-Beats (Patrouille zeigt auf Milo),
//         -1 = Beat noch nicht gestartet. Danach läuft endPeace('timeout') wie bisher.
const peace = { phase: 'off', t: 0, lineIdx: 0, alarmT: 0, atTower: false, overdue: false, run: false, warned: false, recogT: -1, recogLine2: false };
// R24 (Felix' R23-Feedback): das Wiedererkennen VERBINDET sich jetzt explizit
// mit der Verhaftungsszene — „wir haben dich doch eben schon beim Markt
// gesehen". Zwei Zeilen statt einer: die erste zitiert das Episoden-Banner
// („Trouble at the plaza") wörtlich, die zweite ruft ihn als den Jungen vom
// Markt aus. Der Beat dauert dafür zwei Zeilen lang.
const RECOG_HOLD = 4.4;   // s: beide Zeilen stehen, bevor der Alarm losgeht
const RECOG_LINE2_AT = 2.2; // s nach Beat-Start faellt die zweite Zeile

// ---------- Episode "The Arrest" (R18 Umbau v4) ----------
// episode.js besitzt seinen eigenen Zustand/DOM; main.js liefert nur Referenzen +
// Getter/Callbacks. hero ist ein "let" (Editor tauscht das Modell aus), daher
// getHero() statt einer eingefrorenen Referenz. enemyManager erlaubt episode.js,
// die beiden Handgemenge-Marines mit dem ECHTEN Kampfsystem zu spawnen/despawnen;
// setBanter/showBanner spiegeln nur ui.js, damit die Episode keine eigene HUD-Zeile
// braucht (Vignetten-Untertitel laufen ueber dieselbe Zeile wie Kais Banter).
initEpisode({
  scene,
  camera,
  player,
  getHero: () => hero,
  kai,
  enemyManager,
  isPlaying: () => state.mode === 'playing',
  isPeaceCalm: () => peace.phase === 'calm',
  exitPointerLock: () => document.exitPointerLock(),
  requestPointerLock: () => requestPointerLockSafe(),
  setBanter: (text) => ui.setBanter(text),
  showBanner: (text, sub) => ui.showBanner(text, sub),
  // R19 Inszenierung: Letterbox wie Boss-Intro/Alarm-Beat (Aufgabe A/B), geboosteter
  // Kamera-Ruecksprung im Muster von BOSS_INTRO_SNAP (dt*6 kollabiert die Follow-Lerp
  // in ~2 Frames — liest sich als Schnitt, teleportiert aber nicht), Officer-Pfiff
  // (Aufgabe D.3) und Boden-Check fuer den Ruf-Moment (Aufgabe A.3: der Schnitt darf
  // den Spieler nicht mitten im Sprung erwischen).
  showLetterbox: () => ui.showLetterbox(),
  hideLetterbox: () => ui.hideLetterbox(),
  snapCamera: (rawDt) => updateCamera(rawDt * 6),
  playWhistle: () => sfx.whistle(),
  isGrounded: () => player.grounded,
  // R23 Aufgabe C.2: die Verhaftungs-Schaulustigen kommen aus der belebten Welt —
  // die Episode borgt sichtbare Ambient-NPCs in Platznaehe und gibt sie beim
  // Pfiff zurueck (extras.js blendet sie weich in ihre Loops zurueck).
  borrowAmbient: (x, z, maxDist, count) => extras.borrow(x, z, maxDist, count),
  releaseAmbient: () => extras.release(),
});

// ---------- Hanami: Lichtung + Graswellen-Sequenz (Schritt 2, nur mit ?hanami) ----------
// Gleiches Muster wie initEpisode: das Modul besitzt seinen Zustand, main.js reicht
// nur Referenzen. Ohne ?hanami baut initHanami NICHTS und updateHanami returnt sofort.
initHanami({
  scene,
  player,
  setYaw: (v) => { yaw = v; },
  duckMusic: () => music.duckForIntro(), // Beat 1: der Synth-Soundtrack bricht ab
});

// ---------- Minimap + Quest-Tracker (R18 Aufgabe C) ----------
// HTML-Overlay (Canvas-2D, kein zweiter WebGL-Render) — main.js liefert nur
// Live-Getter, der Rest lebt in minimap.js. update() throttlet sich selbst auf
// 10 Hz; der Aufruf hier jeden Frame kostet ausserhalb des Throttle-Fensters
// nur den fruehen return in minimap.js.
// R23 Aufgabe B.3: getPois liefert die Entdeckungs-Orte fuer den Insel-Massstab
// des neuen Auto-Zooms (minimap.js zoomt draussen automatisch heraus).
const minimap = createMinimap({ getHero: () => hero, getQuestPos: () => getQuestTargetPos(), getQuest, getPois: () => discover.pois });

// ---- Der Zielstreifen nennt das ZIEL, nicht nur die Einladung (Runde 16) ----
// Vorher stand in der grossen Zeile der ORTSNAME ("Harbour Village") und darunter
// "Take a look around — [R] to run". Playtest-Befund von Felix, wörtlich: "Das mit dem
// E und lesen hab ich jetzt noch nicht gesehen, weiß nicht wo oder wie man das machen
// sollte." Und das stimmt: der Streifen lud ein, sagte aber nirgends WOHIN. Der einzige
// Hinweis war Kais Zeile bei 5,5 s (PEACE_LINES[1]) — die scrollt weg. Der [E]-Prompt
// selbst erscheint erst innerhalb von PEACE_PROMPT_R (8 m) um den Turm; er kann also
// nur BESTÄTIGEN, wenn man schon dort ist, und niemals hinführen.
// Jetzt trägt die grosse Zeile das Ziel und die kleine bleibt WÖRTLICH wie sie war —
// der ruhige Ton und die Anzeige des R-Umschalters ändern sich um kein Zeichen.
// Der Ortsname geht nicht verloren: beginPeace() zeigt ihn 2,2 s als Banner.
// "North" statt "vorn": der Kompass-Streifen sitzt in index.html direkt UNTER diesem
// Strip und hat N bei yaw 0 — genau der Blickrichtung beim Spawn. Eine Himmelsrichtung
// bleibt richtig, auch wenn der Spieler sich umdreht ("vorn" wäre dann gelogen), und
// sie deckt sich mit Kais Zeile "Am Wachturm im Norden".
const CALM_OBJECTIVE_TITLE = 'Watchtower — North';

// Die Ruhe-Zeile des Objective-Strips trägt den Zustand des Umschalters. Ein Toggle
// braucht eine sichtbare Anzeige — sonst weiß niemand, in welchem Modus er steckt.
// Der Strip ist dafür der richtige Ort: das Banner steht nur 2,2 s, und Kais Banter
// würde die getakteten PEACE_LINES überschreiben (die Turm-Zeile bei 5,5 s trägt die Regel).
function calmObjectiveSub() {
  // R21 Aufgabe A.3: der Strip nennt die Taste des zuletzt benutzten Geraets.
  // ui.setCalmObjective cached auf Textgleichheit — der Wechsel schreibt genau einmal.
  const runKey = lastInputDevice === 'pad' ? 'L3' : 'R';
  const base = peace.run ? `Running — [${runKey}] to walk` : `Take a look around — [${runKey}] to run`;
  // R23 Aufgabe B.5: stiller Strandgut-Zaehler — erscheint erst mit dem ersten
  // Fund und bleibt eine Randnotiz im Ruhe-Strip (kein Inventar-System).
  const flotsam = discover.flotsamLabel();
  return flotsam ? `${base} · ${flotsam}` : base;
}

// ---------- Alarm-Beat (Runde 15, Aufgabe B Punkt 3): die Flucht ins Bild holen ----------
// 10 der 11 Bewohner-Posten liegen bei z >= 6, der Turm bei z = -30. Wer dort [E]
// drückt, blickt nach Norden — und die Flucht, der einzige lesbare Beat des
// Übergangs, spielt 22 m hinter ihm. Deshalb übernimmt die Kamera den Alarm kurz:
// Flug auf eine erhöhte Position nördlich des Dorfplatzes, Blick nach Süden auf
// Brunnen (0.9, 7.6), Chat-Gruppe (-6, 12) und die Gassen zu den Haustüren, dann
// Snap zurück. Muster und Begründungen wie beim Boss-Intro: state.mode verlässt
// 'playing', also pausiert jeder Input-Handler von selbst; timer-getrieben, ein
// Restart kann nicht softlocken. arena.update() steht in tick() VOR der
// Modus-Weiche und läuft auch hier — die Bewohner rennen sichtbar, während die
// Kamera hinsieht. Der Beat feuert bei BEIDEN Auslösern (Turm und Zeitablauf):
// auch beim Timeout kann der Spieler vom Platz weg blicken.
const ALARM_BEAT_FLY = 0.9;   // s Kameraflug — länger als jede Schrecksekunde (max 0.62 s,
                              //   villagers.js startFlee): beim Eintreffen rennt bereits jeder
const ALARM_BEAT_HOLD = 1.5;  // s gehaltene Einstellung: der Platz stiebt auseinander
const ALARM_BEAT_SNAP = 0.28; // s Rücksprung, wie BOSS_INTRO_SNAP
const ALARM_BEAT_TOTAL = ALARM_BEAT_FLY + ALARM_BEAT_HOLD + ALARM_BEAT_SNAP;
const ALARM_BEAT_CAM = new THREE.Vector3(0, 7, -8);   // erhöht nördlich des Platzes
const ALARM_BEAT_LOOK = new THREE.Vector3(0, 1.1, 12); // Platzmitte auf Figurenhöhe
const alarmBeat = {
  t: 0,
  snapStarted: false,
  startPos: new THREE.Vector3(),
  startLook: new THREE.Vector3(),
};

function startAlarmBeat() {
  state.mode = 'alarmBeat';
  alarmBeat.t = 0;
  alarmBeat.snapStarted = false;
  alarmBeat.startPos.copy(camera.position);
  alarmBeat.startLook.copy(camTarget);
  ui.showLetterbox();
}

function updateAlarmBeat(rawDt) {
  alarmBeat.t += rawDt;
  if (alarmBeat.t < ALARM_BEAT_FLY) {
    const k = easeInOutQuad(Math.min(1, alarmBeat.t / ALARM_BEAT_FLY));
    camera.position.lerpVectors(alarmBeat.startPos, ALARM_BEAT_CAM, k);
    camTarget.lerpVectors(alarmBeat.startLook, ALARM_BEAT_LOOK, k);
    camera.lookAt(camTarget);
  } else if (alarmBeat.t < ALARM_BEAT_FLY + ALARM_BEAT_HOLD) {
    camera.position.copy(ALARM_BEAT_CAM);
    camTarget.copy(ALARM_BEAT_LOOK);
    camera.lookAt(camTarget);
  } else if (alarmBeat.t < ALARM_BEAT_TOTAL) {
    if (!alarmBeat.snapStarted) {
      alarmBeat.snapStarted = true;
      ui.hideLetterbox();
    }
    // schneller Rücksprung auf die Verfolgerkamera (geboostetes dt kollabiert die
    // Lerp in ~2 Frames — liest sich als Schnitt, teleportiert aber nicht)
    updateCamera(rawDt * 6);
  } else {
    state.mode = 'playing';
  }
}

function beginPeace() {
  peace.phase = 'calm';
  peace.t = 0;
  peace.lineIdx = 0;
  peace.alarmT = 0;
  peace.atTower = false;
  peace.overdue = false;
  peace.warned = false; // R22: Vorwarnzeile pro Ruhephase neu scharf
  peace.recogT = -1;    // R23: Wiedererkennen-Beat neu scharf
  peace.recogLine2 = false; // R24: zweite Wiedererkennen-Zeile neu scharf
  patrol.reset();       // R23: kein Patrouillen-Rest aus dem letzten Run
  peace.run = false; // Neustart beginnt im Gehtempo, nie im geerbten Renn-Modus
  player.speed = peaceWalkSpeed(); // im Dorf wird gegangen — endPeace() gibt die Kampfwerte zurück
  ui.setTowerPrompt(false);
  ui.setCalmObjective(CALM_OBJECTIVE_TITLE, calmObjectiveSub());
  ui.showBanner('Harbour Village', 'No marines in sight — yet');
}

// Der Übergang muss LESEN: Banner, Ping, Kampfmusik, Bewohner rennen los — und erst
// PEACE_ALARM_LEAD Sekunden später stehen die Marines auf dem Spawn-Ring.
function endPeace(reason) {
  peace.phase = 'alarm';
  peace.alarmT = PEACE_ALARM_LEAD;
  // Kampfwerte zurück: ab hier (schon im Vorlauf, nicht erst mit beginWave) läuft der
  // Spieler wieder mit der vollen Grundgeschwindigkeit. Das Gehtempo gilt AUSSCHLIESSLICH
  // in peace.phase === 'calm' — der Kampf fühlt sich exakt an wie vorher.
  player.speed = basePlayerSpeed();
  ui.setTowerPrompt(false);
  arena.villagers.flee(); // idempotent (villagers.js) — beginWave() ruft es gleich erneut
  extras.hide(); // R23: auch die Ambient-Statisten verschwinden hinterm Alarm-Beat
  patrol.clear(); // R23: die Lande-Statisten blenden aus — die ECHTEN Kampf-Marines
                  // spawnen gleich wie bisher aus beginWave/enemies.js (Auftrag D.4)
  // Die Sub-Zeile darf nur beschreiben, was WIRKLICH im Bild ist. Vorher stand hier
  // "Sails at the harbour mouth" bzw. "The lookout waves you off the tower": es gibt
  // weder Segel am Horizont (der Hafen hat ein Ruderboot) noch eine Figur auf dem Turm,
  // und hinaufgestiegen wird auch nicht. Was in genau diesem Moment sichtbar passiert,
  // ist arena.villagers.flee() eine Zeile höher — die Bewohner rennen zu ihren Türen.
  ui.showBanner('Marines sighted', reason === 'tower'
    ? 'Your call — the village runs for its doors'
    : 'Time is up — the village runs for its doors');
  ui.setBanter('Marines. Bleib in Bewegung.');
  // Der Strip darf im Vorlauf nicht weiter "sieh dich um" sagen; die Zahlen-Spalten
  // kommen erst mit dem ersten setWave() aus beginWave() zurück.
  ui.setCalmObjective('Marines inbound', 'Get ready');
  sfx.windup();          // tiefer Tick ("threat incoming", audio.js) — kein neuer Sound nötig
  combat.addShake(0.12); // ferner Dumpf, deutlich unter dem Treffer-Shake (0.18)
  music.setCombat(true);
  // wie beim Boss-Intro: den Kampf-Layer als "schon aktiv" markieren, sonst schaltet ihn
  // der Diff-Check in tick() sofort wieder ab (aliveCount ist im Vorlauf noch 0)
  lastMusicCombatActive = true;
  // Die Laufzeit auf Sieg-/Niederlage-Screen misst den Kampf, nicht das Zuschauen
  state.startTime = performance.now();
  // Zuletzt, weil startAlarmBeat() den state.mode wechselt und die Kamerapose als
  // Startpunkt einfriert — alles Sichtbare oben (Banner, Musik, flee()) steht dann.
  startAlarmBeat();
}

// läuft mit ECHTER Zeit (rawDt) — die Friedensphase kennt weder Hit-Stop noch Slow-Mo
function updatePeace(rawDt) {
  if (peace.phase === 'alarm') {
    peace.alarmT -= rawDt;
    if (peace.alarmT <= 0) {
      peace.phase = 'off';
      beginWave(0);
    }
    return;
  }
  peace.t += rawDt;
  // Gehen ist der Normalfall, R der Ausweg für Eilige. Pro Frame gesetzt, weil der
  // Umschalter jederzeit umspringen kann; beide Werte tragen dieselbe Körperbau-
  // Kopplung, sodass der Renn-Wert exakt der Kampfwert ist.
  player.speed = peace.run ? basePlayerSpeed() : peaceWalkSpeed();

  while (peace.lineIdx < PEACE_LINES.length && peace.t >= PEACE_LINES[peace.lineIdx][0]) {
    ui.setBanter(PEACE_LINES[peace.lineIdx][1]);
    peace.lineIdx++;
  }
  // Turm-Angebot mit Hysterese: innerhalb PROMPT_R an, erst jenseits von PROMPT_EXIT_R
  // wieder aus. Der Prompt ist nur Anzeige — gezündet wird in der E-Taste (keydown);
  // peace.atTower ist die EINE Wahrheit für beide, sichtbares Angebot = wirksame Taste.
  // Vor PEACE_PROMPT_MIN_T gibt es kein Angebot: die Regel (PEACE_LINES[1] bei 5,5 s)
  // steht damit garantiert vor der Entscheidung, statt nur meistens.
  const armed = peace.t >= PEACE_PROMPT_MIN_T;
  const dTower = Math.hypot(player.pos.x - TOWER_POS.x, player.pos.z - TOWER_POS.z);
  if (!armed) peace.atTower = false;
  else if (dTower <= PEACE_PROMPT_R) peace.atTower = true;
  else if (dTower > PEACE_PROMPT_EXIT_R) peace.atTower = false;
  ui.setTowerPrompt(peace.atTower); // gecacht: schreibt nur bei Wechsel

  // Zeitablauf-Trigger. Er darf NICHT feuern, während der Spieler außerhalb der Kampfzone
  // steht. spawnAnchorForPlayer() setzt den Fächer zwar auf den Spieler, klemmt den Anker
  // aber auf SPAWN_ANCHOR_MAX_R (34 m) — sonst spawnten Marines im Wasser. Der Steg ist
  // bis (14,71) begehbar, also 72 m draußen: dort bliebe der Fächer 38 m hinter dem
  // Spieler zurück und "Wave 1 — 3 Marines" stünde im HUD, während eine halbe Minute
  // lang niemand ankommt. Also: Ansage jetzt, Spawn erst zurück im Dorfkessel.
  const dHome = Math.hypot(player.pos.x, player.pos.z);
  // R18 Trigger-Fix (Felix' Bug, RUNDE18-EPISODE-DESIGN.md): solange die Episode nie
  // gespielt wurde (kein 'aod_dream'), pausiert der Overdue-Timer komplett — die
  // Ruhephase wartet auf den Spieler, statt die Episode nach 45s wegzuschneiden.
  // peace.t laeuft dabei einfach weiter (harmlos); der Turm-Start per E haengt nicht
  // an diesem Block und bleibt jederzeit moeglich.
  // R22 Aufgabe C.2: Kai kuendigt den Zeitablauf ~20 s vorher an, damit der Angriff
  // nicht mehr aus dem Nichts kommt. Nur fuer Rueckkehrer — Erstspieler hat keinen
  // Timeout (Block darunter), also waere die Drohung eine Luege.
  // R23 Aufgabe D: die Vorwarnung ist jetzt DIEGETISCH — zum selben Zeitpunkt,
  // an dem Kais Zeile fällt, legt sichtbar das Patrouillen-Boot am Steg an
  // (island/patrol.js) und die Marines marschieren die Hafenstraße hoch.
  // Kais Zeile zeigt DARAUF (Auftrag D.1) statt vage zu raunen.
  if (!peace.warned && isDreamSet() && peace.t >= PEACE_MAX_T - PEACE_WARN_LEAD) {
    peace.warned = true;
    patrol.begin();
    ui.setBanter('Da — am Steg. Marine. Die legen gerade an.');
  }
  if (peace.t >= PEACE_MAX_T && isDreamSet()) {
    if (dHome <= ARENA_RADIUS) {
      // R23 Aufgabe D.2: Wiedererkennen statt Willkür — die Patrouille dreht
      // sich zu Milo, die Zeile erklärt den Angriff (sie erkennen den Jungen
      // aus der Rauferei wieder), DANN läuft endPeace('timeout') wie bisher.
      // Sicherheitsnetz: fällt der Timeout OHNE gelaufene Vorwarnung (Episode
      // endet erst nach t>180 — Live-Befund), landet die Patrouille JETZT und
      // der Beat wartet, bis sie Milo wirklich sehen kann (canRecognize) —
      // sonst zeigte ein Marine vom Boot aus 100 m weit auf ihn.
      if (peace.recogT < 0) {
        if (!patrol.active) patrol.begin();
        if (!patrol.canRecognize(player.pos)) {
          ui.setCalmObjective('Marines ashore', 'A patrol is moving through the village');
          return;
        }
        peace.recogT = RECOG_HOLD;
        peace.recogLine2 = false;
        patrol.recognize();
        // R24: Zeile 1 verankert die Erinnerung — sie zitiert das Banner der
        // Verhaftungsszene („Trouble at the plaza") wörtlich.
        showWorldLine("Wait — I know that face. The trouble at the plaza… he was there.", 'Marine');
      }
      peace.recogT -= rawDt;
      // R24: Zeile 2 ruft ihn als den Jungen vom MARKT aus — Felix' Connection
      // („wir haben dich doch eben schon beim Markt gesehen").
      if (!peace.recogLine2 && peace.recogT <= RECOG_HOLD - RECOG_LINE2_AT) {
        peace.recogLine2 = true;
        showWorldLine("That's him! The boy from the market — the one who jumped the patrol!", 'Marine');
      }
      if (peace.recogT <= 0) { endPeace('timeout'); }
      return;
    }
    if (!peace.overdue) {
      peace.overdue = true;
      // R23: die Patrouille marschiert sichtbar zum Dorfkern und sucht dort —
      // Kais Zeile erklärt das Warten (Auftrag D.3), der Kampf startet weiter
      // erst, wenn der Spieler die Kampfzone erreicht (bestehende Logik).
      ui.setBanter('Zeit ist um. Die Patrouille sucht dich im Dorf.');
    }
    // Der Strip sagt jetzt, worauf es wartet — kein stilles Nichts.
    ui.setCalmObjective('Time is up', 'Head back to the village');
    return;
  }
  ui.setCalmObjective(CALM_OBJECTIVE_TITLE, calmObjectiveSub()); // gecacht: schreibt nur bei Wechsel
}

// ---------- game flow ----------
function startGame() {
  // drop focus from the clicked button so Space (jump) can't re-trigger it
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  setPaused(false); // nie pausiert in einen frischen Run starten
  sfx.resume(); // audio context needs this user gesture to start
  music.start();
  music.setCombat(false);
  music.resumeAmbient(); // defensive: never start a run with a ducked ambient pad
  lastMusicCombatActive = false;
  bossIntro.active = false;
  ui.hideLetterbox();
  ui.hideBossNameCard();
  victorySeq.active = false;
  ui.hideVictoryBanner();
  sparkCue.t = 0;
  if (dangerVignetteEl) dangerVignetteEl.style.opacity = '0';
  if (overdriveVignetteEl) overdriveVignetteEl.style.opacity = '0';
  enemyManager.clear();
  combat.reset();
  arena.villagers.reset(); // Dorf wieder bevölkert, bevor beginWave(0) sie verscheucht
  extras.show(); // R23: Ambient-Statisten zurück in ihre Loops
  state.mode = 'playing';
  state.hp = PLAYER_MAX_HP;
  state.kills = 0;
  state.waveTransition = 0;
  state.invuln = 0;
  state.overdrive = 0;
  state.overdriveActive = false;
  state.overdriveTimeLeft = 0;
  hero.setOverdrive(false);
  banter.reset();
  state.startTime = performance.now();
  player.pos.set(SPAWN_POS.x, 0, SPAWN_POS.z);
  player.vel.set(0, 0, 0);
  player.grounded = true;
  player.speed = basePlayerSpeed();
  player.dodge.active = false;
  player.dodge.t = 0;
  player.dodge.cd = 0;
  yaw = 0; // face the tower (-Z = Norden, deckt sich mit dem Kompass und CALM_OBJECTIVE_TITLE)
  pitch = -0.18;
  // Kai re-spawns at the player's flank, fresh and standing — jetzt an der WESTflanke.
  // Er steht relativ zum Spieler, wandert mit SPAWN_POS also mit: mit dem alten Versatz
  // (+2.5/+2.5) landete er auf (4.9, 12.5) und damit 0.20 m INNERHALB des Kisten-Kolliders
  // bei (5.83, 12.92) — er wäre im ersten Frame aus einer Kiste herausgeschoben worden.
  // Gespiegelt steht er auf (-0.1, 12.5) mit 4.07 m Luft zum nächsten Kollider (vorher
  // 2.14 m) und bleibt aus den Marktständen im Südosten heraus. Gleiche Seite wie der
  // Brunnen, also auch nicht in der Laufgasse des Spielers.
  kai.group.position.set(player.pos.x - 2.5, 0, player.pos.z + 2.5);
  kai.group.rotation.y = Math.PI; // face the tower like Hero
  companion.state.mode = 'idle';
  companion.state.hp = companion.state.maxHp;
  companion.state.target = null;
  ui.setCompanion('idle');
  ui.hideScreens();
  ui.hideBossBar();
  ui.setHealth(state.hp, PLAYER_MAX_HP);
  // Bisher setzte beginWave(0) den Index. Die Welle startet jetzt erst später —
  // ohne diese Zeile trüge ein Neustart nach dem Boss weiterhin waveIndex 3 durch
  // die Friedensphase (WAVES[3].boss = true).
  state.waveIndex = 0;
  beginPeace(); // statt beginWave(0): erst das Dorf, dann die Marines
  showLocationCard(); // R20 Aufgabe C.1: Orts-/Zeit-Karte nach dem Start-Banner
  requestPointerLockSafe();
}

// ---------- R20 Aufgabe C.1: Orts-Karte beim Spielstart (AC-Stil, dezent) ----------
// Erscheint NACH dem "Harbour Village"-Banner (2,2 s Standzeit in ui.js), haelt ~4,5 s
// und blendet aus. Reine DOM-Einblendung: kein Quest-Text, stoert das
// Entdeckungsfenster nicht (Auftrag C.1 — Texte sind Builder-Vorschlag, Felix redigiert).
const locationCardEl = document.getElementById('location-card');
let locCardT1 = 0, locCardT2 = 0;
function showLocationCard() {
  if (!locationCardEl) return;
  locationCardEl.querySelector('.loc-title').textContent = 'Malis — an island on the Still Sea';
  locationCardEl.querySelector('.loc-sub').textContent = 'Evening · the harbour village';
  clearTimeout(locCardT1);
  clearTimeout(locCardT2);
  locationCardEl.classList.remove('show');
  locCardT1 = setTimeout(() => locationCardEl.classList.add('show'), 2600);
  locCardT2 = setTimeout(() => locationCardEl.classList.remove('show'), 2600 + 4500);
}

function endGame(won) {
  setPaused(false); // Pause darf keinen Endbildschirm ueberdecken/festfrieren
  document.exitPointerLock();
  // Overdrive can still be mid-buff when the fight ends — clear every side effect
  // (aura, vignette, speed, combat multipliers) so the aftermath isn't tinted red.
  state.overdriveActive = false;
  hero.setOverdrive(false);
  combat.overdriveActive = false;
  player.speed = basePlayerSpeed();
  if (overdriveVignetteEl) overdriveVignetteEl.style.opacity = '0';
  // a mid-swing gatling burst must not bleed hits/sfx into the victory orbit
  combat.attack = null;

  if (!won) {
    state.mode = 'lose';
    const seconds = Math.round((performance.now() - state.startTime) / 1000);
    ui.hideBossBar();
    ui.showScreen('lose', `${state.kills} marines defeated — ${seconds}s`);
    return;
  }
  // won: run the pose-orbit presentation first — startVictorySequence() shows
  // the win screen itself once it finishes (finishVictorySequence())
  // Die Bewohner kommen währenddessen gestaffelt aus den Türen zurück.
  arena.villagers.returnHome();
  extras.show(); // R23: die Statisten kehren mit den Bewohnern zurück
  banter.trigger('victory');
  startVictorySequence();
}

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-restart-win').addEventListener('click', startGame);
document.getElementById('btn-restart-lose').addEventListener('click', startGame);

// R18-Reparatur (Felix' Spaettest 14.08.): wer "The Levy"/"The Arrest" je beendet
// hat, traegt aod_dream im localStorage — die Episode zeigt dann NICHTS mehr, und
// ?resetdream=1 kennt kein Spieler. Der Knopf erscheint nur fuer solche Rueckkehrer,
// loescht Traum + Episoden-Flags (resetDream, episode.js) und startet direkt neu.
const btnNewJourney = document.getElementById('btn-new-journey');
// R22 Aufgabe C.1: Rueckkehrer mit gesetztem Traum uebersahen, dass "Enter the
// Arena" die Story ueberspringt (Felix' Stolperstein R21). Fuer sie wird "New
// Journey" der PRIMAERE Knopf (rueckt nach oben, verliert .secondary), der
// Start-Knopf heisst ehrlich "Free Play", und eine Kontextzeile erklaert beides.
// Keine neue Menue-Architektur — nur Reihenfolge, Label und eine Textzeile.
const btnStartEl = document.getElementById('btn-start');
const returningNoteEl = document.getElementById('menu-returning-note');
function applyMenuMode() {
  const returning = isDreamSet();
  btnNewJourney.classList.toggle('hidden', !returning);
  returningNoteEl?.classList.toggle('hidden', !returning);
  if (returning) {
    btnNewJourney.classList.remove('secondary');
    btnStartEl.classList.add('secondary');
    btnStartEl.textContent = 'Free Play — skip the story';
    btnStartEl.parentNode.insertBefore(btnNewJourney, btnStartEl); // New Journey steht oben
  } else {
    btnStartEl.classList.remove('secondary');
    btnStartEl.textContent = 'Enter the Arena';
  }
}
applyMenuMode();
btnNewJourney.addEventListener('click', () => {
  resetDream();
  applyMenuMode(); // Traum ist geloescht — Menue zurueck in den Erstspieler-Zustand
  startGame();
});

// ---------- loop ----------
let lastMusicCombatActive = false; // tracks wave state so music.setCombat() only fires on change
const clock = new THREE.Clock();
const enemyApi = {
  damagePlayer,
  // Fleisch-Pickups + Ruhe-Regeneration heilen wirklich (R13-Kritik #5)
  healPlayer: (amount) => {
    if (state.mode !== 'playing' || state.hp <= 0) return;
    state.hp = Math.min(PLAYER_MAX_HP, state.hp + amount);
    ui.setHealth(state.hp, PLAYER_MAX_HP);
  },
  onEnemyAttackSwing: (e) => {
    if (e.isBoss) combat.addShake(0.1);
  },
  onWindupStart: () => sfx.windup(),   // soft tick: "threat incoming"
  onDangerWindow: () => triggerDangerCue(), // danger spark + vignette + ping: "dodge NOW"
};

// Ausweich-Punkte der Dorfbewohner: Spieler, Kai und lebende Marines. Kai steht an
// der Spielerflanke und die Marines spawnen, während die Flucht noch läuft — ohne
// diese Liste liefen die Bewohner durch beide hindurch. Das Array wird
// wiederverwendet und pro Frame nur neu befüllt (es wächst einmal auf die größte je
// gebrauchte Länge); die Bewohner lesen es, statt sich jeder eine eigene zu bauen.
const villagerAvoid = { pts: [], n: 0 };
function collectAvoidPoints() {
  let n = 0;
  villagerAvoid.pts[n++] = hero.group.position;
  villagerAvoid.pts[n++] = kai.group.position;
  for (const e of enemyManager.enemies) {
    if (e.alive) villagerAvoid.pts[n++] = e.group.position;
  }
  villagerAvoid.n = n;
}

function tick() {
  requestAnimationFrame(tick);
  perf.tickStart(); // trennt Spiellogik von Rendern in der Messung
  const rawDt = Math.min(clock.getDelta(), 0.05);
  // Gamepad VOR der Pause-Weiche und VOR den Modus-Zweigen: die API ist Polling-only,
  // und Start (Pause aufheben) / A (Menue-Knopf) muessen auch dann ankommen, wenn
  // darunter nichts mehr laeuft.
  pollGamepad(rawDt);
  if (paused) { renderFrame(); return; }
  const dt = rawDt * hitStopTimeScale(rawDt) * slowMoTimeScale(rawDt); // hit-stop + slow-mo scale gameplay time
  const t = clock.elapsedTime;
  gradePass.uniforms.uTime.value = t % 32; // wrap: keeps grain hash precision stable
  updateFovKick(rawDt);
  banter.update(rawDt); // real time: cooldown stays steady through hit-stop/slow-mo

  // hero.group.position statt player.pos: das ist der sichtbare Körper, an dem die
  // Bewohner vorbeitreten. camPos steuert deren Distanz-Abstufung (auch im Menü-Orbit).
  collectAvoidPoints();
  arena.update(dt, t, hero.group.position, camera.position, villagerAvoid);

  if (state.mode === 'playing') {
    // R18 Umbau "The Arrest" (v4): nur die inszenierten Beats (Establish, Brunnen-
    // Dialog, Tat-Sequenz, Karte — isEpisodeCutscene()) uebernehmen Kamera/Spieler-
    // position komplett. Waehrend der Vignetten UND des Handgemenges (Akt 2) behaelt
    // der Spieler volle Kontrolle: updatePlayer/combat/enemyManager/companion laufen
    // normal weiter, das Handgemenge nutzt das ECHTE Kampfsystem. episode.update()
    // selbst laeuft immer, sonst koennte sich die Episode nie beenden. sim/run.mjs
    // kennt state.mode/isEpisodeCutscene() gar nicht (eigene Welt, siehe episode.js-
    // Kopfkommentar), bleibt also unberuehrt.
    const inEpisode = isEpisodeCutscene();
    state.invuln = Math.max(0, state.invuln - dt);
    if (!inEpisode) {
      updatePlayer(dt);
      // Messfahrt/Schusspose ueberschreibt die Spielerposition NACH der Physik: die
      // Route ist damit zeitparametrisiert und in jedem Build bitgleich dieselbe.
      perf.drive();
      combat.update(dt, t);
      enemyManager.update(dt, t, player.pos, enemyApi);
      companion.update(dt, t); // drives Kai's AI + animation (calls kai.update itself)
      ui.setCompanion(companion.state.mode);
      // Friedensphase/Alarm-Vorlauf: updateWaves() darf hier NICHT laufen. Ohne gestartete
      // Welle sind aliveCount UND enemies.length beide 0 — genau das liest updateWaves als
      // "Welle geschafft" und würde nach 2,2 s auf Welle 2 springen.
      if (peace.phase === 'off') updateWaves(dt);
      else updatePeace(rawDt);
      // R23: Strandgut-Prompt — nur in der Ruhephase (im Kampf gibt es kein
      // Sammel-Angebot; sichtbares Angebot = wirksame Taste, s. interactPressed)
      discover.update(rawDt, player.pos, peace.phase === 'calm');
      ui.setCooldowns(combat.cooldowns);
    }
    updateOverdrive(rawDt); // real time: buff duration/heartbeat stay steady through hit-stop/slow-mo
    ui.setOverdrive(
      state.overdrive / OVERDRIVE_MAX,
      state.overdrive >= OVERDRIVE_MAX && !state.overdriveActive,
      state.overdriveActive,
      state.overdriveTimeLeft / OVERDRIVE_DURATION,
    );
    if (overdriveVignetteEl) overdriveVignetteEl.style.opacity = state.overdriveActive ? '0.22' : '0';
    // combat music layer: mixes in while a wave has live enemies, boss = fast tempo.
    // In Friedensphase und Alarm-Vorlauf ausgesetzt: dort steuert endPeace() die Musik,
    // und aliveCount ist noch 0 — der Diff-Check würde den Kampf-Layer sofort abwürgen.
    if (!inEpisode && peace.phase === 'off') {
      const combatActive = enemyManager.aliveCount > 0;
      if (combatActive !== lastMusicCombatActive) {
        lastMusicCombatActive = combatActive;
        music.setCombat(combatActive, !!WAVES[state.waveIndex]?.boss);
      }
    }
    if (!inEpisode) updateCamera(rawDt); // camera tracks in real time — stays smooth through hit-stop
    updateEpisode(rawDt); // real time, wie Boss-Intro/Alarm-Beat — laeuft auch waehrend inEpisode
    updateHanami(rawDt);  // real time — die Graswelle haengt ohnehin an der Musikuhr
  } else if (state.mode === 'menu') {
    // slow orbit showcase behind the start screen — weiter draußen und höher,
    // damit die ganze Insel (Dorf, Wege, Steg + Ruderboot) im Bild ist (R13)
    const a = t * 0.12;
    camera.position.set(Math.sin(a) * 36, 14, Math.cos(a) * 36);
    camera.lookAt(0, 1.5, 0);
    hero.update(dt, t, { speed: 0, grounded: true });
    companion.update(dt, t); // idle sway in the menu showcase
    renderFrame();
    return;
  } else if (state.mode === 'bossIntro') {
    // world frozen (no enemyManager/combat/companion update) — input already
    // paused since every handler gates on state.mode === 'playing'
    updateBossIntro(rawDt);
  } else if (state.mode === 'alarmBeat') {
    // Spieler/Kai/Gegner stehen wie im Boss-Intro (es lebt ohnehin kein Gegner);
    // die Flucht selbst treibt arena.update() weiter oben. updatePeace() läuft
    // nicht — der Alarm-Countdown pausiert, die Marines kommen erst nach dem Snap.
    updateAlarmBeat(rawDt);
  } else if (state.mode === 'victory') {
    // let remaining ragdolls/particles settle while the pose-orbit camera runs
    combat.update(dt, t);
    enemyManager.update(dt, t, player.pos, enemyApi);
    updateVictorySequence(rawDt);
  } else {
    // win/lose: keep world rendering, gentle camera drift
    combat.update(dt, t);
    enemyManager.update(dt, t, player.pos, enemyApi);
    companion.update(dt, t);
    updateCamera(rawDt); // camera tracks in real time — stays smooth through hit-stop
  }

  updateGhosts(rawDt); // ghosts fade in real time so the streak reads through slow-mo
  updateDangerCue(rawDt); // danger spark + danger vignette fade in real time
  minimap.update(rawDt); // HTML-Overlay, throttlet sich selbst auf 10 Hz (minimap.js)
  renderFrame();
}

// Einziger Renderpfad, damit die GPU-Timer-Query genau das Bild umschliesst, das
// auch gezeigt wird. Ohne ?perf sind begin/end leere Funktionen.
function renderFrame() {
  perf.begin();
  composer.render();
  perf.end();
}

// ---------- Messsonde (nur mit ?perf / ?shot aktiv) ----------
const perf = createPerf({
  renderer,
  scene,
  camera,
  composer,
  passes: { bloom: bloomPass, grade: gradeControl },
  player,
  setYaw: (v) => { yaw = v; },
  setPitch: (v) => { pitch = v; },
});
perf.applyAblations();

ui.showScreen('start');
// Kein synchrones tick() beim Boot: der erste composer.render() kompiliert
// saemtliche Shader (Arena, Schatten, Bloom) in einem Block und haengt die
// Seite sekundenlang VOR dem Start-Screen. Stattdessen: Screen sofort zeigen,
// Shader asynchron vorkompilieren (KHR_parallel_shader_compile), dann Loop.
renderer.compileAsync(scene, camera)
  .catch(() => { /* Vorkompilieren ist nur Komfort — der erste Frame macht es sonst */ })
  .finally(() => {
    // Boot-Charakter erst jetzt tauschen — Begründung bei applyBootCharacter()
    applyBootCharacter();
    if (PERF_ACTIVE) {
      // Kein Klick, kein Startbildschirm: der Messlauf soll ohne Hand starten und
      // in jedem Durchgang zur selben Sekunde im selben Zustand sein.
      // HUD bleibt sichtbar — gemessen wird das Spiel, wie es wirklich laeuft.
      startGame();
    }
    requestAnimationFrame(tick);
  });
