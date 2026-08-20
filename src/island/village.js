// island/village.js — Hafendorf: Häuser, Dorfplatz, Wege, Props (aus arena.js ausgelagert + M3-Ausbau, Runde 13)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dirtPathTexture } from './textures.js';

const PATH_WIDTH = 2.4;        // sichtbare Wegbreite
const PATH_SAMPLE_STEP = 1.5;  // Meter zwischen Ribbon-Querschnitten
const PATH_LIFT = 0.05;        // Weg schwebt knapp über dem Sand (gegen Z-Fighting)
// Öffnungswinkel des Türblatts (negativ = nach außen). 2.95 rad = 169°: das Blatt steht
// offen an der Fassade, Spitze bei lokal x = -1.63, z = d/2 + 0.25.
// WARUM so weit: ein einflügeliges Blatt der Breite W am Pfosten x = -0.55 hat seine
// Spitze bei x = -0.55 + W·cos θ. Bei W = 1.1 verlässt sie die 1.14 m breite Öffnung
// (x <= -0.57) erst ab θ >= 91°. JEDER kleinere Winkel lässt das Blatt in der Türöffnung
// stehen — bei den alten 66° war die Laufspur auf allen 14 Häusern und allen drei
// Anlaufspuren über den GANZEN Schwenk zu (Luft -0.38 bis -0.06 m zur Rumpfkapsel).
//
// EHRLICH DAZUGESAGT, was die Geometrie NICHT leistet: nur die SPITZE verlässt die
// Öffnung. Die Scharnierseite des Blatts sitzt bauartbedingt bei x = -0.55 und damit
// innerhalb des Pfostens bei -0.57; zwei der vier Grundriss-Ecken stehen deshalb auch
// bei 169° noch in der Öffnung, und über 42-55 % des Schwenks (der ersten Hälfte) sind
// alle drei Spuren weiterhin zu, im schlechtesten Winkel mit denselben -0.380 m wie
// bei 66°. Sicher wird die Tür erst zusammen mit dem Vorlauf aus villagers.js
// (DOOR_LEAD_DIST / DOOR_LEAD), der dafür sorgt, dass niemand während der ersten
// Hälfte des Schwenks im Türrahmen steht. Geometrie und Zeitsteuerung gehören hier
// zusammen — die Geometrie allein bringt nur -0.362 statt -0.380 m.
const DOOR_OPEN = -2.95;
// Annäherung pro Sekunde an den Zielwinkel. Bewusst mit dem Winkel mitskaliert: die
// Kurve ist exponentiell, ihre Anfangsgeschwindigkeit also RATE·DOOR_OPEN. Bei 6 und
// 1.15 rad waren das 6.9 rad/s; 2.6 und 2.95 rad ergeben 7.7 rad/s — das Blatt bewegt
// sich also weiter mit vertrauter Geschwindigkeit, es fährt nur einen längeren Weg.
// Mit unverändert 6 hätte es mit 17.7 rad/s losgeschlagen (voll offen in 10 Frames).
const DOOR_SWING_RATE = 2.6;

// ---- Weg-Freihaltung für die Bewohner ----
const VILLAGER_BODY_R = 0.32;    // = BODY_R aus villagers.js
const PATH_CLEAR_RESERVE = 0.35; // Luft, die einer Figur auf ihrer Spur bleiben muss
const PATH_FLAT_TOP_MAX = 0.3;   // flache Trittflächen (Stegplanken) blockieren nicht
// = v.lat aus villagers.js. waypoint() versetzt JEDE Figur um diesen Betrag quer zur
// Mittellinie — geprüft wurde bis Runde 14 aber nur die Mittellinie selbst, und genau
// dort läuft niemand (Befund M1: die haus-seitige Spur lag 0.04-0.07 m im Push-out-Mantel).
const VILLAGER_LANE = 0.55;
// Die Mitte bleibt mit in der Prüfung: an ihr hängt die Zusicherung weiter unten, dass
// zwei Kollider von verschiedenen Seiten den Korridor nicht zuschnüren können.
const PATH_LANES = [-VILLAGER_LANE, 0, VILLAGER_LANE];

// kürzester Abstand eines Punktes zu einer Strecke (für die Wege-Freihaltung)
function segDist(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - x0) * dx + (pz - z0) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t));
}

// dasselbe für eine um `off` quer versetzte Strecke = die tatsächliche Gehspur
function segDistLane(px, pz, x0, z0, x1, z1, off) {
  if (off === 0) return segDist(px, pz, x0, z0, x1, z1);
  const dx = x1 - x0;
  const dz = z1 - z0;
  const l = Math.hypot(dx, dz) || 1;
  const nx = -dz / l;
  const nz = dx / l;
  return segDist(px, pz, x0 + nx * off, z0 + nz * off, x1 + nx * off, z1 + nz * off);
}

// Baukontrolle (arena.js ruft sie EINMAL, direkt vor buildVillagers): meldet jeden
// Kollider, der einen Bewohner-Weg zustellt. Sie wirft nicht und ändert nichts — eine
// Warnung reicht, im aufgeräumten Zustand bleibt sie stumm.
//
// WARUM: Ein Marktstand 0 m neben der Wegmitte hat den Hafenweg zusammen mit der
// Hauswand einmal komplett versiegelt; der Spaziergänger stand danach dauerhaft vor
// der Lücke, die keine war. Die Reserve (0.35 m) ist größer als der Körperradius
// (0.32 m), und genau daran hängt die zweite Zusicherung: liegt kein Kollider im
// Korridor, können auch zwei Kollider auf verschiedenen Seiten ihre Push-out-Mäntel
// nicht mehr über der Wegmitte schließen — ihr Mittenabstand ist dann mindestens
// rA + rB + 1.34 m, versiegelt wäre er erst unter rA + rB + 0.64 m.
export function checkPathsClear(paths, obs, names = []) {
  let warned = 0;
  for (let p = 0; p < paths.length; p++) {
    const pts = paths[p];
    for (const o of obs) {
      if (o.radius <= 0.15) continue;
      if (o.topY !== undefined && o.topY <= PATH_FLAT_TOP_MAX) continue;
      const need = o.radius + VILLAGER_BODY_R + PATH_CLEAR_RESERVE;
      let best = Infinity;
      let bestSeg = -1;
      let bestLane = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        for (const off of PATH_LANES) {
          const d = segDistLane(o.x, o.z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], off);
          if (d < best) { best = d; bestSeg = i; bestLane = off; }
        }
      }
      if (best >= need) continue;
      warned++;
      const lane = bestLane === 0
        ? 'Wegmitte'
        : `Spur ${bestLane > 0 ? '+' : ''}${bestLane.toFixed(2)}`;
      console.warn(
        `[village] Weg ${p}${names[p] ? ` (${names[p]})` : ''}, Segment ${bestSeg} `
        + `[${pts[bestSeg]}] -> [${pts[bestSeg + 1]}]: Kollider bei `
        + `(${o.x.toFixed(2)}, ${o.z.toFixed(2)}) mit Radius ${o.radius.toFixed(2)} m `
        + `steht nur ${best.toFixed(2)} m von der ${lane}, nötig sind ${need.toFixed(2)} m `
        + `— es fehlen ${(need - best).toFixed(2)} m. Prop verschieben oder Wegpunkt versetzen.`
      );
    }
  }
  return warned;
}

