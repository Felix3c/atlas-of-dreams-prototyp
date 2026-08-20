// crew.js — FF15-style companion AI for KAI
// Drives a createKai() instance as an autonomous crewmate: picks the nearest
// grounded marine, closes in, lands a 3-hit slash combo, then circles to a
// flank before re-engaging. Idle taunt sway when the field is clear.
//
// Usage:
//   import { createKai } from './kai.js';
//   import { createCompanion } from './crew.js';
//   const kai = createKai();
//   const companion = createCompanion({ scene, kai, getEnemies: () => enemyManager.enemies });
//   // per frame: companion.update(dt, t);   (companion calls kai.update internally)
//   // on player perfect dodge: companion.linkStrike(thatEnemy);
import * as THREE from 'three';
import { banter } from './banter.js';
import { clampToWalkable, groundHeightAt } from './arena.js';

// Marines walk at 2.4 (enemies.js MARINE_SPEED) — Kai is slightly faster.
const MOVE_SPEED = 3.1;
const DASH_SPEED = 13;          // linkStrike dash
const ATTACK_RANGE = 1.8;       // start the combo inside this distance
const COMBO_HITS = 3;
const HIT_INTERVAL = 0.45;      // seconds between combo hits (matches kai slash duration)
const HIT_DMG = 12;
const HIT_POWER = 3;            // knock power for hits 1-2 (enemy.takeHit power arg)
const FINISHER_POWER = 7;       // hit 3 launches — power > 4 gives marines 2 spins
const REPOSITION_SPEED = 2.2;
const FLANK_RADIUS = 3.2;       // circling distance during reposition
const TURN_RATE = 9;

// hp scaffolding — marines do NOT target Kai this round; this only exists so
// the downed/recover loop is wired for later. Call state.takeHit(dmg) when
// marine strikes explicitly target him.
const MAX_HP = 100;
const DOWNED_TIME = 8;          // kneel duration at 0 hp
const RECOVER_HP = MAX_HP / 2;  // comes back with half hp — Kai cannot die

const KAI_RADIUS = 0.5;             // Kollisionsradius wie ein Marine
const WALKABLE_TOP_MAX = 0.3;       // flache Trittflächen (Steg-Planken) blockieren nicht

