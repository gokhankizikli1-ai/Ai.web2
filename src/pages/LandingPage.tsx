import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * KorvixAI public landing — Web Build first (Phase 14J.2).
 *
 * Story: "Describe your idea. Korvix builds it. Refine anything. Ship when
 * ready." The hero is a real creation surface (prompt + creation-type controls)
 * that hands the prompt into the existing authenticated creation flow. Research
 * / Startup Radar is retained but repositioned as a supporting section below the
 * builder story.
 *
 * Honesty: features that are not shipped yet (Visual Edit, GitHub sync, deploy)
 * are labeled with `In development` / `Coming next` and never given fake
 * controls, fake connection state, or fake deploy URLs. The product demos are
 * original Korvix mockups (skeleton shapes + honest captions), not screenshots.
 *
 * Prompt handoff (existing supported contract):
 *   • authenticated → navigate('/chat', { state: { initialPrompt } }) — seeds
 *     the composer (no auto-send); the creation home / intent detection picks
 *     the builder mode.
 *   • unauthenticated → /signup. The current auth flow forwards only
 *     `location.state.from` (a pathname), NOT an initialPrompt, so the typed
 *     prompt is not carried through signup. We do not add a fragile mechanism or
 *     modify auth here — see PR notes.
 *
 * The scoped `.mk` stylesheet keeps the design system local to this page
 * (every selector is prefixed `.mk`); the shared Navbar (light surface) and the
 * honest Footer are reused for cross-page consistency.
 */

