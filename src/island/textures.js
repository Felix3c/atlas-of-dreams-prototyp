// island/textures.js — prozedurale Canvas-Texturen der Insel (aus arena.js ausgelagert, Runde 13)
import * as THREE from 'three';

export function makeCanvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function sandTexture() {
  return makeCanvas(1024, (ctx, s) => {
    ctx.fillStyle = '#d8b97f';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 36000; i++) {
      const shade = 175 + Math.random() * 60;
      ctx.fillStyle = `rgba(${shade}, ${shade * 0.85 | 0}, ${shade * 0.58 | 0}, 0.35)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    // large-scale darker patches — strong enough to break tiling repeat
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = 'rgba(120, 95, 55, 0.12)';
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, 40 + Math.random() * 110, 0, Math.PI * 2);
      ctx.fill();
    }
    // directional wind ripples — all streaks share one ~20deg heading
    const rippleAngle = 20 * Math.PI / 180;
    const dx = Math.cos(rippleAngle), dy = Math.sin(rippleAngle);
    ctx.strokeStyle = 'rgba(120, 95, 55, 0.08)';
    for (let i = 0; i < 55; i++) {
      const len = 120 + Math.random() * 180;
      const x = Math.random() * s;
      const y = Math.random() * s;
      ctx.lineWidth = 1.5 + Math.random() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(
        x + dx * len * 0.33, y + dy * len * 0.33 + (Math.random() - 0.5) * 6,
        x + dx * len * 0.66, y + dy * len * 0.66 + (Math.random() - 0.5) * 6,
        x + dx * len, y + dy * len
      );
      ctx.stroke();
    }
  });
}

export function plasterTexture(base) {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2500; i++) {
      const a = Math.random() * 0.08;
      ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(60,50,40,${a})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    // grime streaks from the top edge
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * s;
      ctx.fillStyle = `rgba(70,58,44,${0.03 + Math.random() * 0.05})`;
      ctx.fillRect(x, 0, 3 + Math.random() * 5, 30 + Math.random() * 90);
    }
  });
}

export function plankTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#8a6238';
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * s;
      ctx.fillStyle = `rgba(0,0,0,${0.18 + Math.random() * 0.1})`;
      ctx.fillRect(0, y, s, 3);
      for (let i = 0; i < 30; i++) {
        ctx.strokeStyle = `rgba(60,38,18,${0.08 + Math.random() * 0.12})`;
        const gy = y + 6 + Math.random() * (s / rows - 10);
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(s * 0.3, gy + 3, s * 0.7, gy - 3, s, gy);
        ctx.stroke();
      }
    }
  });
}

export function stoneBlockTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#9a938a';
    ctx.fillRect(0, 0, s, s);
    const rowH = 32;
    for (let row = 0; row * rowH < s; row++) {
      const y = row * rowH;
      const offset = (row % 2) * 32; // staggered courses
      // per-block shade jitter
      for (let x = -offset; x < s; x += 64) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
        ctx.fillRect(x, y, 64, rowH);
      }
      // horizontal mortar line
      ctx.fillStyle = 'rgba(40,35,30,0.4)';
      ctx.fillRect(0, y, s, 2);
      // vertical mortar joints
      for (let x = -offset; x < s + 64; x += 64) {
        ctx.fillRect(x, y, 2, rowH);
      }
    }
    // speckle noise
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * 0.07;
      ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(30,25,20,${a})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
}

export function awningTexture() {
  return makeCanvas(256, (ctx, s) => {
    const stripes = 8;
    const w = s / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#c94f3d' : '#e8dcc0';
      ctx.fillRect(i * w, 0, w, s);
    }
    // fading / dirt
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(120,100,80,${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 3, 3);
    }
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(60,40,20,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function barrelTexture() {
  return makeCanvas(128, (ctx, s) => {
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(0, 0, s, s);
    // vertical stave seams
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(40,25,10,${0.18 + Math.random() * 0.15})`;
      ctx.fillRect((i / 10) * s, 0, 2, s);
    }
    // grain speckle
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(30,18,8,${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    // two iron band stripes
    ctx.fillStyle = '#4a3018';
    ctx.fillRect(0, s * 0.16, s, s * 0.1);
    ctx.fillRect(0, s * 0.72, s, s * 0.1);
  });
}

// Gras-/Busch-Büschel: Fächer aus Halmen von einer Wurzel unten-mittig.
// Farbpaare parametrisiert — trockenes Gestrüpp und sattes Gras teilen den Code.
export function scrubTexture(c1 = [0x9a, 0x8a, 0x4e], c2 = [0x6f, 0x7a, 0x3a]) {
  return makeCanvas(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 30; i++) {
      const t = Math.random();
      const r = c1[0] + (c2[0] - c1[0]) * t | 0;
      const g = c1[1] + (c2[1] - c1[1]) * t | 0;
      const b = c1[2] + (c2[2] - c1[2]) * t | 0;
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.lineWidth = 2 + Math.random() * 3;
      const x0 = s * 0.5 + (Math.random() - 0.5) * s * 0.2;
      const x1 = s * 0.5 + (Math.random() - 0.5) * s * 0.95;
      const y1 = s * (0.05 + Math.random() * 0.45);
      ctx.beginPath();
      ctx.moveTo(x0, s);
      ctx.quadraticCurveTo((x0 + x1) / 2, s * 0.75, x1, y1);
      ctx.stroke();
    }
  });
}

