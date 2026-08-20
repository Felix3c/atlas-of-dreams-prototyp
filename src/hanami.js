// hanami.js — Hanami, der Blütenkaiser: Lichtung + Graswellen-Sequenz (Schritt 2).
// Eigenes Modul nach dem Episoden-Muster (init/update/isActive), KEINE Erweiterung
// von episode.js (Design-Doc §7). Die Bilduhr hängt an der Musikuhr aus music.js:
// jeder Halm kennt nur seinen Abstand zum Zentrum, pro Frame wird aus der
// Abspielposition der Wellenradius berechnet — es gibt keinen zweiten Timer,
// der gegen die Musik driften könnte (Seek in der Musik = Seek im Bild).
//
// Test-Zugang (Design-Doc §3: "Test-Zugang reicht für den Bau"): nur mit ?hanami
// in der URL wird überhaupt etwas gebaut; das Spiel teleportiert den Spieler beim
// Start vor die Lichtung. Ohne den Parameter ist jedes update() ein früher return
// und die Szene bekommt kein einziges neues Objekt — Perf-Baseline unberührt.
// Später ersetzt die Such-Quest auf der großen Insel diesen Zugang.
import * as THREE from 'three';
import { MusicTrack } from './music.js';
import { groundHeightAt } from './arena.js';

// ---------- Stellschrauben (Felix: hier drehen, kein weiterer Code nötig) ----------
// Die Lichtung liegt im Umland-Ring: Richtung Süd-Südost (θ≈2.5), r≈87 — sicher
// außerhalb des Hafen-Sektors, beider Buchten und der beiden Hügel (arena.js).
// Geprüft gegen den Bestand: die Ruine (discover.js, 28/-78) liegt 25.3 m vom
// Zentrum = knapp AUSSERHALB von r 24; die Kante (87+24=111) bleibt unter der
// begehbaren Küste (EXPLORE_RADIUS 120). Der Rundweg Ruine->Ost-Bucht kreuzt die
// Wiese — seine Trittspur-Decals (+0.03) verschwinden unter ihr (+0.05), bewusst
// hingenommen: die Lichtung zieht ohnehin auf die große Insel um (Design-Doc §3).
const CLEARING = { x: 52, z: -70, r: 24 };  // Zentrum + Radius der Lichtung
const TRIGGER_R = 30;      // m Abstand zum Zentrum, ab dem die Sequenz zündet
const BLADES = 640;        // Anzahl Grastürme (ein InstancedMesh, ein Draw-Call)
const TOWER_MIN = 15;      // m — kleinster ausgewachsener Turm
const TOWER_MAX = 26;      // m — größter ("ragen über die Kamera hinaus")
const GROW_S = 1.7;        // s, die ein Halm vom Boden bis zur vollen Höhe braucht
const SWAY = 0.045;        // rad — sanftes Wiegen der ausgewachsenen Türme

// Cue-Fallbacks, falls die Cue-Datei mal keine Turm-Marken enthält
const FALLBACK_START = 4.2;
const FALLBACK_PEAK = 6.0;

// Deterministischer Zufall (mulberry32): dieselbe Lichtung bei jedem Laden —
// Screenshots aus der Verifikation bleiben vergleichbar (Sim-Disziplin, obwohl
// dieses Modul nie in der Sim läuft).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth01(v) {
  const k = Math.max(0, Math.min(1, v));
  return k * k * (3 - 2 * k);
}

// ---------- Modul-Zustand ----------
let S = null; // null = inaktiv (kein ?hanami) — jedes update() kehrt sofort zurück

export function isHanamiActive() {
  return !!S && S.phase !== 'idle';
}

