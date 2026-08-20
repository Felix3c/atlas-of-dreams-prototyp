// island/discover.js — R23 Aufgabe B: die Anfangsinsel wird ENTDECKBAR.
//
// Felix' Kernsatz (R22-Feedback): „Die Anfangsinsel muss etwas sein, was man
// entdecken kann — 20, 30 Minuten Spielspaß." Dieses Modul baut die ORTE, die
// das Entdecken belohnen. Gebaute Auswahl (Auftrag: 4–6 gut statt alle mittel):
//
//   1. SCHIFFSWRACK an der Nordküste — halb im Sand, Deck erkletterbar (topY).
//   2. KLIPPEN + FELSBOGEN an der neuen zweiten Ost-Bucht (arena.js BAY2).
//   3. RUINE im Inselinneren — Säulenkreis mit dunklem Höhlen-Vorraum-Fake.
//   4. AUSSICHTSPUNKT auf dem neuen Nordwest-Hügel (arena.js HILL2) — Plattform,
//      Fahne, Blick über die GANZE Insel („so groß ist die Welt").
//   5. STRANDGUT-Sammelobjekte (8) — Muscheln/Treibholz/eine Flaschenpost über
//      den bestehenden E/Y-Interakt (Torwächter-Muster des Turm-Prompts);
//      stiller Zähler im Ruhe-Strip, KEIN Inventar-System. Die Flaschenpost
//      trägt eine Zeile Weltgeschichte (Untertitel-Kanal der Episode).
//   6. RUNDWEG aus Trittspuren über alle Orte — Entdecken ist geführt-frei.
//
// REGELN (R22-Muster, Auftragskopf):
//  - Eigenes Modul, NICHT im Sim-Manifest; arena.js importiert es nicht —
//    main.js ruft buildDiscover(arena.ctx) nach buildFlair() auf.
//  - Kein castShadow (Schattenkamera-Frustum ±76 bleibt unangetastet; alle Orte
//    liegen ohnehin weit außerhalb — sie werfen im Schattenpass keinen Draw-Call).
//  - Kollider nur an den POIs selbst, >= 20 m von jeder Dorf-Wegmitte;
//    checkPathsClear() läuft am Ende erneut als Selbstkontrolle.
//  - Instanziert, wo es geht (Klippen, Trittspuren, Ruinen-Säulen, Strandgut-AO).
import * as THREE from 'three';
import { aoTexture } from './textures.js';
import { checkPathsClear } from './village.js';
import { HILL2 } from '../arena.js';

const FLOTSAM_TOTAL = 8;
const PICKUP_R = 2.6;   // m: E/Y wirkt — identisch mit der Prompt-Anzeige (eine Wahrheit)
const BOTTLE_LINE = 'A scrap of a chart, sea-worn. One island circled twice — an island that sits on no map. Beneath it, a single word: "wait."';
// R24: kleiner Payoff fürs Komplett-Sammeln (KEIN Inventar — eine Milo-Zeile +
// ein Funken-Moment + der Zähler trägt einen Haken). Die Zeile bindet den Fund
// an das Traum-Thema der Episode („so groß ist die Welt").
const COMPLETE_LINE = 'Eight keepsakes from one small shore. If one beach holds this much… what else is out there, past the horizon?';
const PICKUP_ANIM_T = 0.28; // s: Fundstück blendet am Boden weg (R25: KEIN Heben — Felix' Feedback)
const TOAST_HOLD_T = 2.6;   // s: Aufsammel-Toast steht, danach blendet CSS ihn aus
const BURST_T = 1.1;        // s: Funken-Burst beim achten Fund

