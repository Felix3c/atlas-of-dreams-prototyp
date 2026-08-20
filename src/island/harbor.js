// island/harbor.js — Hafen: Holzsteg ins Wasser + das Ruderboot (WELT.md: der Aufbruch beginnt hier)
import * as THREE from 'three';
import { plankTexture } from './textures.js';

const POST_SPACING = 3.4;      // Meter zwischen Steg-Pfahlpaaren
const COLLIDER_SPACING = 1.4;  // dichte Trittfläche: Kreis-Kollider überlappen sich sicher
const COLLIDER_RADIUS = 2.2;
const DECK_THICKNESS = 0.14;

export function buildHarbor(ctx) {
  const { scene, obstacles, geo, mats, addShadow, addAO, updaters, lampPost, PIER } = ctx;
  const deckLen = PIER.endZ - PIER.shoreZ + 2; // beginnt 2m vor der Wasserlinie im Sand
  const deckMidZ = PIER.shoreZ - 2 + deckLen / 2;

  // ---- Steg-Deck: ein Brett-Quader, Plankentextur läuft wiederholt längs ----
  const deckTex = plankTexture();
  deckTex.repeat.set(1, 9); // sonst würde EIN Planken-Tile über die volle Steglänge gestreckt
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.9 });
  const deck = addShadow(new THREE.Mesh(geo.box, deckMat));
  deck.scale.set(PIER.halfWidth * 2, DECK_THICKNESS, deckLen);
  deck.position.set(PIER.x, PIER.deckY - DECK_THICKNESS / 2, deckMidZ);
  scene.add(deck);

  // ---- Pfähle: instanziert, paarweise links/rechts, bis unter die Wasseroberfläche ----
  {
    const nPairs = Math.ceil(deckLen / POST_SPACING) + 1;
    const posts = new THREE.InstancedMesh(geo.cylinder, mats.trunk, nPairs * 2);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const postH = 2.4; // von y-1.7 (im Wasser) bis knapp über das Deck
    for (let i = 0; i < nPairs; i++) {
      const z = PIER.shoreZ - 1 + Math.min(i * POST_SPACING, deckLen - 1);
      for (let s = 0; s < 2; s++) {
        const x = PIER.x + (s === 0 ? -1 : 1) * (PIER.halfWidth - 0.2);
        m4.compose(
          new THREE.Vector3(x, PIER.deckY + 0.5 - postH / 2, z),
          q,
          new THREE.Vector3(0.14, postH, 0.14)
        );
        posts.setMatrixAt(i * 2 + s, m4);
      }
    }
    posts.castShadow = true;
    scene.add(posts);
  }

  // ---- begehbare Trittfläche: überlappende topY-Kollider (bestehendes Standflächen-System) ----
  for (let z = PIER.shoreZ; z <= PIER.endZ; z += COLLIDER_SPACING) {
    obstacles.push({ x: PIER.x, z, radius: COLLIDER_RADIUS, topY: PIER.deckY });
  }

  // ---- Hafen-Laternen: eine am Stegfuß, eine am Stegende (warme Bloom-Akzente) ----
  lampPost(PIER.x - 3.2, PIER.shoreZ - 2);
  lampPost(PIER.x - PIER.halfWidth + 0.35, PIER.endZ - 0.8, PIER.deckY);

  // ---- Fracht am Stegfuß: das Dorf lebt vom Hafen ----
  ctx.crate(PIER.x + 3.4, PIER.shoreZ - 3.5, 1.2, 0.5);
  ctx.crate(PIER.x + 4.6, PIER.shoreZ - 2.7, 0.9, 1.2);
  ctx.barrel(PIER.x - 3.8, PIER.shoreZ - 4.5);
  ctx.barrel(PIER.x - 3.0, PIER.shoreZ - 3.7);

  // ---- DAS RUDERBOOT — klein, ehrlich, das sichtbare Versprechen des Spiels ----
  {
    const boat = new THREE.Group();
    const BOAT_X = PIER.x + 4.3;
    const BOAT_Z = PIER.endZ - 3;
    const BOAT_Y = -0.42; // Bordkante ~0.28 über der Wasserlinie (-0.7)

    // Rumpf: untere Halbkugel-Schale, lang gezogen — offene Schale, innen sichtbar
    const hullGeo = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({
      map: mats.wood.map, roughness: 0.9, side: THREE.DoubleSide,
    }));
    hull.scale.set(1.05, 0.62, 2.4);
    hull.castShadow = true;
    boat.add(hull);

    // Bordkante (Dollbord): flacher Torus-Ring um die Öffnung
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 6, 24), mats.trunk);
    rim.rotation.x = -Math.PI / 2;
    rim.scale.set(1.05, 2.4, 1);
    boat.add(rim);

    // Bodenbretter + zwei Sitzbänke
    const floor = new THREE.Mesh(geo.box, mats.wood);
    floor.scale.set(1.1, 0.05, 3.4);
    floor.position.y = -0.34;
    boat.add(floor);
    for (const bz of [-0.75, 0.75]) {
      const bench = new THREE.Mesh(geo.box, mats.wood);
      bench.scale.set(1.5, 0.08, 0.42);
      bench.position.set(0, -0.08, bz);
      boat.add(bench);
    }

    // zwei Ruder, quer über die Bänke gelegt
    for (const s of [-1, 1]) {
      const oar = new THREE.Group();
      const shaft = new THREE.Mesh(geo.cylinder, mats.trunk);
      shaft.scale.set(0.035, 2.5, 0.035);
      oar.add(shaft);
      const blade = new THREE.Mesh(geo.box, mats.wood);
      blade.scale.set(0.02, 0.5, 0.17);
      blade.position.y = 1.35;
      oar.add(blade);
      oar.position.set(s * 0.25, 0.02, s * 0.35);
      oar.rotation.z = Math.PI / 2 - s * 0.08; // liegt quer, leicht verkantet
      oar.rotation.y = s * 0.25;
      boat.add(oar);
    }

    // aufgeschossenes Tau im Bug + kleine Laterne am Heck (Bloom-Punkt)
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12), mats.rope);
    rope.rotation.x = -Math.PI / 2;
    rope.position.set(0, -0.28, -1.7);
    boat.add(rope);
    const lanternBody = new THREE.Mesh(geo.box, mats.iron);
    lanternBody.scale.set(0.14, 0.2, 0.14);
    lanternBody.position.set(0.3, 0.05, 1.85);
    boat.add(lanternBody);
    const lanternGlow = new THREE.Mesh(geo.sphere, mats.bulb);
    lanternGlow.scale.setScalar(0.06);
    lanternGlow.position.copy(lanternBody.position);
    boat.add(lanternGlow);

    boat.position.set(BOAT_X, BOAT_Y, BOAT_Z);
    boat.rotation.y = 0.18; // liegt leicht schräg vertäut am Steg
    scene.add(boat);

    // Festmacherleine: dünner Zylinder vom Bug zum nächsten Steg-Rand
    {
      const from = new THREE.Vector3(BOAT_X - 0.4, PIER.deckY - 0.05, BOAT_Z - 1.4);
      const to = new THREE.Vector3(PIER.x + PIER.halfWidth - 0.15, PIER.deckY + 0.1, BOAT_Z - 1.9);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const dir = to.clone().sub(from);
      const line = new THREE.Mesh(geo.cylinder, mats.rope);
      line.scale.set(0.03, dir.length(), 0.03);
      line.position.copy(mid);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      scene.add(line);
    }

    // sanftes Dümpeln an der Vertäuung
    updaters.push((dt, t) => {
      boat.position.y = BOAT_Y + Math.sin(t * 0.9) * 0.05;
      boat.rotation.z = Math.sin(t * 0.7) * 0.045;
      boat.rotation.x = Math.sin(t * 0.55 + 1.3) * 0.03;
    });
  }

  addAO(PIER.x, PIER.shoreZ - 3, 4); // Kontaktschatten unter dem Fracht-Cluster
}
