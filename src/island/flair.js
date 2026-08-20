// island/flair.js — R22 Aufgabe A: "Die Insel lebt" (Felix' Kernpunkt aus dem
// R21-Playtest: World Design entscheidet, wie lange man bleibt — die erste Insel
// soll East-Blue-Gefühl haben, nicht Wüste; Kapitel-1-Maßstab, kein Vergnügungspark).
//
// WARUM EIN EIGENES MODUL: arena.js, textures.js, village.js, villagers.js,
// harbor.js und vegetation.js stehen ALLE im Sim-Manifest (sim/build.mjs FILES) —
// jede Änderung dort erscheint im Prüfstand-Output. Diese Datei steht NICHT im
// Manifest und kann die bindende Bit-Exaktheit strukturell nicht brechen.
// arena.js orchestriert nur den Aufruf (buildFlair(ctx), eine Zeile).
//
// REGELN (Auftragskopf):
//  - KEINE neuen Kollider auf Wegen/Gassen. Fast alles hier ist reine Dekoration
//    ohne Kollider; die wenigen Ausnahmen (Baumstämme, Lagerfeuer) liegen >= 5 m
//    von jeder Wegmitte und von allen Türvorplätzen — und checkPathsClear() läuft
//    am Ende dieser Datei ERNEUT über das komplette obstacles-Array, damit ein
//    falsch platzierter Stamm sofort in der Konsole auffällt.
//  - Kein castShadow: das Schattenkamera-Frustum (±76, R13/R15) bleibt unberührt,
//    der Schattenpass bekommt keinen einzigen neuen Draw-Call (R15-Muster der
//    Ufersteine, R21-Muster des Umlands). Bodenkontakt kommt aus addAO-Decals.
//  - Instanziert, wo es geht: Wiesen sind EIN Mesh, Blumen EIN InstancedMesh,
//    Möwen/Falter/Rauch je EIN InstancedMesh, dessen Matrizen der Updater pro
//    Frame neu komponiert (Muster: Palmen-Sway in vegetation.js).
//  - Flache Decals zerfallen auf dem Relief (R15b-Lehre: Z-Fighting-Kammstreifen)
//    — die Wiesen sind deshalb GITTER-Patches, jeder Vertex auf groundY (Muster:
//    Laternen-Lichtteppich in arena.js).
// WICHTIG (Aufruf-Weg): arena.js darf dieses Modul NICHT statisch importieren —
// sim/build.mjs kopiert arena.js nach sim/gen/, wo flair.js nicht existiert; der
// Import bräche den Prüfstand strukturell. Stattdessen exponiert createArena()
// sein ctx (return { ..., ctx }) und main.js (nicht im Manifest) ruft
// buildFlair(arena.ctx) direkt nach createArena() auf. ctx.addAO ist zu diesem
// Zeitpunkt schon verbaut (arena baut sein AO-InstancedMesh am Blockende) —
// deshalb baut flair seine Kontakt-AO-Decals selbst (gleiche Textur, gleicher Look).
import * as THREE from 'three';
import { makeCanvas, aoTexture } from './textures.js';
import { checkPathsClear } from './village.js';

// ---------- Texturen (prozedural, Stil textures.js) ----------

// weiche Wiese: sattes Grün in der Mitte, zum Rand hin transparent in den Sand
function meadowTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    // Plateau-Alpha statt weichem Verlauf: das rosafarbene Hemisphärenlicht wäscht
    // liegende Flächen stark aus (gemessen im Browser: ein weicher Gradient liest
    // sich nur noch als grüner Hauch) — die Wiese muss bis ~60 % Radius voll
    // decken und erst dann in den Sand ausblenden. Farbe bewusst hell/satt, weil
    // warme Sonne + rosa Hemi sie Richtung Oliv drücken.
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(92, 146, 52, 1)');
    g.addColorStop(0.55, 'rgba(88, 140, 50, 0.96)');
    g.addColorStop(0.8, 'rgba(92, 132, 52, 0.55)');
    g.addColorStop(1, 'rgba(100, 128, 56, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // unregelmäßiger Rand: Blob-Flecken über die Ausblendzone, damit die Kante
    // nicht wie ein perfekter Kreis liest
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = s * (0.34 + Math.random() * 0.12);
      ctx.fillStyle = `rgba(88, 138, 50, ${0.35 + Math.random() * 0.3})`;
      ctx.beginPath();
      ctx.arc(s / 2 + Math.cos(a) * rr, s / 2 + Math.sin(a) * rr,
        s * (0.05 + Math.random() * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
    // Halm-Gesprenkel, damit die Fläche nicht wie ein Farbverlauf liest
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * s * 0.48;
      const x = s / 2 + Math.cos(a) * r;
      const y = s / 2 + Math.sin(a) * r;
      const edge = 1 - r / (s * 0.5);
      const dark = Math.random() > 0.5;
      ctx.fillStyle = dark
        ? `rgba(56, 92, 38, ${0.35 * edge})`
        : `rgba(140, 172, 82, ${0.4 * edge})`;
      ctx.fillRect(x, y, 2 + Math.random() * 2, 2 + Math.random() * 3);
    }
  });
}

// einfache 5-Blatt-Blüte, weiß auf transparent — instanceColor tönt sie ein
function flowerTexture() {
  return makeCanvas(64, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(s / 2 + Math.cos(a) * s * 0.22, s / 2 + Math.sin(a) * s * 0.22,
        s * 0.16, s * 0.1, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,214,90,1)'; // gelbes Zentrum bleibt ungetönt kräftig
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
  });
}

// R23 Aufgabe A.2: Küsten-Grüngürtel-Band. u laeuft UM die Insel (RepeatWrapping,
// ~48 Wiederholungen), v quer uebers Band: beidseitig transparent ausblendend
// (innen in den Insel-Sand, aussen in den Strandsaum), Mitte volle Deckung —
// dieselbe Plateau-Lehre wie die Wiese (Hemi-Licht wäscht weiche Verläufe aus).
function coastBeltTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(96, 132, 54, 0)');
    g.addColorStop(0.22, 'rgba(90, 140, 50, 0.95)');
    g.addColorStop(0.72, 'rgba(86, 136, 48, 0.95)');
    g.addColorStop(1, 'rgba(100, 128, 56, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // Halm-Gesprenkel; an den x-Raendern gespiegelt nachgezeichnet, damit die
    // Wrap-Naht nicht als Musterbruch liest
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * s;
      const y = s * 0.12 + Math.random() * s * 0.76;
      const dark = Math.random() > 0.5;
      const edge = 1 - Math.abs(y - s / 2) / (s * 0.42);
      ctx.fillStyle = dark
        ? `rgba(54, 90, 36, ${0.35 * Math.max(0, edge)})`
        : `rgba(140, 172, 82, ${0.4 * Math.max(0, edge)})`;
      const w = 2 + Math.random() * 2, h = 2 + Math.random() * 3;
      ctx.fillRect(x, y, w, h);
      if (x < 8) ctx.fillRect(x + s, y, w, h);
      if (x > s - 8) ctx.fillRect(x - s, y, w, h);
    }
  });
}

