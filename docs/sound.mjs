// Sound effects synthesised with Web Audio: no files, works offline.
let ctx = null, master = null, enabled = () => true;
export function soundSetting(fn) { enabled = fn; }
function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// Browsers only allow audio after a user gesture; unlock on the first tap.
for (const type of ['pointerdown', 'keydown']) globalThis.addEventListener?.(type, () => { if (enabled()) audio(); }, {once: true, capture: true});

function tone(freq, at, dur, {type = 'sine', gain = 0.2, to = null, attack = 0.005} = {}) {
  const c = ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
const N = n => 440 * 2 ** ((n - 69) / 12); // MIDI note to Hz
const sounds = {
  start() { tone(N(72), 0, 0.12, {type: 'triangle'}); tone(N(79), 0.07, 0.18, {type: 'triangle'}); },
  resume() { tone(N(74), 0, 0.1, {type: 'triangle'}); tone(N(79), 0.06, 0.16, {type: 'triangle'}); },
  pause() { tone(N(76), 0, 0.12, {type: 'triangle', gain: 0.15}); tone(N(69), 0.08, 0.2, {type: 'triangle', gain: 0.15}); },
  stop() { // till bell
    tone(N(88), 0, 0.5, {gain: 0.18}); tone(N(95), 0, 0.45, {gain: 0.08}); tone(N(76), 0.02, 0.1, {type: 'square', gain: 0.04});
  },
  focus() { tone(N(67), 0, 0.5, {gain: 0.12, to: N(79)}); tone(N(86), 0.15, 0.4, {gain: 0.06}); },
  coin() { tone(N(83), 0, 0.08, {type: 'square', gain: 0.07}); tone(N(88), 0.07, 0.3, {type: 'square', gain: 0.07}); },
  save() { tone(N(84), 0, 0.09, {type: 'triangle', gain: 0.12}); },
  goal() { [72, 76, 79, 84].forEach((n, i) => tone(N(n), i * 0.11, i === 3 ? 0.6 : 0.16, {type: 'triangle', gain: 0.18})); tone(N(96), 0.44, 0.5, {gain: 0.05}); },
  level() {
    [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => tone(N(n), i * 0.07, 0.14, {type: 'square', gain: 0.06}));
    [72, 76, 79].forEach(n => tone(N(n), 0.52, 0.8, {type: 'triangle', gain: 0.13}));
  },
  achievement() { [88, 91, 96, 100].forEach((n, i) => tone(N(n), i * 0.06, 0.35, {gain: 0.09})); tone(N(76), 0, 0.5, {type: 'triangle', gain: 0.1}); }
};
export function play(name) {
  if (!enabled()) return;
  try { if (audio()) sounds[name]?.(); } catch {}
}
