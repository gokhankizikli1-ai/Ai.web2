import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * ProductStory (Phase 14J.4) — the public landing's animated product walkthrough.
 *
 * PR #461 introduced a correct three-step structure (Describe → Generate →
 * Refine on one continuous "Green Haven" project), but the stage started already
 * sitting in a composer/preview state and swapped scenes mostly by opacity, so
 * it read as three states rather than ONE object transforming. This revision
 * adds a short, premium, self-playing product film driven by a small phase state
 * machine:
 *
 *   core → describe → build → generate → refine → (settle)
 *
 * All phases render on ONE shared stage and transition via coordinated
 * transform/opacity keyed off `data-phase` (no display:none swaps, no
 * screenshot swapping). Autoplay runs ONCE when the section enters view on
 * desktop; the three left steps stay scroll- and click-controllable and take
 * over as soon as the visitor interacts (autoplay yields on first scroll and
 * hands off to scroll/click control on completion). A subtle Replay control
 * re-runs it.
 *
 * Honesty is unchanged: the stage is decorative (`aria-hidden`); every real
 * claim (Available now / Visual Edit "In development" / Delivery "Coming next")
 * lives as TEXT in the step copy, so reduced motion / no-JS loses nothing. No
 * fake logs, metrics, connected accounts, repo names, or deploy URLs.
 *
 * Motion budget: no MP4/GIF, no dependency, no rAF, no setInterval — only a
 * small finite chain of cleaned-up timeouts, gated to a visible, non-reduced,
 * desktop stage. Reduced motion shows each scene's final state immediately.
 */

