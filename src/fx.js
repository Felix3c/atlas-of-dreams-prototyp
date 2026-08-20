// fx.js — pooled anime-style combat effects (imported only by combat.js)
// Starbursts, radial speed lines, punch trails, damage pips, dust puffs.
// Everything is pre-allocated; spawning just re-activates a pool slot.
import * as THREE from 'three';

const STARBURST_POOL = 12;
const SPEEDLINE_POOL = 6;
const PIP_POOL = 16;
const DUST_POOL = 10;
const TRAIL_COUNT = 2;

// lifetimes shortened ~20% for the faster combat pace — effects must never smear
const STARBURST_LIFE = 0.14;  // ~140ms
const SPEEDLINE_LIFE = 0.18;
const PIP_LIFE = 0.4;         // 400ms
const DUST_LIFE = 0.36;

// ---------- procedural textures ----------

function drawStarPath(g, spikes, outer, inner) {
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.closePath();
}

function makeStarTexture(spikes) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  // orange rim burst
  drawStarPath(g, spikes, 62, 17);
  g.fillStyle = '#ff8c1a';
  g.fill();
  // white core star
  drawStarPath(g, spikes, 48, 12);
  g.fillStyle = '#ffffff';
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(214,196,168,0.9)');
  grad.addColorStop(0.6, 'rgba(196,178,150,0.45)');
  grad.addColorStop(1, 'rgba(180,164,140,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ring of thin elongated triangles bursting outward (shared geometry)
function makeSpeedLineGeometry(count = 10) {
  const verts = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (i % 2) * 0.15;
    const w = 0.035;
    const inner = 0.28;
    const outer = 1.0;
    const o = i * 9;
    verts[o] = Math.cos(a) * outer; verts[o + 1] = Math.sin(a) * outer; verts[o + 2] = 0;
    verts[o + 3] = Math.cos(a + w) * inner; verts[o + 4] = Math.sin(a + w) * inner; verts[o + 5] = 0;
    verts[o + 6] = Math.cos(a - w) * inner; verts[o + 7] = Math.sin(a - w) * inner; verts[o + 8] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  return geo;
}

// ---------- FX manager ----------

export class FX {
  constructor(scene) {
    this.scene = scene;

    // -- impact starbursts (camera-facing sprites, varied spike counts) --
    const starTex = [makeStarTexture(4), makeStarTexture(6), makeStarTexture(8)];
    this.stars = [];
    for (let i = 0; i < STARBURST_POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map: starTex[i % starTex.length],
        transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.stars.push({ sprite: s, life: 0 });
    }

    // -- radial speed lines (billboarded triangle rings) --
    const lineGeo = makeSpeedLineGeometry(10);
    this.lines = [];
    for (let i = 0; i < SPEEDLINE_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(lineGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.lines.push({ mesh: m, life: 0 });
    }

    // -- floating damage pips (per-sprite canvas so text can change) --
    this.pips = [];
    for (let i = 0; i < PIP_POOL; i++) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.scale.set(0.9, 0.45, 1);
      s.visible = false;
      scene.add(s);
      this.pips.push({ sprite: s, canvas: c, ctx: c.getContext('2d'), tex, life: 0 });
    }

    // -- dust puffs --
    const dustTex = makeDustTexture();
    this.dusts = [];
    for (let i = 0; i < DUST_POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map: dustTex, transparent: true, opacity: 0, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.dusts.push({ sprite: s, life: 0 });
    }

    // -- punch trails (glowing additive tapered cylinders along the arm) --
    const trailGeo = new THREE.CylinderGeometry(0.17, 0.07, 1, 8, 1, true);
    trailGeo.translate(0, 0.5, 0); // origin at shoulder end, extends +Y
    this.trails = [];
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe98a, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(trailGeo, mat);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.trails.push(m);
    }

    // scratch
    this._dir = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._q = new THREE.Quaternion();
  }

  _next(pool) {
    let best = pool[0];
    for (const p of pool) {
      if (p.life <= 0) return p;
      if (p.life < best.life) best = p;
    }
    return best; // steal the oldest if pool exhausted
  }

  // white/orange star flash at the hit point, 0.3 -> 2.2 scale over ~180ms
  starburst(pos) {
    const p = this._next(this.stars);
    p.life = STARBURST_LIFE;
    p.sprite.position.copy(pos);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.visible = true;
  }

  // brief ring of thin triangles bursting outward (bazooka / gatling)
  speedLines(pos) {
    const p = this._next(this.lines);
    p.life = SPEEDLINE_LIFE;
    p.mesh.position.copy(pos);
    p.mesh.visible = true;
  }

  // small bold white number popping 0.6m above the hit, rising + fading 500ms
  damagePip(pos, amount) {
    const p = this._next(this.pips);
    p.life = PIP_LIFE;
    const g = p.ctx;
    g.clearRect(0, 0, 128, 64);
    g.font = '900 44px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(20,10,0,0.9)';
    g.strokeText(String(amount), 64, 34);
    g.fillStyle = '#ffffff';
    g.fillText(String(amount), 64, 34);
    p.tex.needsUpdate = true;
    p.sprite.position.set(pos.x, pos.y + 0.6, pos.z);
    p.sprite.visible = true;
  }

  // ground dust where a knocked-back enemy lands
  dust(pos) {
    const p = this._next(this.dusts);
    p.life = DUST_LIFE;
    p.sprite.position.set(pos.x, 0.25, pos.z);
    p.sprite.visible = true;
  }

  // punch trail: index 0/1, from shoulder to fist; alpha 0..1
  setTrail(i, start, end, alpha) {
    const m = this.trails[i];
    this._dir.subVectors(end, start);
    const len = this._dir.length();
    if (len < 0.25 || alpha <= 0.01) { m.visible = false; return; }
    this._dir.multiplyScalar(1 / len);
    m.position.copy(start);
    m.quaternion.setFromUnitVectors(this._up, this._dir);
    m.scale.set(1, len, 1);
    m.material.opacity = 0.5 * alpha;
    m.visible = true;
  }

  hideTrails() {
    for (const m of this.trails) m.visible = false;
  }

  update(dt, camera) {
    for (const p of this.stars) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sprite.visible = false; continue; }
      const k = 1 - p.life / STARBURST_LIFE;           // 0 -> 1
      const s = 0.3 + (2.2 - 0.3) * Math.sin(k * Math.PI * 0.5);
      p.sprite.scale.set(s, s, 1);
      p.sprite.material.opacity = 1 - k * k;
    }
    for (const p of this.lines) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      const k = 1 - p.life / SPEEDLINE_LIFE;
      const s = 0.6 + k * 2.6;
      p.mesh.scale.set(s, s, 1);
      p.mesh.material.opacity = 0.85 * (1 - k);
      p.mesh.quaternion.copy(camera.quaternion); // billboard
    }
    for (const p of this.pips) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sprite.visible = false; continue; }
      const k = 1 - p.life / PIP_LIFE;
      p.sprite.position.y += dt * 1.3;                 // rise
      p.sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
    for (const p of this.dusts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sprite.visible = false; continue; }
      const k = 1 - p.life / DUST_LIFE;
      const s = 0.5 + k * 1.6;
      p.sprite.scale.set(s, s * 0.7, 1);
      p.sprite.material.opacity = 0.7 * (1 - k);
    }
  }
}
