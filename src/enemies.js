// enemies.js — marine soldier + boss models, AI, wave management
import * as THREE from 'three';
import { ISLAND_RADIUS, clampToWalkable, groundHeightAt } from './arena.js';

// R13 (offene Insel): Gegner erscheinen am Dorfrand rund um den Kampf-Platz,
// nicht mehr am (jetzt viel weiteren) Inselrand. Der Ring 16-20m liegt (um den
// Ursprung gemessen) zwischen den Prop-Clustern (~15m) und den innersten Häusern
// (r>=22). Seit R15 liegt sein Mittelpunkt beim Spieler (startWave-Anker), deshalb
// prüft _findSpawnPoint jeden Kandidaten AM ENDGÜLTIGEN ORT gegen die Kollider.
// Das Push-out in update() bleibt nur das letzte Netz — es greift erst einen Frame
// nach dem Spawn und ist daher kein Ersatz für eine echte Prüfung.
const SPAWN_RING_MIN = 16;
const SPAWN_RING_MAX = 20;
const SPAWN_CLEARANCE = 0.7;   // Mindestabstand Spawnpunkt -> Kollider (R13-Kritik #11).
                               // Muss > max(e.radius) = 0.5 * 1.2 (petty) = 0.6 bleiben: nur dann
                               // liegt ein geprüfter Punkt sicher außerhalb der Push-out-Schwelle
                               // (o.radius + e.radius) und der Marine wird im Folgeframe NICHT
                               // versetzt — kein sichtbares Ploppen.
const WALKABLE_TOP_MAX = 0.3;  // Kollider mit so niedriger Standfläche (Steg-Planken) blockieren niemanden

const BOSS_HP = 650;
const BOSS_SPEED = 2.3;
const BOSS_DMG = 18;

// Wave-1 friendly baseline (scales +0.2 speed per wave)
const MARINE_SPEED = 2.4;
const MARINE_DMG = 4;
const MARINE_WINDUP = 1.0;       // long, readable windup — telegraph ring visible the whole time
const STRIKE_TIME = 0.15;        // the swing itself is quick — snap after the telegraph
const DANGER_LEAD = 0.38;        // final windup stretch: strobe + danger cue = "dodge NOW" window
const SALUTE_TIME = 0.6;         // brief salute when a marine enters the field
const BOSS_WINDUP = 0.9;

// Swarm-fairness knobs
// attack tokens are wave-scaled in update(): 1 melee attacker in wave 1, 2 from wave 2 on
const HIT_BACKOFF = 2;           // seconds a marine backs off after landing a hit
const REGEN_DELAY = 5;           // seconds without damage before player regen kicks in
const REGEN_RATE = 5;            // HP/s regen (applied via api.healPlayer when available)
const PICKUP_HEAL = 15;          // HP restored by a meat pickup
const PICKUP_RADIUS = 1.0;
const PICKUP_CHANCE = 0.4;
const HOLD_MIN = 3.5;            // token-less marines orbit at this ring
const HOLD_MAX = 4.5;
const WAVE_GRACE = 3;            // seconds after wave start with no attacks
const SPAWN_STAGGER = 2;         // seconds between marine spawns in a wave
const PLAYER_IFRAMES = 0.7;      // enforced here so overlapping strikes can't double-dip

// Variant stat sheets
const VARIANTS = {
  swabbie:  { hp: 40, dmg: MARINE_DMG, range: 1.7, scarf: 0x2b4fa0, scale: 1.0 },
  rifleman: { hp: 40, dmg: MARINE_DMG, range: 8.0, scarf: 0x2b4fa0, scale: 1.0, rifle: true, fireCd: 3 },
  petty:    { hp: 90, dmg: 7, range: 1.9, scarf: 0x9a2b2b, scale: 1.2, speed: 2.0, vest: true },
};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
}

function shadow(m) {
  m.castShadow = true;
  return m;
}