const MK_CSS = `
.mk{
  --porcelain:#F7F8FA; --porcelain-2:#EDEFF3; --section:#EEF1F4; --surface:#FFFFFF;
  --ink:#0F1729; --body:#334155; --muted:#64748B; --faint:#94A3B8; --border:#DDE3EA;
  --accent:#52677A; --accent-hi:#637B90; --sage:#6F8F7A; --blue:#3B82F6;
  --d-bg:#0B0E12; --d-surf:#11161C; --d-border:#28323D; --d-line:rgba(255,255,255,0.06);
  --d-text:#F5F7FA; --d-body:#D7DEE8; --d-muted:#93A3B5; --d-accent:#8FA6BA;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  font-family:var(--sans); color:var(--ink); -webkit-font-smoothing:antialiased; line-height:1.5; min-height:100vh;
  background:radial-gradient(880px 520px at 50% -8%, rgba(82,103,122,0.07), transparent 62%),
    linear-gradient(180deg,var(--porcelain),var(--porcelain-2));
}
.mk *{box-sizing:border-box;}
.mk .wrap{max-width:1120px; margin:0 auto; padding:0 28px;}
.mk [id]{scroll-margin-top:84px;}

.mk .btn{font:inherit; font-size:13px; font-weight:600; letter-spacing:-0.005em; border-radius:10px; padding:0 16px; height:38px;
  display:inline-flex; align-items:center; gap:8px; cursor:pointer; border:1px solid transparent; text-decoration:none; white-space:nowrap;
  transition:transform .18s,background .18s,border-color .18s;}
.mk .btn:focus-visible{outline:2px solid var(--blue); outline-offset:2px;}
.mk .btn-dark{color:#F5F7FA; background:linear-gradient(180deg,#161C23,#0B0E12); border-color:rgba(255,255,255,0.08);
  box-shadow:0 6px 18px rgba(16,24,39,0.16),inset 0 1px 0 rgba(255,255,255,0.07);}
.mk .btn-dark:hover{transform:translateY(-1px);}
.mk .btn-outline{color:var(--body); background:var(--surface); border-color:var(--border);} .mk .btn-outline:hover{border-color:#C3CDD8;}
.mk .btn-lg{height:46px; font-size:14px; padding:0 20px; border-radius:12px;}

/* hero */
.mk .hero{padding:104px 0 0; text-align:center;}
.mk .eyebrow{display:inline-flex; align-items:center; gap:8px; height:29px; padding:0 13px; border:1px solid var(--border);
  background:var(--surface); border-radius:999px; font-size:12px; font-weight:600; color:var(--muted);}
.mk .eyebrow .d{width:6px; height:6px; border-radius:50%; background:var(--blue);}
.mk .h1{font-size:56px; line-height:1.04; letter-spacing:-0.037em; font-weight:690; margin:20px auto 0; max-width:16ch; text-wrap:balance;}
.mk .sub{font-size:17.5px; line-height:1.56; color:var(--body); margin:18px auto 0; max-width:60ch; letter-spacing:-0.008em;}

/* hero composer */
.mk .composer{margin:30px auto 0; max-width:640px; background:var(--surface); border:1px solid var(--border); border-radius:18px;
  box-shadow:0 24px 60px -30px rgba(16,24,39,0.30),0 8px 20px -14px rgba(16,24,39,0.14); padding:14px 14px 12px; text-align:left;}
.mk .composer textarea{width:100%; border:0; outline:none; resize:none; background:transparent; font:inherit; font-size:15px; color:var(--ink);
  line-height:1.55; min-height:56px; max-height:180px; padding:6px 6px 2px;}
.mk .composer textarea::placeholder{color:var(--faint);}
.mk .composer-row{display:flex; align-items:center; gap:10px; margin-top:8px; flex-wrap:wrap;}
.mk .types{display:flex; gap:6px; flex-wrap:wrap; flex:1 1 auto;}
.mk .tchip{font:inherit; font-size:12px; font-weight:550; color:var(--body); background:var(--porcelain); border:1px solid var(--border);
  border-radius:999px; padding:6px 12px; cursor:pointer; transition:border-color .16s,background .16s,color .16s;}
.mk .tchip:hover{border-color:#C3CDD8;}
.mk .tchip.on{color:#25405A; background:rgba(59,130,246,0.10); border-color:rgba(59,130,246,0.45); box-shadow:inset 0 0 0 1px rgba(59,130,246,0.12);}
.mk .tchip:focus-visible{outline:2px solid var(--blue); outline-offset:2px;}
.mk .send{flex:none; margin-left:auto;}
.mk .hero-sec{display:flex; gap:12px; justify-content:center; align-items:center; margin-top:16px; flex-wrap:wrap;}
.mk .textlink{font-size:13px; font-weight:600; color:var(--accent); text-decoration:none; display:inline-flex; align-items:center; gap:6px;}
.mk .textlink:hover{color:var(--ink);} .mk .textlink svg{width:14px; height:14px;}
.mk .microcopy{margin-top:14px; font-size:12.5px; color:var(--faint);}

/* generated-preview demo */
.mk .stage{position:relative; margin:44px auto 0; max-width:940px;}
.mk .stage-glow{position:absolute; inset:-34px -24px 20px; border-radius:34px;
  background:radial-gradient(58% 70% at 50% 6%, rgba(82,103,122,0.13), transparent 72%); filter:blur(8px); pointer-events:none;}
.mk .frame{position:relative; background:var(--d-bg); border:1px solid var(--d-border); border-radius:16px; overflow:hidden;
  box-shadow:0 36px 82px -34px rgba(11,14,18,0.55),0 12px 26px -14px rgba(16,24,39,0.26),inset 0 1px 0 rgba(255,255,255,0.05);}
.mk .chrome{display:flex; align-items:center; gap:9px; padding:11px 16px; border-bottom:1px solid var(--d-line); background:linear-gradient(180deg,#12171E,#0E1319);}
.mk .chrome i{width:10px; height:10px; border-radius:50%; background:#2C3742;}
.mk .chrome .u{margin:0 auto; font-size:11.5px; color:var(--d-muted); font-family:var(--mono); background:#0E141A; border:1px solid var(--d-line); padding:4px 14px; border-radius:8px;}
.mk .chrome .badge{font-family:var(--mono); font-size:9.5px; letter-spacing:0.05em; text-transform:uppercase; color:var(--d-accent);
  border:1px solid rgba(143,166,186,0.3); border-radius:6px; padding:3px 7px;}
.mk .promptbar{display:flex; align-items:center; gap:10px; padding:11px 16px; background:#0C1116; border-bottom:1px solid var(--d-line);}
.mk .promptbar svg{width:15px; height:15px; color:var(--d-accent); flex:none;}
.mk .promptbar p{margin:0; font-size:12.5px; color:var(--d-body); font-family:var(--mono);}
.mk .gen{padding:22px; display:flex; flex-direction:column; gap:16px; background:radial-gradient(120% 90% at 50% 0%, #141B22, #0B0E12 70%);}
.mk .gen-hero{border:1px solid var(--d-line); border-radius:12px; padding:26px 22px; background:linear-gradient(160deg,#182430,#0E141A); text-align:center;}
.mk .gen-h{font-size:19px; font-weight:680; letter-spacing:-0.02em; color:var(--d-text); margin:0;}
.mk .skel{height:9px; border-radius:5px; background:linear-gradient(90deg,#1C2530,#243040); margin:0 auto;}
.mk .gen-btn{display:inline-block; margin-top:15px; height:30px; line-height:30px; padding:0 16px; border-radius:8px; font-size:11.5px; font-weight:600;
  color:#0F1729; background:linear-gradient(180deg,#E7ECF1,#CDD6DF);}
.mk .gen-cards{display:grid; grid-template-columns:repeat(3,1fr); gap:12px;}
.mk .gen-card{border:1px solid var(--d-line); border-radius:11px; padding:15px; background:var(--d-surf); display:flex; flex-direction:column; gap:9px;}
.mk .gen-card .ic{width:26px; height:26px; border-radius:8px; background:rgba(82,103,122,0.22);}
.mk .demo-cap{margin-top:13px; text-align:center; font-size:12.5px; color:var(--faint);}

/* sections */
.mk section{padding:64px 0;}
.mk .sec-label{font-family:var(--mono); font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--accent); font-weight:600;}
.mk .h2{font-size:32px; line-height:1.14; letter-spacing:-0.025em; font-weight:680; margin:12px 0 0; text-wrap:balance; max-width:24ch;}
.mk .sec-sub{font-size:15.5px; color:var(--muted); margin:12px 0 0; max-width:62ch; line-height:1.6;}
.mk .center{text-align:center;} .mk .center .h2,.mk .center .sec-sub{margin-left:auto; margin-right:auto;}

/* status badge */
.mk .status{display:inline-flex; align-items:center; gap:6px; font-size:10.5px; font-weight:650; letter-spacing:0.01em;
  padding:3px 9px; border-radius:999px; border:1px solid;}
.mk .status .sd{width:5px; height:5px; border-radius:50%;}
.mk .status-now{color:#3F6B57; border-color:rgba(111,143,122,0.4); background:rgba(111,143,122,0.10);} .mk .status-now .sd{background:var(--sage);}
.mk .status-dev{color:#6C5A2E; border-color:rgba(180,150,80,0.4); background:rgba(180,150,80,0.10);} .mk .status-dev .sd{background:#C79A3A;}
.mk .status-next{color:#4B5A6B; border-color:rgba(100,116,139,0.35); background:rgba(100,116,139,0.09);} .mk .status-next .sd{background:#8593A3;}

/* build flow */
.mk .flow{display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-top:34px;}
.mk .fcard{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px; box-shadow:0 6px 16px -12px rgba(16,24,39,0.10);
  display:flex; flex-direction:column; gap:9px;}
.mk .fcard .n{width:26px; height:26px; border-radius:8px; background:var(--section); color:var(--accent); font-family:var(--mono); font-size:12px; font-weight:600; display:grid; place-items:center;}
.mk .fcard h3{font-size:15px; font-weight:640; letter-spacing:-0.012em; margin:0;}
.mk .fcard p{font-size:12.5px; color:var(--muted); line-height:1.5; margin:0;}
.mk .fcard .status{margin-top:auto; align-self:flex-start;}

/* visual edit */
.mk .ve{background:linear-gradient(180deg,#FFFFFF,#F5F7FA); border-top:1px solid var(--border); border-bottom:1px solid var(--border);}
.mk .vgrid{display:grid; grid-template-columns:1fr 1fr; gap:48px; align-items:center;}
.mk .vsteps{list-style:none; padding:0; margin:22px 0 0; display:flex; flex-direction:column; gap:12px;}
.mk .vsteps li{display:flex; gap:12px; align-items:center; font-size:14px; color:var(--body);}
.mk .vsteps .vn{width:22px; height:22px; border-radius:7px; background:var(--section); color:var(--accent); font-family:var(--mono); font-size:11px; font-weight:600; display:grid; place-items:center; flex:none;}
.mk .veframe{background:var(--d-bg); border:1px solid var(--d-border); border-radius:15px; padding:16px; box-shadow:0 26px 58px -30px rgba(11,14,18,0.5);}
.mk .ve-sel{position:relative; border:1.5px solid rgba(59,130,246,0.7); border-radius:11px; padding:20px 16px; background:linear-gradient(160deg,#151D26,#0E141A); text-align:center;}
.mk .ve-sel .tag{position:absolute; top:-10px; left:12px; font-family:var(--mono); font-size:10px; color:#BFDBFE; background:#12202F; border:1px solid rgba(59,130,246,0.5); border-radius:6px; padding:2px 8px;}
.mk .ve-sel h4{margin:0; font-size:17px; font-weight:680; letter-spacing:-0.02em; color:var(--d-text);}
.mk .ve-handle{position:absolute; width:8px; height:8px; border-radius:2px; background:#60A5FA; border:1.5px solid #0B0E12;}
.mk .ve-chat{display:flex; align-items:center; gap:10px; margin-top:14px; border:1px solid var(--d-border); background:var(--d-surf); border-radius:11px; padding:11px 13px;}
.mk .ve-chat svg{width:15px; height:15px; color:var(--d-accent); flex:none;}
.mk .ve-chat p{margin:0; font-size:12.5px; color:var(--d-body);}
.mk .ve-note{margin-top:11px; font-size:11.5px; color:var(--d-muted); display:flex; align-items:center; gap:7px;}

/* output quality */
.mk .oq{display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:34px;}
.mk .ocard{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px; display:flex; gap:12px; align-items:flex-start;}
.mk .ocard svg{width:18px; height:18px; color:var(--accent); flex:none; margin-top:1px;}
.mk .ocard p{margin:0; font-size:13.5px; color:var(--body); line-height:1.5;}

/* research (supporting) */
.mk .research{background:linear-gradient(180deg,#F5F7FA,#EDEFF3); border-top:1px solid var(--border); border-bottom:1px solid var(--border);}
.mk .rgrid{display:grid; grid-template-columns:1.05fr 1fr; gap:48px; align-items:center;}
.mk .rgrid ul{list-style:none; padding:0; margin:22px 0 0; display:flex; flex-direction:column; gap:13px;}
.mk .rgrid li{display:flex; gap:12px; align-items:flex-start; font-size:14px; color:var(--body);}
.mk .rgrid li svg{width:17px; height:17px; color:var(--accent); flex:none; margin-top:1px;}
.mk .panel{background:var(--d-bg); border:1px solid var(--d-border); border-radius:15px; padding:16px; box-shadow:0 26px 58px -30px rgba(11,14,18,0.5);}
.mk .p-h{display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;}
.mk .p-h .q{font-size:12.5px; color:var(--d-body); font-weight:500;}
.mk .pill-v{font-size:10.5px; font-weight:600; padding:3px 10px; border-radius:999px; border:1px solid rgba(143,166,186,0.42); color:#A7BDD0; background:rgba(82,103,122,0.16);}
.mk .pain{display:flex; align-items:center; justify-content:space-between; gap:16px; padding:10px 0; border-top:1px solid var(--d-line);} .mk .pain:first-of-type{border-top:0;}
.mk .pain .nm{font-size:12.5px; color:var(--d-text); font-weight:540;}
.mk .pain .bar{width:90px; height:5px; border-radius:3px; background:#1A222B; overflow:hidden; flex:none;} .mk .pain .bar i{display:block; height:100%; background:linear-gradient(90deg,#52677A,#7890A3); border-radius:3px;}
.mk .p-foot{margin-top:13px; padding-top:12px; border-top:1px solid var(--d-line); font-size:11px; color:#63727F;}

/* delivery */
.mk .delivery-head{display:flex; align-items:center; gap:12px; flex-wrap:wrap; justify-content:center;}
.mk .dsteps{display:flex; align-items:stretch; justify-content:center; gap:10px; margin-top:34px; flex-wrap:wrap;}
.mk .dstep{background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 16px; font-size:13px; font-weight:550; color:var(--ink);
  display:flex; align-items:center; gap:10px; box-shadow:0 2px 8px -4px rgba(16,24,39,0.08);}
.mk .dstep .dn{width:22px; height:22px; border-radius:7px; background:var(--section); color:var(--accent); font-family:var(--mono); font-size:11px; font-weight:600; display:grid; place-items:center; flex:none;}
.mk .darrow{color:#AEB9C5; display:flex; align-items:center;} .mk .darrow svg{width:16px; height:16px;}

/* final cta */
.mk .final{background:radial-gradient(80% 130% at 50% 0%, #14202A 0%, #0B0E12 66%); border-top:1px solid var(--d-border); text-align:center; padding:72px 0 78px;}
.mk .final .h2{font-size:36px; letter-spacing:-0.03em; color:var(--d-text); max-width:22ch; margin:0 auto; text-wrap:balance;}
.mk .final p{font-size:16px; color:var(--d-muted); margin:15px auto 0; max-width:48ch;}
.mk .final .cta{display:flex; gap:12px; justify-content:center; margin-top:26px; flex-wrap:wrap;}
.mk .btn-light{color:#0F1729; background:#F5F7FA; box-shadow:0 8px 24px -8px rgba(0,0,0,0.45);} .mk .btn-light:hover{transform:translateY(-1px); background:#fff;}
.mk .btn-dline{color:var(--d-body); background:transparent; border-color:rgba(255,255,255,0.16);} .mk .btn-dline:hover{border-color:rgba(255,255,255,0.34); color:#fff;}

.mk .ic{stroke:currentColor; stroke-width:1.7; fill:none; stroke-linecap:round; stroke-linejoin:round;}

@media (max-width:960px){
  .mk .h1{font-size:44px;}
  .mk .flow{grid-template-columns:1fr 1fr;}
  .mk .oq{grid-template-columns:1fr 1fr;}
  .mk .vgrid,.mk .rgrid{grid-template-columns:1fr; gap:32px;}
}
@media (max-width:560px){
  .mk .hero{padding:92px 0 0;}
  .mk .h1{font-size:34px;} .mk .sub{font-size:15px;}
  .mk .flow{grid-template-columns:1fr;} .mk .oq{grid-template-columns:1fr;} .mk .gen-cards{grid-template-columns:1fr;}
  .mk .final .h2{font-size:27px;}
  .mk .send{margin-left:0; width:100%;} .mk .send .btn{width:100%; justify-content:center;}
  .mk .darrow{transform:rotate(90deg);}
}
@media (prefers-reduced-motion:reduce){ .mk *{scroll-behavior:auto;} }
`;

