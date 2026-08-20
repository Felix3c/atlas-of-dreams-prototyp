// island/villagers.js — Dorfbewohner (Runde 14): das Hafendorf bekommt Leben.
//
// WARUM Instancing statt Figuren-Gruppen wie kai.js/hero.js: 10 Bewohner à ~10 Meshes
// wären ~100 Draw-Calls plus dieselbe Zahl noch einmal im Schattenpass — auf der
// Ziel-iGPU nicht bezahlbar. Stattdessen fährt jede Figur ein reines Object3D-Skelett,
// das NIE in der Szene hängt; pro Frame wird nur dessen matrixWorld in fünf
// InstancedMeshes kopiert. Ergebnis: 5 Draw-Calls für ALLE zehn Bewohner (4 davon noch
// einmal im Schattenpass, der AO-Fleck wirft keinen). Das Dorf drumherum zeichnet
// weitere Meshes — village.js legt z.B. eine eigene InstancedMesh für die
// Türöffnungen an. Die Körperfarben kommen aus instanceColor, nicht aus 10 Materialien.
import * as THREE from 'three';
import { aoTexture } from './textures.js';

// ---------- Maße des Skeletts (lokale Einheiten, root steht auf dem Boden) ----------
const HIP_Y = 0.82;          // Hüfthöhe = Beinlänge
const BODY_R = 0.32;         // weicher Körperradius fürs Ausweichen

// ---------- Verhalten ----------
const WALK_SPEED = 1.35;
const FLEE_SPEED = 4.3;      // Panik — deutlich schneller als der Spaziergang
const RETURN_SPEED = 1.9;
const TURN_RATE = 7;
const LOOKAHEAD = 3.2;       // Hindernis-Vorausschau der Lenkung
const PUSH_SMOOTH = 6;       // Nachziehen der Ausweichstärke (Zeitkonstante ~0.17 s)
const FLAT_TOP_MAX = 0.3;    // flache Trittflächen (Stegplanken) blockieren nicht
const PLAYER_SOFT_R = 1.15;  // ab hier tritt der Bewohner zur Seite
const HOME_LEASH = 0.9;      // so weit darf ein Standposten-Bewohner verdrängt werden
const ARRIVE_R = 1.0;        // Wegpunkt gilt als erreicht
// Tempo der gescripteten Kurzstrecken. Die DAUER kommt aus der Distanz, nicht umgekehrt —
// eine feste Dauer ergab je nach Haus 6-9 m/s und damit einen Tempo-Sprung am Türrahmen.
const ENTER_SPEED = 3.8;     // knapp unter FLEE_SPEED: Abbremsen statt Beschleunigen
const EXIT_SPEED = 2.2;      // heraustreten, danach geht es mit RETURN_SPEED weiter
const MOUNT_SPEED = 1.1;     // sich hinsetzen / hinter die Theke treten
const MOUNT_RESCUE_R = 2.0;  // ab hier wird ein festhängender Anker-Bewohner versetzt
const DISMOUNT_SPEED = 1.6;  // von der Kiste steigen
const ENTER_NEAR = 2.2;      // nur aus dieser Nähe darf der Not-Eintritt lerpen
const VANISH_DUR = 0.3;      // Not-Ausblendung an Ort und Stelle
// Absenktiefe der Not-Ausblendung: mehr als die Standhöhe der größten Figur.
// Höchster Punkt ist die Hutspitze bei 0.82 (Hüfte) + 0.58 + 0.30 + 0.085 = 1.785
// lokal, mal SIZES-Maximum 1.08 = 1.93 m. Bei 2.0 m schaut nichts mehr heraus.
const SINK_DEPTH = 2.0;
const DOOR_HOLD = 0.3;       // so lange bleibt die Tür nach dem letzten Durchgang offen
// Vorlauf des Türblatts vor dem Heraustreten. village.js schwingt mit Rate 2.6 pro
// Sekunde auf: nach 0.25 s (= 15 Frames, in denen der Tür-Updater vor den Bewohnern
// läuft) steht das Blatt zu 48.6 % offen — 82.1° von 169°. Erst danach setzt sich die
// Figur überhaupt in Bewegung. Ohne den Vorlauf startete das Blatt im selben Frame wie
// der Schritt und der Rumpf schnitt sichtbar durchs Holz.
// (Die Prozentzahl ist am echten Updater gemessen, nicht aus der Kurve gerechnet.)
const DOOR_LEAD = 0.45;
// Gegenstück beim HINEINlaufen, als Distanz statt als Zeit: das Blatt beginnt schon
// aufzuschwingen, während die Figur noch auf den Vorplatz zurennt. Ohne diesen Vorlauf
// startete das Aufschwingen im selben Frame wie der Eintritts-Lerp — und wer die Kurve
// schnitt, stand dann bereits 1.4 m vor der Fassade, während das Blatt erst zu 17 %
// offen war. Gemessen wurde genau das: Rumpfmitte 0.64 m neben der Türachse, 0.92 m vor
// der Wand, Blatt bei 62 % — 0.37 m Rumpf im Holz. 5 m sind bei FLEE_SPEED gut 1 s
// Vorlauf; das Blatt steht dann an der Fassade, wo es die Anlaufspuren freigibt.
// Was BLEIBT (ehrlich, weil nachgemessen und vorher falsch zugeordnet): der Rest ist
// NICHT der Türpfosten, sondern weiter das Blatt. Bei 169° liegen zwei seiner vier
// Grundriss-Ecken immer noch in der 1.14 m breiten Öffnung — das Scharnier selbst sitzt
// bei lokal x = -0.55 innerhalb des Pfostens bei -0.57 und kann sie bauartbedingt bei
// KEINEM Winkel verlassen. Mit off = 0.25 bleiben davon -0.003 m gelebte Luft übrig
// (vorher -0.064 m); den Rest deckt die Türöffnung optisch ab.
const DOOR_LEAD_DIST = 5.0;
const SAME_LEVEL_Y = 2.0;    // Reaktionen nur auf gleicher Höhe (nicht aufs Dach hinauf)
const STUCK_TIME = 2.5;      // ohne Fortschritt -> Ziel neu wählen (Softlock-Bremse)
// Zeitbudget für EINEN Türanlauf. STUCK_TIME greift nur bei Stillstand — eine Figur, die
// um eine Prop-Gruppe kreist, macht Strecke und gilt deshalb nie als festhängend. Genau
// das trat auf, als der M1-Fix die Wege verschob und damit die (gewürfelte) Prop-Streuung
// neu auslegte: der Sitzende rannte 89 m in 25 s um die Kistengruppe bei (20,8.5), ohne
// je anzukommen (Prüfstand, Seed 1). Nach DOOR_GIVEUP zählt der Anlauf als gescheitert
// und es geht dieselbe Leiter hinunter wie beim Steckenbleiben: andere Tür, nach drei
// Versuchen der Notausgang.
const DOOR_GIVEUP = 9;
const SEPARATION = 0.64;     // Bewohner laufen nicht durcheinander hindurch
// Distanz-Abstufung. Ehrlich gerechnet: die Gesten-Mathematik ist billig, teuer sind
// Skelett-Matrizen + Instanz-Upload. Deshalb spart erst die FAR-Stufe wirklich etwas —
// dort friert die Pose ein und die Matrizen werden nur noch 2x/s geschrieben.
const LOD_NEAR = 32;         // darüber: kein Blickkontakt zum Spieler mehr
const LOD_FAR = 48;          // darüber: Pose eingefroren
const FAR_REFRESH = 0.5;
// ---------- Reaktionen auf den Spieler (Runde 17, Aufgabe A) ----------
// Alles hier ist Kosmetik auf dem Kopf-Gelenk plus eine Geh-Pause — KEINE neue
// Bewegungslogik. Innehalten läuft ausschließlich im 'walk'-Zustand über das
// vorhandene pauseT; die Flucht bleibt unberührt (maxStall_fleePhase_s).
const LOOK_R = 7;            // ab hier folgt der Kopf dem Spieler kontinuierlich
const GREET_R = 2.4;         // sehr nahes Vorbeigehen: einmaliges Gruß-Nicken
const GREET_DUR = 0.7;       // Dauer des Nickens (Halbsinus, ein Dip)
const GREET_CD = 9;          // danach Ruhe — sonst nickt das Dorf wie ein Wackeldackel
const YIELD_R = 2.1;         // der Spieler kreuzt dicht vor der Figur den Weg
const YIELD_AHEAD = 0.45;    // ... und zwar VOR ihr (cos-Schwelle), nicht hinter ihr
const YIELD_CD = 6;          // Innehalten frühestens alle 6 s wieder
// "Kreuzen" heißt BEWEGEN: ein stehender Spieler löst kein Innehalten aus — um ihn
// trägt das weiche Ausweichen die Figur herum. Ohne dieses Gate nagelte der statische
// Prüfstand-Spieler am Platz die Spaziergänger alle 6 s fest und verschob damit die
// Wellen-Startpositionen (gemessen: Flucht-Stall 0.68 -> 2.4 s, doorLeaf-Drift).
const YIELD_MIN_SPEED = 0.5;
// WICHTIG: Die Reaktionen ziehen KEINE globalen Zufallszahlen. Jede Math.random()-
// Ziehung im Update verschiebt den geteilten RNG-Strom aller Subsysteme (offener
// Punkt "RNG-Ströme pro Subsystem", Runde 15) und damit sämtliche Folge-Würfe —
// gemessen als Drift in doorLeaf/moonwalk, obwohl kein Bewegungscode angefasst war.
// Variation kommt deshalb deterministisch aus v.seed.
function seededFrac(seed) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- Aussehen ----------
const SKIN = [0xe8b184, 0xd39a6a, 0xb87a4e, 0xf0c39a];
const SHIRT = [0xc9553f, 0x5f7f9a, 0xd9b25a, 0x7a8f5c, 0xa8556f, 0xdfd3b4, 0x4f6d8a];
const PANTS = [0x6b5c46, 0x4a5566, 0x7d6b50, 0x555f6e]; // mitteltonig — fast-schwarze Beine lasen sich als Stelzen
const HAIRC = [0x2a1c14, 0x4a3020, 0x6b4a2a, 0x1a1a1e, 0x8a6a44];
const KERCHIEF = [0xd15a45, 0xdfd3b4, 0x5f8f7a];
const BOOT = 0x3d3028;
const STRAW = 0xd9bc7a;
const EYE = 0x241a14;
// bewusst von Hand gesetzt statt zufällig: der Größenmix ist so garantiert sichtbar
const SIZES = [1.00, 0.93, 1.06, 0.97, 1.02, 0.90, 1.08, 0.95, 1.04, 0.99];

// Geteilter Geometrie-Cache — EIN Satz für alle Bewohner (Codebase-Stil aus arena.js).
// limb trägt Rumpf, Arme UND Beine; nur die Instanz-Skalierung unterscheidet sie.
const vgeo = {
  limb: new THREE.CapsuleGeometry(0.5, 1.0, 3, 8), // lokale Gesamthöhe 2, Radius 0.5
  hat: new THREE.ConeGeometry(0.3, 0.17, 8),
  ao: new THREE.PlaneGeometry(1, 1),
};

// Rollen & Standposten. Alle Posten sind von Hand gegen die Kollider aus village.js
// geprüft — kein Bewohner startet in einer Wand, einem Fass oder einem Karren.
// anchor = der EINE Kollider, in dem die Figur legitim steht (Händler hinter der
// Theke, Sitzender auf der Kiste); nur dieser wird beim Push-out ignoriert.
const DEFS = [
  { role: 'walk', path: 0, seg: 1, dir: 1, prop: 'basket' },   // Platz -> Hafen
  { role: 'walk', path: 2, seg: 2, dir: -1, prop: 'sack' },    // Westhäuser
  { role: 'walk', path: 3, seg: 1, dir: 1, prop: 'rod' },      // Osthäuser, Angler
  { role: 'merchant', x: 9.31, z: 25.55, yaw: 2.600, prop: 'fruit', anchor: [9.77, 24.78] },
  { role: 'chat', x: -5.65, z: 12.00, yaw: -1.571 },
  { role: 'chat', x: -6.93, z: 12.74, yaw: 2.616 },
  { role: 'chat', x: -6.93, z: 11.26, yaw: 0.526 },
  { role: 'well', x: 0.90, z: 7.60, yaw: -2.629, prop: 'bucket' },
  { role: 'laundry', x: -11.30, z: -17.45, yaw: 2.931, prop: 'cloth' },
  // sitzt auf der Kistenkante (nicht in der Mitte, sonst steckten die Beine im Holz)
  { role: 'sit', x: 9.536, z: 7.449, yaw: -2.442, anchor: [10, 8], sitTop: 1.4 },
];

const _dir = { x: 0, z: 0 };
const _tgt = { x: 0, z: 0 };   // wiederverwendetes Zielobjekt — kein Müll pro Frame
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _pos3 = new THREE.Vector3();
const _scl3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _aoQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

function shortestAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function buildVillagers(ctx) {
  const {
    scene, obstacles, geo, groundHeightAt, clampToWalkable, updaters,
    pathDefs = [], doorSpots = [],
  } = ctx;

  const N = DEFS.length;

  // Kollider-Vorfilter: obstacles wächst nach createArena nicht mehr, also einmal die
  // flachen Trittflächen aussortieren statt pro Frame und pro Bewohner neu zu prüfen.
  const blockers = obstacles.filter(
    (o) => !(o.topY !== undefined && o.topY <= FLAT_TOP_MAX) && o.radius > 0.15
  );

  // ---------- Material & Meshes ----------
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const aoMat = new THREE.MeshBasicMaterial({
    map: aoTexture(), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4,
  });

  const bodyMesh = new THREE.InstancedMesh(vgeo.limb, bodyMat, N * 5);  // Rumpf + 2 Arme + 2 Beine
  const sphMesh = new THREE.InstancedMesh(geo.sphere, bodyMat, N * 3);  // Kopf + Haar/Tuch + Kugel-Ware
  // 2 Füße + Kasten-Ware + 2 Augen: die Augen kosten keinen zusätzlichen Draw-Call,
  // machen aus dem Kopf aus der Nähe aber erst ein Gesicht
  const boxMesh = new THREE.InstancedMesh(geo.box, bodyMat, N * 5);
  const hatMesh = new THREE.InstancedMesh(vgeo.hat, bodyMat, N);
  const aoMesh = new THREE.InstancedMesh(vgeo.ao, aoMat, N);

  const solid = [bodyMesh, sphMesh, boxMesh, hatMesh];
  for (const m of solid) {
    m.castShadow = true;
    m.receiveShadow = true;
    // InstancedMesh.computeBoundingSphere() rechnet zwar über instanceMatrix, merkt
    // sich das Ergebnis aber, bis es jemand von Hand verwirft. Unsere Instanzen wandern
    // JEDEN Frame durchs Dorf — die Hülle wäre sofort veraltet und Figuren würden am
    // Bildrand wegploppen. Sie pro Frame neu zu rechnen kostet mehr als die fünf
    // Draw-Calls, die das Culling im besten Fall spart. Also immer zeichnen.
    m.frustumCulled = false;
  }
  aoMesh.frustumCulled = false;
  aoMesh.renderOrder = 1;
  // Erst alles auf Nullskalierung: ungenutzte Hut-/Waren-Plätze bleiben unsichtbar,
  // ohne dass die Update-Schleife sie je anfassen muss.
  for (const m of [...solid, aoMesh]) {
    for (let i = 0; i < m.count; i++) m.setMatrixAt(i, _zero);
  }
  for (const m of solid) scene.add(m);
  scene.add(aoMesh);

  // ---------- Anker-Zustände ----------
  // Sitzt die Figur gerade legitim auf ihrer Kiste? Gilt im Ruhezustand, in der
  // gescripteten Setz-Bewegung und in der Schrecksekunde beim Fluchtstart. Beim
  // Absteigen bewusst NICHT — dort soll die Hüfte mit dem Schritt von der Kante
  // herunterwandern, statt dass die Beine im Holz versinken.
  function seated(v) {
    if (v.role !== 'sit') return false;
    return v.state === 'idle' || v.state === 'mount'
      || (v.state === 'flee' && v.reactT > 0);
  }

  // Der Anker (Theke/Kiste) ist NUR dort kein Hindernis, wo die Figur legitim darauf
  // oder dahinter steht: Ruheposten plus die kurzen Auf-/Absteige-Schritte. In allen
  // Lauf-Zuständen zählt er normal — sonst führte die Fluchtroute des Händlers quer
  // durch Theke und Pfosten.
  function anchorOf(v) {
    if (!v.anchor) return null;
    const s = v.state;
    if (s === 'idle' || s === 'mount' || s === 'dismount') return v.anchor;
    if (s === 'flee' && v.reactT > 0) return v.anchor;
    return null;
  }

  // steht die Figur innerhalb ihres Anker-Kolliders? Dann muss sie vor dem Losrennen
  // erst heraustreten, sonst schleudert der Push-out sie in einem Frame heraus.
  function insideAnchor(v) {
    if (!v.anchor) return false;
    return Math.hypot(v.pos.x - v.anchor.x, v.pos.z - v.anchor.z)
      < v.anchor.radius + BODY_R;
  }

  // ---------- Ruhehöhe ----------
  // Der Sitzende hat die Hüfte auf der Kistenkante; alle anderen stehen auf dem Relief.
  function restingY(v) {
    const gy = groundHeightAt(v.pos.x, v.pos.z);
    if (seated(v)) return gy + v.sitTop - HIP_Y * v.s;
    return gy;
  }

  // ---------- Skelettbau ----------
  const col = new THREE.Color();
  function node(parent, x, y, z) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    if (parent) parent.add(o);
    return o;
  }

  const villagers = [];

  for (let i = 0; i < N; i++) {
    const def = DEFS[i];
    const s = SIZES[i % SIZES.length];
    const skin = SKIN[i % SKIN.length];
    const shirt = SHIRT[i % SHIRT.length];
    const pants = PANTS[(i * 2 + 1) % PANTS.length];
    const headStyle = i % 3 === 0 ? 'hat' : (i % 3 === 1 ? 'kerchief' : 'hair');
    const capColor = headStyle === 'kerchief'
      ? KERCHIEF[i % KERCHIEF.length] : HAIRC[(i * 3) % HAIRC.length];
    const sleeve = i % 2 === 0 ? skin : shirt; // kurze und lange Ärmel gemischt

    // --- Knochen: hängen NIE in der Szene, sie liefern nur Matrizen ---
    const root = new THREE.Object3D();
    root.scale.setScalar(s);
    // Proportionen an hero.js/kai.js angelehnt: Bein-zu-Rumpf-Verhältnis ~0.38,
    // sonst steht eine Blase auf zwei Stelzen. Rumpf überlappt Hüfte und Schädel,
    // damit an Taille und Hals keine Lücke aufreißt.
    const hipL = node(root, -0.125, HIP_Y, 0);
    const hipR = node(root, 0.125, HIP_Y, 0);
    const legL = node(hipL, 0, -0.40, 0); legL.scale.set(0.21, 0.40, 0.21);
    const legR = node(hipR, 0, -0.40, 0); legR.scale.set(0.21, 0.40, 0.21);
    const footL = node(hipL, 0, -0.79, 0.06); footL.scale.set(0.16, 0.08, 0.26);
    const footR = node(hipR, 0, -0.79, 0.06); footR.scale.set(0.16, 0.08, 0.26);
    const torso = node(root, 0, HIP_Y, 0);
    const chest = node(torso, 0, 0.30, 0); chest.scale.set(0.54, 0.33, 0.40);
    const shoulderL = node(torso, -0.28, 0.50, 0);
    const shoulderR = node(torso, 0.28, 0.50, 0);
    const armL = node(shoulderL, 0, -0.26, 0); armL.scale.set(0.145, 0.26, 0.145);
    const armR = node(shoulderR, 0, -0.26, 0); armR.scale.set(0.145, 0.26, 0.145);
    const headPivot = node(torso, 0, 0.58, 0);
    const skull = node(headPivot, 0, 0.155, 0); skull.scale.set(0.155, 0.17, 0.155);
    const cap = node(headPivot, 0, 0.20, -0.015); cap.scale.set(0.168, 0.15, 0.168);
    const hat = headStyle === 'hat' ? node(headPivot, 0, 0.30, 0) : null;
    const eyeL = node(headPivot, -0.058, 0.175, 0.147); eyeL.scale.set(0.048, 0.026, 0.02);
    const eyeR = node(headPivot, 0.058, 0.175, 0.147); eyeR.scale.set(0.048, 0.026, 0.02);

    // --- getragene Ware: entweder eine Kasten- ODER eine Kugel-Requisite ---
    // Positionen sind auf die jeweilige Armhaltung in pose() ausgerechnet.
    let propBox = null;
    let propSph = null;
    switch (def.prop) {
      case 'basket':
        propBox = node(torso, 0, 0.27, 0.42);
        propBox.scale.set(0.34, 0.26, 0.28);
        break;
      case 'rod':
        propBox = node(torso, 0.30, 0.72, -0.30);
        propBox.scale.set(0.035, 1.8, 0.035);
        propBox.rotation.set(-0.60, 0, 0.10);
        break;
      case 'bucket':
        propBox = node(torso, 0, 0.42, 0.46);
        propBox.scale.set(0.19, 0.20, 0.19);
        break;
      case 'cloth':
        propBox = node(torso, 0, 0.78, 0.40);
        propBox.scale.set(0.30, 0.34, 0.02);
        break;
      case 'sack':
        propSph = node(torso, 0.30, 0.86, -0.28);
        propSph.scale.set(0.20, 0.24, 0.20);
        break;
      case 'fruit':
        propSph = node(shoulderR, 0, -0.56, 0.06); // liegt in der Hand, folgt dem Arm
        propSph.scale.setScalar(0.085);
        break;
      default: break;
    }

    // --- Instanz-Farben (einmalig gesetzt) ---
    bodyMesh.setColorAt(i * 5 + 0, col.setHex(shirt));
    bodyMesh.setColorAt(i * 5 + 1, col.setHex(sleeve));
    bodyMesh.setColorAt(i * 5 + 2, col.setHex(sleeve));
    bodyMesh.setColorAt(i * 5 + 3, col.setHex(pants));
    bodyMesh.setColorAt(i * 5 + 4, col.setHex(pants));
    sphMesh.setColorAt(i * 3 + 0, col.setHex(skin));
    sphMesh.setColorAt(i * 3 + 1, col.setHex(capColor));
    boxMesh.setColorAt(i * 5 + 0, col.setHex(BOOT));
    boxMesh.setColorAt(i * 5 + 1, col.setHex(BOOT));
    boxMesh.setColorAt(i * 5 + 3, col.setHex(EYE));
    boxMesh.setColorAt(i * 5 + 4, col.setHex(EYE));
    if (hat) hatMesh.setColorAt(i, col.setHex(STRAW));
    if (propBox) {
      boxMesh.setColorAt(i * 5 + 2, col.setHex(
        def.prop === 'cloth' ? 0xdfd3b4 : (def.prop === 'rod' ? 0x6b4a2a : 0x9c7a4a)
      ));
    }
    if (propSph) {
      sphMesh.setColorAt(i * 3 + 2, col.setHex(def.prop === 'fruit' ? 0xd4593a : 0x8a6a48));
    }

    // --- Laufzeit-Zustand ---
    let role = def.role;
    let path = null;
    if (role === 'walk') {
      path = pathDefs[def.path];
      // Ohne Wegenetz kein Spaziergänger — dann bleibt die Figur als Standposten stehen
      if (!path || path.length < 2) { role = 'chat'; path = null; }
    }
    const home = path
      ? { x: path[def.seg][0], z: path[def.seg][1] }
      : { x: def.x, z: def.z };

    const v = {
      i,
      role,
      def,
      s,
      path,
      seg: def.seg ?? 0,
      dir: def.dir ?? 1,
      lat: i % 2 === 0 ? 0.55 : -0.55,   // Gehspur neben der Wegmitte
      side: i % 2 === 0 ? 1 : -1,        // bevorzugte Ausweichseite bei frontalem Hindernis
      avoidSide: 0,                      // gehaltene Ausweichseite (0 = frei)
      push: 0,                           // geglättete Ausweichstärke
      home,
      homeYaw: def.yaw ?? 0,
      sitTop: def.sitTop ?? 0,
      anchor: null,
      mountX: home.x, mountZ: home.z,   // Vorplatz des Ankers (unten ausgerechnet)
      chat: false,                      // Mitglied einer Plaudergruppe
      shrink: 1,                        // 1 -> 0 während der Not-Ausblendung (Absenken)
      shrinkT: 0,
      sank: false,                      // im Boden abgetaucht statt durch eine Tür
      sinkX: home.x, sinkZ: home.z,     // Ort des Abtauchens = Ort der Rückkehr
      lookX: home.x, lookZ: home.z,     // wen der Standposten gerade anschaut
      pos: new THREE.Vector3(home.x, 0, home.z),
      prev: { x: home.x, z: home.z },
      rootY: 0,
      yaw: def.yaw ?? 0,
      state: path ? 'walk' : 'idle',
      phase: Math.random() * 6.28,
      seed: i * 1.7,
      speed: 0,
      pauseT: 0,
      gesture: 0,
      gestureT: 1 + Math.random() * 3,
      headTarget: 0,
      glanceT: 1 + Math.random() * 4,
      greetT: 0,         // laufendes Gruß-Nicken (zählt auf 0 herunter)
      greetCd: 0,        // Abklingzeit bis zum nächsten Gruß
      yieldCd: 0,        // Abklingzeit bis zum nächsten Innehalten
      faceT: 0,          // solange dreht sich der KÖRPER zum Störer (Blind-Befund R17)
      faceDelayT: 0,     // R18: Kopf-Sakkade zuerst — der Körper folgt erst nach dieser Frist
      noticeT: 0,        // R18: Rest-Latenz, bis die Figur den nahen Spieler bemerkt
      noticed: false,    // R18: Spieler in der Nah-Zone wahrgenommen (mit Hysterese)
      cueT: 0,           // R18: Kaskade — verzögerter Gruppen-Blick nach dem Gruß des Nachbarn
      cueX: 0, cueZ: 0,  // ... und wohin der Spieler dabei stand
      sidestepT: 0,
      stuckT: 0,
      detourT: 0,        // Restzeit des laufenden Umwegs um eine Prop-Klemme
      detourX: 0, detourZ: 0,
      stuckMem: [],      // die letzten Klemmen — dorthin führt kein zweiter Umweg
      doorT: 0,          // Laufzeit des aktuellen Türanlaufs (siehe DOOR_GIVEUP)
      lastX: home.x,
      lastZ: home.z,
      door: null,
      tried: [],
      lerpT: 0,
      lerpDur: 0.5,
      lerpSpeed: 0.5,
      fromX: 0, fromZ: 0, fromY: 0, toX: 0, toZ: 0,
      // Welle kam mitten in einer gescripteten Kurzstrecke: erst deren Ende abwarten
      fleeAfterLerp: false,
      // Zustand NACH dem Absteige-Lerp. Normalerweise 'flee' (deshalb ist abgestiegen
      // worden); wird der Sieg noch während der Schrecksekunde gemeldet, biegt
      // returnHome() ihn auf den Heimweg um, statt den Ausstieg zu überspringen (L3).
      afterDismount: 'flee',
      reactT: 0,
      hidden: false,
      wasHidden: true,   // erzwingt das erste Schreiben der Matrizen
      farT: 0,
      n: {
        root, hipL, hipR, legL, legR, footL, footR, torso, chest,
        shoulderL, shoulderR, armL, armR, headPivot, skull, cap, hat,
        eyeL, eyeR, propBox, propSph,
      },
    };
    if (def.anchor) {
      let best = null; let bestD = Infinity;
      for (const o of blockers) {
        const d = Math.hypot(o.x - def.anchor[0], o.z - def.anchor[1]);
        if (d < bestD) { bestD = d; best = o; }
      }
      if (bestD < 1.5) v.anchor = best;
    }
    if (v.anchor) {
      // Vorplatz: der Punkt auf der Linie Anker-Zentrum -> Heimpunkt, knapp AUSSERHALB
      // des Kolliders. Von dort wird auf- und abgestiegen; er ist damit auch das
      // Rückkehrziel — der Heimpunkt selbst liegt innerhalb des Kolliders und wäre
      // im Lauf-Zustand gar nicht erreichbar.
      const ux = v.home.x - v.anchor.x;
      const uz = v.home.z - v.anchor.z;
      const l = Math.hypot(ux, uz) || 1;
      const out = v.anchor.radius + BODY_R + 0.05;
      v.mountX = v.anchor.x + (ux / l) * out;
      v.mountZ = v.anchor.z + (uz / l) * out;
    }
    v.rootY = restingY(v);
    villagers.push(v);
  }
  for (const m of solid) if (m.instanceColor) m.instanceColor.needsUpdate = true;

  // ---------- Plaudergruppen ----------
  // Reden ist ein Wechselspiel, kein Zufallsrauschen: pro Gruppe wandert ein
  // Sprecher-Token. Wer es hat, gestikuliert; EIN Zuhörer nickt, die übrigen stehen
  // ruhig. Zwischen zwei Beiträgen liegt eine kurze Stille, in der niemand redet.
  // Genau das unterscheidet eine Unterhaltung von drei synchron nickenden Figuren.
  const CHAT_R = 3.0;   // so nah stehen Gesprächspartner beieinander
  const chatGroups = [];
  {
    const grouped = new Set();
    for (const v of villagers) {
      if (v.role !== 'chat' || grouped.has(v)) continue;
      const members = [v];
      grouped.add(v);
      for (const o of villagers) {
        if (o === v || o.role !== 'chat' || grouped.has(o)) continue;
        if (Math.hypot(o.home.x - v.home.x, o.home.z - v.home.z) < CHAT_R) {
          members.push(o);
          grouped.add(o);
        }
      }
      if (members.length < 2) continue;    // allein redet niemand
      for (const m of members) m.chat = true;
      const speaker = Math.floor(Math.random() * members.length);
      chatGroups.push({
        members,
        speaker,
        // Zuhörer, der nickt — per Konstruktion nie der Sprecher selbst
        nodder: (speaker + 1 + Math.floor(Math.random() * (members.length - 1)))
          % members.length,
        pause: false,
        t: 1 + Math.random() * 2,
      });
    }
  }

  // wählt einen neuen Sprecher (nie zweimal denselben) und einen Zuhörer, der nickt
  function nextSpeaker(g) {
    const n = g.members.length;
    let next = g.speaker;
    while (next === g.speaker) next = Math.floor(Math.random() * n);
    g.speaker = next;
    let nod = next;
    while (nod === next) nod = Math.floor(Math.random() * n);
    g.nodder = nod;
  }

  function updateChat(dt) {
    for (const g of chatGroups) {
      g.t -= dt;
      if (g.t <= 0) {
        if (g.pause) { g.pause = false; nextSpeaker(g); g.t = 2 + Math.random() * 3; }
        else { g.pause = true; g.t = 0.4 + Math.random() * 0.7; } // Gesprächspause
      }
      for (let k = 0; k < g.members.length; k++) {
        const m = g.members[k];
        // 0 = ruhig, 1 = gestikuliert (Sprecher), 2 = nickt (Zuhörer)
        if (m.state !== 'idle' || g.pause) m.gesture = 0;
        else if (k === g.speaker) m.gesture = 1;
        else m.gesture = k === g.nodder ? 2 : 0;
      }
    }
  }

  // ---------- Bewegung ----------

  // Lenkung: Wunschrichtung + tangentiales Ausscheren vor dem nächsten Kollider.
  // Gemessen wird die OBERFLÄCHEN-Distanz (along - radius). Mit der Zentrumsdistanz
  // fielen Häuser (Kollider-Radius 3.9-5.7) nie in die 3.2-m-Vorausschau, obwohl die
  // Figur schon an der Wand klebte — gelenkt wurde faktisch nur um Fässer.
  // Die Ausweichstärke ist der noch fehlende Seitenversatz geteilt durch die
  // Reststrecke: ein Haus drückt dadurch um ein Vielfaches stärker zur Seite als ein
  // Fass. Das bleibt lokale Lenkung ohne Wegsuche — die Figur läuft an der Wand
  // entlang, bis sie die Ecke rundet; der Push-out ist weiter das Sicherheitsnetz.
  //
  // Seite UND Stärke werden über Frames gehalten, nicht pro Frame neu gewürfelt:
  // frontal vor einem Haus schwankt bestLat um Null, das Vorzeichen kippte im
  // Zwei-Frame-Takt und der Körper zuckte mit 30 Hz. v.avoidSide wird deshalb erst
  // wieder freigegeben, wenn die Figur DEUTLICH seitlich am Hindernis vorbeizielt
  // (|lat| > halbe Freibreite); v.push zieht mit einer Zeitkonstante von ~0.17 s nach.
  function steer(v, tx, tz, dt) {
    let dx = tx - v.pos.x;
    let dz = tz - v.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) { _dir.x = 0; _dir.z = 0; return 0; }
    dx /= dist; dz /= dist;
    const skip = anchorOf(v);
    let bestGap = Infinity; let bestLat = 0; let bestClear = 1;
    for (const o of blockers) {
      if (o === skip) continue;
      const ox = o.x - v.pos.x;
      const oz = o.z - v.pos.z;
      const along = ox * dx + oz * dz;
      if (along <= 0) continue;                  // liegt hinter der Laufrichtung
      const gap = along - o.radius;              // bis zur Kollider-Oberfläche
      if (gap > LOOKAHEAD || gap >= bestGap) continue;
      // Was HINTER dem Ziel liegt, geht die Figur nichts an. Ohne diese Zeile wich sie
      // dem Haus aus, zu dessen Tür der Weg führt: der Endwegpunkt liegt dicht am
      // Kollider-Rand, die Lenkung drückte davon weg und die Figur umkreiste ihr Ziel.
      if (gap > dist) continue;
      const clear = o.radius + BODY_R + 0.35;
      const lat = -ox * dz + oz * dx;            // Anteil auf der Links-Normalen
      if (Math.abs(lat) > clear) continue;       // der Kurs geht ohnehin daran vorbei
      bestGap = gap; bestLat = lat; bestClear = clear;
    }
    const k = Math.min(1, dt * PUSH_SMOOTH);
    if (bestGap < Infinity) {
      // Hysterese: einmal gewählte Seite behalten, bis der Kurs klar daneben zielt.
      //
      // BEFUND M3 ("zusätzlich freigeben, sobald ein anderer Kollider der nächste wird")
      // wurde gebaut, GEMESSEN und wieder ausgebaut — er macht das Dorf schlechter, nicht
      // besser. Der Prüfstand über 8 Seeds x 92 s, jeweils gegen diesen Stand:
      //
      //   Variante                         Stösse>4.6m/s  tiefste Durchdr.  Moonwalk  Umkehr/s max
      //   dieser Stand (Seite wird gehalten)          15           0.530 m    1.047 %        1.24
      //   Wortlaut: bei bestO-Wechsel frei           623           0.923 m    0.756 %        3.15
      //   + nur wenn die Seite ins Hindernis zeigt   473           0.816 m    0.754 %        3.15
      //   + Standzeit 0.45 s auf der Seite           320           0.816 m    1.346 %        3.15
      //   + zusätzlich erst ab 1.6 m Abstand          15           0.530 m    1.047 %        1.24
      //
      // Der Grund steht in der letzten Zeile: mit Abstandsgrenze ist die Variante
      // BITGLEICH mit diesem Stand — der beschriebene Fall tritt also ausschliesslich
      // im Nahbereich unter 1.6 m auf. Genau dort ist das Umschalten fatal: in der
      // Kistengruppe bei (14,-6) tauschen zwei Kisten im Frame-Takt die Rolle des
      // nächsten Kolliders, die Figur wechselt an jeder die Seite und schraubt sich in
      // den Haufen, statt an ihm entlangzuschrammen. Die 623 Stösse sind der Push-out,
      // der sie 12 cm pro Frame wieder herausdrückt; 0.92 m Durchdringung bei
      // Kistenradius 0.67 heisst: der Rumpf steht auf der Kistenmitte.
      // Die gehaltene Seite ist also kein Fehler, sondern das, was die Figur durch
      // dichte Prop-Gruppen bringt.
      if (!v.avoidSide || Math.abs(bestLat) > 0.5 * bestClear) {
        v.avoidSide = Math.abs(bestLat) < 0.08 ? v.side : (bestLat > 0 ? -1 : 1);
      }
      // läuft bei |lat| -> clear stetig auf 0 aus: am Rand des Hindernisses pendelt
      // die Lenkung deshalb nicht zwischen "ausweichen" und "geradeaus"
      const want = Math.min(3, (bestClear - Math.abs(bestLat)) / Math.max(bestGap, 0.6));
      v.push += (want - v.push) * k;
      const px = -dz; const pz = dx;
      dx += px * v.avoidSide * v.push;
      dz += pz * v.avoidSide * v.push;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
    } else {
      // freie Bahn: Ausweichen weich auslaufen lassen statt hart abzuschalten
      v.push += (0 - v.push) * k;
      v.avoidSide = 0;
    }
    _dir.x = dx; _dir.z = dz;
    return dist;
  }

  function faceDir(v, dx, dz, dt) {
    if (dx * dx + dz * dz < 1e-6) return;
    v.yaw += shortestAngle(Math.atan2(dx, dz) - v.yaw) * Math.min(1, dt * TURN_RATE);
  }

  function faceYaw(v, yaw, dt) {
    v.yaw += shortestAngle(yaw - v.yaw) * Math.min(1, dt * TURN_RATE);
  }

  // Weiches Ausweichen vor allem, was sich bewegt: Spieler, Kai und lebende Marines.
  // Die Punkte kommen als fertige Liste aus main.js herein (siehe update()), damit
  // sie pro Frame EINMAL statt pro Bewohner aufgebaut wird. Bewusst KEIN harter
  // Kollider: die Korrektur zieht nur nach, niemand kann eingeklemmt werden und die
  // Kampfphysik (Steh-Flächen, Push-out, Wellen-Logik) bleibt unberührt.
  function avoidActors(v, avoid, dt) {
    if (!avoid || !avoid.n) return;
    // Der Sitzende bleibt sitzen — an ihn kommt man wegen des Kisten-Kolliders
    // ohnehin kaum heran, und ein Schubs würde ihn von der Kante schieben.
    if (seated(v)) return;
    for (let i = 0; i < avoid.n; i++) {
      const p = avoid.pts[i];
      // Höhengate: wer auf dem Dach oder dem Wachturm über der Figur steht, drängt
      // sie nicht zur Seite
      const dy = p.y - v.rootY;
      if (dy > SAME_LEVEL_Y || dy < -SAME_LEVEL_Y) continue;
      const dx = v.pos.x - p.x;
      const dz = v.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > PLAYER_SOFT_R || d < 1e-4) continue;
      const want = (PLAYER_SOFT_R - d) * Math.min(1, dt * 7);
      v.pos.x += (dx / d) * want;
      v.pos.z += (dz / d) * want;
      v.sidestepT = 0.7;
      v.lookX = p.x; v.lookZ = p.z;   // den Störer schaut der Standposten an
    }
  }

  // Bewohner untereinander: jeder schiebt sich selbst aus dem fremden Körperradius,
  // in JEDEM Zustand (auch am Standposten — sonst kann der Spieler zwei Plauderer
  // ineinanderschieben). Es gibt nur Abstoßung, keine Anziehung, also kein Pendeln;
  // die Heim-Leine im idle-Zustand stellt die Gruppenaufstellung danach wieder her.
  function separate(v) {
    for (const o of villagers) {
      if (o === v || o.hidden) continue;
      const dx = v.pos.x - o.pos.x;
      const dz = v.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= SEPARATION || d < 1e-4) continue;
      const push = (SEPARATION - d) * 0.6;
      v.pos.x += (dx / d) * push;
      v.pos.z += (dz / d) * push;
    }
  }

  function pushOut(v) {
    const skip = anchorOf(v);
    for (const o of blockers) {
      if (o === skip) continue;
      const dx = v.pos.x - o.x;
      const dz = v.pos.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.radius + BODY_R;
      if (d < min && d > 1e-3) {
        v.pos.x = o.x + (dx / d) * min;
        v.pos.z = o.z + (dz / d) * min;
      }
    }
  }

  // Frame-Bremse: EIN Frame darf die Figur nie weiter versetzen, als sie laufen kann.
  //
  // Schritt, Ausweichen, Nachbarn, Push-out und Begehbarkeits-Grenze schreiben
  // nacheinander in dieselbe Position; ihre Summe ist nicht gedeckelt. Genau dort steckte
  // die schnellste gemessene Bewegung (7.75 m/s, Seed 1, Bewohner 9, t=37.35) — und sie
  // ist KEIN Teleport, sondern eine entladene Feder:
  //   Die Figur klemmt bei (13.6,-4.0) zwischen zwei Kollidern, deren Ausweichkreise sich
  //   überlappen — Mittenabstand 1.605 m, nötig wären 0.61+0.50+2*BODY_R = 1.750 m; die
  //   gelebte Lücke ist 0.495 m, der Rumpf braucht 0.64 m. pushOut() läuft EINMAL und der
  //   REIHE NACH: er stellt die Figur sauber vor den ersten Kollider, der zweite schiebt
  //   sie wieder hinein, und der erste wird nicht noch einmal geprüft. Was bleibt, ist
  //   Durchdringung, die von Frame zu Frame wächst (gemessen 0.068 -> 0.145 m — genau die
  //   Überlapptiefe der beiden Kreise). Sobald der zweite Kollider aus dem Weg ist, gibt
  //   der erste den ganzen Rückstand in EINEM Frame zurück: 0.129 m statt 0.072 m.
  // Eine Zwangsauflösung ist kein Schritt. Sie darf die Figur versetzen, aber nicht
  // schneller, als die Figur läuft; der Rest wird im nächsten Frame nachgeholt. Die
  // Klemme selbst bleibt — sie steckt in der Prop-Streuung, nicht hier —, sie sieht jetzt
  // aber aus wie ein Herausdrücken und nicht mehr wie ein Katapult.
  // Bewusst NICHT gedeckelt sind die gescripteten Kurzstrecken (Tür, Auf-/Absteigen):
  // die haben ihr Tempo in beginLerp() bereits selbst gesetzt.
  function limitFrameStep(v, dt) {
    const dx = v.pos.x - v.prev.x;
    const dz = v.pos.z - v.prev.z;
    const d = Math.hypot(dx, dz);
    const max = FLEE_SPEED * dt;
    if (d <= max || d < 1e-9) return;
    const k = max / d;
    v.pos.x = v.prev.x + dx * k;
    v.pos.z = v.prev.z + dz * k;
  }

  // ein Bewegungsschritt inkl. Grenze, Kollision und Fortschritts-Wächter
  function step(v, tx, tz, speed, dt, avoid) {
    const dist = steer(v, tx, tz, dt);
    v.prev.x = v.pos.x;
    v.prev.z = v.pos.z;
    // ERST drehen, DANN in die Blickrichtung gehen — nicht umgekehrt.
    //
    // Vorher sprang die Position im selben Frame auf die neue Wunschrichtung, während
    // v.yaw ihr mit TURN_RATE hinterherlief (pro Frame nur dt*7 = 11.7 % des Restwinkels).
    // Bei einer Kehre — Wegende in advanceWaypoint(), neue Tür, Heimweg — sind das rund
    // 9 Frames, in denen die Figur mit vollem Tempo RÜCKWÄRTS läuft. Genau das war der
    // Moonwalk: gemessen z.B. Seed 1, Bewohner 2, t=7.47 s, 1.35 m/s bei dot = -0.91 und
    // 21.5 rad/s Drehrate. Der Fehler stand also nicht in faceDir(), sondern darin, dass
    // Position und Blickrichtung aus DERSELBEN Wunschrichtung zwei verschiedene Tempi
    // gemacht haben.
    //
    // Jetzt trägt v.yaw die Bewegung: die Figur dreht sich zuerst (unverändert mit
    // TURN_RATE) und geht dann dorthin, wohin sie schaut. Das Tempo wird zusätzlich mit
    // dem Ausrichtungsanteil skaliert — wer noch quer zum Ziel steht, dreht sich fast auf
    // der Stelle und beschleunigt erst, wenn er hinschaut. Eine 180°-Kehre dauert damit
    // ~0.2 s statt 0 s; das ist der sichtbare Unterschied und er ist der richtige.
    faceDir(v, _dir.x, _dir.z, dt);
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const align = Math.max(0, fx * _dir.x + fz * _dir.z);
    const move = Math.min(speed * dt, Math.max(dist, 0)) * align;
    v.pos.x += fx * move;
    v.pos.z += fz * move;
    avoidActors(v, avoid, dt);
    separate(v);
    pushOut(v);
    clampToWalkable(v.pos, v.prev);
    limitFrameStep(v, dt);
    // Animationstempo aus der VORWÄRTS-Verschiebung: (pos - prev) auf die Blickrichtung
    // projiziert. Das ist genau die Komponente, die ein Schritt erzeugt — die rohe
    // Schrittlänge wäre falsch (seitliches Wegrutschen an einer Wand ließe die Füße mit
    // vollem Tempo laufen = Moonwalk), der Fortschritt AUFS ZIEL aber auch:
    // er wird schon dann null, wenn die Figur zwar läuft, aber nicht auf ihr Ziel zu.
    // Genau das passiert beim Umlenken um ein Haus und wenn der Spieler schiebt — die
    // Beine froren ein, während der Körper steifbeinig weiterglitt (Befund M2).
    // v.prev steht auf dem Stand VOR dieser Bewegung, v.yaw ist unmittelbar davor
    // nachgeführt worden; die Projektion enthält damit auch Ausweich- und Push-out-Anteile.
    //
    // BETRAG, nicht Math.max(0, …): rückwärts ist auch eine Beinbewegung. Mit dem
    // einseitigen Clip stand die Beinanimation still, sobald der Spieler die Figur nach
    // HINTEN schob — genau der Fehler, den M2 abstellen sollte, nur mit umgekehrtem
    // Vorzeichen (gemessen: legsVsBody_stiffFrames 0.609 % unter --shove).
    const fwd = (v.pos.x - v.prev.x) * Math.sin(v.yaw) + (v.pos.z - v.prev.z) * Math.cos(v.yaw);
    v.speed = dt > 0 ? Math.min(1, Math.abs(fwd) / dt / FLEE_SPEED) : 0;
    // Fortschritts-Wächter: wer festhängt, bekommt ein neues Ziel statt zu zittern
    if (Math.hypot(v.pos.x - v.lastX, v.pos.z - v.lastZ) > 0.3) {
      v.lastX = v.pos.x; v.lastZ = v.pos.z; v.stuckT = 0;
    } else {
      v.stuckT += dt;
    }
    return dist;
  }

  // an Ort und Stelle bleiben (Pause, Standposten): trotzdem Akteure, Nachbarn,
  // Kollider und Grenze prüfen
  function holdPosition(v, avoid, dt) {
    v.prev.x = v.pos.x;
    v.prev.z = v.pos.z;
    avoidActors(v, avoid, dt);
    separate(v);
    pushOut(v);
    clampToWalkable(v.pos, v.prev);
    limitFrameStep(v, dt);
  }

  // ---------- Ausweg aus einer Prop-Klemme ----------
  // Die Lenkung in steer() ist rein lokal und kennt immer nur den NÄCHSTEN Kollider. In
  // einer Lücke, die schmaler ist als der Rumpf, hilft ihr das nicht: sie weicht dem einen
  // aus und drückt damit in den anderen. Gemessen an der Runde-15-Grundlinie (Seed 2,
  // Bewohner 6): die Figur stand ab t=65.8 s bis zum Ende des Laufs — 26 Sekunden — bei
  // (-12.36, 5.50) zwischen den Kollidern (-12.46,6.54) r=0.73 und (-11.51,5.20) r=0.58.
  // Deren Mittenabstand ist 1.642 m, nötig wären 0.73+0.58+2*BODY_R = 1.95 m; die Lücke
  // misst 0.332 m, der Rumpf braucht 0.64 m. Es ist derselbe Prop-Haufen, der in Runde 14
  // schon Bewohner 4 gehalten hat.
  // Der bisherige Ausweg ("Ausweichseite umkehren") KONNTE nicht wirken: steer() rechnet
  // v.avoidSide im nächsten Frame aus bestLat neu, sobald der Kurs deutlich seitlich am
  // Hindernis vorbeizielt — die umgekehrte Seite überlebte kein einziges Bild.
  // Jetzt bekommt die Figur ein echtes Zwischenziel: unter allen Richtungen die, in die
  // sie überhaupt ein Stück weit FREI laufen kann und deren Endpunkt dem Ziel am nächsten
  // liegt. Das ist keine Wegsuche, sondern ein Sichtstrahl je Richtung — und er läuft nur
  // beim Festfahren, also im schlimmsten Fall alle paar Sekunden einmal.
  // Ein Umweg allein reicht NICHT, und das ist gemessen: mit reiner Gier ("freie
  // Richtung, deren Endpunkt dem Heimpunkt am nächsten liegt") lief Bewohner 4 in Seed 2
  // einen sauberen Kreis — Klemme bei (-12.4,5.5), Umweg nach (-13.7,2.4), von dort
  // wieder heimwärts, dieselbe Klemme, alle 9 s von vorn, bis der Lauf endete. Der Grund
  // steht in der Freiraum-Karte: der Prop-Haufen von z=3.3 bis z=10.8 hat auf der
  // Heimseite KEINE Gasse; wer hindurch will, muss östlich um ihn herum (ab x > -10.5 ist
  // alles frei). Der beste Strahl vom Umwegpunkt aus zeigt aber wieder nach Nordost,
  // direkt in die Sackgasse — er verkürzt den Luftweg ja tatsächlich am meisten.
  // Deshalb merkt sich die Figur, WO sie festhing, und ein Umweg darf dort nicht wieder
  // enden. Damit fällt die Gier auf die zweitbeste Gasse zurück, und das ist genau die
  // nach Osten, um den Haufen herum. Drei Einträge reichen; ältere Klemmen sind für die
  // aktuelle Lage nicht mehr aussagekräftig.
  const DETOUR_MAX = 4.5;    // so weit wird höchstens ausgeholt
  const DETOUR_MIN = 1.8;    // kürzer ist keine Gasse, sondern eine Nische
  const DETOUR_TIME = 5;     // Notbremse, falls auch der Umweg blockiert
  const DETOUR_ARRIVE = 0.5;
  const DETOUR_MEM = 3;      // so viele Klemmen bleiben in Erinnerung
  const DETOUR_MEM_R = 2.0;  // so nah darf ein Umweg an einer alten Klemme enden

  // freie Strecke auf einem Strahl (Einheitsrichtung), höchstens maxLen
  function rayReach(v, dx, dz, maxLen) {
    const skip = anchorOf(v);
    let reach = maxLen;
    for (const o of blockers) {
      if (o === skip) continue;
      const ox = o.x - v.pos.x; const oz = o.z - v.pos.z;
      const along = ox * dx + oz * dz;
      if (along <= 0) continue;                      // liegt hinter dieser Richtung
      const r = o.radius + BODY_R;
      const lat = -ox * dz + oz * dx;
      if (Math.abs(lat) >= r) continue;              // der Strahl geht daran vorbei
      const hit = along - Math.sqrt(r * r - lat * lat);
      if (hit < reach) reach = hit;
    }
    return reach;
  }

  // Ist der direkte Weg zum Ziel verstellt? Der letzte halbe Meter zählt nicht mit: bei
  // den Anker-Rollen steht dort bauartbedingt der eigene Kollider (der Vorplatz liegt
  // genau an seinem Rand), und dicht am Ziel ist ein Umweg ohnehin sinnlos.
  function wayBlocked(v, gx, gz) {
    const dx = gx - v.pos.x; const dz = gz - v.pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 2.0) return false;
    const want = Math.min(l - 0.6, DETOUR_MAX);
    return rayReach(v, dx / l, dz / l, want) < want - 1e-3;
  }

  function findDetour(v, gx, gz) {
    let best = null;
    let fallback = null;     // falls JEDE Gasse an einer alten Klemme endet
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = Math.sin(a); const dz = Math.cos(a);
      const reach = rayReach(v, dx, dz, DETOUR_MAX);
      if (reach < DETOUR_MIN) continue;
      const tx = v.pos.x + dx * reach;
      const tz = v.pos.z + dz * reach;
      const score = Math.hypot(gx - tx, gz - tz);    // wer bringt am meisten Heimweg?
      if (!fallback || score < fallback.score) fallback = { tx, tz, score };
      let seen = false;
      for (const m of v.stuckMem) {
        if (Math.hypot(tx - m.x, tz - m.z) < DETOUR_MEM_R) { seen = true; break; }
      }
      if (seen) continue;
      if (!best || score < best.score) best = { tx, tz, score };
    }
    return best || fallback;
  }

  // Umweg starten. Findet sich keine freie Gasse, bleibt es beim alten Notbehelf
  // (Ausweichseite kippen) — besser als gar nichts zu tun.
  function startDetour(v, gx, gz) {
    v.stuckMem.unshift({ x: v.pos.x, z: v.pos.z });
    if (v.stuckMem.length > DETOUR_MEM) v.stuckMem.length = DETOUR_MEM;
    const d = findDetour(v, gx, gz);
    if (d) {
      v.detourX = d.tx; v.detourZ = d.tz; v.detourT = DETOUR_TIME;
    } else {
      v.avoidSide = v.avoidSide ? -v.avoidSide : (v.side || 1);
    }
    v.push = 0;
    v.stuckT = 0; v.lastX = v.pos.x; v.lastZ = v.pos.z;
  }

  // ---------- Wege ----------
  function waypoint(v) {
    const p = v.path[v.seg];
    const prev = v.path[Math.max(0, Math.min(v.path.length - 1, v.seg - v.dir))];
    let dx = p[0] - prev[0];
    let dz = p[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1;
    // seitlich versetzt: die Bewohner gehen auf ihrer Spur, nicht exakt auf der Mittellinie
    _tgt.x = p[0] + (-dz / l) * v.lat;
    _tgt.z = p[1] + (dx / l) * v.lat;
    return _tgt;
  }

  function advanceWaypoint(v) {
    v.seg += v.dir;
    if (v.seg >= v.path.length || v.seg < 0) {
      v.dir *= -1;
      v.seg = Math.max(0, Math.min(v.path.length - 1, v.seg + v.dir * 2));
      v.pauseT = 1.4 + Math.random() * 2.6; // am Wegende kurz stehen und schauen
    } else if (Math.random() < 0.25) {
      v.pauseT = 1.2 + Math.random() * 2.2;
    }
    v.stuckT = 0;
    v.lastX = v.pos.x;
    v.lastZ = v.pos.z;
    clearAvoid(v);
  }

  // Ausweich-Zustand gehört zum ALTEN Ziel: Seite, Stärke und der Kollider, für den sie
  // gewählt wurden, beziehen sich auf den bisherigen Kurs. Über einen Zielwechsel
  // hinweg mitgenommen drückt die Figur im ersten Moment in die falsche Richtung, und
  // die Hysterese hält diese falsche Seite dann auch noch fest (Befund L1).
  function clearAvoid(v) {
    v.push = 0;
    v.avoidSide = 0;
    // Ein Umweg gehört ebenso zum alten Ziel wie die Ausweichseite: er wurde für einen
    // Heimweg gewählt, der mit dem Zielwechsel hinfällig ist.
    v.detourT = 0;
  }

  // ---------- Flucht ----------
  let fleeing = false;

  // Türbelegung als Token: eine Tür gehört genau einem Flüchtenden, von der Wahl bis
  // zum Heraustreten. Ohne das liefen zwei Bewohner auf denselben Innenpunkt ix/iz zu —
  // und weil separate() im Tür-Lerp aus ist, verschmolzen sie dort ~1 s lang.
  // 14 Türen für 10 Bewohner: es bleibt immer eine übrig.
  const doorOwner = new Map();   // Türspot -> Bewohner, der sie gerade beansprucht

  // gibt nur frei, was diesem Bewohner auch gehört — eine veraltete v.door-Referenz
  // darf die Reservierung eines anderen nicht abräumen
  function releaseDoor(v) {
    if (v.door && doorOwner.get(v.door) === v) doorOwner.delete(v.door);
  }

  function pickDoor(v) {
    releaseDoor(v);
    let best = null; let bestD = Infinity;
    for (const d of doorSpots) {
      if (v.tried.includes(d)) continue;
      const owner = doorOwner.get(d);
      if (owner && owner !== v) continue;
      const dd = (d.ax - v.pos.x) ** 2 + (d.az - v.pos.z) ** 2;
      if (dd < bestD) { bestD = dd; best = d; }
    }
    if (!best) {
      // alles schon probiert oder belegt: von vorn, dann zählt nur noch die Nähe
      v.tried.length = 0;
      for (const d of doorSpots) {
        const dd = (d.ax - v.pos.x) ** 2 + (d.az - v.pos.z) ** 2;
        if (dd < bestD) { bestD = dd; best = d; }
      }
    }
    if (best) { v.tried.push(best); doorOwner.set(best, v); }
    return best;
  }

  function doorApproach(v) {
    const d = v.door;
    // Versatz quer zur Tür: die drei Spuren fächern den VORPLATZ auf, damit nicht alle
    // exakt dieselbe Linie anlaufen.
    //
    // 0.25, nicht 0.5 — wie in RUNDE14-STAND verlangt. Die frühere Begründung fürs
    // Beibehalten von 0.5 stützte sich auf zwei Zahlen aus einem idealisierten
    // Spurmodell (Trichter direkt auf die Türachse), das die Figuren nicht laufen:
    // "0.060 m Versatz im Türmund" und "+0.19 m Luft zum Pfosten". GEMESSEN an den
    // echten Bahnen waren es 0.263 m Versatz und -0.013 m, also Schulter IM Pfosten.
    // Mit 0.25: schlechteste gelebte Türblatt-Luft -0.0637 -> -0.0028 m, Berührframes
    // 29 -> 6 über 3 Seeds. Der Vorplatz fächert damit immer noch auf (drei Spuren,
    // 0.5 m Abstand zueinander) — es steht nur niemand mehr im Türrahmen.
    const off = ((v.i % 3) - 1) * 0.25;
    _tgt.x = d.ax + d.nz * off;
    _tgt.z = d.az - d.nx * off;
    return _tgt;
  }

  function startFlee(v) {
    v.tried.length = 0;
    v.door = pickDoor(v);
    if (!v.door) return;
    v.state = 'flee';
    v.fleeAfterLerp = false;               // erledigt — die Figur rennt ab jetzt selbst
    v.afterDismount = 'flee';              // nach dem Absteigen wird gerannt, nicht heimgegangen
    v.reactT = 0.12 + Math.random() * 0.5; // Schrecksekunde: nicht alle im selben Frame
    v.stuckT = 0;
    v.doorT = 0;
    v.pauseT = 0;
    v.lastX = v.pos.x;
    v.lastZ = v.pos.z;
    v.stuckMem.length = 0;   // neues Ziel, neue Lage — alte Klemmen sind hinfällig
    clearAvoid(v);
  }

  // Zustände, in denen gerade eine gescriptete Kurzstrecke läuft. In ihnen ist die
  // Kollision bewusst aus (der Tür-Lerp führt DURCH die Hauswand), der Zustand darf
  // deshalb von aussen NICHT einfach überschrieben werden: die Figur stünde im nächsten
  // Frame mitten im Kollider und pushOut schleuderte sie heraus. returnHome() hat diesen
  // Schutz für 'dismount' bekommen (L3) — flee() brauchte ihn genauso.
  const LERP_STATES = ['entering', 'exiting', 'mount', 'dismount', 'approach'];

  // Gescriptete Kurzstrecke (Tür, Auf-/Absteigen). Die Dauer kommt aus der DISTANZ,
  // damit das sichtbare Tempo zur Laufgeschwindigkeit passt statt am Türrahmen zu
  // springen; lerpSpeed hält zusätzlich die Beinanimation im selben Takt.
  function beginLerp(v, state, speed, tx, tz, minDur, maxDur) {
    const dist = Math.hypot(tx - v.pos.x, tz - v.pos.z);
    v.state = state;
    v.lerpDur = Math.max(minDur, Math.min(maxDur, dist / speed));
    v.lerpT = 0;
    v.fromX = v.pos.x; v.fromZ = v.pos.z;
    v.fromY = v.rootY;   // Starthöhe für das synchrone Auf-/Absteigen
    v.toX = tx; v.toZ = tz;
    v.lerpSpeed = Math.min(1, dist / v.lerpDur / FLEE_SPEED);
  }

  // durch die Tür treten: Türblatt aufschwingen lassen (village.js animiert es)
  function enterDoor(v) {
    v.door.openT = DOOR_HOLD;
    beginLerp(v, 'entering', ENTER_SPEED, v.door.ix, v.door.iz, 0.3, 1.3);
  }

  // ---------- Pose ----------
  function pose(v, dt, t, lod, playerPos) {
    const n = v.n;
    const sp = v.speed;
    v.phase += dt * (3.2 + sp * 8.5);
    const sw = Math.sin(v.phase);
    const swing = sw * (0.05 + sp * 0.8);
    const sitting = seated(v);

    n.hipL.rotation.x = swing + (sitting ? 0.20 : 0);
    n.hipR.rotation.x = -swing + (sitting ? 0.14 : 0);

    // Grundhaltung: Arme gegenläufig zum Beinschwung und leicht NACH AUSSEN gestellt
    // (negatives z = links auswärts) — anliegend verschwinden sie in der Rumpfsilhouette
    let axL = -swing * 0.75;
    let axR = swing * 0.75;
    let azL = -0.10;
    let azR = 0.10;

    // 'dismount' und 'vanish' gehören zur Flucht: die Panikhaltung darf zwischen
    // Aufschrecken, Absteigen und Losrennen nicht kurz auf Spazierarme zurückfallen
    if (v.state === 'flee' || v.state === 'dismount' || v.state === 'vanish') {
      // Panik: Arme hoch und mitschlagend — auch aus 30 m als Flucht lesbar
      axL = -1.9 + Math.sin(v.phase * 2) * 0.4;
      axR = -1.9 - Math.sin(v.phase * 2) * 0.4;
      azL = 0.5; azR = -0.5;
    } else if (v.def.prop === 'basket') {
      axL = -1.15; axR = -1.15; azL = 0.20; azR = -0.20;  // Korb mit beiden Händen
    } else if (v.def.prop === 'sack') {
      axR = 2.35; azR = -0.15;                            // Sack über der Schulter
    } else if (v.def.prop === 'rod') {
      axR = 2.10; azR = -0.20;                            // Angelrute geschultert
    }

    // 'mount' zählt mit: der Sitzende soll die Hände schon beim Hinsetzen auf den
    // Knien haben, der Händler beim Hintertreten seine Ware sortieren
    if (lod < 2 && (v.state === 'idle' || v.state === 'mount')) {
      // Kleine Lebenszeichen — hier zählt der Rollen-Charakter, nicht komplexe KI
      switch (v.role) {
        case 'merchant': {
          const near = playerPos
            // nur auf gleicher Höhe winken, nicht zum Spieler auf dem Dach hinauf
            && Math.abs(playerPos.y - v.rootY) < SAME_LEVEL_Y
            && Math.hypot(playerPos.x - v.pos.x, playerPos.z - v.pos.z) < 6.5;
          if (near) {
            axR = -2.35; azR = 0.3 + Math.sin(t * 8) * 0.4;   // winkt Vorbeigehende an
            axL = -0.85 + Math.sin(t * 1.5) * 0.20;
          } else {
            axL = -0.85 + Math.sin(t * 1.5) * 0.24;           // hantiert mit der Ware
            axR = -0.85 - Math.sin(t * 1.5 + 1.1) * 0.24;
            azR = -0.30;
          }
          azL = 0.30;
          break;
        }
        case 'well': {
          const pull = Math.sin(t * 0.85 + v.seed);
          axL = -1.5 + pull * 0.5; axR = -1.5 + pull * 0.5;
          azL = 0.22; azR = -0.22;
          if (n.propBox) n.propBox.position.y = 0.42 + pull * 0.25; // Eimer folgt den Händen
          break;
        }
        case 'laundry': {
          const reach = Math.sin(t * 0.9 + v.seed);
          axL = -2.20 + reach * 0.28; axR = -2.20 - reach * 0.28;
          azL = 0.28; azR = -0.28;
          break;
        }
        case 'sit': {
          axL = 0.35; axR = 0.35; azL = 0.30; azR = -0.30;   // Hände auf den Knien
          break;
        }
        default: {
          if (v.gesture === 1) {                             // gestikuliert beim Reden
            axR = -0.80 - Math.sin(t * 4.5 + v.seed) * 0.45;
            azR = 0.35;
          }
          break;
        }
      }
      n.headPivot.rotation.x = v.gesture === 2 ? Math.sin(t * 3.2 + v.seed) * 0.11 : 0; // nickt
      n.torso.rotation.z = Math.sin(t * 0.6 + v.seed) * 0.045;                          // Gewicht verlagern
    } else {
      n.headPivot.rotation.x = 0;
      n.torso.rotation.z = 0;
    }

    // Gruß-Nicken: EIN deutlicher Dip als Halbsinus über die Grußdauer, additiv auf
    // das, was der Zustand dem Kopf sonst gibt (beim Plauder-Nicker addiert es sich —
    // der grüßt dann eben etwas tiefer, das ist kein Fehler, das ist Höflichkeit).
    if (v.greetT > 0) {
      n.headPivot.rotation.x += Math.sin((1 - v.greetT / GREET_DUR) * Math.PI) * 0.32;
    }

    n.shoulderL.rotation.set(axL, 0, azL);
    n.shoulderR.rotation.set(axR, 0, azR);

    // Rumpf: Wippen und Vorlage aus dem Tempo
    n.torso.position.y = HIP_Y + Math.abs(sw) * (0.006 + sp * 0.05);
    n.torso.rotation.x = sp * 0.16;
    n.headPivot.rotation.y += shortestAngle(v.headTarget - n.headPivot.rotation.y)
      * Math.min(1, dt * 4);
  }

  // ---------- Instanz-Matrizen schreiben ----------
  function writeAll(v, hide) {
    const n = v.n;
    const b = v.i * 5;   // Rumpf/Arme/Beine und Füße/Ware/Augen: je 5 Plätze
    const s3 = v.i * 3;  // Kopf/Haar/Kugel-Ware: 3 Plätze
    if (hide) {
      for (let k = 0; k < 5; k++) {
        bodyMesh.setMatrixAt(b + k, _zero);
        boxMesh.setMatrixAt(b + k, _zero);
      }
      for (let k = 0; k < 3; k++) sphMesh.setMatrixAt(s3 + k, _zero);
      hatMesh.setMatrixAt(v.i, _zero);
      aoMesh.setMatrixAt(v.i, _zero);
      return;
    }
    bodyMesh.setMatrixAt(b + 0, n.chest.matrixWorld);
    bodyMesh.setMatrixAt(b + 1, n.armL.matrixWorld);
    bodyMesh.setMatrixAt(b + 2, n.armR.matrixWorld);
    bodyMesh.setMatrixAt(b + 3, n.legL.matrixWorld);
    bodyMesh.setMatrixAt(b + 4, n.legR.matrixWorld);
    sphMesh.setMatrixAt(s3 + 0, n.skull.matrixWorld);
    sphMesh.setMatrixAt(s3 + 1, n.cap.matrixWorld);
    if (n.propSph) sphMesh.setMatrixAt(s3 + 2, n.propSph.matrixWorld);
    boxMesh.setMatrixAt(b + 0, n.footL.matrixWorld);
    boxMesh.setMatrixAt(b + 1, n.footR.matrixWorld);
    if (n.propBox) boxMesh.setMatrixAt(b + 2, n.propBox.matrixWorld);
    boxMesh.setMatrixAt(b + 3, n.eyeL.matrixWorld);
    boxMesh.setMatrixAt(b + 4, n.eyeR.matrixWorld);
    if (n.hat) hatMesh.setMatrixAt(v.i, n.hat.matrixWorld);
    // Kontaktschatten am Boden (derselbe Fake-AO-Trick wie in arena.js), eine
    // Instanz je Bewohner. Der Sitzende bekommt keinen — sein Fleck läge unter der Kiste.
    if (seated(v)) {
      aoMesh.setMatrixAt(v.i, _zero);
    } else {
      // Der Fleck blendet mit v.shrink aus, während die Figur im Boden versinkt
      const r = 0.62 * v.s * v.shrink;
      _pos3.set(v.pos.x, groundHeightAt(v.pos.x, v.pos.z) + 0.07, v.pos.z);
      _scl3.set(r, r, 1);
      _m4.compose(_pos3, _aoQ, _scl3);
      aoMesh.setMatrixAt(v.i, _m4);
    }
  }

  // ---------- Frame-Update ----------
  // avoid = { pts, n }: von main.js pro Frame befüllte Liste der Ausweich-Punkte
  // (Spieler, Kai, lebende Marines). Wird hier nur gelesen — keine Allokation.
  // Spielertempo für das Innehalten-Gate (siehe YIELD_MIN_SPEED): einmal pro Frame,
  // nicht pro Bewohner. Der erste Frame liefert 0 — niemand hält beim Spawnen inne.
  const playerPrev = { x: 0, z: 0, valid: false };
  let playerSpeed = 0;

  function update(dt, t, playerPos, camPos, avoid) {
    let dirty = false;
    updateChat(dt);
    if (playerPos && dt > 0) {
      playerSpeed = playerPrev.valid
        ? Math.hypot(playerPos.x - playerPrev.x, playerPos.z - playerPrev.z) / dt
        : 0;
      playerPrev.x = playerPos.x; playerPrev.z = playerPos.z; playerPrev.valid = true;
    }

    for (const v of villagers) {
      // --- im Haus: nur der Rückkehr-Timer läuft ---
      if (v.hidden) {
        if (!v.wasHidden) { writeAll(v, true); v.wasHidden = true; dirty = true; }
        if (v.state === 'waitInside') {
          v.reactT -= dt;
          // Tür VOR dem Schritt aufschwingen lassen (siehe DOOR_LEAD)
          if (v.sank === false && v.reactT <= DOOR_LEAD) v.door.openT = DOOR_HOLD;
          if (v.reactT <= 0) {
            v.hidden = false;
            v.shrink = 1;   // eine abgetauchte Figur kommt in voller Größe zurück
            if (v.sank) {
              // Not-Ausblendung: die Figur war nie in einem Haus, sie ist an Ort und
              // Stelle im Boden verschwunden — dort taucht sie auch wieder auf.
              v.sank = false;
              v.pos.set(v.sinkX, 0, v.sinkZ);
              v.rootY = groundHeightAt(v.pos.x, v.pos.z);
              v.state = v.path ? 'walk' : 'return';
              v.stuckT = 0; v.lastX = v.pos.x; v.lastZ = v.pos.z;
              clearAvoid(v);
            } else {
              v.pos.set(v.door.ix, 0, v.door.iz);
              v.rootY = groundHeightAt(v.pos.x, v.pos.z);
              v.yaw = Math.atan2(v.door.nx, v.door.nz);
              const ap = doorApproach(v);
              beginLerp(v, 'exiting', EXIT_SPEED, ap.x, ap.z, 0.4, 1.6);
            }
          }
        }
        continue;
      }

      v.speed = 0;
      v.sidestepT = Math.max(0, v.sidestepT - dt);
      v.greetT = Math.max(0, v.greetT - dt);
      v.greetCd = Math.max(0, v.greetCd - dt);
      v.yieldCd = Math.max(0, v.yieldCd - dt);
      v.faceT = Math.max(0, v.faceT - dt);

      // Abstand zum Spieler EINMAL rechnen — Hinsehen, Gruß und Innehalten teilen ihn.
      // Das Höhengate ist dasselbe wie überall: wer auf dem Dach steht, ist kein Passant.
      let dp = Infinity;
      if (playerPos && Math.abs(playerPos.y - v.rootY) < SAME_LEVEL_Y) {
        dp = Math.hypot(playerPos.x - v.pos.x, playerPos.z - v.pos.z);
      }

      // R18: verzögerte Reaktionen feuern. (1) Kopf-Sakkade zuerst — die
      // Körperdrehung kommt erst nach faceDelayT (0.25-0.45 s); wer die Zone
      // inzwischen verlassen hat, dreht gar nicht mehr (der Gruß war dann nur
      // ein Nicken im Vorbeigehen). KEINE globalen Zufallszahlen (s. seededFrac).
      if (v.faceDelayT > 0) {
        v.faceDelayT -= dt;
        if (v.faceDelayT <= 0 && dp < LOOK_R) {
          v.faceT = GREET_DUR + 2.0;
          v.lookX = playerPos.x; v.lookZ = playerPos.z;
        }
      }
      // (2) Kaskade in der Plaudergruppe: Nachbarn schauen 0.5-1.5 s versetzt hin
      // statt im selben Frame (Kritiker-Restpunkt — synchrone Köpfe lesen als Schwarm).
      if (v.cueT > 0) {
        v.cueT -= dt;
        if (v.cueT <= 0 && v.state === 'idle') {
          const ca = shortestAngle(
            Math.atan2(v.cueX - v.pos.x, v.cueZ - v.pos.z) - v.yaw);
          v.headTarget = Math.max(-0.9, Math.min(0.9, ca));
          v.glanceT = Math.max(v.glanceT, 1.2);
        }
      }

      switch (v.state) {
        case 'walk': {
          if (v.pauseT > 0) {
            v.pauseT -= dt;
            holdPosition(v, avoid, dt);
            // Wer wegen des Spielers innehält (oder gerade gegrüßt hat), schaut
            // ihn dabei auch an — NUR im Stehen; im Gehen trägt v.yaw die
            // Bewegung und darf nicht vom Blickziel gekapert werden.
            if (v.faceT > 0) faceDir(v, v.lookX - v.pos.x, v.lookZ - v.pos.z, dt);
            break;
          }
          // Innehalten: der Spieler kreuzt dicht VOR der Figur den Weg. Nur die
          // vorhandene Geh-Pause wird gesetzt — kein neuer Zustand, keine Wirkung
          // auf Flucht oder Kennzahlen. Die Abklingzeit verhindert, dass ein
          // stehenbleibender Spieler die Figur dauerhaft festnagelt: nach der Pause
          // geht sie weiter (das weiche Ausweichen trägt sie um ihn herum) und hält
          // frühestens 6 s später wieder inne.
          if (dp < YIELD_R && v.yieldCd <= 0 && playerSpeed > YIELD_MIN_SPEED) {
            const fx = Math.sin(v.yaw);
            const fz = Math.cos(v.yaw);
            const ahead = ((playerPos.x - v.pos.x) * fx + (playerPos.z - v.pos.z) * fz)
              / Math.max(dp, 1e-4);
            if (ahead > YIELD_AHEAD) {
              v.pauseT = 0.45 + seededFrac(v.seed + t) * 0.45;
              v.yieldCd = YIELD_CD;
              v.lookX = playerPos.x; v.lookZ = playerPos.z;
              holdPosition(v, avoid, dt);
              break;
            }
          }
          const wp = waypoint(v);
          const d = step(v, wp.x, wp.z, WALK_SPEED, dt, avoid);
          // erreicht ODER hoffnungslos blockiert (Karren mitten auf dem Weg): weiter
          if (d < ARRIVE_R || v.stuckT > STUCK_TIME) advanceWaypoint(v);
          break;
        }

        case 'idle': {
          // Standposten: die Verdrängung durch den Spieler wird sanft zurückgelaufen,
          // damit über eine Runde hinweg niemand von seinem Platz wegwandert.
          holdPosition(v, avoid, dt);
          const dx = v.home.x - v.pos.x;
          const dz = v.home.z - v.pos.z;
          const d = Math.hypot(dx, dz);
          // Wer zurück auf seinen Platz geht, GEHT auch dorthin. Vorher wurde nur bei
          // gespannter Leine (d > HOME_LEASH) hingeschaut; im Nachzieh-Bereich darunter
          // lief die Figur mit 1.6 m/s heim, während faceYaw() sie weiter auf ihren
          // Ruhewinkel drehte — sichtbar rückwärts. Das war der zweite Moonwalk-Herd:
          // allein Bewohner 9 (der Sitzende, nach dem Absteige-Lerp neben seiner Kiste)
          // lieferte 133 von 696 Moonwalk-Frames über drei Seeds, im Mittel 0.41 m vom
          // Heimpunkt entfernt bei 1.1 m/s.
          // Die Ausnahme ist der Störer: solange jemand gerade vorbeigedrängt hat
          // (sidestepT) und die Leine NICHT gespannt ist, bleibt die Figur stehen und
          // schaut ihn an, statt rückwärts von ihm wegzukriechen. Sie holt ihren Platz
          // 0.7 s später nach — dann aber im Gehen und mit Blick in Laufrichtung.
          const spanned = d > HOME_LEASH;
          const walkHome = d > 0.04 && (spanned || v.sidestepT <= 0);
          if (walkHome) {
            // Heim-Leine, TEMPOBEGRENZT. Sie war eine harte Zuweisung auf den
            // Leinenkreis — und damit der einzige echte Teleport im Dorf: wer von
            // weiter weg in 'idle' kam, wurde in EINEM Frame herangerissen (gemessen
            // 7.53 m = 451.6 m/s, Seed 1, Bewohner 4, t=66.47 s, Landepunkt exakt
            // HOME_LEASH vom Heimpunkt). Jetzt zieht sie mit RETURN_SPEED nach, also
            // mit Gehtempo — die Leine bleibt im Ruhezustand dieselbe, sie wird nur
            // nicht mehr in einem Bild durchgesetzt.
            // Auch hier gilt die Reihenfolge aus step(): ERST drehen, DANN in die
            // Blickrichtung gehen. Nur "beim Heimlaufen hinschauen" genügte nicht — die
            // Drehung braucht mit TURN_RATE rund zehn Frames, die Leine zog aber vom
            // ersten Bild an mit vollem Tempo. Übrig blieben genau die Frames, in denen
            // der Sitzende nach dem Aufsetz-Lerp die letzten 0.9 m zu seiner Kiste
            // rückwärts nahm: 139 von 161 verbliebenen Moonwalk-Frames, 1.1 m/s.
            faceDir(v, dx, dz, dt);
            const fx = Math.sin(v.yaw);
            const fz = Math.cos(v.yaw);
            const align = Math.max(0, (fx * dx + fz * dz) / d);
            const want = d > HOME_LEASH ? d - HOME_LEASH : Math.min(1.6 * dt, d);
            const back = Math.min(want, RETURN_SPEED * dt) * align;
            v.pos.x += fx * back;
            v.pos.z += fz * back;
            // im Nachzieh-Bereich unverändert 0.25; wer die Leine spannt, geht wirklich
            v.speed = d > HOME_LEASH ? RETURN_SPEED / FLEE_SPEED : 0.25;
          } else if (v.sidestepT > 0 || v.faceT > 0) {
            // schaut den Störer an — sidestepT: er hat gedrängt; faceT: es wird
            // gegrüßt, und der Körper dreht kurz mit (Blind-Befund R17: die
            // Halsklammer allein erreicht einen Spieler hinter der Schulter nie).
            // BLEIBT der Spieler dicht daneben stehen, hält die Figur den Kontakt
            // (faceT wird aufgefrischt), statt sich nach 2.7 s wieder wegzudrehen —
            // das Zurückdrehen bei anwesendem Fremden lasen die Kritiker als
            // "der Fremde existiert für ihn nicht" (Befund Serie A, Frames 12-14).
            if (v.faceT > 0 && dp < 3) {
              v.faceT = Math.max(v.faceT, 0.6);
              v.lookX = playerPos.x; v.lookZ = playerPos.z;
            }
            faceDir(v, v.lookX - v.pos.x, v.lookZ - v.pos.z, dt);
          } else {
            faceYaw(v, v.homeYaw, dt);
          }
          break;
        }

        case 'flee': {
          if (v.reactT > 0) {
            // REIHENFOLGE: erst halten, dann herunterzählen. Andersherum sähe
            // anchorOf() im letzten Schreck-Frame schon reactT <= 0 und der Push-out
            // schleuderte den Händler in einem Frame 0.72 m hinter der Theke hervor.
            holdPosition(v, avoid, dt);   // aufschrecken — noch kein Schritt
            v.reactT -= dt;
            // wer auf/hinter seinem Anker steht, steigt erst herunter und rennt dann
            if (v.reactT <= 0 && insideAnchor(v)) {
              v.afterDismount = 'flee';
              beginLerp(v, 'dismount', DISMOUNT_SPEED, v.mountX, v.mountZ, 0.2, 0.7);
            }
            break;
          }
          v.doorT += dt;
          const ap = doorApproach(v);
          const d = step(v, ap.x, ap.z, FLEE_SPEED, dt, avoid);
          // Türblatt schon auf dem Anlauf aufschwingen lassen (siehe DOOR_LEAD_DIST)
          if (d < DOOR_LEAD_DIST) v.door.openT = DOOR_HOLD;
          if (d < 0.8) {
            enterDoor(v);
          } else if (v.stuckT > STUCK_TIME || v.doorT > DOOR_GIVEUP) {
            // Tür nicht erreichbar -> andere probieren. Nach drei Fehlversuchen der
            // Not-Ausgang: quer über die Karte in die Tür zu lerpen würde die Figur
            // durch Häuser, Fässer und den Spieler gleiten lassen (die Lerp-Zustände
            // haben keine Kollision), deshalb nur aus Türnähe — sonst taucht sie an
            // Ort und Stelle im Boden ab. Beides endet in 'inside'.
            if (v.tried.length >= 3) {
              const dd = Math.hypot(v.door.ix - v.pos.x, v.door.iz - v.pos.z);
              if (dd < ENTER_NEAR) enterDoor(v);
              else { v.state = 'vanish'; v.shrinkT = VANISH_DUR; }
            } else {
              v.door = pickDoor(v); v.stuckT = 0; v.doorT = 0;
              v.lastX = v.pos.x; v.lastZ = v.pos.z;
              clearAvoid(v);   // neue Tür = neuer Kurs, alte Ausweichseite ist wertlos
            }
          }
          break;
        }

        case 'vanish': {
          // Not-Ausblendung: die Figur duckt sich in den Boden ab (siehe SINK_DEPTH).
          // Sie bleibt dabei in voller Größe — zentral zu schrumpfen machte aus ihr
          // mitten auf der Straße eine Spielzeugpuppe. Letzter Ausweg, wenn drei Türen
          // nacheinander nicht erreichbar waren und auch keine in ENTER_NEAR liegt;
          // seit die Wege frei sind (checkPathsClear in village.js), passiert das nur
          // noch, wenn der Spieler einen Türvorplatz gezielt zustellt.
          holdPosition(v, avoid, dt);
          v.shrinkT -= dt;
          v.shrink = Math.max(0, v.shrinkT / VANISH_DUR);
          if (v.shrinkT <= 0) {
            v.shrink = 0;
            v.hidden = true;
            v.state = 'inside';
            v.sank = true;                 // Rückkehr an dieser Stelle, nicht an der Tür
            v.sinkX = v.pos.x; v.sinkZ = v.pos.z;
            releaseDoor(v);                // die nie erreichte Tür wieder freigeben
          }
          break;
        }

        case 'entering':
        case 'exiting':
        case 'dismount':
        case 'approach':
        case 'mount': {
          // Gescriptete Kurzstrecken. An der Tür ist die reine Interpolation Absicht:
          // der Hauskollider würde die Figur sonst zurück auf die Straße werfen, und
          // der Zielpunkt liegt INNERHALB der Wand, damit sie vom Baukörper verschluckt
          // wird statt wegzuploppen. Beim Ab-/Aufsteigen sind es < 1 m zwischen zwei
          // von Hand geprüften Punkten (Ankerplatz <-> Vorplatz) — dort kommen unten
          // Nachbarn und Akteure wieder dazu, nur der Push-out bleibt aus.
          v.lerpT += dt / v.lerpDur;
          const k = Math.min(1, v.lerpT);
          v.pos.x = v.fromX + (v.toX - v.fromX) * k;
          v.pos.z = v.fromZ + (v.toZ - v.fromZ) * k;
          v.speed = v.lerpSpeed;
          if (v.state === 'mount' || v.state === 'dismount' || v.state === 'approach') {
            // Auf-/Absteigen und die Not-Anfahrt laufen NICHT durch Spieler, Kai oder
            // Nachbarn hindurch.
            // pushOut bleibt aus — er würde die Figur aus dem Anker-Kollider werfen.
            // Die Korrektur wandert in from/to, sonst überschriebe der Lerp sie im
            // nächsten Frame wieder; die Figur weicht so dauerhaft aus statt zu zucken.
            const bx = v.pos.x; const bz = v.pos.z;
            separate(v);
            avoidActors(v, avoid, dt);
            // Korrektur verwerfen, wenn sie die Figur TIEFER in ihren eigenen Anker
            // schöbe: der Absteige-Lerp endete sonst innerhalb der Kiste, und der
            // Push-out warf sie im nächsten Frame mit 0.7 m auf einen Schlag heraus.
            if (v.anchor
              && Math.hypot(v.pos.x - v.anchor.x, v.pos.z - v.anchor.z)
                < Math.hypot(bx - v.anchor.x, bz - v.anchor.z)) {
              v.pos.x = bx; v.pos.z = bz;
            }
            v.fromX += v.pos.x - bx; v.toX += v.pos.x - bx;
            v.fromZ += v.pos.z - bz; v.toZ += v.pos.z - bz;
          } else {
            v.door.openT = DOOR_HOLD;   // 'entering' / 'exiting': Tür offen halten
          }
          if (v.state === 'mount') faceYaw(v, v.homeYaw, dt);
          else faceDir(v, v.toX - v.fromX, v.toZ - v.fromZ, dt);
          if (k >= 1) {
            if (v.state === 'entering') { v.hidden = true; v.state = 'inside'; }
            else if (v.fleeAfterLerp) {
              // Die Welle kam, während diese Kurzstrecke lief (siehe flee()). Jetzt ist
              // die Figur wieder an einem kollisionsfreien Punkt — Vorplatz, Heimpunkt
              // oder Absteigepunkt —, also erst hier losrennen. startFlee() setzt Tür,
              // Schrecksekunde und Ausweich-Zustand frisch.
              v.fleeAfterLerp = false;
              if (v.state === 'exiting') { releaseDoor(v); v.door = null; }
              startFlee(v);
            } else if (v.state === 'approach') {
              // Vorplatz erreicht — jetzt erst der eigentliche Aufsetz-Schritt
              beginLerp(v, 'mount', MOUNT_SPEED, v.home.x, v.home.z, 0.35, 0.9);
            } else if (v.state === 'mount') {
              // KEIN Einrasten auf den Heimpunkt: die Heim-Leine im idle-Zustand zieht
              // den Rest (max. 1.6 m/s) weich nach. Ein Sprung wäre hier sichtbar, seit
              // Ausweich-Korrekturen den Lerp seitlich versetzen können.
              v.state = 'idle';
            } else {
              // 'dismount' -> weiter mit dem, wofür abgestiegen wurde (normal 'flee',
              // nach einem Sieg mitten in der Schrecksekunde der Heimweg); 'exiting' ->
              // heimgehen
              if (v.state === 'exiting') { releaseDoor(v); v.door = null; }
              v.state = v.state === 'dismount'
                ? v.afterDismount
                : (v.path ? 'walk' : 'return');
              v.stuckT = 0; v.lastX = v.pos.x; v.lastZ = v.pos.z;
              clearAvoid(v);
            }
          }
          break;
        }

        case 'return': {
          // Anker-Rollen laufen auf den Vorplatz und setzen sich von dort gescriptet
          // hin bzw. treten hinter die Theke. Direkt zum Heimpunkt geht nicht: der
          // liegt innerhalb des Anker-Kolliders, der im Lauf-Zustand aktiv ist.
          const tx = v.anchor ? v.mountX : v.home.x;
          const tz = v.anchor ? v.mountZ : v.home.z;
          // Läuft gerade ein Umweg um eine Prop-Klemme? Dann ist er das Ziel, und die
          // Ankunftsprüfung unten pausiert — sonst zählte der Umweg selbst als "nicht
          // angekommen" und löste im Sekundentakt den nächsten aus.
          if (v.detourT > 0) {
            v.detourT -= dt;
            const dd = step(v, v.detourX, v.detourZ, RETURN_SPEED, dt, avoid);
            if (dd < DETOUR_ARRIVE || v.detourT <= 0 || v.stuckT > STUCK_TIME) {
              v.detourT = 0;
              v.stuckT = 0; v.lastX = v.pos.x; v.lastZ = v.pos.z;
              clearAvoid(v);
              // EIN Umweg reicht bei einem Haufen dieser Grösse nicht: der Prop-Block
              // zwischen z=3.3 und z=10.8 ist auf der Heimseite dicht, herum geht es nur
              // östlich davon. Steht der direkte Weg immer noch zu, wird deshalb sofort
              // die nächste Gasse genommen, statt erst wieder 5 s lang in die Sackgasse
              // zu laufen und sich dort festzufahren. Die Klemmen-Erinnerung sorgt dafür,
              // dass die nächste Gasse eine ANDERE ist.
              if (wayBlocked(v, tx, tz)) startDetour(v, tx, tz);
            }
            break;
          }
          const d = step(v, tx, tz, RETURN_SPEED, dt, avoid);
          const arrived = d < 0.25;
          if (arrived || v.stuckT > STUCK_TIME * 2) {
            if (arrived) v.stuckMem.length = 0;   // angekommen: alte Klemmen vergessen
            if (v.anchor) {
              // Blockiert (der Spieler stellt sich auf den Vorplatz): der Aufsetz-Lerp
              // startet einfach dort, wo die Figur steht — ein Versetzen auf den
              // Vorplatz wäre ein sichtbarer Sprung.
              // Wer WEIT weg festhängt, fährt die Reststrecke jetzt als gescriptete
              // Anfahrt ab statt in EINEM Frame dorthin versetzt zu werden: das alte
              // `v.pos.x = tx` war ein Teleport über >= MOUNT_RESCUE_R (2 m) quer durchs
              // Bild (Befund L2). Kollisionsfrei ist auch die Anfahrt — das haben alle
              // Lerp-Zustände gemeinsam —, aber sie ist sichtbar eine Bewegung.
              if (!arrived && Math.hypot(tx - v.pos.x, tz - v.pos.z) > MOUNT_RESCUE_R) {
                beginLerp(v, 'approach', RETURN_SPEED, tx, tz, 0.3, 2.5);
              } else {
                beginLerp(v, 'mount', MOUNT_SPEED, v.home.x, v.home.z, 0.35, 0.9);
              }
            } else if (arrived || d <= HOME_LEASH) {
              // ebenfalls ohne Sprung: bis zu 0.25 m Rest holt die Heim-Leine weich auf
              v.state = 'idle';
            } else {
              // Festgefahren, aber noch WEIT von daheim. Hier stand einmal
              // `v.state = 'idle'`, und die Heim-Leine riss die Figur im Folgeframe über
              // die halbe Karte; 'idle' ist der Ruhezustand am Posten und hat gar keine
              // Lenkung um Hindernisse — ihn 8 m vom Ziel entfernt zu betreten war schon
              // deshalb falsch. Danach stand hier die Umkehr der Ausweichseite. Auch die
              // war zu wenig: steer() rechnet v.avoidSide im nächsten Frame aus bestLat
              // neu. Gemessen hat die Figur damit in zwei von drei Seeds die Prop-Gruppe
              // um (-11.5, 5.5) bis zum Ende des Laufs nicht verlassen.
              // Jetzt geht sie einen echten Umweg — siehe startDetour().
              startDetour(v, tx, tz);
            }
          }
          break;
        }

        default: break;   // 'inside' / 'waitInside' werden oben behandelt
      }

      // ---- Distanz-Abstufung ----
      const dcam = camPos ? Math.hypot(camPos.x - v.pos.x, camPos.z - v.pos.z) : 0;
      const lod = dcam > LOD_FAR ? 2 : (dcam > LOD_NEAR ? 1 : 0);
      // Das Sparen darf sich NUR danach richten, ob sich die Wurzel überhaupt bewegt
      // hat — nicht nach v.speed. v.speed ist das Tempo der BEINANIMATION, und das ist
      // null, sobald eine Figur quer zur Blickrichtung geschoben wird oder auf der
      // Stelle dreht. Mit v.speed als Torwächter hörte die Matrix in genau diesen
      // Fällen bis zu FAR_REFRESH lang auf, v.pos zu folgen, und holte den Rückstand
      // dann in EINEM Frame auf: gemessen 0.358 m = 21.5 m/s bei Bewohner 0 am Steg
      // (Seed 2, t=27.28 s), im Spiel bis FLEE_SPEED*FAR_REFRESH = 2.15 m. Der
      // Vergleich gegen die zuletzt geschriebene Wurzel kann diesen Fehler nicht
      // machen: was nicht geschrieben wurde, bleibt als Differenz stehen.
      const r0 = v.n.root.position;
      const rootY = v.rootY - (1 - v.shrink) * SINK_DEPTH;
      const moved = Math.abs(v.pos.x - r0.x) > 1e-4 || Math.abs(v.pos.z - r0.z) > 1e-4
        || Math.abs(rootY - r0.y) > 1e-4
        || Math.abs(shortestAngle(v.yaw - v.n.root.rotation.y)) > 1e-4;
      if (lod === 2 && !moved) {
        // weit weg und wirklich still: Pose einfrieren, Matrizen nur alle 0.5 s auffrischen
        v.farT -= dt;
        if (v.farT > 0 && !v.wasHidden) continue;
        v.farT = FAR_REFRESH;
      }

      if (lod < 2) {
        // Plaudernde bekommen ihre Geste aus der Gruppenlogik (updateChat); alle
        // anderen stehen allein an ihrem Posten und nicken höchstens mal vor sich hin
        if (!v.chat) {
          v.gestureT -= dt;
          if (v.gestureT <= 0) {
            v.gesture = Math.random() < 0.35 ? 2 : 0;
            v.gestureT = 2.2 + Math.random() * 3.4;
          }
        }
        v.glanceT -= dt;
        if (v.glanceT <= 0) {
          v.glanceT = 1.8 + Math.random() * 3.5;
          // Blick zum Spieler, wenn er nah UND auf gleicher Höhe ist — sonst ins Dorf.
          // Dieser Timer-Block bleibt WÖRTLICH wie vor Runde 17 stehen, obwohl die
          // Nah-Reaktionen unten sein Ergebnis oft überschreiben: er zieht pro Feuern
          // ein bis zwei globale Zufallszahlen, und GENAU diese Ziehungen müssen
          // erhalten bleiben — ihn bei nahem Spieler zu überspringen verschob den
          // geteilten RNG-Strom aller Subsysteme (gemessen: doorLeaf 0.0174 -> 0.014,
          // Moonwalk 0.293 -> 0.335 %, ohne dass Bewegungscode angefasst war).
          if (lod === 0 && dp < 9) {
            const a = shortestAngle(
              Math.atan2(playerPos.x - v.pos.x, playerPos.z - v.pos.z) - v.yaw);
            v.headTarget = Math.max(-0.9, Math.min(0.9, a));
          } else {
            v.headTarget = (Math.random() - 0.5) * 1.1;
          }
        }
        // Nah-Reaktionen ÜBERSCHREIBEN den Timer-Blick, ziehen aber keine globalen
        // Zufallszahlen (siehe seededFrac oben).
        // R18 (Felix' M3-Abnahme): nicht mehr SOFORT reagieren. Beim Betreten der
        // Zone vergehen erst 0.2-0.6 s, ehe die Figur den Spieler bemerkt — bis
        // dahin gilt, was der alte Blick-Timer zuletzt gesetzt hat. Hysterese
        // (+0.8 m) verhindert Flattern an der Zonenkante.
        if (v.noticed && dp > LOOK_R + 0.8) { v.noticed = false; v.noticeT = 0; }
        if (lod === 0 && dp < LOOK_R && !v.noticed) {
          if (v.noticeT <= 0) v.noticeT = 0.2 + seededFrac(v.seed + Math.floor(t)) * 0.4;
          v.noticeT -= dt;
          if (v.noticeT <= 0) v.noticed = true;
        } else if (lod === 0 && dp < LOOK_R) {
          // Nah vorbeigehen: der Kopf FOLGT dem Spieler kontinuierlich, statt ihn nur
          // im Blick-Timer-Takt (alle 1.8-5.3 s) zu erwischen. Das Timer-Rauschen
          // machte aus "sie sieht mich" ein "sie schaut zufällig mal her" — genau der
          // Unterschied zwischen Mensch und Punkt auf einem Pfad. Die Klammer ±0.9 rad
          // bleibt: niemand verdreht sich den Hals nach hinten.
          const a = shortestAngle(
            Math.atan2(playerPos.x - v.pos.x, playerPos.z - v.pos.z) - v.yaw);
          // R18: Mikrodynamik im gehaltenen Blick — alle ~3.4 s ein kurzer Rückblick
          // zur Arbeit (0.5 s), Fenster deterministisch pro Bewohner. Dauerstarren
          // las Felix als KI; der Spaziergänger wirkte menschlich, gerade WEIL er
          // den Blick nicht durchgehend hielt.
          const gcyc = Math.floor(t / 3.4);
          const gph = t - gcyc * 3.4;
          const g0 = 1.4 + seededFrac(v.seed * 3.1 + gcyc) * 1.4;
          // Der Rückblick zielt auf die ARBEIT (homeYaw), nicht auf headTarget=0:
          // beim gehaltenen Kontakt ist der Körper zum Spieler gedreht, 0 relativ
          // zum Körper wäre also weiter Dauerstarren (die erste Fassung dieser
          // Mikrodynamik war deshalb per Kopf-Sonde unsichtbar: 0 Unterbrechungen).
          v.headTarget = (gph > g0 && gph < g0 + 0.5)
            ? (v.state === 'idle'
              ? Math.max(-0.9, Math.min(0.9, shortestAngle(v.homeYaw - v.yaw)))
              : 0)
            : Math.max(-0.9, Math.min(0.9, a));
          // Gruß bei sehr nahem Vorbeigehen. BEWUSST OHNE Blickfeld-Gate: das
          // |a|<1.5-Gate hat in der Blind-Abnahme genau die Figur stummgeschaltet,
          // die mit dem Rücken zum Spieler stand — dabei ist "sich umdrehen, wenn
          // jemand auf Armlänge hinter dir steht" die menschlichste Reaktion
          // überhaupt (Menschen SPÜREN das; Figuren, die es nicht tun, lasen beide
          // Kritiker als taub). Die Körperdrehung unten macht das Umdrehen sichtbar.
          // Nur in Ruhe-Zuständen: wer flieht oder durch eine Tür lerpt, grüßt nicht.
          if (dp < GREET_R && v.greetCd <= 0
            && (v.state === 'idle' || v.state === 'walk')) {
            v.greetT = GREET_DUR;
            v.greetCd = GREET_CD + seededFrac(v.seed + t) * 4;
            // Befund der Blind-Abnahme (beide Kritiker unabhängig): Kopf-Kosmetik
            // allein ist unsichtbar — die Halsklammer (±0.9 rad) erreicht einen
            // Spieler hinter der Schulter nie, und niemand im Bild "bemerkt" ihn.
            // Deshalb dreht sich beim Gruß kurz der KÖRPER zum Störer (idle nutzt
            // faceT unten; danach geht es zurück zu homeYaw — niemand bleibt
            // dauerhaft abgewandt von seiner Arbeit stehen). R18: nicht mehr im
            // selben Frame — erst zuckt der Kopf hin (headTarget oben), der Körper
            // folgt nach 0.25-0.45 s (Kritiker-Restpunkt "Kopf-Sakkade zuerst").
            v.faceDelayT = 0.25 + seededFrac(v.seed + 5 + Math.floor(t)) * 0.2;
            // ... und die Plaudergruppe steckt sich an: die Nachbarn schauen im
            // selben Moment hin (nur headTarget, KEINE Zufallszahlen, keine
            // Bewegung — Menschen folgen dem Blick dessen, der grüßt).
            if (v.chat) {
              for (const o of villagers) {
                if (o === v || !o.chat || o.hidden || o.state !== 'idle') continue;
                if (Math.hypot(o.pos.x - v.pos.x, o.pos.z - v.pos.z) > 4) continue;
                // R18: gestaffelt statt synchron — jeder Nachbar schaut 0.5-1.5 s
                // später hin (deterministisch aus o.seed; synchrone Köpfe lasen die
                // Kritiker als Schwarm, nicht als Menschen). Feuert oben im
                // cueT-Block, sobald die Frist abgelaufen ist.
                o.cueT = 0.5 + seededFrac(o.seed + Math.floor(t)) * 1.0;
                o.cueX = playerPos.x; o.cueZ = playerPos.z;
              }
            }
          }
        } else if (v.sidestepT > 0) {
          // Gerade zur Seite getreten (avoidActors): den Störer ansehen, damit das
          // Ausweichen als REAKTION liest und nicht als stumme Pfadkorrektur. Deckt
          // auch Kai und Marines ab — lookX/lookZ setzt, wer zuletzt gedrängt hat.
          const a = shortestAngle(
            Math.atan2(v.lookX - v.pos.x, v.lookZ - v.pos.z) - v.yaw);
          v.headTarget = Math.max(-0.9, Math.min(0.9, a));
        }
      } else {
        v.headTarget = 0;
      }

      // Bodenhöhe weich nachziehen: Relief und Stegkante laufen so ohne Sprung.
      // Beim Auf-/Absteigen kommt die Höhe dagegen aus DEMSELBEN Lerp-Fortschritt wie
      // der Schritt: das Nachziehen (Zeitkonstante 0.11 s) wäre 6x schneller als die
      // 0.65-s-Strecke, die Figur säße also schon auf Sitzhöhe, während sie noch einen
      // halben Meter vor der Kiste steht.
      const ty = restingY(v);
      if (v.state === 'mount' || v.state === 'dismount') {
        v.rootY = v.fromY + (ty - v.fromY) * Math.min(1, v.lerpT);
      } else {
        v.rootY += (ty - v.rootY) * Math.min(1, dt * 9);
      }

      // shrink läuft bei der Not-Ausblendung von 1 auf 0 und senkt die Figur in den
      // Boden ab, statt sie zu skalieren — der Körper behält seine Größe.
      v.n.root.position.set(v.pos.x, rootY, v.pos.z);
      v.n.root.rotation.y = v.yaw;
      v.n.root.scale.setScalar(v.s);
      if (lod < 2 || moved) pose(v, dt, t, lod, playerPos);
      v.n.root.updateMatrixWorld(true);
      writeAll(v, false);
      v.wasHidden = false;
      dirty = true;
    }

    if (dirty) {
      bodyMesh.instanceMatrix.needsUpdate = true;
      sphMesh.instanceMatrix.needsUpdate = true;
      boxMesh.instanceMatrix.needsUpdate = true;
      hatMesh.instanceMatrix.needsUpdate = true;
      aoMesh.instanceMatrix.needsUpdate = true;
    }
  }

  updaters.push(update);

  // ---------- API für den Spielablauf (main.js: beginWave / endGame / startGame) ----------
  return {
    count: N,

    // Wellenstart: alle rennen zur nächsten Haustür und verschwinden dort.
    // Idempotent — zwischen den Wellen wird beginWave() erneut aufgerufen.
    flee() {
      if (fleeing || !doorSpots.length) return;
      fleeing = true;
      for (const v of villagers) {
        if (v.hidden) { v.state = 'inside'; continue; }
        // Läuft gerade eine gescriptete Kurzstrecke, wird sie ZU ENDE gefahren und das
        // Losrennen ans Ende gehängt. Vorher überschrieb startFlee() den Lerp-Zustand
        // ungeprüft; wen die Welle im Tür-Lerp erwischte, den warf pushOut im nächsten
        // Frame aus der Hauswand — gemessen bis 2.20 m in EINEM Frame (131.8 m/s,
        // Seed 2, Bewohner 6, Haus (-22.4,-12.9)). main.js ruft flee() bei JEDEM
        // Wellenstart, der Fall trat also bei jedem Wellenwechsel auf.
        if (v.state === 'entering') continue;   // läuft ohnehin schon ins Haus hinein
        if (LERP_STATES.includes(v.state)) { v.fleeAfterLerp = true; continue; }
        startFlee(v);
      }
    },

    // Nach dem Sieg: gestaffelt wieder heraus und zurück auf die Posten.
    // Bei Niederlage wird das bewusst NICHT gerufen — die Marines halten das Dorf,
    // die Türen bleiben zu. startGame() -> reset() holt alle wieder heraus.
    returnHome() {
      if (!fleeing) return;
      fleeing = false;
      for (let k = 0; k < villagers.length; k++) {
        const v = villagers[k];
        // ein noch nicht eingelöstes "renn los, sobald der Lerp fertig ist" ist mit dem
        // Sieg hinfällig — sonst rannte die Figur nach dem Lerp doch noch zur Tür
        v.fleeAfterLerp = false;
        if (v.hidden) {
          v.state = 'waitInside';
          v.reactT = 0.4 + k * 0.35 + Math.random() * 0.4; // einer nach dem anderen
        } else if (v.state === 'flee' || v.state === 'dismount' || v.state === 'vanish') {
          // Not-Ausblendung ggf. abbrechen — die Figur ist noch draußen und geht heim
          v.shrink = 1;
          releaseDoor(v); v.door = null;   // Tür wird nicht mehr gebraucht
          const goHome = v.path ? 'walk' : 'return';
          if (v.state === 'dismount') {
            // Der Absteige-Lerp läuft gerade. Ihn hier abzubrechen nähme der Figur
            // mitten im Anker-Kollider die Freistellung — nur das Ziel DANACH umbiegen.
            v.afterDismount = goHome;
          } else if (v.state === 'flee' && v.reactT > 0 && insideAnchor(v)) {
            // Befund L3: Sieg mitten in der Schrecksekunde, die Figur steht noch auf
            // ihrem Anker (Theke/Kiste). Direkt auf 'return' zu schalten nahm ihr die
            // Anker-Freistellung aus anchorOf(), und pushOut warf sie im Folgeframe
            // heraus — gemessen 0.72 m in einem Frame (43 m/s) beim Händler und 0.65 m
            // (39 m/s) beim Sitzenden. Also denselben Ausstieg gehen wie beim Losrennen,
            // nur mit Ziel "heim" statt "weiterrennen".
            v.reactT = 0;
            v.afterDismount = goHome;
            beginLerp(v, 'dismount', DISMOUNT_SPEED, v.mountX, v.mountZ, 0.2, 0.7);
          } else {
            v.state = goHome;
            v.stuckT = 0; v.lastX = v.pos.x; v.lastZ = v.pos.z;
            clearAvoid(v);
          }
        } else if (v.state === 'entering') {
          // steht schon im Türrahmen: umdrehen und wieder herauslaufen
          const ap = doorApproach(v);
          beginLerp(v, 'exiting', EXIT_SPEED, ap.x, ap.z, 0.4, 1.6);
        }
      }
    },

    // Neustart: sofort zurück auf Anfang, ohne Animation.
    reset() {
      fleeing = false;
      doorOwner.clear();
      for (const v of villagers) {
        v.hidden = false;
        v.state = v.path ? 'walk' : 'idle';
        v.seg = v.def.seg ?? 0;
        v.dir = v.def.dir ?? 1;
        v.pos.set(v.home.x, 0, v.home.z);
        v.prev.x = v.home.x; v.prev.z = v.home.z;
        v.lastX = v.home.x; v.lastZ = v.home.z;
        v.yaw = v.homeYaw;
        v.speed = 0;
        v.stuckT = 0;
        v.detourT = 0;
        v.stuckMem.length = 0;
        v.doorT = 0;
        v.pauseT = 0;
        v.reactT = 0;
        v.sidestepT = 0;
        v.tried.length = 0;
        v.door = null;
        v.headTarget = 0;
        v.gesture = 0;
        v.greetT = 0;
        v.greetCd = 0;
        v.yieldCd = 0;
        v.faceT = 0;
        v.faceDelayT = 0;
        v.noticeT = 0;
        v.noticed = false;
        v.cueT = 0;
        v.shrink = 1;
        v.shrinkT = 0;
        v.sank = false;
        v.sinkX = v.home.x; v.sinkZ = v.home.z;
        v.afterDismount = 'flee';
        v.fleeAfterLerp = false;
        clearAvoid(v);
        v.lookX = v.home.x; v.lookZ = v.home.z;
        v.rootY = restingY(v);
      }
    },
  };
}
