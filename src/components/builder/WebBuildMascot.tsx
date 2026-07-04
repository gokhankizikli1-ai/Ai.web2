/**
 * A small, premium Korvix mascot for the Web Build start screen — a rounded
 * orb "face" with two eyes that breathe, float, blink, and occasionally glance.
 * Reacts to the composer: `idle` (calm), `awake` (input focused — looks
 * attentive), `typing` (subtle bob), `working` (generating — a scanning look).
 *
 * Pure CSS animations (no library), scoped by the `kxm-` class prefix, with a
 * `prefers-reduced-motion` guard that stills everything. No emoji, no images.
 */
export type MascotState = 'idle' | 'awake' | 'typing' | 'working';

export default function WebBuildMascot({ state = 'idle', size = 76 }: { state?: MascotState; size?: number }) {
  return (
    <div className="kxm-wrap" data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <span className="kxm-glow" />
      <span className="kxm-orb">
        <span className="kxm-ring" />
        <span className="kxm-face">
          <span className="kxm-eye kxm-eye-l" />
          <span className="kxm-eye kxm-eye-r" />
        </span>
      </span>
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.kxm-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.kxm-glow {
  position: absolute; inset: -18%;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(96,165,250,0.45), transparent 62%);
  filter: blur(18px);
  animation: kxm-breathe 4.6s ease-in-out infinite;
}
.kxm-orb {
  position: relative;
  width: 100%; height: 100%;
  border-radius: 9999px;
  background:
    radial-gradient(120% 120% at 30% 25%, rgba(96,165,250,0.22), transparent 55%),
    linear-gradient(160deg, #101a30 0%, #070b16 70%);
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 10px 30px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: center;
  animation: kxm-float 5.2s ease-in-out infinite;
  will-change: transform;
}
.kxm-ring {
  position: absolute; inset: 10%;
  border-radius: 9999px;
  border: 1px solid rgba(96,165,250,0.18);
}
.kxm-face {
  display: flex; align-items: center; gap: 16%;
  animation: kxm-glance 9s ease-in-out infinite;
  will-change: transform;
}
.kxm-eye {
  width: 9px; height: 15px;
  border-radius: 6px;
  background: linear-gradient(180deg, #dbeafe, #60a5fa);
  box-shadow: 0 0 8px rgba(96,165,250,0.7);
  animation: kxm-blink 5.4s ease-in-out infinite;
  transform-origin: center;
}
.kxm-eye-r { animation-delay: 0.04s; }

/* ── Awake: input focused — brighter, taller eyes, stronger glow ─────── */
.kxm-wrap[data-state="awake"] .kxm-glow { animation-duration: 3.4s; opacity: 1; }
.kxm-wrap[data-state="awake"] .kxm-eye { height: 17px; box-shadow: 0 0 12px rgba(96,165,250,0.95); }
.kxm-wrap[data-state="awake"] .kxm-face { animation: none; }

/* ── Typing: subtle quick bob, no wandering ─────────────────────────── */
.kxm-wrap[data-state="typing"] .kxm-orb { animation: kxm-bob 1.1s ease-in-out infinite; }
.kxm-wrap[data-state="typing"] .kxm-face { animation: none; }

/* ── Working: generating — a calm scanning look ─────────────────────── */
.kxm-wrap[data-state="working"] .kxm-glow { animation-duration: 1.8s; }
.kxm-wrap[data-state="working"] .kxm-orb { animation: kxm-float 3.2s ease-in-out infinite; }
.kxm-wrap[data-state="working"] .kxm-eye { animation: kxm-scan 1.6s ease-in-out infinite; }
.kxm-wrap[data-state="working"] .kxm-face { animation: none; }

@keyframes kxm-float  { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@keyframes kxm-bob    { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
@keyframes kxm-breathe{ 0%,100% { opacity: 0.55; transform: scale(0.94); } 50% { opacity: 0.9; transform: scale(1.06); } }
@keyframes kxm-blink  { 0%,88%,100% { transform: scaleY(1); } 93% { transform: scaleY(0.1); } }
@keyframes kxm-glance { 0%,60%,100% { transform: translateX(0); } 72% { transform: translateX(3px); } 84% { transform: translateX(-3px); } }
@keyframes kxm-scan   { 0%,100% { transform: translateY(-2px); opacity: 0.7; } 50% { transform: translateY(2px); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .kxm-glow, .kxm-orb, .kxm-face, .kxm-eye { animation: none !important; }
  .kxm-glow { opacity: 0.7; }
}
`;