const PS_CSS = `
.ps{ --d-bg:#0B0E12; --d-surf:#11161C; --d-border:#28323D; --d-line:rgba(255,255,255,0.06);
  --d-text:#F5F7FA; --d-body:#D7DEE8; --d-muted:#93A3B5; --d-accent:#8FA6BA; --blue:#3B82F6; --sage:#6F8F7A;
  position:relative; }
/* soft, restrained accent tone behind the stage (keeps the light page light) */
.ps::before{ content:""; position:absolute; inset:0; pointer-events:none; z-index:0;
  background:radial-gradient(60% 42% at 72% 40%, rgba(82,103,122,0.07), transparent 68%); }
.ps > *{ position:relative; z-index:1; }
.ps .ps-grid{ display:grid; grid-template-columns:1fr 1.12fr; gap:44px; align-items:start; margin-top:38px; }
.ps .ps-steps{ display:flex; flex-direction:column; }
.ps .ps-step{ border-left:2px solid var(--border); padding:20px 0 20px 20px; position:relative; transition:border-color .3s, opacity .3s; opacity:.5; }
.ps .ps-step[data-active="true"]{ opacity:1; border-left-color:var(--blue); }
.ps .ps-step .sn{ display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:8px;
  background:var(--section); color:var(--accent); font-family:var(--mono,ui-monospace); font-size:12px; font-weight:600; }
.ps .ps-step[data-active="true"] .sn{ background:rgba(59,130,246,0.12); color:#2f6ad0; }
.ps .ps-step h3{ font-size:19px; font-weight:660; letter-spacing:-0.018em; margin:10px 0 0; color:var(--ink); }
.ps .ps-step p{ font-size:14px; color:var(--muted); line-height:1.55; margin:8px 0 0; max-width:44ch; }
.ps .ps-badges{ display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; }
.ps .ps-status{ display:inline-flex; align-items:center; gap:6px; font-size:10.5px; font-weight:650; padding:3px 9px; border-radius:999px; border:1px solid; }
.ps .ps-status .sd{ width:5px; height:5px; border-radius:50%; }
.ps .st-now{ color:#3F6B57; border-color:rgba(111,143,122,0.4); background:rgba(111,143,122,0.10);} .ps .st-now .sd{ background:var(--sage);}
.ps .st-dev{ color:#6C5A2E; border-color:rgba(180,150,80,0.4); background:rgba(180,150,80,0.10);} .ps .st-dev .sd{ background:#C79A3A;}
.ps .st-next{ color:#4B5A6B; border-color:rgba(100,116,139,0.35); background:rgba(100,116,139,0.09);} .ps .st-next .sd{ background:#8593A3;}

/* stage */
.ps .ps-stagewrap{ position:sticky; top:88px; }
.ps .ps-replay{ display:inline-flex; align-items:center; gap:7px; margin-top:12px; font:inherit; font-size:12px; font-weight:600; color:var(--accent);
  background:transparent; border:1px solid var(--border); border-radius:9px; padding:6px 12px; cursor:pointer; transition:border-color .16s, color .16s; }
.ps .ps-replay:hover{ border-color:#C3CDD8; color:var(--ink); }
.ps .ps-replay:focus-visible{ outline:2px solid var(--blue); outline-offset:2px; }
.ps .ps-replay svg{ width:13px; height:13px; stroke:currentColor; stroke-width:1.8; fill:none; }
.ps .ps-stage{ position:relative; background:var(--d-bg); border:1px solid var(--d-border); border-radius:16px; overflow:hidden; min-height:392px;
  box-shadow:0 40px 90px -38px rgba(11,14,18,0.6),0 14px 30px -16px rgba(16,24,39,0.28);
  opacity:0; transform:translateY(14px) scale(0.985); transition:opacity .6s cubic-bezier(0.22,1,0.36,1), transform .6s cubic-bezier(0.22,1,0.36,1); }
.ps .ps-stage.enter{ opacity:1; transform:none; }

/* Phase 0 — Korvix core (lightweight CSS, no loop) */
.ps .ps-core{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:4;
  opacity:0; transition:opacity .5s ease; pointer-events:none; }
.ps .ps-stage[data-phase="core"] .ps-core{ opacity:1; }
.ps .ps-core .k{ position:relative; width:74px; height:74px; border-radius:20px; display:grid; place-items:center;
  background:linear-gradient(158deg, rgba(32,41,51,0.6), #0B0E12), #12171E;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.10), 0 10px 30px -8px rgba(0,0,0,0.6);
  color:#EDF1F5; font-family:var(--mono,ui-monospace); font-weight:700; font-size:30px; }
.ps .ps-stage[data-phase="core"] .ps-core .k{ animation:pscore .72s cubic-bezier(0.22,1,0.36,1) both; }
.ps .ps-core .ring{ position:absolute; inset:-14px; border-radius:30px; border:1px solid rgba(143,166,186,0.35); opacity:0; }
.ps .ps-stage[data-phase="core"] .ps-core .ring{ animation:psring .9s ease-out both; }
@keyframes pscore{ 0%{opacity:0; transform:scale(0.74) translateY(6px);} 60%{opacity:1;} 100%{opacity:1; transform:scale(1) translateY(0);} }
@keyframes psring{ 0%{opacity:0; transform:scale(0.8);} 40%{opacity:0.9;} 100%{opacity:0; transform:scale(1.25);} }

/* browser chrome — fades in once we leave the core */
.ps .ps-chrome{ display:flex; align-items:center; gap:9px; padding:11px 15px; border-bottom:1px solid var(--d-line);
  background:linear-gradient(180deg,#12171E,#0E1319); opacity:0; transition:opacity .45s ease; }
.ps .ps-stage:not([data-phase="core"]) .ps-chrome{ opacity:1; }
.ps .ps-chrome i{ width:10px; height:10px; border-radius:50%; background:#2C3742; }
.ps .ps-chrome .u{ margin:0 auto; font-size:11px; color:var(--d-muted); font-family:var(--mono,ui-monospace); background:#0E141A; border:1px solid var(--d-line); padding:4px 12px; border-radius:8px; }
.ps .ps-chrome .bdg{ font-size:9px; letter-spacing:0.04em; text-transform:uppercase; color:var(--d-accent); border:1px solid rgba(143,166,186,0.3); border-radius:6px; padding:3px 7px; }
.ps .ps-body{ position:relative; min-height:344px; padding:18px; background:radial-gradient(120% 90% at 50% 0%, #141B22, #0B0E12 72%); }

/* Phase 1 — Describe: composer */
.ps .ps-composer{ position:absolute; inset:18px; display:flex; flex-direction:column; gap:12px;
  opacity:0; transform:scale(0.96); transition:opacity .45s cubic-bezier(0.22,1,0.36,1), transform .45s cubic-bezier(0.22,1,0.36,1); pointer-events:none; }
.ps .ps-stage[data-phase="describe"] .ps-composer{ opacity:1; transform:scale(1); }
.ps .ps-modes{ display:flex; gap:6px; flex-wrap:wrap; }
.ps .ps-mode{ font-size:11px; color:var(--d-body); border:1px solid var(--d-border); background:var(--d-surf); border-radius:999px; padding:5px 11px; }
.ps .ps-mode.on{ color:#BFDBFE; border-color:rgba(59,130,246,0.5); background:rgba(59,130,246,0.12); }
.ps .ps-input{ flex:1; border:1px solid var(--d-border); background:var(--d-surf); border-radius:12px; padding:14px; font-size:14px; color:var(--d-text); line-height:1.5; }
.ps .ps-caret{ display:inline-block; width:2px; height:16px; vertical-align:-3px; margin-left:1px; background:var(--blue); animation:pscaret 1.05s steps(1) infinite; }
@keyframes pscaret{ 50%{opacity:0;} }
.ps .ps-startbtn{ align-self:flex-start; display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; color:#fff;
  background:linear-gradient(180deg,#2563EB,#1D4ED8); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:9px 14px; transition:box-shadow .3s, transform .12s; }
.ps .ps-startbtn.ready{ box-shadow:0 0 0 4px rgba(59,130,246,0.16); }
.ps .ps-stage[data-phase="build"] .ps-startbtn{ transform:scale(0.96); }
.ps .ps-startbtn svg{ width:14px; height:14px; stroke:currentColor; stroke-width:1.8; fill:none; }

/* Phases 2 & 3 — the same Green Haven preview */
.ps .ps-preview{ position:absolute; inset:18px; display:flex; flex-direction:column; gap:12px;
  opacity:0; transform:scale(0.975); transition:opacity .5s cubic-bezier(0.22,1,0.36,1), transform .5s cubic-bezier(0.22,1,0.36,1); pointer-events:none; }
.ps .ps-stage[data-phase="build"] .ps-preview,
.ps .ps-stage[data-phase="generate"] .ps-preview,
.ps .ps-stage[data-phase="refine"] .ps-preview{ opacity:1; transform:scale(1); }
.ps .ps-build{ position:absolute; top:0; left:0; right:0; display:flex; align-items:center; gap:9px; padding:9px 12px; font-size:11.5px; color:var(--d-body);
  background:#0C1116; border:1px solid var(--d-line); border-radius:10px; opacity:0; transition:opacity .3s ease; z-index:3; }
.ps .ps-stage[data-phase="build"] .ps-build{ opacity:1; }
.ps .ps-build .spin{ width:12px; height:12px; border-radius:50%; border:1.6px solid rgba(143,166,186,0.3); border-top-color:var(--d-accent); }
/* the spinner only animates while the brief build phase is on screen */
.ps .ps-stage[data-phase="build"] .ps-build .spin{ animation:psspin .8s linear infinite; }
@keyframes psspin{ to{ transform:rotate(360deg); } }
.ps .ps-hero{ position:relative; border:1px solid var(--d-line); border-radius:12px; padding:24px 18px; text-align:center; margin-top:6px;
  background:linear-gradient(160deg,#1B2A22,#14201A); transition:background .6s ease, box-shadow .6s ease, transform .6s ease; }
.ps .ps-stage[data-phase="refine"] .ps-hero{ background:linear-gradient(160deg,#0A130F,#050907); box-shadow:inset 0 0 0 1px rgba(111,143,122,0.28), 0 10px 30px -14px #000; }
.ps .ps-hero h4{ margin:0; font-size:18px; font-weight:680; letter-spacing:-0.02em; color:var(--d-text); transition:letter-spacing .5s ease, text-shadow .5s ease; }
.ps .ps-stage[data-phase="refine"] .ps-hero h4{ letter-spacing:-0.01em; text-shadow:0 1px 20px rgba(143,166,186,0.35); }
.ps .ps-line{ height:8px; border-radius:5px; margin:8px auto 0; background:linear-gradient(90deg,#243b30,#2f4d3e); }
.ps .ps-cta{ display:inline-block; margin-top:14px; font-size:11px; font-weight:600; color:#0F1729; background:#DCE7DE; border-radius:8px; padding:7px 14px; transition:background .5s ease, color .5s ease; }
.ps .ps-stage[data-phase="refine"] .ps-cta{ background:linear-gradient(180deg,#8FA6BA,#6E8598); color:#0A0F14; }
.ps .ps-cards{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.ps .ps-card{ border:1px solid var(--d-line); border-radius:11px; padding:13px; background:var(--d-surf); display:flex; flex-direction:column; gap:8px; }
.ps .ps-card .ci{ width:24px; height:24px; border-radius:7px; background:rgba(111,143,122,0.22); }
.ps .ps-card .cl{ height:7px; border-radius:4px; background:#232d27; }
/* progressive assembly on build/generate */
.ps .ps-stage[data-phase="build"] .ps-hero, .ps .ps-stage[data-phase="generate"] .ps-hero{ animation:psrise .5s cubic-bezier(0.22,1,0.36,1) both; }
.ps .ps-stage[data-phase="build"] .ps-card, .ps .ps-stage[data-phase="generate"] .ps-card{ animation:psrise .5s cubic-bezier(0.22,1,0.36,1) both; }
.ps .ps-stage[data-phase="build"] .ps-card:nth-child(1), .ps .ps-stage[data-phase="generate"] .ps-card:nth-child(1){ animation-delay:.09s; }
.ps .ps-stage[data-phase="build"] .ps-card:nth-child(2), .ps .ps-stage[data-phase="generate"] .ps-card:nth-child(2){ animation-delay:.17s; }
.ps .ps-stage[data-phase="build"] .ps-card:nth-child(3), .ps .ps-stage[data-phase="generate"] .ps-card:nth-child(3){ animation-delay:.25s; }
@keyframes psrise{ from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:translateY(0);} }

/* Phase 3 — refine overlays */
.ps .ps-sel{ position:absolute; inset:-6px; border:1.5px solid rgba(59,130,246,0.8); border-radius:14px; opacity:0; transition:opacity .4s ease; pointer-events:none; }
.ps .ps-sel .tg{ position:absolute; top:-11px; left:12px; font-size:10px; color:#BFDBFE; background:#12202F; border:1px solid rgba(59,130,246,0.5); border-radius:6px; padding:2px 8px; white-space:nowrap; }
.ps .ps-stage[data-phase="refine"] .ps-sel{ opacity:1; }
.ps .ps-cursor{ position:absolute; top:0; left:0; z-index:5; width:16px; height:16px; opacity:0; pointer-events:none; }
.ps .ps-cursor svg{ width:16px; height:16px; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
.ps .ps-stage[data-phase="refine"] .ps-cursor{ animation:pscursor 1s cubic-bezier(0.22,1,0.36,1) both; }
@keyframes pscursor{ 0%{opacity:0; transform:translate(78%,150%);} 25%{opacity:1;} 100%{opacity:1; transform:translate(46%,58%);} }
.ps .ps-chat{ display:flex; align-items:center; gap:9px; border:1px solid var(--d-border); background:var(--d-surf); border-radius:11px; padding:10px 12px; opacity:0; transform:translateY(6px); transition:opacity .4s ease .15s, transform .4s ease .15s; }
.ps .ps-stage[data-phase="refine"] .ps-chat{ opacity:1; transform:translateY(0); }
.ps .ps-chat svg{ width:15px; height:15px; color:var(--d-accent); flex:none; stroke:currentColor; stroke-width:1.7; fill:none; }
.ps .ps-chat p{ margin:0; font-size:12px; color:var(--d-body); }
.ps .ps-deliver{ display:flex; gap:8px; flex-wrap:wrap; opacity:0; transition:opacity .4s ease .3s; }
.ps .ps-stage[data-phase="refine"] .ps-deliver{ opacity:1; }
.ps .ps-chip{ display:inline-flex; align-items:center; gap:7px; font-size:10.5px; color:var(--d-muted); border:1px solid var(--d-line); background:var(--d-surf); border-radius:999px; padding:5px 10px; }
.ps .ps-chip .dd{ width:5px; height:5px; border-radius:50%; background:#8593A3; }
.ps .ps-ready{ display:flex; align-items:center; gap:8px; margin-top:2px; justify-content:center; font-size:11.5px; color:var(--sage); opacity:0; transition:opacity .4s ease .15s; }
.ps .ps-stage[data-phase="generate"] .ps-ready{ opacity:1; }
.ps .ps-ready .dd{ width:6px; height:6px; border-radius:50%; background:var(--sage); }

.ps .ps-inline{ margin-top:16px; }

@media (prefers-reduced-motion:reduce){
  .ps .ps-stage{ opacity:1; transform:none; transition:none; }
  .ps .ps-caret{ animation:none; }
  .ps .ps-core .k, .ps .ps-core .ring, .ps .ps-cursor,
  .ps .ps-stage[data-phase="build"] .ps-hero, .ps .ps-stage[data-phase="generate"] .ps-hero,
  .ps .ps-stage[data-phase="build"] .ps-card, .ps .ps-stage[data-phase="generate"] .ps-card,
  .ps .ps-build .spin{ animation:none; }
  .ps .ps-cursor{ display:none; }
  .ps .ps-composer,.ps .ps-preview,.ps .ps-hero,.ps .ps-hero h4,.ps .ps-cta,.ps .ps-sel,.ps .ps-chat,.ps .ps-deliver,.ps .ps-ready,.ps .ps-chrome,.ps .ps-startbtn{ transition:none; }
}
@media (max-width:900px){
  .ps .ps-grid{ grid-template-columns:1fr; gap:8px; margin-top:26px; }
  .ps .ps-stagewrap{ position:static; }
  .ps .ps-body{ min-height:300px; }
  .ps .ps-stage{ min-height:0; }
}
/* Short desktop viewports: drop sticky so the stage never exceeds the screen. */
@media (min-width:901px) and (max-height:760px){
  .ps .ps-stagewrap{ position:static; }
}
`;

