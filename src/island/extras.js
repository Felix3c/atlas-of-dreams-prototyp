// island/extras.js — R23 Aufgabe C: die belebte Welt — Ambient-NPCs.
//
// Felix (R22): die Verhaftungs-Schaulustigen „kommen mir zu random rüber —
// vielleicht einfach schon ein bisschen mehr NPCs haben". Dieses Modul stellt
// 9 Statisten mit FESTEN kleinen Beschäftigungen in die Welt (Auftrag: 6–10):
//
//   Angler am Stegende · zwei Marktbummler · einer am Brunnen · zwei Kinder,
//   die zwischen zwei Punkten rennen · ein Sitzer am Bucht-Lagerfeuer · zwei
//   Spaziergänger auf den Umland-Trittspuren (R21/R23-Wege).
//
// REGELN (Auftrag C.1): villagers.js ist TABU — eigener Figuren-Baukasten im
// buildFigure-Stil der Episode. KEINE Wegfindung (feste Pendel-/Idle-Loops),
// KEINE neuen Kollider (reine Statisten, Bewohner-Routen bleiben unberührt).
//
// TUMULT-ANSCHLUSS (Auftrag C.2): die Episode „borgt" sich über borrow() bis zu
// 3 dorfnahe Statisten als Schaulustige (sie LAUFEN sichtbar aus ihrer
// Beschäftigung zum Platz — kein Spawn aus dem Nichts) und gibt sie über
// release() zurück; die Rückkehr blendet weich in den Loop (kein Teleport-Pop).
import * as THREE from 'three';

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });
}

// Figuren-Baukasten — bewusst eine EIGENE Kopie des Episode-Baukastens
// (episode.js exportiert ihn nicht; die beiden Module bleiben unabhängig).
function buildFigure(opts = {}) {
  const {
    skin = 0xd39a6a, shirt = 0x7a8f5c, pants = 0x555f6e,
    hair = 0x3a2e22, hat = null, scale = 1,
  } = opts;
  const g = new THREE.Group();
  const skinMat = mat(skin);
  const shirtMat = mat(shirt, { roughness: 0.95 });
  const pantsMat = mat(pants);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), shirtMat);
  torso.position.y = 1.02;
  torso.scale.set(0.92, 1, 0.9);
  torso.rotation.x = 0.1;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skinMat);
  head.position.set(0, 1.56, 0.05);
  g.add(head);
  const hairMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), mat(hair));
  hairMesh.position.copy(head.position);
  hairMesh.position.y += 0.02;
  g.add(hairMesh);
  if (hat === 'straw') {
    const brim = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.16, 10), mat(0xd9bc7a, { roughness: 0.95 }));
    brim.position.set(0, 1.74, 0.05);
    g.add(brim);
  }
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 4, 6), skinMat);
    arm.position.set(0.28 * s, 0.95, 0);
    arm.rotation.z = 0.2 * s;
    g.add(arm);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 4, 6), pantsMat);
    leg.position.set(0.12 * s, 0.35, 0);
    g.add(leg);
  }
  g.scale.setScalar(scale);
  return g;
}

