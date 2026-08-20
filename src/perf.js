// perf.js — die Messsonde. Runde 15.
//
// Warum das committet ist und nicht ad hoc in der Konsole passiert: Runde 14 hat
// "50,2 ms GPU" gemessen, aber die Methode war nicht wiederholbar. Ohne wiederholbare
// Zahl diskutieren fuenf Agenten ueber Bloom. Mit ihr rechnet einer.
//
// Aufruf:
//   ?perf                     Basismessung (3 s Aufwaermen + 20 s Messfenster)
//   ?perf&nobloom             UnrealBloomPass aus
//   ?perf&noshadow            shadowMap.enabled = false
//   ?perf&nopoint             PointLights raus
//   ?perf&nograde             Grade-ShaderPass aus
//   ?perf&noaa                WebGLRenderer ohne antialias
//   ?perf&dpr=1               Pixelverhaeltnis erzwingen
//   ?perf&novillagers         (bestehendes Flag aus arena.js)
//   ?perf&secs=10             Messfenster kuerzen
//   ?shot=3                   Kamera auf feste Pose 3, kein Messlauf
//
// Ergebnis landet in window.__PERF_RESULT und als eine JSON-Zeile in der Konsole,
// praefixiert mit PERFJSON: — daran zieht der Auswerter sie raus.

const params = new URLSearchParams(location.search);

export const PERF_ON = params.has('perf');
export const SHOT_POSE = params.has('shot') ? Number(params.get('shot')) : null;
export const PERF_ACTIVE = PERF_ON || SHOT_POSE !== null;

// antialias muss VOR der Renderer-Konstruktion bekannt sein — deshalb hier und
// nicht im createPerf().
// MSAA ist seit Runde 15 standardmaessig AUS: gemessen war gl.SAMPLES = 4, aber die
// Szene geht in die Composer-Targets — ins Default-Framebuffer schreibt nur ein
// Vollbild-Dreieck, das von MSAA nichts hat. ?aa schaltet es zum Vergleich wieder an.
export const WANT_AA = params.has('aa');
export const DPR_CAP = params.has('dpr') ? Number(params.get('dpr')) : 2;