// ---------- procedural textures (cached) ----------
let _faceTex = null;
function faceTexture() {
  if (_faceTex) return _faceTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e6b088';
  ctx.fillRect(0, 0, 128, 128);
  // face lives at u=0.25 (sphere +Z / enemy forward) → canvas x ≈ 32
  ctx.fillStyle = '#1a1a1a';
  for (const ex of [24, 40]) {
    ctx.beginPath();
    ctx.arc(ex, 57, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // small mouth
  ctx.strokeStyle = '#7a4a30';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(32, 70, 6, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  _faceTex = new THREE.CanvasTexture(c);
  _faceTex.colorSpace = THREE.SRGBColorSpace;
  return _faceTex;
}

let _capTex = null;
function capBandTexture() {
  if (_capTex) return _capTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f0f0ec';
  ctx.fillRect(0, 0, 256, 64);
  // MARINE-blue band with text, repeated so it reads from any side
  ctx.fillStyle = '#2b4fa0';
  ctx.fillRect(0, 34, 256, 24);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MARINE', 64, 47);
  ctx.fillText('MARINE', 192, 47);
  _capTex = new THREE.CanvasTexture(c);
  _capTex.colorSpace = THREE.SRGBColorSpace;
  return _capTex;
}

// ---------- marine model ----------
// Each marine gets its own torso/head materials so hit-flash doesn't leak between units.
// exportiert (R18 Aufgabe A): episode.js baut damit die 3 Marine-Statisten fuer "The
// Levy" - reiner Look-Reuse, keine AI/Update-Kopplung, keine Math.random hier.
export function buildMarine(variant = 'swabbie') {
  const spec = VARIANTS[variant] || VARIANTS.swabbie;
  const g = new THREE.Group();
  const uniformMat = mat(0xe8e8e4);
  const trimMat = mat(0x2b4fa0);
  const scarfMat = mat(spec.scarf);
  const skinMat = mat(0xe6b088, { map: faceTexture() });
  skinMat.color.setHex(0xffffff); // texture carries the skin tone
  const pantsMat = mat(0xf0f0ec);
  const darkMat = mat(0x25303e);
  const flashable = [uniformMat, skinMat, pantsMat];

  const torso = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 4, 10), uniformMat));
  torso.position.y = 1.0;
  g.add(torso);

  // Petty Officer: grey vest box over torso
  if (spec.vest) {
    const vestMat = mat(0x6f7a86);
    flashable.push(vestMat);
    const vest = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.5), vestMat));
    vest.position.y = 1.05;
    g.add(vest);
  }

  // neckerchief (variant-tinted)
  const scarf = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.14, 10), scarfMat);
  scarf.position.y = 1.38;
  g.add(scarf);

  const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat));
  head.position.y = 1.68;
  g.add(head);

  // dark belt — breaks up the all-white silhouette so poses read at distance
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.07, 10), mat(0x25303e));
  belt.position.y = 1.30;
  g.add(belt);

  // cap: white cylinder with MARINE band texture + blue top trim + dark visor
  const capBandMat = mat(0xffffff, { map: capBandTexture() });
  const capPlainMat = mat(0xf0f0ec);
  const cap = shadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.235, 0.26, 0.14, 12),
    [capBandMat, capPlainMat, capPlainMat],
  ));
  cap.position.y = 1.88;
  g.add(cap);
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.235, 0.03, 12), trimMat);
  capTop.position.y = 1.955;
  g.add(capTop);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.16), darkMat);
  visor.position.set(0, 1.83, 0.22);
  g.add(visor);

  // legs: hip pivot + knee pivot so the walk cycle gets a real knee bend
  const thighGeo = new THREE.CapsuleGeometry(0.095, 0.2, 4, 8);
  const shinGeo = new THREE.CapsuleGeometry(0.085, 0.2, 4, 8);
  const legs = [];
  const knees = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.13 * s, 0.75, 0);
    const thigh = shadow(new THREE.Mesh(thighGeo, pantsMat));
    thigh.position.y = -0.18;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.36;
    const shin = shadow(new THREE.Mesh(shinGeo, pantsMat));
    shin.position.y = -0.16;
    knee.add(shin);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.26), darkMat);
    boot.position.set(0, -0.32, 0.05);
    knee.add(boot);
    hip.add(knee);
    g.add(hip);
    legs.push(hip);
    knees.push(knee);
  }

  // arms + weapon in right hand
  const armGeo = new THREE.CapsuleGeometry(0.075, 0.42, 4, 8);
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.36 * s, 1.32, 0);
    const arm = shadow(new THREE.Mesh(armGeo, uniformMat));
    arm.position.y = -0.26;
    pivot.add(arm);
    // blue cuff — arm-pose contrast against the white uniform
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 8), trimMat);
    cuff.position.y = -0.44;
    pivot.add(cuff);
    if (s === 1) {
      if (spec.rifle) {
        const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.95), darkMat);
        rifle.position.set(0, -0.5, 0.3);
        pivot.add(rifle);
      } else {
        // wooden baton with a light tip band — visible against shadows
        const batonMat = mat(0x8a5a2b);
        const baton = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), batonMat);
        baton.position.set(0, -0.55, 0.18);
        baton.rotation.x = Math.PI / 2.4;
        pivot.add(baton);
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.05, 6), mat(0xd0d0d0));
        tip.position.y = 0.32;
        baton.add(tip);
      }
    }
    // Petty Officer: gold chevron stripe on left upper arm
    if (s === -1 && spec.vest) {
      const goldMat = mat(0xc9a84c, { roughness: 0.5, metalness: 0.4 });
      for (const cs of [-1, 1]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.03), goldMat);
        stripe.position.set(0, -0.12 + 0.02 * cs, 0.085);
        stripe.rotation.z = cs * 0.6;
        stripe.position.x = cs * 0.035;
        pivot.add(stripe);
      }
    }
    g.add(pivot);
    arms.push(pivot);
  }

  if (spec.scale !== 1) g.scale.setScalar(spec.scale);

  return { group: g, legs, knees, arms, flashable, torso };
}

// ---------- boss: Marine Captain Axthand Vargo (internal fn name kept: buildMorgan) ----------
function buildMorgan() {
  const g = new THREE.Group();
  const coatMat = mat(0x8e9296);          // grey marine coat
  const skinMat = mat(0xd9a273);
  const steelMat = mat(0xb8bec6, { roughness: 0.35, metalness: 0.75 });
  const darkMat = mat(0x252c36);
  const goldMat = mat(0xc9a84c, { roughness: 0.5, metalness: 0.4 });
  const flashable = [coatMat, skinMat];

  const torso = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.9, 6, 12), coatMat));
  torso.position.y = 1.65;
  torso.scale.set(1.2, 1, 0.92);
  g.add(torso);

  // long coat skirt for bulk
  const skirt = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.85, 1.0, 12, 1, true), coatMat));
  skirt.position.y = 0.95;
  g.add(skirt);

  // epaulettes
  for (const s of [-1, 1]) {
    const ep = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.54), goldMat));
    ep.position.set(0.72 * s, 2.34, 0);
    g.add(ep);
  }

  const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), skinMat));
  head.position.y = 2.85;
  g.add(head);

  // steel jaw — broad and jutting
  const jaw = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.28, 0.46), steelMat));
  jaw.position.set(0, 2.66, 0.14);
  g.add(jaw);

  // steel headpiece / small axe crest on top
  const crest = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.56), steelMat));
  crest.position.y = 3.27;
  g.add(crest);

  // legs
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.28 * s, 1.15, 0);
    const leg = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.7, 4, 8), darkMat));
    leg.position.y = -0.55;
    pivot.add(leg);
    g.add(pivot);
    legs.push(pivot);
  }

  // left arm normal
  const armL = new THREE.Group();
  armL.position.set(-0.78, 2.1, 0);
  const la = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.72, 4, 8), coatMat));
  la.position.y = -0.45;
  armL.add(la);
  g.add(armL);

  // RIGHT ARM = AXE. Pivot at shoulder.
  const axeArm = new THREE.Group();
  axeArm.position.set(0.82, 2.15, 0);
  const forearm = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.0, 10), steelMat));
  forearm.position.y = -0.55;
  axeArm.add(forearm);
  // axe head: broad wedge
  const blade = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.09, 3), steelMat));
  blade.position.y = -1.35;
  blade.rotation.z = Math.PI / 2;
  blade.rotation.y = Math.PI / 2;
  blade.scale.set(1, 1, 1.6);
  axeArm.add(blade);
  g.add(axeArm);

  // more imposing overall
  g.scale.setScalar(1.12);

  const arms = [armL, axeArm];
  return { group: g, legs, arms, flashable, torso, axeArm, head, jaw };
}

// ---------- enemy wrapper ----------

let enemyId = 0;

