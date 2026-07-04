/**
 * The Korvix mascot — a small premium 3D orb with depth: a radial-gradient body,
 * soft inner + outer glow, a glassy specular highlight, and two embedded glowing
 * eyes. Breathes/floats, blinks every ~3–5s, glances occasionally, and reacts to
 * the composer via `state`: idle (calm), awake (focused — brighter), typing
 * (subtle pulse), working (generating — scanning eyes). Pure CSS, scoped by the
 * `kxm-` prefix, with a prefers-reduced-motion guard. No emoji, no images.
 */
export type MascotState = 'idle' | 'awake' | 'typing' | 'working';

export default function WebBuildMascot({ state = 'idle', size = 84 }: { state?: MascotState; size?: number }) {
  return (
    <div className="kxm-wrap" data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <span className="kxm-glow" />
      <span className="kxm-orb">
        <span className="kxm-spec" />
        <span className="kxm-face">
          <span className="kxm-eye kxm-eye-l" />
          <span className="kxm-eye kxm-eye-r" />
        </span>
      </span>
      <span className="kxm-shadow" />
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.kxm-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; }

/* Outer aura behind the sphere */
.kxm-glow {
  position: absolute; inset: -22%;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(96,165,250,0.5), transparent 62%);
  filter: blur(20px);
  animation: kxm-breathe 4.4s ease-in-out infinite;
}

/* Contact shadow on the "floor" for grounded depth */
.kxm-shadow {
  position: absolute; bottom: -10%; left: 50%;
  width: 62%; height: 12%;
  transform: translateX(-50%);
  border-radius: 9999px;
  background: radial-gradient(ellipse, rgba(0,0,0,0.6), transparent 70%);
  filter: blur(5px);
  animation: kxm-shadow 5s ease-in-out infinite;
}

/* The sphere */
.kxm-orb {
  position: relative;
  width: 100%; height: 100%;
  border-radius: 9999px;
  background: radial-gradient(circle at 33% 28%, #2c3f66 0%, #16233f 40%, #0a1120 68%, #060a14 100%);
  border: 1px solid rgba(255,255,255,0.06);
  box-shadow:
    inset 0 -7px 16px rgba(0,0,0,0.65),
    inset 0 7px 14px rgba(130,175,255,0.20),
    inset 0 0 22px rgba(10,16,32,0.9),
    0 16px 36px -12px rgba(0,0,0,0.85),
    0 0 28px rgba(96,165,250,0.34);
  display: flex; align-items: center; justify-content: center;
  animation: kxm-float 5s ease-in-out infinite;
  will-change: transform;
  overflow: hidden;
}

/* Glassy specular highlight */
.kxm-spec {
  position: absolute; top: 11%; left: 17%;
  width: 48%; height: 34%;
  border-radius: 9999px;
  background: radial-gradient(circle at 42% 40%, rgba(255,255,255,0.6), rgba(255,255,255,0) 70%);
  transform: rotate(-18deg);
  filter: blur(0.5px);
  pointer-events: none;
}

.kxm-face {
  position: relative;
  display: flex; align-items: center; gap: 17%;
  margin-top: 6%;
  animation: kxm-glance 8s ease-in-out infinite;
  will-change: transform;
}
.kxm-eye {
  width: 9px; height: 14px;
  border-radius: 6px;
  background: linear-gradient(180deg, #eaf2ff, #60a5fa);
  box-shadow: 0 0 10px rgba(96,165,250,0.85), inset 0 -1px 2px rgba(0,0,0,0.25);
  animation: kxm-blink 3.8s ease-in-out infinite;
  transform-origin: center;
}
.kxm-eye-r { animation-delay: 0.05s; }

/* Awake — input focused: brighter aura, taller eyes, steady gaze */
.kxm-wrap[data-state="awake"] .kxm-glow { animation-duration: 3s; opacity: 1; }
.kxm-wrap[data-state="awake"] .kxm-eye { height: 16px; box-shadow: 0 0 14px rgba(96,165,250,1), inset 0 -1px 2px rgba(0,0,0,0.25); }
.kxm-wrap[data-state="awake"] .kxm-face { animation: none; }

/* Typing — subtle pulse */
.kxm-wrap[data-state="typing"] .kxm-orb { animation: kxm-pulse 1s ease-in-out infinite; }
.kxm-wrap[data-state="typing"] .kxm-face { animation: none; }

/* Working — generating: scanning eyes, faster aura */
.kxm-wrap[data-state="working"] .kxm-glow { animation-duration: 1.7s; }
.kxm-wrap[data-state="working"] .kxm-orb { animation: kxm-float 3s ease-in-out infinite; }
.kxm-wrap[data-state="working"] .kxm-eye { animation: kxm-scan 1.5s ease-in-out infinite; }
.kxm-wrap[data-state="working"] .kxm-face { animation: none; }

@keyframes kxm-float   { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes kxm-pulse   { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-2px) scale(1.03); } }
@keyframes kxm-breathe { 0%,100% { opacity: 0.5; transform: scale(0.92); } 50% { opacity: 0.92; transform: scale(1.08); } }
@keyframes kxm-shadow  { 0%,100% { opacity: 0.55; transform: translateX(-50%) scale(1); } 50% { opacity: 0.32; transform: translateX(-50%) scale(0.82); } }
@keyframes kxm-blink   { 0%,90%,100% { transform: scaleY(1); } 95% { transform: scaleY(0.08); } }
@keyframes kxm-glance  { 0%,58%,100% { transform: translateX(0); } 70% { transform: translateX(3px); } 82% { transform: translateX(-3px); } }
@keyframes kxm-scan    { 0%,100% { transform: translateY(-2px); opacity: 0.7; } 50% { transform: translateY(2px); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .kxm-glow, .kxm-shadow, .kxm-orb, .kxm-face, .kxm-eye { animation: none !important; }
  .kxm-glow { opacity: 0.7; }
}
`;