function smokeTexture() {
  return makeCanvas(64, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(226, 222, 214, 0.55)');
    g.addColorStop(0.6, 'rgba(210, 205, 196, 0.28)');
    g.addColorStop(1, 'rgba(200, 196, 188, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

// warmer Feuerschein-Teppich (Muster lampGlowTexture, kleiner und oranger)
function emberGlowTexture() {
  return makeCanvas(64, (ctx, s) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgb(255,170,90)');
    g.addColorStop(0.4, 'rgb(150,86,40)');
    g.addColorStop(0.8, 'rgb(40,22,10)');
    g.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

function smooth01(v) {
  const k = Math.max(0, Math.min(1, v));
  return k * k * (3 - 2 * k);
}

export function buildFlair(ctx) {
  const {
    scene, obstacles, geo, mats, groundY, updaters,
    coastWalkRadius, PIER, WALK_RADIUS,
  } = ctx;

  // eigene Kontakt-AO-Spots (arena.js' addAO-Sammlung ist bereits verbaut, s. o.)
  const aoSpots = [];
  const addAO = (x, z, footprint) => aoSpots.push({ x, z, r: footprint * 0.65 });

  // R23: alle Anker der Südwest-Bucht werden aus der Küste ABGELEITET statt fest
  // verdrahtet — die R22-Zahlen (-57,16 usw.) stammten von der 82er-Küste und
  // lägen mit EXPLORE_RADIUS 120 mitten im Landesinneren. bayAt(rOff, lat):
  // rOff radial zur Buchtküste (~104), lat quer dazu.
  const BAY_DIR = { x: Math.sin(-1.25), z: Math.cos(-1.25) };
  const bayCoast = coastWalkRadius(BAY_DIR.x, BAY_DIR.z);
  const bayAt = (rOff, lat = 0) => ({
    x: BAY_DIR.x * (bayCoast + rOff) + BAY_DIR.z * lat,
    z: BAY_DIR.z * (bayCoast + rOff) - BAY_DIR.x * lat,
  });

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const sc = new THREE.Vector3();

  // =========================================================================
  // 1. WIESEN — Gras-Patches statt reiner Sandtöne (Dorfumfeld + Umland-Teppiche)
  // =========================================================================
  // Handverlesene Spots, alle >= 4 m von jeder Wegmitte (pathDefs), den
  // Plaza-Fliesen (r<9) und dem Steg-Korridor. Gitter-Patches auf groundY(+0.045)
  // — über den dunklen Streu-Decals (+0.02); Wege (PATH_LIFT 0.05) werden von den
  // Spots ohnehin GEMIEDEN. Alle Patches in EINER BufferGeometry -> ein Draw-Call.
  const MEADOWS = [
    // Dorfumfeld — R23 Aufgabe A.1: Radien hoch + ~ein Dutzend neue Patches, damit
    // zwischen den Häusern ZUSAMMENHÄNGENDE Grasflächen entstehen (Patch-Ketten
    // statt Insel-Tupfer). Alle Zentren >= ~4.5 m von jeder Wegmitte (pathDefs,
    // gegen die Segmentliste gerechnet), Platz-Fliesen (r<9) und Steg-Korridor frei.
    { x: -17, z: -9, r: 7.5 }, { x: 17, z: -12, r: 6 }, { x: -13, z: 27, r: 5 },
    { x: 24, z: 24, r: 6.5 }, { x: -2, z: -33, r: 5.5 }, { x: -30, z: 8, r: 6.5 },
    { x: 33, z: 8, r: 5 }, { x: 0, z: 44, r: 5 },
    { x: 8, z: -14, r: 5 }, { x: 12, z: 15, r: 4 }, { x: -14, z: 3, r: 4 },
    // dünenfreie Nachschläge (die Deko-Dünen aus arena.js begraben sonst Teile
    // der Patches — teilweises Überlappen am Rand bleibt gewollt organisch;
    // R23: die begrabenden Dorfkern-Dünen sind jetzt ohnehin selbst begrünt, s. u.)
    { x: -8, z: -28, r: 4.5 }, { x: 26, z: -30, r: 5 }, { x: -26, z: 28, r: 4.5 },
    // R23-Kette West (Taverne -> Westhäuser -> Outskirts)
    { x: -20, z: -14, r: 5.5 }, { x: -22, z: 6, r: 5 }, { x: -31, z: -16, r: 5 },
    { x: -40, z: 4, r: 6 },
    // R23-Kette Süd/Ost (Platzrand-Cluster -> Osthäuser)
    { x: 5, z: -24, r: 5 }, { x: 18, z: 2, r: 4 }, { x: 34, z: 20, r: 5 },
    { x: 0, z: -40, r: 5 },
    // R23-Kette Nord (Marktgassen-Rand -> Außenring)
    { x: -8, z: 17, r: 4 }, { x: -5, z: 30, r: 4 }, { x: 20, z: 44, r: 4 },
    // Umland-Teppiche (jenseits WALK_RADIUS; der Hafen-Sektor hat kein Umland)
    { x: -42, z: -30, r: 9 }, { x: -52, z: 10, r: 9 }, { x: -46, z: 34, r: 8 },
    { x: 34, z: -46, r: 9 }, { x: -14, z: -52, r: 8 }, { x: 52, z: -16, r: 8 },
    { x: 46, z: 30, r: 7 },
  ];
  {
    const SEG = 8;
    const vertsPer = (SEG + 1) * (SEG + 1);
    const pos = new Float32Array(MEADOWS.length * vertsPer * 3);
    const uv = new Float32Array(MEADOWS.length * vertsPer * 2);
    const idx = [];
    let pi = 0, ti = 0, vbase = 0;
    for (const mSpot of MEADOWS) {
      for (let iy = 0; iy <= SEG; iy++) {
        for (let ix = 0; ix <= SEG; ix++) {
          const u = ix / SEG, v = iy / SEG;
          const wx = mSpot.x + (u - 0.5) * 2 * mSpot.r;
          const wz = mSpot.z + (v - 0.5) * 2 * mSpot.r;
          pos[pi++] = wx;
          pos[pi++] = groundY(wx, wz) + 0.045;
          pos[pi++] = wz;
          uv[ti++] = u;
          uv[ti++] = v;
        }
      }
      for (let iy = 0; iy < SEG; iy++) {
        for (let ix = 0; ix < SEG; ix++) {
          const a = vbase + iy * (SEG + 1) + ix;
          const b = a + 1;
          const c = a + (SEG + 1);
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      vbase += vertsPer;
    }
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    gGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    gGeo.setIndex(idx);
    gGeo.computeVertexNormals();
    const meadowMat = new THREE.MeshStandardMaterial({
      map: meadowTexture(), transparent: true, depthWrite: false, roughness: 1.0,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    const meadows = new THREE.Mesh(gGeo, meadowMat);
    meadows.receiveShadow = true;
    scene.add(meadows);
  }

  // =========================================================================
  // 1b. KÜSTEN-GRÜNGÜRTEL — R23 Aufgabe A.2: grünes Band oberhalb des Sandsaums
  //     entlang der GANZEN Küste (Pirateninsel: grüne Insel, heller Strandring)
  // =========================================================================
  // Eigene BufferGeometry: NSEG Winkel-Schritte um die Insel, ROWS Ringe quer.
  // Jeder Vertex liegt radial relativ zur RICHTUNGSABHÄNGIGEN Küste
  // (coastWalkRadius) und in der Höhe auf groundY (R15b-Lehre: flache Decals
  // zerfallen auf dem Relief). Der Sand bleibt Saum: das Band endet OUT_OFF vor
  // der begehbaren Küste, dahinter liegen noch SAND_EXTRA (4 m) bis zum Wasser.
  // Im Hafen-Sektor (coast ~ WALK_RADIUS) kollabiert die Bandbreite auf 0 —
  // freie Sicht auf Steg + Boot, wie beim Umland selbst.
  {
    const NSEG = 192, ROWS = 4;
    const IN_OFF = 9.5, OUT_OFF = 1.8; // Band [coast-9.5 .. coast-1.8]
    const vertsPer = NSEG + 1;
    const bpos = new Float32Array((ROWS + 1) * vertsPer * 3);
    const bnrm = new Float32Array((ROWS + 1) * vertsPer * 3);
    const buv = new Float32Array((ROWS + 1) * vertsPer * 2);
    const bidx = [];
    let pi = 0, ni = 0, ti = 0;
    for (let iy = 0; iy <= ROWS; iy++) {
      const v = iy / ROWS;
      for (let ix = 0; ix <= NSEG; ix++) {
        const a = (ix / NSEG) * Math.PI * 2;
        const dx = Math.sin(a), dz = Math.cos(a);
        const coast = coastWalkRadius(dx, dz);
        // Breitenfaktor: 0 im Hafen-Sektor (Küste ~54), 1 im freien Umland
        const w = smooth01((coast - (WALK_RADIUS + 4)) / 10);
        // leichte Kanten-Wackelei, damit das Band nicht wie ein Zirkel liest
        const wobble = (Math.sin(a * 9.3) * 0.7 + Math.sin(a * 17.7 + 1.3) * 0.4) * w;
        const r = coast - OUT_OFF - (IN_OFF - OUT_OFF) * w * (1 - v) + wobble;
        const wx = dx * r, wz = dz * r;
        bpos[pi++] = wx;
        bpos[pi++] = groundY(wx, wz) + 0.045;
        bpos[pi++] = wz;
        bnrm[ni++] = 0; bnrm[ni++] = 1; bnrm[ni++] = 0; // Relief-Neigung ist gering
        buv[ti++] = (ix / NSEG) * 48;
        buv[ti++] = v;
      }
    }
    for (let iy = 0; iy < ROWS; iy++) {
      for (let ix = 0; ix < NSEG; ix++) {
        const a = iy * vertsPer + ix;
        const b = a + 1;
        const c = a + vertsPer;
        const d = c + 1;
        bidx.push(a, c, b, b, c, d);
      }
    }
    const beltGeo = new THREE.BufferGeometry();
    beltGeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    beltGeo.setAttribute('normal', new THREE.BufferAttribute(bnrm, 3));
    beltGeo.setAttribute('uv', new THREE.BufferAttribute(buv, 2));
    beltGeo.setIndex(bidx);
    const beltTex = coastBeltTexture();
    beltTex.wrapS = THREE.RepeatWrapping;
    const beltMat = new THREE.MeshStandardMaterial({
      map: beltTex, transparent: true, depthWrite: false, roughness: 1.0,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1,
    });
    const belt = new THREE.Mesh(beltGeo, beltMat);
    belt.receiveShadow = true;
    scene.add(belt);

    // Büschel + vereinzelte Palmen IM Gürtel (Auftrag: "Wiese + Büschel +
    // vereinzelte Palmen"). Rejection-Sampling wie outerSpot in arena.js.
    const beltSpot = (margin) => {
      for (let tries = 0; tries < 40; tries++) {
        const a = Math.random() * Math.PI * 2;
        const dx = Math.sin(a), dz = Math.cos(a);
        const coast = coastWalkRadius(dx, dz);
        if (coast < WALK_RADIUS + 10) continue; // Hafen-Sektor/Blende
        const r = coast - OUT_OFF - 0.5 - Math.random() * (IN_OFF - OUT_OFF - 1 - margin);
        return { x: dx * r, z: dz * r };
      }
      return null;
    };
    const BELT_TUFTS = 150;
    const tufts = new THREE.InstancedMesh(geo.frond, mats.frond, BELT_TUFTS);
    let bti = 0;
    for (let i = 0; i < BELT_TUFTS; i++) {
      const s = beltSpot(0);
      if (!s) continue;
      const sz = 0.12 + Math.random() * 0.16;
      e.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5);
      q.setFromEuler(e);
      m4.compose(v3.set(s.x, groundY(s.x, s.z) + sz * 1.1, s.z), q, sc.set(sz * 2.2, sz, sz * 2.2));
      tufts.setMatrixAt(bti++, m4);
    }
    tufts.count = bti;
    scene.add(tufts);

    // 8 Gürtel-Palmen (R21-Umland-Muster: kein castShadow, Stamm-Kollider 0.32)
    const beltPalms = [];
    for (let i = 0; i < 8; i++) {
      const s = beltSpot(2);
      if (s) beltPalms.push(s);
    }
    const FRONDS_PER = 6;
    const ptrunks = new THREE.InstancedMesh(geo.cylinder, mats.trunk, beltPalms.length);
    const pfronds = new THREE.InstancedMesh(geo.frond, mats.frond, beltPalms.length * FRONDS_PER);
    let pfi = 0;
    for (let i = 0; i < beltPalms.length; i++) {
      const p = beltPalms[i];
      const gy = groundY(p.x, p.z);
      const h = 3.8 + Math.random() * 1.6;
      const leanA = Math.random() * Math.PI * 2;
      const lean = 0.08 + Math.random() * 0.1;
      e.set(Math.cos(leanA) * lean, 0, Math.sin(leanA) * lean, 'YXZ');
      q.setFromEuler(e);
      m4.compose(v3.set(p.x, gy + h * 0.5, p.z), q, sc.set(0.14, h, 0.14));
      ptrunks.setMatrixAt(i, m4);
      obstacles.push({ x: p.x, z: p.z, radius: 0.32 });
      addAO(p.x, p.z, 1.4);
      const topX = p.x + Math.sin(leanA) * lean * h * 0.5;
      const topZ = p.z + Math.cos(leanA) * lean * h * 0.5;
      for (let f = 0; f < FRONDS_PER; f++) {
        const fa = (f / FRONDS_PER) * Math.PI * 2 + Math.random() * 0.5;
        e.set(1.15 + Math.random() * 0.25, fa, 0, 'YXZ');
        q.setFromEuler(e);
        m4.compose(
          v3.set(topX + Math.sin(fa) * 0.85, gy + h + 0.15, topZ + Math.cos(fa) * 0.85),
          q,
          sc.set(1.1, 1.05, 1.1),
        );
        pfronds.setMatrixAt(pfi++, m4);
      }
    }
    pfronds.count = pfi;
    ptrunks.receiveShadow = true;
    scene.add(ptrunks);
    scene.add(pfronds);
  }

  // =========================================================================
  // 2. BLUMENFLECKEN — Farbtupfer auf einem Teil der Wiesen (+ Falter darüber)
  // =========================================================================
  const FLOWER_SPOTS = [
    { x: -15, z: -7 }, { x: 15, z: -10 }, { x: -11, z: 25 },
    { x: 22, z: 22 }, { x: -30, z: 10 }, { x: -44, z: -32 },
    { x: -50, z: 12 }, { x: 0, z: 42 },
    // R23 Aufgabe A.3: mehr Blumen auf den neuen Wiesen-Ketten (die Falter
    // kreisen weiterhin nur ueber den ersten 5 dorfnahen Spots — slice unten)
    { x: 18, z: 2 }, { x: -22, z: 4 }, { x: 34, z: 18 },
    { x: -5, z: 30 }, { x: -20, z: -16 }, { x: 0, z: -38 },
  ];
  const FLOWER_TINTS = [0xffffff, 0xff6a5a, 0xffd24a, 0xb08ae0, 0xff9ac0, 0x7ac8ff];
  {
    const PER_SPOT = 10;
    // Töpfe am Markt (Abschnitt 11) hängen ihre Blüten an dieselbe Instanz-Liste
    const potFlowers = [
      { x: 9.0, z: 23.6 }, { x: 10.6, z: 25.9 }, { x: 15.3, z: 36.7 },
    ];
    const total = FLOWER_SPOTS.length * PER_SPOT * 2 + potFlowers.length * 2;
    const flowerMat = new THREE.MeshStandardMaterial({
      map: flowerTexture(), side: THREE.DoubleSide, alphaTest: 0.5,
      transparent: true, roughness: 1.0,
    });
    const flowers = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.16), flowerMat, total);
    let fi = 0;
    const place = (x, z, y) => {
      const rot = Math.random() * Math.PI;
      for (let k = 0; k < 2; k++) { // zwei gekreuzte Ebenen pro Blüte (Muster tuftField)
        e.set(0, rot + k * Math.PI / 2, 0);
        q.setFromEuler(e);
        m4.compose(v3.set(x, y, z), q, sc.set(1, 1, 1));
        flowers.setMatrixAt(fi, m4);
        flowers.setColorAt(fi, new THREE.Color(FLOWER_TINTS[fi % FLOWER_TINTS.length]));
        fi++;
      }
    };
    for (const spot of FLOWER_SPOTS) {
      for (let i = 0; i < PER_SPOT; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.4 + Math.sqrt(Math.random()) * 2.2;
        const x = spot.x + Math.cos(a) * r;
        const z = spot.z + Math.sin(a) * r;
        place(x, z, groundY(x, z) + 0.12);
      }
    }
    for (const p of potFlowers) place(p.x, p.z, groundY(p.x, p.z) + 0.42);
    flowers.count = fi;
    scene.add(flowers);
  }

  // =========================================================================
  // 3. LAUBBÄUME — runde Kronen als Kontrast zu den Palmen (Dorfrand + Umland)
  // =========================================================================
  // Stämme kollidieren wie die R21-Palmenstämme. Alle Positionen liegen >= 5 m
  // von jeder Wegmitte und >= 4 m von jedem Türvorplatz — checkPathsClear unten
  // verifiziert das gegen das echte Wegenetz.
  const TREES = [
    { x: -19, z: 34, h: 3.4 }, { x: 28, z: 28, h: 3.8 }, { x: -32, z: -8, h: 3.6 },
    { x: 38, z: -20, h: 3.2 }, { x: -36, z: -18, h: 4.0 }, { x: 48, z: 4, h: 3.4 },
    { x: -24, z: -38, h: 3.6 }, { x: 12, z: -44, h: 3.8 },
    // R23 Aufgabe A.3: sechs weitere (auch im Dorf, >= 5 m von jeder Wegmitte,
    // Steg-Sichtkorridor |x-14|<9 bei z>40 bleibt frei)
    { x: 20, z: 18, h: 3.4 }, { x: -6, z: -38, h: 3.6 }, { x: 42, z: 22, h: 3.6 },
    { x: -44, z: 14, h: 3.8 }, { x: -38, z: 36, h: 3.4 }, { x: 0, z: 48, h: 3.2 },
  ];
  {
    const CROWNS_PER = 3;
    const trunks = new THREE.InstancedMesh(geo.cylinder, mats.trunk, TREES.length);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 });
    const crowns = new THREE.InstancedMesh(geo.sphere, crownMat, TREES.length * CROWNS_PER);
    const crownTints = [0x4d8a3c, 0x568f40, 0x447a36];
    let ci = 0;
    for (let i = 0; i < TREES.length; i++) {
      const tr = TREES[i];
      const gy = groundY(tr.x, tr.z);
      e.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.06);
      q.setFromEuler(e);
      m4.compose(v3.set(tr.x, gy + tr.h * 0.5, tr.z), q, sc.set(0.18, tr.h, 0.18));
      trunks.setMatrixAt(i, m4);
      for (let c = 0; c < CROWNS_PER; c++) {
        const a = (c / CROWNS_PER) * Math.PI * 2 + i;
        const cr = 1.1 + Math.random() * 0.5;
        e.set(0, Math.random() * Math.PI, 0);
        q.setFromEuler(e);
        m4.compose(
          v3.set(tr.x + Math.cos(a) * 0.55, gy + tr.h + 0.25 + (c === 0 ? 0.55 : 0), tr.z + Math.sin(a) * 0.55),
          q,
          sc.set(cr, cr * 0.85, cr),
        );
        crowns.setMatrixAt(ci, m4);
        crowns.setColorAt(ci, new THREE.Color(crownTints[(i + c) % crownTints.length]));
        ci++;
      }
      addAO(tr.x, tr.z, 2.2);
      obstacles.push({ x: tr.x, z: tr.z, radius: 0.4 });
    }
    trunks.receiveShadow = true;
    crowns.receiveShadow = true;
    scene.add(trunks);
    scene.add(crowns);
  }

  // =========================================================================
  // 3b. GRÜNE DÜNEN-KUPPEN — R23 Aufgabe A.4: der Dünen-Konflikt wird GELÖST
  // =========================================================================
  // Die Deko-Dünen aus arena.js begraben Wiesen-Ränder (R22-Notiz). Statt die
  // Wiesen weiter auszuweichen, werden ausgewählte Dünen selbst begrünt: eine
  // leicht aufgeblasene grüne Kopie DARÜBER (Auftrag A.4, Variante "grüne Kuppe
  // als eigene Instanz"). Der echte Dünen-Radius ist zufällig (5..9) — er wird
  // deshalb aus der Szene GELESEN (geometry.parameters.radius) statt geraten:
  // die Dünen sind die einzigen Einzel-Meshes mit SphereGeometry r>=5 und
  // scale.y 0.12, identifiziert zusätzlich über die duneSpots-Positionen.
  {
    const CAP_SPOTS = [
      // Dorfkern (6 von 8 — zwei bleiben bewusst sandig, Varianz)
      [-6, 18], [-16, 14], [10, 22], [-22, -8], [-14, -18], [28, 22],
      // Außenring-Auswahl Richtung Grüngürtel
      [-38, 30], [-46, -10], [30, -42],
    ];
    const found = [];
    for (const o of scene.children) {
      if (!o.isMesh || !o.geometry || o.geometry.type !== 'SphereGeometry') continue;
      const p = o.geometry.parameters;
      if (!p || p.radius < 4.9 || p.radius > 9.1) continue;
      if (Math.abs(o.scale.y - 0.12) > 1e-6) continue;
      for (const [sx, sz] of CAP_SPOTS) {
        if (Math.hypot(o.position.x - sx, o.position.z - sz) < 0.6) { found.push(o); break; }
      }
    }
    // Grün nur auf der KUPPE, an den Flanken transparent in den Dünen-Sand:
    // die Kugel-UV (v: 0 = Pol oben) traegt einen Alpha-Verlauf — ohne ihn stand
    // hier eine deckend gruene Platte mit sichtbarer 10-Eck-Silhouettenkante
    // (Browser-Befund direkt nach dem ersten Wurf dieser Runde).
    const capTex = makeCanvas(128, (c2, s) => {
      c2.clearRect(0, 0, s, s);
      const g = c2.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.16, 'rgba(255,255,255,0.97)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.42, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = g;
      c2.fillRect(0, 0, s, s);
      // Gesprenkel auf der Kuppe, damit die Flaeche nicht wie Plastik liest
      for (let i = 0; i < 300; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s * 0.34;
        c2.fillStyle = Math.random() > 0.5
          ? 'rgba(210,235,190,0.35)' : 'rgba(60,90,40,0.3)';
        c2.fillRect(x, y, 2, 2 + Math.random() * 2);
      }
    });
    const capMat = new THREE.MeshStandardMaterial({
      map: capTex, color: 0xffffff, roughness: 1.0,
      transparent: true, depthWrite: false,
    });
    const caps = new THREE.InstancedMesh(geo.sphere, capMat, found.length);
    const CAP_TINTS = [0x5c9234, 0x548a30, 0x62973a];
    for (let i = 0; i < found.length; i++) {
      const d = found[i];
      const r = d.geometry.parameters.radius;
      m4.compose(
        v3.set(d.position.x, d.position.y + 0.03, d.position.z),
        q.identity(),
        // Fußabdruck +4 %, Höhe 0.132r gegen 0.12r der Düne: die Kuppe deckt
        // die Sandkugel an jedem Punkt, ohne daneben zu schweben
        sc.set(r * 1.04, r * 0.132, r * 1.04),
      );
      caps.setMatrixAt(i, m4);
      caps.setColorAt(i, new THREE.Color(CAP_TINTS[i % CAP_TINTS.length]));
    }
    caps.receiveShadow = true;
    scene.add(caps);
  }

  // =========================================================================
  // 4. PALMENHAINE — zwei Gruppen im Umland (Bucht + Anhöhe), Muster R21-Umland
  // =========================================================================
  const GROVE = [
    // Bucht-Trio: dynamisch an der gewachsenen Küste (R23, s. bayAt oben)
    { ...bayAt(-10, 8), h: 4.6 }, { ...bayAt(-13, 3), h: 4.0 }, { ...bayAt(-9, -6), h: 5.0 },
    // Anhöhen-Trio: die Anhöhe (HILL, r ~61) ist unverändert — Zahlen bleiben
    { x: -40, z: -46, h: 4.4 }, { x: -48, z: -34, h: 4.8 }, { x: -33, z: -41, h: 4.0 },
  ];
  {
    const FRONDS_PER = 6;
    const trunks = new THREE.InstancedMesh(geo.cylinder, mats.trunk, GROVE.length);
    const fronds = new THREE.InstancedMesh(geo.frond, mats.frond, GROVE.length * FRONDS_PER);
    let fi = 0;
    for (let i = 0; i < GROVE.length; i++) {
      const p = GROVE[i];
      const gy = groundY(p.x, p.z);
      const leanA = Math.random() * Math.PI * 2;
      const lean = 0.08 + Math.random() * 0.1;
      e.set(Math.cos(leanA) * lean, 0, Math.sin(leanA) * lean, 'YXZ');
      q.setFromEuler(e);
      m4.compose(v3.set(p.x, gy + p.h * 0.5, p.z), q, sc.set(0.14, p.h, 0.14));
      trunks.setMatrixAt(i, m4);
      obstacles.push({ x: p.x, z: p.z, radius: 0.32 });
      addAO(p.x, p.z, 1.4);
      const topX = p.x + Math.sin(leanA) * lean * p.h * 0.5;
      const topZ = p.z + Math.cos(leanA) * lean * p.h * 0.5;
      for (let f = 0; f < FRONDS_PER; f++) {
        const fa = (f / FRONDS_PER) * Math.PI * 2 + Math.random() * 0.5;
        e.set(1.15 + Math.random() * 0.25, fa, 0, 'YXZ');
        q.setFromEuler(e);
        m4.compose(
          v3.set(topX + Math.sin(fa) * 0.85, gy + p.h + 0.15, topZ + Math.cos(fa) * 0.85),
          q,
          sc.set(1.1, 1.05, 1.1),
        );
        fronds.setMatrixAt(fi++, m4);
      }
    }
    trunks.receiveShadow = true;
    scene.add(trunks);
    scene.add(fronds);
  }

  // =========================================================================
  // 5. LAGUNE — türkises Flachwasser entlang der Küste, kräftig in der Bucht
  // =========================================================================
  // Zwei radial an die Küste verschobene Ringe (Muster: Schaumring in arena.js)
  // zwischen Wasserlinie (-0.7) und Schaum (-0.62); dazu ein Extra-Patch in der
  // R21-Bucht. Reine Farbe (MeshBasicMaterial), keine Physik, kein Schatten.
  const SAND_EXTRA = 4; // == ISLAND_RADIUS - WALK_RADIUS (arena.js)
  const sandEdge = (x, z) => coastWalkRadius(x, z) + SAND_EXTRA;
  const lagoonMats = [];
  {
    const bands = [
      { off0: -1, off1: 5, opacity: 0.4, y: -0.66 },
      { off0: 5, off1: 12, opacity: 0.2, y: -0.67 },
    ];
    for (const band of bands) {
      // R23: 128 -> 192 Segmente — die Ringe liegen jetzt bei r ~124 (s. arena.js)
      const ringGeo = new THREE.RingGeometry(50 + band.off0, 50 + band.off1, 192);
      const rp = ringGeo.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i);
        const zW = -rp.getY(i);
        const r0 = Math.hypot(x, zW);
        const nr = sandEdge(x, zW) + (r0 - 50); // off0..off1 über die jeweilige Sandkante
        const s = nr / r0;
        rp.setX(i, x * s);
        rp.setY(i, -zW * s);
      }
      const mat = new THREE.MeshBasicMaterial({
        color: 0x3fb8a8, transparent: true, opacity: band.opacity, depthWrite: false,
      });
      lagoonMats.push({ mat, base: band.opacity });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = band.y;
      scene.add(ring);
    }
    // Bucht-Patch: der Küsten-Einschnitt (BAY_ANGLE -1.25, Küste 82->70) bekommt
    // die kräftigste Lagunenfarbe — Felix' "besonders in der Bucht".
    const bayMat = new THREE.MeshBasicMaterial({
      color: 0x46c8b6, transparent: true, opacity: 0.35, depthWrite: false,
    });
    lagoonMats.push({ mat: bayMat, base: 0.35 });
    const bay = new THREE.Mesh(new THREE.CircleGeometry(1, 24), bayMat);
    bay.rotation.x = -Math.PI / 2;
    bay.scale.set(18, 12, 1);
    const bayPatch = bayAt(7); // R23: im Wasser VOR der gewanderten Buchtküste
    bay.position.set(bayPatch.x, -0.655, bayPatch.z);
    scene.add(bay);
    // sanfter Puls, phasenversetzt zum Schaumring
    updaters.push((dt, t) => {
      const k = Math.sin(t * 0.9 + 1.3) * 0.05;
      for (const l of lagoonMats) l.mat.opacity = l.base + k;
    });
  }

  // =========================================================================
  // 6. MÖWEN — einfache Kreisbahnen über Hafen und Bucht (Auftrag A.3)
  // =========================================================================
  // 5 Möwen x 3 Teile (Rumpf + 2 Flügel) in EINEM InstancedMesh (geo.box),
  // Matrizen pro Frame neu komponiert (Muster Palmen-Sway). Kein Schatten.
  {
    const bayGull1 = bayAt(2, 0);
    const bayGull2 = bayAt(-3, 7);
    const GULLS = [
      { cx: PIER.x + 2, cz: 58, r: 12, y: 9.5, speed: 0.32, phase: 0 },
      { cx: PIER.x - 4, cz: 62, r: 9, y: 11, speed: -0.26, phase: 2.1 },
      { cx: PIER.x + 6, cz: 52, r: 14, y: 8, speed: 0.22, phase: 4.2 },
      // R23: die Bucht-Möwen ziehen mit der Bucht (dynamisch, s. bayAt)
      { cx: bayGull1.x, cz: bayGull1.z, r: 10, y: 7.5, speed: 0.28, phase: 1.1 },
      { cx: bayGull2.x, cz: bayGull2.z, r: 7, y: 9, speed: -0.34, phase: 3.3 },
    ];
    const gullMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 });
    const gulls = new THREE.InstancedMesh(geo.box, gullMat, GULLS.length * 3);
    scene.add(gulls);
    const base = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const scaleM = new THREE.Matrix4();
    updaters.push((dt, t) => {
      for (let i = 0; i < GULLS.length; i++) {
        const g = GULLS[i];
        const a = t * g.speed + g.phase;
        const px = g.cx + Math.cos(a) * g.r;
        const pz = g.cz + Math.sin(a) * g.r;
        const py = g.y + Math.sin(t * 0.7 + g.phase) * 0.6;
        // Flugrichtung = Tangente der Kreisbahn (Kreis liegt in Welt-XZ)
        const heading = Math.atan2(
          Math.cos(a) * Math.sign(g.speed),
          -Math.sin(a) * Math.sign(g.speed),
        );
        e.set(0, heading, 0);
        q.setFromEuler(e);
        base.compose(v3.set(px, py, pz), q, sc.set(1, 1, 1));
        // Rumpf
        scaleM.makeScale(0.14, 0.09, 0.52);
        m4.multiplyMatrices(base, scaleM);
        gulls.setMatrixAt(i * 3, m4);
        // Flügel: Schlag um die Längsachse, gegengleich
        const flap = Math.sin(t * 7 + g.phase * 3) * 0.55;
        for (let w = 0; w < 2; w++) {
          const side = w === 0 ? 1 : -1;
          e.set(0, 0, side * flap);
          q.setFromEuler(e);
          rot.makeRotationFromQuaternion(q);
          local.makeTranslation(side * 0.36, 0.02, 0);
          local.premultiply(rot); // erst versetzen, dann um die Wurzel kippen
          scaleM.makeScale(0.62, 0.025, 0.2);
          local.multiply(scaleM);
          m4.multiplyMatrices(base, local);
          gulls.setMatrixAt(i * 3 + 1 + w, m4);
        }
      }
      gulls.instanceMatrix.needsUpdate = true;
    });
  }

  // =========================================================================
  // 7. FALTER — flatternde Farbtupfer über den Blumenflecken im Dorfumfeld
  // =========================================================================
  {
    const BFLIES = [];
    const homeSpots = FLOWER_SPOTS.slice(0, 5); // nur Dorfnähe, das Umland hat Möwen
    for (let i = 0; i < 8; i++) {
      const home = homeSpots[i % homeSpots.length];
      BFLIES.push({
        hx: home.x, hz: home.z,
        phase: i * 1.7, r: 1.2 + (i % 3) * 0.7, speed: 0.5 + (i % 4) * 0.12,
      });
    }
    const BF_TINTS = [0xffa53c, 0xfff4e0, 0xffe066, 0x9adcff];
    const bflyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide,
    });
    const bflies = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.15), bflyMat, BFLIES.length * 2);
    for (let i = 0; i < BFLIES.length; i++) {
      const tint = new THREE.Color(BF_TINTS[i % BF_TINTS.length]);
      bflies.setColorAt(i * 2, tint);
      bflies.setColorAt(i * 2 + 1, tint);
    }
    scene.add(bflies);
    const base = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    updaters.push((dt, t) => {
      for (let i = 0; i < BFLIES.length; i++) {
        const b = BFLIES[i];
        const px = b.hx + Math.sin(t * b.speed + b.phase) * b.r;
        const pz = b.hz + Math.sin(t * b.speed * 0.63 + b.phase * 2) * b.r;
        const py = groundY(px, pz) + 0.7 + Math.sin(t * 2.2 + b.phase) * 0.25;
        e.set(-Math.PI / 2, 0, t * 0.4 + b.phase); // Flügel liegen flach, Kurs dreht
        q.setFromEuler(e);
        base.compose(v3.set(px, py, pz), q, sc.set(1, 1, 1));
        const flap = 0.35 + Math.abs(Math.sin(t * 11 + b.phase)) * 0.9;
        for (let w = 0; w < 2; w++) {
          const side = w === 0 ? 1 : -1;
          e.set(0, side * flap, 0);
          q.setFromEuler(e);
          rot.makeRotationFromQuaternion(q);
          local.makeTranslation(side * 0.055, 0, 0);
          local.premultiply(rot);
          m4.multiplyMatrices(base, local);
          bflies.setMatrixAt(i * 2 + w, m4);
        }
      }
      bflies.instanceMatrix.needsUpdate = true;
    });
  }

  // =========================================================================
  // 8. RAUCH — zwei Schornsteine auf bestehenden Dächern + Lagerfeuer-Säule
  // =========================================================================
  // Schornstein-Klötze als neue Props AN bekannten Häusern (village.js bleibt
  // unberührt — Position aus den building()-Aufrufen dort abgeleitet und in
  // Weltkoordinaten nachgerechnet: world = pos + RotY(rot) * lokal).
  const SMOKE_COLS = [];
  {
    const houses = [
      // Haus (-24,-16), w8 h6 d7, rot 0.5 — Taverne am Platzrand
      { x: -24, z: -16, h: 6, rot: 0.5, lx: 2.2, lz: -1.5 },
      // Haus (2,27), w6.5 h5 d5.5, rot 3.0 — an der Marktgasse
      { x: 2, z: 27, h: 5, rot: 3.0, lx: -1.8, lz: -1.2 },
    ];
    const chimneys = new THREE.InstancedMesh(geo.box, mats.stoneBlock, houses.length);
    for (let i = 0; i < houses.length; i++) {
      const hDef = houses[i];
      const cos = Math.cos(hDef.rot), sin = Math.sin(hDef.rot);
      const wx = hDef.x + hDef.lx * cos + hDef.lz * sin;
      const wz = hDef.z - hDef.lx * sin + hDef.lz * cos;
      const top = groundY(hDef.x, hDef.z) + hDef.h + 0.85;
      e.set(0, hDef.rot, 0);
      q.setFromEuler(e);
      m4.compose(v3.set(wx, top - 0.45, wz), q, sc.set(0.5, 0.9, 0.5));
      chimneys.setMatrixAt(i, m4);
      SMOKE_COLS.push({ x: wx, y: top, z: wz, scale: 1 });
    }
    chimneys.receiveShadow = true;
    scene.add(chimneys);
  }

  // =========================================================================
  // 9. LAGERFEUER in der Bucht — Erkundungs-Belohnung (Auftrag A.3)
  // =========================================================================
  const CAMP = bayAt(-7); // R23: folgt der Bucht (R22 fest: -57,16 an der 82er-Küste)
  {
    const gy = groundY(CAMP.x, CAMP.z);
    // Steinkreis
    const ring = new THREE.InstancedMesh(geo.pebble, mats.stone, 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      e.set(Math.random(), Math.random() * 6, Math.random());
      q.setFromEuler(e);
      m4.compose(
        v3.set(CAMP.x + Math.cos(a) * 0.75, gy + 0.08, CAMP.z + Math.sin(a) * 0.75),
        q, sc.set(0.2, 0.14, 0.2),
      );
      ring.setMatrixAt(i, m4);
    }
    ring.receiveShadow = true;
    scene.add(ring);
    // Scheite als Dreibein + zwei Sitzstämme
    const logs = new THREE.InstancedMesh(geo.cylinder, mats.trunk, 5);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      e.set(0.6, a, 0, 'YXZ');
      q.setFromEuler(e);
      m4.compose(v3.set(CAMP.x + Math.cos(a) * 0.18, gy + 0.35, CAMP.z + Math.sin(a) * 0.18), q, sc.set(0.07, 0.9, 0.07));
      logs.setMatrixAt(i, m4);
    }
    const seats = [
      { x: CAMP.x - 1.7, z: CAMP.z + 0.6, rot: 0.4 },
      { x: CAMP.x + 1.1, z: CAMP.z - 1.5, rot: 1.9 },
    ];
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      e.set(0, s.rot, Math.PI / 2);
      q.setFromEuler(e);
      m4.compose(v3.set(s.x, groundY(s.x, s.z) + 0.22, s.z), q, sc.set(0.22, 1.6, 0.22));
      logs.setMatrixAt(3 + i, m4);
    }
    logs.receiveShadow = true;
    scene.add(logs);
    // Flamme: zwei Kegel (außen orange, innen hell), Flacker-Updater
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xff8a3c, emissive: 0xff6a1a, emissiveIntensity: 1.4, roughness: 0.4,
    });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 8), flameMat);
    flame.position.set(CAMP.x, gy + 0.62, CAMP.z);
    scene.add(flame);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.45, 8), coreMat);
    core.position.set(CAMP.x, gy + 0.5, CAMP.z);
    scene.add(core);
    // warmer Schein-Teppich (additiv, wie der Laternen-Lichtteppich, nur kleiner)
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 16),
      new THREE.MeshBasicMaterial({
        map: emberGlowTexture(), transparent: true, depthWrite: false, fog: false,
        blending: THREE.AdditiveBlending, opacity: 0.4,
        polygonOffset: true, polygonOffsetFactor: -2,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(CAMP.x, gy + 0.09, CAMP.z);
    glow.renderOrder = 1;
    scene.add(glow);
    updaters.push((dt, t) => {
      const k = 1 + Math.sin(t * 21) * 0.12 + Math.sin(t * 13.7) * 0.08;
      flame.scale.set(k, 0.85 + k * 0.25, k);
      core.scale.setScalar(0.8 + k * 0.25);
      flameMat.emissiveIntensity = 1.2 + Math.sin(t * 24) * 0.35;
    });
    addAO(CAMP.x, CAMP.z, 1.6);
    obstacles.push({ x: CAMP.x, z: CAMP.z, radius: 0.75 });
    SMOKE_COLS.push({ x: CAMP.x, y: gy + 0.9, z: CAMP.z, scale: 1.4 });
  }

  // ---- gemeinsame Rauch-Säulen (Schornsteine + Lagerfeuer): ein InstancedMesh,
  //      Puffs steigen im Loop, Billboard zur Kamera (camPos kommt vom Updater) ----
  {
    const PUFFS_PER = 5;
    const smokeMat = new THREE.MeshBasicMaterial({
      map: smokeTexture(), transparent: true, depthWrite: false, opacity: 0.7,
    });
    const smoke = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), smokeMat, SMOKE_COLS.length * PUFFS_PER);
    scene.add(smoke);
    updaters.push((dt, t, playerPos, camPos) => {
      let si = 0;
      for (let c = 0; c < SMOKE_COLS.length; c++) {
        const col = SMOKE_COLS[c];
        for (let p = 0; p < PUFFS_PER; p++) {
          const k = ((t * 0.18 + p / PUFFS_PER + c * 0.37) % 1);
          const px = col.x + Math.sin(t * 0.6 + p * 2.1 + c) * (0.15 + k * 0.55);
          const pz = col.z + Math.cos(t * 0.5 + p * 1.7 + c) * (0.1 + k * 0.4);
          const py = col.y + k * 3.4 * col.scale;
          // reines Gier-Billboard reicht: die Kamera schaut nie steil von oben
          const yaw = camPos ? Math.atan2(camPos.x - px, camPos.z - pz) : 0;
          e.set(0, yaw, 0);
          q.setFromEuler(e);
          // wachsen + am Zyklusende schnell schrumpfen statt hart poppen
          const s = (0.35 + k * 1.5) * col.scale * smooth01((1 - k) * 5);
          m4.compose(v3.set(px, py, pz), q, sc.set(s, s, 1));
          smoke.setMatrixAt(si++, m4);
        }
      }
      smoke.instanceMatrix.needsUpdate = true;
    });
  }

  // =========================================================================
  // 10. WIMPEL + WÄSCHELEINE — Schnüre an bestehenden Häusern (village.js: unberührt)
  // =========================================================================
  const ropeMat = new THREE.LineBasicMaterial({ color: 0x6b5a43 });
  // Kettenlinie (vereinfacht: Sinus-Durchhang) zwischen zwei Ankerpunkten
  function ropePoints(a, b, sag, n = 16) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      pts.push(new THREE.Vector3(
        a.x + (b.x - a.x) * k,
        a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * sag,
        a.z + (b.z - a.z) * k,
      ));
    }
    return pts;
  }
  function addRope(pts) {
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    scene.add(new THREE.Line(lineGeo, ropeMat));
  }
  {
    // Wimpel-Dreieck (hängt mit der Spitze nach unten)
    const triGeo = new THREE.BufferGeometry();
    triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.14, 0, 0, 0.14, 0, 0, 0, -0.3, 0,
    ]), 3));
    triGeo.computeVertexNormals();
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide,
    });
    const FLAG_TINTS = [0xd9534f, 0xf0e6d2, 0x4a8a7a, 0xe0b64a, 0x6a8ac9];
    // Zwei Girlanden: Marktgasse (Haus (2,27) -> Haus (8,40)) und Marktstand ->
    // Hauswand (Haus (2,27)). Anker knapp unter den Traufen der building()-Quader.
    const lines = [
      { a: { x: 3.6, y: 4.3, z: 29.4 }, b: { x: 8.2, y: 4.5, z: 37.2 }, sag: 0.7 },
      { a: { x: 9.3, y: 2.25, z: 25.3 }, b: { x: 4.4, y: 3.6, z: 28.0 }, sag: 0.45 },
    ];
    const flags = new THREE.InstancedMesh(triGeo, flagMat, lines.length * 12);
    let fli = 0;
    for (const l of lines) {
      const pts = ropePoints(l.a, l.b, l.sag);
      addRope(pts);
      const yaw = Math.atan2(l.b.x - l.a.x, l.b.z - l.a.z) + Math.PI / 2;
      for (let i = 1; i <= 12; i++) {
        const p = pts[Math.round((i / 13) * 16)];
        e.set(0, yaw, 0);
        q.setFromEuler(e);
        m4.compose(v3.set(p.x, p.y - 0.01, p.z), q, sc.set(1, 1, 1));
        flags.setMatrixAt(fli, m4);
        flags.setColorAt(fli, new THREE.Color(FLAG_TINTS[fli % FLAG_TINTS.length]));
        fli++;
      }
    }
    scene.add(flags);

    // Wäscheleine zwischen den Westhäusern (-20,22) und (-34,20): Leine + 4
    // Wäschestücke (geo.cloth), die im Wind leicht pendeln.
    const wa = { x: -22.6, y: 3.4, z: 23.2 };
    const wb = { x: -31.2, y: 4.4, z: 21.6 };
    const wpts = ropePoints(wa, wb, 0.5);
    addRope(wpts);
    const CLOTH_TINTS = [0xe8e0cc, 0x9ab5c9, 0xd9a1a1, 0xcfd9b0];
    const clothMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide,
    });
    const clothes = new THREE.InstancedMesh(geo.cloth, clothMat, 4);
    const clothPts = [3, 6, 10, 13].map((idx) => wpts[idx]);
    for (let i = 0; i < 4; i++) clothes.setColorAt(i, new THREE.Color(CLOTH_TINTS[i]));
    scene.add(clothes);
    const clothYaw = Math.atan2(wb.x - wa.x, wb.z - wa.z) + Math.PI / 2;
    updaters.push((dt, t) => {
      for (let i = 0; i < 4; i++) {
        const p = clothPts[i];
        e.set(Math.sin(t * 1.3 + i * 1.9) * 0.12, clothYaw, 0);
        q.setFromEuler(e);
        m4.compose(v3.set(p.x, p.y - 0.36, p.z), q, sc.set(1, 1, 1));
        clothes.setMatrixAt(i, m4);
      }
      clothes.instanceMatrix.needsUpdate = true;
    });
  }

  // =========================================================================
  // 11. MARKT-FARBTUPFER — Obstkisten, Stoffballen, Blumentöpfe an den Ständen
  // =========================================================================
  // Beide Stände aus village.js: (9.77, 24.78, rot 2.6) und (16.3, 37.5, rot -1.36).
  // Alle Props liegen INNERHALB der bestehenden Stand-Kollider (r 1.5) bzw. dicht
  // an der Theke — kein neuer Kollider, kein Weg wird berührt.
  {
    // Obstkisten: flache Holzkisten, gefüllt mit Frucht-Kugeln (instanceColor)
    const crates = new THREE.InstancedMesh(geo.box, mats.wood, 4);
    const crateSpots = [
      { x: 9.0, z: 25.6, rot: 2.6 }, { x: 10.7, z: 24.3, rot: 2.9 },
      { x: 15.6, z: 38.3, rot: -1.36 }, { x: 17.1, z: 37.0, rot: -1.1 },
    ];
    for (let i = 0; i < crateSpots.length; i++) {
      const cSpot = crateSpots[i];
      e.set(0, cSpot.rot, 0);
      q.setFromEuler(e);
      m4.compose(v3.set(cSpot.x, groundY(cSpot.x, cSpot.z) + 0.14, cSpot.z), q, sc.set(0.6, 0.28, 0.45));
      crates.setMatrixAt(i, m4);
    }
    crates.receiveShadow = true;
    scene.add(crates);
    const FRUIT_TINTS = [0xe8863c, 0xd8b13a, 0xc94f3d, 0x8fb04a];
    const fruitMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    const fruit = new THREE.InstancedMesh(geo.sphere, fruitMat, crateSpots.length * 6);
    let fri = 0;
    for (let i = 0; i < crateSpots.length; i++) {
      const cSpot = crateSpots[i];
      for (let f = 0; f < 6; f++) {
        const fx = cSpot.x + ((f % 3) - 1) * 0.16 + (Math.random() - 0.5) * 0.05;
        const fz = cSpot.z + (Math.floor(f / 3) - 0.5) * 0.16 + (Math.random() - 0.5) * 0.05;
        m4.compose(v3.set(fx, groundY(cSpot.x, cSpot.z) + 0.31, fz), q.identity(), sc.setScalar(0.075));
        fruit.setMatrixAt(fri, m4);
        fruit.setColorAt(fri, new THREE.Color(FRUIT_TINTS[(i + f) % FRUIT_TINTS.length]));
        fri++;
      }
    }
    scene.add(fruit);
    // Stoffballen: liegende Zylinder-Rollen auf den Theken
    const BOLT_TINTS = [0xc94f3d, 0x4a8a7a, 0xe0b64a, 0x6a8ac9, 0xd9a1a1];
    const boltMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const bolts = new THREE.InstancedMesh(geo.cylinder, boltMat, 5);
    const boltSpots = [
      { x: 9.55, z: 24.1, y: 0.98, rot: 2.6 }, { x: 9.95, z: 24.35, y: 0.98, rot: 2.6 },
      { x: 10.35, z: 24.6, y: 0.98, rot: 2.6 },
      { x: 16.0, z: 37.15, y: 0.98, rot: -1.36 }, { x: 16.45, z: 37.35, y: 0.98, rot: -1.36 },
    ];
    for (let i = 0; i < boltSpots.length; i++) {
      const b = boltSpots[i];
      e.set(0, b.rot, Math.PI / 2);
      q.setFromEuler(e);
      m4.compose(v3.set(b.x, groundY(b.x, b.z) + b.y, b.z), q, sc.set(0.11, 0.6, 0.11));
      bolts.setMatrixAt(i, m4);
      bolts.setColorAt(i, new THREE.Color(BOLT_TINTS[i]));
    }
    scene.add(bolts);
    // Blumentöpfe: kleine Fässer — die Blüten dazu stehen schon in der Blumen-Instanz
    const pots = new THREE.InstancedMesh(geo.barrel, mats.barrel, 3);
    const potSpots = [
      { x: 9.0, z: 23.6 }, { x: 10.6, z: 25.9 }, { x: 15.3, z: 36.7 },
    ];
    for (let i = 0; i < potSpots.length; i++) {
      const p = potSpots[i];
      m4.compose(v3.set(p.x, groundY(p.x, p.z) + 0.14, p.z), q.identity(), sc.set(0.4, 0.3, 0.4));
      pots.setMatrixAt(i, m4);
    }
    pots.receiveShadow = true;
    scene.add(pots);
  }

  // ---- Kontakt-AO unter Bäumen/Hain/Lagerfeuer (Muster arena.js, eigene Instanz) ----
  if (aoSpots.length) {
    const aoMat = new THREE.MeshBasicMaterial({
      map: aoTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3,
    });
    const ao = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), aoMat, aoSpots.length);
    const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < aoSpots.length; i++) {
      const sp = aoSpots[i];
      m4.compose(new THREE.Vector3(sp.x, groundY(sp.x, sp.z) + 0.02, sp.z), qFlat, new THREE.Vector3(sp.r, sp.r, 1));
      ao.setMatrixAt(i, m4);
    }
    ao.renderOrder = 1;
    scene.add(ao);
  }

  // =========================================================================
  // Selbstkontrolle: die neuen Kollider (Baumstämme, Hain, Lagerfeuer) dürfen
  // KEINEN Weg verengen — derselbe Check, den arena.js nach dem Dorfbau fährt,
  // läuft hier erneut über das komplette obstacles-Array (Auftrag A.4).
  // =========================================================================
  if (ctx.pathDefs) {
    checkPathsClear(ctx.pathDefs, obstacles,
      ['Hafenweg', 'Turmweg', 'Westweg', 'Ostweg', 'Nordwestweg']);
  }
}
