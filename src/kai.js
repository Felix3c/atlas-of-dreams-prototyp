// kai.js — KAI companion model (primitives) + procedural animation + slash helpers
// Runde 8 (Felix' Auftrag): the crew.js swordsman AI gets its own original figure.
// Design reads distinct at a glance: black tied-back hair, a dark red open jacket,
// and a two-blade style (one katana per fist, nothing sheathed at the hip).
// Placeholder look until the character editor (M2) takes over. Built in the same
// craft style as
// hero.js: primitive meshes, procedural canvas textures, no external assets.
import * as THREE from 'three';

const SKIN = 0xe8b184;
const HAIR = 0x161016;       // black, tied back
const JACKET = 0x7a1f26;     // dark red, open at the chest
const JACKET_LINER = 0x4a0f16;
const SASH = 0x1c1c20;       // black waist sash
const TROUSERS = 0x1c1c20;   // black
const BOOT = 0x111114;       // black boots
const BLADE = 0xd9dee4;      // steel
const GUARD = 0x8a8f96;
const GRIP = 0x241014;       // dark red-black wrap
const GRIP_BAND = 0x14161a;  // black diamond wrap bands
const MOUTH = 0x5a3324;

// ---- procedural textures (no external assets) ----

// subtle luminance noise, same recipe as hero.js — breaks up flat surfaces
function makeNoiseTexture() {
  const size = 256;
  const src = document.createElement('canvas');
  src.width = src.height = size;
  const sctx = src.getContext('2d');
  const img = sctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.round(238 * (1 + (Math.random() * 2 - 1) * 0.07));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.filter = 'blur(2px)';
  ctx.drawImage(src, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// tight diagonal cross-hatch for the sash weave
function makeKnitTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c1c20';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#141418';
  ctx.lineWidth = 2;
  for (let x = -size; x < size * 2; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + size, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0, ...opts });
}

function shadow(m) {
  m.castShadow = true;
  return m;
}

// katana: blade + round guard + wrapped grip. Origin at the guard, blade points -Y
// (so parenting it to a fist and pointing the fist "down the arm" reads naturally).
function makeKatana(bladeLen = 0.95) {
  const g = new THREE.Group();
  const bladeMat = mat(BLADE, { roughness: 0.25, metalness: 0.85 });
  const blade = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.012, bladeLen, 6), bladeMat));
  blade.position.y = -bladeLen / 2;
  g.add(blade);
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 10), mat(GUARD, { roughness: 0.4, metalness: 0.6 }));
  g.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.24, 8), mat(GRIP));
  grip.position.y = 0.13;
  g.add(grip);
  // dark wrap bands suggest the diamond hilt wrapping
  for (const y of [0.06, 0.13, 0.2]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.022, 8), mat(GRIP_BAND));
    band.position.y = y;
    band.rotation.y = y * 20;
    g.add(band);
  }
  return g;
}

