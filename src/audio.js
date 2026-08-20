// audio.js — procedural WebAudio SFX (no assets, everything synthesized).
// The context can only start after a user gesture, so sfx.resume() is called
// from startGame(); every play call is a no-op until then.

let ctx = null;
let master = null;

function ensureCtx() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return true;
}

// one-shot oscillator with a pitch sweep and exponential decay envelope
function blip({ type = 'sine', from = 440, to = from, dur = 0.1, vol = 0.4, delay = 0 }) {
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// short filtered-noise burst (thuds, impacts)
function noiseBurst({ dur = 0.12, vol = 0.3, freq = 400, delay = 0 }) {
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
}

export const sfx = {
  // call from a user gesture (start button) — unlocks the context
  resume() {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
  },

  // soft low tick when an enemy begins winding up — "threat incoming"
  windup() {
    if (!ctx) return;
    blip({ type: 'triangle', from: 220, to: 180, dur: 0.09, vol: 0.16 });
  },

  // sharp double-ping right before the strike lands — "dodge NOW"
  danger() {
    if (!ctx) return;
    blip({ type: 'square', from: 950, to: 1450, dur: 0.07, vol: 0.22 });
    blip({ type: 'square', from: 1150, to: 1750, dur: 0.09, vol: 0.26, delay: 0.08 });
  },

  // glassy "shing" reward on a perfect dodge
  perfect() {
    if (!ctx) return;
    blip({ type: 'sine', from: 1600, to: 2600, dur: 0.28, vol: 0.3 });
    blip({ type: 'sine', from: 2400, to: 3400, dur: 0.34, vol: 0.18, delay: 0.03 });
    noiseBurst({ dur: 0.1, vol: 0.08, freq: 6000 });
  },

  // dull body thud when the player takes a hit — teaches the cost of missing
  hurt() {
    if (!ctx) return;
    blip({ type: 'sine', from: 140, to: 55, dur: 0.18, vol: 0.5 });
    noiseBurst({ dur: 0.14, vol: 0.3, freq: 500 });
  },

  // OVERDRIVE (Runde 7 Overdrive-Ultimate) — rising snarl + steam hiss on activation
  overdriveActivate() {
    if (!ctx) return;
    blip({ type: 'sawtooth', from: 90, to: 340, dur: 0.32, vol: 0.32 });
    blip({ type: 'square', from: 60, to: 48, dur: 0.4, vol: 0.22, delay: 0.02 });
    noiseBurst({ dur: 0.3, vol: 0.2, freq: 2600 });
  },

  // low thump + faint steam hiss, repeated every ~0.85s while Overdrive is active
  overdriveHeartbeat() {
    if (!ctx) return;
    blip({ type: 'sine', from: 70, to: 40, dur: 0.16, vol: 0.2 });
    noiseBurst({ dur: 0.1, vol: 0.05, freq: 5200 });
  },

  // kurzer UI-Tick — Preset-Wechsel im Charakter-Editor (Runde 11)
  uiTick() {
    if (!ctx) return;
    blip({ type: 'triangle', from: 880, to: 660, dur: 0.06, vol: 0.14 });
  },

  // bestaetigender Doppel-Ton — "Uebernehmen" im Charakter-Editor
  uiConfirm() {
    if (!ctx) return;
    blip({ type: 'sine', from: 520, to: 780, dur: 0.12, vol: 0.22 });
    blip({ type: 'sine', from: 780, to: 1040, dur: 0.16, vol: 0.18, delay: 0.09 });
  },

  // R19 (Aufgabe D): der Rueckzugs-Pfiff des Petty Officers — zwei schrille
  // Triller-Toene wie eine Bootsmannspfeife, deutlich ueber dem Kampf-Mix
  whistle() {
    if (!ctx) return;
    blip({ type: 'square', from: 2300, to: 2700, dur: 0.16, vol: 0.2 });
    blip({ type: 'square', from: 2700, to: 2100, dur: 0.34, vol: 0.24, delay: 0.2 });
  },

  // falling growl + soft steam puff when Overdrive runs out
  overdriveEnd() {
    if (!ctx) return;
    blip({ type: 'sine', from: 260, to: 90, dur: 0.3, vol: 0.2 });
    noiseBurst({ dur: 0.22, vol: 0.16, freq: 3200 });
  },

  // ---------- R22 Aufgabe B.3: Gemurmel-/Rufe-Bett der Schaulustigen ----------
  // Läuft während des Verhaftungs-Establish und durch das Handgemenge, reißt beim
  // Pfiff ab (murmurStop mit sehr kurzer Rampe — bewusst ein Schnitt, kein Fade).
  // Synthetisch im Haus-Stil: ein geloopter, bandpass-gefilterter Rauschteppich
  // mit langsamer Pegelwellen-LFO als "viele Stimmen", darüber zufällige, leise
  // Stimm-Blips (Dreieck, 140-320 Hz) als einzelne Rufe/Ausrufe.
  murmurStart() {
    if (!ensureCtx()) return;
    if (murmurGain) return; // läuft schon
    murmurGain = ctx.createGain();
    murmurGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    murmurGain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.8);
    murmurGain.connect(master);
    // Rauschteppich: 2 s Puffer, geloopt, Bandpass um ~420 Hz (Stimmlage)
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    murmurSrc = ctx.createBufferSource();
    murmurSrc.buffer = buf;
    murmurSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.9;
    // Pegelwelle: die Menge wird lauter und leiser, wie echtes Getuschel
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.35;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.7;
    lfo.connect(lfoGain).connect(bedGain.gain);
    lfo.start();
    murmurLfo = lfo;
    murmurSrc.connect(bp).connect(bedGain).connect(murmurGain);
    murmurSrc.start();
    // einzelne "Rufe": zufällige weiche Blips, solange das Bett läuft
    const voice = () => {
      if (!murmurGain) return;
      const from = 140 + Math.random() * 180;
      const t0 = ctx.currentTime + Math.random() * 0.2;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(from, t0);
      osc.frequency.exponentialRampToValueAtTime(from * (0.7 + Math.random() * 0.7), t0 + 0.25);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3 + Math.random() * 0.25);
      osc.connect(g).connect(murmurGain);
      osc.start(t0);
      osc.stop(t0 + 0.7);
      murmurTimer = setTimeout(voice, 180 + Math.random() * 450);
    };
    voice();
  },

  murmurStop() {
    if (!ctx || !murmurGain) return;
    clearTimeout(murmurTimer);
    murmurTimer = null;
    const g = murmurGain;
    murmurGain = null; // ab jetzt startet voice() nicht mehr nach
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05); // reißt ab (Pfiff)
    const src = murmurSrc;
    const lfo = murmurLfo;
    murmurSrc = null;
    murmurLfo = null;
    setTimeout(() => {
      try { src?.stop(); lfo?.stop(); } catch { /* schon gestoppt */ }
      g.disconnect();
    }, 400);
  },
};

