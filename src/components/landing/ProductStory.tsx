import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * ProductStory (Phase 14J.5) — the public landing's interactive product film.
 *
 * PR #462 built a continuous three-scene story, but three problems remained:
 *   1. Scene 3's overlays (cursor / selection / chat / delivery) were all tied
 *      to the single `refine` phase, so they appeared near-simultaneously — the
 *      Refine step never played as a timed sequence.
 *   2. The narrative steps were non-interactive text containers.
 *   3. Core → Composer was two opacity-swapped layers.
 *
 * This revision introduces a fine-grained phase timeline driven by ONE central
 * scheduler with a single `clearTimeline()` cleanup, and makes each step an
 * accessible control that replays its scene from the start:
 *
 *   core → composer → typing → submit
 *        → building → assemble → ready
 *        → r-cursor → r-hover → r-select → r-chat → r-typing → r-apply → r-done
 *
 * One shared stage renders every phase (sticky beside the steps on desktop,
 * non-sticky below them on mobile). Autoplay plays the full film once on first
 * desktop view; a click plays just that scene (with a short manual-control lock
 * so the scroll observer doesn't immediately override it); scroll selects scenes
 * once the visitor has control; a Replay button re-runs the film.
 *
 * Honesty is unchanged: the stage is decorative (`aria-hidden`); every real
 * claim (Available now / Visual Edit "In development" / Delivery "Coming next")
 * lives as TEXT in the step copy. No fake logs/metrics/connected accounts/repo
 * names/deploy URLs. Motion budget: no MP4/GIF, no dependency, no rAF, no
 * setInterval — only a finite chain of cleaned-up timeouts, and reduced motion
 * shows each scene's final state immediately.
 */

const PS_CSS = `
.ps{ --d-bg:#0B0E12; --d-surf:#11161C; --d-border:#28323D; --d-line:rgba(255,255,255,0.06);
  --d-text:#F5F7FA; --d-body:#D7DEE8; --d-muted:#93A3B5; --d-accent:#8FA6BA; --blue:#3B82F6; --sage:#6F8F7A;
  position:relative; }
.ps::before{ content:""; position:absolute; inset:0; pointer-events:none; z-index:0;
  background:radial-gradient(58% 44% at 74% 42%, rgba(82,103,122,0.08), transparent 66%); }
.ps > *{ position:relative; z-index:1; }
.ps .ps-grid{ display:grid; grid-template-columns:1fr 1.14fr; gap:44px; align-items:start; margin-top:38px; }
.ps .ps-steps{ display:flex; flex-direction:column; gap:4px; }

/* step — a real interactive control via a stretched hit button that keeps the
   <h3> a real heading (button doesn't wrap the heading). */
.ps .ps-step{ position:relative; border-left:2px solid var(--border); padding:18px 0 18px 20px; border-radius:0 12px 12px 0;
  transition:border-color .3s, background .3s, opacity .3s; opacity:.62; }
.ps .ps-step[data-active="true"]{ opacity:1; border-left-color:var(--blue); background:linear-gradient(90deg, rgba(59,130,246,0.06), transparent 70%); }
.ps .ps-hit{ position:absolute; inset:0; z-index:2; background:transparent; border:0; padding:0; margin:0; cursor:pointer; border-radius:0 12px 12px 0; }
.ps .ps-hit:focus-visible{ outline:2px solid var(--blue); outline-offset:-2px; }
.ps .ps-step .sn{ display:inline-flex; align-items:center; justify-content:center; width:27px; height:27px; border-radius:8px;
  background:var(--section); color:var(--accent); font-family:var(--mono,ui-monospace); font-size:12px; font-weight:600; transition:background .3s, color .3s; }
.ps .ps-step[data-active="true"] .sn{ background:linear-gradient(180deg,#2563EB,#1D4ED8); color:#fff; }
.ps .ps-step h3{ font-size:19px; font-weight:660; letter-spacing:-0.018em; margin:10px 0 0; color:var(--ink); }
.ps .ps-step p{ font-size:14px; color:var(--muted); line-height:1.55; margin:8px 0 0; max-width:44ch; }
.ps .ps-badges{ display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; position:relative; z-index:3; }
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
.ps .ps-stage{ position:relative; background:var(--d-bg); border:1px solid var(--d-border); border-radius:16px; overflow:hidden; min-height:404px;
  box-shadow:0 44px 96px -40px rgba(11,14,18,0.62),0 16px 32px -18px rgba(16,24,39,0.3);
  opacity:0; transform:translateY(14px) scale(0.985); transition:opacity .6s cubic-bezier(0.22,1,0.36,1), transform .6s cubic-bezier(0.22,1,0.36,1); }
.ps .ps-stage.enter{ opacity:1; transform:none; }

/* Phase 0 — Korvix core; expands toward the composer as we leave it */
.ps .ps-core{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; z-index:4;
  opacity:0; transform:scale(1); transition:opacity .5s ease, transform .55s cubic-bezier(0.22,1,0.36,1); pointer-events:none; }
.ps .ps-stage[data-scene="core"] .ps-core{ opacity:1; }
.ps .ps-stage:not([data-scene="core"]) .ps-core{ opacity:0; transform:scale(1.35) translateX(-18%); }
.ps .ps-core .k{ position:relative; width:74px; height:74px; border-radius:20px; display:grid; place-items:center;
  background:linear-gradient(158deg, rgba(32,41,51,0.6), #0B0E12), #12171E;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.10), 0 10px 30px -8px rgba(0,0,0,0.6);
  color:#EDF1F5; font-family:var(--mono,ui-monospace); font-weight:700; font-size:30px; }
.ps .ps-stage[data-scene="core"] .ps-core .k{ animation:pscore .6s cubic-bezier(0.22,1,0.36,1) both; }
.ps .ps-core .ring{ position:absolute; inset:-14px; border-radius:30px; border:1px solid rgba(143,166,186,0.35); opacity:0; }
.ps .ps-stage[data-scene="core"] .ps-core .ring{ animation:psring .95s ease-out both; }
@keyframes pscore{ 0%{opacity:0; transform:scale(0.72) translateY(6px);} 60%{opacity:1;} 100%{opacity:1; transform:scale(1) translateY(0);} }
@keyframes psring{ 0%{opacity:0; transform:scale(0.82);} 40%{opacity:0.9;} 100%{opacity:0; transform:scale(1.3);} }

.ps .ps-chrome{ display:flex; align-items:center; gap:9px; padding:11px 15px; border-bottom:1px solid var(--d-line);
  background:linear-gradient(180deg,#12171E,#0E1319); opacity:0; transition:opacity .5s ease; }
.ps .ps-stage[data-chrome="true"] .ps-chrome{ opacity:1; }
.ps .ps-chrome i{ width:10px; height:10px; border-radius:50%; background:#2C3742; }
.ps .ps-chrome .u{ margin:0 auto; font-size:11px; color:var(--d-muted); font-family:var(--mono,ui-monospace); background:#0E141A; border:1px solid var(--d-line); padding:4px 12px; border-radius:8px; }
.ps .ps-chrome .bdg{ font-size:9px; letter-spacing:0.04em; text-transform:uppercase; color:var(--d-accent); border:1px solid rgba(143,166,186,0.3); border-radius:6px; padding:3px 7px; }
.ps .ps-body{ position:relative; min-height:356px; padding:18px; background:radial-gradient(120% 90% at 50% 0%, #141B22, #0B0E12 72%); }

/* Scene 1 — composer; emerges from the core with a small control stagger */
.ps .ps-composer{ position:absolute; inset:18px; display:flex; flex-direction:column; gap:12px;
  opacity:0; transform:scale(0.9); transform-origin:center; transition:opacity .5s cubic-bezier(0.22,1,0.36,1), transform .5s cubic-bezier(0.22,1,0.36,1); pointer-events:none; }
.ps .ps-stage[data-scene="describe"] .ps-composer{ opacity:1; transform:scale(1); }
.ps .ps-composer > *{ opacity:0; transform:translateY(8px); transition:opacity .4s ease, transform .4s ease; }
.ps .ps-stage[data-scene="describe"] .ps-composer > *{ opacity:1; transform:none; }
.ps .ps-stage[data-scene="describe"] .ps-composer > *:nth-child(1){ transition-delay:.14s; }
.ps .ps-stage[data-scene="describe"] .ps-composer > *:nth-child(2){ transition-delay:.24s; }
.ps .ps-stage[data-scene="describe"] .ps-composer > *:nth-child(3){ transition-delay:.34s; }
.ps .ps-modes{ display:flex; gap:6px; flex-wrap:wrap; }
.ps .ps-mode{ font-size:11px; color:var(--d-body); border:1px solid var(--d-border); background:var(--d-surf); border-radius:999px; padding:5px 11px; }
.ps .ps-mode.on{ color:#BFDBFE; border-color:rgba(59,130,246,0.5); background:rgba(59,130,246,0.12); }
.ps .ps-input{ flex:1; border:1px solid var(--d-border); background:var(--d-surf); border-radius:12px; padding:14px; font-size:14px; color:var(--d-text); line-height:1.5; }
.ps .ps-caret{ display:inline-block; width:2px; height:16px; vertical-align:-3px; margin-left:1px; background:var(--blue); animation:pscaret 1.05s steps(1) infinite; }
@keyframes pscaret{ 50%{opacity:0;} }
.ps .ps-startbtn{ align-self:flex-start; display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; color:#fff;
  background:linear-gradient(180deg,#2563EB,#1D4ED8); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:9px 14px; transition:box-shadow .3s, transform .12s; }
.ps .ps-startbtn.ready{ box-shadow:0 0 0 4px rgba(59,130,246,0.16); }
.ps .ps-stage[data-phase="submit"] .ps-startbtn{ transform:scale(0.94); }
.ps .ps-startbtn svg{ width:14px; height:14px; stroke:currentColor; stroke-width:1.8; fill:none; }

/* Scenes 2 & 3 — the same Green Haven preview */
.ps .ps-preview{ position:absolute; inset:18px; display:flex; flex-direction:column; gap:12px;
  opacity:0; transform:scale(0.975); transition:opacity .5s cubic-bezier(0.22,1,0.36,1), transform .5s cubic-bezier(0.22,1,0.36,1); pointer-events:none; }
.ps .ps-stage[data-scene="generate"] .ps-preview,
.ps .ps-stage[data-scene="refine"] .ps-preview{ opacity:1; transform:scale(1); }
.ps .ps-build{ position:absolute; top:0; left:0; right:0; display:flex; align-items:center; gap:9px; padding:9px 12px; font-size:11.5px; color:var(--d-body);
  background:#0C1116; border:1px solid var(--d-line); border-radius:10px; opacity:0; transition:opacity .3s ease; z-index:3; }
.ps .ps-stage[data-building="true"] .ps-build{ opacity:1; }
.ps .ps-build .spin{ width:12px; height:12px; border-radius:50%; border:1.6px solid rgba(143,166,186,0.3); border-top-color:var(--d-accent); }
.ps .ps-stage[data-building="true"] .ps-build .spin{ animation:psspin .8s linear infinite; }
@keyframes psspin{ to{ transform:rotate(360deg); } }
.ps .ps-hero{ position:relative; border:1px solid var(--d-line); border-radius:12px; padding:24px 18px; text-align:center; margin-top:6px;
  background:linear-gradient(160deg,#1B2A22,#14201A); transition:background .65s ease, box-shadow .65s ease, border-color .4s ease; }
.ps .ps-stage[data-hover="true"] .ps-hero{ border-color:rgba(59,130,246,0.35); box-shadow:0 0 0 1px rgba(59,130,246,0.18); }
.ps .ps-stage[data-apply="true"] .ps-hero{ background:linear-gradient(160deg,#0A130F,#050907); box-shadow:inset 0 0 0 1px rgba(111,143,122,0.28), 0 10px 30px -14px #000; }
.ps .ps-hero h4{ margin:0; font-size:18px; font-weight:680; letter-spacing:-0.02em; color:var(--d-text); transition:letter-spacing .5s ease, text-shadow .5s ease; }
.ps .ps-stage[data-apply="true"] .ps-hero h4{ letter-spacing:-0.005em; text-shadow:0 1px 22px rgba(143,166,186,0.4); }
.ps .ps-line{ height:8px; border-radius:5px; margin:8px auto 0; background:linear-gradient(90deg,#243b30,#2f4d3e); }
.ps .ps-cta{ display:inline-block; margin-top:14px; font-size:11px; font-weight:600; color:#0F1729; background:#DCE7DE; border-radius:8px; padding:7px 14px; transition:background .55s ease, color .55s ease; }
.ps .ps-stage[data-apply="true"] .ps-cta{ background:linear-gradient(180deg,#8FA6BA,#6E8598); color:#0A0F14; }
.ps .ps-cards{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.ps .ps-card{ border:1px solid var(--d-line); border-radius:11px; padding:13px; background:var(--d-surf); display:flex; flex-direction:column; gap:8px; }
.ps .ps-card .ci{ width:24px; height:24px; border-radius:7px; background:rgba(111,143,122,0.22); }
.ps .ps-card .cl{ height:7px; border-radius:4px; background:#232d27; }
/* progressive assembly while building/generating */
.ps .ps-stage[data-scene="generate"] .ps-hero{ animation:psrise .5s cubic-bezier(0.22,1,0.36,1) both; }
.ps .ps-stage[data-scene="generate"] .ps-card{ animation:psrise .5s cubic-bezier(0.22,1,0.36,1) both; }
.ps .ps-stage[data-scene="generate"] .ps-card:nth-child(1){ animation-delay:.09s; }
.ps .ps-stage[data-scene="generate"] .ps-card:nth-child(2){ animation-delay:.17s; }
.ps .ps-stage[data-scene="generate"] .ps-card:nth-child(3){ animation-delay:.25s; }
@keyframes psrise{ from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:translateY(0);} }

/* Scene 3 — refine overlays, revealed step by step */
.ps .ps-sel{ position:absolute; inset:-6px; border:1.5px solid rgba(59,130,246,0.85); border-radius:14px; opacity:0; transform:scale(1.02); transition:opacity .4s ease, transform .4s cubic-bezier(0.22,1,0.36,1); pointer-events:none; }
.ps .ps-sel .hd{ position:absolute; width:7px; height:7px; border-radius:2px; background:#60A5FA; border:1.5px solid #0B0E12; }
.ps .ps-sel .hd.tl{ top:-4px; left:-4px; } .ps .ps-sel .hd.tr{ top:-4px; right:-4px; } .ps .ps-sel .hd.bl{ bottom:-4px; left:-4px; } .ps .ps-sel .hd.br{ bottom:-4px; right:-4px; }
.ps .ps-sel .tg{ position:absolute; top:-11px; left:12px; font-size:10px; color:#BFDBFE; background:#12202F; border:1px solid rgba(59,130,246,0.5); border-radius:6px; padding:2px 8px; white-space:nowrap; }
.ps .ps-stage[data-sel="true"] .ps-sel{ opacity:1; transform:scale(1); }
.ps .ps-cursor{ position:absolute; top:0; left:0; z-index:5; width:16px; height:16px; opacity:0; pointer-events:none; transform:translate(80%,155%); }
.ps .ps-cursor svg{ width:16px; height:16px; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
.ps .ps-stage[data-cursor="true"] .ps-cursor{ animation:pscursor .82s cubic-bezier(0.22,1,0.36,1) forwards; }
@keyframes pscursor{ 0%{opacity:0; transform:translate(80%,155%);} 25%{opacity:1;} 100%{opacity:1; transform:translate(48%,60%);} }
.ps .ps-chat{ display:flex; align-items:center; gap:9px; border:1px solid var(--d-border); background:var(--d-surf); border-radius:11px; padding:10px 12px;
  opacity:0; transform:translateY(8px) scale(0.96); box-shadow:0 0 0 rgba(0,0,0,0); transition:opacity .5s cubic-bezier(0.22,1,0.36,1), transform .5s cubic-bezier(0.22,1,0.36,1), box-shadow .5s ease; }
.ps .ps-stage[data-chat="true"] .ps-chat{ opacity:1; transform:translateY(0) scale(1); box-shadow:0 14px 30px -18px rgba(0,0,0,0.7); }
.ps .ps-chat svg{ width:15px; height:15px; color:var(--d-accent); flex:none; stroke:currentColor; stroke-width:1.7; fill:none; }
.ps .ps-chat p{ margin:0; font-size:12px; color:var(--d-body); min-height:1em; }
.ps .ps-deliver{ display:flex; gap:8px; flex-wrap:wrap; opacity:0; transform:translateY(6px); transition:opacity .45s ease, transform .45s ease; }
.ps .ps-stage[data-deliver="true"] .ps-deliver{ opacity:1; transform:none; }
.ps .ps-chip{ display:inline-flex; align-items:center; gap:7px; font-size:10.5px; color:var(--d-muted); border:1px solid var(--d-line); background:var(--d-surf); border-radius:999px; padding:5px 10px; }
.ps .ps-chip .dd{ width:5px; height:5px; border-radius:50%; background:#8593A3; }
.ps .ps-ready{ display:flex; align-items:center; gap:8px; margin-top:2px; justify-content:center; font-size:11.5px; color:var(--sage); opacity:0; transition:opacity .4s ease; }
.ps .ps-stage[data-ready="true"] .ps-ready{ opacity:1; }
.ps .ps-ready .dd{ width:6px; height:6px; border-radius:50%; background:var(--sage); }

@media (prefers-reduced-motion:reduce){
  .ps .ps-stage{ opacity:1; transform:none; transition:none; }
  .ps .ps-caret{ animation:none; }
  .ps .ps-core .k, .ps .ps-core .ring, .ps .ps-cursor,
  .ps .ps-stage[data-scene="generate"] .ps-hero, .ps .ps-stage[data-scene="generate"] .ps-card,
  .ps .ps-build .spin{ animation:none; }
  .ps .ps-cursor{ display:none; }
  .ps .ps-core, .ps .ps-composer, .ps .ps-composer > *, .ps .ps-preview, .ps .ps-hero, .ps .ps-hero h4, .ps .ps-cta,
  .ps .ps-sel, .ps .ps-chat, .ps .ps-deliver, .ps .ps-ready, .ps .ps-chrome, .ps .ps-startbtn{ transition:none; }
}
@media (max-width:900px){
  .ps .ps-grid{ grid-template-columns:1fr; gap:20px; margin-top:26px; }
  .ps .ps-stagewrap{ position:static; }
  .ps .ps-body{ min-height:316px; }
  .ps .ps-stage{ min-height:0; }
}
@media (min-width:901px) and (max-height:760px){
  .ps .ps-stagewrap{ position:static; }
}
`;

type Phase =
  | 'core' | 'composer' | 'typing' | 'submit'
  | 'building' | 'assemble' | 'ready'
  | 'r-cursor' | 'r-hover' | 'r-select' | 'r-chat' | 'r-typing' | 'r-apply' | 'r-done';

const ORDER: Phase[] = [
  'core', 'composer', 'typing', 'submit',
  'building', 'assemble', 'ready',
  'r-cursor', 'r-hover', 'r-select', 'r-chat', 'r-typing', 'r-apply', 'r-done',
];
type Scene = 'core' | 'describe' | 'generate' | 'refine';
const SCENE_OF: Record<Phase, Scene> = {
  core: 'core', composer: 'describe', typing: 'describe', submit: 'describe',
  building: 'generate', assemble: 'generate', ready: 'generate',
  'r-cursor': 'refine', 'r-hover': 'refine', 'r-select': 'refine', 'r-chat': 'refine',
  'r-typing': 'refine', 'r-apply': 'refine', 'r-done': 'refine',
};
const SCENE_STEP: Record<Exclude<Scene, 'core'>, number> = { describe: 0, generate: 1, refine: 2 };
const STEP_FIRST: Phase[] = ['composer', 'building', 'r-cursor'];
const STEP_TERMINAL: Phase[] = ['submit', 'ready', 'r-done'];
/** Per-step sub-phase timelines (ms offsets from the scene's start). */
const SCENE_SEQ: [Phase, number][][] = [
  [['composer', 0], ['typing', 560], ['submit', 2680]],
  [['building', 0], ['assemble', 700], ['ready', 1600]],
  [['r-cursor', 0], ['r-hover', 780], ['r-select', 1020], ['r-chat', 1440], ['r-typing', 1980], ['r-apply', 3200], ['r-done', 3960]],
];
/** Full autoplay film: [phase, absolute ms]. */
const FILM: [Phase, number][] = [
  ['core', 0], ['composer', 640], ['typing', 1200], ['submit', 3340],
  ['building', 3780], ['assemble', 4480], ['ready', 5380],
  ['r-cursor', 6180], ['r-hover', 6960], ['r-select', 7200], ['r-chat', 7620], ['r-typing', 8160], ['r-apply', 9380], ['r-done', 10140],
];
const FILM_END = 10740;

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

/** One shared stage. `phase` selects everything shown via data-attributes;
 *  `reduced` shows final states with no motion. */
function Stage({ phase, entered, reduced, t }: { phase: Phase; entered: boolean; reduced: boolean; t: (k: string) => string }) {
  const idx = ORDER.indexOf(phase);
  const reached = (p: Phase) => idx >= ORDER.indexOf(p);
  const scene = SCENE_OF[phase];

  const prompt = t('landingStoryPrompt');
  const instruction = t('landingVeInstruction');
  const [pChars, setPChars] = useState(prompt.length);
  const [iChars, setIChars] = useState(instruction.length);

  // Prompt typing — active only while phase === 'typing'.
  useEffect(() => {
    if (phase !== 'typing' || reduced) { setPChars(prompt.length); return; }
    setPChars(0);
    let i = 0; let timer: ReturnType<typeof setTimeout>;
    const tick = () => { i += 1; setPChars(i); if (i < prompt.length) timer = setTimeout(tick, 30); };
    timer = setTimeout(tick, 220);
    return () => clearTimeout(timer);
  }, [phase, reduced, prompt]);

  // Instruction typing — active only while phase === 'r-typing'.
  useEffect(() => {
    if (phase !== 'r-typing' || reduced) { setIChars(instruction.length); return; }
    setIChars(0);
    let i = 0; let timer: ReturnType<typeof setTimeout>;
    const tick = () => { i += 1; setIChars(i); if (i < instruction.length) timer = setTimeout(tick, 26); };
    timer = setTimeout(tick, 160);
    return () => clearTimeout(timer);
  }, [phase, reduced, instruction]);

  const promptTyping = phase === 'typing' && !reduced;
  const promptText = scene === 'describe' && promptTyping ? prompt.slice(0, pChars) : prompt;
  const promptFull = pChars >= prompt.length;
  const instrTyping = phase === 'r-typing' && !reduced;
  // The instruction shell (chat) is present from r-chat; text reveals at r-typing.
  const instrVisible = reached('r-typing');
  const instrText = instrTyping ? instruction.slice(0, iChars) : (instrVisible ? instruction : '');

  return (
    <div
      className={`ps-stage${entered ? ' enter' : ''}`}
      data-phase={phase}
      data-scene={scene}
      data-chrome={scene !== 'core'}
      data-building={phase === 'building'}
      data-ready={phase === 'ready'}
      data-cursor={scene === 'refine' && reached('r-cursor') && !reached('r-done')}
      data-hover={reached('r-hover')}
      data-sel={reached('r-select')}
      data-chat={reached('r-chat')}
      data-apply={reached('r-apply')}
      data-deliver={reached('r-done')}
      aria-hidden="true"
    >
      <div className="ps-core"><span className="k">K<span className="ring" /></span></div>

      <div className="ps-chrome">
        <i /><i /><i />
        <span className="u">preview</span>
        <span className="bdg">{t('landingStoryIllustrative')}</span>
      </div>
      <div className="ps-body">
        {/* Scene 1 — Describe */}
        <div className="ps-composer">
          <div className="ps-modes">
            <span className="ps-mode on">{t('landingTypeWebsite')}</span>
            <span className="ps-mode">{t('landingTypeWebApp')}</span>
            <span className="ps-mode">{t('landingTypeEcommerce')}</span>
          </div>
          <div className="ps-input">
            {promptText}
            {promptTyping && !promptFull && <span className="ps-caret" />}
          </div>
          <span className={`ps-startbtn${(reduced || promptFull || scene !== 'describe') ? ' ready' : ''}`}>
            {t('ctaStartBuilding')}{ARROW}
          </span>
        </div>

        {/* Scenes 2 & 3 — the same Green Haven preview */}
        <div className="ps-preview">
          <div className="ps-build"><span className="spin" /> {t('landingStoryBuilding')}</div>
          <div className="ps-hero">
            <h4>Green Haven</h4>
            <div className="ps-line" style={{ width: '64%' }} />
            <div className="ps-line" style={{ width: '46%' }} />
            <span className="ps-cta">{t('landingStoryPreviewCta')}</span>
            <span className="ps-sel">
              <span className="tg">{t('landingVeSelectionLabel')}</span>
              <span className="hd tl" /><span className="hd tr" /><span className="hd bl" /><span className="hd br" />
            </span>
          </div>
          <div className="ps-cards">
            {[0, 1, 2].map((i) => (
              <div className="ps-card" key={i}>
                <span className="ci" /><span className="cl" style={{ width: '78%' }} /><span className="cl" style={{ width: '56%' }} />
              </div>
            ))}
          </div>
          <div className="ps-ready"><span className="dd" /> {t('landingSceneReady')}</div>
          <div className="ps-chat">
            <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>
            <p>{instrText}{instrTyping && iChars < instruction.length && <span className="ps-caret" />}</p>
          </div>
          <div className="ps-deliver">
            <span className="ps-chip"><span className="dd" /> GitHub — {t('landingStatusNext')}</span>
            <span className="ps-chip"><span className="dd" /> {t('landingDeployLabel')} — {t('landingStatusNext')}</span>
          </div>
        </div>

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

  // Desktop non-reduced begins on the calm core (autoplay drives it). Mobile /
  // reduced rest on the finished refined state so the stage always looks
  // complete; tapping a step replays that scene.
  const [phase, setPhase] = useState<Phase>(() => (isDesktop && !reduced ? 'core' : 'r-done'));
  const [activeStep, setActiveStep] = useState(() => (isDesktop && !reduced ? 0 : 2));
  const [mode, setMode] = useState<'auto' | 'user'>(() => (isDesktop && !reduced ? 'auto' : 'user'));
  const [inView, setInView] = useState(false);
  const [playToken, setPlayToken] = useState(0);

  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const visRef = useRef<boolean[]>([false, false, false]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockedRef = useRef(false);
  const playedRef = useRef(false);
  // Mirrors for the IntersectionObserver's stable closure.
  const modeRef = useRef(mode); modeRef.current = mode;
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  const isDesktopRef = useRef(isDesktop); isDesktopRef.current = isDesktop;
  const activeStepRef = useRef(activeStep); activeStepRef.current = activeStep;

  const clearTimeline = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);
  const at = useCallback((fn: () => void, d: number) => {
    timersRef.current.push(setTimeout(fn, d));
  }, []);

  // Play a single scene from its beginning (or jump to its final state when
  // motion is off). Central to click + scroll selection.
  const goToScene = useCallback((step: number, animate: boolean) => {
    clearTimeline();
    setActiveStep(step);
    if (!animate) { setPhase(STEP_TERMINAL[step]); return; }
    setPhase(STEP_FIRST[step]);
    const seq = SCENE_SEQ[step];
    for (let i = 1; i < seq.length; i++) { const [p, d] = seq[i]; at(() => setPhase(p), d); }
  }, [clearTimeline, at]);

  const goToSceneRef = useRef(goToScene); goToSceneRef.current = goToScene;

  // Play the full film once (autoplay/replay).
  const playFull = useCallback(() => {
    clearTimeline();
    for (const [p, d] of FILM) { if (d === 0) setPhase(p); else at(() => setPhase(p), d); }
    at(() => { playedRef.current = true; setMode('user'); setActiveStep(2); }, FILM_END);
  }, [clearTimeline, at]);

  // Scroll-driven active step + section visibility (single IntersectionObserver,
  // center band → stable step). In user mode (and not during the manual lock)
  // a step crossing centre replays that scene.
  useEffect(() => {
    const els = stepRefs.current.filter(Boolean) as HTMLElement[];
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const vis = visRef.current;
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.idx);
          if (!Number.isNaN(i)) vis[i] = e.isIntersecting;
        }
        setInView(vis.some(Boolean));
        // Scroll-driven scene selection is DESKTOP-only; on mobile the stage
        // rests at its finished state and changes on tap (no offscreen timeline
        // driven by which step happens to cross the observer band).
        const last = vis.lastIndexOf(true);
        if (isDesktopRef.current && last >= 0 && last !== activeStepRef.current
            && modeRef.current === 'user' && !lockedRef.current) {
          goToSceneRef.current(last, !reducedRef.current);
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Autoplay — desktop + motion-on, once per view/replay. Cleared on unmount /
  // offscreen / when the visitor takes control. A one-shot scroll listener
  // (armed after entry settles) yields control on first scroll.
  useEffect(() => {
    if (!isDesktop || reduced || mode !== 'auto' || !inView || playedRef.current) return;
    playFull();
    let cleanupScroll = () => {};
    const arm = setTimeout(() => {
      const onScroll = () => setMode('user');
      window.addEventListener('scroll', onScroll, { passive: true, once: true });
      cleanupScroll = () => window.removeEventListener('scroll', onScroll);
    }, 500);
    return () => { clearTimeline(); clearTimeout(arm); cleanupScroll(); };
  }, [isDesktop, reduced, mode, inView, playToken, playFull, clearTimeline]);

  // Pause the timeline whenever the section is offscreen on desktop (where the
  // long autoplay film runs). On mobile the short, tap-initiated timelines are
  // allowed to finish; they're finite and cleared on unmount.
  useEffect(() => { if (!inView && isDesktop) clearTimeline(); }, [inView, isDesktop, clearTimeline]);

  // Unmount cleanup for the manual-lock timer (timeline is cleared by the
  // effects above).
  useEffect(() => () => { clearTimeline(); if (lockTimerRef.current) clearTimeout(lockTimerRef.current); }, [clearTimeline]);

  const selectStep = useCallback((i: number) => {
    setMode('user');
    lockedRef.current = true;
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(() => { lockedRef.current = false; }, 900);
    goToScene(i, !reduced);
  }, [goToScene, reduced]);

  const replay = useCallback(() => {
    playedRef.current = false;
    lockedRef.current = false;
    setActiveStep(0);
    setMode('auto');
    setPlayToken((n) => n + 1);
  }, []);

  // Which step is highlighted: during autoplay follow the phase's scene; else
  // the selected/scrolled step.
  const activeStepDisplay = mode === 'auto' && !reduced
    ? (SCENE_OF[phase] === 'core' ? -1 : SCENE_STEP[SCENE_OF[phase] as Exclude<Scene, 'core'>])
    : activeStep;
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
              const active = activeStepDisplay === i;
              return (
                <div
                  key={s.title}
                  ref={(el) => { stepRefs.current[i] = el; }}
                  data-idx={i}
                  data-active={active}
                  aria-current={active ? 'step' : undefined}
                  className="ps-step"
                >
                  <button
                    type="button"
                    className="ps-hit"
                    aria-pressed={active}
                    aria-label={t(s.title)}
                    onClick={() => selectStep(i)}
                  />
                  <span className="sn" aria-hidden="true">{i + 1}</span>
                  <h3>{t(s.title)}</h3>
                  <p>{t(s.desc)}</p>
                  <StepStatuses scene={i} t={t} />
                </div>
              );
            })}
          </div>

          <div className="ps-stagewrap">
            <Stage phase={phase} entered={inView} reduced={reduced} t={t} />
            {showReplay && (
              <button type="button" className="ps-replay" onClick={replay}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6M20 20v-6h-6" /><path d="M20 9a8 8 0 0 0-14.3-3.3L4 7M4 15a8 8 0 0 0 14.3 3.3L20 17" /></svg>
                {t('landingStoryReplay')}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
