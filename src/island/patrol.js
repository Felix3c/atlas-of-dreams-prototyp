// island/patrol.js — R23 Aufgabe D: der Marine-Timeout wird DIEGETISCH.
//
// Felix (R22): „Ich steh an einem ganz anderen Punkt und plötzlich kommen die
// Marineleute auf mich zu — das macht keinen Sinn." Der 180-s-Timeout bleibt
// der Zeitgeber (main.js PEACE_MAX_T) — dieses Modul liefert die SICHTBARE
// URSACHE davor: zur Vorwarnzeit legt ein Patrouillen-Boot am Steg an (Muster
// Episoden-Ruderboot; das vertäute Arena-Boot bleibt unberührt), 3 Marines
// steigen aus und marschieren die Hafenstraße hoch. Beim Timeout dreht sich
// die Patrouille zu Milo — Wiedererkennen-Beat („That's him — the boy from
// the plaza!", Zeile zeigt main.js über den Episoden-Untertitel), DANN läuft
// das bestehende endPeace('timeout') unverändert.
//
// GRENZEN (Auftrag D.4): reine INSZENIERUNG. Spawn-System/Wellen-Logik bleiben
// unangetastet — die Kampf-Marines spawnen wie bisher aus enemies.js; die
// Lande-Statisten hier despawnen sauber dahinter (Scale-Blende, R20/R22-Muster).
// Kein castShadow, keine neuen Kollider (die Patrouille läuft auf Steg + Weg).
import * as THREE from 'three';
import { buildMarine } from '../enemies.js';

const APPROACH_T = 8;     // s: Boot rudert von draußen an den Steg
const STEP_STAGGER = 1.0; // s Abstand zwischen den aussteigenden Marines
const STEP_T = 1.2;       // s: ein Marine steigt vom Boot aufs Deck
const MARCH_SPEED = 2.1;  // m/s die Hafenstraße hoch
const FADE_T = 0.5;       // s Scale-Blende beim Entsorgen
// R24 (Bewegtbild-Feinschliff): Kolonnen-Abstand 1.6 -> 2.4 m — im Browser las
// sich die enge Dreierreihe als Pulk, nicht als Patrouille. Marsch-Wippen im
// GLEICHSCHRITT (eine Kadenz für alle drei — Militär-Look) statt je eigener Phase.
const COLUMN_GAP = 2.4;    // m Abstand in der Marschkolonne
const MARCH_CADENCE = 5.6; // rad/s gemeinsamer Schritt-Takt (~0.9 Schritte/s)

