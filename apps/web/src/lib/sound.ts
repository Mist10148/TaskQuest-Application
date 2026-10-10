/**
 * Tiny synthesized sound effects for the arcade games (no audio files). Off unless
 * the player turned "Game sounds" on in Settings; browsers also require a user
 * gesture before audio can start, which every game start/click provides.
 */

export type Sound = "eat" | "jump" | "shoot" | "hit" | "lose" | "win";

let enabled = false;
let context: AudioContext | null = null;

/** Called by the Games page whenever the preference changes. */
export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

// [frequency Hz, duration s, wave, slide-to Hz?]
const TONES: Record<Sound, [number, number, OscillatorType, number?]> = {
  eat: [660, 0.08, "square", 880],
  jump: [320, 0.12, "triangle", 560],
  shoot: [880, 0.07, "sawtooth", 440],
  hit: [200, 0.12, "square", 90],
  lose: [220, 0.35, "sawtooth", 80],
  win: [520, 0.25, "triangle", 1040],
};

export function playSound(kind: Sound): void {
  if (!enabled || typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    context ||= new Ctx();
    if (context.state === "suspended") void context.resume();
    const [freq, duration, type, slideTo] = TONES[kind];
    const osc = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    gain.gain.setValueAtTime(0.08, now); // quiet on purpose
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + duration);
  } catch {
    /* audio is a nicety: never let it break a game */
  }
}
