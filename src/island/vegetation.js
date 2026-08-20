// island/vegetation.js — Palmen, Büsche, Gras (R13; Kritik #7: Palmen instanziert, #8: Wege/Häuser bleiben frei)
import * as THREE from 'three';
import { scrubTexture } from './textures.js';

const BUSH_COUNT = 36;
const GRASS_TUFTS = 140;    // sattgrüne Büschel über die ganze Insel
const DRY_SCRUBS = 70;      // trockenes Gestrüpp Richtung Strand
const FRONDS_PER_PALM = 7;
const PLACE_TRIES = 20;     // Reroll-Versuche pro Instanz, bevor aufgegeben wird
const AVOID_OBSTACLE_MIN_R = 1.8; // nur große Kollider (Häuser/Turm/Karren) blockieren Bewuchs
const PATH_CLEARANCE = 0.5;       // Abstand Bewuchs -> Wegrand

// [x, z, Höhe, Lean] — Dorfkern (Bestand) + Küstensaum der größeren Insel
const PALM_SPOTS = [
  [-13, -26, 7, 0.12], [14, 26, 6.5, -0.15], [-28, 6, 6, 0.1], [30, -4, 7.5, -0.08],
  [-8, 30, 5.5, 0.18], [33, 24, 6, 0.1], [-32, -14, 6.8, -0.12],
  [20, 44, 6, 0.14], [6, 50, 7, -0.1], [-44, 6, 6.5, 0.12], [-24, 44, 7, -0.14],
  [40, 26, 6, 0.1], [-40, -24, 6.5, 0.1], [28, -36, 7, -0.12], [-6, -44, 6, 0.15],
];

// Steg-Korridor freihalten: nichts wächst mitten auf dem Hafenweg
function nearPier(x, z, PIER) {
  return z > PIER.shoreZ - 6 && Math.abs(x - PIER.x) < PIER.halfWidth + 2;
}

// Punkt-zu-Segment-Abstand für die Weg-Freihaltung
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-6;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// Platz-Validator: nicht auf Steg-Korridor, Wegen oder in Gebäude-Footprints
function makeSpotValidator(ctx) {
  const { obstacles, pathDefs = [], pathWidth = 2.4, PIER } = ctx;
  const pathMin = pathWidth / 2 + PATH_CLEARANCE;
  return (x, z) => {
    if (nearPier(x, z, PIER)) return false;
    for (const pts of pathDefs) {
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < pathMin) return false;
      }
    }
    for (const o of obstacles) {
      if (o.radius >= AVOID_OBSTACLE_MIN_R && Math.hypot(x - o.x, z - o.z) < o.radius + 0.3) return false;
    }
    return true;
  };
}

// Palmen als 2 InstancedMeshes (Stämme + Wedel) statt ~165 Einzelmeshes (R13-Kritik #7);
// Kokosnüsse gestrichen. Wind-Sway bleibt: die Wedel-Matrizen werden pro Frame aus
// statischen Kronen-Basen * Sway-Rotation neu komponiert (~105 Matrix-Mults, billig).
function buildPalms(ctx) {
  const { scene, obstacles, geo, mats, groundY, addAO, updaters } = ctx;
  const n = PALM_SPOTS.length;
  const trunks = new THREE.InstancedMesh(geo.cylinder, mats.trunk, n);
  const fronds = new THREE.InstancedMesh(geo.frond, mats.frond, n * FRONDS_PER_PALM);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const base = new THREE.Matrix4();
  const local = new THREE.Matrix4();

  // 7 statische Wedel-Matrizen relativ zur Krone (wie das alte per-Mesh-Setup)
  const frondLocals = [];
  for (let i = 0; i < FRONDS_PER_PALM; i++) {
    const a = (i / FRONDS_PER_PALM) * Math.PI * 2;
    e.set(-Math.sin(a) * 1.25, 0, Math.cos(a) * 1.25);
    q.setFromEuler(e);
    frondLocals.push(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * 0.9, 0.25, Math.sin(a) * 0.9),
      q.clone(),
      new THREE.Vector3(1.6, 1, 1),
    ));
  }

  const crownBases = []; // statisch: Palmenfuß * Yaw * Kronen-Offset
  for (let p = 0; p < n; p++) {
    const [x, z, h, lean] = PALM_SPOTS[p];
    e.set(0, Math.random() * Math.PI * 2, 0);
    q.setFromEuler(e);
    base.compose(new THREE.Vector3(x, groundY(x, z), z), q, new THREE.Vector3(1, 1, 1));
    // Stamm: Mittelpunkt auf h/2, geneigt wie im alten Einzelmesh-Aufbau
    e.set(0, 0, lean);
    q.setFromEuler(e);
    local.compose(new THREE.Vector3(0, h / 2, 0), q, new THREE.Vector3(0.28, h, 0.34));
    m4.multiplyMatrices(base, local);
    trunks.setMatrixAt(p, m4);
    local.makeTranslation(Math.sin(lean) * -h, h * Math.cos(lean), 0);
    crownBases.push(new THREE.Matrix4().multiplyMatrices(base, local));
    addAO(x, z, 1.2);
    obstacles.push({ x, z, radius: 0.55 });
  }
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  fronds.castShadow = true;
  scene.add(trunks);
  scene.add(fronds);

  const crownM = new THREE.Matrix4();
  const swayM = new THREE.Matrix4();
  updaters.push((dt, t) => {
    for (let p = 0; p < n; p++) {
      e.set(Math.sin(t * 0.8 + p) * 0.03, Math.sin(t * 0.6 + p * 1.7) * 0.06, 0);
      q.setFromEuler(e);
      swayM.makeRotationFromQuaternion(q);
      crownM.multiplyMatrices(crownBases[p], swayM);
      for (let i = 0; i < FRONDS_PER_PALM; i++) {
        m4.multiplyMatrices(crownM, frondLocals[i]);
        fronds.setMatrixAt(p * FRONDS_PER_PALM + i, m4);
      }
    }
    fronds.instanceMatrix.needsUpdate = true;
  });
}

