/**
 * Optional success sound for POS actions (Complete Order, Collect).
 * Enable via localStorage: setItem('pos_sound_enabled', 'true').
 * Disable by removing the key or setting to 'false'.
 */

const SOUND_ENABLED_KEY = 'pos_sound_enabled';

export function isSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled) {
  try {
    if (enabled) {
      localStorage.setItem(SOUND_ENABLED_KEY, 'true');
    } else {
      localStorage.removeItem(SOUND_ENABLED_KEY);
    }
  } catch (_) {}
}

export function playSuccessSound() {
  if (!isSoundEnabled()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch (_) {
    // Ignore if AudioContext not supported or autoplay blocked
  }
}
