// banter.js — FF15-style short banter lines from KAI (Runde 8, Felix' Auftrag).
// One tiny module: init() wires a display callback (ui.js), trigger(name) picks a
// random line for that moment if the shared cooldown allows it, update(dt) ticks
// the cooldown down on real time so lines keep landing at a steady pace through
// hit-stop/slow-mo. Deliberately independent of ui.js so both main.js and crew.js
// can call trigger() directly without passing the UI instance around.
//
// Ton: knapp, trocken-loyal — der stille Schwertkämpfer, kein One-Piece-Vokabular.

const LINES = {
  // Kampfstart / Wellenstart
  waveStart: ['Bleib hinter mir.', "Los, zeig's ihnen.", 'Ich nehm die rechte Seite.'],
  // KAI landet einen Kill
  kill: ['Der gehört mir.', 'Nächster.', 'Sauber erledigt.'],
  // Spieler-Perfect-Dodge — Anerkennung
  perfectDodge: ['Sauber ausgewichen.', 'Gutes Auge.', 'So macht man das.'],
  // Link-Strike ausgelöst
  linkStrike: ['Ich hab ihn.', "Deckung übernommen.", 'Den erwisch ich.'],
  // Spieler unter 30% HP — Sorge
  lowHp: ['Pass auf dich auf.', 'Nicht nachlassen.', 'Ich bin hier, halt durch.'],
  // Sieg
  victory: ['Geschafft.', 'Das wars für die.', 'Gut gekämpft.'],
};

const GLOBAL_COOLDOWN = 8; // seconds, shared across every trigger — no spam

let cooldownT = 0;
let onLine = null; // (text) => void

function init(displayFn) {
  onLine = displayFn;
}

// call once per frame with real (unscaled) delta time
function update(dt) {
  cooldownT = Math.max(0, cooldownT - dt);
}

// Triggers that must never be swallowed by the shared cooldown — they mark the
// dramatic beats of a run and simply override whatever bark came before.
const FORCE = new Set(['victory', 'waveStart']);

// returns true if a line actually fired
function trigger(name) {
  if (cooldownT > 0 && !FORCE.has(name)) return false;
  const pool = LINES[name];
  if (!pool || pool.length === 0) return false;
  cooldownT = GLOBAL_COOLDOWN;
  const line = pool[(Math.random() * pool.length) | 0];
  if (onLine) onLine(line);
  return true;
}

// fresh run: no cooldown carried over from the previous game
function reset() {
  cooldownT = 0;
}

export const banter = { init, update, trigger, reset };