export function aoTexture() {
  // radial contact-shadow gradient, alpha 0.3 center -> 0 edge
  return makeCanvas(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.3)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function stoneTileTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#6f665c'; // gap color
    ctx.fillRect(0, 0, s, s);
    const tiles = 4;
    const tw = s / tiles;
    const gap = 4;
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const shade = Math.random() * 0.16 - 0.08;
        const r = 168 + shade * 255 | 0, gr = 154 + shade * 255 | 0, b = 136 + shade * 255 | 0;
        ctx.fillStyle = `rgb(${r},${gr},${b})`; // base #a89a88 with jitter
        ctx.fillRect(tx * tw + gap / 2, ty * tw + gap / 2, tw - gap, tw - gap);
      }
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(40,35,30,${Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
}

// festgetretener Erdweg — U läuft quer über den Pfad, Ränder blenden in den Sand
export function dirtPathTexture() {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#b08e5e';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const a = Math.random() * 0.14;
      ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,240,210,${a})` : `rgba(60,45,25,${a})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    // eingetretene Trittsteine
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(140,125,105,${0.25 + Math.random() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * s, Math.random() * s,
        6 + Math.random() * 10, 4 + Math.random() * 7,
        Math.random() * Math.PI, 0, Math.PI * 2
      );
      ctx.fill();
    }
    // weiche Ränder: seitlicher Sand-Verlauf
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(216,185,127,0.95)');
    g.addColorStop(0.18, 'rgba(216,185,127,0)');
    g.addColorStop(0.82, 'rgba(216,185,127,0)');
    g.addColorStop(1, 'rgba(216,185,127,0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function waveTexture() {
  return makeCanvas(512, (ctx, s) => {
    ctx.fillStyle = '#2b6d86';
    ctx.fillRect(0, 0, s, s);
    // overlapping sine-band strokes as cheap wave detail
    for (let band = 0; band < 46; band++) {
      const y0 = Math.random() * s;
      const amp = 3 + Math.random() * 8;
      const freq = 0.01 + Math.random() * 0.03;
      const phase = Math.random() * Math.PI * 2;
      const light = Math.random() > 0.4;
      ctx.strokeStyle = light
        ? `rgba(140, 200, 215, ${0.05 + Math.random() * 0.09})`
        : `rgba(10, 40, 55, ${0.06 + Math.random() * 0.08})`;
      ctx.lineWidth = 1.5 + Math.random() * 3;
      ctx.beginPath();
      for (let x = 0; x <= s; x += 8) {
        const y = y0 + Math.sin(x * freq + phase) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

export function skyTexture() {
  return makeCanvas(1024, (ctx, s) => {
    // layered rose-sunset gradient: dusty blue zenith -> pink haze band -> warm horizon
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0.0, '#4a6fa8');   // dusty blue zenith
    g.addColorStop(0.35, '#93a0c2');  // lavender transition
    g.addColorStop(0.50, '#dba8b4');  // pink haze band
    g.addColorStop(0.60, '#f6c29c');  // warm peach
    g.addColorStop(0.66, '#ffd9ac');  // horizon glow
    g.addColorStop(0.78, '#efad92');  // deep sunset
    g.addColorStop(1.0, '#d897a0');   // rose base
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // radial sun glow baked into the sky, matching the sun azimuth
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(
      0.18 * s, 0.62 * s, 0,
      0.18 * s, 0.62 * s, 0.38 * s
    );
    glow.addColorStop(0, 'rgba(255, 214, 170, 0.55)');
    glow.addColorStop(1, 'rgba(255, 214, 170, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'source-over';
  });
}

export function sunSprite() {
  return makeCanvas(256, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255, 244, 214, 1)');
    g.addColorStop(0.18, 'rgba(255, 224, 160, 0.9)');
    g.addColorStop(0.5, 'rgba(255, 190, 110, 0.28)');
    g.addColorStop(1, 'rgba(255, 170, 90, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function sunHaloSprite() {
  // wide soft halo drawn behind the sun disc for the layered-glow look
  return makeCanvas(256, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255, 190, 160, 0.28)');
    g.addColorStop(1, 'rgba(255, 190, 160, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function cloudStreakTexture() {
  // horizontally stretched soft ellipses — underlit sunset cloud band
  return makeCanvas(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255, 225, 230, 0.5)';
    ctx.shadowColor = 'rgba(255, 225, 230, 0.5)';
    ctx.shadowBlur = 18;
    const n = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const cx = s * (0.1 + Math.random() * 0.8);
      const cy = s * (0.3 + Math.random() * 0.4);
      const rx = s * (0.12 + Math.random() * 0.22);
      const ry = s * (0.02 + Math.random() * 0.045);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
