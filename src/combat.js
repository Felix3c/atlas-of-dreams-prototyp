// combat.js — player attacks, targeting, hit detection, particles, camera shake
import * as THREE from 'three';
import { FX } from './fx.js';

// pacing pass: punches land fast and chain fast. Pistol hits at ~reachTime after
// click (hero's 50ms anticipation overlaps the ramp), cooldown barely longer than
// the swing so mashing feels rapid. Bazooka keeps its heavy 0.2s reach — its dead
// time was cut by shortening the shared wind-up in hero.js, not the stretch.
const PISTOL = { damage: 26, range: 15, cooldown: 0.22, knock: 7, reachTime: 0.11 };
const BAZOOKA = { damage: 45, range: 11, cooldown: 3.0, knock: 14, reachTime: 0.2, arc: 0.6 };
const GATLING = { damage: 5, range: 13, cooldown: 6.0, duration: 1.6, interval: 0.055, knock: 2.5, arc: 0.75 };

// Augenhöhen-Offset für aimPointForward — konstant, wird nie mutiert (add() liest nur)
const AIM_EYE_OFFSET = new THREE.Vector3(0, 1.4, 0);

// OVERDRIVE — Runde 7 Overdrive-Ultimate (Felix' Auftrag): while active, this.overdriveActive
// is set by main.js (which owns the meter/timer). Combat only reads it to scale damage,
// attack tempo, and the finisher knockback.
const OVERDRIVE_DAMAGE_MULT = 1.5;
const OVERDRIVE_TEMPO_MULT = 1.4;
const OVERDRIVE_FINISH_KNOCK_MULT = 1.8;

// per-attack hit presentation (reused, never allocated per hit)
const HIT_OPTS_DEFAULT = { hitStop: 0, speedLines: false };
const HIT_OPTS_PISTOL = { hitStop: 70, speedLines: false };
const HIT_OPTS_BAZOOKA = { hitStop: 120, speedLines: true };
const HIT_OPTS_GATLING = { hitStop: 0, speedLines: true };

// ---------- particle pool (single Points cloud) ----------
class ParticlePool {
  constructor(scene, max = 500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // park everything far below
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
  }

