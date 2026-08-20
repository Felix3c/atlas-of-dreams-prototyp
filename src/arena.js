// arena.js — Insel-Environment: Boden, Ozean, Himmel, Licht + Orchestrierung der Insel-Module
// (Runde 13, M3: aus der Kampf-Arena wird die erste kleine offene Insel — Hafendorf,
// Wege, Küste, Steg + Ruderboot. Dorf/Hafen/Vegetation leben in src/island/*.js.)
import * as THREE from 'three';
import {
  sandTexture, stoneTileTexture, plasterTexture, plankTexture, stoneBlockTexture,
  awningTexture, barrelTexture, aoTexture, waveTexture, skyTexture,
  sunSprite, sunHaloSprite, cloudStreakTexture,
} from './island/textures.js';
import { buildVillage, checkPathsClear } from './island/village.js';
import { buildHarbor } from './island/harbor.js';
import { buildVegetation } from './island/vegetation.js';
import { buildVillagers } from './island/villagers.js';

export const ARENA_RADIUS = 36;   // Kampfzone rund um den Dorfplatz (Bestand — Wellen & Boss bleiben hier)
export const ISLAND_RADIUS = 58;  // Radius der Insel-Grundfläche (Sandkante)
export const WALK_RADIUS = 54;    // weiche Barriere am Strand — dahinter beginnt das Wasser

// Hafensteg: schmaler begehbarer Korridor, der über WALK_RADIUS hinaus ins Wasser führt
export const PIER = { x: 14, halfWidth: 2.1, shoreZ: 48, endZ: 71, deckY: 0.22 };

// ---------- R21 Aufgabe C: das Umland — die Insel wächst nach AUSSEN ----------
// WALK_RADIUS (54) bleibt als Zahl UNVERÄNDERT: die Sim (sim/world.mjs) reicht ihn
// in die geseedete Vegetation, und der ganze Altbestand (Spawn-Fächer, Minimap,
// Dorf-Streu) rechnet damit — die Erweiterung passiert ausschließlich JENSEITS
// dieser Grenze. Die neue begehbare Küste ist RICHTUNGSABHÄNGIG (coastWalkRadius):
//   - Um den Steg herum bleibt sie exakt bei WALK_RADIUS — sonst läge der Hafen
//     (der Steg führt bei r 48..71 übers Wasser, das Episoden-Boot fährt bis z=80)
//     plötzlich im Landesinneren.
//   - Überall sonst wächst sie auf EXPLORE_RADIUS (+52 %), mit einer Bucht im
//     Südwesten als Küsten-Einschnitt und einer Anhöhe im Nordwesten (outerRelief)
//     als Blickfang.
// Sim-Bit-Exaktheit: isWalkable prüft den Alt-Kreis ZUERST und unverändert — für
// alles innerhalb von r<=54 (die ganze Bewohner-Welt) ist jeder Codepfad identisch.
// R23 Aufgabe B.1: 82 -> 120 („Die Anfangsinsel muss etwas sein, was man
// entdecken kann"). Dieselbe Disziplin wie R21/R22: die Zahl wirkt AUSSCHLIESSLICH
// jenseits des Alt-Kreises r<=54 — isWalkable prüft den zuerst, groundY kehrt für
// r<=56 früh zurück, und die Sim fragt nie Punkte jenseits der Bewohner-Welt ab.
export const EXPLORE_RADIUS = 120;                   // begehbare Außengrenze im Umland
const SAND_EXTRA = ISLAND_RADIUS - WALK_RADIUS;      // 4 m Sand ragen über die Barriere hinaus (wie bisher 58-54)
const PIER_ANGLE = Math.atan2(PIER.x, (PIER.shoreZ + PIER.endZ) / 2); // ≈0.231 — Richtung des Hafens
const PIER_KEEP_ANG = 0.55;   // rad um den Steg: Küste bleibt komplett alt …
const PIER_BLEND_ANG = 0.4;   // … und blendet über diesen Winkel weich ins Umland
const BAY_ANGLE = -1.25;      // Bucht im Südwesten (atan2(x,z): -π/2 = Westen)
const BAY_HALF_ANG = 0.3;     // Breite der Bucht
const BAY_DEPTH = 16;         // m Küsten-Einschnitt (120 -> 104 in der Buchtmitte;
                              //   R21: 12 bei Küste 82 — der größere Radius braucht
                              //   mehr Tiefe, damit die Kurve weiter als Bucht liest)
// R23 Aufgabe B.2: ZWEITE, kleinere Bucht im Osten — der Klippen-/Felsbogen-POI
// (island/discover.js) stellt seine Felsen an ihren Rand. Sicher außerhalb der
// Hafen-Blende (PIER_ANGLE 0.231 + 0.55 + 0.4 = 1.18 < 2.05 - 0.25).
const BAY2_ANGLE = 2.05;      // Ost-Nordost
const BAY2_HALF_ANG = 0.25;   // schmaler als die Südwest-Bucht
const BAY2_DEPTH = 11;

function smooth01(v) {
  const k = Math.max(0, Math.min(1, v));
  return k * k * (3 - 2 * k);
}
function angDist(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}
// 1 direkt am Hafen-Sektor, 0 im freien Umland — teilen sich Küste UND Relief,
// damit die Hafen-Umgebung auch im Boden exakt so flach bleibt wie heute.
function pierKeep(theta) {
  return 1 - smooth01((angDist(theta, PIER_ANGLE) - PIER_KEEP_ANG) / PIER_BLEND_ANG);
}
// Begehbare Küstengrenze in Richtung (x, z).
export function coastWalkRadius(x, z) {
  const theta = Math.atan2(x, z);
  const bayK = 1 - smooth01(angDist(theta, BAY_ANGLE) / BAY_HALF_ANG);
  const bay2K = 1 - smooth01(angDist(theta, BAY2_ANGLE) / BAY2_HALF_ANG); // R23: Ost-Bucht
  const grow = (EXPLORE_RADIUS - WALK_RADIUS) - bayK * BAY_DEPTH - bay2K * BAY2_DEPTH;
  return WALK_RADIUS + (1 - pierKeep(theta)) * grow;
}

// Begehbarkeits-Check: Alt-Inselscheibe (unverändert, schneller Pfad — Sim!),
// Steg-Korridor, sonst die richtungsabhängige Umland-Küste (R21).
function isWalkable(x, z) {
  if (Math.hypot(x, z) <= WALK_RADIUS) return true;
  if (z > 0 && Math.abs(x - PIER.x) <= PIER.halfWidth && z <= PIER.endZ) return true;
  return Math.hypot(x, z) <= coastWalkRadius(x, z);
}