export function initHanami({ scene, player, setYaw, duckMusic }) {
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('hanami')) return;

  const rnd = mulberry32(19940815);
  const cx = CLEARING.x, cz = CLEARING.z;

  // ---- die Lichtung selbst: grün und freundlich, BEVOR er sie berührt (§3) ----
  // Wiesen-Scheibe als Gitter auf dem Relief (Muster: lampGlow-Patches in arena.js —
  // eine flache Scheibe würde vom ±1m-Umland-Relief durchstoßen).
  {
    const SEG = 24;
    const verts = new Float32Array((SEG + 1) * (SEG + 1) * 3);
    const idx = [];
    let pi = 0;
    for (let iy = 0; iy <= SEG; iy++) {
      for (let ix = 0; ix <= SEG; ix++) {
        const wx = cx + (ix / SEG - 0.5) * 2 * CLEARING.r;
        const wz = cz + (iy / SEG - 0.5) * 2 * CLEARING.r;
        verts[pi++] = wx;
        verts[pi++] = groundHeightAt(wx, wz) + 0.05;
        verts[pi++] = wz;
      }
    }
    for (let iy = 0; iy < SEG; iy++) {
      for (let ix = 0; ix < SEG; ix++) {
        const a = iy * (SEG + 1) + ix, b = a + 1, c = a + (SEG + 1), d = c + 1;
        // nur Zellen innerhalb des Kreises — die Ecken des Quadrats bleiben leer
        const mx = cx + ((ix + 0.5) / SEG - 0.5) * 2 * CLEARING.r;
        const mz = cz + ((iy + 0.5) / SEG - 0.5) * 2 * CLEARING.r;
        if (Math.hypot(mx - cx, mz - cz) > CLEARING.r) continue;
        idx.push(a, c, b, b, c, d);
      }
    }
    const meadowGeo = new THREE.BufferGeometry();
    meadowGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    meadowGeo.setIndex(idx);
    meadowGeo.computeVertexNormals();
    const meadow = new THREE.Mesh(meadowGeo, new THREE.MeshStandardMaterial({
      color: 0x5d9a4a, roughness: 1.0,
      polygonOffset: true, polygonOffsetFactor: -1,
    }));
    meadow.receiveShadow = true;
    scene.add(meadow);
  }

  // ---- ruhendes Wiesengras: kniehohe Büschel, statisch (ein InstancedMesh) ----
  const bladeGeo = new THREE.ConeGeometry(0.38, 1, 5);
  bladeGeo.translate(0, 0.5, 0); // Fußpunkt bei y=0 — scale.y IST die Halmhöhe
  {
    const TUFTS = 260;
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0x4d8a3e, roughness: 0.95 });
    const tufts = new THREE.InstancedMesh(bladeGeo, tuftMat, TUFTS);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < TUFTS; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (CLEARING.r - 1);
      const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
      const h = 0.25 + rnd() * 0.4;
      e.set((rnd() - 0.5) * 0.35, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.35);
      q.setFromEuler(e);
      m4.compose(
        new THREE.Vector3(px, groundHeightAt(px, pz), pz),
        q, new THREE.Vector3(0.5 + rnd() * 0.4, h, 0.5 + rnd() * 0.4),
      );
      tufts.setMatrixAt(i, m4);
    }
    scene.add(tufts);
  }

  // ---- die Grastürme: schlafend bei Höhe 0, geweckt von der Welle ----
  // Drei Grüntöne über instanceColor, damit die Wand nicht wie EIN Klotz liest.
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const towers = new THREE.InstancedMesh(bladeGeo, towerMat, BLADES);
  towers.frustumCulled = false; // Instanzen wachsen zur Laufzeit — Bounding-Sphere lügt
  const palette = [new THREE.Color(0x4f8f3c), new THREE.Color(0x63a84b), new THREE.Color(0x3f7a38)];
  const blades = []; // {x, z, y0, dist, maxH, girth, phase, tiltA}
  {
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < BLADES; i++) {
      const a = rnd() * Math.PI * 2;
      // sqrt-Verteilung = gleichmäßige Flächendichte; innerster Meter bleibt frei
      // (dort steht später Hanami selbst)
      const r = 1.5 + Math.sqrt(rnd()) * (CLEARING.r - 2.5);
      const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
      blades.push({
        x: px, z: pz, y0: groundHeightAt(px, pz), dist: r,
        maxH: TOWER_MIN + rnd() * (TOWER_MAX - TOWER_MIN),
        girth: 0.8 + rnd() * 1.1,
        phase: rnd() * Math.PI * 2,
        tiltA: rnd() * Math.PI * 2,
      });
      m4.makeScale(1, 0.0001, 1); // schlafend — unsichtbar flach
      m4.setPosition(px, blades[i].y0, pz);
      towers.setMatrixAt(i, m4);
      towers.setColorAt(i, palette[i % palette.length]);
    }
    towers.instanceColor.needsUpdate = true;
    scene.add(towers);
  }

  S = {
    scene, player, setYaw, duckMusic,
    towers, blades,
    phase: 'idle',        // idle -> waiting (teleportiert) -> playing (Sequenz läuft)
    teleported: false,
    track: null,
    audioCtx: null,
    cueStart: FALLBACK_START,
    cuePeak: FALLBACK_PEAK,
    t: 0,                 // Weltzeit fürs Wiegen
    _m4: new THREE.Matrix4(),
    _q: new THREE.Quaternion(),
    _e: new THREE.Euler(),
    _v: new THREE.Vector3(),
    _s: new THREE.Vector3(),
  };

  // Musik + Cues asynchron laden; die Sequenz startet erst beim Betreten der
  // Lichtung — bis dahin ist die Datei da (2:22-WAV lädt in Sekundenbruchteilen).
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    S.audioCtx = new AC();
    MusicTrack.load('music/hanami-cues.json', S.audioCtx).then((track) => {
      if (!S) return;
      S.track = track;
      const find = (name, fb) => {
        const c = track.cues.find((c) => c.name === name);
        return c ? c.time : fb;
      };
      S.cueStart = find('tuerme_start', FALLBACK_START);
      S.cuePeak = find('tuerme_peak', FALLBACK_PEAK);
    }).catch((err) => console.warn('hanami: Cues nicht ladbar —', err.message));
  }

  // Prüfstand-Fenster: nur hinter ?hanami erreichbar — die Verifikation liest
  // hierüber Musikzeit und Halmhöhen aus, statt Screenshots zu raten.
  window.__hanami = S;

  // Prüfstand-Taste: H startet die Sequenz neu (Musik auf 0, Türme schlafen wieder)
  window.addEventListener('keydown', (ev) => {
    if (ev.code !== 'KeyH' || !S || S.phase === 'idle') return;
    if (S.track) S.track.seek(0);
    S.phase = 'waiting';
  });
}