type Phase = 'core' | 'describe' | 'build' | 'generate' | 'refine';
/** Scene shown for a scroll/click-selected step (0/1/2). */
const STEP_PHASE: Phase[] = ['describe', 'generate', 'refine'];

/** Media-query hook (matchMedia + listener, cleaned up). SSR-safe default. */
function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return match;
}

const ARROW = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

/** The persistent product stage. `phase` selects what the single stage shows;
 *  `animate` gates motion (offscreen or reduced → final state shown). */
function Stage({ phase, animate, reduced, t }: { phase: Phase; animate: boolean; reduced: boolean; t: (k: string) => string }) {
  const fullPrompt = t('landingStoryPrompt');
  const [chars, setChars] = useState(fullPrompt.length);

  // Scene-1 typing — the ONLY timer here: a self-clearing timeout chain that
  // runs only while Describe is the active, in-view scene and motion is allowed.
  useEffect(() => {
    if (phase !== 'describe' || !animate || reduced) {
      setChars(fullPrompt.length);
      return;
    }
    setChars(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setChars(i);
      if (i < fullPrompt.length) timer = setTimeout(tick, 34);
    };
    timer = setTimeout(tick, 340);
    return () => clearTimeout(timer);
  }, [phase, animate, reduced, fullPrompt]);

  const typedDone = chars >= fullPrompt.length;

  return (
    <div className={`ps-stage${animate ? ' enter' : ''}`} data-phase={phase} aria-hidden="true">
      {/* Phase 0 — Korvix core */}
      <div className="ps-core">
        <span className="k">K<span className="ring" /></span>
      </div>

      <div className="ps-chrome">
        <i /><i /><i />
        <span className="u">preview</span>
        <span className="bdg">{t('landingStoryIllustrative')}</span>
      </div>
      <div className="ps-body">
        {/* Phase 1 — Describe */}
        <div className="ps-composer">
          <div className="ps-modes">
            <span className="ps-mode on">{t('landingTypeWebsite')}</span>
            <span className="ps-mode">{t('landingTypeWebApp')}</span>
            <span className="ps-mode">{t('landingTypeEcommerce')}</span>
          </div>
          <div className="ps-input">
            {phase === 'describe' ? fullPrompt.slice(0, chars) : fullPrompt}
            {phase === 'describe' && !typedDone && <span className="ps-caret" />}
          </div>
          <span className={`ps-startbtn${typedDone ? ' ready' : ''}`}>
            {t('ctaStartBuilding')}{ARROW}
          </span>
        </div>

        {/* Phases 2 & 3 — the same Green Haven preview */}
        <div className="ps-preview">
          <div className="ps-build">
            <span className="spin" /> {t('landingStoryBuilding')}
          </div>
          <div className="ps-hero">
            <h4>Green Haven</h4>
            <div className="ps-line" style={{ width: '64%' }} />
            <div className="ps-line" style={{ width: '46%' }} />
            <span className="ps-cta">{t('landingStoryPreviewCta')}</span>
            <span className="ps-sel"><span className="tg">{t('landingVeSelectionLabel')}</span></span>
          </div>
          <div className="ps-cards">
            {[0, 1, 2].map((i) => (
              <div className="ps-card" key={i}>
                <span className="ci" />
                <span className="cl" style={{ width: '78%' }} />
                <span className="cl" style={{ width: '56%' }} />
              </div>
            ))}
          </div>
          <div className="ps-ready"><span className="dd" /> {t('landingSceneReady')}</div>
          <div className="ps-chat">
            <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>
            <p>{t('landingVeInstruction')}</p>
          </div>
          <div className="ps-deliver">
            <span className="ps-chip"><span className="dd" /> GitHub — {t('landingStatusNext')}</span>
            <span className="ps-chip"><span className="dd" /> {t('landingDeployLabel')} — {t('landingStatusNext')}</span>
          </div>
        </div>

        {/* Decorative refine cursor (one-shot; hidden under reduced motion). */}
        <span className="ps-cursor">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l7 17 2.5-6.5L21 11 5 3z" fill="#F5F7FA" stroke="#0B0E12" strokeWidth="1" /></svg>
        </span>
      </div>
    </div>
  );
}

