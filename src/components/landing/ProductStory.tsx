import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * ProductStory (Phase 14J.3) — the public landing's animated three-step product
 * walkthrough. It replaces the previous static product mockup + five-card build
 * flow + static Visual Edit section with ONE continuous, code-driven narrative
 * that reads like a short product video (no MP4/GIF, no new dependency):
 *
 *   1. Describe your idea   → an original Korvix composer types a prompt.
 *   2. Watch Korvix build it → the same stage assembles a "Green Haven" preview.
 *   3. Refine and ship       → that preview is selected, refined, and the
 *                              upcoming delivery row (GitHub / Deploy) appears.
 *
 * Honesty: the whole stage is decorative (`aria-hidden`); every real claim
 * (Available now / Visual Edit "In development" / delivery "Coming next") lives
 * as TEXT in the step copy, so no information exists only in motion and reduced
 * motion loses nothing. No fake metrics, connected accounts, repo names, or
 * deploy URLs.
 *
 * Motion rules: the active step is driven by scroll via IntersectionObserver
 * (no scroll hijack, no sticky trap on mobile). The only timer is the Scene-1
 * typing chain, gated to the active + in-view stage and cleared on unmount /
 * state change — nothing animates offscreen. `prefers-reduced-motion` (via
 * framer's `useReducedMotion`) shows every scene's final state immediately.
 *
 * All fixed copy resolves through the centralized t() system; the only
 * hardcoded text is the illustrative project name "Green Haven" (a product
 * example) and the "GitHub" brand word.
 */

const PS_CSS = `
.ps{ --d-bg:#0B0E12; --d-surf:#11161C; --d-border:#28323D; --d-line:rgba(255,255,255,0.06);
  --d-text:#F5F7FA; --d-body:#D7DEE8; --d-muted:#93A3B5; --d-accent:#8FA6BA; --blue:#3B82F6; --sage:#6F8F7A; }
.ps .ps-grid{ display:grid; grid-template-columns:1fr 1fr; gap:48px; align-items:start; margin-top:38px; }
.ps .ps-steps{ display:flex; flex-direction:column; }
.ps .ps-step{ padding:20px 0 20px 20px; border-left:2px solid var(--border); position:relative; transition:border-color .3s, opacity .3s; opacity:.5; }
.ps .ps-step[data-active="true"]{ opacity:1; border-left-color:var(--blue); }
.ps .ps-step .sn{ display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:8px;
  background:var(--section); color:var(--accent); font-family:var(--mono,ui-monospace); font-size:12px; font-weight:600; }
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
.ps .ps-stage{ position:relative; background:var(--d-bg); border:1px solid var(--d-border); border-radius:16px; overflow:hidden;
  box-shadow:0 36px 82px -34px rgba(11,14,18,0.55),0 12px 26px -14px rgba(16,24,39,0.26); }
.ps .ps-chrome{ display:flex; align-items:center; gap:9px; padding:11px 15px; border-bottom:1px solid var(--d-line); background:linear-gradient(180deg,#12171E,#0E1319); }
.ps .ps-chrome i{ width:10px; height:10px; border-radius:50%; background:#2C3742; }
.ps .ps-chrome .u{ margin:0 auto; font-size:11px; color:var(--d-muted); font-family:var(--mono,ui-monospace); background:#0E141A; border:1px solid var(--d-line); padding:4px 12px; border-radius:8px; }
.ps .ps-chrome .bdg{ font-size:9px; letter-spacing:0.04em; text-transform:uppercase; color:var(--d-accent); border:1px solid rgba(143,166,186,0.3); border-radius:6px; padding:3px 7px; }
.ps .ps-body{ position:relative; min-height:328px; padding:18px; background:radial-gradient(120% 90% at 50% 0%, #141B22, #0B0E12 72%); }

/* describe: composer */
.ps .ps-composer{ position:absolute; inset:18px; display:flex; flex-direction:column; gap:12px; transition:opacity .4s ease, transform .4s ease; }
.ps .ps-composer[data-show="false"]{ opacity:0; transform:translateY(-8px); pointer-events:none; }
.ps .ps-modes{ display:flex; gap:6px; flex-wrap:wrap; }
.ps .ps-mode{ font-size:11px; color:var(--d-body); border:1px solid var(--d-border); background:var(--d-surf); border-radius:999px; padding:5px 11px; }
.ps .ps-mode.on{ color:#BFDBFE; border-color:rgba(59,130,246,0.5); background:rgba(59,130,246,0.12); }
.ps .ps-input{ flex:1; border:1px solid var(--d-border); background:var(--d-surf); border-radius:12px; padding:14px; font-size:14px; color:var(--d-text); line-height:1.5; }
.ps .ps-caret{ display:inline-block; width:2px; height:16px; vertical-align:-3px; margin-left:1px; background:var(--blue); animation:pscaret 1.05s steps(1) infinite; }
@keyframes pscaret{ 50%{opacity:0;} }
.ps .ps-startbtn{ align-self:flex-start; display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; color:#fff;
  background:linear-gradient(180deg,#2563EB,#1D4ED8); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:9px 14px; transition:box-shadow .3s; }
.ps .ps-startbtn.ready{ box-shadow:0 0 0 4px rgba(59,130,246,0.16); }
.ps .ps-startbtn svg{ width:14px; height:14px; stroke:currentColor; stroke-width:1.8; fill:none; }

/* generate/refine: preview */
.ps .ps-preview{ position:absolute; inset:18px; display:flex; flex-direction:column; gap:12px; transition:opacity .45s ease; }
.ps .ps-preview[data-show="false"]{ opacity:0; pointer-events:none; }
.ps .ps-hero{ position:relative; border:1px solid var(--d-line); border-radius:12px; padding:24px 18px; text-align:center;
  background:linear-gradient(160deg,#1B2A22,#14201A); transition:background .55s ease, box-shadow .55s ease; }
.ps .ps-hero.premium{ background:linear-gradient(160deg,#0C1512,#060B09); box-shadow:inset 0 0 0 1px rgba(111,143,122,0.25); }
.ps .ps-hero h4{ margin:0; font-size:18px; font-weight:680; letter-spacing:-0.02em; color:var(--d-text); }
.ps .ps-line{ height:8px; border-radius:5px; margin:8px auto 0; background:linear-gradient(90deg,#243b30,#2f4d3e); }
.ps .ps-cta{ display:inline-block; margin-top:14px; font-size:11px; font-weight:600; color:#0F1729; background:#DCE7DE; border-radius:8px; padding:7px 14px; }
.ps .ps-cards{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.ps .ps-card{ border:1px solid var(--d-line); border-radius:11px; padding:13px; background:var(--d-surf); display:flex; flex-direction:column; gap:8px; }
.ps .ps-card .ci{ width:24px; height:24px; border-radius:7px; background:rgba(111,143,122,0.22); }
.ps .ps-card .cl{ height:7px; border-radius:4px; background:#232d27; }
/* assemble-in animation */
.ps .ps-preview[data-assemble="true"] .ps-hero{ animation:psrise .5s ease both; }
.ps .ps-preview[data-assemble="true"] .ps-card{ animation:psrise .5s ease both; }
.ps .ps-preview[data-assemble="true"] .ps-card:nth-child(1){ animation-delay:.10s; }
.ps .ps-preview[data-assemble="true"] .ps-card:nth-child(2){ animation-delay:.18s; }
.ps .ps-preview[data-assemble="true"] .ps-card:nth-child(3){ animation-delay:.26s; }
@keyframes psrise{ from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:translateY(0);} }

/* refine overlays */
.ps .ps-sel{ position:absolute; inset:-6px; border:1.5px solid rgba(59,130,246,0.75); border-radius:14px; opacity:0; transition:opacity .4s ease; pointer-events:none; }
.ps .ps-sel .tg{ position:absolute; top:-11px; left:12px; font-size:10px; color:#BFDBFE; background:#12202F; border:1px solid rgba(59,130,246,0.5); border-radius:6px; padding:2px 8px; white-space:nowrap; }
.ps .ps-hero .ps-sel[data-show="true"]{ opacity:1; }
.ps .ps-chat{ display:flex; align-items:center; gap:9px; border:1px solid var(--d-border); background:var(--d-surf); border-radius:11px; padding:10px 12px; opacity:0; transform:translateY(6px); transition:opacity .4s ease .1s, transform .4s ease .1s; }
.ps .ps-chat[data-show="true"]{ opacity:1; transform:translateY(0); }
.ps .ps-chat svg{ width:15px; height:15px; color:var(--d-accent); flex:none; stroke:currentColor; stroke-width:1.7; fill:none; }
.ps .ps-chat p{ margin:0; font-size:12px; color:var(--d-body); }
.ps .ps-deliver{ display:flex; gap:8px; flex-wrap:wrap; opacity:0; transition:opacity .4s ease .2s; }
.ps .ps-deliver[data-show="true"]{ opacity:1; }
.ps .ps-chip{ display:inline-flex; align-items:center; gap:7px; font-size:10.5px; color:var(--d-muted); border:1px solid var(--d-line); background:var(--d-surf); border-radius:999px; padding:5px 10px; }
.ps .ps-chip .dd{ width:5px; height:5px; border-radius:50%; background:#8593A3; }

/* status line */
.ps .ps-ready{ display:flex; align-items:center; gap:8px; margin-top:14px; justify-content:center; font-size:11.5px; color:var(--sage); opacity:0; transition:opacity .4s ease .15s; }
.ps .ps-ready[data-show="true"]{ opacity:1; }
.ps .ps-ready .dd{ width:6px; height:6px; border-radius:50%; background:var(--sage); }

/* mobile inline stage */
.ps .ps-inline{ margin-top:16px; }

@media (prefers-reduced-motion:reduce){
  .ps .ps-caret{ animation:none; }
  .ps .ps-preview[data-assemble="true"] .ps-hero,
  .ps .ps-preview[data-assemble="true"] .ps-card{ animation:none; }
  .ps .ps-composer,.ps .ps-preview,.ps .ps-hero,.ps .ps-sel,.ps .ps-chat,.ps .ps-deliver,.ps .ps-ready,.ps .ps-startbtn{ transition:none; }
}
@media (max-width:900px){
  .ps .ps-grid{ grid-template-columns:1fr; gap:8px; margin-top:26px; }
  .ps .ps-stagewrap{ position:static; }
  .ps .ps-body{ min-height:300px; }
}
`;

type SceneState = 'describe' | 'generate' | 'refine';
const SCENES: SceneState[] = ['describe', 'generate', 'refine'];

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

/** The persistent product stage. `scene` selects describe/generate/refine;
 *  `animate` gates motion (offscreen or reduced → final state shown). */
function Stage({ scene, animate, reduced, t }: { scene: SceneState; animate: boolean; reduced: boolean; t: (k: string) => string }) {
  const fullPrompt = t('landingStoryPrompt');
  const [chars, setChars] = useState(fullPrompt.length);

  // Scene-1 typing. The ONLY timer in this component: a self-clearing timeout
  // chain that runs only while Describe is the active, in-view scene and motion
  // is allowed. Any other case shows the full prompt immediately.
  useEffect(() => {
    if (scene !== 'describe' || !animate || reduced) {
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
    timer = setTimeout(tick, 380);
    return () => clearTimeout(timer);
  }, [scene, animate, reduced, fullPrompt]);

  const typedDone = chars >= fullPrompt.length;
  const showComposer = scene === 'describe';
  const showPreview = scene === 'generate' || scene === 'refine';
  const refine = scene === 'refine';
  const assemble = animate && !reduced && showPreview;

  return (
    <div className={`ps-stage${reduced ? ' reduced' : ''}`} aria-hidden="true">
      <div className="ps-chrome">
        <i /><i /><i />
        <span className="u">preview</span>
        <span className="bdg">{t('landingStoryIllustrative')}</span>
      </div>
      <div className="ps-body">
        {/* Scene 1 — Describe */}
        <div className="ps-composer" data-show={showComposer}>
          <div className="ps-modes">
            <span className="ps-mode on">{t('landingTypeWebsite')}</span>
            <span className="ps-mode">{t('landingTypeWebApp')}</span>
            <span className="ps-mode">{t('landingTypeEcommerce')}</span>
          </div>
          <div className="ps-input">
            {showComposer ? fullPrompt.slice(0, chars) : fullPrompt}
            {showComposer && !typedDone && <span className="ps-caret" />}
          </div>
          <span className={`ps-startbtn${typedDone ? ' ready' : ''}`}>
            {t('ctaStartBuilding')}{ARROW}
          </span>
        </div>

        {/* Scenes 2 & 3 — the same Green Haven preview */}
        <div className="ps-preview" data-show={showPreview} data-assemble={assemble}>
          <div className={`ps-hero${refine ? ' premium' : ''}`}>
            <h4>Green Haven</h4>
            <div className="ps-line" style={{ width: '64%' }} />
            <div className="ps-line" style={{ width: '46%' }} />
            <span className="ps-cta">{t('landingStoryPreviewCta')}</span>
            <span className="ps-sel" data-show={refine}>
              <span className="tg">{t('landingVeSelectionLabel')}</span>
            </span>
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
          {refine ? (
            <>
              <div className="ps-chat" data-show={refine}>
                <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>
                <p>{t('landingVeInstruction')}</p>
              </div>
              <div className="ps-deliver" data-show={refine}>
                <span className="ps-chip"><span className="dd" /> GitHub — {t('landingStatusNext')}</span>
                <span className="ps-chip"><span className="dd" /> {t('landingDeployLabel')} — {t('landingStatusNext')}</span>
              </div>
            </>
          ) : (
            <div className="ps-ready" data-show={showPreview}>
              <span className="dd" /> {t('landingSceneReady')}
            </div>
          )}
        </div>
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

  const [activeStep, setActiveStep] = useState(0);
  const [inView, setInView] = useState(false);
  const [stepInView, setStepInView] = useState<boolean[]>([false, false, false]);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const visRef = useRef<boolean[]>([false, false, false]);

  // Scroll-driven active step. A thin center band (rootMargin) makes exactly one
  // step "active" as it crosses the viewport middle — stable, no scroll hijack,
  // no per-pixel recompute. IO callbacks report only CHANGED targets, so we keep
  // full visibility in a ref and derive state from it. Cleaned up on unmount.
  useEffect(() => {
    const els = stepRefs.current.filter(Boolean) as HTMLDivElement[];
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
            {STEPS.map((s, i) => (
              <div
                key={s.title}
                ref={(el) => { stepRefs.current[i] = el; }}
                data-idx={i}
                data-active={isDesktop ? activeStep === i : stepInView[i]}
                aria-current={(isDesktop ? activeStep === i : stepInView[i]) ? 'step' : undefined}
                className="ps-step"
              >
                <span className="sn" aria-hidden="true">{i + 1}</span>
                <h3>{t(s.title)}</h3>
                <p>{t(s.desc)}</p>
                <StepStatuses scene={i} t={t} />
                {!isDesktop && (
                  <div className="ps-inline">
                    <Stage scene={SCENES[i]} animate={stepInView[i]} reduced={reduced} t={t} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {isDesktop && (
            <div className="ps-stagewrap">
              <Stage scene={SCENES[activeStep]} animate={inView} reduced={reduced} t={t} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