class Enemy {
  constructor(build, isBoss, variant = 'swabbie') {
    this.id = enemyId++;
    this.isBoss = isBoss;
    this.variant = isBoss ? 'boss' : variant;
    const spec = VARIANTS[variant] || VARIANTS.swabbie;
    const parts = isBoss ? buildMorgan() : buildMarine(variant);
    this.group = parts.group;
    this.legs = parts.legs;
    this.knees = parts.knees || [];
    this.torso = parts.torso || null;
    this.arms = parts.arms;
    this.flashable = parts.flashable;
    this.axeArm = parts.axeArm || null;
    this.head = parts.head || null;
    this.jaw = parts.jaw || null;
    this.maxHp = isBoss ? BOSS_HP : spec.hp;
    this.hp = this.maxHp;
    this.radius = isBoss ? 1.1 : 0.5 * spec.scale;
    this.height = isBoss ? 3.7 : 2.0 * spec.scale;
    this.baseSpeed = isBoss ? BOSS_SPEED : (spec.speed || MARINE_SPEED);
    this.speed = this.baseSpeed * (0.85 + Math.random() * 0.3);
    this.damage = isBoss ? BOSS_DMG : spec.dmg;
    this.attackRange = isBoss ? 2.9 : spec.range;
    this.isRanged = !isBoss && !!spec.rifle;
    this.windup = isBoss ? BOSS_WINDUP : MARINE_WINDUP;
    this.vel = new THREE.Vector3();
    this.prevPos = new THREE.Vector3(); // letzte gültige Position — Grenz-Slide statt Radial-Ruck
    this.alive = true;
    this.dying = 0;           // death timer
    this.state = 'chase';     // chase | windup | strike | recover | stagger
    this.stateT = 0;
    this.flashT = 0;
    this.phase = Math.random() * 10;
    this.attackCd = 1.5 + Math.random();
    this.spawnT = 0;          // >0 = not yet on the field (staggered spawn)
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 1 + Math.random() * 2;
    this.backoffT = 0;        // >0 = backing away after landing a hit on the player
    this.aimLine = null;      // rifleman windup aim-line (owned by manager scene)
    this.saluteT = 0;         // >0 = salute-then-hop intro when entering the field
    this.leanDot = 0;         // movement dir vs facing (-1..1) — drives the run lean

    // ---- anime hit-reaction state ----
    this.baseScale = this.group.scale.x;   // variant scale baseline for squash-stretch
    this.kbT = 0;                          // knockback timer (>0 = ragdolling, harmless, un-pathed)
    this.kbDur = 0;
    this.kbSpins = 0;                      // total radians of tumble during knockback
    this.kbAxis = 'x';                     // 'x' = front-flip, 'y' = pirouette
    this.hitCount = 0;                     // boss: reel every 5th hit
    this.reelT = 0;                        // boss stagger/head-snap timer
    this.koLanded = false;                 // KO ragdoll: bounced yet?
    this.koLandT = 0;                      // seconds since KO landing (sink after 1.2s)

    // attack telegraph ring (flat on ground, animated during windup)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3b30, transparent: true, opacity: 0.5,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const ringScale = isBoss ? 2.2 : 1;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.45 * ringScale, 0.65 * ringScale), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    // counter parent scale so the ring size stays true for scaled variants
    this.ringBase = this.group.scale.x !== 1 ? 1 / this.group.scale.x : 1;
    this.ring.scale.setScalar(this.ringBase);
    this.group.add(this.ring);
  }

  takeHit(dmg, dir, power) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flashT = 0.06; // pure-white pop, 60ms

    const kb = this.isBoss ? power * 0.15 : power * 1.5;
    this.vel.x += dir.x * kb;
    this.vel.z += dir.z * kb;

    if (!this.isBoss) {
      // exaggerated anime launch: upward arc + 1-2 full body spins + squash on impact
      this.vel.y += kb * 0.45;
      this.kbDur = 0.45 + Math.min(power, 8) * 0.04;
      this.kbT = this.kbDur;
      const fullSpins = power > 4 ? 2 : 1;
      this.kbSpins = fullSpins * Math.PI * 2;
      this.kbAxis = Math.random() < 0.35 ? 'y' : 'x';
      this.state = 'knockback';           // cancels windup/strike — deals no damage while flying
      this.stateT = this.kbDur;
      this.ring.visible = false;
      // launch squash: wide + short
      this.group.scale.set(this.baseScale * 1.15, this.baseScale * 0.85, this.baseScale * 1.15);
    } else {
      // boss: heavier feedback — every 5th hit staggers Vargo with a head snap + arms-out reel
      this.hitCount++;
      if (this.hitCount % 5 === 0) {
        this.state = 'stagger';
        this.stateT = 0.3;
        this.reelT = 0.3;
        this.ring.visible = false;
        if (typeof window !== 'undefined' && window.__hitStop) window.__hitStop(70);
      }
    }

    if (this.hp <= 0) {
      this.alive = false;
      this.dying = 0.001;
      this.ring.visible = false;
      // KO gets an extra pop so the tumble ragdoll reads
      if (!this.isBoss) { this.vel.y = Math.max(this.vel.y, 5.5); this.vel.x *= 1.2; this.vel.z *= 1.2; }
      return true; // killed
    }
    return false;
  }
}

// ---------- manager ----------

export const WAVES = [
  { label: 'Wave 1', count: 3, comp: ['swabbie', 'swabbie', 'swabbie'] },
  { label: 'Wave 2', count: 6, comp: ['swabbie', 'swabbie', 'swabbie', 'swabbie', 'rifleman', 'rifleman'] },
  { label: 'Wave 3', count: 8, comp: ['swabbie', 'swabbie', 'swabbie', 'swabbie', 'rifleman', 'rifleman', 'rifleman', 'petty'] },
  { label: 'Boss', count: 0, boss: true },
];

export class EnemyManager {
  constructor(scene, obstacles) {
    this.scene = scene;
    this.obstacles = obstacles;
    this.enemies = [];
    this.boss = null;
    this.projectiles = [];
    this.pickups = [];        // meat heal pickups dropped on marine KO
    this.dust = [];           // expanding dust-flash rings (KO bounces, knockback landings)
    this.graceT = 0;          // no attacks while > 0
    this.playerIFrames = 0;   // enforced i-frames between hits on the player
    this.lastPlayerHitT = 999; // seconds since the player last took damage (regen gate)
    this.waveIndex = 0;
    this._v = new THREE.Vector3();
    this._perp = new THREE.Vector3();
    this._rampA = new THREE.Color(); // telegraph color ramp scratch
    this._rampB = new THREE.Color();
    this._chest = new THREE.Vector3(); // Aim-Line-Ziel-Scratch (R13-Kritik #9: keine Allokation pro Frame)
  }

