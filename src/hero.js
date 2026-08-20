// hero.js — player character model (primitives) + procedural animation + stretch arms
import * as THREE from 'three';

const SKIN = 0xf0b98c;
const VEST = 0xe0301e;
const SHORTS = 0x2a5db0;
const CUFF = 0x1e4586;
const HAIR = 0x1a1410;
const HAT = 0xe8c86a;
const HATBAND = 0xb02020;
const SANDAL = 0x7a5a34;
const SCAR = 0x8a2c1e;
const MOUTH = 0x4a2018;
const BUTTON = 0xf7d54a;

// Schulter-Anker (lokales x bei Normalbau) — skaliert mit body.torso; combat.js
// bekommt den fertigen Wert als `shoulderX` am Charakter-Objekt.
const SHOULDER_X_BASE = 0.34;

// ---- Editor-Presets (Runde 12): Koerperbau / Gesicht / Outfit ----
// FIFA-Prinzip aus WELT.md: Design = Faehigkeit. scale/torso/limb formen das
// Modell, dmg/knock/speed/dodge fliessen als Stat-Multiplikatoren ins Spiel
// (combat.js liest dmg/knock, main.js speed/dodge). Werte moderat (max +-25%),
// damit kein Koerperbau zur Pflicht wird.
export const BODY_PRESETS = {
  schmaechtig: { label: 'Schmächtig', scale: 0.94, torso: 0.86, limb: 0.82, dmg: 0.85, knock: 0.85, speed: 1.18, dodge: 1.20 },
  normal:      { label: 'Normal',     scale: 1.00, torso: 1.00, limb: 1.00, dmg: 1.00, knock: 1.00, speed: 1.00, dodge: 1.00 },
  athletisch:  { label: 'Athletisch', scale: 1.03, torso: 1.10, limb: 1.08, dmg: 1.10, knock: 1.10, speed: 0.95, dodge: 1.00 },
  massig:      { label: 'Massig',     scale: 1.07, torso: 1.24, limb: 1.24, dmg: 1.20, knock: 1.20, speed: 0.88, dodge: 0.95 },
  riese:       { label: 'Riese',      scale: 1.16, torso: 1.30, limb: 1.30, dmg: 1.25, knock: 1.25, speed: 0.80, dodge: 0.90 },
};

// Gesichter rein prozedural (Augen/Brauen/Narbe/Bart/Mund als Varianten der
// bestehenden Primitiven) — kein Blender noetig.
export const FACE_PRESETS = {
  standard:     { label: 'Standard',     eyeScale: 1.00, browTilt: 0.12,  browThick: 1.0, scar: true,  cross: false, beard: false, mouth: 'laecheln' },
  froehlich:    { label: 'Fröhlich',     eyeScale: 1.18, browTilt: 0.30,  browThick: 0.8, scar: false, cross: false, beard: false, mouth: 'breit' },
  entschlossen: { label: 'Entschlossen', eyeScale: 0.85, browTilt: -0.28, browThick: 1.6, scar: false, cross: false, beard: false, mouth: 'ernst' },
  narbe:        { label: 'Kreuznarbe',   eyeScale: 0.90, browTilt: -0.15, browThick: 1.3, scar: true,  cross: true,  beard: false, mouth: 'ernst' },
  bart:         { label: 'Bart',         eyeScale: 1.00, browTilt: 0.05,  browThick: 1.2, scar: false, cross: false, beard: true,  mouth: 'laecheln' },
  grimmig:      { label: 'Grimmig',      eyeScale: 0.75, browTilt: -0.40, browThick: 1.8, scar: true,  cross: false, beard: true,  mouth: 'ernst' },
};

// Outfits ueber Schnitt (style) + freie Farbe (outfitColor tint auf vestMat).
// 'offen' = Weste mit Front-V, 'geschlossen' = Hemd/Jacke mit Knopfleiste,
// 'mantel' = geschlossen + faellt ueber die Huefte, 'frei' = nur Schaerpe.
export const OUTFIT_PRESETS = {
  weste:     { label: 'Weste',    style: 'offen',       sleeves: false, defaultColor: 0xe0301e },
  hemd:      { label: 'Hemd',     style: 'geschlossen', sleeves: false, defaultColor: 0xd8d8d0 },
  jacke:     { label: 'Jacke',    style: 'geschlossen', sleeves: true,  defaultColor: 0x24406e },
  aermellos: { label: 'Ärmellos', style: 'frei',        sleeves: false, defaultColor: 0x2e6b3a },
  mantel:    { label: 'Mantel',   style: 'mantel',      sleeves: true,  defaultColor: 0x20242c },
};

// ---- procedural textures (no external assets) ----