// Höhenverlauf eines geweckten Halms: k 0..1 seit Wellendurchgang.
// Quadratischer Anlauf = erst knöchelhoch, dann zieht er durch; kleines
// Überschwingen am Ende, damit das Wachsen "schnappt" statt auszurollen.
function growCurve(k) {
  if (k >= 1) return 1;
  const g = k * k * (3 - 2 * k);       // smoothstep: träger Start, träges Ende
  const over = Math.sin(k * Math.PI) * 0.06 * k; // Überschwinger, wächst mit k
  return g + over;
}

export function updateHanami(rawDt) {
  if (!S) return;
  S.t += rawDt;

  // Einmalig nach Spielstart: vor die Lichtung stellen, Blick aufs Zentrum
  if (!S.teleported) {
    S.teleported = true;
    const d = Math.hypot(CLEARING.x, CLEARING.z);
    const spawnR = d - CLEARING.r - 14; // 14 m vor dem Lichtungsrand
    const px = (CLEARING.x / d) * spawnR, pz = (CLEARING.z / d) * spawnR;
    S.player.pos.set(px, groundHeightAt(px, pz), pz);
    // updateCamera blickt Richtung (-sin yaw, -cos yaw) — auf das Zentrum drehen
    S.setYaw(Math.atan2(-(CLEARING.x - px), -(CLEARING.z - pz)));
    S.phase = 'waiting';
  }

  if (S.phase === 'waiting') {
    const pd = Math.hypot(S.player.pos.x - CLEARING.x, S.player.pos.z - CLEARING.z);
    if (pd < TRIGGER_R) {
      S.phase = 'playing';
      if (S.duckMusic) S.duckMusic(); // Beat 1: die laufende Musik bricht ab (§4)
      if (S.audioCtx && S.audioCtx.state === 'suspended') S.audioCtx.resume();
      if (S.track) S.track.play(0);
    }
  }

  if (S.phase !== 'playing') return;
  if (S.track) S.track.update();

  // Wo ist die Musik? Daraus den Wellenradius ableiten. Ohne geladene Cues
  // läuft die Fallback-Uhr über S.t weiter — Sequenz bleibt testbar ohne Ton.
  const mt = S.track ? S.track.time : S.t;
  const front = smooth01((mt - S.cueStart) / (S.cuePeak - S.cueStart)) * (CLEARING.r + 2);
  // Wellengeschwindigkeit rückwärts aus dem Frontverlauf: ein Halm bei dist d
  // wurde überrollt, als front == d war — seither vergangene Zeit steuert growCurve.
  const span = S.cuePeak - S.cueStart;

  const { _m4: m4, _q: q, _e: e, _s: s } = S;
  for (let i = 0; i < S.blades.length; i++) {
    const b = S.blades[i];
    let h = 0.0001;
    if (front > b.dist) {
      // Zeitpunkt des Wellendurchgangs an diesem Halm (Umkehrung von smooth01 wäre
      // teuer — die lineare Näherung dist/maxR*span reicht: der Fehler verschiebt
      // nur den Startmoment um Millisekunden, nie das Endbild).
      const tPass = S.cueStart + (b.dist / (CLEARING.r + 2)) * span;
      const k = Math.min(1, Math.max(0, (mt - tPass) / GROW_S));
      h = Math.max(0.0001, b.maxH * growCurve(k));
      // knöchelhoher Sockel direkt an der Front: die ersten 15 cm sofort,
      // damit die Welle als sichtbare Kante über den Boden läuft
      if (k > 0 && h < 0.15) h = 0.15;
    }
    const grown = h / b.maxH;
    e.set(
      Math.cos(b.tiltA) * SWAY * grown * Math.sin(S.t * 0.7 + b.phase),
      b.phase,
      Math.sin(b.tiltA) * SWAY * grown * Math.sin(S.t * 0.6 + b.phase * 1.3),
    );
    q.setFromEuler(e);
    m4.compose(
      S._v.set(b.x, b.y0, b.z),
      q,
      s.set(b.girth * (0.35 + 0.65 * grown), h, b.girth * (0.35 + 0.65 * grown)),
    );
    S.towers.setMatrixAt(i, m4);
  }
  S.towers.instanceMatrix.needsUpdate = true;
}