export function createPatrol(ctx) {
  const { scene, PIER, groundHeightAt, updaters } = ctx;

  // Anlegestelle: die WESTseite des Stegs — das vertäute Arena-Boot liegt bei
  // +4.3 auf der Ostseite (harbor.js) und bleibt unberührt.
  const DOCK = { x: PIER.x - 3.6, z: PIER.endZ - 2.5 };
  // R25 Aufgabe 2: 102 -> 85 — das Boot stand im Küsten-Dunst und war in der
  // 8-s-Anfahrt erst spät erkennbar (R24-Befund); bei 85 startet es diesseits
  // des Dunsts (Vorher/Nachher: shots/r25-boat-102-*.png vs r25-boat-85-*.png).
  const BOAT_START_Z = 85;

  // Marschroute: Stegdeck -> Hafenstraße (pathDefs-Punkte des Hafenwegs) ->
  // Platzrand. groundHeightAt kennt den Steg-Korridor (deckY) von selbst.
  const ROUTE = [
    { x: PIER.x - 0.8, z: PIER.endZ - 2 },
    { x: PIER.x, z: 55 },
    { x: 14, z: 49 },
    { x: 13.8, z: 38.1 },
    { x: 9.7, z: 31.8 },
    { x: 5.3, z: 20.1 },
    { x: 2.2, z: 12 },
  ];
  const segLen = [];
  let routeLen = 0;
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const l = Math.hypot(ROUTE[i + 1].x - ROUTE[i].x, ROUTE[i + 1].z - ROUTE[i].z);
    segLen.push(l);
    routeLen += l;
  }
  function routeAt(s) {
    let rest = Math.max(0, Math.min(routeLen, s));
    for (let i = 0; i < segLen.length; i++) {
      if (rest <= segLen[i]) {
        const k = segLen[i] > 0 ? rest / segLen[i] : 0;
        const a = ROUTE[i], b = ROUTE[i + 1];
        return {
          x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k,
          yaw: Math.atan2(b.x - a.x, b.z - a.z),
        };
      }
      rest -= segLen[i];
    }
    const a = ROUTE[ROUTE.length - 2], b = ROUTE[ROUTE.length - 1];
    return { x: b.x, z: b.z, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  }

  function buildBoat() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5f5a52, roughness: 0.9 });
    const hull = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x5f5a52, roughness: 0.9, side: THREE.DoubleSide }),
    );
    hull.scale.set(1.15, 0.66, 2.8);
    g.add(hull);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 6, 24), wood);
    rim.rotation.x = -Math.PI / 2;
    rim.scale.set(1.15, 2.8, 1);
    g.add(rim);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 3.9), wood);
    floor.position.y = -0.36;
    g.add(floor);
    for (const bz of [-1.0, 0, 1.0]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.4), wood);
      bench.position.set(0, -0.06, bz);
      g.add(bench);
    }
    // kleiner Marine-Wimpel am Heck — die Patrouille ist als Marine lesbar
    const mastP = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), wood);
    mastP.position.set(0, 0.5, -1.7);
    g.add(mastP);
    const pennant = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x2a4a8a, roughness: 0.9, side: THREE.DoubleSide }),
    );
    pennant.position.set(0.26, 0.9, -1.7);
    g.add(pennant);
    return g;
  }

  // Zustand: 'off' | 'approach' | 'disembark' | 'march' | 'recognize' | 'fade'
  let mode = 'off';
  let t = 0;
  let boat = null;
  let marines = [];   // { obj, state, s (Routen-Meter), stepFrom:V3, stepTo:V3 }
  let fadeK = 1;

  function disposeObject3D(obj) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) { if (!m) continue; if (m.map) m.map.dispose(); m.dispose(); }
    });
  }

  function removeAll() {
    if (boat) { scene.remove(boat); disposeObject3D(boat); boat = null; }
    for (const m of marines) { scene.remove(m.obj); disposeObject3D(m.obj); }
    marines = [];
    mode = 'off';
  }

  updaters.push((dt, tGlobal, playerPos) => {
    if (mode === 'off') return;
    t += dt;

    if (mode === 'fade') {
      fadeK = Math.max(0.001, fadeK - dt / FADE_T);
      if (boat) boat.scale.setScalar(fadeK);
      for (const m of marines) m.obj.scale.setScalar(fadeK);
      if (fadeK <= 0.002) removeAll();
      return;
    }

    // Boot: Anfahrt + Dümpeln (das vertäute Arena-Boot dümpelt genauso — harbor.js)
    if (boat) {
      if (mode === 'approach') {
        const k = Math.min(1, t / APPROACH_T);
        const sm = k * k * (3 - 2 * k);
        boat.position.z = BOAT_START_Z + (DOCK.z - BOAT_START_Z) * sm;
        boat.position.x = DOCK.x + Math.sin(k * 5) * 0.4 * (1 - sm);
        boat.rotation.y = Math.PI + Math.sin(t * 1.3) * 0.04;
        // R24 (Anlege-Look): Fahrt-Nick — der Bug taucht bei voller Fahrt leicht
        // ein (Tempo-Profil 4k(1-k) der smoothstep-Ableitung) und richtet sich
        // beim Anlegen auf; darunter bleibt der Wellen-Nick bestehen.
        boat.rotation.x = -0.055 * (4 * k * (1 - k)) + Math.sin(tGlobal * 1.7) * 0.018;
      } else {
        boat.rotation.x = Math.sin(tGlobal * 1.7) * 0.015; // vertäut: nur Wellen-Nick
      }
      boat.position.y = -0.35 + Math.sin(tGlobal * 1.1) * 0.05;
      boat.rotation.z = Math.sin(tGlobal * 0.9 + 1) * 0.03;
      // Marines sitzen bis zu ihrem Ausstieg im Boot
      for (let i = 0; i < marines.length; i++) {
        const m = marines[i];
        if (m.state !== 'seated') continue;
        m.obj.position.set(boat.position.x, boat.position.y + 0.35, boat.position.z - 1 + i);
        m.obj.rotation.y = Math.PI; // Blick zum Steg/Bug
      }
    }

    if (mode === 'approach' && t >= APPROACH_T) {
      mode = 'disembark';
      t = 0;
    } else if (mode === 'disembark') {
      // gestaffelt: Marine i steigt ab i*STEP_STAGGER ueber STEP_T aufs Deck
      let allOut = true;
      for (let i = 0; i < marines.length; i++) {
        const m = marines[i];
        const k = (t - i * STEP_STAGGER) / STEP_T;
        if (k < 0) { allOut = false; continue; }
        if (k < 1) {
          allOut = false;
          if (m.state === 'seated') {
            m.state = 'stepping';
            m.stepFrom = m.obj.position.clone();
            const deckPt = routeAt(i * COLUMN_GAP); // Startabstand in der Marschkolonne
            m.stepTo = new THREE.Vector3(deckPt.x, groundHeightAt(deckPt.x, deckPt.z), deckPt.z);
          }
          const sm = k * k * (3 - 2 * k);
          m.obj.position.lerpVectors(m.stepFrom, m.stepTo, sm);
          m.obj.position.y += Math.sin(sm * Math.PI) * 0.25; // Schritt über die Bordwand
          m.obj.rotation.y = Math.atan2(m.stepTo.x - m.stepFrom.x, m.stepTo.z - m.stepFrom.z);
        } else if (m.state !== 'marching') {
          m.state = 'marching';
          m.s = i * COLUMN_GAP;
        }
      }
      if (allOut) { mode = 'march'; t = 0; }
    } else if (mode === 'march') {
      // Kolonne: Anführer vorn, die anderen im festen Abstand dahinter
      for (let i = 0; i < marines.length; i++) {
        const m = marines[i];
        if (m.state !== 'marching') continue;
        m.s = Math.min(routeLen - i * COLUMN_GAP, m.s + MARCH_SPEED * dt);
        const p = routeAt(m.s);
        const atEnd = m.s >= routeLen - i * COLUMN_GAP - 0.01;
        // R24: Gleichschritt — EINE Kadenz für alle drei (Militär-Look); am Ziel
        // fällt der Takt in ein leises individuelles Stand-Wippen zurück.
        m.obj.position.set(
          p.x,
          groundHeightAt(p.x, p.z) + Math.abs(Math.sin(atEnd ? tGlobal * 5 + i * 2 : tGlobal * MARCH_CADENCE)) * (atEnd ? 0.02 : 0.055),
          p.z,
        );
        // am Ziel: Umschauen („sie suchen dich im Dorf") statt stur geradeaus
        m.obj.rotation.y = atEnd ? p.yaw + Math.sin(tGlobal * 0.7 + i * 2.1) * 0.6 : p.yaw;
        // R24: Marsch-Wippen — gemeinsames seitliches Pendeln auf halber
        // Schrittfrequenz + leichte Vorlage; am Ziel beides sauber auf null
        // (rotation.x gehört dann dem Wiedererkennen-Lean des Anführers).
        m.obj.rotation.z = atEnd ? 0 : Math.sin(tGlobal * MARCH_CADENCE * 0.5) * 0.05;
        if (mode === 'march') m.obj.rotation.x = atEnd ? 0 : 0.05;
      }
    } else if (mode === 'recognize' && playerPos) {
      // alle drehen sich zu Milo; der Anführer lehnt sich vor — die Zeigegeste
      for (let i = 0; i < marines.length; i++) {
        const m = marines[i];
        const yaw = Math.atan2(playerPos.x - m.obj.position.x, playerPos.z - m.obj.position.z);
        let d = yaw - m.obj.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        m.obj.rotation.y += d * Math.min(1, dt * 8);
        if (i === 0) m.obj.rotation.x = Math.min(0.22, (m.obj.rotation.x || 0) + dt * 0.8);
      }
    }
  });

  return {
    get active() { return mode !== 'off' && mode !== 'fade'; },
    // Darf der Wiedererkennen-Beat starten? Erst wenn die Patrouille GELANDET
    // und nah genug ist, um Milo zu SEHEN — sonst zeigte ein Marine 100 m
    // draußen vom Boot aus auf ihn (Live-Befund: Episode endet nach t>180,
    // Vorwarnung und Timeout fielen in denselben Frame).
    canRecognize(playerPos) {
      if (mode === 'recognize') return true;
      if (mode !== 'march') return false;
      const lead = marines[0];
      if (!lead) return false;
      if (lead.s >= routeLen - 2) return true; // am Platzrand angekommen
      return !!playerPos && Math.hypot(
        playerPos.x - lead.obj.position.x, playerPos.z - lead.obj.position.z) < 22;
    },
    // Vorwarnzeit: Boot + 3 Marines erscheinen weit draußen und legen an
    begin() {
      if (mode !== 'off') return;
      removeAll();
      mode = 'approach';
      t = 0;
      fadeK = 1;
      boat = buildBoat();
      boat.position.set(DOCK.x, -0.35, BOAT_START_Z);
      boat.rotation.y = Math.PI;
      scene.add(boat);
      marines = [];
      for (let i = 0; i < 3; i++) {
        const m = buildMarine(i === 0 ? 'petty' : 'swabbie').group;
        m.traverse((o) => { o.castShadow = false; }); // weit außerhalb des ±76-Frustums
        scene.add(m);
        marines.push({ obj: m, state: 'seated', s: 0 });
      }
    },
    // Timeout + Spieler in der Kampfzone: der Wiedererkennen-Beat (main.js zeigt
    // die Zeile und ruft nach ~2 s das bestehende endPeace('timeout') auf)
    recognize() {
      if (mode === 'off' || mode === 'fade') return;
      mode = 'recognize';
      t = 0;
    },
    // nach endPeace: die Statisten verschwinden hinter dem Alarm-Beat
    // (Scale-Blende — die echten Kampf-Marines spawnen wie bisher aus enemies.js)
    clear() {
      if (mode === 'off') return;
      mode = 'fade';
    },
    // harte Entsorgung (Neustart)
    reset() { removeAll(); },
  };
}