// subtle per-pixel luminance noise (+/-7%), blurred 2px — breaks up flat CSS-look surfaces
function makeNoiseTexture() {
  const size = 256;
  const src = document.createElement('canvas');
  src.width = src.height = size;
  const sctx = src.getContext('2d');
  const img = sctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    // centered around 238 so the multiply-map darkens only slightly
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

// concentric-ring straw weave for the hat
function makeWeaveTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e8c86a';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#d9b95c';
  ctx.lineWidth = 2;
  const cx = size / 2;
  for (let r = 3; r < size; r += 6) {
    ctx.beginPath();
    ctx.arc(cx, cx, r, 0, Math.PI * 2);
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

// config (Runde 11 + 12, Charakter-Editor):
//   hair:        THREE.Object3D | null — Frisur-Preset aus assets/presets/hair/*.glb,
//                Ursprung = Kopfzentrum; ersetzt Standard-Haar + Strohhut + Kinnband
//   hairColor:   hex — Tint fuer das Preset-Material (GLB-Material wird ersetzt)
//   bodyId:      Key aus BODY_PRESETS  (Koerperbau + Stat-Multiplikatoren)
//   faceId:      Key aus FACE_PRESETS  (Augen/Brauen/Narbe/Bart/Mund)
//   outfitId:    Key aus OUTFIT_PRESETS (Schnitt des Oberteils)
//   outfitColor: hex — Farbe des Oberteils (Fallback: defaultColor des Outfits)
// Unbekannte/fehlende Keys degradieren still auf den Standard — alte Runde-11-
// Configs bleiben damit ladbar.
export function createHero(config = {}) {
  const body = BODY_PRESETS[config.bodyId] ?? BODY_PRESETS.normal;
  const face = FACE_PRESETS[config.faceId] ?? FACE_PRESETS.standard;
  const outfit = OUTFIT_PRESETS[config.outfitId] ?? OUTFIT_PRESETS.weste;
  const outfitColor = typeof config.outfitColor === 'number' ? config.outfitColor : outfit.defaultColor;

  const group = new THREE.Group(); // origin at feet
  // Grundskalierung sofort setzen, damit auch Einmal-Renders (Thumbnails)
  // ohne update()-Frame die richtige Groesse zeigen; update() haelt sie aufrecht.
  group.scale.setScalar(body.scale);

  const noiseTex = makeNoiseTexture();
  const weaveTex = makeWeaveTexture();

  const skinMat = mat(SKIN, { map: noiseTex });
  const vestMat = mat(outfitColor, { map: noiseTex, roughness: 0.65 });
  // Innenfutter: abgedunkelte Outfit-Farbe, damit jede Farbwahl als Stoff liest
  const linerColor = new THREE.Color(outfitColor).multiplyScalar(0.55);
  const vestLinerMat = mat(linerColor.getHex(), { roughness: 0.75, side: THREE.BackSide });
  const shortsMat = mat(SHORTS, { map: noiseTex });
  const cuffMat = mat(CUFF);
  const hairMat = mat(HAIR, { roughness: 0.7 });
  const hatMat = mat(HAT, { roughness: 0.95, map: weaveTex });
  const bandMat = mat(HATBAND);
  const sandalMat = mat(SANDAL, { roughness: 0.95 });

  // ---- torso: solid shaped body — top garment wraps the chest per outfit style ----
  const torso = new THREE.Group();
  torso.position.y = 1.05;
  // Koerperbau-Breite: wie group.scale sofort setzen (Thumbnails), update()
  // faltet den Faktor jede Frame in seine Atmung/Wobble-Skalierung ein.
  torso.scale.set(body.torso, 1, body.torso);
  group.add(torso);

  // widened chest core (skin shows only through the front gap of the garment)
  const chestCore = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 6, 12), skinMat));
  chestCore.scale.set(1.13, 1, 0.95);
  torso.add(chestCore);

  // ---- Oberteil (Runde 12): Schnitt nach Outfit-Preset ----
  const OPEN_GAP = 0.7;    // rad Frontoeffnung der offenen Weste (Front-V)
  const CLOSED_GAP = 0.16; // schmaler Spalt = Knopfleiste bei Hemd/Jacke/Mantel
  const TOP_LEN = 0.6;     // Standardlaenge des Oberteils
  const COAT_LEN = 0.95;   // Mantel faellt ueber die Huefte
  if (outfit.style !== 'frei') {
    const gap = outfit.style === 'offen' ? OPEN_GAP : CLOSED_GAP;
    const topLen = outfit.style === 'mantel' ? COAT_LEN : TOP_LEN;
    const topOffY = -(topLen - TOP_LEN) / 2; // laenger = nach unten wachsen, Kragen bleibt

    const vestGeo = new THREE.CylinderGeometry(
      0.32, 0.305, topLen, 16, 1, true, gap / 2, Math.PI * 2 - gap
    );
    const vest = shadow(new THREE.Mesh(vestGeo, vestMat));
    vest.position.y = topOffY;
    torso.add(vest);

    // inner liner in darkened outfit color so the inside face reads as cloth
    const linerGeo = new THREE.CylinderGeometry(
      0.30, 0.29, topLen - 0.01, 16, 1, true, gap / 2, Math.PI * 2 - gap
    );
    const liner = new THREE.Mesh(linerGeo, vestLinerMat);
    liner.position.y = topOffY;
    torso.add(liner);

    // vertical edge strips along both front-opening edges — cloth thickness
    const stripGeo = new THREE.BoxGeometry(0.035, topLen, 0.02);
    const stripX = 0.32 * Math.sin(gap / 2);
    const stripZ = 0.32 * Math.cos(gap / 2);
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(stripGeo, vestMat);
      strip.position.set(stripX * s, topOffY, stripZ);
      strip.rotation.y = -s * (gap / 2);
      torso.add(strip);
    }

    // collar ring at the top of the garment, slightly tilted
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.03, 6, 16), vestMat);
    collar.position.y = 0.30;
    collar.rotation.x = Math.PI / 2 + 0.08;
    torso.add(collar);

    // yellow buttons down the front-opening edge (offen: rechts, geschlossen: mittig)
    const buttonGeo = new THREE.SphereGeometry(0.025, 8, 6);
    const buttonMat = mat(BUTTON, { roughness: 0.4 });
    for (const y of [0.18, 0.0, -0.18]) {
      const btn = new THREE.Mesh(buttonGeo, buttonMat);
      btn.position.set(stripX, y, stripZ + 0.015);
      torso.add(btn);
    }
  } else {
    // aermellos: nackter Oberkoerper, nur eine Schaerpe in Outfit-Farbe an der Huefte
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.05, 8, 18), vestMat);
    sash.position.y = -0.26;
    sash.rotation.x = Math.PI / 2 + 0.1;
    torso.add(sash);
  }

  // neck connecting head to shoulders
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 10), skinMat);
  neck.position.y = 1.64;
  group.add(neck);

  // ---- head ----
  const headPivot = new THREE.Group();
  headPivot.position.y = 1.66;
  group.add(headPivot);

  const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), skinMat));
  head.position.y = 0.1;
  headPivot.add(head);

  // FULL hair cap — centered, covers top and sides so it reads black from every angle
  const hair = shadow(new THREE.Mesh(
    new THREE.SphereGeometry(0.315, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat
  ));
  hair.position.set(0, 0.1, -0.03);
  headPivot.add(hair);

  // fringe — 7 spikes fanned across the forehead, peeking out under the brim
  const defaultHairParts = [hair]; // alles, was ein Editor-Preset ersetzt
  const fringeGeo = new THREE.BoxGeometry(0.07, 0.1, 0.04);
  for (let i = 0; i < 7; i++) {
    const spike = new THREE.Mesh(fringeGeo, hairMat);
    const fx = -0.18 + (0.36 * i) / 6;
    spike.position.set(fx, 0.19, 0.25);
    spike.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.2;
    headPivot.add(spike);
    defaultHairParts.push(spike);
  }

  // eyes — big and friendly, flattened against the face sphere
  const eyeGeo = new THREE.SphereGeometry(0.06, 10, 8);
  const eyeMat = mat(0x14100c, { roughness: 0.3 });
  const hlGeo = new THREE.SphereGeometry(0.016, 6, 5);
  const hlMat = mat(0xffffff, { roughness: 0.2 });
  const browGeo = new THREE.BoxGeometry(0.09, 0.014, 0.008);
  const browMat = mat(0x14100c);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0.11 * s, 0.1, 0.275);
    // Gesichts-Preset: Augengroesse variiert (z bleibt flach gegen die Kugel)
    eye.scale.set(face.eyeScale, face.eyeScale, 0.5);
    headPivot.add(eye);
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.position.set(0.11 * s + 0.014 * s, 0.115, 0.305);
    headPivot.add(hl);
    const brow = new THREE.Mesh(browGeo, browMat);
    brow.position.set(0.11 * s, 0.16, 0.265);
    // browTilt > 0 = freundlich angehoben, < 0 = zusammengezogen (grimmig)
    brow.rotation.z = face.browTilt * s;
    brow.scale.y = face.browThick;
    headPivot.add(brow);
  }

  const scarMat = mat(SCAR);
  // the scar under the left eye — the identity mark (per Gesichts-Preset an/aus)
  if (face.scar) {
    for (const dy of [-0.008, 0.008]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.006), scarMat);
      line.position.set(-0.11, 0.035 + dy, 0.285);
      line.rotation.z = 0.06;
      headPivot.add(line);
    }
    for (const dx of [-0.028, 0.028]) {
      const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.006), scarMat);
      stitch.position.set(-0.11 + dx, 0.035, 0.287);
      stitch.rotation.z = 0.06;
      headPivot.add(stitch);
    }
  }
  // Kreuznarbe auf der rechten Wange (Gesichts-Preset 'narbe')
  if (face.cross) {
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.15, 0.006), scarMat);
    vertical.position.set(0.13, 0.04, 0.283);
    vertical.rotation.z = -0.12;
    headPivot.add(vertical);
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.006), scarMat);
    horizontal.position.set(0.13, 0.04, 0.285);
    horizontal.rotation.z = 0.18;
    headPivot.add(horizontal);
  }

  // Mund per Gesichts-Preset: Laecheln (Torus) in zwei Breiten oder ernste Linie
  if (face.mouth === 'ernst') {
    const mouthLine = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.016, 0.008), mat(MOUTH));
    mouthLine.position.set(0, 0.01, 0.283);
    headPivot.add(mouthLine);
  } else {
    const smileRadius = face.mouth === 'breit' ? 0.105 : 0.085;
    const smile = new THREE.Mesh(new THREE.TorusGeometry(smileRadius, 0.011, 6, 14, Math.PI), mat(MOUTH));
    smile.position.set(0, 0.02, 0.272);
    smile.rotation.x = -Math.PI / 2 + 0.35;
    headPivot.add(smile);
  }

  // Bart: Kugelband um die untere Gesichtshaelfte, nur die Front (Haarfarbe)
  if (face.beard) {
    const beardMat = mat(config.hairColor ?? HAIR, { roughness: 0.85 });
    const beard = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.312, 16, 10,
        Math.PI / 2 - Math.PI * 0.4, Math.PI * 0.8, // Front-Sektor um +Z
        Math.PI * 0.56, Math.PI * 0.26              // untere Gesichtshaelfte
      ),
      beardMat
    );
    beard.position.set(0, 0.1, 0.005);
    headPivot.add(beard);
  }

  // ---- straw hat ----
  const hat = new THREE.Group();
  hat.position.set(0, 0.36, -0.02);
  hat.rotation.x = -0.12;
  const crown = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.17, 14), hatMat));
  crown.position.y = 0.06;
  hat.add(crown);
  const brim = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.5, 0.025, 18), hatMat));
  hat.add(brim);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.26, 0.07, 14), bandMat);
  band.position.y = 0.03;
  hat.add(band);
  headPivot.add(hat);

  // chin cord hung at the jawline
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.008, 5, 16), mat(0x6b4a2a));
  cord.position.set(0, -0.05, 0.02);
  cord.rotation.x = Math.PI / 2 + 0.18;
  headPivot.add(cord);
  defaultHairParts.push(hat, cord);
  // Entbrandung (R16), Hut-Inversion: Der Strohhut wird weiter gebaut (alle
  // Editor-/Config-Pfade bleiben strukturell stabil), ist aber nur sichtbar,
  // wenn eine Config ihn AUSDRÜCKLICH bestellt (hat: true) — das tut derzeit
  // niemand. Damit sind Boot-Standard, Editor-Standard und ALTE Speicherstände
  // (hairId null) automatisch hutlos, ohne Migrationspfad. config.hair blendet
  // ohnehin alle defaultHairParts aus (unten).
  hat.visible = config.hat === true;
  cord.visible = config.hat === true;

  // ---- Editor-Frisur (Runde 11): GLB-Preset ersetzt Standard-Haar + Hut ----
  // Konvention aus tools/blender/hair_presets.py: Ursprung = Kopfzentrum,
  // +Y oben, +Z Blickrichtung — passt damit direkt in den headPivot-Raum.
  if (config.hair) {
    for (const part of defaultHairParts) part.visible = false;
    const customHair = config.hair;
    customHair.position.set(0, 0.1, 0); // Kopfzentrum (head sitzt bei y=0.1)
    const customHairMat = mat(config.hairColor ?? HAIR, { roughness: 0.7 });
    customHair.traverse((o) => {
      if (o.isMesh) {
        o.material = customHairMat;
        o.castShadow = true;
      }
    });
    headPivot.add(customHair);
  }

  // ---- legs ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.15 * side, 0.78, 0);
    // Limb-Dicke aus dem Koerperbau; update() fasst Leg-Scales nie an
    pivot.scale.set(body.limb, 1, body.limb);
    const upper = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.3, 4, 8), shortsMat));
    upper.position.y = -0.2;
    pivot.add(upper);
    // rolled denim cuff at the bottom of the shorts
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.06, 10), cuffMat);
    cuff.position.y = -0.38;
    pivot.add(cuff);
    const lower = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.28, 4, 8), skinMat));
    lower.position.y = -0.55;
    pivot.add(lower);
    const foot = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.3), sandalMat));
    foot.position.set(0, -0.74, 0.06);
    pivot.add(foot);
    // sandal strap across the top of the foot
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.06), mat(0x5a4226));
    strap.position.set(0, -0.7, 0.1);
    pivot.add(strap);
    group.add(pivot);
    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // ---- normal arms: shoulder pivot + elbow pivot so they pump, not swing ----
  function makeArm(side) {
    const pivot = new THREE.Group();
    // Schulter wandert mit der Torso-Breite nach aussen, sonst stecken die
    // Arme bei Massig/Riese im Brustkorb (Kritiker R12 #3)
    pivot.position.set(SHOULDER_X_BASE * body.torso * side, 1.42, 0);
    // Limb-Dicke: nur x/z — update() schreibt bei der Wobble-Erholung nur scale.y
    pivot.scale.set(body.limb, 1, body.limb);
    // Schulterkappe: Outfit-Farbe; aermellos = nackte Schulter (Haut)
    const capMat = outfit.style === 'frei' ? skinMat : vestMat;
    const sleeve = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), capMat));
    pivot.add(sleeve);
    // Langarm-Outfits (Jacke/Mantel) faerben Ober- und Unterarm mit ein
    const armMat = outfit.sleeves ? vestMat : skinMat;
    const upper = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.24, 4, 8), armMat));
    upper.position.y = -0.17;
    pivot.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    pivot.add(elbow);
    const forearm = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.2, 4, 8), armMat));
    forearm.position.y = -0.13;
    elbow.add(forearm);
    const fist = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skinMat));
    fist.position.y = -0.29;
    elbow.add(fist);
    pivot.rotation.z = -0.12 * side;
    pivot.userData.elbow = elbow;
    group.add(pivot);
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // ---- stretch arms (rubber attacks) ----
  // unit cylinder with origin at top end, scaled in Y to reach target
  function makeStretchArm(side) {
    const g = new THREE.Group();
    const armGeo = new THREE.CylinderGeometry(0.085, 0.1, 1, 8);
    armGeo.translate(0, -0.5, 0); // origin at shoulder end
    const arm = shadow(new THREE.Mesh(armGeo, skinMat));
    g.add(arm);
    const fist = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), skinMat));
    fist.position.y = -1;
    g.add(fist);
    g.visible = false;
    g.userData = { arm, fist, side };
    group.add(g);
    return g;
  }
  const stretchL = makeStretchArm(-1);
  const stretchR = makeStretchArm(1);

  const _target = new THREE.Vector3();
  const _shoulder = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _up = new THREE.Vector3(0, -1, 0);
  const _q = new THREE.Quaternion();

  function shoulderLocal(side) {
    // gleicher Anker wie makeArm — Stretch-Arme starten an der echten Schulter
    return _shoulder.set(SHOULDER_X_BASE * body.torso * side, 1.42, 0.1);
  }

  // ---- anime-ize state: anticipation / afterimages / recovery wobble ----
  const WINDUP_MS = 50;      // anticipation before the arm flies (was 80 — combat pacing pass)
  const GHOST_LIFE_MS = 120; // afterimage lifetime
  let attackActive = false;  // are we mid-attack (between first stretchArm and relaxArms)?
  let windupEnd = 0;         // performance.now() timestamp when anticipation ends
  let attackSide = 1;        // +1 right, -1 left (for torso twist direction)
  let attackLean = 0;        // torso lean-in applied this frame by stretchArm
  let attackTwist = 0;       // torso twist applied this frame by stretchArm
  let wobbleT = 0;           // recovery overshoot timer (seconds, counts down)
  const WOBBLE_DUR = 0.16;
  const ghosts = [];         // live afterimages {mesh, fist, age}
  const ghostArmGeo = new THREE.CylinderGeometry(0.085, 0.1, 1, 8);
  ghostArmGeo.translate(0, -0.5, 0);
  const ghostFistGeo = new THREE.SphereGeometry(0.16, 10, 8);

  function spawnGhost(sa, opacity) {
    const m = new THREE.MeshBasicMaterial({
      color: 0x9a5050, // grey-red rubber blur
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const g = new THREE.Group();
    const arm = new THREE.Mesh(ghostArmGeo, m);
    arm.scale.copy(sa.userData.arm.scale);
    g.add(arm);
    const fist = new THREE.Mesh(ghostFistGeo, m);
    fist.position.copy(sa.userData.fist.position);
    fist.scale.copy(sa.userData.fist.scale);
    g.add(fist);
    g.position.copy(sa.position);
    g.quaternion.copy(sa.quaternion);
    group.add(g);
    ghosts.push({ group: g, mat: m, age: 0, baseOpacity: opacity });
  }

  function updateGhosts(dt) {
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const gh = ghosts[i];
      gh.age += dt * 1000;
      if (gh.age >= GHOST_LIFE_MS) {
        group.remove(gh.group);
        gh.mat.dispose();
        ghosts.splice(i, 1);
      } else {
        gh.mat.opacity = gh.baseOpacity * (1 - gh.age / GHOST_LIFE_MS);
      }
    }
  }

  // snap-back ripple: arm overshoot travels into the torso as a 2-pulse scale wave
  let rippleT = 0;
  const RIPPLE_DUR = 0.3;

  // reach: 0..1..0 — combat drives this per-frame. targetWorld: world-space aim point.
  function stretchArm(which, targetWorld, reach) {
    const now = performance.now();

    // new attack begins → brief anticipation wind-up (WINDUP_MS)
    if (!attackActive) {
      attackActive = true;
      windupEnd = now + WINDUP_MS;
      attackSide = which === 'left' ? -1 : 1;
      for (const sa of [stretchL, stretchR]) sa.userData.ghostsSpawned = 0;
    }

    const arms = which === 'both' ? [stretchL, stretchR] : which === 'left' ? [stretchL] : [stretchR];

    // ---- anticipation phase: torso twists back, fist pulled back, slight crouch ----
    if (now < windupEnd) {
      const k = 1 - (windupEnd - now) / WINDUP_MS; // 0→1 across the wind-up
      stretchL.visible = false;
      stretchR.visible = false;
      armL.visible = true;
      armR.visible = true;
      attackTwist = 0.4 * attackSide * k;   // twist AWAY from the punch
      attackLean = -0.15 * k;               // rear back
      torso.rotation.y += attackTwist;
      torso.rotation.x += attackLean;
      torso.position.y -= 0.07 * k;         // slight crouch
      // fist(s) cocked back past the shoulder
      if (which !== 'left') { armR.rotation.x = 0.9 * k; armR.userData.elbow.rotation.x = -1.2 * k; }
      if (which !== 'right') { armL.rotation.x = 0.9 * k; armL.userData.elbow.rotation.x = -1.2 * k; }
      return;
    }

    const hideNormal = reach > 0.03;
    if (which !== 'left') armR.visible = !hideNormal;
    if (which !== 'right') armL.visible = !hideNormal;

    // torso leans INTO the punch — sells the launch even from behind the camera
    attackLean = 0.3 * reach;
    attackTwist = -0.25 * attackSide * reach;
    torso.rotation.x += attackLean;
    torso.rotation.y += attackTwist;

    for (const sa of arms) {
      const side = sa.userData.side;
      const wasVisible = sa.visible;
      sa.visible = hideNormal;
      if (!hideNormal) {
        // arm just snapped back → recovery overshoot wobble + torso ripple
        if (wasVisible) { wobbleT = WOBBLE_DUR; rippleT = RIPPLE_DUR; }
        continue;
      }
      const sh = shoulderLocal(side);
      sa.position.copy(sh);
      // target in hero-local space
      _target.copy(targetWorld);
      group.worldToLocal(_target);
      _dir.copy(_target).sub(sh);
      const dist = Math.max(_dir.length(), 0.001) * reach;
      _dir.normalize();
      _q.setFromUnitVectors(_up, _dir);
      sa.quaternion.copy(_q);
      const len = Math.max(dist, 0.4);
      // rubber! the arm thins 15% as it stretches (Basis-Dicke aus dem Koerperbau)
      const thin = (1 - 0.15 * reach) * body.limb;
      sa.userData.arm.scale.set(thin, len, thin);
      sa.userData.fist.position.y = -len;
      // fist balloons to 1.6x at full extension
      const punch = (1 + reach * 0.6) * body.limb;
      sa.userData.fist.scale.setScalar(punch);

      // afterimages: 2 ghosts trailing the extension (opacity 0.25 then 0.15)
      const spawned = sa.userData.ghostsSpawned || 0;
      if (spawned === 0 && reach > 0.3) {
        spawnGhost(sa, 0.25);
        sa.userData.ghostsSpawned = 1;
      } else if (spawned === 1 && reach > 0.7) {
        spawnGhost(sa, 0.15);
        sa.userData.ghostsSpawned = 2;
      }
    }
  }

  function relaxArms() {
    if (stretchL.visible || stretchR.visible || attackActive) {
      wobbleT = WOBBLE_DUR;
      rippleT = RIPPLE_DUR;
    }
    attackActive = false;
    stretchL.visible = false;
    stretchR.visible = false;
    armL.visible = true;
    armR.visible = true;
  }

  // ---- OVERDRIVE aura (Runde 7 Overdrive-Ultimate) ----
  // main.js toggles this on activation/end; update() pulses the glow while active.
  // Two parts: emissive tint on the existing skin/vest materials (reads up close),
  // plus an additive glow shell (2 billboard sprites around the torso, out of phase)
  // so the buff reads clearly from third-person distance too — same "cheap pooled
  // sprite" idiom as fx.js's starbursts/dust, no new geometry or libraries.
  let overdriveOn = false;

  function makeAuraTexture() {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 225, 180, 0.95)');
    grad.addColorStop(0.35, 'rgba(255, 110, 35, 0.8)');
    grad.addColorStop(0.7, 'rgba(220, 30, 20, 0.4)');
    grad.addColorStop(1, 'rgba(220, 30, 20, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const auraTex = makeAuraTexture();

  function makeAuraSprite(y, sx, sy) {
    const m = new THREE.SpriteMaterial({
      map: auraTex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const s = new THREE.Sprite(m);
    s.position.set(0, y, 0);
    s.scale.set(sx, sy, 1);
    s.renderOrder = 5;
    s.visible = false;
    group.add(s);
    return s;
  }
  // origin at feet: two shells stacked around torso/chest height, offset in
  // scale/phase so the flicker never reads as a static decal
  const auraA = makeAuraSprite(1.15, 1.35, 1.9);
  const auraB = makeAuraSprite(0.95, 1.05, 1.5);

  function setOverdrive(active) {
    overdriveOn = active;
    if (!active) {
      skinMat.emissive.setHex(0x000000);
      skinMat.emissiveIntensity = 0;
      vestMat.emissive.setHex(0x000000);
      vestMat.emissiveIntensity = 0;
      auraA.visible = false;
      auraB.visible = false;
      auraA.material.opacity = 0;
      auraB.material.opacity = 0;
    } else {
      auraA.visible = true;
      auraB.visible = true;
    }
  }

  // ---- animation ----
  // state: {speed: 0..1, grounded: bool, dashing: bool}
  let phase = 0;
  let lastBob = 0;

  // rubber landing squash: body squashes (1.12, 0.86) then rebounds through
  // 2 diminishing bounces over ~0.35s
  let wasGrounded = true;
  let landT = 0;
  const LAND_DUR = 0.35;

  // rubber hurt arch: hard knockback bends the spine backward like rubber
  let hurtT = 0;
  const HURT_DUR = 0.45;
  const lastPos = new THREE.Vector3();
  let hasLastPos = false;
  // hurt() im API statt window-Hook: der Editor baut viele Vorschau-Instanzen,
  // ein globaler Hook zeigte sonst auf ein disposetes Modell (Kritiker Runde 11).
  // update() erkennt Knockback-Teleports zusaetzlich automatisch.
  function hurt() { hurtT = HURT_DUR; }

  // R25.1 (Felix): Aufheb-Animation — der HELD bueckt sich kurz zum Fundstueck
  // (das Stueck selbst bleibt am Boden und blendet dort weg, discover.js).
  // Muster hurt(): Timer + additive Beugung NACH dem Locomotion-Pass in update().
  let pickupT = 0;
  const PICKUP_DUR = 0.55;
  function pickupBend() { pickupT = PICKUP_DUR; }

  function update(dt, t, state) {
    // ---- victory pose (Runde 9): fist raised high, held through the win-pose
    // camera orbit — overrides locomotion entirely, mirrors kai.js's kneel-pose pattern
    if (state.victory) {
      stretchL.visible = false;
      stretchR.visible = false;
      armL.visible = true;
      armR.visible = true;
      legL.rotation.x = 0.14;
      legR.rotation.x = -0.08;
      armR.rotation.x = -2.65;
      armR.rotation.z = 0;
      armR.userData.elbow.rotation.x = -0.25;
      armL.rotation.x = 0.12;
      armL.rotation.z = 0.14;
      armL.userData.elbow.rotation.x = -0.12;
      torso.rotation.set(0, 0, 0);
      headPivot.rotation.set(0, -0.05, 0);
      group.scale.setScalar(body.scale);
      const breathe = Math.sin(t * 2.2) * 0.02;
      torso.scale.set(body.torso, 1 + breathe, body.torso);
      return;
    }

    const speed = state.speed || 0;
    phase += dt * (4 + speed * 9);

    // ---- landing detection → squash-and-rebound timer ----
    const grounded = !!state.grounded;
    if (grounded && !wasGrounded) landT = LAND_DUR;
    wasGrounded = grounded;

    // ---- knockback detection: a sudden horizontal teleport (main.js shoves
    // Hero 0.7 units in one frame on damage) reads as apparent speed far
    // beyond anything locomotion produces ----
    if (state.hurt || state.knockback) hurtT = HURT_DUR;
    if (hasLastPos && dt > 0) {
      const kdx = group.position.x - lastPos.x;
      const kdz = group.position.z - lastPos.z;
      const apparent = Math.hypot(kdx, kdz) / dt;
      if (apparent > 25) hurtT = HURT_DUR;
    }
    lastPos.copy(group.position);
    hasLastPos = true;

    const swing = Math.sin(phase) * (0.25 + speed * 0.55);
    legL.rotation.x = swing;
    legR.rotation.x = -swing;

    // two-segment arm pump: shoulder swings, elbow bends on the forward stroke
    // amplitude grows with speed so the run reads big and anime (idle unchanged)
    // + rubbery looseness: a phase-lagged overshoot term so the arms swing
    // past the stride and get whipped back, like they have no bones
    const armAmp = 0.7 + speed * 0.35;
    const loose = Math.sin(phase - 0.55) * 0.18 * speed;
    if (armL.visible) {
      armL.rotation.x = -swing * armAmp - loose;
      armL.userData.elbow.rotation.x = -Math.max(0, Math.sin(phase + 0.5)) * 0.9 * speed;
    }
    if (armR.visible) {
      armR.rotation.x = swing * armAmp + loose;
      armR.userData.elbow.rotation.x = -Math.max(0, Math.sin(phase + Math.PI + 0.5)) * 0.9 * speed;
    }

    // recovery overshoot: arms bounce 1.0→1.06→1.0 after a stretch snaps back
    if (wobbleT > 0) {
      wobbleT = Math.max(0, wobbleT - dt);
      const s = 1 + Math.sin((1 - wobbleT / WOBBLE_DUR) * Math.PI) * 0.06;
      armL.scale.y = s;
      armR.scale.y = s;
    } else {
      armL.scale.y = 1;
      armR.scale.y = 1;
    }

    // age & fade attack afterimages
    updateGhosts(dt);

    // idle/run bob
    const bob = Math.abs(Math.sin(phase)) * (0.02 + speed * 0.05);
    torso.position.y = 1.05 + bob;
    headPivot.position.y = 1.66 + bob;
    neck.position.y = 1.64 + bob;

    // ---- combined torso scale: breathing + run jelly wobble + snap-back ripple ----
    let tsy = 1;
    let tsx = 1;

    // idle breathing — chest rises and falls when standing still
    if (speed < 0.1) {
      tsy += Math.sin(t * 1.8) * 0.015;
      // occasional deeper breath — slow secondary wave that peaks every ~7s
      tsy += Math.max(0, Math.sin(t * 0.9)) ** 6 * 0.02;
    }

    // run jelly wobble — whole body compresses a touch on each footfall
    // (|sin| bob bottoms out twice per stride cycle → frequency phase*2)
    const jelly = Math.sin(phase * 2) * 0.04 * speed;
    tsy += jelly;
    tsx -= jelly * 0.6; // counter-bulge sideways, rubber conserves volume

    // stretch snap-back ripple — the arm overshoot travels into the torso as
    // a decaying 2-pulse scale wave
    if (rippleT > 0) {
      rippleT = Math.max(0, rippleT - dt);
      const p = 1 - rippleT / RIPPLE_DUR;      // 0→1
      const wave = Math.sin(p * Math.PI * 4) * (1 - p); // 2 pulses, dying out
      tsy += wave * 0.06;
      tsx -= wave * 0.04;
    }

    // Koerperbau-Breite jede Frame mit einfalten (Atmung/Wobble sind Faktoren darauf)
    torso.scale.set(tsx * body.torso, tsy, tsx * body.torso);

    // ---- rubber landing squash on the whole body (origin at feet) ----
    if (landT > 0) {
      landT = Math.max(0, landT - dt);
      const p = 1 - landT / LAND_DUR;                  // 0→1 since impact
      const decay = (1 - p) * (1 - p);                 // diminishing bounces
      const s = Math.cos(p * Math.PI * 2.5) * decay;   // squash→stretch→squash
      // Squash als Faktor auf der Koerperbau-Grundskalierung
      group.scale.set(
        body.scale * (1 + 0.12 * s),
        body.scale * (1 - 0.14 * s),
        body.scale * (1 + 0.12 * s),
      );
    } else {
      group.scale.setScalar(body.scale);
    }

    // ---- idle rubbery sway — Hero never stands rigid ----
    if (speed < 0.1 && grounded) {
      torso.rotation.z = Math.sin(t * 0.7) * 0.03;
      headPivot.rotation.z = Math.sin(t * 0.7 + 0.6) * 0.025;
    } else {
      torso.rotation.z = 0;
      headPivot.rotation.z = 0;
    }

    // hat lag — reacts to vertical motion so it feels loosely worn
    const bobVelocity = dt > 0 ? (bob - lastBob) / dt : 0;
    lastBob = bob;
    hat.rotation.x = -0.12 - Math.max(-0.5, Math.min(0.5, bobVelocity)) * 0.3;

    // airborne pose
    if (!state.grounded) {
      legL.rotation.x = 0.5;
      legR.rotation.x = -0.35;
    }

    // slight head lean into motion
    headPivot.rotation.x = state.grounded ? speed * 0.12 : -0.15;

    // torso lean + counter-rotation yaw while running
    torso.rotation.x = speed * 0.12;
    torso.rotation.y = Math.sin(phase) * 0.1 * speed;

    // ---- rubber hurt arch: hard knockback bends the spine backward and it
    // springs back with a wobble, instead of Hero just sliding rigidly ----
    if (hurtT > 0) {
      hurtT = Math.max(0, hurtT - dt);
      const p = 1 - hurtT / HURT_DUR;                       // 0→1
      const spring = 1 + 0.3 * Math.sin(p * Math.PI * 3) * (1 - p); // rubbery return
      const arch = Math.sin(p * Math.PI) * 0.55 * spring;
      torso.rotation.x -= arch;                              // spine arches back
      headPivot.rotation.x -= arch * 0.75;                   // head whips with it
      if (armL.visible && armR.visible && !attackActive) {   // arms flail forward
        armL.rotation.x -= arch * 1.1;
        armR.rotation.x -= arch * 1.1;
      }
    }

    // ---- R25.1: Aufheb-Buecker — schnell runter, weicher wieder hoch; alles
    // additiv auf den Locomotion-Pass (kein Zustand bleibt zurueck). Die
    // Kniebeuge kommt als Squash-Faktor auf group.scale.y (Origin an den
    // Fuessen — die Sohlen bleiben am Boden, nichts schwebt). ----
    if (pickupT > 0) {
      pickupT = Math.max(0, pickupT - dt);
      const p = 1 - pickupT / PICKUP_DUR;                 // 0→1
      const bend = Math.sin(Math.PI * Math.pow(p, 0.72)); // Peak frueh (~40 %), Ausklang weich
      torso.rotation.x += bend * 0.85;                    // Oberkoerper beugt sich vor
      headPivot.rotation.x += bend * 0.3;                 // Blick geht zum Fund
      if (armR.visible && !attackActive) {
        armR.rotation.x -= bend * 0.5;                    // rechte Hand greift vor/runter
        armR.userData.elbow.rotation.x -= bend * 0.35;
      }
      group.scale.y *= 1 - bend * 0.14;                   // leichte Kniebeuge (Squash)
    }

    // ---- OVERDRIVE: skin/vest glow red-white + additive aura shell, both pulsing ----
    if (overdriveOn) {
      const pulse = 0.55 + 0.45 * Math.sin(t * 11);
      skinMat.emissive.setHex(0xff2a10);
      skinMat.emissiveIntensity = 0.9 * pulse;
      vestMat.emissive.setHex(0xff3010);
      vestMat.emissiveIntensity = 0.55 * pulse;

      // two glow shells pulse out of phase — reads as a living flame, not a decal,
      // and is bright/large enough to catch the bloom pass from third-person distance
      const pA = 0.7 + 0.3 * Math.sin(t * 9);
      const pB = 0.7 + 0.3 * Math.sin(t * 13 + 1.7);
      auraA.material.opacity = 0.6 * pA;
      auraA.scale.set(1.25 + 0.2 * pA, 1.75 + 0.25 * pA, 1);
      auraB.material.opacity = 0.45 * pB;
      auraB.scale.set(0.95 + 0.15 * pB, 1.35 + 0.2 * pB, 1);
    }
  }

  // Off-Graph-Ressourcen freigeben: die Ghost-Geometrien haengen nie im
  // Szenengraph und wuerden sonst bei jedem Wegwerf-Charakter leaken
  // (Editor-Preview, Thumbnails, applyCharacter-Austausch). Szenengraph-
  // Ressourcen raeumt der Aufrufer via traverse auf (disposeCharacter).
  function dispose() {
    ghostArmGeo.dispose();
    ghostFistGeo.dispose();
  }

  // stats: Design = Faehigkeit (WELT.md) — combat.js liest dmg/knock,
  // main.js liest speed (Move-Speed) und dodge (Perfect-Dodge-Fenster).
  const stats = { dmg: body.dmg, knock: body.knock, speed: body.speed, dodge: body.dodge };
  return {
    group, update, stretchArm, relaxArms, setOverdrive, hurt, pickupBend, stats, dispose,
    // Schulter-Anker fuer combat.js (_shoulderWorld): wandert mit der Torso-Breite
    shoulderX: SHOULDER_X_BASE * body.torso,
    height: 1.9 * body.scale,
    radius: 0.45 * body.scale,
  };
}