export function createKai() {
  const group = new THREE.Group(); // origin at feet

  const noiseTex = makeNoiseTexture();
  const knitTex = makeKnitTexture();

  const skinMat = mat(SKIN, { map: noiseTex });
  const jacketMat = mat(JACKET, { map: noiseTex, roughness: 0.75 });
  const jacketLinerMat = mat(JACKET_LINER, { roughness: 0.8, side: THREE.BackSide });
  const sashMat = mat(SASH, { map: knitTex, roughness: 0.95 });
  const trouserMat = mat(TROUSERS, { map: noiseTex });
  const bootMat = mat(BOOT, { roughness: 0.6 });
  const hairMat = mat(HAIR, { roughness: 0.6 });

  // ---- torso ----
  const torso = new THREE.Group();
  torso.position.y = 1.05;
  group.add(torso);

  // chest core — broad and built, like a swordsman should read
  const chestCore = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.31, 0.5, 6, 12), skinMat));
  chestCore.scale.set(1.2, 1, 0.95);
  torso.add(chestCore);

  // dark red jacket wrapping the torso, wide gap at the front (open at the chest)
  const JACKET_GAP = 0.9;
  const jacketGeo = new THREE.CylinderGeometry(
    0.335, 0.315, 0.62, 16, 1, true, JACKET_GAP / 2, Math.PI * 2 - JACKET_GAP
  );
  const jacket = shadow(new THREE.Mesh(jacketGeo, jacketMat));
  torso.add(jacket);

  // inner liner so the open front reads as cloth with thickness
  const linerGeo = new THREE.CylinderGeometry(
    0.315, 0.30, 0.61, 16, 1, true, JACKET_GAP / 2, Math.PI * 2 - JACKET_GAP
  );
  torso.add(new THREE.Mesh(linerGeo, jacketLinerMat));

  // vertical edge strips along the jacket opening
  const stripGeo = new THREE.BoxGeometry(0.04, 0.62, 0.02);
  const stripX = 0.335 * Math.sin(JACKET_GAP / 2);
  const stripZ = 0.335 * Math.cos(JACKET_GAP / 2);
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(stripGeo, jacketMat);
    strip.position.set(stripX * s, 0, stripZ);
    strip.rotation.y = -s * (JACKET_GAP / 2);
    torso.add(strip);
  }

  // popped collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 6, 16), jacketMat);
  collar.position.y = 0.32;
  collar.rotation.x = Math.PI / 2 + 0.1;
  torso.add(collar);

  // black waist sash — slim, replaces the haramaki as the torso's anchor detail
  const sash = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.335, 0.16, 16), sashMat));
  sash.position.y = -0.28;
  torso.add(sash);

  // neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 10), skinMat);
  neck.position.y = 1.64;
  group.add(neck);

  // ---- head ----
  const headPivot = new THREE.Group();
  headPivot.position.y = 1.66;
  group.add(headPivot);

  const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 12), skinMat));
  head.position.y = 0.1;
  headPivot.add(head);

  // black hair cap, calmer/slicked than a spiky crown
  const hairCap = shadow(new THREE.Mesh(
    new THREE.SphereGeometry(0.305, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat
  ));
  hairCap.position.set(0, 0.1, -0.01);
  headPivot.add(hairCap);

  // swept-back fringe strands over the forehead — flat, not spiky
  const fringeGeo = new THREE.BoxGeometry(0.055, 0.09, 0.05);
  for (let i = 0; i < 5; i++) {
    const fx = -0.14 + (0.28 * i) / 4;
    const strand = new THREE.Mesh(fringeGeo, hairMat);
    strand.position.set(fx, 0.28, 0.2);
    strand.rotation.x = 0.5;
    strand.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.12;
    headPivot.add(strand);
  }

  // tied-back ponytail: tapered capsule trailing off the back of the head, tied
  // with a black band at the base — KAI's identity mark
  const ponytail = new THREE.Group();
  ponytail.position.set(0, 0.16, -0.22);
  ponytail.rotation.x = 0.35;
  const tail = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.32, 4, 8), hairMat));
  tail.position.y = -0.16;
  tail.scale.set(1, 1, 0.85);
  ponytail.add(tail);
  const tieBand = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 10), mat(0x14161a));
  tieBand.rotation.x = Math.PI / 2;
  ponytail.add(tieBand);
  headPivot.add(ponytail);

  // ---- stern face: narrow eyes, heavy brows, flat mouth — no smile ----
  const eyeMat = mat(0x14100c, { roughness: 0.3 });
  const browMat = mat(0x1e1418);
  for (const s of [-1, 1]) {
    // narrow eye: flattened box slit
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.022, 0.01), eyeMat);
    eye.position.set(0.105 * s, 0.1, 0.272);
    eye.rotation.z = -0.08 * s; // outer corners tipped down-out → glare
    headPivot.add(eye);
    // heavy angled brow pressing down over the eye
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.01), browMat);
    brow.position.set(0.105 * s, 0.15, 0.268);
    brow.rotation.z = -0.35 * s; // inner ends down → scowl
    headPivot.add(brow);
  }
  // flat, unimpressed mouth
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.014, 0.008), mat(MOUTH));
  mouth.position.set(0, -0.01, 0.276);
  headPivot.add(mouth);

  // ---- legs: black trousers + black boots ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.15 * side, 0.78, 0);
    const upper = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.32, 4, 8), trouserMat));
    upper.position.y = -0.21;
    pivot.add(upper);
    const lower = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.26, 4, 8), trouserMat));
    lower.position.y = -0.53;
    pivot.add(lower);
    // boot shaft + foot
    const shaft = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.16, 10), bootMat));
    shaft.position.y = -0.66;
    pivot.add(shaft);
    const foot = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.3), bootMat));
    foot.position.set(0, -0.74, 0.06);
    pivot.add(foot);
    group.add(pivot);
    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // ---- arms: shoulder pivot + elbow pivot, katana in each fist (two-blade style) ----
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.36 * side, 1.42, 0);
    // rolled jacket sleeve cap at the shoulder
    const sleeve = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), jacketMat));
    pivot.add(sleeve);
    const upper = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.24, 4, 8), skinMat));
    upper.position.y = -0.17;
    pivot.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    pivot.add(elbow);
    const forearm = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.2, 4, 8), skinMat));
    forearm.position.y = -0.13;
    elbow.add(forearm);
    const fist = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), skinMat));
    fist.position.y = -0.29;
    elbow.add(fist);
    // katana held in the fist, blade continuing down past the hand
    const katana = makeKatana();
    katana.position.y = -0.05;
    fist.add(katana);
    pivot.rotation.z = -0.14 * side;
    pivot.userData.elbow = elbow;
    pivot.userData.katana = katana;
    group.add(pivot);
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // ---- slash: fast horizontal double-slash (both arms sweep) ----
  // beginSlash() arms the sequence; update() plays it out over SLASH_DUR seconds.
  const SLASH_DUR = 0.42;
  let slashT = 0; // counts down from SLASH_DUR; 0 = not slashing

  function beginSlash() {
    slashT = SLASH_DUR;
  }

  function isSlashing() {
    return slashT > 0;
  }

  // 0 (just started) → 1 (finished); 1 when idle
  function slashProgress() {
    return 1 - slashT / SLASH_DUR;
  }

  const easeOut = (x) => 1 - Math.pow(1 - x, 3);

  // ---- animation ----
  // state fields read by update(dt, t, state):
  //   speed:    0..1  locomotion blend (0 idle, 1 full run) — drives leg/arm cycle
  //   grounded: bool  false = airborne pose (legs trail)
  //   kneeling: bool  true = downed pose (one knee, head bowed) — used by crew.js
  let phase = 0;

  function update(dt, t, state) {
    state = state || {};
    const speed = state.speed || 0;
    const grounded = state.grounded !== false;
    phase += dt * (4 + speed * 9);

    // ---- victory pose (Runde 9): blades crossed in front of the chest, a beat
    // of stillness while the camera orbits the win pose — mirrors hero.js ----
    if (state.victory) {
      slashT = 0;
      legL.rotation.x = 0.1;
      legR.rotation.x = -0.05;
      torso.position.y = 1.05;
      neck.position.y = 1.64;
      headPivot.position.y = 1.66;
      armL.rotation.set(-0.9, 0, 0.55);
      armR.rotation.set(-0.9, 0, -0.55);
      armL.userData.elbow.rotation.x = -0.5;
      armR.userData.elbow.rotation.x = -0.5;
      torso.rotation.set(0, 0, 0);
      headPivot.rotation.set(0, 0.04, 0);
      const breathe = Math.sin(t * 2) * 0.018;
      torso.scale.set(1, 1 + breathe, 1);
      return;
    }

    // ---- kneel pose (companion downed) overrides everything ----
    if (state.kneeling) {
      slashT = 0;
      legL.rotation.x = -1.5;              // left knee down, folded back
      legR.rotation.x = 0.9;               // right foot planted forward
      group.position.y = 0;                // caller owns x/z; we sink via torso
      torso.position.y = 0.78;
      torso.rotation.x = 0.45;             // slumped forward
      torso.rotation.y = 0;
      neck.position.y = 1.3;
      headPivot.position.y = 1.32;
      headPivot.rotation.x = 0.55;         // head bowed
      // arms hang, katana tips resting on the ground like canes
      for (const arm of [armL, armR]) {
        arm.rotation.set(0.35, 0, arm === armL ? 0.2 : -0.2);
        arm.userData.elbow.rotation.x = -0.2;
      }
      // slow heavy breathing
      const breathe = Math.sin(t * 2.2) * 0.03;
      torso.scale.set(1, 1 + breathe, 1);
      return;
    }

    // restore skeleton baselines that the kneel pose moves
    torso.position.y = 1.05;
    neck.position.y = 1.64;
    headPivot.position.y = 1.66;

    // ---- slash sequence: two horizontal sweeps, right arm then left ----
    if (slashT > 0) {
      slashT = Math.max(0, slashT - dt);
      const p = 1 - slashT / SLASH_DUR; // 0 → 1

      // stance: low, torso driving the cuts
      legL.rotation.x = 0.55;
      legR.rotation.x = -0.45;
      torso.position.y = 1.0;

      // both arms horizontal, blades out
      for (const arm of [armL, armR]) {
        arm.rotation.x = -1.35;                     // forward, level
        arm.userData.elbow.rotation.x = -0.15;
      }

      if (p < 0.5) {
        // cut 1: sweep right→left. Torso twists through, arms carried across.
        const k = easeOut(p / 0.5);
        torso.rotation.y = 0.7 - 1.5 * k;
        armR.rotation.z = 1.0 - 2.2 * k;            // right blade whips across
        armL.rotation.z = 0.5 - 1.1 * k;
      } else {
        // cut 2: return sweep left→right, mirrored
        const k = easeOut((p - 0.5) / 0.5);
        torso.rotation.y = -0.8 + 1.5 * k;
        armL.rotation.z = -1.0 + 2.2 * k;
        armR.rotation.z = -1.2 + 1.3 * k;
      }
      torso.rotation.x = 0.28;                      // leaned into the cuts
      headPivot.rotation.x = 0.1;
      headPivot.rotation.z = 0;
      return;
    }

    // ---- locomotion ----
    const swing = Math.sin(phase) * (0.22 + speed * 0.55);
    legL.rotation.x = swing;
    legR.rotation.x = -swing;

    // Kai runs with blades LOW and trailing behind — arms swept back, not pumping
    const trail = 0.55 + speed * 0.5;
    armL.rotation.x = trail * speed + 0.1;
    armR.rotation.x = trail * speed + 0.1;
    armL.rotation.z = 0.25 + 0.15 * speed;   // held out from the body
    armR.rotation.z = -0.25 - 0.15 * speed;
    armL.userData.elbow.rotation.x = -0.25 - swing * 0.15;
    armR.userData.elbow.rotation.x = -0.25 + swing * 0.15;

    // bob
    const bob = Math.abs(Math.sin(phase)) * (0.015 + speed * 0.05);
    torso.position.y = 1.05 + bob;
    headPivot.position.y = 1.66 + bob;
    neck.position.y = 1.64 + bob;

    // idle breathing — slow and steady, a swordsman at rest
    let tsy = 1;
    if (speed < 0.1) tsy += Math.sin(t * 1.4) * 0.012;
    torso.scale.set(1, tsy, 1);

    // idle stance: slight coiled sway, arms settled at the sides
    if (speed < 0.1 && grounded) {
      torso.rotation.z = Math.sin(t * 0.55) * 0.02;
      headPivot.rotation.z = Math.sin(t * 0.55 + 0.7) * 0.02;
      armL.rotation.x = 0.12 + Math.sin(t * 1.4) * 0.02;
      armR.rotation.x = 0.12 - Math.sin(t * 1.4) * 0.02;
      armL.rotation.z = 0.18;
      armR.rotation.z = -0.18;
    } else {
      torso.rotation.z = 0;
      headPivot.rotation.z = 0;
    }

    // airborne pose
    if (!grounded) {
      legL.rotation.x = 0.45;
      legR.rotation.x = -0.3;
    }

    // lean into the run — head level, eyes on the target
    headPivot.rotation.x = grounded ? speed * 0.08 : -0.12;
    torso.rotation.x = speed * 0.16;
    torso.rotation.y = Math.sin(phase) * 0.06 * speed;
  }

  return { group, update, beginSlash, isSlashing, slashProgress, height: 1.9, radius: 0.45 };
}