// ---------------------------------------------------------------------------
// Welt festnageln.
//
// village.js, vegetation.js, textures.js und villagers.js ziehen zusammen an 89
// Stellen Math.random(). Jede Seitenladung baut also ein anderes Dorf: andere
// Kistenstapel, andere Palmen, andere Putzflecken. Fuer den Blindvergleich alt
// gegen neu ist das toedlich — der Kritiker saehe Unterschiede im Inhalt und
// hielte sie fuer Unterschiede im Look. Und die Messung bekaeme bei jedem Lauf
// eine andere Geometrie.
//
// Im Mess- und Schussmodus wird Math.random deshalb durch einen gesetzten
// Generator ersetzt. Das passiert beim Import, also bevor createArena() laeuft.
// Das Normalspiel bleibt unberuehrt und wuerfelt weiter.
if (PERF_ACTIVE) {
  let s = (params.has('seed') ? Number(params.get('seed')) : 1337) >>> 0;
  Math.random = function seeded() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WARMUP_S = 3;
const MEASURE_S = params.has('secs') ? Number(params.get('secs')) : 20;

// Gepaarte Messung: ?ab=bloom|shadow|grade|point
//
// Warum das noetig ist: zwei Laeufe hintereinander liefern auf dieser Maschine
// 110 ms und 58 ms fuer DENSELBEN Code. Die Umgebung driftet um Faktor 2 — jede
// Ablation, die zwischen zwei Laeufen verglichen wird, misst die Drift, nicht die
// Funktion. Also wird JEDER ZWEITE FRAME umgeschaltet und die GPU-Proben in zwei
// Eimer sortiert. Beide Eimer sehen dieselbe Sekunde, dieselbe Temperatur,
// dieselbe Hintergrundlast und (bei fester Pose) dieselbe Geometrie.
// Uebrig bleibt genau der Unterschied, den die Funktion macht.
export const AB = params.get('ab');
// Blockgroesse fuer ?ab=softshadow (Frames pro Seite) — Begruendung in begin().
const AB_BLOCK = 60;
const AB_POSE = params.has('pose') ? Number(params.get('pose')) : 3;

// ---------------------------------------------------------------------------
// Kamerafahrt: feste Wegpunkte durchs Dorf, ueber die Zeit parametrisiert.
//
// Zeitparametrisiert, nicht bildparametrisiert: ein schnellerer Build darf nicht
// weiter laufen und damit andere Geometrie ins Bild bekommen. Gleiche Sekunde =
// gleicher Ort = vergleichbare Zahl.
//
// Die Route beruehrt absichtlich die teuren Blickrichtungen: vom Turm zurueck aufs
// Dorf sieht man alle Haeuser, alle Bewohner und die Laternen gleichzeitig.
const PATH = [
  { p: [0, 10], yaw: 0 },             // Spawn, Blick -Z (Turm)
  { p: [-7, 4], yaw: 0.5 },           // links am Brunnen vorbei, Blick auf die Haeuserzeile
  { p: [-10, -8], yaw: 0.2 },         // Westgasse
  { p: [-2, -22], yaw: -0.3 },        // Richtung Wachturm
  { p: [1, -28], yaw: Math.PI },      // am Turm, Blick ZURUECK aufs Dorf (teuerster Frame)
  { p: [6, -14], yaw: Math.PI * 0.8 },
  { p: [9, 2], yaw: Math.PI * 1.15 }, // Ostseite, Blick auf Hafen/Steg
  { p: [4, 12], yaw: Math.PI * 1.6 },
  { p: [0, 10], yaw: 0 },             // zurueck zum Spawn — geschlossene Schleife
];

// Feste Posen fuer den Blindvergleich alt/neu. Andere Aufgabe als die Fahrt:
// hier zaehlt nur, dass Pose N vorher und nachher dieselbe ist.
const SHOTS = [
  null,
  { p: [0, 10], yaw: 0, pitch: -0.18 },             // 1: Spawnblick — Brunnen, Platz, Turm hinten
  { p: [-6, 2], yaw: 0.6, pitch: -0.12 },           // 2: Haeuserzeile schraeg, Putz + Schatten
  { p: [1, -26], yaw: Math.PI, pitch: -0.10 },      // 3: vom Turm zurueck — die Weitsicht
  { p: [8, 6], yaw: Math.PI * 1.35, pitch: -0.15 }, // 4: Hafen, Laternen, Ruderboot (Bloom)
  { p: [-3, 7], yaw: Math.PI * 0.15, pitch: 0.05 }, // 5: himmelwaerts — Sonne, Bloom, Nebel
  // Runde 17: Posen auf die Moeblierung (Aufgabe B) — im Browser eingerichtet
  // ueber die px/pz/yaw/pitch-Override-Parameter unten, dann hier eingefroren.
  { p: [-18.6, -14.4], yaw: -2.55, pitch: -0.30 },  // 6: Tischgruppe vor der Taverne (-24,-16)
  { p: [8.5, 29.5], yaw: 2.95, pitch: -0.30 },      // 7: Marktstand — Kuebel, Schild, Haendler
  { p: [-3.1, 7.6], yaw: 3.0, pitch: -0.32 },       // 8: Bank an der Laterne, Platzueberblick
];

export const SHOT_COUNT = SHOTS.length - 1;

function samplePath(u) {
  const segs = PATH.length - 1;
  const f = u * segs;
  const i = Math.min(segs - 1, Math.floor(f));
  const k = f - i;
  const a = PATH[i];
  const b = PATH[i + 1];
  // smoothstep statt linear: keine Rucke an den Wegpunkten, die Kamera-Lerp in
  // updateCamera() wuerde sie sonst als Ausschlaege in die Frametime tragen
  const s = k * k * (3 - 2 * k);
  let dy = b.yaw - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  return {
    x: a.p[0] + (b.p[0] - a.p[0]) * s,
    z: a.p[1] + (b.p[1] - a.p[1]) * s,
    yaw: a.yaw + dy * s,
  };
}

// ---------------------------------------------------------------------------

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

function round(v, d = 2) {
  return v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d;
}

function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
}