// Zustand des Gemurmel-Betts (R22) — lebt außerhalb von sfx, wie ctx/master oben
let murmurGain = null;
let murmurSrc = null;
let murmurLfo = null;
let murmurTimer = null;

// ---------- music (Runde 10, Felix' Auftrag: "Musik ist schwach, Rest ist geil") ----------
// A real procedural score, still zero audio files, still the exact same public
// API as Runde 9 (music.start/setCombat/duckForIntro/resumeAmbient) so main.js
// needs no changes. Everything sits on one shared 16th-note lookahead scheduler
// (same style as the old pulse scheduler) so every layer locks to real bars/beats:
//   - ambient bed: 3 sustained pad voices that glide between chords (no retrigger)
//     + a soft delayed arpeggio pluck — chord progression Am-G-F-G, island-campfire
//   - combat layer: kick/snare/hi-hat drum pattern + a bass line that follows the
//     chord root + a 4-bar melody hook — chord progression Am-F-C-G, episch
//   - boss variant: Am-F-E-Am (E major = the "danger" chord), tempo +15%, denser
//     syncopated kick, melody transposed down an octave and played twice as dense
// Pattern content (progression/tempo/drum density) only ever switches on the next
// bar boundary — no mid-beat tearing; the existing setTargetAtTime volume
// crossfades (and duckForIntro's silence-for-tension beat) are unchanged.