// Weg-Ribbon: Polylinie -> Bandgeometrie, die dem Bodenrelief (groundY) folgt
function pathRibbonGeo(pts, width, groundY) {
  const samples = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / PATH_SAMPLE_STEP));
    for (let k = (i === 0 ? 0 : 1); k <= steps; k++) {
      samples.push([x0 + (x1 - x0) * (k / steps), z0 + (z1 - z0) * (k / steps)]);
    }
  }
  const pos = [], norm = [], uv = [], idx = [];
  let vDist = 0;
  for (let i = 0; i < samples.length; i++) {
    const [x, z] = samples[i];
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const dx = next[0] - prev[0], dz = next[1] - prev[1];
    const dl = Math.hypot(dx, dz) || 1;
    const px = -dz / dl, pz = dx / dl; // Quer-Richtung
    if (i > 0) vDist += Math.hypot(x - prev[0], z - prev[1]);
    for (const side of [-1, 1]) {
      const vx = x + px * (width / 2) * side;
      const vz = z + pz * (width / 2) * side;
      pos.push(vx, groundY(vx, vz) + PATH_LIFT, vz);
      norm.push(0, 1, 0);
      uv.push(side * 0.5 + 0.5, vDist / width);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function buildVillage(ctx) {
  const {
    scene, obstacles, geo, mats, groundY, addShadow, addAO, updaters, lampPost, PIER,
  } = ctx;

  // Türen als Fluchtziele für die Bewohner (villagers.js). Wird hier gesammelt statt
  // in villagers.js noch einmal hingeschrieben — die Hausliste steht nur an dieser Stelle.
  const doorSpots = [];
  ctx.doorSpots = doorSpots;
  const doorHinges = [];   // {spot, hinge} — Türblätter, die aufschwingen können
  const doorways = [];     // {x, z, rotY, d} — dunkle Öffnung HINTER dem Türblatt

  // Wegenetz-Polylinien. Stehen hier oben, weil die zufällige Prop-Streuung weiter
  // unten dagegen prüft; die sichtbare Ribbon-Geometrie entsteht erst am Dateiende.
  // Die drei Haus-Wege enden auf der Fassaden-Normalen ihres Zielhauses, deutlich vor dem
  // Kollider; der Turmweg entsprechend vor dem Turm-Kollider. Der Weg endet damit
  // sichtbar VOR der Tür statt im Kollider — auf den alten Endpunkten stand ein
  // Spaziergänger dauerhaft im Push-out und schleifte sich die letzten Meter entlang.
  //
  // Die Zahlen sind gegen die GEHSPUREN gerechnet, nicht gegen die Mittellinie
  // (Befund M1): waypoint() versetzt jede Figur um v.lat = +-0.55 quer, am Endpunkt also
  // auch. Der Nordwest-Endpunkt musste dafür von 0.80 auf 1.22 m Abstand zum
  // Haus-Kollider heraus — 0.80 m Rand minus 0.55 m Spurversatz liess der Rumpfkapsel
  // (0.32 m) rechnerisch nichts mehr, gemessen waren es -0.07 m. Alle Wegpunkte hier
  // stammen aus einer Relaxation gegen ALLE Kollider und alle drei Spuren; checkPathsClear
  // oben ist danach stumm, mit mindestens 0.02 m Luft über der Reserve.
  const pathDefs = [
    [[0.39, 8.82], [5.28, 20.13], [9.69, 31.76], [13.83, 38.07], [PIER.x, PIER.shoreZ + 1]],
    [[0, 3], [0, -16], [0, -26.6]],                                    // zum Wachturm
    [[-2, 7], [-11.94, 11.17], [-23.99, 15.03], [-28.88, 18.24]],      // Westhäuser
    [[3.02, 4.87], [14.03, 6.15], [21.6, 10.8]],                       // Osthäuser
    [[9.69, 31.76], [-2, 36], [-14.68, 36.68]],                        // Abzweig Nordwest-Haus
  ];

  // ---- buildings ----
  function building(x, z, w, h, d, rotY, mat, opts = {}) {
    const g = new THREE.Group();
    const body = addShadow(new THREE.Mesh(geo.box, mat));
    body.scale.set(w, h, d);
    body.position.y = h / 2;
    g.add(body);
    // flat roof lip
    const roof = addShadow(new THREE.Mesh(geo.box, mats.roof));
    roof.scale.set(w + 0.5, 0.35, d + 0.5);
    roof.position.y = h + 0.17;
    g.add(roof);
    // Tür an der linken Kante aufgehängt: der Pivot sitzt auf der Scharnierseite,
    // das Blatt hängt um die halbe Breite versetzt daran. DOOR_OPEN ist negativ, das
    // Blatt schwenkt also nach +z nach AUSSEN auf — und zwar bis 169°, wo seine SPITZE
    // links neben der Türöffnung an der Fassade steht (die Scharnierecken bleiben drin,
    // siehe DOOR_OPEN oben). Die Laufspuren sind erst ab 42-55 % des Schwenks frei;
    // so weit ist die Tür beim Eintreffen, weil villagers.js sie über DOOR_LEAD_DIST
    // (Anlauf) bzw. DOOR_LEAD (Heraustreten) vorlaufen lässt — ohne diesen Vorlauf
    // nützt der grössere Winkel fast nichts (gemessen: -0.362 statt -0.380 m).
    //
    // Nach INNEN aufschlagen geht hier nicht: der Baukörper ist ein massiver Quader ohne
    // Innenraum, und die dunkle Türöffnung liegt als undurchsichtiges Rechteck davor.
    // Ein nach innen schwenkendes Blatt steckt bei JEDEM Winkel dahinter — gemessen:
    // kein einziger Blattpunkt käme je vor die Fassadenebene (max. lz = -0.04 m).
    //
    // Anschläge auf dem Weg (alle über den ganzen Schwenk in 3D nachgemessen, nicht nur
    // im Endzustand): Markisenpfosten 1.45 m vor der Wand liegen 0.38 m ausserhalb der
    // Schwenkscheibe; Balkonstützen stehen 2.24 m seitlich; Fensterläden und Fenster
    // hängen ab 2.32 m Höhe, das Blatt endet bei 2.0 m. Die Markise musste dafür von
    // 2.70 auf 3.00 m steigen — ihre Unterkante hing sonst auf 1.88 m in die Bahn.
    const hinge = new THREE.Object3D();
    hinge.position.set(-0.55, 0, d / 2 + 0.04);
    const door = new THREE.Mesh(geo.box, mats.wood);
    door.scale.set(1.1, 2.0, 0.12);
    door.position.set(0.55, 1.0, 0);
    hinge.add(door);
    g.add(hinge);
    // windows (+ optionale Fensterläden)
    for (const wx of [-w * 0.28, w * 0.28]) {
      const win = new THREE.Mesh(geo.box, mats.win);
      win.scale.set(0.9, 0.9, 0.1);
      win.position.set(wx, h * 0.62, d / 2 + 0.04);
      g.add(win);
      if (opts.shutters) {
        for (const sx of [-1, 1]) {
          const shutter = new THREE.Mesh(geo.box, opts.shutterMat || mats.shutter);
          shutter.scale.set(0.32, 0.95, 0.06);
          shutter.position.set(wx + sx * 0.64, h * 0.62, d / 2 + 0.05);
          shutter.rotation.y = sx * 0.25; // leicht geöffnet — bewohnt, nicht verrammelt
          g.add(shutter);
        }
      }
    }
    // striped cloth awning tilted over the door
    if (opts.awning) {
      const aw = new THREE.Mesh(geo.awning, mats.awning);
      // Höhe 3.00 statt 2.70: die um -25° gekippte Bahn hängt an ihrer Vorderkante
      // 0.82 m unter dem Mittelpunkt. Bei 2.70 lag diese Kante auf 1.88 m — 12 cm UNTER
      // der Oberkante des 2.0 m hohen Türblatts, das beim Aufschwingen genau dort
      // vorbeikommt (gemessen: 0.007 m Luft). Bei 3.00 sind es 0.18 m.
      aw.position.set(0, 3.0, d / 2 + 0.75);
      aw.rotation.x = -25 * Math.PI / 180;
      aw.castShadow = true;
      g.add(aw);
      for (const px of [-1.3, 1.3]) {
        const pole = new THREE.Mesh(geo.cylinder, mats.wood);
        pole.scale.set(0.06, 2.4, 0.06);
        pole.position.set(px, 1.2, d / 2 + 1.45);
        g.add(pole);
      }
    }
    // wooden balcony (2-story houses)
    if (opts.balcony) {
      const deck = addShadow(new THREE.Mesh(geo.box, mats.wood));
      deck.scale.set(w * 0.7, 0.15, 1.5);
      deck.position.set(0, h * 0.52, d / 2 + 0.75);
      g.add(deck);
      for (const px of [-w * 0.32, w * 0.32]) {
        for (const pz of [d / 2 + 0.15, d / 2 + 1.35]) {
          const post = new THREE.Mesh(geo.cylinder, mats.wood);
          post.scale.set(0.07, h * 0.52, 0.07);
          post.position.set(px, h * 0.26, pz);
          g.add(post);
        }
      }
      // railing
      const rail = new THREE.Mesh(geo.box, mats.wood);
      rail.scale.set(w * 0.7, 0.08, 0.08);
      rail.position.set(0, h * 0.52 + 0.8, d / 2 + 1.42);
      g.add(rail);
      // upper window
      const win = new THREE.Mesh(geo.box, mats.win);
      win.scale.set(0.9, 1.0, 0.1);
      win.position.set(0, h * 0.78, d / 2 + 0.04);
      g.add(win);
    }
    const gy = groundY(x, z);
    g.position.set(x, gy, z);
    g.rotation.y = rotY;
    scene.add(g);
    addAO(x, z, Math.max(w, d));
    // Halbdiagonale statt max*0.62 — der Kreis umschließt die Ecken, kein Clipping (R13-Kritik #10)
    const colliderR = Math.hypot(w, d) / 2;
    obstacles.push({ x, z, radius: colliderR, topY: h + gy }); // roof eave is standable
    // Tür sitzt lokal bei z = d/2; (nx, nz) ist die Blickrichtung des Hauses nach draußen.
    // ax/az = Türvorplatz AUSSERHALB des Kolliders, ix/iz = knapp hinter der Wand
    // (dort verschwindet ein flüchtender Bewohner, vom Baukörper verdeckt).
    const nx = Math.sin(rotY);
    const nz = Math.cos(rotY);
    // openT wird von villagers.js hochgesetzt, solange jemand durch diese Tür geht
    const spot = {
      nx, nz,
      x: x + nx * (d / 2), z: z + nz * (d / 2),
      ax: x + nx * (colliderR + 0.6), az: z + nz * (colliderR + 0.6),
      ix: x + nx * (d / 2 - 0.45), iz: z + nz * (d / 2 - 0.45),
      openT: 0,
    };
    doorSpots.push(spot);
    doorHinges.push({ spot, hinge });
    doorways.push({ x, z, rotY, d });
  }

  // Dorfkern rund um den Platz (Bestand)
  building(-24, -16, 8, 6, 7, 0.5, mats.wallA, { awning: true, shutters: true });
  building(22, -20, 9, 5, 7, -0.4, mats.wallB, { shutters: true });
  building(-20, 22, 7, 4.5, 6, 2.6, mats.wallB, { awning: true });
  building(26, 14, 7, 5.5, 6, -2.2, mats.wallA, { shutters: true });
  // plaza-edge cluster
  building(-10, -22, 6, 4.5, 5.5, 0.15, mats.wallC, { awning: true });
  building(12, -24, 6.5, 5, 5.5, -0.15, mats.wallA, { shutters: true });
  building(-26, -2, 7, 8, 6, 1.35, mats.wallB, { balcony: true }); // 2-story w/ balcony
  building(30, 4, 6, 4.5, 5.5, -1.75, mats.wallC);
  building(2, 27, 6.5, 5, 5.5, 3.0, mats.wallA, { shutters: true });
  // Außenring Richtung Hafen & Küste (M3): das Dorf wächst über den Platz hinaus
  building(8, 40, 7, 5, 6, Math.PI, mats.wallB, { awning: true, shutters: true });
  building(24, 34, 6, 4.5, 5.5, -2.7, mats.wallC, { shutters: true });
  building(-34, 20, 7, 6.5, 6, 1.9, mats.wallA, { balcony: true, shutters: true });
  building(-16, 42, 6.5, 5, 5.5, 2.9, mats.wallB, { shutters: true });
  building(36, -12, 6, 4.5, 5, -1.3, mats.wallC, { shutters: true });

  // Dunkle Türöffnung knapp vor der Wandebene, hinter dem geschlossenen Türblatt
  // verborgen (Blatt-Vorderseite liegt 0.10 davor). Erst wenn die Tür aufschwingt,
  // wird sie sichtbar — ohne sie stünde dort eine türförmige Putzfläche.
  // Eine InstancedMesh für alle 14 Häuser: ein einziger zusätzlicher Draw-Call,
  // kein Schattenpass (unbeleuchtetes Material).
  {
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x1a1310 });
    const frames = new THREE.InstancedMesh(geo.box, frameMat, doorways.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < doorways.length; i++) {
      const w = doorways[i];
      const nx = Math.sin(w.rotY);
      const nz = Math.cos(w.rotY);
      const off = w.d / 2 + 0.005;
      e.set(0, w.rotY, 0);
      q.setFromEuler(e);
      m4.compose(
        new THREE.Vector3(w.x + nx * off, groundY(w.x, w.z) + 1.0, w.z + nz * off),
        q,
        new THREE.Vector3(1.14, 2.04, 0.02)   // 2 cm Rand ringsum = Türrahmen-Fuge
      );
      frames.setMatrixAt(i, m4);
    }
    scene.add(frames);
  }

  // Türen aufschwingen lassen: villagers.js setzt spot.openT hoch, solange eine Figur
  // in der Tür-Bewegung steckt. Danach fällt die Tür von allein wieder zu.
  updaters.push((dt) => {
    for (const h of doorHinges) {
      if (h.spot.openT > 0) h.spot.openT -= dt;
      const target = h.spot.openT > 0 ? DOOR_OPEN : 0;
      const a = h.hinge.rotation.y;
      if (Math.abs(target - a) < 1e-4) continue;   // geschlossene Türen kosten nichts
      h.hinge.rotation.y = a + (target - a) * Math.min(1, dt * DOOR_SWING_RATE);
    }
  });

  // ---- watchtower (stone blocks) ----
  {
    const tgy = groundY(0, -30);
    const tower = addShadow(new THREE.Mesh(geo.cylinder, mats.stoneBlock));
    tower.scale.set(2.2, 9, 2.2);
    tower.position.set(0, 4.5 + tgy, -30);
    scene.add(tower);
    const top = addShadow(new THREE.Mesh(geo.cylinder, mats.roof));
    top.scale.set(2.8, 0.5, 2.8);
    top.position.set(0, 9.2 + tgy, -30);
    scene.add(top);
    // crenellations around the rim
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const c = addShadow(new THREE.Mesh(geo.box, mats.stoneBlock));
      c.scale.setScalar(0.6);
      c.position.set(Math.cos(a) * 2.45, 9.75 + tgy, -30 + Math.sin(a) * 2.45);
      c.rotation.y = -a;
      scene.add(c);
    }
    // wooden door at the base (facing the plaza)
    const tDoor = new THREE.Mesh(geo.box, mats.wood);
    tDoor.scale.set(0.9, 1.9, 0.14);
    tDoor.position.set(0, 0.95 + tgy, -30 + 2.2);
    scene.add(tDoor);
    addAO(0, -30, 5.6);
    obstacles.push({ x: 0, z: -30, radius: 2.6, topY: 9.45 + tgy }); // watchtower platform
  }

  // ---- plaza center: stone tiles, well, lamp posts ----
  {
    const tileTex = ctx.stoneTileTexture();
    tileTex.repeat.set(3, 3);
    const tileMat = new THREE.MeshStandardMaterial({
      map: tileTex, roughness: 1.0,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    const tiles = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), tileMat);
    tiles.rotation.x = -Math.PI / 2;
    tiles.position.set(0, 0.03, 6);
    tiles.receiveShadow = true;
    scene.add(tiles);

    // well: stone ring + two posts + crossbar + little roof
    const wellX = 0, wellZ = 6;
    const wall = addShadow(new THREE.Mesh(geo.cylinder, mats.stoneBlock));
    wall.scale.set(1.2, 0.9, 1.2);
    wall.position.set(wellX, 0.45, wellZ);
    scene.add(wall);
    const water = new THREE.Mesh(geo.decal, new THREE.MeshStandardMaterial({
      color: 0x1e4a5c, roughness: 0.25, metalness: 0.3,
    }));
    water.rotation.x = -Math.PI / 2;
    water.scale.setScalar(1.0);
    water.position.set(wellX, 0.82, wellZ);
    scene.add(water);
    for (const px of [-1.15, 1.15]) {
      const post = addShadow(new THREE.Mesh(geo.box, mats.wood));
      post.scale.set(0.14, 1.6, 0.14);
      post.position.set(wellX + px, 1.3, wellZ);
      scene.add(post);
    }
    const crossbar = addShadow(new THREE.Mesh(geo.cylinder, mats.wood));
    crossbar.scale.set(0.07, 2.5, 0.07);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(wellX, 2.0, wellZ);
    scene.add(crossbar);
    obstacles.push({ x: wellX, z: wellZ, radius: 1.35, topY: 0.9 }); // stone ring rim

    lampPost(-3.4, 3.2);
    lampPost(3.6, 8.6);
    lampPost(-14, 30);  // Dorfrand Richtung Nordwest-Häuser — warmer Akzent im Außenring
  }

  // ---- crates & barrels ----
  function crate(x, z, s, rotY) {
    const gy = groundY(x, z);
    const m = addShadow(new THREE.Mesh(geo.box, mats.wood));
    m.scale.setScalar(s);
    m.position.set(x, gy + s / 2, z);
    m.rotation.y = rotY;
    scene.add(m);
    addAO(x, z, s * 1.5);
    obstacles.push({ x, z, radius: s * 0.75, topY: gy + s }); // crate lid
  }
  function barrel(x, z) {
    const gy = groundY(x, z);
    const m = addShadow(new THREE.Mesh(geo.barrelBand, mats.barrel));
    m.position.set(x, gy + 0.45, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    scene.add(m);
    addAO(x, z, 1.1);
    obstacles.push({ x, z, radius: 0.5, topY: gy + 0.9 }); // barrel lid
  }
  ctx.crate = crate;   // harbor.js verteilt am Steg dieselben Props
  ctx.barrel = barrel;

  // ---- market cart / stall assemblies (awning + wheels + bed) ----
  function cart(x, z, rotY) {
    const gy = groundY(x, z);
    const g = new THREE.Group();
    const bed = addShadow(new THREE.Mesh(geo.box, mats.wood));
    bed.scale.set(2.6, 0.18, 1.4);
    bed.position.y = 0.75;
    g.add(bed);
    // side rails
    for (const pz of [-0.66, 0.66]) {
      const rail = addShadow(new THREE.Mesh(geo.box, mats.wood));
      rail.scale.set(2.6, 0.3, 0.08);
      rail.position.set(0, 0.99, pz);
      g.add(rail);
    }
    // wheels
    for (const px of [-0.85, 0.85]) {
      const wheel = addShadow(new THREE.Mesh(geo.cylinder, mats.wood));
      wheel.scale.set(0.42, 0.12, 0.42);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(px, 0.42, 0.72);
      g.add(wheel);
      const wheel2 = wheel.clone();
      wheel2.position.z = -0.72;
      g.add(wheel2);
    }
    // corner poles + striped awning overhead
    for (const px of [-1.1, 1.1]) {
      for (const pz of [-0.6, 0.6]) {
        const pole = new THREE.Mesh(geo.cylinder, mats.wood);
        pole.scale.set(0.05, 1.7, 0.05);
        pole.position.set(px, 1.55, pz);
        g.add(pole);
      }
    }
    const aw = new THREE.Mesh(geo.awning, mats.awning);
    aw.scale.set(0.95, 0.95, 1);
    aw.position.y = 2.45;
    aw.rotation.x = -Math.PI / 2 + 0.14;
    aw.castShadow = true;
    g.add(aw);
    // a couple of goods on the bed
    const sack = addShadow(new THREE.Mesh(geo.sphere, mats.trunk));
    sack.scale.set(0.3, 0.22, 0.3);
    sack.position.set(0.6, 0.95, 0);
    g.add(sack);
    const box2 = addShadow(new THREE.Mesh(geo.box, mats.wood));
    box2.scale.setScalar(0.42);
    box2.position.set(-0.55, 1.05, 0.1);
    g.add(box2);
    g.position.set(x, gy, z);
    g.rotation.y = rotY;
    scene.add(g);
    addAO(x, z, 2.8);
    obstacles.push({ x, z, radius: 1.5, topY: gy + 0.84 }); // cart bed is standable
  }

  // fester Marktstand: Theke + Pfosten + Markise + Warenauslage
  function stall(x, z, rotY) {
    const gy = groundY(x, z);
    const g = new THREE.Group();
    const counter = addShadow(new THREE.Mesh(geo.box, mats.wood));
    counter.scale.set(2.2, 0.9, 1.0);
    counter.position.y = 0.45;
    g.add(counter);
    for (const px of [-1.0, 1.0]) {
      for (const pz of [-0.45, 0.45]) {
        const pole = new THREE.Mesh(geo.cylinder, mats.wood);
        pole.scale.set(0.06, 2.3, 0.06);
        pole.position.set(px, 1.15, pz);
        g.add(pole);
      }
    }
    const aw = new THREE.Mesh(geo.awning, mats.awning);
    aw.scale.set(0.85, 0.85, 1);
    aw.position.y = 2.35;
    aw.rotation.x = -Math.PI / 2 + 0.2;
    aw.castShadow = true;
    g.add(aw);
    // Auslage: zwei Obst-Häufchen + Sack
    for (const [px, color] of [[-0.55, 0xd4593a], [0.15, 0xdfa53a]]) {
      const pile = addShadow(new THREE.Mesh(geo.sphere, new THREE.MeshStandardMaterial({
        color, roughness: 0.8,
      })));
      pile.scale.set(0.3, 0.2, 0.3);
      pile.position.set(px, 1.0, 0);
      g.add(pile);
    }
    const sack = addShadow(new THREE.Mesh(geo.sphere, mats.trunk));
    sack.scale.set(0.28, 0.34, 0.28);
    sack.position.set(0.75, 0.35, 0.55);
    g.add(sack);
    g.position.set(x, gy, z);
    g.rotation.y = rotY;
    scene.add(g);
    addAO(x, z, 2.4);
    obstacles.push({ x, z, radius: 1.3, topY: gy + 0.9 });
  }

  crate(-6, -12, 1.3, 0.4);
  crate(-7.6, -11, 1.1, 0.9);
  crate(-6.6, -10.2, 0.9, 0.2);
  crate(10, 8, 1.4, 0.7);
  crate(11.5, 9, 1.0, 1.3);
  crate(-14.4, 9.7, 1.2, 0.1);   // vom Westweg weggerückt: 1.58 m -> 1.99 m Abstand
  crate(16, -16, 1.2, 0.5);
  crate(-19, 16.5, 1.0, 1.1);
  barrel(9, -14);
  barrel(10, -13.2);
  barrel(-16, -4);
  barrel(18, 2);
  barrel(-11, 16);
  barrel(19.2, 2.9);
  barrel(-6.2, -22.5);
  barrel(8.5, -22.8);

  // ---- mid-ground prop clusters: layered cover between plaza and buildings ----
  {
    // Die Streuung ist zufällig PRO SEITENAUFRUF — ein Fass konnte deshalb auf einem
    // Türvorplatz landen (Cluster (-18,-11) reicht bis an den Vorplatz von Haus
    // (-24,-16) heran) und die Fluchttür der Bewohner unerreichbar machen. Kandidaten
    // werden jetzt gegen Türvorplätze und Wege geprüft und sonst neu gewürfelt.
    const DOOR_KEEPOUT = 1.5;                 // + Prop-Radius; Bewohner brauchen 0.8 + Körper
    // Sperrzone quer zur Wegmitte: die sichtbare Wegbreite ODER die äussere Gehspur samt
    // Rumpf und Reserve — was grösser ist. Zweiteres ist der Grund (Befund M1): ein Fass
    // bei genau PATH_WIDTH/2 + 0.2 = 1.40 m Mittenabstand steht 0.85 m von der äusseren
    // Spur, gebraucht werden dort 0.50 + 0.32 + 0.35 = 1.17 m — das ging bisher nur
    // deshalb gut, weil 1.40 zufällig über 1.22 lag. Jetzt steht es als Rechnung da.
    const PATH_KEEPOUT = Math.max(
      PATH_WIDTH / 2 + 0.2,
      VILLAGER_LANE + VILLAGER_BODY_R + PATH_CLEAR_RESERVE
    );
    function spotFree(x, z, r) {
      for (const s of doorSpots) {
        // Vorplatz UND Türmund freihalten — dazwischen läuft die Eintritts-Bewegung
        if (Math.hypot(x - s.ax, z - s.az) < r + DOOR_KEEPOUT) return false;
        if (Math.hypot(x - s.x, z - s.z) < r + DOOR_KEEPOUT) return false;
      }
      for (const pts of pathDefs) {
        for (let i = 0; i < pts.length - 1; i++) {
          if (segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
            < r + PATH_KEEPOUT) return false;
        }
      }
      return true;
    }
    // freie Position im Ring [rMin, rMin+rSpan] um (cx,cz); null = keine gefunden
    function scatterSpot(cx, cz, rMin, rSpan, r) {
      for (let k = 0; k < 16; k++) {
        const a = Math.random() * Math.PI * 2;
        const rr = rMin + Math.random() * rSpan;
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        if (spotFree(x, z, r)) return { x, z };
      }
      return null;   // lieber ein Prop weniger als eine blockierte Tür
    }

    const clusterCenters = [
      [14, -6], [-13, 5.5], [5, 15], [-4, -16], [20, 8.5], [-18, -11],
    ];
    let extraBarrels = 10;
    for (let ci = 0; ci < clusterCenters.length; ci++) {
      const [cx, cz] = clusterCenters[ci];
      const nCrates = 3 + Math.floor(Math.random() * 3); // 3-5
      for (let i = 0; i < nCrates; i++) {
        const s = 0.7 + Math.random() * 0.4;
        const p = scatterSpot(cx, cz, 0.8, 1.6, s * 0.75);
        if (p) crate(p.x, p.z, s, Math.random() * Math.PI * 2);
      }
      // distribute the 10 banded barrels across the clusters
      const nB = ci < 4 ? 2 : 1;
      for (let i = 0; i < nB && extraBarrels > 0; i++, extraBarrels--) {
        const p = scatterSpot(cx, cz, 1.6, 1.2, 0.5);
        if (p) barrel(p.x, p.z);
      }
    }
    // Marktkarren + feste Stände beleben Platzrand und Hafenweg. Die beiden am
    // Hafenweg sind auf den Bewohner-Korridor gerechnet — und zwar auf die GEHSPUREN,
    // nicht auf die Wegmitte (Befund M1). Der Stand stand deshalb bei (9, 25) zu nah:
    // zwischen ihm und dem Haus (2,27) blieben 1.72 m freier Korridor, drei Spuren
    // samt Reserve brauchen 2.44 m — kein Wegpunkt der Welt löst das, der Stand musste
    // 0.80 m nach Ost-Südost. Der Händler (villagers.js, DEFS) ist mitgewandert.
    // Sein Anker dort ist der Stand-Kollider; Position und anchor sind dieselbe
    // Verschiebung, damit er weiter hinter seiner Theke steht.
    cart(16.5, -4, 0.9);
    cart(-15.3, 7.2, -1.1);
    cart(1.5, 18.3, 2.4);
    stall(9.77, 24.78, 2.6);
    stall(16.3, 37.5, -1.36); // in der Kurve des Hafenwegs, Theke zur Straße
  }

  // ---- leaning plank boards (props touch architecture) ----
  function leanPlank(x, z, rotY, tilt) {
    const p = addShadow(new THREE.Mesh(geo.box, mats.wood));
    p.scale.set(0.55, 2.6, 0.08);
    p.position.set(x, 1.2 + groundY(x, z), z);
    p.rotation.set(tilt, rotY, 0);
    scene.add(p);
  }
  leanPlank(-8.2, -21.2, 0.15, 0.3);   // against building (-10,-22)
  leanPlank(13.9, -23.0, -0.15, 0.32); // against building (12,-24)
  leanPlank(28.2, 5.6, -1.75 + Math.PI / 2, 0.28); // against building (30,4)

  // ---- Wäscheleinen: zwei Pfosten, gespannte Leine, wehende Tücher ----
  function clothesline(x1, z1, x2, z2) {
    const topY = 2.45;
    for (const [px, pz] of [[x1, z1], [x2, z2]]) {
      const pole = addShadow(new THREE.Mesh(geo.cylinder, mats.wood));
      pole.scale.set(0.07, topY + 0.2, 0.07);
      pole.position.set(px, (topY + 0.2) / 2 + groundY(px, pz), pz);
      scene.add(pole);
      obstacles.push({ x: px, z: pz, radius: 0.2 });
    }
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const yawRot = Math.atan2(-dz, dx); // Box-X-Achse auf die Leinenrichtung drehen
    const line = new THREE.Mesh(geo.box, mats.rope);
    line.scale.set(len, 0.035, 0.035);
    line.position.set((x1 + x2) / 2, topY + groundY((x1 + x2) / 2, (z1 + z2) / 2), (z1 + z2) / 2);
    line.rotation.y = yawRot;
    scene.add(line);
    const clothColors = [0xc94f3d, 0xe8dcc0, 0x5a7a9a, 0xdfa53a];
    const cloths = [];
    for (let i = 0; i < 4; i++) {
      const f = 0.18 + i * 0.21;
      const cloth = new THREE.Mesh(geo.cloth, new THREE.MeshStandardMaterial({
        color: clothColors[i], roughness: 0.95, side: THREE.DoubleSide,
      }));
      const cx = x1 + dx * f, cz = z1 + dz * f;
      cloth.position.set(cx, topY - 0.36 + groundY(cx, cz), cz);
      cloth.rotation.y = yawRot;
      cloth.castShadow = true;
      scene.add(cloth);
      cloths.push(cloth);
    }
    // sanftes Wehen im Inselwind
    updaters.push((dt, t) => {
      for (let i = 0; i < cloths.length; i++) {
        cloths[i].rotation.x = Math.sin(t * 1.6 + i * 1.3) * 0.18;
      }
    });
  }
  clothesline(-13.5, -19.5, -8.5, -18.2); // zwischen den Plaza-Süd-Häusern
  clothesline(6.5, 44.3, 11, 45.3);       // HINTER dem Hafenhaus (8,40) — nicht in dessen Front (R13-Kritik #4)

  // ---- Möblierung auf Menschenmaß (Runde 17, Aufgabe B) ----
  // Tische, Hocker, Bank, Pflanzkübel, Schilder — an Funktionsorten (vor Häusern, am
  // Brunnen, bei den Marktständen). Stil wie alle Props: primitives + instanceColor,
  // KEINE externen Assets. Drei InstancedMeshes für ALLE Möbel zusammen (Kisten je
  // Form), statt ~60 Einzel-Meshes: +3 Draw-Calls im Farbpass, +3 im Schattenpass.
  //
  // Kollider-Philosophie gegen die Prop-Klemme aus Runde 15: eine MÖBELGRUPPE
  // (Tisch + Hocker) bekommt EINEN gemeinsamen Kreis — innerhalb der Gruppe gibt es
  // damit gar keine Zwischenräume, in die eine Figur geraten könnte. Und JEDE
  // Platzierung läuft durch furnitureFits(): erlaubt ist nur eine BEGEHBARE Lücke
  // (>= 2 Körperradien + Reserve) oder bewusstes Verschmelzen mit einem Nachbarn
  // (Überlappung, z. B. Schild am Marktstand) — die Klemm-Zone dazwischen wird zur
  // Bauzeit abgelehnt statt zur Laufzeit erlitten (offener Punkt 3 aus Runde 15).
  // Der Block steht NACH Streuung und Wäscheleinen, sieht also alle Kollider; er
  // zieht selbst KEINE Zufallszahlen — der RNG-Strom des Prüfstands bleibt exakt.
  {
    const GAP_MIN = 2 * VILLAGER_BODY_R + PATH_CLEAR_RESERVE; // 0.99 m gelebte Gasse
    const MERGE_MAX = -0.05;   // ab 5 cm Überlappung gilt "verschmolzen, keine Gasse"
    const DOOR_KEEPOUT = 1.5;  // wie bei der Streuung: Vorplatz + Türmund freihalten
    const FURN_PATH_KEEPOUT = Math.max(
      PATH_WIDTH / 2 + 0.2,
      VILLAGER_LANE + VILLAGER_BODY_R + PATH_CLEAR_RESERVE
    );

    function furnitureFits(x, z, r, name) {
      for (const s of doorSpots) {
        if (Math.hypot(x - s.ax, z - s.az) < r + DOOR_KEEPOUT
          || Math.hypot(x - s.x, z - s.z) < r + DOOR_KEEPOUT) {
          console.warn(`[village] Möblierung "${name}" (${x}, ${z}) verstellt einen Türvorplatz — übersprungen.`);
          return false;
        }
      }
      for (const pts of pathDefs) {
        for (let i = 0; i < pts.length - 1; i++) {
          if (segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
            < r + FURN_PATH_KEEPOUT) {
            console.warn(`[village] Möblierung "${name}" (${x}, ${z}) steht im Bewohner-Weg — übersprungen.`);
            return false;
          }
        }
      }
      for (const o of obstacles) {
        if (o.radius <= 0.15) continue;
        if (o.topY !== undefined && o.topY <= PATH_FLAT_TOP_MAX) continue;
        const gap = Math.hypot(x - o.x, z - o.z) - r - o.radius;
        if (gap > MERGE_MAX && gap < GAP_MIN) {
          console.warn(`[village] Möblierung "${name}" (${x}, ${z}): Lücke ${gap.toFixed(2)} m zum Kollider (${o.x.toFixed(1)}, ${o.z.toFixed(1)}) liegt in der Klemm-Zone (${MERGE_MAX}..${GAP_MIN.toFixed(2)}) — übersprungen.`);
          return false;
        }
      }
      return true;
    }

    // Teile-Sammler: erst alle Matrizen + Farben einsammeln, dann EINE InstancedMesh
    // pro Grundform. Muster wie die Türöffnungen oben und aoSpots in arena.js.
    const parts = { box: [], cyl: [], sph: [] };
    const _e = new THREE.Euler();
    const _q = new THREE.Quaternion();
    function part(kind, x, y, z, sx, sy, sz, rotY, color, rotX = 0, rotZ = 0) {
      const m = new THREE.Matrix4();
      _e.set(rotX, rotY, rotZ);
      _q.setFromEuler(_e);
      m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
      parts[kind].push({ m, color });
    }

    // Die Möbel tragen dieselbe Plank-Textur wie alle Holz-Props (mats.wood.map,
    // geteilt — keine neue Textur). instanceColor ist nur noch ein HELLER Tint:
    // flache dunkle Farben soffen im Abendlicht zu Klötzen ab (gemessen an Pose 6 —
    // Tisch und Hocker lasen sich als schwarze Kisten).
    const WOOD = [0xffffff, 0xe6d6c2, 0xd2bfa4];
    const LEAF = [0x5c7a3f, 0x6b8a4a];

    // Tisch + zwei Hocker als Gruppe, gedreht um rotY. EIN Kollider für alles.
    function tableSet(x, z, rotY, wi) {
      const r = 1.3;
      if (!furnitureFits(x, z, r, 'Tischgruppe')) return;
      const gy = groundY(x, z);
      const wood = WOOD[wi % WOOD.length];
      const cs = Math.cos(rotY); const sn = Math.sin(rotY);
      const at = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
      // Tischplatte + 4 Beine
      let [px, pz] = at(0, 0);
      part('box', px, gy + 0.72, pz, 1.15, 0.08, 0.8, rotY, wood);
      for (const [lx, lz] of [[-0.48, -0.31], [0.48, -0.31], [-0.48, 0.31], [0.48, 0.31]]) {
        [px, pz] = at(lx, lz);
        part('box', px, gy + 0.36, pz, 0.09, 0.72, 0.09, rotY, wood);
      }
      // zwei Hocker an den Längsseiten, leicht asymmetrisch (bewohnt, nicht gedeckt).
      // Jeder Hocker steht auf SEINER Bodenhöhe — mit der Gruppenhöhe versank am
      // Dünenhang vor der Taverne der halbe Hocker im Sand (Befund Pose 6).
      for (const [hx, hz, hr] of [[0, -0.82, 0.3], [0.15, 0.85, -0.4]]) {
        [px, pz] = at(hx, hz);
        const hgy = groundY(px, pz);
        const hy = rotY + hr;
        part('box', px, hgy + 0.45, pz, 0.42, 0.06, 0.42, hy, wood);
        const hc = Math.cos(hy); const hs = Math.sin(hy);
        for (const [lx, lz] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) {
          part('box', px + lx * hc + lz * hs, hgy + 0.225, pz - lx * hs + lz * hc,
            0.07, 0.45, 0.07, hy, wood);
        }
      }
      addAO(x, z, 2.6);
      obstacles.push({ x, z, radius: r, topY: gy + 0.76 }); // Tischplatte ist Stehfläche
    }

    // Sitzbank mit Lehne (am Brunnen): Sitz + Lehne + zwei Wangen
    function bench(x, z, rotY) {
      const r = 0.85;
      if (!furnitureFits(x, z, r, 'Bank')) return;
      const gy = groundY(x, z);
      const wood = WOOD[1];
      const cs = Math.cos(rotY); const sn = Math.sin(rotY);
      const at = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
      let [px, pz] = at(0, 0);
      part('box', px, gy + 0.44, pz, 1.55, 0.08, 0.45, rotY, wood);
      [px, pz] = at(0, -0.24);
      part('box', px, gy + 0.72, pz, 1.55, 0.5, 0.07, rotY, wood, -0.12);
      for (const lx of [-0.62, 0.62]) {
        [px, pz] = at(lx, 0);
        part('box', px, gy + 0.2, pz, 0.1, 0.4, 0.4, rotY, wood);
      }
      addAO(x, z, 1.8);
      obstacles.push({ x, z, radius: r, topY: gy + 0.48 });
    }

    // Pflanzkübel: Fass-Hälfte + Busch (Kugel) — Grün auf Menschenhöhe am Markt
    function tub(x, z, li) {
      const r = 0.35;
      if (!furnitureFits(x, z, r, 'Kübel')) return;
      const gy = groundY(x, z);
      part('cyl', x, gy + 0.24, z, 0.62, 0.48, 0.62, 0, 0xcdaa80);
      part('sph', x, gy + 0.75, z, 0.52, 0.46, 0.52, 0, LEAF[li % LEAF.length]);
      addAO(x, z, 0.9);
      obstacles.push({ x, z, radius: r, topY: gy + 0.5 });
    }

    // Schild: Pfosten + schräg genageltes Brett (Marktstand, Wegkreuzung)
    function sign(x, z, rotY) {
      const r = 0.2;
      if (!furnitureFits(x, z, r, 'Schild')) return;
      const gy = groundY(x, z);
      part('cyl', x, gy + 0.85, z, 0.09, 1.7, 0.09, 0, 0xe0c9a8);
      part('box', x, gy + 1.45, z, 0.95, 0.5, 0.06, rotY, 0xfff2d8, 0, 0.045);
      addAO(x, z, 0.6);
      obstacles.push({ x, z, radius: r });
    }

    // Funktionsorte. Alle Positionen sind gegen Türvorplätze, Gehspuren und die
    // Klemm-Zonen-Regel gerechnet (furnitureFits prüft es zur Bauzeit nach):
    // Die Abstände zu den ZUFÄLLIG gestreuten Clustern sind auf deren maximale
    // Reichweite gerechnet (Zentrum + 2.4 m Ring + 0.83 m Prop-Radius): so passt die
    // Möblierung in JEDEM Seed, nicht nur im gerade gewürfelten.
    tableSet(-21.2, -16.8, 0.5, 0);   // vor der Markisen-Taverne (-24,-16)
    tableSet(-6.6, -21.5, 0.15, 1);   // vor dem Platzrand-Haus (-10,-22), neben dem Fass
    tableSet(21.7, 14.8, -2.2, 2);    // vor dem Osthaus (26,14)
    // Bank WEST des Brunnens, mit der Laterne (-3.4,3.2) verschmolzen. Der erste
    // Platz (3.4,7.8) stand in der Lenk-Zone des Hafenweg-Spaziergängers an seinem
    // Süd-Wendepunkt: Bewohner 0 verlor dort 204 Bewegungs-Frames (Sonde
    // probe_moonwalk.mjs), und weil die Moonwalk-Quote durch die Bewegungs-Frames
    // TEILT, kippte sie von 0.293 auf 0.294 % — bei unverändert 169 Moonwalk-Frames.
    bench(-3.3, 3.9, 1.571 + 0.4);    // Blick über den Platz auf den Brunnen
    tub(10.4, 26.0, 0);               // Nordflanke des Marktstands am Hafenweg
    tub(17.5, 36.9, 1);               // flankiert den Stand in der Wegkurve
    sign(10.9, 24.1, 2.6);            // Stand-Schild, verschmolzen mit der Theke
    sign(12.0, 30.6, 0.9);            // an der Wegkreuzung Hafen/Nordwest

    // ---- InstancedMeshes bauen (eine je Grundform) ----
    // Holzteile (box/cyl) teilen sich die Plank-Textur der Bestands-Props; die
    // Blattkugeln bekommen ein map-freies Material — Grün über Plankenmaserung
    // sähe aus wie schimmliges Holz.
    const furnWoodMat = new THREE.MeshStandardMaterial({
      map: mats.wood.map, roughness: 0.9, metalness: 0,
    });
    const furnLeafMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    const col = new THREE.Color();
    for (const [kind, g, mat] of [
      ['box', geo.box, furnWoodMat], ['cyl', geo.cylinder, furnWoodMat],
      ['sph', geo.sphere, furnLeafMat],
    ]) {
      const list = parts[kind];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(g, mat, list.length);
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i].m);
        mesh.setColorAt(i, col.setHex(list[i].color));
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // ---- Wege: Platz -> Hafen / Turm / West- und Ost-Häuser (sichtbar anderer Boden) ----
  {
    const geos = pathDefs.map((pts) => pathRibbonGeo(pts, PATH_WIDTH, groundY));
    const pathTex = dirtPathTexture();
    const pathMat = new THREE.MeshStandardMaterial({
      map: pathTex, roughness: 1.0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    const paths = new THREE.Mesh(mergeGeometries(geos), pathMat);
    paths.receiveShadow = true;
    scene.add(paths);
    // Vegetation hält die Wege frei (R13-Kritik #8)
    ctx.pathDefs = pathDefs;
    ctx.pathWidth = PATH_WIDTH;
  }
}