export function createCompanion({ scene, kai, getEnemies, fx, obstacles = [] }) {
  scene.add(kai.group);
  kai.group.position.set(2.5, 0, 2.5);

  const _v = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _prev = { x: 0, z: 0 }; // letzte gültige Position für den Grenz-Slide (wie player._prevPos)

  // public state — readable by main.js for UI/debug
  const state = {
    mode: 'idle',       // idle | approach | combo | reposition | downed | link
    hp: MAX_HP,
    maxHp: MAX_HP,
    target: null,       // current Enemy (from enemies.js) or null
    takeHit,            // scaffolding: damage Kai (unused this round)
  };

  let comboHits = 0;      // hits landed in the current combo
  let comboT = 0;         // countdown to the next combo hit
  let repositionT = 0;    // countdown for the flank circle
  let flankDir = 1;       // circle clockwise or counter-clockwise
  let downedT = 0;        // countdown while kneeling
  let animSpeed = 0;      // smoothed 0..1 locomotion blend fed to kai.update

  function takeHit(dmg) {
    if (state.mode === 'downed') return;
    state.hp -= dmg;
    if (state.hp <= 0) {
      state.hp = 0;
      state.mode = 'downed';
      state.target = null;
      downedT = DOWNED_TIME;
    }
  }

  // nearest alive, on-field, non-airborne enemy
  function pickTarget() {
    const enemies = getEnemies() || [];
    let best = null;
    let bestD = Infinity;
    const p = kai.group.position;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.spawnT > 0) continue;                       // not on the field yet
      // airborne / ragdolling — Bodenhöhe ist jetzt das Relief, nicht y=0 (R13)
      if (e.kbT > 0 || e.group.position.y > groundHeightAt(e.group.position.x, e.group.position.z) + 0.05) continue;
      const dx = e.group.position.x - p.x;
      const dz = e.group.position.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  function targetValid(e) {
    return !!e && e.alive && e.spawnT <= 0;
  }

  function distToTarget() {
    const t = state.target;
    return Math.hypot(
      t.group.position.x - kai.group.position.x,
      t.group.position.z - kai.group.position.z,
    );
  }

  // rotate kai to face a world point (smoothed)
  function faceToward(x, z, dt) {
    const g = kai.group;
    const dx = x - g.position.x;
    const dz = z - g.position.z;
    if (dx * dx + dz * dz < 0.0025) return;
    const targetYaw = Math.atan2(dx, dz);
    let d = targetYaw - g.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g.rotation.y += d * Math.min(1, dt * TURN_RATE);
  }

  // move toward a world point; returns remaining distance
  function moveToward(x, z, speed, dt) {
    const g = kai.group;
    _dir.set(x - g.position.x, 0, z - g.position.z);
    const dist = _dir.length();
    if (dist > 0.001) {
      _dir.normalize();
      const step = Math.min(speed * dt, dist);
      g.position.x += _dir.x * step;
      g.position.z += _dir.z * step;
    }
    faceToward(x, z, dt);
    return dist;
  }

  // one combo hit: play the slash and deal damage if still in reach
  function landHit(finisher) {
    const t = state.target;
    kai.beginSlash();
    if (!targetValid(t)) return;
    const d = distToTarget();
    if (d > ATTACK_RANGE + 0.7) return; // whiffed — target moved away
    _dir.set(
      t.group.position.x - kai.group.position.x,
      0,
      t.group.position.z - kai.group.position.z,
    ).normalize();
    // enemies.js signature: takeHit(dmg, dir, power) — dir is a horizontal unit vector
    const killed = t.takeHit(HIT_DMG, _dir, finisher ? FINISHER_POWER : HIT_POWER);
    if (fx && fx.onCompanionHit) fx.onCompanionHit(t, finisher);
    if (killed) banter.trigger('kill');
  }

  function startCombo() {
    state.mode = 'combo';
    comboHits = 0;
    comboT = 0.05; // first slash almost immediately
  }

  function startReposition() {
    state.mode = 'reposition';
    repositionT = 1 + Math.random();   // circle the flank for 1-2s
    flankDir = Math.random() < 0.5 ? -1 : 1;
  }

  // ---- link strike: dash to a specific enemy and combo it instantly ----
  // Triggered by the player's perfect dodge. Overrides whatever Kai is doing
  // (except being downed).
  function linkStrike(targetEnemy) {
    if (state.mode === 'downed') return false;
    if (!targetValid(targetEnemy)) return false;
    state.target = targetEnemy;
    state.mode = 'link';
    banter.trigger('linkStrike');
    return true;
  }

  function update(dt, t) {
    let moving = 0;
    // vor jedem Schritt merken: clampToWalkable slidet damit an der Kante entlang,
    // statt Kai radial zurückzusetzen (sichtbarer Ruck beim seitlichen Streifen)
    _prev.x = kai.group.position.x;
    _prev.z = kai.group.position.z;

    switch (state.mode) {
      case 'downed': {
        downedT -= dt;
        if (downedT <= 0) {
          state.hp = RECOVER_HP;   // Kai cannot die — back up with half hp
          state.mode = 'idle';
        }
        break;
      }

      case 'idle': {
        const target = pickTarget();
        if (target) {
          state.target = target;
          state.mode = 'approach';
          break;
        }
        // taunt sway: slow shoulder roll on the spot, scanning the field
        kai.group.rotation.y += Math.sin(t * 0.6) * 0.25 * dt;
        break;
      }

      case 'approach': {
        if (!targetValid(state.target)) {
          state.target = null;
          state.mode = 'idle';
          break;
        }
        const tp = state.target.group.position;
        const d = moveToward(tp.x, tp.z, MOVE_SPEED, dt);
        moving = 1;
        if (d <= ATTACK_RANGE) startCombo();
        break;
      }

      case 'combo': {
        if (!targetValid(state.target)) {
          state.target = null;
          startReposition();
          break;
        }
        const tp = state.target.group.position;
        faceToward(tp.x, tp.z, dt);
        // drift in if the target staggers out of reach mid-combo
        if (distToTarget() > ATTACK_RANGE) {
          moveToward(tp.x, tp.z, MOVE_SPEED * 0.6, dt);
          moving = 0.5;
        }
        comboT -= dt;
        if (comboT <= 0) {
          comboHits++;
          landHit(comboHits >= COMBO_HITS);
          if (comboHits >= COMBO_HITS) startReposition();
          else comboT = HIT_INTERVAL;
        }
        break;
      }

      case 'reposition': {
        repositionT -= dt;
        const anchor = targetValid(state.target) ? state.target : pickTarget();
        if (anchor) {
          // circle to a flank: orbit the anchor at FLANK_RADIUS
          const ap = anchor.group.position;
          const gx = kai.group.position.x - ap.x;
          const gz = kai.group.position.z - ap.z;
          const r = Math.max(Math.hypot(gx, gz), 0.001);
          const a = Math.atan2(gz, gx) + flankDir * (REPOSITION_SPEED / FLANK_RADIUS) * dt;
          const nr = r + (FLANK_RADIUS - r) * Math.min(1, dt * 2);
          kai.group.position.x = ap.x + Math.cos(a) * nr;
          kai.group.position.z = ap.z + Math.sin(a) * nr;
          faceToward(ap.x, ap.z, dt);
          moving = 0.6;
        }
        if (repositionT <= 0) {
          state.target = null;
          state.mode = 'idle';
        }
        break;
      }

      case 'link': {
        if (!targetValid(state.target)) {
          state.target = null;
          state.mode = 'idle';
          break;
        }
        const tp = state.target.group.position;
        const d = moveToward(tp.x, tp.z, DASH_SPEED, dt);
        moving = 1;
        if (d <= ATTACK_RANGE) startCombo();
        break;
      }
    }

    // smooth the locomotion blend so run↔idle transitions don't pop
    animSpeed += (moving - animSpeed) * Math.min(1, dt * 10);

    // Insel-Kollision (R13-Kritik #6): gleicher Push-out wie enemies.js + Strand-Grenze —
    // Kai läuft nicht mehr durch Hauswände oder in den Schaumsaum
    const g = kai.group;
    for (const o of obstacles) {
      if (o.topY !== undefined && o.topY <= WALKABLE_TOP_MAX) continue;
      const dx = g.position.x - o.x;
      const dz = g.position.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.radius + KAI_RADIUS;
      if (d < min && d > 0.001) {
        g.position.x = o.x + (dx / d) * min;
        g.position.z = o.z + (dz / d) * min;
      }
    }
    clampToWalkable(g.position, _prev);

    kai.update(dt, t, {
      speed: animSpeed,
      grounded: true,
      kneeling: state.mode === 'downed',
    });
    // nach kai.update setzen — die Kniefall-Pose nullt group.y intern
    g.position.y = groundHeightAt(g.position.x, g.position.z);
  }

  return { update, linkStrike, state };
}