function noteFreq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  const SEMI = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const midi = SEMI[m[1]] + (parseInt(m[2], 10) + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// triads spelled out by scale-degree letter; octave is appended where used below
const CHORD_TONES = {
  Am: ['A', 'C', 'E'],
  F: ['F', 'A', 'C'],
  C: ['C', 'E', 'G'],
  G: ['G', 'B', 'D'],
  E: ['E', 'G#', 'B'], // dominant major — the "danger" chord in the boss loop
};

const AMBIENT_PROGRESSION = ['Am', 'G', 'F', 'G'];  // island-campfire, gently unresolved
const COMBAT_PROGRESSION = ['Am', 'F', 'C', 'G'];   // episch-abenteuerlich
const BOSS_PROGRESSION = ['Am', 'F', 'E', 'Am'];    // moll-dominant, E raises the stakes

// 4-bar melody hook (quarter notes), diatonic to A minor so it stays consonant
// against every chord in both progressions. Hum it: "A C B A | F G A E | A C E D | C A B A"
const COMBAT_MELODY = ['A4', 'C5', 'B4', 'A4', 'F4', 'G4', 'A4', 'E4', 'A4', 'C5', 'E5', 'D5', 'C5', 'A4', 'B4', 'A4'];
// same contour an octave down, played at double density (eighths instead of quarters) — drängender
const BOSS_MELODY = ['A3', 'C4', 'B3', 'A3', 'F3', 'G3', 'A3', 'E3', 'A3', 'C4', 'E4', 'D4', 'C4', 'A3', 'B3', 'A3'];

const BASE_BPM = 100;
const BOSS_BPM = 115;                                   // +15%
const STEPS_PER_BEAT = 4;                                // 16th-note scheduling grid
const BEATS_PER_BAR = 4;
const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;    // 16
const BARS_PER_CHORD = 2;
const STEPS_PER_LOOP = STEPS_PER_BAR * BARS_PER_CHORD * 4; // 4 chords, 8 bars -> 128 steps

const AMBIENT_VOL = 0.14;      // dezent — stays under sfx.* volumes
const AMBIENT_DUCK_VOL = 0.03; // ambient bed while combat is active — crossfade, not addition
const COMBAT_VOL = 0.20;
const CROSSFADE_TC = 0.35;    // setTargetAtTime time-constant ≈ ~1s to settle
const SCHED_LOOKAHEAD = 0.25; // seconds of notes queued ahead of playback
const SCHED_INTERVAL_MS = 50; // how often the scheduler wakes up to queue more

let ambientGain = null;
let combatGain = null;
let ambientDelay = null;
let ambientFeedback = null;
let padOscs = [];              // 3 sustained pad voices, retuned in place on chord changes
let musicStarted = false;

let combatFast = false;        // pattern currently playing (drums/bass/melody/progression)
let pendingCombatFast = false; // requested via setCombat(), applied on next bar boundary
let combatActiveFlag = false;  // wave-state mirror of setCombat()'s `active` — drives ambient duck target
let combatChordName = null;    // last chord the combat harmony stab painted, so it only fires on change

let ambientStepIndex = 0;
let ambientChordName = null;   // last chord painted onto the pad, so we only ramp on change
let nextAmbientStepTime = 0;

let combatStepIndex = 0;
let nextCombatStepTime = 0;

let schedTimer = null;

function chordAt(progression, stepIndex) {
  const barIndex = Math.floor(stepIndex / STEPS_PER_BAR) % (BARS_PER_CHORD * progression.length);
  return progression[Math.floor(barIndex / BARS_PER_CHORD)];
}

// ---- ambient pad + arpeggio ----

function startAmbientVoices() {
  const startChord = AMBIENT_PROGRESSION[0];
  padOscs = CHORD_TONES[startChord].map((letter) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = noteFreq(letter + '3');
    // slow detune LFO per voice so the pad breathes instead of sitting static
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05 + Math.random() * 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 1.5;
    lfo.connect(lfoGain).connect(osc.detune);
    lfo.start();
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 1 / 3;
    osc.connect(voiceGain).connect(ambientGain);
    osc.start();
    return osc;
  });
  ambientChordName = startChord;

  // soft delay/echo bus for the arpeggio plucks — island-campfire ambience
  ambientDelay = ctx.createDelay(1.0);
  ambientDelay.delayTime.value = 0.36;
  ambientFeedback = ctx.createGain();
  ambientFeedback.gain.value = 0.28;
  ambientDelay.connect(ambientFeedback).connect(ambientDelay);
  ambientDelay.connect(ambientGain);
}