  get aliveCount() {
    return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
  }

  spawnMarine(x, z, variant = 'swabbie', spawnDelay = 0) {
    const e = new Enemy(buildMarine, false, variant);
    e.group.position.set(x, 0, z);
    e.prevPos.copy(e.group.position); // Grenz-Slide-Basis: nie der Ursprung, immer der Spawnpunkt
    // wave speed scaling: +0.2 per wave; wave 1 walks ~20% slower so beginners can kite
    if (!VARIANTS[variant]?.speed) {
      const waveMul = this.waveIndex === 0 ? 0.8 : 1;
      e.speed = (MARINE_SPEED + 0.2 * this.waveIndex) * waveMul * (0.85 + Math.random() * 0.3);
    }
    e.spawnT = spawnDelay;
    e.saluteT = SALUTE_TIME;  // alert intro: salute, hop, then run in
    if (spawnDelay > 0) e.group.visible = false;
    this.scene.add(e.group);
    this.enemies.push(e);
    return e;
  }

  spawnBoss() {
    const e = new Enemy(buildMorgan, true);
    e.group.position.set(0, 0, -24);
    this.scene.add(e.group);
    this.enemies.push(e);
    this.boss = e;
    return e;
  }

  _spawnPointClear(x, z) {
    for (const o of this.obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.radius + SPAWN_CLEARANCE) return false;
    }
    return true;
  }

  // Spawnpunkt am Ring um (ax, az), vorab gegen Kollider gerollt — kein Marine ploppt aus
  // einer Kiste. Der Anker kommt aus main.js (der Fächer folgt dem Spieler) und geht
  // VORWÄRTS in die Prüfung: getestet wird der Punkt, an dem der Marine wirklich steht.
  // Früher wurde der Ursprungsring geprüft und der fertige Marine danach verschoben —
  // damit galt die Freiraum-Zusage für einen Punkt, den nie jemand einnahm.
  //
  // Zwei Anläufe: erst um den Anker, dann (falls dort alles verbaut ist) um den Ursprung,
  // dessen Ring zwischen Prop-Clustern und Häusern liegt und praktisch immer frei ist.
  // Innerhalb eines Anlaufs öffnet die zweite Hälfte der Versuche den Winkel auf den
  // vollen Kreis, damit ein zugestellter Fächer-Sektor nicht sofort den Anker aufgibt.
  _findSpawnPoint(baseAngle, ax = 0, az = 0) {
    const anchored = ax !== 0 || az !== 0;
    let x = 0, z = 0;
    for (let pass = 0; pass < 2; pass++) {
      const cx = pass === 0 && anchored ? ax : 0;
      const cz = pass === 0 && anchored ? az : 0;
      for (let tries = 0; tries < 14; tries++) {
        const a = tries < 7 ? baseAngle + Math.random() * 0.5 : Math.random() * Math.PI * 2;
        const r = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);
        x = cx + Math.cos(a) * r;
        z = cz + Math.sin(a) * r;
        if (this._spawnPointClear(x, z)) return [x, z];
      }
      if (!anchored) break; // ohne Anker wäre der zweite Anlauf derselbe
    }
    return [x, z]; // nichts frei: letzter Kandidat, das Push-out fängt ihn ab
  }

  // ax/az: Mittelpunkt des Spawn-Fächers (main.js spawnAnchorForPlayer). 0/0 = Dorfmitte.
  startWave(index, ax = 0, az = 0) {
    const wave = WAVES[index];
    if (!wave) return;
    this.waveIndex = index;
    this.graceT = WAVE_GRACE;
    if (wave.boss) {
      // Boss-Welle ignoriert den Anker: die feste Position trägt den Kamera-Anflug
      this.spawnBoss();
      // two honor guards
      this.spawnMarine(-5, -22, 'swabbie');
      this.spawnMarine(5, -22, 'swabbie');
      return;
    }
    const comp = wave.comp || new Array(wave.count).fill('swabbie');
    for (let i = 0; i < comp.length; i++) {
      const [x, z] = this._findSpawnPoint((i / comp.length) * Math.PI * 2, ax, az);
      // staggered arrival: 2s apart, so they never all reach the player at once
      this.spawnMarine(x, z, comp[i], i * SPAWN_STAGGER);
    }
  }

  clear() {
    for (const e of this.enemies) {
      if (e.aimLine) this.scene.remove(e.aimLine);
      this.scene.remove(e.group);
    }
    this.enemies.length = 0;
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      if (p.trail) this.scene.remove(p.trail);
    }
    this.projectiles.length = 0;
    for (const pk of this.pickups) this.scene.remove(pk.mesh);
    this.pickups.length = 0;
    for (const d of this.dust) {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
    }
    this.dust.length = 0;
    this.boss = null;
    this.graceT = 0;
    this.playerIFrames = 0;
    this.lastPlayerHitT = 999;
  }

  // Gate all player damage through manager-level i-frames so overlapping
  // strikes can never double-dip. Returns true if damage actually landed.
  _hitPlayer(api, amount, fromPos) {
    if (this.playerIFrames > 0) return false;
    this.playerIFrames = PLAYER_IFRAMES;
    this.lastPlayerHitT = 0; // reset the regen timer
    api.damagePlayer(amount, fromPos);
    return true;
  }

  // ---- meat heal pickup (bone + two meat blobs, primitives only) ----
  _spawnPickup(x, z) {
    const g = new THREE.Group();
    const bone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.8 }),
    );
    bone.rotation.z = Math.PI / 2;
    g.add(bone);
    const meatMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 });
    for (const s of [-1, 1]) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), meatMat);
      blob.position.x = s * 0.2;
      g.add(blob);
    }
    const baseY = groundHeightAt(x, z) + 0.6; // schwebt über dem Relief, nicht über y=0
    g.position.set(x, baseY, z);
    this.scene.add(g);
    this.pickups.push({ mesh: g, baseY, t: Math.random() * Math.PI * 2, life: 20 });
  }

  _updatePickups(dt, playerPos, api) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      pk.life -= dt;
      pk.mesh.position.y = pk.baseY + Math.sin(pk.t * 3) * 0.1;
      pk.mesh.rotation.y += 1.5 * dt;
      const dx = pk.mesh.position.x - playerPos.x;
      const dz = pk.mesh.position.z - playerPos.z;
      const grabbed = (dx * dx + dz * dz) < PICKUP_RADIUS * PICKUP_RADIUS;
      if (grabbed && api.healPlayer) api.healPlayer(PICKUP_HEAL);
      if (grabbed || pk.life <= 0) {
        this.scene.remove(pk.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  // ---- dust-colored impact flash: flat ring that pops outward and fades ----
  _spawnDust(x, z, scale = 1) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.55),
      new THREE.MeshBasicMaterial({
        color: 0xcbb894, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, groundHeightAt(x, z) + 0.04, z); // liegt auf dem Relief, versinkt nicht (R13-Kritik #2)
    m.scale.setScalar(scale);
    this.scene.add(m);
    this.dust.push({ mesh: m, t: 0, scale });
  }

  _updateDust(dt) {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.t += dt;
      const p = d.t / 0.35;
      d.mesh.scale.setScalar(d.scale * (1 + p * 2.4));
      d.mesh.material.opacity = 0.85 * Math.max(0, 1 - p);
      if (p >= 1) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
        this.dust.splice(i, 1);
      }
    }
  }

  // Weltposition der Gewehrmündung — Kette Waffe -> Arm -> Gruppe -> Welt.
  // updateWorldMatrix() zieht die Kette auf den Stand DIESES Frames hoch; sonst
  // stammt matrixWorld noch aus dem letzten Render (Position/Bodenhöhe von gestern).
  _muzzleWorld(e, out) {
    e.arms[1].updateWorldMatrix(true, false);
    return e.arms[1].localToWorld(out.set(0, -0.5, 0.75)); // Vorderkante des Gewehrlaufs
  }

  _fireTracer(e, playerPos) {
    // gleicher Mündungspunkt wie die Ziel-Linie: der Schuss startet an der Waffe,
    // nicht an einer festen Schulterhöhe über der Gruppe
    const origin = this._muzzleWorld(e, new THREE.Vector3());
    const target = new THREE.Vector3(playerPos.x, playerPos.y + 1.1, playerPos.z);
    const vel = target.sub(origin).normalize().multiplyScalar(19); // snappy — shots feel like shots
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd34d }),
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);
    // faint trail sphere behind the tracer so incoming fire is trackable
    const trail = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.3 }),
    );
    trail.scale.set(1, 1, 2.2); // stretched to ~0.3 length along travel
    trail.position.copy(origin);
    this.scene.add(trail);
    this.projectiles.push({ mesh, trail, vel, life: 2.5, dmg: e.damage });
  }

  _updateProjectiles(dt, playerPos, api) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.trail) {
        p.trail.position.copy(p.mesh.position).addScaledVector(p.vel, -0.3 / 19);
        p.trail.lookAt(p.mesh.position);
      }
      const dx = p.mesh.position.x - playerPos.x;
      const dy = p.mesh.position.y - (playerPos.y + 1.0);
      const dz = p.mesh.position.z - playerPos.z;
      const hit = (dx * dx + dz * dz) < 0.45 && Math.abs(dy) < 1.2;
      if (hit) this._hitPlayer(api, p.dmg, p.mesh.position);
      if (hit || p.life <= 0 || Math.hypot(p.mesh.position.x, p.mesh.position.z) > ISLAND_RADIUS + 6) {
        this.scene.remove(p.mesh);
        if (p.trail) this.scene.remove(p.trail);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // api: { damagePlayer(amount, fromPos), onEnemyAttackSwing(enemy), healPlayer?(amount) }
  update(dt, t, playerPos, api) {
    this.graceT = Math.max(0, this.graceT - dt);
    this.playerIFrames = Math.max(0, this.playerIFrames - dt);
    this._updateProjectiles(dt, playerPos, api);
    this._updatePickups(dt, playerPos, api);
    this._updateDust(dt);

    // recovery loop: after REGEN_DELAY s without taking damage, regen HP
    // (lastPlayerHitT is public so the player module can drive its own regen too)
    this.lastPlayerHitT += dt;
    if (this.lastPlayerHitT > REGEN_DELAY && api.healPlayer) {
      api.healPlayer(REGEN_RATE * dt);
    }

    // attack tokens: wave-scaled — only 1 melee marine may windup/strike in wave 1, 2 from wave 2
    const maxMeleeAttackers = this.waveIndex === 0 ? 1 : 2;
    let meleeAttackers = 0;
    for (const e of this.enemies) {
      if (e.alive && !e.isRanged && (e.state === 'windup' || e.state === 'strike')) meleeAttackers++;
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const g = e.group;

      // ---- staggered spawn: hidden + inert until its timer runs out ----
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        if (e.spawnT > 0) continue;
        g.visible = true;
      }

      // ---- death anim: tumble ragdoll, bounce once with a dust flash, sink after 1.2s ----
      if (!e.alive) {
        if (!e._pickupRolled) {
          e._pickupRolled = true;
          if (e.aimLine) { this.scene.remove(e.aimLine); e.aimLine = null; }
          // KOs answer chip damage: marines have a chance to drop a meat pickup
          if (!e.isBoss && Math.random() < PICKUP_CHANCE) {
            this._spawnPickup(g.position.x, g.position.z);
          }
        }
        e.dying += dt;

        // keep flying with the KO launch velocity (Boden = Relief-Höhe, R13-Kritik #2)
        g.position.x += e.vel.x * dt;
        g.position.z += e.vel.z * dt;
        g.position.y += e.vel.y * dt;
        e.vel.x *= Math.pow(0.05, dt);
        e.vel.z *= Math.pow(0.05, dt);
        const koGy = groundHeightAt(g.position.x, g.position.z);
        if (g.position.y > koGy && !e.koLanded) {
          e.vel.y -= 22 * dt;
        } else if (!e.koLanded && e.dying > 0.05) {
          // first ground contact: one bounce + dust-colored impact flash
          e.koLanded = true;
          g.position.y = koGy;
          e.vel.y = 2.6;
          e.vel.x *= 0.4;
          e.vel.z *= 0.4;
          this._spawnDust(g.position.x, g.position.z, e.isBoss ? 1.8 : 1);
        } else if (e.koLanded) {
          // settle after the single bounce
          e.vel.y -= 22 * dt;
          if (g.position.y <= koGy) { g.position.y = koGy; e.vel.y = 0; }
        }

        // tumble to face-up (rotate backwards past vertical, then settle flat on the back)
        const flat = -Math.PI / 2;
        if (!e.koLanded) {
          g.rotation.x = Math.max(g.rotation.x - dt * 9, flat - 0.5); // overshoot tumble
        } else {
          g.rotation.x += (flat - g.rotation.x) * Math.min(1, dt * 12);
          e.koLandT += (g.position.y <= koGy + 0.001 ? dt : 0);
        }

        // sink 1.2s after coming to rest, then remove
        if (e.koLandT > 1.2) g.position.y -= dt * 1.6;
        if ((e.koLandT > 1.2 && g.position.y < koGy - 2.2) || e.dying > 6) {
          this.scene.remove(g);
          this.enemies.splice(i, 1);
          if (e === this.boss) this.boss = null;
        }
        continue;
      }

      // ---- hit flash: 60ms pure-white pop (anime impact frame) ----
      if (e.flashT > 0) {
        e.flashT -= dt;
        const on = e.flashT > 0;
        for (const m of e.flashable) {
          m.emissive.setHex(on ? 0xffffff : 0x000000);
          m.emissiveIntensity = on ? 2.5 : 0;
        }
      }

      // ---- knockback / physics (Boden = Relief-/Steg-Höhe, R13-Kritik #2) ----
      e.prevPos.copy(g.position); // Stand vor dem Frame-Move — Basis für den Grenz-Slide
      g.position.x += e.vel.x * dt;
      g.position.z += e.vel.z * dt;
      g.position.y += e.vel.y * dt;
      e.vel.x *= Math.pow(0.02, dt);
      e.vel.z *= Math.pow(0.02, dt);

      // auf der Insel bleiben: gleiche Korridor-Logik wie der Spieler —
      // Marines dürfen auf den Steg, aber nie ins Wasser (R13-Kritik #1).
      // Mit prevPos slidet die Grenze achsweise (wie beim Spieler), statt radial
      // zurückzusetzen — sonst ruckt ein Marine, der die Kante seitlich streift.
      clampToWalkable(g.position, e.prevPos);

      // obstacle push-out (flache Trittflächen wie die Steg-Planken blockieren nicht)
      for (const o of this.obstacles) {
        if (o.topY !== undefined && o.topY <= WALKABLE_TOP_MAX) continue;
        const dx = g.position.x - o.x;
        const dz = g.position.z - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.radius + e.radius;
        if (d < min && d > 0.001) {
          g.position.x = o.x + (dx / d) * min;
          g.position.z = o.z + (dz / d) * min;
        }
      }

      // Bodenhöhe ERST jetzt, wenn XZ endgültig ist: davor gerechnet trüge die Figur
      // die Höhe ihrer alten XZ mit — auf dem Steg (deckY) sackt sie sonst samt
      // Waffe/Mündung um die Deckhöhe ein, obwohl sie sichtbar auf den Planken steht.
      const eGy = groundHeightAt(g.position.x, g.position.z);
      const airborne = g.position.y > eGy + 0.001;
      if (airborne) e.vel.y -= 22 * dt;
      else { g.position.y = eGy; e.vel.y = 0; }

      // ---- anime knockback ragdoll: spin + squash-stretch, harmless + un-targetable AI-wise ----
      if (e.kbT > 0) {
        e.kbT -= dt;
        const prog = 1 - Math.max(e.kbT, 0) / e.kbDur;          // 0 → 1 over the knockback
        const ease = 1 - Math.pow(1 - prog, 2);
        const spin = e.kbSpins * ease;
        if (e.kbAxis === 'y') {
          if (e._spinBaseYaw === undefined) e._spinBaseYaw = g.rotation.y;
          g.rotation.y = e._spinBaseYaw + spin;                  // pirouette
        } else {
          g.rotation.x = -spin;                                  // backflip tumble
        }
        // squash-stretch: launch squash (1.15, 0.85) blends to in-air stretch (0.9, 1.1)
        const s = e.baseScale;
        const k = Math.min(1, prog * 3);
        g.scale.set(s * (1.15 - 0.25 * k), s * (0.85 + 0.25 * k), s * (1.15 - 0.25 * k));
        // flail limbs while airborne
        e.phase += dt * 14;
        const flail = Math.sin(e.phase) * 0.9;
        if (e.legs[0]) e.legs[0].rotation.x = flail;
        if (e.legs[1]) e.legs[1].rotation.x = -flail;
        if (e.arms[0]) e.arms[0].rotation.x = -2.6 + flail * 0.4;
        if (e.arms[1]) e.arms[1].rotation.x = -2.6 - flail * 0.4;
        if (e.aimLine) { this.scene.remove(e.aimLine); e.aimLine = null; }
        e.ring.visible = false;

        if (e.kbT <= 0) {
          if (g.position.y > eGy + 0.001) {
            e.kbT = 0.05;                                        // still airborne — hold ragdoll until landing
          } else {
            // touchdown: landing squash puff, then recover to a clean stance
            this._spawnDust(g.position.x, g.position.z, 0.7);
            g.rotation.x = 0;
            e._spinBaseYaw = undefined;
            g.scale.setScalar(s);
            if (e.arms[0]) e.arms[0].rotation.x = 0;
            if (e.arms[1]) e.arms[1].rotation.x = 0;
            e.state = 'chase';
            e.stateT = 0;
            e.attackCd = Math.max(e.attackCd, 0.8);
          }
        }
        continue;                                                // no AI, no attacks while ragdolling
      }

      // ---- AI ----
      const toPlayer = this._v.set(playerPos.x - g.position.x, 0, playerPos.z - g.position.z);
      const dist = toPlayer.length();
      e.stateT -= dt;
      e.attackCd -= dt;
      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafeDir *= -1;
        e.strafeT = 1.5 + Math.random() * 2.5;
      }

      // face player
      if (dist > 0.05) {
        const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
        let d = targetYaw - g.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        g.rotation.y += d * Math.min(1, dt * 8);
      }

      // ---- spawn salute: brief left-hand salute, then a small hop into the fight ----
      if (e.saluteT > 0 && !e.isBoss) {
        e.saluteT -= dt;
        const p = Math.min(1, (SALUTE_TIME - Math.max(e.saluteT, 0)) / 0.12); // arm snaps up fast
        if (e.arms[0]) { e.arms[0].rotation.x = -2.3 * p; e.arms[0].rotation.z = 0.55 * p; }
        if (e.arms[1]) e.arms[1].rotation.x = 0;
        if (e.legs[0]) e.legs[0].rotation.x = 0;
        if (e.legs[1]) e.legs[1].rotation.x = 0;
        if (e.saluteT <= 0) {
          if (e.arms[0]) e.arms[0].rotation.z = 0;
          e.vel.y = 3; // eager hop, then the run-in starts
        }
        continue;
      }

      e.backoffT = Math.max(0, e.backoffT - dt);
      const hasToken = e.isBoss || e.isRanged || meleeAttackers < maxMeleeAttackers;
      let moving = false;
      e.leanDot = 0;

      switch (e.state) {
        case 'stagger':
          if (e.stateT <= 0) e.state = 'chase';
          break;
        case 'chase': {
          // after landing a hit, back away from the player for a beat
          if (!e.isBoss && e.backoffT > 0) {
            toPlayer.normalize();
            moving = true;
            e.leanDot = -1; // backpedaling — lean away
            g.position.x -= toPlayer.x * e.speed * 0.8 * dt;
            g.position.z -= toPlayer.z * e.speed * 0.8 * dt;
            break;
          }
          const inReach = dist <= e.attackRange;
          // attack only when: past grace period, cooldown ready, holding a token
          if (inReach && e.attackCd <= 0 && this.graceT <= 0 && hasToken) {
            e.state = 'windup';
            e.stateT = e.windup;
            e.dangerCued = false;
            api.onWindupStart?.(e);
            if (!e.isRanged) meleeAttackers++;
            break;
          }
          toPlayer.normalize();
          this._perp.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(e.strafeDir);
          let mx = 0, mz = 0, speedMul = 1;

          if (e.isRanged) {
            // rifleman: keep 5-7.5m, sidestep while lining up shots
            if (dist > 7.5) { mx = toPlayer.x; mz = toPlayer.z; }
            else if (dist < 5) { mx = -toPlayer.x; mz = -toPlayer.z; speedMul = 0.8; }
            else { mx = this._perp.x * 0.8; mz = this._perp.z * 0.8; speedMul = 0.6; }
          } else if (!hasToken && dist < HOLD_MAX + 0.8 && !e.isBoss) {
            // no attack token: hold the 3.5-4.5m ring and strafe sideways
            let radial = 0;
            if (dist > HOLD_MAX) radial = 1;
            else if (dist < HOLD_MIN) radial = -1;
            mx = toPlayer.x * radial + this._perp.x * 1.2;
            mz = toPlayer.z * radial + this._perp.z * 1.2;
            speedMul = 0.75;
          } else if (dist > e.attackRange * 0.85) {
            mx = toPlayer.x; mz = toPlayer.z;
          }

          if (mx !== 0 || mz !== 0) {
            moving = true;
            // slight separation from other enemies
            for (const other of this.enemies) {
              if (other === e || !other.alive || other.spawnT > 0 || other.kbT > 0) continue;
              const sx = g.position.x - other.group.position.x;
              const sz = g.position.z - other.group.position.z;
              const sd = Math.hypot(sx, sz);
              if (sd < 1.4 && sd > 0.001) {
                mx += (sx / sd) * 0.5;
                mz += (sz / sd) * 0.5;
              }
            }
            const ml = Math.hypot(mx, mz);
            if (ml > 0.001) {
              g.position.x += (mx / ml) * e.speed * speedMul * dt;
              g.position.z += (mz / ml) * e.speed * speedMul * dt;
              // lean into the movement direction (relative to facing)
              e.leanDot = (mx * Math.sin(g.rotation.y) + mz * Math.cos(g.rotation.y)) / ml;
            }
          }
          break;
        }
        case 'windup':
          if (e.stateT <= 0) {
            e.state = 'strike';
            e.stateT = STRIKE_TIME;
            if (e.isRanged) {
              this._fireTracer(e, playerPos);
              // visible recoil: kick straight back from the shot
              if (dist > 0.05) {
                e.vel.x -= (toPlayer.x / dist) * 1.4;
                e.vel.z -= (toPlayer.z / dist) * 1.4;
              }
            } else if (dist <= e.attackRange + 0.6) {
              // landed a hit → back off for a couple of seconds
              if (this._hitPlayer(api, e.damage, g.position) && !e.isBoss) {
                e.backoffT = HIT_BACKOFF;
              }
            }
            // melee step-in lunge: small forward burst so the swing has body weight
            if (!e.isRanged && !e.isBoss && dist > 0.05) {
              e.vel.x += (toPlayer.x / dist) * 2.8;
              e.vel.z += (toPlayer.z / dist) * 2.8;
            }
            if (api.onEnemyAttackSwing) api.onEnemyAttackSwing(e);
          }
          break;
        case 'strike':
          if (e.stateT <= 0) {
            e.state = 'recover';
            e.stateT = 0.5;
            e.attackCd = e.isBoss ? 1.6
              : e.isRanged ? (VARIANTS.rifleman.fireCd - 0.3 + Math.random() * 0.6)
              : 2.4 + Math.random() * 0.8;
          }
          break;
        case 'recover':
          if (e.stateT <= 0) e.state = 'chase';
          break;
      }

      // Der Chase-Schritt oben bewegt XZ nach dem ersten Clamp noch einmal. Ohne
      // diesen zweiten Clamp stünde der Marine am Frame-Ende außerhalb — prevPos
      // wäre nächsten Frame ungültig und der Slide fiele auf den radialen
      // Rücksetzer zurück (genau der Ruck, den wir loswerden wollen).
      clampToWalkable(g.position, e.prevPos);
      // Bodenhöhe zum Schluss nachziehen: gerendert würde sonst die Höhe der
      // vorherigen XZ — beim Betreten des Stegs genau um deckY zu tief.
      if (!airborne) g.position.y = groundHeightAt(g.position.x, g.position.z);

      // ---- telegraph ring: shrinking closing ring during windup, white flash on strike ----
      // Color tells the player WHEN, not just THAT: yellow -> orange -> red as the
      // threat builds, then a hard white/red strobe in the final DANGER_LEAD window —
      // strobe onset is the "dodge NOW" beat (matched by the danger cue via onDangerWindow).
      if (e.state === 'windup') {
        const prog = 1 - Math.max(e.stateT, 0) / e.windup;
        e.ring.visible = true;
        const inDanger = e.stateT <= DANGER_LEAD;
        if (inDanger) {
          const blink = Math.sin(e.stateT * 60) > 0;
          e.ring.material.color.setHex(blink ? 0xffffff : 0xff2419);
          e.ring.material.opacity = 0.95;
          if (!e.dangerCued) {
            e.dangerCued = true;
            api.onDangerWindow?.(e);
          }
        } else {
          // ramp: 0xffd60a (yellow) -> 0xff3b30 (red) over the safe part of the windup
          const k = prog / Math.max(0.001, 1 - DANGER_LEAD / e.windup);
          this._rampA.setHex(0xffd60a);
          this._rampB.setHex(0xff3b30);
          e.ring.material.color.copy(this._rampA.lerp(this._rampB, Math.min(1, k)));
          e.ring.material.opacity = 0.45 + 0.4 * prog;
        }
        e.ring.scale.setScalar(e.ringBase * (1.6 + (1.0 - 1.6) * prog));
      } else if (e.state === 'strike') {
        e.ring.visible = true;
        e.ring.material.color.setHex(0xffffff);
        e.ring.material.opacity = 0.95;
        e.ring.scale.setScalar(e.ringBase);
      } else {
        e.ring.visible = false;
      }

      // ---- rifleman aim-line telegraph during windup ----
      if (e.isRanged) {
        if (e.state === 'windup') {
          const muzzle = this._muzzleWorld(e, this._v); // _v ist hier frei — toPlayer wird nicht mehr gebraucht
          const chest = this._chest.set(playerPos.x, playerPos.y + 1.1, playerPos.z);
          if (!e.aimLine) {
            const geo = new THREE.BufferGeometry().setFromPoints([muzzle.clone(), chest]);
            e.aimLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
              color: 0xff3b30, transparent: true, opacity: 0.15,
            }));
            this.scene.add(e.aimLine);
          } else {
            const pos = e.aimLine.geometry.attributes.position;
            pos.setXYZ(0, muzzle.x, muzzle.y, muzzle.z);
            pos.setXYZ(1, chest.x, chest.y, chest.z);
            pos.needsUpdate = true;
          }
          const prog = 1 - Math.max(e.stateT, 0) / e.windup;
          if (e.stateT <= DANGER_LEAD) {
            // final window: strobe the aim-line white — same "NOW" language as the ring
            const blink = Math.sin(e.stateT * 60) > 0;
            e.aimLine.material.color.setHex(blink ? 0xffffff : 0xff2419);
            e.aimLine.material.opacity = 0.95;
          } else {
            e.aimLine.material.color.setHex(0xff3b30);
            e.aimLine.material.opacity = 0.15 + 0.55 * prog;
          }
        } else if (e.aimLine) {
          this.scene.remove(e.aimLine);
          e.aimLine = null;
        }
      }

      // ---- animation: walk cycle with knee bend, counter-swing, torso bob + lean ----
      e.phase += dt * (moving ? 9 : 2);
      const swing = Math.sin(e.phase) * (moving ? 0.55 : 0.06);
      if (e.legs[0]) e.legs[0].rotation.x = swing;
      if (e.legs[1]) e.legs[1].rotation.x = -swing;
      // knee bends on the lifting leg only — the stride reads as a real gait
      if (e.knees.length === 2) {
        const bend = moving ? 0.85 : 0.05;
        e.knees[0].rotation.x = Math.max(0, Math.sin(e.phase + Math.PI * 0.45)) * bend;
        e.knees[1].rotation.x = Math.max(0, -Math.sin(e.phase + Math.PI * 0.45)) * bend;
      }
      // torso bob (double-beat of the stride) + lean into movement direction
      if (!e.isBoss && e.torso) {
        e.torso.position.y = 1.0 + (moving ? Math.abs(Math.sin(e.phase)) * 0.05 : Math.sin(e.phase) * 0.012);
        const targetLean = (moving ? 0.18 : 0) * Math.max(-1, Math.min(1, e.leanDot));
        e.torso.rotation.x += (targetLean - e.torso.rotation.x) * Math.min(1, dt * 10);
      }

      const armSwing = moving ? swing * 0.6 : Math.sin(e.phase * 0.7) * 0.05;
      // attack arm animation: raise weapon high on windup (readable tell), whip down FAST on strike
      let attackPose = 0;
      const raise = e.isRanged ? -1.5 : -2.2;
      if (e.state === 'windup') attackPose = raise * (1 - Math.max(e.stateT, 0) / e.windup);
      else if (e.state === 'strike') {
        const sp = 1 - Math.max(e.stateT, 0) / STRIKE_TIME; // 0 → 1 over the quick swing
        attackPose = e.isRanged
          ? -1.5 - 0.6 * Math.sin(sp * Math.PI)                    // recoil kick: muzzle jumps, resettles
          : raise + (1.1 - raise) * Math.min(1, sp * 1.7);          // baton whips through in ~90ms
      }
      else if (e.state === 'recover') attackPose = 0.5 * Math.max(e.stateT, 0) / 0.5;

      if (e.isBoss) {
        // reel: big head snap + arms flung out for 0.3s on every 5th hit
        e.reelT = Math.max(0, e.reelT - dt);
        if (e.reelT > 0) {
          const rp = e.reelT / 0.3;                       // 1 → 0
          const snap = Math.sin(rp * Math.PI);            // out and back
          if (e.head) { e.head.rotation.x = -0.85 * snap; e.head.position.z = -0.16 * snap; }
          if (e.jaw) { e.jaw.rotation.x = -0.85 * snap; e.jaw.position.z = 0.14 - 0.16 * snap; }
          e.arms[0].rotation.x = 0;
          e.arms[0].rotation.z = 1.3 * snap;              // arms out
          e.axeArm.rotation.x = 0;
          e.axeArm.rotation.z = -1.3 * snap;
          g.rotation.x = 0.14 * snap;                     // torso rocked back
        } else {
          if (e.head) { e.head.rotation.x = 0; e.head.position.z = 0; }
          if (e.jaw) { e.jaw.rotation.x = 0; e.jaw.position.z = 0.14; }
          e.arms[0].rotation.z = 0;
          e.axeArm.rotation.z = 0;
          g.rotation.x = 0;
          e.axeArm.rotation.x = attackPose !== 0 ? attackPose : Math.sin(e.phase * 0.5) * 0.08 - 0.25;
          e.arms[0].rotation.x = -armSwing;
        }
      } else {
        // rifleman shoulder-aim: left hand comes up to support the rifle while aiming/firing
        if (e.isRanged && (e.state === 'windup' || e.state === 'strike')) {
          const aimP = e.state === 'strike' ? 1 : 1 - Math.max(e.stateT, 0) / e.windup;
          e.arms[0].rotation.x = -1.35 * aimP;
          e.arms[0].rotation.z = -0.35 * aimP;
        } else {
          e.arms[0].rotation.x = -armSwing;
          e.arms[0].rotation.z = 0;
        }
        e.arms[1].rotation.x = attackPose !== 0 ? attackPose : armSwing;
      }
    }
  }
}
