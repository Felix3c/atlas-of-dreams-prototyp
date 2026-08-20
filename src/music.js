// music.js — Datei-Musik mit Cue-Uhr (Hanami-Fundament, Schritt 1).
// Spielt eine komponierte Audiodatei ab und meldet das Überschreiten von
// Zeitmarken (Cues). Die Bilduhr der Sequenz hängt an der Abspielposition
// (AudioContext.currentTime), NICHT an der Frame-Uhr — Bild und Ton können
// dadurch nicht driften. Der Synth in audio.js bleibt unberührt; beide
// existieren nebeneinander.
//
// Cue-Datei (music/hanami-cues.json): { file, cues: { name: sekunden } } —
// pflegt Felix nach Gehör, ohne Code-Eingriff. Musikdatei austauschbar,
// solange der Pfad in "file" stimmt.

export class MusicTrack {
  constructor(audioCtx, buffer, cues) {
    this.ctx = audioCtx;
    this.buffer = buffer;
    this.cues = Object.entries(cues)
      .map(([name, time]) => ({ name, time: Number(time) }))
      .filter((c) => Number.isFinite(c.time))
      .sort((a, b) => a.time - b.time);
    this.gain = audioCtx.createGain();
    this.gain.connect(audioCtx.destination);
    this.source = null;      // aktive BufferSource (Einweg-Objekt per Web-Audio-Design)
    this.startCtxTime = 0;   // ctx.currentTime beim Start
    this.startOffset = 0;    // Position im Stück beim Start
    this.playing = false;
    this._lastPolled = 0;    // Position beim letzten update() — für Cue-Kanten
    this._onCue = null;
  }

  // Lädt Cue-Datei und die darin benannte Musikdatei. Fehlt die Musikdatei,
  // kommt ein Track mit buffer=null zurück (Cues laufen dann über die
  // Fallback-Uhr des Aufrufers) — die Sequenz bleibt baubar ohne Ton.
  static async load(cuesUrl, audioCtx) {
    const res = await fetch(cuesUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(cuesUrl + ': HTTP ' + res.status);
    const data = await res.json();
    const cues = data.cues || {};
    let buffer = null;
    try {
      const audioRes = await fetch(encodeURI(data.file), { cache: 'no-store' });
      if (audioRes.ok) {
        buffer = await audioCtx.decodeAudioData(await audioRes.arrayBuffer());
      }
    } catch (err) {
      console.warn('music: Datei nicht ladbar, laufe stumm —', err.message);
    }
    const track = new MusicTrack(audioCtx, buffer, cues);
    track.fileName = data.file;
    return track;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : (this.cues.length ? this.cues[this.cues.length - 1].time : 0);
  }

  // Aktuelle Position im Stück in Sekunden — die eine Uhr, an der alles hängt.
  get time() {
    if (!this.playing) return this.startOffset;
    return this.startOffset + (this.ctx.currentTime - this.startCtxTime);
  }

  onCue(fn) { this._onCue = fn; }

  play(fromTime = null) {
    if (fromTime !== null) this.startOffset = fromTime;
    this.stopSource();
    if (this.buffer) {
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.connect(this.gain);
      this.source.start(0, Math.min(this.startOffset, this.buffer.duration));
    }
    this.startCtxTime = this.ctx.currentTime;
    // Winziges Epsilon: eine Marke GENAU auf der Startposition (z. B. 0.0)
    // gilt als noch nicht überschritten und feuert beim ersten update().
    this._lastPolled = this.startOffset - 1e-6;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.startOffset = this.time;
    this.stopSource();
    this.playing = false;
  }

  seek(t) {
    const target = Math.max(0, Math.min(t, this.duration));
    if (this.playing) this.play(target);
    else { this.startOffset = target; this._lastPolled = target; }
  }

  stopSource() {
    if (this.source) {
      try { this.source.stop(); } catch (e) { /* schon gestoppt */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  // Einmal pro Frame aufrufen. Meldet jede Cue-Kante zwischen letztem und
  // aktuellem Stand — auch mehrere auf einmal, falls ein Frame lang war.
  // Nach seek() rückwärts wird die Kanten-Uhr neu gesetzt (kein Nachfeuern).
  update() {
    if (!this.playing || !this._onCue) return;
    const now = this.time;
    if (now < this._lastPolled) { this._lastPolled = now; return; }
    for (const cue of this.cues) {
      if (cue.time > this._lastPolled && cue.time <= now) this._onCue(cue.name, cue.time, now);
    }
    this._lastPolled = now;
    if (this.buffer && now >= this.buffer.duration) { this.pause(); this.startOffset = this.buffer.duration; }
  }
}