// glide the sustained pad voices to a new chord's tones — no retrigger, just a slow ramp
function retunePad(chordName, t0) {
  const tones = CHORD_TONES[chordName];
  padOscs.forEach((osc, i) => {
    const target = noteFreq(tones[i] + '3');
    osc.frequency.cancelScheduledValues(t0);
    osc.frequency.setValueAtTime(osc.frequency.value, t0);
    osc.frequency.linearRampToValueAtTime(target, t0 + 1.4);
  });
}

// soft plucked chord tone, feeding the delay for an echoey campfire feel
function playArpPluck(t0, freq) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.11, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
  osc.connect(gain);
  gain.connect(ambientGain);
  gain.connect(ambientDelay);
  osc.start(t0);
  osc.stop(t0 + 1.0);
}

const ARP_PATTERN = [0, 1, 2, 1]; // root, third, fifth, third — one pluck per beat

function scheduleAmbientStep(t0, stepIndex) {
  const chordName = chordAt(AMBIENT_PROGRESSION, stepIndex);
  // chord change lands right on the bar that starts it — glide the pad, no click
  if (stepIndex % STEPS_PER_BAR === 0 && chordName !== ambientChordName) {
    ambientChordName = chordName;
    retunePad(chordName, t0);
  }
  if (stepIndex % STEPS_PER_BEAT === 0) {
    const beat = (stepIndex / STEPS_PER_BEAT) % ARP_PATTERN.length;
    const tone = CHORD_TONES[chordName][ARP_PATTERN[beat]];
    playArpPluck(t0, noteFreq(tone + '4'));
  }
}

// ---- combat drums / bass / melody ----

function scheduleNoiseHit(t0, { dur, vol, freq, type, q = 1 }) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt).connect(gain).connect(combatGain);
  src.start(t0);
}

function playKick(t0, isBoss) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(isBoss ? 135 : 120, t0);
  osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.55, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.17);
  osc.connect(gain).connect(combatGain);
  osc.start(t0);
  osc.stop(t0 + 0.2);
}