  burst(origin, color, count, speed = 5, spread = 1) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.3 * spread;
      this.pos[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.3 * spread;
      this.pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.3 * spread;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.vel[i * 3 + 1] = Math.cos(ph) * sp * 0.7 + 1.5;
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      const shade = 0.75 + Math.random() * 0.25;
      this.col[i * 3] = c.r * shade;
      this.col[i * 3 + 1] = c.g * shade;
      this.col[i * 3 + 2] = c.b * shade;
      this.ttl[i] = this.life[i] = 0.4 + Math.random() * 0.4;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 12 * dt;
      // fade via color darkening
      const f = Math.pow(0.05, dt);
      void f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------- combat ----------

export class Combat {
  /**
   * @param scene THREE.Scene
   * @param camera THREE.Camera (aim source)
   * @param hero  object from createHero()
   * @param enemyManager EnemyManager
   * @param hooks { onKill(enemy), onHit(enemy, damage) }
   */
  constructor(scene, camera, hero, enemyManager, hooks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.hero = hero;
    this.em = enemyManager;
    this.hooks = hooks;
    this.particles = new ParticlePool(scene);

    this.cdPistol = 0;
    this.cdBazooka = 0;
    this.cdGatling = 0;

    // OVERDRIVE — main.js flips this on/off; scales damage + attack tempo here
    this.overdriveActive = false;

    // active attack: {type, t, duration, target(Vector3), enemy, which, hitDone}
    this.attack = null;
    this.gatlingTimer = 0;
    this.gatlingLeft = 0;
    this.gatlingSide = 'right';

    this.shake = 0;
    this._camDir = new THREE.Vector3();
    this._toEnemy = new THREE.Vector3();
    this._hitDir = new THREE.Vector3();
    this._aim = new THREE.Vector3();

    // anime hit effects (starbursts, speed lines, trails, pips, dust)
    this.fx = new FX(scene);
    this._impact = new THREE.Vector3();
    this._gatlingTarget = new THREE.Vector3();
    this._shoulderW = new THREE.Vector3();
    this._fistW = new THREE.Vector3();
    // watch knocked-back enemies so we can puff dust where they land
    this._landWatch = [];
    for (let i = 0; i < 12; i++) this._landWatch.push({ enemy: null, air: false, t: 0 });
  }

  _watchLanding(enemy) {
    for (const w of this._landWatch) {
      if (w.enemy === enemy) { w.t = 0; w.air = false; return; }
    }
    for (const w of this._landWatch) {
      if (!w.enemy) { w.enemy = enemy; w.air = false; w.t = 0; return; }
    }
  }

  // world position of Hero's shoulder (matches hero.js shoulderLocal).
  // shoulderX kommt vom Charakter selbst — wandert mit der Koerperbau-Breite
  // (Kritiker R12 #3); ?? 0.34 haelt Fremd-Modelle ohne das Feld stabil.
  _shoulderWorld(side, out) {
    out.set((this.hero.shoulderX ?? 0.34) * side, 1.42, 0.1);
    return this.hero.group.localToWorld(out);
  }

  // draw glowing arm streaks so a punch reads even with the camera behind Hero
  _updateTrails(atk, reach) {
    if (reach <= 0.05 || !atk.target) { this.fx.hideTrails(); return; }
    if (atk.which === 'both') {
      this._shoulderWorld(1, this._shoulderW);
      this._fistW.lerpVectors(this._shoulderW, atk.target, reach);
      this.fx.setTrail(0, this._shoulderW, this._fistW, reach);
      this._shoulderWorld(-1, this._shoulderW);
      this._fistW.lerpVectors(this._shoulderW, atk.target, reach);
      this.fx.setTrail(1, this._shoulderW, this._fistW, reach);
    } else {
      this._shoulderWorld(atk.which === 'left' ? -1 : 1, this._shoulderW);
      this._fistW.lerpVectors(this._shoulderW, atk.target, reach);
      this.fx.setTrail(0, this._shoulderW, this._fistW, reach);
      this.fx.setTrail(1, this._shoulderW, this._fistW, 0);
    }
  }

  addShake(amount) {
    this.shake = Math.min(this.shake + amount, 0.55);
  }

  getShakeOffset(out) {
    const s = this.shake;
    out.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5);
    return out;
  }

  // pick alive enemy closest to the camera's aim ray, within range + cone
  pickTarget(range, maxAngle = 0.45) {
    this.camera.getWorldDirection(this._camDir);
    const camPos = this.camera.position;
    let best = null;
    let bestScore = Infinity;
    for (const e of this.em.enemies) {
      if (!e.alive) continue;
      this._toEnemy.set(
        e.group.position.x - camPos.x,
        e.group.position.y + e.height * 0.55 - camPos.y,
        e.group.position.z - camPos.z,
      );
      const dist = this._toEnemy.length();
      if (dist > range + 6) continue; // camera sits behind player, allow slack
      this._toEnemy.normalize();
      const angle = this._toEnemy.angleTo(this._camDir);
      if (angle > maxAngle) continue;
      const score = angle * 4 + dist * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  enemiesInCone(range, arc) {
    this.camera.getWorldDirection(this._camDir);
    const origin = this.hero.group.position;
    const out = [];
    for (const e of this.em.enemies) {
      if (!e.alive) continue;
      const dx = e.group.position.x - origin.x;
      const dz = e.group.position.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range) continue;
      const angle = Math.atan2(dx, dz);
      const camAngle = Math.atan2(this._camDir.x, this._camDir.z);
      let d = angle - camAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > arc) continue;
      out.push(e);
    }
    return out;
  }

  aimPointForward(dist) {
    this.camera.getWorldDirection(this._camDir);
    return this._aim.copy(this.hero.group.position)
      .add(AIM_EYE_OFFSET) // konstanter Offset — keine Allokation pro Aufruf (R13-Kritik #9)
      .addScaledVector(this._camDir, dist);
  }

  // ---- attacks ----

  tryPistol() {
    if (this.cdPistol > 0 || this.attack) return;
    const tempo = this.overdriveActive ? OVERDRIVE_TEMPO_MULT : 1;
    this.cdPistol = PISTOL.cooldown / tempo;
    const enemy = this.pickTarget(PISTOL.range);
    const target = enemy
      ? enemy.group.position.clone().setY(enemy.height * 0.55)
      : this.aimPointForward(PISTOL.range * 0.7).clone();
    if (enemy) {
      target.x = enemy.group.position.x;
      target.z = enemy.group.position.z;
      target.y = enemy.group.position.y + enemy.height * 0.55;
    }
    const reachTime = PISTOL.reachTime / tempo;
    this.attack = {
      type: 'pistol', t: 0, duration: reachTime * 2,
      reachTime, target, enemy, which: 'right', hitDone: false,
    };
    // start hero's anticipation wind-up on the click frame, not the next update
    this.hero.stretchArm('right', target, 0);
  }

  tryBazooka() {
    if (this.cdBazooka > 0 || this.attack) return;
    const tempo = this.overdriveActive ? OVERDRIVE_TEMPO_MULT : 1;
    this.cdBazooka = BAZOOKA.cooldown / tempo;
    const target = this.aimPointForward(BAZOOKA.range * 0.65).clone();
    const reachTime = BAZOOKA.reachTime / tempo;
    this.attack = {
      type: 'bazooka', t: 0, duration: reachTime * 2,
      reachTime, target, enemy: null, which: 'both', hitDone: false,
    };
    // kill dead time: the wind-up clock starts on the click frame itself
    this.hero.stretchArm('both', target, 0);
  }

  tryGatling() {
    if (this.cdGatling > 0 || this.attack) return;
    const tempo = this.overdriveActive ? OVERDRIVE_TEMPO_MULT : 1;
    this.cdGatling = GATLING.cooldown / tempo;
    this.attack = { type: 'gatling', t: 0, duration: GATLING.duration / tempo, which: 'both' };
    this.gatlingTimer = 0;
  }

  hitEnemy(enemy, damage, knock, impactColor = 0xffd27a, opts = HIT_OPTS_DEFAULT) {
    // Koerperbau-Kopplung (Runde 12): gross & massig -> mehr Schaden/Knockback.
    // stats kommt aus BODY_PRESETS via createHero; ?? 1 haelt Alt-Modelle stabil.
    const bodyDmg = this.hero.stats?.dmg ?? 1;
    const bodyKnock = this.hero.stats?.knock ?? 1;
    // OVERDRIVE: damage x1.5; a hit that would KO the target gets a bigger launch
    // (the "finisher") so the kill reads as a deliberate haymaker, not a tick.
    const odMult = this.overdriveActive ? OVERDRIVE_DAMAGE_MULT : 1;
    const dmg = Math.round(damage * bodyDmg * odMult);
    const isFinisher = this.overdriveActive && dmg >= enemy.hp;
    const finalKnock = knock * bodyKnock * (isFinisher ? OVERDRIVE_FINISH_KNOCK_MULT : 1);

    this._hitDir.set(
      enemy.group.position.x - this.hero.group.position.x,
      0,
      enemy.group.position.z - this.hero.group.position.z,
    ).normalize();
    const killed = enemy.takeHit(dmg, this._hitDir, finalKnock);
    const impact = this._impact.copy(enemy.group.position);
    impact.y += enemy.height * 0.55;
    this.particles.burst(impact, impactColor, 14, 6);
    this.addShake(enemy.isBoss ? 0.16 : 0.12);

    // anime readability: star flash + damage number on every hit
    this.fx.starburst(impact);
    this.fx.damagePip(impact, dmg);
    if (opts.speedLines) this.fx.speedLines(impact);
    // hit-stop: boss hits always hit hardest
    const stop = enemy.isBoss ? 140 : opts.hitStop;
    if (stop) window.__hitStop?.(stop);
    // watch for the landing dust puff if this launched the enemy
    if (!enemy.isBoss && finalKnock > 4) this._watchLanding(enemy);

    // meter feed: every landed player hit charges Overdrive (main.js gates the add
    // once the meter's full/active, so this is safe to call unconditionally)
    if (this.hooks.onHit) this.hooks.onHit(enemy, dmg);

    if (killed) {
      this.particles.burst(impact, 0xffffff, 24, 8, 1.6);
      this.addShake(isFinisher ? 0.3 : 0.2);
      // finisher: reuse the perfect-dodge slow-mo technique for a short kill-zoom
      if (isFinisher) window.__slowMo?.(0.15, 0.6);
      if (this.hooks.onKill) this.hooks.onKill(enemy);
    }
  }

  update(dt, t) {
    this.cdPistol = Math.max(0, this.cdPistol - dt);
    this.cdBazooka = Math.max(0, this.cdBazooka - dt);
    this.cdGatling = Math.max(0, this.cdGatling - dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.particles.update(dt);
    this.fx.update(dt, this.camera);

    // dust puff where a knocked-back enemy lands
    for (const w of this._landWatch) {
      if (!w.enemy) continue;
      const e = w.enemy;
      w.t += dt;
      if (!e.alive || w.t > 3) { w.enemy = null; continue; }
      const y = e.group.position.y;
      if (y > 0.08) {
        w.air = true;
      } else if (w.air) {
        this.fx.dust(e.group.position);
        this.particles.burst(e.group.position, 0xc9b896, 8, 3);
        w.enemy = null;
      }
    }

    const atk = this.attack;
    if (!atk) { this.fx.hideTrails(); return; }
    atk.t += dt;

    if (atk.type === 'pistol' || atk.type === 'bazooka') {
      // out-and-back reach curve
      const half = atk.reachTime;
      let reach;
      if (atk.t < half) reach = atk.t / half;
      else reach = Math.max(0, 1 - (atk.t - half) / half);
      reach = Math.sin(reach * Math.PI / 2); // ease-out snap

      this.hero.stretchArm(atk.which, atk.target, reach);
      this._updateTrails(atk, reach);

      // impact at full extension
      if (!atk.hitDone && atk.t >= half) {
        atk.hitDone = true;
        if (atk.type === 'pistol') {
          if (atk.enemy && atk.enemy.alive) {
            this.hitEnemy(atk.enemy, PISTOL.damage, PISTOL.knock, 0xffd27a, HIT_OPTS_PISTOL);
          } else {
            this.particles.burst(atk.target, 0xcbb48a, 6, 3);
          }
        } else {
          const targets = this.enemiesInCone(BAZOOKA.range, BAZOOKA.arc);
          if (targets.length) {
            for (const e of targets) this.hitEnemy(e, BAZOOKA.damage, BAZOOKA.knock, 0xff8a4a, HIT_OPTS_BAZOOKA);
            this.addShake(0.22);
          } else {
            this.particles.burst(atk.target, 0xcbb48a, 8, 4);
            this.addShake(0.08);
          }
        }
      }
      if (atk.t >= atk.duration) {
        this.hero.relaxArms();
        this.fx.hideTrails();
        this.attack = null;
      }
    } else if (atk.type === 'gatling') {
      this.gatlingTimer -= dt;
      // rapid alternating jabs
      const enemy = this.pickTarget(GATLING.range, 0.8);
      const target = enemy
        ? this._gatlingTarget.set(
            enemy.group.position.x + (Math.random() - 0.5) * 0.8,
            enemy.group.position.y + enemy.height * (0.35 + Math.random() * 0.4),
            enemy.group.position.z + (Math.random() - 0.5) * 0.8,
          )
        : this._gatlingTarget.copy(this.aimPointForward(GATLING.range * 0.6));

      // flickering both-arm blur + bright streaks so the barrage reads from behind
      // (wider flicker band = faster-looking strobe at the new hit rate)
      const flicker = 0.65 + Math.random() * 0.35;
      this.hero.stretchArm('both', target, flicker);
      this._shoulderWorld(1, this._shoulderW);
      this._fistW.lerpVectors(this._shoulderW, target, flicker);
      this.fx.setTrail(0, this._shoulderW, this._fistW, flicker * 0.8);
      this._shoulderWorld(-1, this._shoulderW);
      this._fistW.lerpVectors(this._shoulderW, target, flicker * 0.9);
      this.fx.setTrail(1, this._shoulderW, this._fistW, flicker * 0.8);

      if (this.gatlingTimer <= 0) {
        this.gatlingTimer = GATLING.interval / (this.overdriveActive ? OVERDRIVE_TEMPO_MULT : 1);
        const targets = this.enemiesInCone(GATLING.range, GATLING.arc);
        if (targets.length) {
          // hit a random target in cone each tick
          const e = targets[(Math.random() * targets.length) | 0];
          this.hitEnemy(e, GATLING.damage, GATLING.knock, 0xffe08a, HIT_OPTS_GATLING);
        }
      }

      if (atk.t >= atk.duration) {
        this.hero.relaxArms();
        this.fx.hideTrails();
        this.attack = null;
      }
    }
  }

  get cooldowns() {
    return {
      pistol: this.cdPistol / PISTOL.cooldown,
      bazooka: this.cdBazooka / BAZOOKA.cooldown,
      gatling: this.cdGatling / GATLING.cooldown,
    };
  }

  reset() {
    this.attack = null;
    this.cdPistol = this.cdBazooka = this.cdGatling = 0;
    this.shake = 0;
    this.overdriveActive = false;
    this.hero.relaxArms();
    this.fx.hideTrails();
    for (const w of this._landWatch) { w.enemy = null; w.air = false; w.t = 0; }
  }
}
