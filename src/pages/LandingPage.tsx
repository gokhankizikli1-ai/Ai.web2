import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import ProductStory from '@/components/landing/ProductStory';

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

/* sections */
.mk section{padding:64px 0;}
.mk .sec-label{font-family:var(--mono); font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--accent); font-weight:600;}
.mk .h2{font-size:32px; line-height:1.14; letter-spacing:-0.025em; font-weight:680; margin:12px 0 0; text-wrap:balance; max-width:24ch;}
.mk .sec-sub{font-size:15.5px; color:var(--muted); margin:12px 0 0; max-width:62ch; line-height:1.6;}
.mk .center{text-align:center;} .mk .center .h2,.mk .center .sec-sub{margin-left:auto; margin-right:auto;}

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
  .mk .oq{grid-template-columns:1fr 1fr;}
  .mk .rgrid{grid-template-columns:1fr; gap:32px;}
}
@media (max-width:560px){
  .mk .hero{padding:92px 0 0;}
  .mk .h1{font-size:34px;} .mk .sub{font-size:15px;}
  .mk .oq{grid-template-columns:1fr;}
  .mk .final .h2{font-size:27px;}
  .mk .send{margin-left:0; width:100%;} .mk .send .btn{width:100%; justify-content:center;}
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
        </div>

        {/* THREE-STEP ANIMATED PRODUCT STORY (Describe → Generate → Refine & ship).
            Consolidates the former static product demo, five-card build flow, and
            static Visual Edit section into one continuous walkthrough. */}
        <ProductStory />

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