export function buildDiscover(ctx, { showLine } = {}) {
  const {
    scene, obstacles, geo, mats, groundY, updaters,
    coastWalkRadius,
  } = ctx;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const sc = new THREE.Vector3();

  const aoSpots = [];
  const addAO = (x, z, footprint) => aoSpots.push({ x, z, r: footprint * 0.65 });

  // Punkt an der richtungsabhängigen Küste: theta wie atan2(x,z), rOff radial
  // (negativ = landeinwärts, positiv = in den Sandsaum), lat quer zur Richtung.
  function coastAt(theta, rOff, lat = 0) {
    const dx = Math.sin(theta), dz = Math.cos(theta);
    const c = coastWalkRadius(dx, dz);
    return {
      x: dx * (c + rOff) + dz * lat,
      z: dz * (c + rOff) - dx * lat,
      theta, coast: c,
    };
  }

  const pois = []; // {x, z, color} — die Minimap zeigt sie im Insel-Maßstab

  // =========================================================================
  // 1. SCHIFFSWRACK an der Nordküste — halb im Sand, Deck erkletterbar
  // =========================================================================
  const WRECK = coastAt(3.05, 0.5);
  {
    const gy = groundY(WRECK.x, WRECK.z);
    const g = new THREE.Group();
    g.position.set(WRECK.x, 0, WRECK.z);
    g.rotation.y = WRECK.theta + 0.9; // liegt schräg zur Küste, Bug landeinwärts
    // R24 Browser-Befund (Spielerhöhe): 0x5a3d24 soff auf der sonnenabgewandten
    // Landseite fast schwarz ab — das Wrack las sich vom Rundweg aus als Loch.
    // Helleres, wärmeres Holz behält den Verwitterungs-Ton, bleibt aber lesbar.
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x7a5a3a, roughness: 0.95, side: THREE.DoubleSide,
    });
    // Kipp-Gruppe: Rumpf, Dollbord und Deck teilen sich DIESELBE Schlagseite —
    // einzeln rotiert liefen Torus- und Kugel-Kippung auseinander (Browser-Befund).
    const tilt = new THREE.Group();
    tilt.position.y = gy + 1.15;
    tilt.rotation.z = 0.42; // Schlagseite
    g.add(tilt);
    // Rumpf: halbe Kugelschale wie das Episoden-Ruderboot, nur groß
    const hull = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      hullMat,
    );
    hull.scale.set(3.1, 2.4, 7.6);
    tilt.add(hull);
    // Dollbord-Ring auf der Rumpfkante
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 6, 28), hullMat);
    rim.rotation.x = -Math.PI / 2;
    rim.scale.set(3.15, 7.65, 1);
    rim.position.y = 0.02;
    tilt.add(rim);
    // Deckplanken quer im Rumpf: begehbar — der Kollider unten trägt topY dorthin
    const deck = new THREE.Mesh(geo.box, mats.wood);
    deck.scale.set(2.6, 0.14, 6.2);
    deck.position.y = 0.16;
    tilt.add(deck);
    // geborstener Mast, über die Bordwand gelegt
    const mast = new THREE.Mesh(geo.cylinder, mats.trunk);
    mast.scale.set(0.13, 6.2, 0.13);
    mast.position.set(1.6, gy + 1.9, -1.2);
    mast.rotation.z = 1.05;
    mast.rotation.x = 0.2;
    g.add(mast);
    // zerrissenes Segeltuch am Mast
    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 1.0, side: THREE.DoubleSide }),
    );
    sail.position.set(2.4, gy + 2.1, -1.1);
    sail.rotation.set(0.3, 0.7, 0.9);
    g.add(sail);
    // verstreute Planken + ein Fass im Sand davor
    for (let i = 0; i < 4; i++) {
      const plank = new THREE.Mesh(geo.box, mats.wood);
      const a = 1.1 + i * 1.5;
      plank.scale.set(1.4, 0.08, 0.3);
      plank.position.set(Math.cos(a) * (3.6 + i * 0.7), gy + 0.06, Math.sin(a) * (3.2 + i));
      plank.rotation.y = a * 2.3;
      g.add(plank);
    }
    const barrel = new THREE.Mesh(geo.barrel, mats.barrel);
    barrel.position.set(-3.4, gy + 0.3, 2.6);
    barrel.rotation.z = Math.PI / 2 - 0.2;
    g.add(barrel);
    scene.add(g);
    // Kletter-Kollider: Rumpf blockt, das Deck ist eine bespringbare Fläche
    // (JUMP-Apex ~1.7 m, Deckhöhe ~1.4 — ein Sprung von der Sandseite reicht)
    obstacles.push({ x: WRECK.x, z: WRECK.z, radius: 2.9, topY: gy + 1.42 });
    addAO(WRECK.x, WRECK.z, 6.5);
    pois.push({ x: WRECK.x, z: WRECK.z, color: '#d9b06a' });
  }

  // =========================================================================
  // 2. KLIPPEN + FELSBOGEN an der zweiten Ost-Bucht (arena.js BAY2, θ 2.05)
  // =========================================================================
  {
    const cliffMat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 1.0 });
    const CLIFFS = [
      // beidseitig der Buchtflanken, Größen 2.2–4.6 — bewusst massiger als die
      // Streu-Felsen des Umlands; die großen sind über topY erkletterbar
      { t: 1.76, off: 0.5, s: 3.6 }, { t: 1.84, off: -1.5, s: 4.6 },
      { t: 1.92, off: 1.5, s: 2.6 }, { t: 2.2, off: -0.5, s: 4.2 },
      { t: 2.28, off: 1.2, s: 3.2 }, { t: 2.34, off: -1.8, s: 2.4 },
      { t: 1.7, off: -3.5, s: 2.8 }, { t: 2.4, off: 0.8, s: 2.2 },
    ];
    const rocks = new THREE.InstancedMesh(geo.pebble, cliffMat, CLIFFS.length);
    for (let i = 0; i < CLIFFS.length; i++) {
      const c = CLIFFS[i];
      const p = coastAt(c.t, c.off);
      const gy = groundY(p.x, p.z);
      e.set((i % 3) * 0.12, i * 1.7, (i % 2) * 0.15);
      q.setFromEuler(e);
      m4.compose(v3.set(p.x, gy + c.s * 0.3, p.z), q, sc.set(c.s * 0.9, c.s * 0.8, c.s));
      rocks.setMatrixAt(i, m4);
      obstacles.push({
        x: p.x, z: p.z, radius: c.s * 0.75,
        topY: c.s >= 3 ? gy + c.s * 0.68 : undefined,
      });
      addAO(p.x, p.z, c.s * 1.3);
    }
    rocks.receiveShadow = true;
    scene.add(rocks);
    // Felsbogen in der Buchtmündung: zwei Pfeiler + Sturz — das Postkartenmotiv
    const pillarL = coastAt(2.05, 2.5, 4.2);
    const pillarR = coastAt(2.05, 2.5, -4.2);
    const gyL = groundY(pillarL.x, pillarL.z);
    const gyR = groundY(pillarR.x, pillarR.z);
    for (const [p, gy] of [[pillarL, gyL], [pillarR, gyR]]) {
      const col = new THREE.Mesh(geo.pebble, cliffMat);
      col.scale.set(1.6, 3.4, 1.9);
      col.position.set(p.x, gy + 2.4, p.z);
      col.rotation.y = p.theta;
      col.receiveShadow = true;
      scene.add(col);
      obstacles.push({ x: p.x, z: p.z, radius: 1.5 });
    }
    const lintel = new THREE.Mesh(geo.pebble, cliffMat);
    const mid = coastAt(2.05, 2.5);
    lintel.scale.set(1.4, 1.1, 5.6);
    lintel.position.set(mid.x, Math.min(gyL, gyR) + 5.2, mid.z);
    // +90°: die lange Achse liegt QUER zur Küstenrichtung — sie überbrückt die
    // beiden Pfeiler (radial gedreht hing der Sturz frei überm Wasser, Browser-Befund)
    lintel.rotation.y = mid.theta + Math.PI / 2;
    lintel.receiveShadow = true;
    scene.add(lintel);
    const bayBeach = coastAt(2.05, -2);
    pois.push({ x: bayBeach.x, z: bayBeach.z, color: '#9aa8b8' });
  }

  // =========================================================================
  // 3. RUINE im Inselinneren — Säulenkreis + dunkler Höhlen-Vorraum-Fake
  // =========================================================================
  const RUIN = { x: 28, z: -78 };
  {
    const gy = groundY(RUIN.x, RUIN.z);
    // geborstener Bodenring (Decal, kein Kollider)
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5, 20),
      new THREE.MeshStandardMaterial({
        color: 0x9a8f80, transparent: true, opacity: 0.4, depthWrite: false,
        roughness: 1.0, polygonOffset: true, polygonOffsetFactor: -1,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(RUIN.x, gy + 0.04, RUIN.z);
    scene.add(floor);
    // 6 Säulen: 4 stehen (unterschiedlich hoch geborsten), 2 liegen
    const cols = new THREE.InstancedMesh(geo.cylinder, mats.stoneBlock, 6);
    const heights = [2.6, 1.7, 2.2, 1.1];
    for (let i = 0; i < 4; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const px = RUIN.x + Math.cos(a) * 4.1;
      const pz = RUIN.z + Math.sin(a) * 4.1;
      const h = heights[i];
      m4.compose(v3.set(px, groundY(px, pz) + h / 2, pz), q.identity(), sc.set(0.42, h, 0.42));
      cols.setMatrixAt(i, m4);
      obstacles.push({ x: px, z: pz, radius: 0.5, topY: groundY(px, pz) + h });
      addAO(px, pz, 1.2);
    }
    for (let i = 0; i < 2; i++) {
      const a = ((4 + i) / 6) * Math.PI * 2 + 0.4;
      const px = RUIN.x + Math.cos(a) * (4.6 + i);
      const pz = RUIN.z + Math.sin(a) * (4.6 + i);
      e.set(0, a + 0.7, Math.PI / 2);
      q.setFromEuler(e);
      m4.compose(v3.set(px, groundY(px, pz) + 0.42, pz), q, sc.set(0.42, 2.4, 0.42));
      cols.setMatrixAt(4 + i, m4);
    }
    cols.receiveShadow = true;
    scene.add(cols);
    // Höhlen-Vorraum-FAKE (Auftrag: „darf ein dunkler Vorraum-Fake sein"):
    // Wandfragment mit schwarzer Öffnung — unbeleuchtetes Material liest sich
    // als Loch ins Dunkel, dahinter liegt KEIN Levelsystem.
    // R24 Browser-Befund: aufrecht + frisch vermauert las sich das Fragment wie
    // eine NEUE Wand — jetzt lehnt es leicht (rotY-Kippung) und steckt tiefer im
    // Boden; der Ruinen-Charakter kommt aus der Schräge, nicht aus neuem Content.
    const WALL_YAW = 0.25;
    const wall = new THREE.Mesh(geo.box, mats.stoneBlock);
    wall.scale.set(4.6, 3.2, 1.1);
    wall.position.set(RUIN.x - 1.2, gy + 1.32, RUIN.z - 6.4);
    wall.rotation.y = WALL_YAW;
    wall.rotation.z = 0.07; // leichte Lehne quer …
    wall.rotation.x = 0.04; // … und nach hinten — gekippt, nicht gebaut
    wall.receiveShadow = true;
    scene.add(wall);
    // R24-REPARATUR: die schwarze Öffnung steckte IM Quader (Projektion auf die
    // Wandnormale: 0,525 m < 0,55 m Halbtiefe) — der Höhlen-Fake war aus
    // Spielerhöhe nie sichtbar. Jetzt liegt die Plane aus der Wand-Pose
    // ABGELEITET 7 cm VOR der Südfläche (Zentrum + Normale·0,62, Tangente·−0,15).
    const cave = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 2.3),
      new THREE.MeshBasicMaterial({ color: 0x070604 }),
    );
    const cnx = Math.sin(WALL_YAW), cnz = Math.cos(WALL_YAW);
    cave.position.set(
      wall.position.x - 0.15 * cnz + cnx * 0.62,
      gy + 1.15,
      wall.position.z + 0.15 * cnx + cnz * 0.62,
    );
    cave.rotation.y = WALL_YAW;
    scene.add(cave);
    obstacles.push({ x: RUIN.x - 1.2, z: RUIN.z - 6.4, radius: 2.4 });
    addAO(RUIN.x - 1.2, RUIN.z - 6.4, 4.5);
    pois.push({ x: RUIN.x, z: RUIN.z, color: '#c9b8d8' });
  }

  // =========================================================================
  // 4. AUSSICHTSPUNKT auf dem neuen Hügel (arena.js HILL2) — Plattform + Fahne
  // =========================================================================
  {
    const LOOK = { x: HILL2.x, z: HILL2.z };
    const gy = groundY(LOOK.x, LOOK.z);
    const deck = new THREE.Mesh(geo.box, mats.wood);
    deck.scale.set(3.2, 0.16, 3.2);
    deck.position.set(LOOK.x, gy + 0.1, LOOK.z);
    deck.receiveShadow = true;
    scene.add(deck);
    obstacles.push({ x: LOOK.x, z: LOOK.z, radius: 1.8, topY: gy + 0.18 });
    // Geländer auf drei Seiten (die Aufstiegsseite — Richtung Trittspur — bleibt offen)
    const rails = new THREE.InstancedMesh(geo.cylinder, mats.wood, 8);
    let ri = 0;
    const corners = [[-1.45, -1.45], [1.45, -1.45], [1.45, 1.45], [-1.45, 1.45]];
    for (const [cx, cz] of corners) {
      m4.compose(v3.set(LOOK.x + cx, gy + 0.65, LOOK.z + cz), q.identity(), sc.set(0.06, 0.95, 0.06));
      rails.setMatrixAt(ri++, m4);
    }
    const railRuns = [
      { x: LOOK.x, z: LOOK.z - 1.45, rotY: 0 },
      { x: LOOK.x + 1.45, z: LOOK.z, rotY: Math.PI / 2 },
      { x: LOOK.x, z: LOOK.z + 1.45, rotY: 0 },
    ];
    for (const r of railRuns) {
      e.set(0, r.rotY, Math.PI / 2);
      q.setFromEuler(e);
      m4.compose(v3.set(r.x, gy + 1.05, r.z), q, sc.set(0.045, 2.9, 0.045));
      rails.setMatrixAt(ri++, m4);
    }
    // Fahnenmast (letzte Instanz) + wehende Fahne (Updater, Muster Wäscheleine)
    m4.compose(v3.set(LOOK.x - 1.3, gy + 2.2, LOOK.z - 1.3), q.identity(), sc.set(0.07, 4.2, 0.07));
    rails.setMatrixAt(ri++, m4);
    rails.receiveShadow = true;
    scene.add(rails);
    obstacles.push({ x: LOOK.x - 1.3, z: LOOK.z - 1.3, radius: 0.18 });
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 0.62),
      new THREE.MeshStandardMaterial({ color: 0xd9534f, roughness: 0.95, side: THREE.DoubleSide }),
    );
    flag.position.set(LOOK.x - 0.7, gy + 4.0, LOOK.z - 1.3);
    scene.add(flag);
    updaters.push((dt, t) => {
      flag.rotation.y = Math.sin(t * 1.7) * 0.35;
      flag.rotation.z = Math.sin(t * 2.3 + 1) * 0.08;
    });
    addAO(LOOK.x, LOOK.z, 3.4);
    pois.push({ x: LOOK.x, z: LOOK.z, color: '#8fe0a8' });
  }

  // =========================================================================
  // 5. STRANDGUT — 8 Sammelobjekte über den bestehenden E/Y-Interakt
  // =========================================================================
  // Muster Torwächter-Prompt: sichtbares Angebot = wirksame Taste. main.js ruft
  // update() (Prompt-Anzeige) und tryPickup() (aus interactPressed) auf.
  const flotsam = [];
  {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xf2e4d0, roughness: 0.7 });
    const shellMat2 = new THREE.MeshStandardMaterial({ color: 0xe8b8a8, roughness: 0.7 });
    const bottleMat = new THREE.MeshStandardMaterial({
      color: 0x6aa89a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85,
    });
    // Positionen: über die Strände verteilt (Buchten, Nord beim Wrack, Südwest,
    // Südost), alle im Sandsaum (rOff ~ +1 .. +2 über der begehbaren Küste)
    const defs = [
      { t: -1.25, off: 1.6, kind: 'shell' },   // Südwest-Bucht (Lagerfeuer-Strand)
      { t: -1.02, off: 1.2, kind: 'wood' },
      { t: -0.55, off: 1.5, kind: 'shell' },   // Südwest-Küste
      { t: -2.6, off: 1.4, kind: 'wood' },     // Nordwest
      { t: 2.95, off: 1.8, lat: 6, kind: 'shell' }, // Nordstrand beim Wrack
      { t: 1.95, off: 1.3, kind: 'shell' },    // Ost-Bucht unter den Klippen
      { t: 1.4, off: 1.6, kind: 'shell' },     // Südost
      { t: 2.12, off: 1.0, kind: 'bottle' },   // Flaschenpost in der Ost-Bucht
    ];
    for (const d of defs) {
      const p = coastAt(d.t, d.off, d.lat || 0);
      const gy = groundY(p.x, p.z);
      let mesh;
      if (d.kind === 'shell') {
        mesh = new THREE.Mesh(geo.sphere, flotsam.length % 2 ? shellMat : shellMat2);
        mesh.scale.set(0.26, 0.14, 0.3);
        mesh.position.set(p.x, gy + 0.08, p.z);
        mesh.rotation.y = d.t * 3;
      } else if (d.kind === 'wood') {
        mesh = new THREE.Mesh(geo.cylinder, mats.trunk);
        mesh.scale.set(0.14, 1.6, 0.14);
        mesh.position.set(p.x, gy + 0.12, p.z);
        mesh.rotation.set(0.1, d.t, Math.PI / 2 - 0.08);
      } else {
        mesh = new THREE.Group();
        const body = new THREE.Mesh(geo.cylinder, bottleMat);
        body.scale.set(0.09, 0.34, 0.09);
        mesh.add(body);
        const neck = new THREE.Mesh(geo.cylinder, bottleMat);
        neck.scale.set(0.04, 0.14, 0.04);
        neck.position.y = 0.22;
        mesh.add(neck);
        const cork = new THREE.Mesh(geo.cylinder, mats.trunk);
        cork.scale.set(0.045, 0.05, 0.045);
        cork.position.y = 0.3;
        mesh.add(cork);
        mesh.position.set(p.x, gy + 0.16, p.z);
        mesh.rotation.set(0.2, d.t, Math.PI / 2 - 0.35); // liegt schräg im Sand
      }
      scene.add(mesh);
      flotsam.push({ x: p.x, z: p.z, mesh, kind: d.kind, taken: false, baseY: mesh.position.y });
    }
    // leises Wippen, damit die kleinen Objekte im Sand auffindbar sind;
    // R25 (Felix' Feedback): aufgenommene Stücke schweben NICHT mehr nach oben —
    // kurze Schrumpf-Blende AM BODEN (y bleibt baseY), dann trägt der Updater
    // sie aus; die sichtbare Rückmeldung übernimmt der HUD-Toast unten rechts.
    updaters.push((dt, t) => {
      for (let i = 0; i < flotsam.length; i++) {
        const f = flotsam[i];
        if (f.taken) {
          if (f.animT === undefined) continue; // schon entsorgt
          f.animT += dt;
          const k = Math.min(1, f.animT / PICKUP_ANIM_T);
          f.mesh.position.y = f.baseY;
          // Grundskala respektieren (Muscheln sind nicht-uniform skaliert)
          f.mesh.scale.copy(f.baseScaleV).multiplyScalar(Math.max(0.001, 1 - k));
          if (k >= 1) { scene.remove(f.mesh); f.animT = undefined; }
          continue;
        }
        f.mesh.position.y = f.baseY + Math.abs(Math.sin(t * 1.4 + i * 2.1)) * 0.04;
      }
    });
  }
  let flotsamCount = 0;

  // R24: Funken-Burst beim achten Fund — 12 kleine Muschel-helle Punkte steigen
  // radial auf und verblassen (Scale-Blende, kein Licht, kein castShadow).
  let burst = null;
  let pendingCompleteT = 0; // >0: Komplett-Zeile wartet (Flaschenpost war der 8. Fund)
  updaters.push((dt) => {
    if (pendingCompleteT <= 0) return;
    pendingCompleteT -= dt;
    if (pendingCompleteT <= 0) showLine?.(COMPLETE_LINE, 'Milo');
  });
  function spawnBurst(x, y, z) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0.95 });
    const mesh = new THREE.InstancedMesh(geo.sphere, mat, 12);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    burst = { mesh, mat, t: 0 };
  }
  updaters.push((dt) => {
    if (!burst) return;
    burst.t += dt;
    const k = Math.min(1, burst.t / BURST_T);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 0.25 + k * 1.1;
      m4.compose(
        v3.set(Math.cos(a) * r, 0.3 + k * 1.5 - k * k * 0.9, Math.sin(a) * r),
        q.identity(),
        sc.setScalar(Math.max(0.001, 0.055 * (1 - k))),
      );
      burst.mesh.setMatrixAt(i, m4);
    }
    burst.mesh.instanceMatrix.needsUpdate = true;
    burst.mat.opacity = 0.95 * (1 - k);
    if (k >= 1) {
      scene.remove(burst.mesh);
      burst.mat.dispose(); // geo.sphere ist geteilt — nur das eigene Material entsorgen
      burst = null;
    }
  });

  // R25: Aufsammel-Toast unten rechts (Markup + CSS in index.html, HUD-Stil).
  // Timer läuft über den rAF-Updater des Spiels, NICHT über setTimeout — so
  // pausiert der Toast mit dem Spiel und Chrome-Drosselung greift nicht.
  const toastEl = typeof document !== 'undefined' ? document.getElementById('pickup-toast') : null;
  let toastT = 0;
  const KIND_LABEL = { shell: 'Muschel aufgesammelt', wood: 'Treibholz aufgesammelt', bottle: 'Flaschenpost gelesen' };
  function showToast(kind, count) {
    if (!toastEl) return;
    toastEl.textContent = `${KIND_LABEL[kind]} · Strandgut ${count}/${FLOTSAM_TOTAL}`;
    toastEl.classList.add('show');
    toastT = TOAST_HOLD_T;
  }
  updaters.push((dt) => {
    if (toastT <= 0) return;
    toastT -= dt;
    if (toastT <= 0) toastEl?.classList.remove('show');
  });

  // Prompt-DOM (Markup + CSS in index.html, Stil des Turm-Prompts)
  const promptEl = typeof document !== 'undefined' ? document.getElementById('discover-prompt') : null;
  const promptTextEl = promptEl ? promptEl.querySelector('#discover-prompt-text') : null;
  let promptShown = false;
  function setPrompt(visible, text) {
    if (visible && promptTextEl && promptTextEl.textContent !== text) promptTextEl.textContent = text;
    if (visible === promptShown) return;
    promptShown = visible;
    promptEl?.classList.toggle('show', visible);
  }

  function nearestFlotsam(pos) {
    let best = null, bestD = Infinity;
    for (const f of flotsam) {
      if (f.taken) continue;
      const d = Math.hypot(pos.x - f.x, pos.z - f.z);
      if (d < bestD) { bestD = d; best = f; }
    }
    return bestD <= PICKUP_R ? best : null;
  }

  // =========================================================================
  // 6. RUNDWEG — Trittspuren über die neuen Orte (Fortsetzung der R21-Spuren)
  // =========================================================================
  {
    const trailPts = [];
    function addTrail(x0, z0, x1, z1, steps, wobble) {
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        trailPts.push({
          x: x0 + (x1 - x0) * k + Math.sin(k * 9.7) * wobble,
          z: z0 + (z1 - z0) * k + Math.cos(k * 7.3) * wobble,
        });
      }
    }
    const bay = coastAt(-1.25, -6);        // Lagerfeuer-Strand (Südwest-Bucht)
    const bay2 = coastAt(2.05, -4);        // Ost-Bucht unter den Klippen
    // Rundweg: Bucht -> Anhöhe -> Aussichtspunkt -> Nordküste/Wrack -> Ruine ->
    // Ost-Bucht -> zurück zum Ostrand des Dorfs. Die Zubringer aus R21
    // (Dorf -> Anhöhe, Dorf -> Bucht) bleiben in arena.js.
    addTrail(bay.x, bay.z, -52, -30, 14, 1.5);             // Bucht -> Anhöhen-Fuß
    addTrail(-52, -30, HILL2.x + 6, HILL2.z + 8, 12, 1.3); // Anhöhe -> Hügelfuß
    addTrail(HILL2.x + 6, HILL2.z + 8, HILL2.x, HILL2.z, 6, 0.8); // Aufstieg (offene Geländerseite)
    addTrail(HILL2.x, HILL2.z, -34, -96, 12, 1.5);         // Hügel -> Nordwest-Strand
    addTrail(-34, -96, WRECK.x - 4, WRECK.z + 3, 12, 1.5); // -> Wrack
    addTrail(WRECK.x - 4, WRECK.z + 3, RUIN.x, RUIN.z, 12, 1.4); // Wrack -> Ruine
    addTrail(RUIN.x, RUIN.z, bay2.x, bay2.z, 14, 1.5);     // Ruine -> Ost-Bucht
    addTrail(bay2.x, bay2.z, 44, -6, 14, 1.5);             // Ost-Bucht -> Dorf-Ostrand
    const trailMat = new THREE.MeshStandardMaterial({
      color: 0x6a5436, transparent: true, opacity: 0.3,
      depthWrite: false, roughness: 1.0,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    const trail = new THREE.InstancedMesh(geo.decal, trailMat, trailPts.length);
    for (let i = 0; i < trailPts.length; i++) {
      const p = trailPts[i];
      e.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      q.setFromEuler(e);
      m4.compose(
        v3.set(p.x, groundY(p.x, p.z) + 0.03, p.z),
        q,
        sc.set(1.1 + Math.random() * 0.5, 0.8 + Math.random() * 0.4, 1),
      );
      trail.setMatrixAt(i, m4);
    }
    scene.add(trail);
  }

  // ---- Kontakt-AO unter Wrack/Klippen/Ruine/Plattform (Muster flair.js) ----
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

  // Selbstkontrolle (Muster flair.js): kein neuer Kollider verengt einen Dorf-Weg
  if (ctx.pathDefs) {
    checkPathsClear(ctx.pathDefs, obstacles,
      ['Hafenweg', 'Turmweg', 'Westweg', 'Ostweg', 'Nordwestweg']);
  }

  return {
    pois,
    // pro Frame aus main.js (nur echtes Spielen, Ruhephase): Prompt-Anzeige
    update(rawDt, playerPos, interactAllowed) {
      if (!interactAllowed) { setPrompt(false); return; }
      const f = nearestFlotsam(playerPos);
      if (!f) { setPrompt(false); return; }
      setPrompt(true, f.kind === 'bottle' ? 'Flaschenpost lesen' : 'Strandgut aufsammeln');
    },
    // aus interactPressed() (main.js): true = der Druck wurde hier verbraucht
    tryPickup(playerPos) {
      const f = nearestFlotsam(playerPos);
      if (!f) return false;
      f.taken = true;
      // R25: kurze Schrumpf-Blende am Boden (kein Heben), der Wipp-Updater
      // entsorgt danach (geteilte geo/mats — kein dispose)
      f.animT = 0;
      f.baseScaleV = f.mesh.scale.clone();
      flotsamCount++;
      showToast(f.kind, flotsamCount);
      if (f.kind === 'bottle') showLine?.(BOTTLE_LINE);
      // R24: der achte Fund ist der Payoff — Funken-Moment + Milo-Zeile.
      // Ist die Flaschenpost selbst der achte Fund, wartet die Zeile kurz,
      // damit sie die Flaschenpost-Zeile nicht überschreibt.
      if (flotsamCount === FLOTSAM_TOTAL) {
        spawnBurst(f.x, groundY(f.x, f.z) + 0.3, f.z);
        if (f.kind === 'bottle') pendingCompleteT = 5.5;
        else showLine?.(COMPLETE_LINE, 'Milo');
      }
      setPrompt(false);
      return true;
    },
    // stiller Zähler für den Ruhe-Strip („Strandgut 3/8") — leer bis zum ersten
    // Fund; R24: komplett gesammelt trägt er einen Haken
    flotsamLabel() {
      if (flotsamCount >= FLOTSAM_TOTAL) return `Strandgut ${FLOTSAM_TOTAL}/${FLOTSAM_TOTAL} ✓`;
      return flotsamCount > 0 ? `Strandgut ${flotsamCount}/${FLOTSAM_TOTAL}` : '';
    },
  };
}