class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.samples = [];
    this.buckets = new Map(); // tag -> ms[]
    this.disjointHits = 0;
    this.active = null;
  }

  get available() { return !!this.ext; }

  begin() {
    if (!this.ext || this.active) return;
    const gl = this.gl;
    const q = gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  // tag: null = nicht aufzeichnen, sonst der Eimer, in den die Probe gehoert.
  // Der Tag muss mitreisen, weil das Ergebnis erst Frames spaeter eintrifft — sonst
  // landet die Messung bei der falschen Konfiguration.
  end(tag) {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push({ q: this.active, tag });
    this.active = null;
  }

  // Ergebnisse trudeln erst Frames spaeter ein — jeden Frame einsammeln, was fertig ist.
  poll() {
    if (!this.ext) return;
    const gl = this.gl;
    if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      // GPU wurde unterbrochen (Kontextwechsel, Energiesparmodus) — alle schwebenden
      // Messungen sind Muell und werden verworfen, nicht mitgemittelt.
      this.disjointHits += this.pending.length;
      for (const e of this.pending) gl.deleteQuery(e.q);
      this.pending.length = 0;
      return;
    }
    let i = 0;
    while (i < this.pending.length) {
      const e = this.pending[i];
      if (gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) {
        const ns = gl.getQueryParameter(e.q, gl.QUERY_RESULT);
        gl.deleteQuery(e.q);
        if (e.tag) {
          const ms = ns / 1e6;
          this.samples.push(ms);
          if (!this.buckets.has(e.tag)) this.buckets.set(e.tag, []);
          this.buckets.get(e.tag).push(ms);
        }
        this.pending.splice(i, 1);
      } else {
        i++;
      }
    }
  }
}

function gpuName(gl) {
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
  } catch { /* manche Browser sperren das ab */ }
  return 'unknown';
}

// ---------------------------------------------------------------------------