// Begehbarkeits-Grenze — mutiert pos in-place, jeden Frame aufgerufen.
// Mit prev (Spieler: letzte Position vor dem Frame-Move) wird achsweise gegen prev
// GESLIDET statt radial teleportiert (R13-Kritik #3: Seitensprung vom Steg).
// Ohne prev (Gegner): weicher Radial-Stopp, Steg-Nähe fängt auf die Planken.
export function clampToWalkable(pos, prev) {
  if (isWalkable(pos.x, pos.z)) return;
  if (prev && isWalkable(prev.x, prev.z)) {
    if (isWalkable(prev.x, pos.z)) { pos.x = prev.x; return; }
    if (isWalkable(pos.x, prev.z)) { pos.z = prev.z; return; }
    pos.x = prev.x;
    pos.z = prev.z;
    return;
  }
  if (pos.z > PIER.shoreZ && Math.abs(pos.x - PIER.x) <= PIER.halfWidth + 1.5) {
    pos.x = PIER.x + Math.max(-PIER.halfWidth, Math.min(PIER.halfWidth, pos.x - PIER.x));
    pos.z = Math.min(pos.z, PIER.endZ);
    return;
  }
  const r = Math.hypot(pos.x, pos.z);
  // R21: radial an die RICHTUNGSABHÄNGIGE Küste klemmen (im Hafen-Sektor ist das
  // exakt der alte WALK_RADIUS; die Richtung ändert sich beim Skalieren nicht,
  // der Zielradius bleibt also gültig). Erreichbar nur jenseits von isWalkable.
  const cr = coastWalkRadius(pos.x, pos.z);
  pos.x *= cr / r;
  pos.z *= cr / r;
}

// ---------- shared geo caches ----------

const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
  barrel: new THREE.CylinderGeometry(0.42, 0.42, 0.95, 12),
  frond: new THREE.ConeGeometry(0.22, 2.6, 5),
  pebble: new THREE.DodecahedronGeometry(1, 0),
  decal: new THREE.CircleGeometry(1, 10),
  awning: new THREE.PlaneGeometry(3, 1.8),
  islandCone: new THREE.ConeGeometry(30, 12, 10),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  barrelBand: new THREE.CylinderGeometry(0.45, 0.5, 0.9, 12),
  scrubPlane: new THREE.PlaneGeometry(0.6, 0.5),
  cloth: new THREE.PlaneGeometry(0.55, 0.7),
};

// ---------- ground height field ----------
// smooth deterministic noise, +-0.3 at full strength; ramps in from 0 inside
// the plaza (r<9) so combat stays on a flat physics floor while the outskirts roll
function groundNoise(x, z) {
  return (
    Math.sin(x * 0.14 + 1.7) * Math.sin(z * 0.11 + 0.4) * 0.55 +
    Math.sin(x * 0.31 - 0.8) * Math.sin(z * 0.27 + 2.1) * 0.3 +
    Math.sin((x + z) * 0.07) * 0.15
  );
}
// R21 Aufgabe C: Umland-Relief — beginnt ERST jenseits von OUTER_RELIEF_START und
// blendet über 8 m ein. Innerhalb (die ganze Alt-Insel inkl. Dorf, Kampfzone und
// Sim-Bewohner-Welt) kehrt groundY über den Early-Return BIT-EXAKT unverändert
// zurück — nicht mal ein "+ 0" fasst die alten Werte an. Der Hafen-Sektor bleibt
// über pierKeep() auch draußen flach (die Küste bleibt dort ohnehin alt).
// Bestandteile: sanfte Außendünen (roll, leicht angehoben, nie unter Wasserlinie)
// und die Anhöhe im Nordwesten (HILL) als begehbarer Blickfang (~15 % Steigung).
const OUTER_RELIEF_START = 56;
const HILL = { x: -46, z: -40, h: 3.4, sigma: 13 };
// R23 Aufgabe B.2: der AUSSICHTSPUNKT — ein zweiter, deutlich höherer Hügel weit
// draußen im Nordwesten (r ≈ 100). Von seiner Kuppe aus liegt die GANZE Insel im
// Blick (Felix' Kernsatz „so groß ist die Welt"); die Plattform baut discover.js.
// Steigung ~7.5/18σ liegt unter der Anhöhen-Rampe — begehbar ohne Sprung.
// Wie HILL wirkt er nur hinter dem groundY-Early-Return (r>56): am 56er-Ring ist
// sein Gauß-Beitrag < 0.4 m und vom gate/keep-Faktor zusätzlich gedämpft.
export const HILL2 = { x: -72, z: -68, h: 7.5, sigma: 18 };
function outerRelief(x, z, r) {
  const gate = smooth01((r - OUTER_RELIEF_START) / 8);
  const keep = pierKeep(Math.atan2(x, z));
  const roll =
    Math.sin(x * 0.05 + 2.1) * Math.sin(z * 0.055 - 1.4) * 0.8 +
    Math.sin((x - z) * 0.03) * 0.35;
  const hx = x - HILL.x;
  const hz = z - HILL.z;
  const hill = Math.exp(-(hx * hx + hz * hz) / (2 * HILL.sigma * HILL.sigma)) * HILL.h;
  const h2x = x - HILL2.x;
  const h2z = z - HILL2.z;
  const hill2 = Math.exp(-(h2x * h2x + h2z * h2z) / (2 * HILL2.sigma * HILL2.sigma)) * HILL2.h;
  return gate * (1 - keep) * (roll * 0.7 + 0.4 + hill + hill2);
}

function groundY(x, z) {
  const r = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, (r - 9) / 11));
  const ramp = t * t * (3 - 2 * t); // smoothstep
  const y = groundNoise(x, z) * 0.3 * ramp;
  return r <= OUTER_RELIEF_START ? y : y + outerRelief(x, z, r);
}

// Physik-Bodenhöhe (R13-Kritik #2): Spieler/Gegner/Kai stehen auf dem Relief
// statt auf y=0; im Steg-Korridor gilt die Plankenhöhe (Sand dort max. +0.02).
export function groundHeightAt(x, z) {
  if (z >= PIER.shoreZ - 2 && z <= PIER.endZ && Math.abs(x - PIER.x) <= PIER.halfWidth + 0.3) {
    return PIER.deckY;
  }
  return groundY(x, z);
}