function playBassNote(t0, freq, dur) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.4, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(combatGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function playMelodyNote(t0, freq, dur, isBoss) {
  const o1 = ctx.createOscillator();
  o1.type = 'sawtooth';
  o1.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = 'sawtooth';
  o2.frequency.value = freq;
  o2.detune.value = 9; // slight detune for width — a single saw voice reads thin
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(isBoss ? 1500 : 1900, t0);
  filter.frequency.exponentialRampToValueAtTime(isBoss ? 650 : 850, t0 + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(isBoss ? 0.3 : 0.26, t0 + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o1.connect(filter);
  o2.connect(filter);
  filter.connect(gain).connect(combatGain);
  o1.start(t0);
  o2.start(t0);
  o1.stop(t0 + dur + 0.05);
  o2.stop(t0 + dur + 0.05);
}

// held third+fifth pad stab, one per chord change — the E-major "danger" chord in
// the boss loop needs its G# audible somewhere, not just the bass root
function playHarmonyStab(t0, chordName, dur, isBoss) {
  const tones = CHORD_TONES[chordName];
  const gain = ctx.createGain();
  const peak = isBoss ? 0.09 : 0.08;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.3);
  gain.gain.setValueAtTime(peak, t0 + Math.max(0.3, dur - 0.4));
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  gain.connect(combatGain);
  [tones[1], tones[2]].forEach((letter) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = noteFreq(letter + '4');
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  });
}

const KICK_STEPS_NORMAL = [0, 8];        // beats 1 and 3
const KICK_STEPS_BOSS = [0, 6, 8, 14];   // denser — hits offbeats too
const SNARE_STEPS = [4, 12];             // beats 2 and 4, both patterns

function scheduleCombatStep(t0, stepIndex, isBoss) {
  const progression = isBoss ? BOSS_PROGRESSION : COMBAT_PROGRESSION;
  const chordName = chordAt(progression, stepIndex);
  const stepInBar = stepIndex % STEPS_PER_BAR;
  const stepDur = 60 / (isBoss ? BOSS_BPM : BASE_BPM) / STEPS_PER_BEAT;

  const kickSteps = isBoss ? KICK_STEPS_BOSS : KICK_STEPS_NORMAL;
  if (kickSteps.includes(stepInBar)) playKick(t0, isBoss);
  if (SNARE_STEPS.includes(stepInBar)) {
    scheduleNoiseHit(t0, { dur: 0.14, vol: 0.28, freq: 1900, type: 'bandpass', q: 1.4 });
  }
  // hi-hat: eighths normally, every 16th (denser) in the boss fight; accent downbeats
  const hihatOn = isBoss ? true : stepInBar % 2 === 0;
  if (hihatOn) {
    const accent = stepInBar % STEPS_PER_BEAT === 0;
    scheduleNoiseHit(t0, { dur: 0.035, vol: accent ? 0.14 : 0.08, freq: 7500, type: 'highpass', q: 0.8 });
  }
  // bass: root note on every beat, pumping up an octave on beats 2 & 4
  if (stepInBar % STEPS_PER_BEAT === 0) {
    const root = CHORD_TONES[chordName][0];
    const beat = stepInBar / STEPS_PER_BEAT;
    const octave = beat % 2 === 0 ? 2 : 3;
    playBassNote(t0, noteFreq(root + octave), 0.32);
  }
  // harmony stab: third+fifth held for the whole chord, fires once per chord change
  // so Am-F-C-G / Am-F-E-Am actually carries its intended color (not just the root)
  if (stepInBar === 0 && chordName !== combatChordName) {
    combatChordName = chordName;
    const chordDur = BARS_PER_CHORD * STEPS_PER_BAR * stepDur;
    playHarmonyStab(t0, chordName, chordDur, isBoss);
  }

  // melody hook: quarter notes normally, eighths (double density) in the boss fight
  const melody = isBoss ? BOSS_MELODY : COMBAT_MELODY;
  const stepsPerNote = isBoss ? STEPS_PER_BEAT / 2 : STEPS_PER_BEAT;
  if (stepIndex % stepsPerNote === 0) {
    const melodyLen = melody.length * stepsPerNote;
    const noteIdx = Math.floor((stepIndex % melodyLen) / stepsPerNote);
    playMelodyNote(t0, noteFreq(melody[noteIdx]), stepsPerNote * stepDur * 0.85, isBoss);
  }
}

function scheduler() {
  if (!ctx) return;

  while (nextAmbientStepTime < ctx.currentTime + SCHED_LOOKAHEAD) {
    scheduleAmbientStep(nextAmbientStepTime, ambientStepIndex);
    nextAmbientStepTime += 60 / BASE_BPM / STEPS_PER_BEAT;
    ambientStepIndex = (ambientStepIndex + 1) % STEPS_PER_LOOP;
  }

  while (nextCombatStepTime < ctx.currentTime + SCHED_LOOKAHEAD) {
    // pattern (progression/tempo/density) only ever switches on a bar boundary —
    // nothing tears mid-beat; boss fight restarts fresh on Am
    if (combatStepIndex % STEPS_PER_BAR === 0 && pendingCombatFast !== combatFast) {
      combatFast = pendingCombatFast;
      combatStepIndex = 0;
    }
    scheduleCombatStep(nextCombatStepTime, combatStepIndex, combatFast);
    nextCombatStepTime += 60 / (combatFast ? BOSS_BPM : BASE_BPM) / STEPS_PER_BEAT;
    combatStepIndex = (combatStepIndex + 1) % STEPS_PER_LOOP;
  }

  schedTimer = setTimeout(scheduler, SCHED_INTERVAL_MS);
}

export const music = {
  // call once, after sfx.resume() (needs the same user-gesture-unlocked context)
  start() {
    if (!ensureCtx() || musicStarted) return;
    musicStarted = true;
    ambientGain = ctx.createGain();
    ambientGain.gain.value = AMBIENT_VOL;
    ambientGain.connect(master);
    combatGain = ctx.createGain();
    combatGain.gain.value = 0.0001;
    combatGain.connect(master);
    startAmbientVoices();
    ambientStepIndex = 0;
    combatStepIndex = 0;
    combatActiveFlag = false;
    combatChordName = null;
    nextAmbientStepTime = ctx.currentTime + 0.1;
    nextCombatStepTime = ctx.currentTime + 0.1;
    clearTimeout(schedTimer);
    scheduler();
  },

  // active = mix the combat layer in (a wave is live); fast = boss-fight tempo
  setCombat(active, fast = false) {
    if (!ctx || !combatGain) return;
    pendingCombatFast = !!fast; // pattern switch applied on next bar boundary
    combatActiveFlag = !!active; // remembered so resumeAmbient() ducks correctly too
    combatGain.gain.cancelScheduledValues(ctx.currentTime);
    combatGain.gain.setTargetAtTime(active ? COMBAT_VOL : 0.0001, ctx.currentTime, CROSSFADE_TC);
    // crossfade the ambient bed down while combat plays — it has its own full triads
    // and its own (untied) progression/tempo, so left at full volume it clashes
    // against the combat chords (e.g. boss E-major bass vs. ambient F/G semitone rub)
    if (ambientGain) {
      ambientGain.gain.cancelScheduledValues(ctx.currentTime);
      ambientGain.gain.setTargetAtTime(active ? AMBIENT_DUCK_VOL : AMBIENT_VOL, ctx.currentTime, CROSSFADE_TC);
    }
  },

  // boss-intro beat: brief full stop on both layers — silence sells the tension
  duckForIntro() {
    if (!ctx) return;
    if (ambientGain) {
      ambientGain.gain.cancelScheduledValues(ctx.currentTime);
      ambientGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
    }
    if (combatGain) {
      combatGain.gain.cancelScheduledValues(ctx.currentTime);
      combatGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
    }
  },

  // fade the ambient bed back in once the intro's letterbox opens again
  // (the combat layer follows on its own via setCombat, driven by wave state) —
  // returns to the ducked level, not full volume, if combat is already active
  // (the boss fight's setCombat(true, true) fires the same frame as this)
  resumeAmbient() {
    if (!ctx || !ambientGain) return;
    ambientGain.gain.cancelScheduledValues(ctx.currentTime);
    ambientGain.gain.setTargetAtTime(combatActiveFlag ? AMBIENT_DUCK_VOL : AMBIENT_VOL, ctx.currentTime, 0.3);
  },
};