type CreationType = 'website' | 'webapp' | 'landing' | 'ecommerce';

export default function LandingPage() {
  const { isAuthenticated } = useAuthStore();
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [ctype, setCtype] = useState<CreationType>('website');

  const TYPES: { id: CreationType; key: string }[] = [
    { id: 'website', key: 'landingTypeWebsite' },
    { id: 'webapp', key: 'landingTypeWebApp' },
    { id: 'landing', key: 'landingTypeLandingPage' },
    { id: 'ecommerce', key: 'landingTypeEcommerce' },
  ];

  // Start-building action. Uses the EXISTING supported handoff contract:
  // authenticated visitors carry the typed prompt into /chat via
  // location.state.initialPrompt (seeds the composer — no auto-send). Logged-out
  // visitors go to /signup; the current auth flow forwards only `from`, so the
  // prompt is intentionally not carried through signup (documented — no auth
  // change here). Never auto-fires a build; only runs on explicit submit.
  const startBuilding = useCallback(() => {
    const text = prompt.trim();
    if (isAuthenticated) {
      navigate('/chat', text ? { state: { initialPrompt: text } } : undefined);
    } else {
      navigate('/signup');
    }
  }, [prompt, isAuthenticated, navigate]);

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      startBuilding();
    }
  };

  const arrow = (
    <svg className="ic" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  );

  return (
    <div className="mk">
      <style>{MK_CSS}</style>
      <Navbar />

      <main>
        <div className="wrap">
          {/* HERO */}
          <div className="hero">
            <span className="eyebrow"><span className="d" aria-hidden="true" /> {t('landingEyebrow')}</span>
            <h1 className="h1">{t('landingHeroTitle')}</h1>
            <p className="sub">{t('landingHeroSub')}</p>

            {/* Real creation surface — prompt + creation-type controls. */}
            <div className="composer">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onComposerKey}
                placeholder={t('landingComposerPlaceholder')}
                aria-label={t('landingComposerAria')}
                rows={2}
              />
              <div className="composer-row">
                <div className="types" role="group" aria-label={t('landingTypeLabel')}>
                  {TYPES.map((ty) => (
                    <button
                      key={ty.id}
                      type="button"
                      className={`tchip${ctype === ty.id ? ' on' : ''}`}
                      aria-pressed={ctype === ty.id}
                      onClick={() => setCtype(ty.id)}
                    >
                      {t(ty.key)}
                    </button>
                  ))}
                </div>
                <span className="send">
                  <button type="button" className="btn btn-dark" onClick={startBuilding}>
                    {t('ctaStartBuilding')}
                    {arrow}
                  </button>
                </span>
              </div>
            </div>

            <div className="hero-sec">
              <a className="textlink" href="#how">
                {t('landingCtaHow')}
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
              </a>
            </div>
            <div className="microcopy">{t('landingHeroMicro')}</div>
          </div>

          {/* PRODUCT DEMO — original Korvix mockup (illustrative, not a screenshot) */}
          <div className="stage" id="product">
            <div className="stage-glow" aria-hidden="true" />
            <div className="frame" aria-hidden="true">
              <div className="chrome"><i /><i /><i /><span className="u">preview</span><span className="badge">{t('landingDemoBadge')}</span></div>
              <div className="promptbar">
                <svg viewBox="0 0 24 24" className="ic"><path d="M12 3v18M5 10l7-7 7 7" /></svg>
                <p>{t('landingDemoPrompt')}</p>
              </div>
              <div className="gen">
                <div className="gen-hero">
                  <p className="gen-h">Green Haven</p>
                  <div className="skel" style={{ width: '62%', marginTop: 12 }} />
                  <div className="skel" style={{ width: '48%', marginTop: 8 }} />
                  <span className="gen-btn">Get a quote</span>
                </div>
                <div className="gen-cards">
                  {[0, 1, 2].map((i) => (
                    <div className="gen-card" key={i}>
                      <span className="ic" />
                      <div className="skel" style={{ width: '80%' }} />
                      <div className="skel" style={{ width: '60%' }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="demo-cap">{t('landingDemoCaption')}</p>
          </div>
        </div>

        {/* BUILD FLOW */}
        <section id="how">
          <div className="wrap center">
            <span className="sec-label">{t('landingFlowLabel')}</span>
            <h2 className="h2">{t('landingFlowTitle')}</h2>
            <p className="sec-sub">{t('landingFlowSub')}</p>
          </div>
          <div className="wrap">
            <div className="flow">
              {[
                { n: 1, title: 'landingFlowStep1Title', desc: 'landingFlowStep1Desc', status: 'now' },
                { n: 2, title: 'landingFlowStep2Title', desc: 'landingFlowStep2Desc', status: 'now' },
                { n: 3, title: 'landingFlowStep3Title', desc: 'landingFlowStep3Desc', status: 'now' },
                { n: 4, title: 'landingFlowStep4Title', desc: 'landingFlowStep4Desc', status: 'next' },
                { n: 5, title: 'landingFlowStep5Title', desc: 'landingFlowStep5Desc', status: 'next' },
              ].map((s) => (
                <div className="fcard" key={s.n}>
                  <span className="n" aria-hidden="true">{s.n}</span>
                  <h3>{t(s.title)}</h3>
                  <p>{t(s.desc)}</p>
                  <StatusBadge status={s.status as StatusKind} t={t} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* VISUAL EDIT */}
        <section className="ve" id="visual-edit">
          <div className="wrap">
            <div className="vgrid">
              <div>
                <span className="sec-label">{t('landingVeLabel')}</span>
                <div style={{ marginTop: 10 }}><StatusBadge status="dev" t={t} /></div>
                <h2 className="h2">{t('landingVeTitle')}</h2>
                <p className="sec-sub">{t('landingVeSub')}</p>
                <ol className="vsteps">
                  {['landingVeStep1', 'landingVeStep2', 'landingVeStep3', 'landingVeStep4'].map((k, i) => (
                    <li key={k}><span className="vn" aria-hidden="true">{i + 1}</span>{t(k)}</li>
                  ))}
                </ol>
              </div>
              <div className="veframe" aria-hidden="true">
                <div className="ve-sel">
                  <span className="tag">{t('landingVeSelectionLabel')}</span>
                  <h4>Green Haven</h4>
                  <span className="ve-handle" style={{ top: -4, left: -4 }} />
                  <span className="ve-handle" style={{ top: -4, right: -4 }} />
                  <span className="ve-handle" style={{ bottom: -4, left: -4 }} />
                  <span className="ve-handle" style={{ bottom: -4, right: -4 }} />
                </div>
                <div className="ve-chat">
                  <svg viewBox="0 0 24 24" className="ic"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /></svg>
                  <p>{t('landingVeInstruction')}</p>
                </div>
                <p className="ve-note">
                  <svg className="ic" width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
                  {t('landingVeResult')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* OUTPUT QUALITY */}
        <section id="output">
          <div className="wrap center">
            <span className="sec-label">{t('landingOutLabel')}</span>
            <h2 className="h2">{t('landingOutTitle')}</h2>
            <p className="sec-sub">{t('landingOutSub')}</p>
          </div>
          <div className="wrap">
            <div className="oq">
              {['landingOutItem1', 'landingOutItem2', 'landingOutItem3', 'landingOutItem4', 'landingOutItem5'].map((k) => (
                <div className="ocard" key={k}>
                  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                  <p>{t(k)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* RESEARCH — supporting, below the builder story */}
        <section className="research" id="research">
          <div className="wrap">
            <div className="rgrid">
              <div>
                <span className="sec-label">{t('landingResLabel')}</span>
                <h2 className="h2">{t('landingResTitle')}</h2>
                <p className="sec-sub">{t('landingResSub')}</p>
                <ul>
                  {['landingResItem1', 'landingResItem2', 'landingResItem3'].map((k) => (
                    <li key={k}>
                      <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                      <span>{t(k)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="panel" aria-hidden="true">
                <div className="p-h"><span className="q">“AI customer support tools”</span><span className="pill-v">{t('landingResLabel')}</span></div>
                <div className="pain"><span className="nm">Human handoff frustration</span><span className="bar"><i style={{ width: '86%' }} /></span></div>
                <div className="pain"><span className="nm">Bot fails on complex tickets</span><span className="bar"><i style={{ width: '71%' }} /></span></div>
                <div className="pain"><span className="nm">Pricing / value unclear</span><span className="bar"><i style={{ width: '53%' }} /></span></div>
                <div className="p-foot">Illustrative · 3 pains · 12 sources</div>
              </div>
            </div>
          </div>
        </section>

        {/* DELIVERY — GitHub / deploy (upcoming, honest) */}
        <section id="delivery">
          <div className="wrap center">
            <span className="sec-label">{t('landingDelLabel')}</span>
            <div className="delivery-head" style={{ marginTop: 10 }}>
              <StatusBadge status="next" t={t} />
            </div>
            <h2 className="h2">{t('landingDelTitle')}</h2>
            <p className="sec-sub">{t('landingDelSub')}</p>
          </div>
          <div className="wrap">
            <div className="dsteps">
              {['landingDelStep1', 'landingDelStep2', 'landingDelStep3', 'landingDelStep4'].map((k, i, arr) => (
                <div style={{ display: 'contents' }} key={k}>
                  <div className="dstep"><span className="dn" aria-hidden="true">{i + 1}</span>{t(k)}</div>
                  {i < arr.length - 1 && (
                    <span className="darrow" aria-hidden="true">
                      <svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="final">
          <div className="wrap">
            <h2 className="h2">{t('landingFinalTitle')}</h2>
            <p>{t('landingFinalSub')}</p>
            <div className="cta">
              <button type="button" className="btn btn-light btn-lg" onClick={startBuilding}>
                {t('ctaStartBuilding')}
                {arrow}
              </button>
              {isAuthenticated && (
                <Link className="btn btn-dline btn-lg" to="/chat">
                  {t('landingOpenWorkspace')}
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

type StatusKind = 'now' | 'dev' | 'next';

function StatusBadge({ status, t }: { status: StatusKind; t: (k: string) => string }) {
  const map: Record<StatusKind, { cls: string; key: string }> = {
    now: { cls: 'status-now', key: 'landingStatusNow' },
    dev: { cls: 'status-dev', key: 'landingStatusDev' },
    next: { cls: 'status-next', key: 'landingStatusNext' },
  };
  const m = map[status];
  return (
    <span className={`status ${m.cls}`}>
      <span className="sd" aria-hidden="true" />
      {t(m.key)}
    </span>
  );
}