export function createPerf(ctx) {
  // ctx: { renderer, scene, camera, composer, passes:{bloom,grade}, player,
  //        setYaw, setPitch }
  if (!PERF_ACTIVE) {
    // Nullobjekt: im Normalspiel kostet die Sonde nichts und faellt aus dem Weg.
    return {
      enabled: false, shot: false,
      begin() {}, end() {}, drive() {}, applyAblations() {}, tickStart() {},
    };
  }

  const { renderer, scene, player } = ctx;
  const gl = renderer.getContext();
  const timer = new GpuTimer(gl);

  const flags = {
    nobloom: params.has('nobloom'),
    noshadow: params.has('noshadow'),
    nopoint: params.has('nopoint'),
    nograde: params.has('nograde'),
    noaa: params.has('noaa'),
    novillagers: params.has('novillagers'),
    dpr: DPR_CAP,
  };

  const label = params.get('label')
    || Object.entries(flags).filter(([, v]) => v === true).map(([k]) => k).join('+')
    || 'baseline';

  let t0 = null;
  let lastFrameT = null;
  let tickStartT = null;
  let recording = false;
  let done = false;
  const frameMs = [];
  const cpuUpdateMs = []; // Spiellogik: alles vor dem Bild (KI, Physik, Animation)
  const cpuSubmitMs = []; // CPU-Anteil des Renderns: Culling, Uniforms, Draw-Call-Abgabe
  const drawCalls = [];
  const tris = [];
  let removedLights = 0;
  let abFrame = 0;
  let abOn = true;

  // Die Lichter werden nicht entfernt, sondern nur ausgeblendet (intensity 0 waere
  // ein Rechenweg weniger, aber KEIN Shader-Wechsel — visible=false nimmt sie aus
  // der Lichtliste und aendert damit denselben Programm-Schluessel wie das Loeschen).
  const pointLights = [];
  const shadowCasters = [];
  // Für ?ab=softshadow: nur schattenempfangende Materialien sampeln die
  // Schattenkarte — nur deren Programme haengen am shadowMap.type.
  const shadowMats = [];
  scene.traverse((o) => {
    if (o.isPointLight) pointLights.push(o);
    if (o.isLight && o.castShadow) shadowCasters.push(o);
    if (o.isMesh && o.receiveShadow && o.material) shadowMats.push(o.material);
  });

  function setFeature(name, on) {
    switch (name) {
      case 'bloom': if (ctx.passes.bloom) ctx.passes.bloom.enabled = on; break;
      case 'grade': if (ctx.passes.grade) ctx.passes.grade.enabled = on; break;
      case 'shadow':
        // Beides umlegen: shadowMap.enabled allein spart nur den Schattenpass.
        // Der teure Teil sind die PCF-Abgriffe im Hauptshader, und die fallen erst
        // weg, wenn das Licht nicht mehr als Schattenwerfer in der Lichtliste steht
        // (three waehlt daraufhin die andere, gecachte Programmvariante).
        renderer.shadowMap.enabled = on;
        for (const l of shadowCasters) l.castShadow = on;
        break;
      case 'point': for (const l of pointLights) l.visible = on; break;
      case 'softshadow':
        // R16 Aufgabe B: PCFSoft (on) gegen PCF (off). Der Typwechsel aendert
        // den Programm-Schluessel aller schattenempfangenden Materialien;
        // three kompiliert beim ersten Umschalten beide Varianten und cached
        // sie (das settled-Fenster in end() schluckt genau diese Frames).
        // needsUpdate pro Material ist noetig, sonst greift der Typwechsel
        // nicht — der Aufwand ist symmetrisch in beiden Eimern.
        // 2/1 = THREE.PCFSoftShadowMap/PCFShadowMap (kein three-Import hier;
        // perf.js bleibt bewusst importfrei, es bekommt alles ueber ctx).
        renderer.shadowMap.type = on ? 2 : 1;
        for (const m of shadowMats) m.needsUpdate = true;
        break;
      default: break;
    }
  }

  function applyAblations() {
    // renderer.info setzt sich bei JEDEM renderer.render() zurueck, und der
    // EffectComposer ruft das einmal pro Pass. Wer die Zaehler einfach ausliest,
    // bekommt den letzten Pass — ein Fullscreen-Dreieck, "1 Draw-Call". Manuell
    // zuruecksetzen, dann summieren sie ueber alle Paesse eines Bildes.
    renderer.info.autoReset = false;
    // Jede Ablation aendert genau EINE Sache. Sonst misst man eine Summe und
    // schreibt sie einem Verdaechtigen zu.
    if (flags.noshadow) renderer.shadowMap.enabled = false;
    if (flags.nobloom && ctx.passes.bloom) ctx.passes.bloom.enabled = false;
    if (flags.nograde && ctx.passes.grade) ctx.passes.grade.enabled = false;
    if (flags.nopoint) {
      const kill = [];
      scene.traverse((o) => { if (o.isPointLight) kill.push(o); });
      for (const l of kill) l.parent?.remove(l);
      removedLights = kill.length;
    }
  }

  function abSummary() {
    const on = [...(timer.buckets.get('on') || [])].sort((a, b) => a - b);
    const off = [...(timer.buckets.get('off') || [])].sort((a, b) => a - b);
    const onP50 = percentile(on, 0.5);
    const offP50 = percentile(off, 0.5);
    return {
      feature: AB,
      pose: AB_POSE,
      on: { p50: round(onP50), p25: round(percentile(on, 0.25)), p75: round(percentile(on, 0.75)), n: on.length },
      off: { p50: round(offP50), p25: round(percentile(off, 0.25)), p75: round(percentile(off, 0.75)), n: off.length },
      costMs: round(onP50 - offP50),
      costPct: onP50 ? round(((onP50 - offP50) / onP50) * 100, 1) : null,
    };
  }

  function report() {
    const fs = [...frameMs].sort((a, b) => a - b);
    const gs = [...timer.samples].sort((a, b) => a - b);
    const res = {
      label,
      flags,
      gpu: gpuName(gl),
      viewport: {
        css: [window.innerWidth, window.innerHeight],
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        devicePixelRatio: window.devicePixelRatio,
        appliedPixelRatio: renderer.getPixelRatio(),
      },
      window_s: MEASURE_S,
      frames: frameMs.length,
      fps_mean: round(frameMs.length / MEASURE_S, 2),
      frameMs: {
        p50: round(percentile(fs, 0.5)),
        p95: round(percentile(fs, 0.95)),
        mean: round(mean(frameMs)),
      },
      // Wo geht die Zeit hin? gpuMs + cpuUpdate + cpuSubmit erklaeren den Frame.
      cpuUpdateMs: {
        p50: round(percentile([...cpuUpdateMs].sort((a, b) => a - b), 0.5)),
        mean: round(mean(cpuUpdateMs)),
      },
      cpuSubmitMs: {
        p50: round(percentile([...cpuSubmitMs].sort((a, b) => a - b), 0.5)),
        mean: round(mean(cpuSubmitMs)),
      },
      gpuMs: timer.available ? {
        p50: round(percentile(gs, 0.5)),
        p95: round(percentile(gs, 0.95)),
        mean: round(mean(timer.samples)),
        samples: gs.length,
        disjointDropped: timer.disjointHits,
      } : 'EXT_disjoint_timer_query_webgl2 nicht verfuegbar',
      ab: AB ? abSummary() : null,
      drawCalls_mean: round(mean(drawCalls), 1),
      triangles_mean: round(mean(tris), 0),
      programs: renderer.info.programs?.length ?? null,
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries,
      removedPointLights: removedLights,
    };
    window.__PERF_RESULT = res;
    console.log('PERFJSON:' + JSON.stringify(res)); // eine Zeile, maschinenlesbar
    const el = document.createElement('pre');
    el.id = 'perf-result';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;color:#0f0;'
      + 'font:12px/1.4 monospace;padding:16px;margin:0;overflow:auto;white-space:pre-wrap';
    el.textContent = JSON.stringify(res, null, 2);
    document.body.appendChild(el);
  }

  // ---- Schussmodus: eine feste Pose, kein Messlauf --------------------------
  if (SHOT_POSE !== null) {
    // freie Pose per URL (Runde 17): ?shot=1&px=-18&pz=-13&yaw=-2.4&pitch=-0.2
    // uebersteuert die Tabelle — erspart beim Einrichten neuer Posen den Editier-
    // Reload-Zyklus an der SHOTS-Liste.
    const pose = params.has('px')
      ? {
        p: [Number(params.get('px')), Number(params.get('pz'))],
        yaw: Number(params.get('yaw') || 0),
        pitch: Number(params.get('pitch') || -0.12),
      }
      : SHOTS[SHOT_POSE];
    let settle = 0;
    return {
      enabled: true,
      shot: true,
      applyAblations,
      begin() {}, end() {}, tickStart() {},
      drive() {
        if (!pose) return;
        player.pos.set(pose.p[0], 0, pose.p[1]);
        player.vel.set(0, 0, 0);
        ctx.setYaw(pose.yaw);
        ctx.setPitch(pose.pitch);
        // erst melden, wenn die Kamera-Lerp angekommen ist und die Shader stehen
        if (++settle > 120) window.__SHOT_READY = true;
      },
    };
  }

  // ---- Messlauf ------------------------------------------------------------
  return {
    enabled: true,
    shot: false,
    applyAblations,

    begin() {
      if (done) return;
      timer.poll();
      const now = performance.now();
      if (t0 === null) t0 = now;
      const elapsed = (now - t0) / 1000;
      // Nur im Messfenster aufzeichnen — die ersten Sekunden sind Shader-Compile,
      // Texturupload und Cache-Aufbau, nicht der eingeschwungene Zustand.
      recording = elapsed >= WARMUP_S && elapsed < WARMUP_S + MEASURE_S;
      // A/B: jeden zweiten Frame umschalten. Muss VOR timer.begin() passieren,
      // damit die Query genau den Frame umschliesst, der die Einstellung hat.
      // AUSNAHME softshadow (R16): der shadowMap.type-Wechsel braucht
      // material.needsUpdate auf allen Schatten-Empfaengern, und das kostete
      // gemessen 172 ms CPU-Submit PRO FRAME (Frame-p50 ~1 s, GPU-Timer
      // verhungert, beide Eimer leer). Deshalb blockweise: 60 Frames pro
      // Seite, setFeature nur an der Blockgrenze, Einschwingfenster pro Block
      // verwirft end() unten. Alle anderen Kanaele bleiben beim alten Takt.
      if (AB) {
        abFrame++;
        const nextOn = AB === 'softshadow'
          ? (Math.floor(abFrame / AB_BLOCK) & 1) === 0
          : (abFrame & 1) === 0;
        if (nextOn !== abOn || abFrame === 1) setFeature(AB, nextOn);
        abOn = nextOn;
      }
      timer.begin();
      renderer.info.reset(); // Zaehler summieren jetzt ueber alle Composer-Paesse
      if (recording) {
        if (lastFrameT !== null) frameMs.push(now - lastFrameT);
        // Spiellogik = vom Start des Ticks bis hierher. tickStart() setzt die Marke.
        if (tickStartT !== null) cpuUpdateMs.push(now - tickStartT);
      }
      lastFrameT = now;
      this._submitT0 = now;
      if (elapsed >= WARMUP_S + MEASURE_S) {
        done = true;
        // kurz warten, damit die letzten Queries noch eintrudeln
        setTimeout(() => { timer.poll(); report(); }, 400);
      }
    },

    end() {
      // Die ersten Frames nach dem allerersten Umschalten kompiliert three.js neue
      // Shader-Varianten (Schatten/Lichter aendern den Programm-Schluessel). Danach
      // liegen beide Varianten im Cache und der Wechsel ist ein reiner Zustandswechsel.
      // softshadow (blockweise, s. begin()): zusaetzlich die ersten Frames JEDES
      // Blocks verwerfen — dort liegen needsUpdate-Kosten und Pipeline-Umbau.
      const settled = AB === 'softshadow'
        ? (abFrame > AB_BLOCK && (abFrame % AB_BLOCK) >= 12)
        : (!AB || abFrame > 30);
      timer.end(recording && settled ? (AB ? (abOn ? 'on' : 'off') : 'all') : null);
      // NACH dem Bild lesen: hier stehen die Summen aller Paesse (Schatten,
      // Szene, Bloom-Mips, Output, Grade).
      if (recording) {
        drawCalls.push(renderer.info.render.calls);
        tris.push(renderer.info.render.triangles);
        cpuSubmitMs.push(performance.now() - this._submitT0);
      }
    },

    // Ganz am Anfang von tick() aufgerufen: trennt Spiellogik von Rendern.
    // Ohne diese Trennung sieht man nur "Frame ist langsam" und raet, wer schuld ist.
    tickStart() {
      tickStartT = performance.now();
    },

    drive() {
      if (done) return;
      // Im A/B-Modus steht die Kamera STILL. Bewegte sie sich, saehen die beiden
      // Eimer unterschiedliche Geometrie und der Unterschied waere zur Haelfte
      // Bildinhalt statt Funktion.
      if (AB) {
        const pose = SHOTS[AB_POSE] || SHOTS[3];
        player.pos.set(pose.p[0], 0, pose.p[1]);
        player.vel.set(0, 0, 0);
        ctx.setYaw(pose.yaw);
        ctx.setPitch(pose.pitch);
        return;
      }
      const now = performance.now();
      if (t0 === null) t0 = now;
      const elapsed = (now - t0) / 1000;
      // Die Fahrt laeuft auch im Aufwaermen, damit das Messfenster nicht bei
      // stehender Kamera beginnt.
      const u = (elapsed / (WARMUP_S + MEASURE_S)) % 1;
      const s = samplePath(u);
      player.pos.x = s.x;
      player.pos.z = s.z;
      player.vel.set(0, 0, 0);
      ctx.setYaw(s.yaw);
    },
  };
}