// Radialer Farbverlauf für den gebackenen Laternen-Lichtteppich (R15) — ersetzt die
// Streuwirkung eines PointLight als billige Boden-Textur statt eines Lichts, das
// three.js in JEDEM Fragment JEDES MeshStandardMaterial mitrechnen müsste.
// R15b (Blindvergleich-Reparatur): Der Falloff liegt jetzt in den RGB-Kanälen
// (Alpha konstant 1), weil das Material auf DstColor-Blending umgestellt ist
// (siehe mats.lampGlow) — dort zählt nur noch RGB, und Schwarz am Rand heißt
// exakt „kein Beitrag". Der Warmton (255,208,140 im Zentrum) liegt nahe an der
// ersetzten PointLight-Farbe 0xffc070; die Stopp-Faktoren 1/0.72/0.36/0.12/0
// sind die relativen Alphas des alten Verlaufs, folgen also weiter grob der
// 1/d²-Abnahme des Originals (siehe Kommentar in lampPost).
function lampGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const s = 128;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgb(255,208,140)');
  g.addColorStop(0.3, 'rgb(184,150,101)');
  g.addColorStop(0.6, 'rgb(92,75,50)');
  g.addColorStop(0.85, 'rgb(31,25,17)');
  g.addColorStop(1, 'rgb(0,0,0)');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createArena(scene) {
  const obstacles = []; // {x, z, radius, topY?} — cylindrical colliders; topY = standable top-surface height (omitted = not standable)
  // warm haze that starts inside the playfield so mid-distance
  // buildings (20-36m) pick up visible atmosphere
  // R22 Aufgabe A.2: heller und goldener statt staubig-rosa — "goldene Stunde"
  // statt Wüste (vorher 0xe0a882). Der eigentliche Tiefen-Fog ist seit jeher der
  // FogExp2 in main.js (überschreibt scene.fog nach createArena) — hier zählt
  // vor allem scene.background als Horizontton.
  const fogColor = new THREE.Color(0xecc19b);

  scene.fog = new THREE.Fog(fogColor, 20, 70);
  scene.background = fogColor;

  // ---- lighting ----
  // raised pink/amber hemisphere bounce keeps shadow interiors warm, not grey
  const hemi = new THREE.HemisphereLight(0xd9a8c0, 0xc08055, 0.85);
  scene.add(hemi);

  // lower, softer sun: less intensity, warmer color, soft-edged shadows
  const sun = new THREE.DirectionalLight(0xffc98e, 1.9);
  sun.position.set(-55, 30, -40);
  sun.castShadow = true;
  // R15: 1024 wurde nach dem Blindvergleich ZURÜCKGENOMMEN. Zwei unabhängige
  // blinde Kritiker haben je 4 von 4 entschiedenen Posen gegen den optimierten
  // Stand entschieden, mit identischem Fehlerbild: harte Zeilenstreifen (Shadow
  // Acne) auf den Pflasterflächen, weggefallene Kontaktschatten unter
  // Grasbüscheln und Füßen, verschwundener Palmen-Schlagschatten. Ursache: bias
  // (-0.0008) und normalBias (0.02) sind für 7,8 cm/Texel abgestimmt; bei
  // 14,8 cm/Texel reichen sie nicht, und der frühere radius=4 unter PCFSoft
  // hatte den Rest kaschiert. Alles unter einer Texelbreite fällt weg.
  // Der Tausch lohnt ohnehin nicht: der Schattenpass maß 2,88 ms von 27 ms GPU
  // (8,8 %), die Kartenhalbierung holt davon einen Bruchteil — während der
  // eigentliche Posten (5 PointLights, 10,65 ms) über das Decal erledigt ist.
  // Frustum bleibt ±76: 152 m / 2048 ≈ 7,4 cm/Texel, etwas feiner als der alte
  // Bestand (160 m / 2048 ≈ 7,8 cm/Texel) — der Bias passt damit wieder.
  // Frustum ±80 -> ±76: sun.target bleibt am Weltursprung, und der am
  // weitesten entfernte Schattenwerfer (Ruderboot-Rumpf am Stegende, Zentrum
  // x=18.3/z=68, Radius bis zu ~2.6) liegt ≈73 m vom Ursprung entfernt — jede
  // Kugel um den Ursprung mit Radius ≤76 passt bei JEDER Rotation der Schattenkamera
  // vollständig ins Ortho-Frustum (Skalarprodukt mit Einheitsachsen kann die
  // Kugeldistanz nicht überschreiten), die Verkleinerung ist also unabhängig von der
  // Lichtrichtung sicher, nicht nur an dieser einen Kamerapose geprüft. Texel-Dichte:
  // 152 m / 1024 ≈ 14,8 cm/Texel (Bestand 160 m / 2048 ≈ 7,8 cm/Texel) — sichtbar
  // gröbere Schattenkanten, siehe Bericht.
  sun.shadow.mapSize.set(2048, 2048);
  // R16: radius = 4 ist zurück, weil main.js wieder PCFSoftShadowMap fährt
  // (Begründung dort). Unter ?pcf (Messhebel) wird radius von three still
  // ignoriert — genau das war in R15 der unbemerkte Look-Verlust.
  sun.shadow.radius = 4;
  sun.shadow.camera.left = -76;
  sun.shadow.camera.right = 76;
  sun.shadow.camera.top = 76;
  sun.shadow.camera.bottom = -76;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0xa088b0, 0.4); // dusty mauve counter-light
  fill.position.set(40, 25, 50);
  scene.add(fill);

  // ---- sky dome + sun disc ----
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 24, 16), skyMat);
  scene.add(sky);

  // sun disc aligned with the directional light azimuth, plus a wide
  // additive halo behind it — cheap layered sunset glow
  const sunDir = new THREE.Vector3(-160, 62, -117).normalize();
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunHaloSprite(), fog: false, depthWrite: false, transparent: true,
    blending: THREE.AdditiveBlending,
  }));
  sunHalo.position.copy(sunDir).multiplyScalar(300);
  sunHalo.scale.setScalar(520);
  scene.add(sunHalo);

  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunSprite(), fog: false, depthWrite: false, transparent: true,
    blending: THREE.AdditiveBlending,
  }));
  sunDisc.position.copy(sunDir).multiplyScalar(300);
  sunDisc.scale.setScalar(240);
  scene.add(sunDisc);

  // ---- underlit cloud streaks near the horizon ----
  {
    const cloudDefs = [
      { a: -2.6, r: 320, w: 220, h: 14, y: 70, o: 0.55 },
      { a: -1.7, r: 380, w: 180, h: 12, y: 95, o: 0.4 },
      { a: -0.6, r: 260, w: 150, h: 16, y: 58, o: 0.6 },
      { a: 0.9, r: 340, w: 200, h: 10, y: 110, o: 0.35 },
      { a: 2.3, r: 300, w: 140, h: 13, y: 80, o: 0.45 },
    ];
    for (const c of cloudDefs) {
      const mat = new THREE.MeshBasicMaterial({
        map: cloudStreakTexture(), transparent: true, opacity: c.o,
        fog: false, depthWrite: false, side: THREE.DoubleSide,
      });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h), mat);
      strip.position.set(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r);
      strip.lookAt(0, c.y, 0); // face the arena center
      scene.add(strip);
    }
  }

  // ---- distant island silhouettes (fill the horizon) ----
  // colors hand-lerped toward the sky per depth band so ridges read as
  // progressively hazier layers instead of hard cutouts
  const islandDefs = [
    { a: -2.35, r: 300, sx: 1.4, sy: 1.0, color: 0xdfa896 },
    { a: -1.1, r: 360, sx: 2.2, sy: 0.7, color: 0xe7b4a2 },
    { a: 0.6, r: 320, sx: 1.0, sy: 1.2, color: 0xdfa896 },
    { a: 2.0, r: 380, sx: 1.8, sy: 0.6, color: 0xefc2ae },
    // ultra-far ridge row — third depth band, nearly dissolved into the sky
    { a: -1.8, r: 430, sx: 2.6, sy: 0.55, color: 0xf0c6b2 },
    { a: 1.3, r: 430, sx: 2.0, sy: 0.7, color: 0xf0c6b2 },
    { a: 2.9, r: 430, sx: 2.4, sy: 0.5, color: 0xf0c6b2 },
  ];
  const islandMats = {};
  for (const d of islandDefs) {
    islandMats[d.color] ??= new THREE.MeshBasicMaterial({ color: d.color, fog: false });
    const isl = new THREE.Mesh(geo.islandCone, islandMats[d.color]);
    isl.position.set(Math.cos(d.a) * d.r, -2, Math.sin(d.a) * d.r);
    isl.scale.set(d.sx, d.sy, d.sx * 0.7);
    scene.add(isl);
  }

  // ---- layered horizon silhouettes (close the skyline) ----
  // two depth tints: near ridge row darker, far row hazier — stacked between
  // the shoreline and the existing ultra-far pink islands
  {
    const silDefs = [
      { a: -2.9, r: 265, sx: 1.6, sy: 1.4, near: true },
      { a: -0.2, r: 255, sx: 1.2, sy: 1.8, near: true },
      { a: 1.55, r: 285, sx: 2.0, sy: 1.1, near: true },
      { a: -2.0, r: 350, sx: 2.4, sy: 0.9, near: false },
      { a: -0.9, r: 395, sx: 1.8, sy: 1.2, near: false },
      { a: 0.35, r: 370, sx: 2.8, sy: 0.8, near: false },
      { a: 2.5, r: 340, sx: 2.2, sy: 1.0, near: false },
      { a: 3.05, r: 400, sx: 1.5, sy: 1.3, near: false },
    ];
    const silNearMat = new THREE.MeshBasicMaterial({ color: 0x8a5f52, fog: false });
    const silFarMat = new THREE.MeshBasicMaterial({ color: 0xb08a86, fog: false });
    for (const d of silDefs) {
      const sil = new THREE.Mesh(geo.islandCone, d.near ? silNearMat : silFarMat);
      sil.position.set(Math.cos(d.a) * d.r, -2, Math.sin(d.a) * d.r);
      sil.scale.set(d.sx, d.sy, d.sx * 0.7);
      scene.add(sil);
    }
  }

  // ---- ocean ----
  const waveTex = waveTexture();
  waveTex.repeat.set(10, 10);
  // R22 Aufgabe A.2: Lagunen-Türkis statt Rosé-Grau (vorher 0xc2aeb0) — die
  // waveTexture ist ohnehin teal (#2b6d86), der Materialton multipliziert nur;
  // der Sonnenglanz bleibt über roughness/metalness erhalten. Das Flachwasser
  // an der Küste (besonders in der R21-Bucht) legt island/flair.js als eigene
  // Lagunen-Ringe darüber.
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x9fd0c4, map: waveTex, roughness: 0.35, metalness: 0.25,
  });
  const ocean = new THREE.Mesh(new THREE.CircleGeometry(470, 48), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.7;
  scene.add(ocean);

  // ---- shoreline foam ring ----
  const foamMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false,
  });
  // R21: der Schaumring folgt der neuen Küste — jeder Vertex wird radial an
  // sandEdge (begehbare Grenze + Sandsaum) verschoben. Ring liegt in XY und wird
  // flach gedreht: (x, y) -> Welt (x, z=-y), wie bei der Deckfläche unten.
  const sandEdge = (x, z) => coastWalkRadius(x, z) + SAND_EXTRA;
  // R23: 128 -> 192 Segmente — der Ring liegt jetzt bei r ~124 statt ~86, mit der
  // alten Teilung würden die Buchtkurven sichtbar facettieren (Auftrag B.1).
  const foamGeo = new THREE.RingGeometry(ISLAND_RADIUS + 1, ISLAND_RADIUS + 3.5, 192);
  {
    const fp = foamGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i);
      const zW = -fp.getY(i);
      const r0 = Math.hypot(x, zW);
      const nr = sandEdge(x, zW) + (r0 - ISLAND_RADIUS); // +1 .. +3.5 über die jeweilige Sandkante
      const s = nr / r0;
      fp.setX(i, x * s);
      fp.setY(i, -zW * s);
    }
  }
  const foam = new THREE.Mesh(foamGeo, foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.y = -0.62;
  scene.add(foam);

  // ---- island ground ----
  // R13: RingGeometry mit echten Innen-Ringen statt Zylinder-Deckel-Fächer —
  // die Oberfläche folgt groundY jetzt ÜBERALL, damit Wege/Props/AO sauber aufliegen
  const sandTex = sandTexture();
  sandTex.repeat.set(7, 7);
  const groundMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1.0 });
  {
    // R21: die Deckfläche wächst mit der Küste. Vertices innerhalb von TOP_BLEND_R
    // bleiben EXAKT wo sie waren (Dorf/Kampfzone unangetastet); der Bereich
    // TOP_BLEND_R..ISLAND_RADIUS wird radial auf TOP_BLEND_R..sandEdge(θ) gestreckt.
    // Mehr Segmente als vorher (128/40 statt 96/24), damit Umland-Relief und
    // Buchtkurve nicht facettieren; die Textur (repeat 7) streckt am Rand moderat.
    const TOP_BLEND_R = 48;
    // R23: 128/40 -> 160/56 Segmente — der gestreckte Außenbereich (48..58 wird
    // radial auf 48..~124 gezogen) braucht mehr Auflösung für Relief + Buchten.
    // Die Sand-Textur (repeat 7) streckt am Rand entsprechend stärker; dort liegt
    // inzwischen fast überall Grüngürtel/Wiese darüber (flair.js) — dokumentiert.
    const topGeo = new THREE.RingGeometry(0.01, ISLAND_RADIUS, 160, 56);
    const pos = topGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // Ring liegt in XY, wird gleich flach gedreht: (x, y)->Welt (x, z)
      let x = pos.getX(i), z = -pos.getY(i);
      const r0 = Math.hypot(x, z);
      if (r0 > TOP_BLEND_R) {
        const edge = sandEdge(x, z);
        const nr = TOP_BLEND_R + ((r0 - TOP_BLEND_R) / (ISLAND_RADIUS - TOP_BLEND_R)) * (edge - TOP_BLEND_R);
        const s = nr / r0;
        x *= s;
        z *= s;
        pos.setX(i, x);
        pos.setY(i, -z);
      }
      pos.setZ(i, groundY(x, z));
    }
    topGeo.computeVertexNormals();
    const top = new THREE.Mesh(topGeo, groundMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    scene.add(top);

    // Strandböschung: offener Kegelstumpf von der Sandkante unter die Wasserlinie —
    // R21: jeder Vertex radial an die jeweilige Sandkante (oben -0.3, unten +4 wie bisher)
    const skirtGeo = new THREE.CylinderGeometry(ISLAND_RADIUS - 0.3, ISLAND_RADIUS + 4, 1.4, 160, 1, true); // R23: 128 -> 160, wie die Deckfläche
    const sp = skirtGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x0 = sp.getX(i);
      const z0 = sp.getZ(i);
      const r0 = Math.hypot(x0, z0);
      const nr = sandEdge(x0, z0) + (r0 - ISLAND_RADIUS);
      const s = nr / r0;
      sp.setX(i, x0 * s);
      sp.setZ(i, z0 * s);
      if (sp.getY(i) > 0.65) {
        sp.setY(i, sp.getY(i) + groundY(x0 * s, z0 * s) - 0.03); // minimal unter der Deckfläche — Naht versteckt
      }
    }
    skirtGeo.computeVertexNormals();
    const skirt = new THREE.Mesh(skirtGeo, groundMat);
    skirt.position.y = -0.7;
    skirt.receiveShadow = true;
    scene.add(skirt);
  }

  // ---- low dune mounds — height variation between plaza and coast ----
  {
    const duneSpots = [
      [-6, 18], [18, -12], [-16, 14], [10, 22],
      [-22, -8], [24, -6], [-14, -18], [28, 22],
      // Außenring der größeren Insel
      [-38, 30], [42, 12], [-46, -10], [30, -42], [-20, -46], [46, -28],
      // R23: ferner Ring im neuen Umland (alle geprüft: r deutlich unter der
      // richtungsabhängigen Küste, keiner im Hafen-Sektor)
      [-70, 48], [78, -26], [-34, -88], [10, -100], [-95, -20], [70, 30],
    ];
    for (let i = 0; i < duneSpots.length; i++) {
      const [dx, dz] = duneSpots[i];
      const r = 5 + Math.random() * 4;
      // color jittered around 0xd8b97f / 0xcfae72
      const base = i % 2 === 0 ? [0xd8, 0xb9, 0x7f] : [0xcf, 0xae, 0x72];
      const j = (Math.random() - 0.5) * 18 | 0;
      const duneMat = new THREE.MeshStandardMaterial({
        color: (base[0] + j << 16) | (base[1] + j << 8) | (base[2] + j),
        roughness: 1.0,
      });
      const dune = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), duneMat);
      dune.scale.y = 0.12;
      dune.position.set(dx, groundY(dx, dz) - 0.08, dz);
      dune.rotation.y = Math.random() * Math.PI * 2;
      dune.receiveShadow = true;
      scene.add(dune);
    }
  }

  // ---- materials (geteilt mit den Insel-Modulen) ----
  const mats = {
    wallA: new THREE.MeshStandardMaterial({ map: plasterTexture('#e6d8bc'), roughness: 0.95 }),
    wallB: new THREE.MeshStandardMaterial({ map: plasterTexture('#d9c0a0'), roughness: 0.95 }),
    wallC: new THREE.MeshStandardMaterial({ map: plasterTexture('#cbb493'), roughness: 0.95 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xa8542f, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.9 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1.0 }),
    frond: new THREE.MeshStandardMaterial({ color: 0x3f7a38, roughness: 0.9 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xa2948a, roughness: 1.0 }),
    stoneBlock: new THREE.MeshStandardMaterial({ map: stoneBlockTexture(), roughness: 1.0 }),
    awning: new THREE.MeshStandardMaterial({
      map: awningTexture(), side: THREE.DoubleSide, roughness: 0.95,
    }),
    win: new THREE.MeshStandardMaterial({ color: 0x3a3d58, roughness: 0.4, metalness: 0.3 }),
    barrel: new THREE.MeshStandardMaterial({ map: barrelTexture(), roughness: 0.9 }),
    shutter: new THREE.MeshStandardMaterial({ color: 0x4a6a52, roughness: 0.9 }),  // Fensterläden
    rope: new THREE.MeshStandardMaterial({ color: 0xb0985f, roughness: 1.0 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6, metalness: 0.4 }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), // warmer Glühpunkt — Bloom-Akzent
    // R15: Boden-Decal statt PointLight-Streulicht (siehe lampPost) —
    // ein Draw-Call für alle Laternen statt eines Lichts im Shader jedes Objekts.
    // R15b hatte hier DstColor-Blending (out = dst·(1+glow)) eingebaut, weil
    // Addition unabhängig von Schatten und Albedo wirkt: der Boden leuchtete im
    // Hausschatten, graues Pflaster wurde heller als besonnter Sand (140 gegen
    // 108 — physikalisch falsch, vorher korrekt 89 gegen 103). Die Helligkeit
    // stimmte damit messbar wieder (Boden-Mittelwerte ±1..4 statt +15..24
    // Stufen gegen den Vorher-Stand), aber der Blindvergleich fiel trotzdem
    // durch: Kritiker 1 fand in allen 4 Posen einen orangen Ring am
    // Laternenfuß, der nur auf der DstColor-Seite existiert. ZURÜCKGESTELLT
    // auf additiv — die Wahl zwischen 10,65 ms PointLights und einem der
    // beiden Decal-Kompromisse trifft Felix (siehe RUNDE15-STAND.md).
    // Der Falloff liegt seit R15b in den RGB-Kanälen (Alpha konstant 1,
    // lampGlowTexture): unter AdditiveBlending ist out = src + dst, Schwarz am
    // Rand heißt also weiter exakt „kein Beitrag" — die Textur passt für beide
    // Blendings, nur die Wirkung im Schatten unterscheidet sich.
    // Felix' Playtest 13.08.: „Tag, warm — die Lampen leuchten so extrem,
    // bisschen unnötig." Entscheidung gefallen: additiv bleibt, aber auf ~30 %
    // gedimmt. opacity skaliert unter AdditiveBlending den ganzen Beitrag
    // (out = opacity·src + dst) — ein Regler statt fünf neuer Gradient-Stops.
    // Löst zugleich den Kern des Blindbefunds: was kaum noch aufaddiert, kann
    // Pflaster nicht mehr über besonnten Sand heben.
    lampGlow: new THREE.MeshBasicMaterial({
      map: lampGlowTexture(), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending, opacity: 0.3,
      polygonOffset: true, polygonOffsetFactor: -2,
    }),
  };

  function addShadow(m) {
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // contact-AO spots collected during prop placement, instanced at the end
  const aoSpots = []; // {x, z, r} — r = footprint * 0.65
  function addAO(x, z, footprint) {
    aoSpots.push({ x, z, r: footprint * 0.65 });
  }

  // Laternen-Lichtteppich, gesammelt während des Aufbaus, am Ende zu einem einzigen
  // InstancedMesh zusammengefasst (siehe lampPost).
  const lampGlowSpots = []; // {x, z}

  // Laterne — Dorfplatz, Dorfrand und Hafen teilen sie. baseY hebt die Laterne auf
  // erhöhte Flächen (Steg-Deck).
  //
  // R15: Das frühere PointLight (0xffc070, intensity 6, distance 12, decay 2) ist
  // raus. Gemessen kosteten die 5 PointLights der Insel 10,65 ms / 33,5% der
  // GPU-Zeit — mehr als Bloom (5,0 ms) und Schatten (2,88 ms) zusammen, siehe
  // RUNDE15-MESSUNG.md. Grund: three.js rendert vorwärts, jedes Fragment jedes
  // MeshStandardMaterial wertet JEDES Licht aus, unabhängig von der Entfernung — bei
  // ~680 Draw-Calls ist das der teuerste Posten im Fragment-Shader. `distance: 12`
  // begrenzte nur die Reichweite, nicht die Rechenarbeit.
  // Der sichtbare Glühpunkt bleibt unverändert ein eigenes MeshBasicMaterial-Mesh
  // (mats.bulb) und wird weiter vom Bloom-Pass aufgeblasen — nur der Streuschein auf
  // Sand (und, wo eine Laterne dicht an einer Hauswand steht, auf der Wand) kommt
  // jetzt aus einem gebackenen Boden-Decal (lampGlowTexture, DstColor-Blending —
  // seit R15b multiplikativ statt additiv, siehe mats.lampGlow) statt aus
  // einem Echtzeit-Licht. Bei Bulbhöhe ~3.2m und der obigen Formel liegt die reale
  // PointLight-Aufhellung direkt unter der Lampe bei ~0,58 (physikalische Einheit),
  // fällt bis r=4m auf ~37% davon und bei r=6m auf ~18% — das Decal bildet diese
  // Kurve nach (siehe lampGlowTexture-Gradient und GLOW_RADIUS unten). Verlust:
  // die Wandkomponente an den beiden Dorfplatz-Laternen entfällt, weil ein
  // Boden-Decal keine vertikale Fläche erreicht — siehe Bericht.
  function lampPost(x, z, baseY = 0) {
    const pole = addShadow(new THREE.Mesh(geo.cylinder, mats.wood));
    pole.scale.set(0.09, 3.2, 0.09);
    pole.position.set(x, baseY + 1.6, z);
    scene.add(pole);
    const bulb = new THREE.Mesh(geo.sphere, mats.bulb);
    bulb.scale.setScalar(0.25);
    bulb.position.set(x, baseY + 3.3, z);
    scene.add(bulb);
    lampGlowSpots.push({ x, z });
    addAO(x, z, 0.7);
    obstacles.push({ x, z, radius: 0.25 });
  }

  // ---- ground scatter: pebbles + dark sand decals (über die ganze Insel) ----
  {
    const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x9a8a70, roughness: 1.0 });
    const PEBBLES = 240;
    const pebbles = new THREE.InstancedMesh(geo.pebble, pebbleMat, PEBBLES);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < PEBBLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (WALK_RADIUS + 1);
      const s = 0.05 + Math.random() * 0.15;
      e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      q.setFromEuler(e);
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      m4.compose(
        new THREE.Vector3(px, groundY(px, pz) + s * 0.4, pz),
        q,
        new THREE.Vector3(s, s * 0.7, s)
      );
      pebbles.setMatrixAt(i, m4);
    }
    pebbles.receiveShadow = true;
    scene.add(pebbles);

    // large tonal-variation decals: rgba(90,70,45) at low opacity breaks the tiling
    const decalMat = new THREE.MeshStandardMaterial({
      color: 0x5a462d, transparent: true, opacity: 0.13,
      depthWrite: false, roughness: 1.0,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    const DECALS = 150;
    const decals = new THREE.InstancedMesh(geo.decal, decalMat, DECALS);
    for (let i = 0; i < DECALS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (WALK_RADIUS - 2);
      const s = 1.5 + Math.random() * 2.5;
      e.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      q.setFromEuler(e);
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      m4.compose(
        new THREE.Vector3(px, groundY(px, pz) + 0.02, pz),
        q,
        new THREE.Vector3(s, s * (0.5 + Math.random() * 0.5), 1)
      );
      decals.setMatrixAt(i, m4);
    }
    scene.add(decals);
  }

  // ---- Insel-Module: Dorf, Hafen, Vegetation ----
  const ctx = {
    scene, obstacles, geo, mats, groundY, addShadow, addAO, lampPost,
    stoneTileTexture, PIER, WALK_RADIUS,
    groundHeightAt, clampToWalkable, // die Bewohner laufen auf demselben Boden wie alle
    coastWalkRadius, // R22: flair.js legt Lagunen-Ringe an die richtungsabhängige Küste
    updaters: [], // pro-Frame-Hooks der Module (Boot-Dümpeln, Wäsche-Wehen, Palmen-Sway)
  };
  buildVillage(ctx);   // setzt ctx.pathDefs/ctx.pathWidth/ctx.doorSpots
  buildHarbor(ctx);
  buildVegetation(ctx);
  // Bewohner zuletzt: sie brauchen das vollständige obstacles-Array, das Wegenetz
  // und die Türliste. ?novillagers überspringt den Aufbau komplett (kein Mesh, kein
  // Updater) — das ist die Messgrundlage für den A/B-Frametime-Vergleich; der Stub
  // hält main.js frei von Null-Checks.
  // Baukontrolle GENAU hier: obstacles hat jetzt denselben Stand, den villagers.js
  // gleich als Kollider-Vorfilter einfriert. Sie warnt nur, blockiert nichts.
  checkPathsClear(ctx.pathDefs, obstacles,
    ['Hafenweg', 'Turmweg', 'Westweg', 'Ostweg', 'Nordwestweg']);
  const skipVillagers = typeof location !== 'undefined'
    && new URLSearchParams(location.search).has('novillagers');
  const villagers = skipVillagers
    ? { count: 0, flee() {}, returnHome() {}, reset() {} }
    : buildVillagers(ctx);
  const { updaters } = ctx;

  // ---- beach rocks (aufgelockert am Strandsaum, Steg-Korridor bleibt frei) ----
  // R15: kein castShadow mehr — 16 Einzel-Meshes am Ufersaum waren 16 eigene
  // Schatten-Draw-Calls (der Schattenpass allein ist 282 der 555 Draw-Calls, siehe
  // RUNDE15-MESSUNG.md); der Eigenschatten kleiner Ufersteine fällt im Spiel niemandem
  // auf. receiveShadow bleibt, damit Gebäude-/Palmenschatten weiter auf sie fallen.
  for (let i = 0; i < 24; i++) { // R23: 16 -> 24 — der Ufersaum ist ~50 % länger
    const a = (i / 24) * Math.PI * 2 + 0.3;
    // R21: die Ufersteine liegen am JEWEILIGEN Ufersaum — im Hafen-Sektor ist
    // coastWalkRadius exakt der alte WALK_RADIUS, dort ändert sich nichts.
    const r = coastWalkRadius(Math.cos(a), Math.sin(a)) + 0.5 + Math.random() * 3;
    const rx = Math.cos(a) * r, rz = Math.sin(a) * r;
    if (rz > 40 && Math.abs(rx - PIER.x) < 9) continue; // freie Sicht auf Steg + Boot
    const rock = new THREE.Mesh(geo.pebble, mats.stone);
    rock.receiveShadow = true;
    const s = 0.8 + Math.random() * 1.6;
    rock.scale.set(s * (0.8 + Math.random() * 0.6), s * 0.7, s);
    rock.position.set(rx, groundY(rx, rz) + s * 0.2, rz);
    rock.rotation.set(Math.random(), Math.random() * 6, Math.random());
    scene.add(rock);
  }

  // ---- R21 Aufgabe C: das Umland — Palmen, Felsen, Buschwerk, zwei Wege ----
  // Alles hier lebt NUR im Spiel (createArena läuft nie in der Sim) und liegt
  // jenseits des alten WALK_RADIUS. Kein castShadow: das Schattenkamera-Frustum
  // (±76, Kommentar R13/R15 oben) bleibt unangetastet, und der Schattenpass
  // bekommt keinen einzigen neuen Draw-Call (R15-Muster der Ufersteine).
  // Instanziert, wo es geht: Stämme, Wedel, Felsen, Büschel, Wegplatten sind je
  // EIN Draw-Call — der Messlauf (perf.js) belegt die Kosten im STAND.
  {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v3 = new THREE.Vector3();
    const sc = new THREE.Vector3();

    // Zufallspunkt im Umland-Ring (zwischen Alt-Küste und neuer Küste), per
    // Rejection außerhalb des Hafen-Sektors (dort gibt es kein Umland).
    function outerSpot(margin) {
      for (let tries = 0; tries < 40; tries++) {
        const a = Math.random() * Math.PI * 2;
        const dx = Math.sin(a), dz = Math.cos(a);
        const cr = coastWalkRadius(dx, dz);
        if (cr < WALK_RADIUS + 8) continue; // Hafen-Sektor/Blende — zu schmal
        const r = WALK_RADIUS + 3 + Math.random() * (cr - WALK_RADIUS - 3 - margin);
        return { x: dx * r, z: dz * r };
      }
      return null;
    }

    // -- Palmen: 15 Stück (R23: 9 -> 15, die Ringfläche hat sich ~verdreifacht),
    //    Stämme + Wedel als je ein InstancedMesh --
    const palmSpots = [];
    for (let i = 0; i < 15; i++) {
      const s = outerSpot(4);
      if (s) palmSpots.push(s);
    }
    const FRONDS_PER = 6;
    const trunks = new THREE.InstancedMesh(geo.cylinder, mats.trunk, palmSpots.length);
    const fronds = new THREE.InstancedMesh(geo.frond, mats.frond, palmSpots.length * FRONDS_PER);
    let fi = 0;
    for (let i = 0; i < palmSpots.length; i++) {
      const p = palmSpots[i];
      const gy = groundY(p.x, p.z);
      const h = 3.6 + Math.random() * 1.6;
      const leanA = Math.random() * Math.PI * 2;
      const lean = 0.08 + Math.random() * 0.1;
      e.set(Math.cos(leanA) * lean, 0, Math.sin(leanA) * lean, 'YXZ');
      q.setFromEuler(e);
      m4.compose(v3.set(p.x, gy + h * 0.5, p.z), q, sc.set(0.14, h, 0.14));
      trunks.setMatrixAt(i, m4);
      obstacles.push({ x: p.x, z: p.z, radius: 0.32 }); // Stamm kollidiert wie eine Laterne
      addAO(p.x, p.z, 1.4);
      // Krone: Wedel fächern radial, nach außen gekippt, leicht überhängend
      const topX = p.x + Math.sin(leanA) * lean * h * 0.5;
      const topZ = p.z + Math.cos(leanA) * lean * h * 0.5;
      for (let f = 0; f < FRONDS_PER; f++) {
        const fa = (f / FRONDS_PER) * Math.PI * 2 + Math.random() * 0.5;
        e.set(1.15 + Math.random() * 0.25, fa, 0, 'YXZ'); // erst Gier, dann Kippen nach außen
        q.setFromEuler(e);
        m4.compose(
          v3.set(topX + Math.sin(fa) * 0.85, gy + h + 0.15, topZ + Math.cos(fa) * 0.85),
          q,
          sc.set(1.1, 1.05, 1.1),
        );
        fronds.setMatrixAt(fi++, m4);
      }
    }
    fronds.count = fi;
    trunks.receiveShadow = true;
    scene.add(trunks);
    scene.add(fronds);

    // -- Felsen: 42 verstreute Brocken (R23: 26 -> 42), dichter zur Küste hin --
    const ROCKS = 42;
    const rocks = new THREE.InstancedMesh(geo.pebble, mats.stone, ROCKS);
    let ri = 0;
    for (let i = 0; i < ROCKS; i++) {
      const s = outerSpot(1);
      if (!s) continue;
      const sz = 0.5 + Math.random() * 1.5;
      e.set(Math.random(), Math.random() * 6, Math.random());
      q.setFromEuler(e);
      m4.compose(
        v3.set(s.x, groundY(s.x, s.z) + sz * 0.25, s.z),
        q,
        sc.set(sz * (0.8 + Math.random() * 0.6), sz * 0.7, sz),
      );
      rocks.setMatrixAt(ri++, m4);
      if (sz > 1.2) obstacles.push({ x: s.x, z: s.z, radius: sz * 0.8, topY: groundY(s.x, s.z) + sz * 0.6 });
    }
    rocks.count = ri;
    rocks.receiveShadow = true;
    scene.add(rocks);

    // -- Buschwerk: 220 Büschel (R23: 110 -> 220), Vegetation dichter am Rand --
    const TUFTS = 220;
    const tufts = new THREE.InstancedMesh(geo.frond, mats.frond, TUFTS);
    let ti = 0;
    for (let i = 0; i < TUFTS; i++) {
      const s = outerSpot(0);
      if (!s) continue;
      const sz = 0.12 + Math.random() * 0.16;
      e.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5);
      q.setFromEuler(e);
      m4.compose(v3.set(s.x, groundY(s.x, s.z) + sz * 1.1, s.z), q, sc.set(sz * 2.2, sz, sz * 2.2));
      tufts.setMatrixAt(ti++, m4);
    }
    tufts.count = ti;
    scene.add(tufts);

    // -- Zwei Umland-Wege: dunkle Trittspur-Decals in Reihe (kein Eingriff in
    //    village.js' Wegenetz — die Spuren beginnen sichtbar nahe der Alt-Küste) --
    //    Weg 1: Nordwesten, vom Inselrand hinauf zur Anhöhe (HILL).
    //    Weg 2: Westen, vom Rand hinab in die Bucht (BAY_ANGLE).
    const trailPts = [];
    function addTrail(x0, z0, x1, z1, steps, wobble) {
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        const wx = x0 + (x1 - x0) * k + Math.sin(k * 9.7) * wobble;
        const wz = z0 + (z1 - z0) * k + Math.cos(k * 7.3) * wobble;
        trailPts.push({ x: wx, z: wz });
      }
    }
    addTrail(-34, -26, HILL.x, HILL.z, 13, 1.2);       // zur Anhöhe
    // R23: die Bucht liegt mit EXPLORE_RADIUS 120 weiter draußen (~r 98) — die
    // Spur führt jetzt bis an ihren Strand; den Rundweg über die neuen Orte
    // legt island/discover.js als Fortsetzung an.
    addTrail(-36, 14, -93, 31, 22, 1.4);               // zur Bucht (θ≈-1.25)
    const trailMat = new THREE.MeshStandardMaterial({
      color: 0x6a5436, transparent: true, opacity: 0.3,
      depthWrite: false, roughness: 1.0,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    const trail = new THREE.InstancedMesh(geo.decal, trailMat, trailPts.length);
    for (let i = 0; i < trailPts.length; i++) {
      const p = trailPts[i];
      e.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      q.setFromEuler(e);
      m4.compose(
        v3.set(p.x, groundY(p.x, p.z) + 0.03, p.z),
        q,
        sc.set(1.1 + Math.random() * 0.5, 0.8 + Math.random() * 0.4, 1),
      );
      trail.setMatrixAt(i, m4);
    }
    scene.add(trail);
  }

  // ---- fake contact AO under every building, crate, barrel, cart, lamp ----
  {
    const aoMat = new THREE.MeshBasicMaterial({
      map: aoTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3,
    });
    const ao = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), aoMat, aoSpots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < aoSpots.length; i++) {
      const sp = aoSpots[i];
      m4.compose(
        new THREE.Vector3(sp.x, groundY(sp.x, sp.z) + 0.02, sp.z),
        q,
        new THREE.Vector3(sp.r, sp.r, 1)
      );
      ao.setMatrixAt(i, m4);
    }
    ao.renderOrder = 1;
    scene.add(ao);
  }

  // ---- lamp glow: gebackener Lichtteppich statt Echtzeit-PointLights ----
  // (R15) Ersetzt fünf THREE.PointLight (10,65 ms / 33,5% GPU, siehe
  // RUNDE15-MESSUNG.md) durch einen einzigen Draw-Call. groundHeightAt() statt
  // groundY() — kennt den Steg (baseY der beiden Hafen-Laternen), damit das Decal am
  // Stegende auf Deckhöhe liegt statt auf dem darunterliegenden Sand-Relief.
  //
  // R15b (Blindvergleich-Reparatur): Die erste Fassung war EINE flache 10-Eck-
  // Scheibe pro Laterne (InstancedMesh aus geo.decal) auf Bodenhöhe+0.03. Das
  // Relief (±0.3) und die Pflasterwege (PATH_LIFT 0.05, Platz-Fliesen 0.03)
  // schnitten diese Ebene: wo der Untergrund die Scheibe durchstößt, zerfällt
  // sie in 1-Pixel-Kammstreifen und Stipple-Dreiecke (die „Shadow Acne" der
  // Kritiker war in Wahrheit dieses Z-Fighting — ein Dreieck der 10-Eck-Scheibe
  // war sogar als Form erkennbar), dazu eine harte sichtbare Polygonkante.
  // Jetzt: ein 10×10-Gitter pro Laterne, jeder Vertex auf groundHeightAt+0.08 —
  // schmiegt sich dem Relief an und liegt sicher ÜBER Fliesen (0.03) und Wegen
  // (0.05); polygonOffset -2 erledigt den Rest. Alle Gitter in EINER
  // BufferGeometry -> weiterhin ein einziger Draw-Call (5 × 200 Dreiecke sind
  // im Vertexbudget unsichtbar). Quadratischer Patch statt Kreis: außerhalb
  // des gebackenen Radius ist die Textur schwarz, und Schwarz ist sowohl unter
  // DstColor- als auch unter AdditiveBlending exakt wirkungslos — die Ecken
  // kosten nur Fläche im Framebuffer, keine sichtbare Kante. Die Gitter-
  // Geometrie bleibt beim Additiv-Rückbau (R15b-Ende) bewusst erhalten: die
  // flache Scheibe hatte das oben beschriebene Z-Fighting bei JEDEM Blending.
  if (lampGlowSpots.length) {
    const GLOW_RADIUS = 6.2; // aus der ersetzten PointLight-Formel hergeleitet, siehe lampPost
    const GLOW_LIFT = 0.08;
    const SEG = 10;
    const vertsPer = (SEG + 1) * (SEG + 1);
    const gpos = new Float32Array(lampGlowSpots.length * vertsPer * 3);
    const guv = new Float32Array(lampGlowSpots.length * vertsPer * 2);
    const gidx = [];
    let pi = 0, ti = 0, vbase = 0;
    for (const sp of lampGlowSpots) {
      for (let iy = 0; iy <= SEG; iy++) {
        for (let ix = 0; ix <= SEG; ix++) {
          const u = ix / SEG, v = iy / SEG;
          const wx = sp.x + (u - 0.5) * 2 * GLOW_RADIUS;
          const wz = sp.z + (v - 0.5) * 2 * GLOW_RADIUS;
          gpos[pi++] = wx;
          gpos[pi++] = groundHeightAt(wx, wz) + GLOW_LIFT;
          gpos[pi++] = wz;
          guv[ti++] = u;
          guv[ti++] = v;
        }
      }
      for (let iy = 0; iy < SEG; iy++) {
        for (let ix = 0; ix < SEG; ix++) {
          const a = vbase + iy * (SEG + 1) + ix;
          const b = a + 1;
          const c = a + (SEG + 1);
          const d = c + 1;
          gidx.push(a, c, b, b, c, d); // von oben gesehen CCW (Frontseite zeigt nach +y)
        }
      }
      vbase += vertsPer;
    }
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
    glowGeo.setAttribute('uv', new THREE.BufferAttribute(guv, 2));
    glowGeo.setIndex(gidx);
    const glow = new THREE.Mesh(glowGeo, mats.lampGlow);
    glow.renderOrder = 1;
    scene.add(glow);
  }

  // ---- update (water scroll, foam pulse, module hooks: Palmen-Sway, Boot, Wäsche) ----
  // playerPos/camPos reichen die Bewohner-Logik durch (Blickkontakt, Winken, LOD),
  // avoid = { pts, n } die Liste der Punkte, um die sie herumtreten (Spieler, Kai,
  // lebende Marines — main.js befüllt sie einmal pro Frame). Die älteren Updater
  // ignorieren die Zusatzargumente einfach.
  function update(dt, t, playerPos, camPos, avoid) {
    waveTex.offset.x = t * 0.008;
    waveTex.offset.y = t * 0.005;
    foamMat.opacity = 0.375 + Math.sin(t * 1.1) * 0.125;
    for (const u of updaters) u(dt, t, playerPos, camPos, avoid);
  }

  // R22: ctx wird mit herausgereicht, damit main.js (steht NICHT im Sim-Manifest)
  // island/flair.js darüber aufbauen kann — ein statischer flair-Import HIER würde
  // in der sim/gen-Kopie ins Leere zeigen und den Prüfstand strukturell brechen.
  return { update, obstacles, sun, villagers, ctx };
}