export function buildVegetation(ctx) {
  const { scene, geo, groundY, WALK_RADIUS } = ctx;
  const isFree = makeSpotValidator(ctx); // Wege + Gebäude + Steg bleiben frei (R13-Kritik #8)

  buildPalms(ctx);

  // ---- Büsche: zwei Grüntöne, instanziert, plattgedrückte Kugeln ----
  {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const bushMats = [
      new THREE.MeshStandardMaterial({ color: 0x4a7a40, roughness: 1.0 }),
      new THREE.MeshStandardMaterial({ color: 0x3d6a38, roughness: 1.0 }),
    ];
    const perMesh = BUSH_COUNT / 2;
    for (let bm = 0; bm < 2; bm++) {
      const bushes = new THREE.InstancedMesh(geo.sphere, bushMats[bm], perMesh);
      let placed = 0;
      let tries = 0;
      while (placed < perMesh && tries++ < perMesh * PLACE_TRIES) {
        const a = Math.random() * Math.PI * 2;
        const r = 12 + Math.sqrt(Math.random()) * (WALK_RADIUS - 14);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!isFree(x, z)) continue;
        const s = 0.5 + Math.random() * 0.6;
        e.set(0, Math.random() * Math.PI * 2, 0);
        q.setFromEuler(e);
        m4.compose(
          new THREE.Vector3(x, groundY(x, z) + s * 0.4, z),
          q,
          new THREE.Vector3(s, s * 0.7, s * 0.9)
        );
        bushes.setMatrixAt(placed++, m4);
      }
      bushes.count = placed; // falls Rerolls ausgingen: keine Identity-Instanzen im Ursprung
      bushes.castShadow = true;
      bushes.receiveShadow = true;
      scene.add(bushes);
    }
  }

  // ---- Gras + Gestrüpp: gekreuzte Billboard-Ebenen, instanziert ----
  function tuftField(count, tex, rMin, rMax) {
    const matTuft = new THREE.MeshStandardMaterial({
      map: tex, side: THREE.DoubleSide, alphaTest: 0.5,
      transparent: true, roughness: 1.0,
    });
    const mesh = new THREE.InstancedMesh(geo.scrubPlane, matTuft, count * 2);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    let placed = 0;
    let tries = 0;
    while (placed < count && tries++ < count * PLACE_TRIES) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.sqrt(Math.random()) * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!isFree(x, z)) continue;
      const y = groundY(x, z) + 0.24;
      const s = 0.8 + Math.random() * 0.6;
      const rot = Math.random() * Math.PI;
      // two crossed planes per tuft
      for (let k = 0; k < 2; k++) {
        e.set(0, rot + k * Math.PI / 2, 0);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, 1));
        mesh.setMatrixAt(placed * 2 + k, m4);
      }
      placed++;
    }
    mesh.count = placed * 2;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  tuftField(GRASS_TUFTS, scrubTexture([0x5a, 0x8a, 0x3e], [0x3f, 0x6e, 0x32]), 8, WALK_RADIUS - 8);
  tuftField(DRY_SCRUBS, scrubTexture(), 30, WALK_RADIUS - 2);
}