export function buildExtras(ctx) {
  const { scene, groundY, updaters, PIER, coastWalkRadius } = ctx;

  // Bucht-Anker wie in flair.js (Lagerfeuer-Position bayAt(-7))
  const BAY_DIR = { x: Math.sin(-1.25), z: Math.cos(-1.25) };
  const bayCoast = coastWalkRadius(BAY_DIR.x, BAY_DIR.z);
  const CAMP = { x: BAY_DIR.x * (bayCoast - 7), z: BAY_DIR.z * (bayCoast - 7) };

  // Loop-Typen: 'walk' pendelt a<->b (Blick in Laufrichtung), 'idle' steht mit
  // Wende-/Wipp-Oszillation, 'sit' sitzt abgesenkt still mit leichtem Schwanken.
  const NPCS = [
    // Angler am Stegende (auf den Planken, Blick aufs Wasser)
    {
      kind: 'idle', look: { skin: 0xc98a5c, shirt: 0x4a6a52, pants: 0x3a3d40, hat: 'straw' },
      a: { x: PIER.x - 1.4, z: PIER.endZ - 1.6 }, baseY: PIER.deckY,
      face: Math.PI * 0.85, rod: true, village: true,
    },
    // Zwei Marktbummler: schlendern an den Ständen entlang (neben der Wegmitte)
    {
      kind: 'walk', look: { skin: 0xd8a878, shirt: 0xa85a4a, pants: 0x4a4a52 },
      a: { x: 12.5, z: 25.5 }, b: { x: 14.6, z: 34.5 }, speed: 0.05, village: true,
    },
    {
      kind: 'walk', look: { skin: 0xb9835a, shirt: 0x6a8ac9, pants: 0x3a3a3a, hat: 'straw', scale: 0.95 },
      a: { x: 7.2, z: 33.5 }, b: { x: 12.2, z: 41 }, speed: 0.06, phase: 0.5, village: true,
    },
    // Einer am Brunnen (außerhalb des Brunnenring-Kolliders r 1.35 um (0,6))
    {
      kind: 'idle', look: { skin: 0xd0a070, shirt: 0x9a4a44, pants: 0x555f6e },
      a: { x: -1.9, z: 4.6 }, face: Math.atan2(0 - -1.9, 6 - 4.6), village: true,
    },
    // Zwei Kinder, die zwischen zwei Punkten rennen (Südplatz, quer zur Gasse)
    {
      kind: 'walk', look: { skin: 0xd39a6a, shirt: 0xffd24a, pants: 0x6a8ac9, scale: 0.62 },
      a: { x: -8, z: -7 }, b: { x: 6, z: -11 }, speed: 0.16, bob: 0.09, village: true,
    },
    {
      kind: 'walk', look: { skin: 0xc99167, shirt: 0x7ac8ff, pants: 0x4a3a2a, scale: 0.58 },
      a: { x: 5, z: -12 }, b: { x: -7, z: -8 }, speed: 0.17, phase: 0.3, bob: 0.09, village: true,
    },
    // Sitzer am Bucht-Lagerfeuer (auf dem Sitzstamm-Platz aus flair.js)
    {
      kind: 'sit', look: { skin: 0xbf8a5f, shirt: 0x5a4a6e, pants: 0x3a3a3a },
      a: { x: CAMP.x - 1.7, z: CAMP.z + 0.9 },
      face: Math.atan2(1.7, -0.9),
    },
    // Zwei Spaziergänger auf den Umland-Trittspuren (R21: zur Anhöhe / zur Bucht)
    {
      kind: 'walk', look: { skin: 0xd39a6a, shirt: 0xb0985f, pants: 0x3a3d40 },
      a: { x: -35, z: -27 }, b: { x: -45, z: -39 }, speed: 0.035,
    },
    {
      kind: 'walk', look: { skin: 0xc98a5c, shirt: 0x8a5a34, pants: 0x4a3a2a, hat: 'straw' },
      a: { x: -42, z: 16 }, b: { x: -72, z: 25 }, speed: 0.025, phase: 0.7,
    },
  ];

  for (const n of NPCS) {
    n.obj = buildFigure(n.look);
    n.obj.position.set(n.a.x, n.baseY ?? groundY(n.a.x, n.a.z), n.a.z);
    if (n.face !== undefined) n.obj.rotation.y = n.face;
    n.phase = n.phase || 0;
    n.borrowed = false;
    n.blendT = 0;       // Rest-Sekunden der Rückkehr-Blende nach release()
    scene.add(n.obj);
    if (n.rod) {
      // Angelrute + Schnur — ein Handgriff, der die Figur sofort lesbar macht
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 2.2, 6), mat(0x6b4a2b));
      rod.position.set(0.3, 1.15, 0.5);
      rod.rotation.x = -0.9;
      n.obj.add(rod);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0.3, 2.05, 1.45), new THREE.Vector3(0.3, -0.1, 1.9),
      ]);
      n.obj.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xd9d2c0 })));
    }
    if (n.kind === 'sit') n.obj.position.y -= 0.32; // sitzt auf dem Stamm
  }

  // Ausblenden im Kampf (endPeace/beginWave in main.js): die Statisten „fliehen"
  // hinter dem Alarm-Beat — Skalier-Blende statt hartem Pop, Muster Vignetten.
  let hideK = 0;       // 0 = sichtbar, 1 = weg
  let hideTarget = 0;

  function pingpong(k) {
    const p = k % 2;
    return p < 1 ? p : 2 - p;
  }

  updaters.push((dt, t) => {
    hideK += (hideTarget - hideK) * Math.min(1, dt * 5);
    const vis = 1 - hideK;
    for (const n of NPCS) {
      if (n.borrowed) continue; // die Episode führt die Figur gerade selbst
      const o = n.obj;
      o.visible = vis > 0.02;
      if (!o.visible) continue;
      // Loop-Sollposition
      let px = n.a.x, pz = n.a.z, yaw = n.face ?? 0, bobY = 0;
      if (n.kind === 'walk') {
        const k = pingpong(t * n.speed + n.phase);
        const sm = k * k * (3 - 2 * k); // weiche Wende an den Endpunkten
        px = n.a.x + (n.b.x - n.a.x) * sm;
        pz = n.a.z + (n.b.z - n.a.z) * sm;
        const forward = (t * n.speed + n.phase) % 2 < 1 ? 1 : -1;
        yaw = Math.atan2((n.b.x - n.a.x) * forward, (n.b.z - n.a.z) * forward);
        bobY = Math.abs(Math.sin(t * (6 + (n.bob ? 4 : 0)))) * (n.bob || 0.045);
      } else if (n.kind === 'idle') {
        yaw = (n.face ?? 0) + Math.sin(t * 0.6 + n.phase * 3) * 0.3;
        bobY = Math.abs(Math.sin(t * 1.8 + n.phase)) * 0.02;
      } else { // sit
        yaw = (n.face ?? 0) + Math.sin(t * 0.4) * 0.12;
      }
      const gy = (n.baseY ?? groundY(px, pz)) + (n.kind === 'sit' ? -0.32 : 0);
      if (n.blendT > 0) {
        // Rückkehr aus der Borgung: weich zur Loop-Position zurücklaufen
        n.blendT = Math.max(0, n.blendT - dt);
        o.position.x += (px - o.position.x) * Math.min(1, dt * 4);
        o.position.z += (pz - o.position.z) * Math.min(1, dt * 4);
        o.position.y = gy + Math.abs(Math.sin(t * 8)) * 0.05; // läuft sichtbar
        o.rotation.y = Math.atan2(px - o.position.x, pz - o.position.z);
        o.rotation.z = 0;
      } else {
        o.position.set(px, gy + bobY, pz);
        o.rotation.y = yaw;
      }
      o.scale.setScalar((n.look.scale || 1) * Math.max(0.001, vis));
    }
  });

  return {
    // Die Episode borgt bis zu `count` sichtbare Statisten in Platznähe. Sie
    // bleiben in der Szene (KEIN Despawn/Respawn) — die Episode bewegt ihre
    // Objekte, bis release() sie zurückgibt.
    borrow(x, z, maxDist, count) {
      const out = [];
      for (const n of NPCS) {
        if (out.length >= count) break;
        if (n.borrowed || !n.village || !n.obj.visible) continue;
        const d = Math.hypot(n.obj.position.x - x, n.obj.position.z - z);
        if (d > maxDist) continue;
        n.borrowed = true;
        n.obj.rotation.z = 0;
        out.push({ obj: n.obj, npc: n });
      }
      return out;
    },
    release() {
      for (const n of NPCS) {
        if (!n.borrowed) continue;
        n.borrowed = false;
        n.blendT = 1.5;
        n.obj.rotation.x = 0;
        n.obj.rotation.z = 0;
      }
    },
    hide() { hideTarget = 1; },
    show() { hideTarget = 0; },
    count: NPCS.length,
  };
}