function StepStatuses({ scene, t }: { scene: number; t: (k: string) => string }) {
  if (scene < 2) {
    return (
      <div className="ps-badges">
        <span className="ps-status st-now"><span className="sd" />{t('landingStatusNow')}</span>
      </div>
    );
  }
  return (
    <div className="ps-badges">
      <span className="ps-status st-dev"><span className="sd" />{t('landingVeLabel')} · {t('landingStatusDev')}</span>
      <span className="ps-status st-next"><span className="sd" />{t('landingDelLabel')} · {t('landingStatusNext')}</span>
    </div>
  );
}

export default function ProductStory() {
  const { t } = useLanguageStore();
  const reduced = !!useReducedMotion();
  const isDesktop = useMediaQuery('(min-width: 901px)');

  // ── State model ───────────────────────────────────────────────────────
  //  mode      : 'auto' while the film self-plays, 'user' once the visitor
  //              scrolls/clicks or the film completes.
  //  phase     : the autoplay phase (used when mode === 'auto').
  //  activeStep: scroll/click-selected step (used when mode === 'user').
  //  inView    : the section is meaningfully on screen (drives autoplay + steps).
  const [mode, setMode] = useState<'auto' | 'user'>('auto');
  const [phase, setPhase] = useState<Phase>('core');
  const [activeStep, setActiveStep] = useState(0);
  const [inView, setInView] = useState(false);
  const [stepInView, setStepInView] = useState<boolean[]>([false, false, false]);
  const [playToken, setPlayToken] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const visRef = useRef<boolean[]>([false, false, false]);
  const playedRef = useRef(false);

  // Scroll-driven active step + section visibility (single IntersectionObserver,
  // thin center band → stable active step, no scroll hijack, no per-pixel math).
  useEffect(() => {
    const els = stepRefs.current.filter(Boolean) as HTMLElement[];
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      setStepInView([true, true, true]);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const vis = visRef.current;
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.idx);
          if (!Number.isNaN(idx)) vis[idx] = e.isIntersecting;
        }
        setStepInView([...vis]);
        setInView(vis.some(Boolean));
        const last = vis.lastIndexOf(true);
        if (last >= 0) setActiveStep(last);
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Autoplay film — desktop + motion-on only, once per view/replay. A finite
  // chain of timeouts advances the phase; all are cleared on unmount, when the
  // section leaves view, or when the visitor takes control. A one-shot scroll
  // listener (armed after the entry settles) yields control on first scroll.
  useEffect(() => {
    if (!isDesktop || reduced || mode !== 'auto' || !inView || playedRef.current) return;
    setPhase('core');
    const seq: [Phase, number][] = [['core', 760], ['describe', 2700], ['build', 760], ['generate', 1500]];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let acc = 0;
    seq.forEach(([, dur], i) => {
      acc += dur;
      const next: Phase = seq[i + 1] ? seq[i + 1][0] : 'refine';
      timers.push(setTimeout(() => setPhase(next), acc));
    });
    // Completed: hold the refined state and hand off to scroll/click control.
    timers.push(setTimeout(() => { playedRef.current = true; setActiveStep(2); setMode('user'); }, acc + 2600));

    let cleanupScroll = () => {};
    const armTimer = setTimeout(() => {
      const onScroll = () => setMode('user');
      window.addEventListener('scroll', onScroll, { passive: true, once: true });
      cleanupScroll = () => window.removeEventListener('scroll', onScroll);
    }, 500);

    return () => { timers.forEach(clearTimeout); clearTimeout(armTimer); cleanupScroll(); };
  }, [isDesktop, reduced, mode, inView, playToken]);

  const replay = () => { playedRef.current = false; setActiveStep(0); setMode('auto'); setPhase('core'); setPlayToken((n) => n + 1); };

  // What the desktop stage shows: the autoplay phase, or the selected step.
  const desktopPhase: Phase = mode === 'auto' && !reduced ? phase : STEP_PHASE[activeStep];
  const showReplay = isDesktop && !reduced && mode === 'user';

  const STEPS = [
    { title: 'landingStoryStep1Title', desc: 'landingStoryStep1Desc' },
    { title: 'landingStoryStep2Title', desc: 'landingStoryStep2Desc' },
    { title: 'landingStoryStep3Title', desc: 'landingStoryStep3Desc' },
  ];

  return (
    <section id="how" className="ps" aria-label={t('landingStoryStageLabel')}>
      <style>{PS_CSS}</style>
      <div className="wrap center">
        <span className="sec-label">{t('landingStoryLabel')}</span>
        <h2 className="h2">{t('landingStoryTitle')}</h2>
        <p className="sec-sub">{t('landingStorySub')}</p>
      </div>
      <div className="wrap">
        <div className="ps-grid">
          <div className="ps-steps">
            {STEPS.map((s, i) => {
              const active = isDesktop
                ? (mode === 'auto' && !reduced ? phase === STEP_PHASE[i] : activeStep === i)
                : stepInView[i];
              return (
                <div
                  key={s.title}
                  ref={(el) => { stepRefs.current[i] = el; }}
                  data-idx={i}
                  data-active={active}
                  aria-current={active ? 'step' : undefined}
                  className="ps-step"
                >
                  <span className="sn" aria-hidden="true">{i + 1}</span>
                  <h3>{t(s.title)}</h3>
                  <p>{t(s.desc)}</p>
                  <StepStatuses scene={i} t={t} />
                  {!isDesktop && (
                    <div className="ps-inline">
                      <Stage phase={STEP_PHASE[i]} animate={stepInView[i]} reduced={reduced} t={t} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isDesktop && (
            <div className="ps-stagewrap">
              <Stage phase={desktopPhase} animate={inView} reduced={reduced} t={t} />
              {showReplay && (
                <button type="button" className="ps-replay" onClick={replay}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6M20 20v-6h-6" /><path d="M20 9a8 8 0 0 0-14.3-3.3L4 7M4 15a8 8 0 0 0 14.3 3.3L20 17" /></svg>
                  {t('landingStoryReplay')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
