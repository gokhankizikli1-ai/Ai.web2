import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { X } from 'lucide-react';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';
import { useAuthStore } from '@/stores/authStore';
import { getLandingHref } from '@/lib/landingNav';

/**
 * KorvixAI landing page — ported from the approved "v8" design.
 *
 * Direction: Ink + Porcelain + Muted Slate Blue. Light porcelain page,
 * a single cinematic dark product-demo frame, honest copy (no fabricated
 * metrics / users / logos). All CTAs route through the real auth flow:
 *   • logged-out  → primary "Get Started Free" → /signup, "Sign in" → /login
 *   • logged-in   → primary "Open Workspace"   → /workspace
 *   • "Watch Demo" opens a polished placeholder modal (no real video yet).
 *
 * The visual system lives in a scoped `.mk` stylesheet below so the port
 * stays pixel-faithful to the design mockup without leaking into the rest
 * of the app (all selectors are prefixed with `.mk`). The shared Navbar
 * and Footer are reused (Tailwind-styled) for cross-page consistency.
 */

const MK_CSS = `
.mk{
  --porcelain:#F7F8FA; --porcelain-2:#EDEFF3; --section:#EEF1F4; --surface:#FFFFFF;
  --ink:#0F1729; --body:#334155; --muted:#64748B; --faint:#94A3B8; --border:#DDE3EA;
  --accent:#52677A; --accent-hi:#637B90; --sage:#6F8F7A;
  --d-bg:#0B0E12; --d-surf:#11161C; --d-border:#28323D; --d-line:rgba(255,255,255,0.06);
  --d-text:#F5F7FA; --d-body:#D7DEE8; --d-muted:#93A3B5; --d-accent:#8FA6BA;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  font-family:var(--sans); color:var(--ink); -webkit-font-smoothing:antialiased; line-height:1.5;
  min-height:100vh;
  background:radial-gradient(880px 500px at 50% -8%, rgba(82,103,122,0.06), transparent 62%),
    linear-gradient(180deg,var(--porcelain),var(--porcelain-2));
}
.mk *{box-sizing:border-box;}
.mk .wrap{max-width:1120px; margin:0 auto; padding:0 28px;}

.mk .btn{font:inherit; font-size:13px; font-weight:600; letter-spacing:-0.005em; border-radius:10px; padding:0 16px; height:38px;
  display:inline-flex; align-items:center; gap:8px; cursor:pointer; border:1px solid transparent; text-decoration:none; white-space:nowrap;
  transition:transform .18s,background .18s,border-color .18s;}
.mk .btn-dark{color:#F5F7FA; background:linear-gradient(180deg,#161C23,#0B0E12); border-color:rgba(255,255,255,0.08);
  box-shadow:0 6px 18px rgba(16,24,39,0.16),inset 0 1px 0 rgba(255,255,255,0.07);}
.mk .btn-dark:hover{transform:translateY(-1px);}
.mk .btn-outline{color:var(--body); background:var(--surface); border-color:var(--border);} .mk .btn-outline:hover{border-color:#C3CDD8;}
.mk .btn-lg{height:46px; font-size:14px; padding:0 20px; border-radius:12px;}

/* hero */
.mk .hero{padding:112px 0 0; text-align:center;}
.mk .eyebrow{display:inline-flex; align-items:center; gap:8px; height:29px; padding:0 13px; border:1px solid var(--border);
  background:var(--surface); border-radius:999px; font-size:12px; font-weight:600; color:var(--muted);}
.mk .eyebrow .d{width:6px; height:6px; border-radius:50%; background:var(--sage);}
.mk .h1{font-size:58px; line-height:1.03; letter-spacing:-0.037em; font-weight:690; margin:20px auto 0; max-width:15ch; text-wrap:balance;}
.mk .sub{font-size:18px; line-height:1.56; color:var(--body); margin:20px auto 0; max-width:58ch; letter-spacing:-0.008em;}
.mk .cta{display:flex; gap:12px; justify-content:center; margin-top:28px;}
.mk .microcopy{margin-top:15px; font-size:12.5px; color:var(--faint);}

/* demo frame */
.mk .stage{position:relative; margin:46px auto 0; max-width:980px;}
.mk .stage-glow{position:absolute; inset:-36px -26px 24px; border-radius:36px;
  background:radial-gradient(58% 70% at 50% 8%, rgba(82,103,122,0.14), transparent 72%); filter:blur(8px); pointer-events:none;}
.mk .frame{position:relative; background:var(--d-bg); border:1px solid var(--d-border); border-radius:16px; overflow:hidden;
  box-shadow:0 36px 82px -34px rgba(11,14,18,0.55),0 12px 26px -14px rgba(16,24,39,0.26),inset 0 1px 0 rgba(255,255,255,0.05);}
.mk .chrome{display:flex; align-items:center; gap:9px; padding:12px 16px; border-bottom:1px solid var(--d-line); background:linear-gradient(180deg,#12171E,#0E1319);}
.mk .chrome i{width:10px; height:10px; border-radius:50%; background:#2C3742;}
.mk .chrome .u{margin:0 auto; font-size:11.5px; color:var(--d-muted); font-family:var(--mono); background:#0E141A; border:1px solid var(--d-line); padding:4px 14px; border-radius:8px;}
.mk .flowbar{display:flex; align-items:center; gap:6px; padding:10px 16px; background:#0C1116; border-bottom:1px solid var(--d-line);}
.mk .fb{display:flex; align-items:center; gap:7px; font-size:11.5px; font-weight:550; color:var(--d-muted); padding:5px 10px; border-radius:8px;}
.mk .fb svg{width:13px; height:13px;}
.mk .fb.on{color:var(--d-text); background:rgba(82,103,122,0.18); box-shadow:inset 0 0 0 1px rgba(143,166,186,0.2);}
.mk .fb-arrow{color:#3C4753; display:flex;} .mk .fb-arrow svg{width:14px; height:14px;}
.mk .canvas{padding:18px 20px 14px; display:flex; flex-direction:column; gap:11px;}
.mk .prompt{display:flex; align-items:center; gap:11px; border:1px solid var(--d-border); background:var(--d-surf); border-radius:11px; padding:12px 14px;}
.mk .prompt svg{width:16px; height:16px; color:var(--d-accent); flex:none;}
.mk .prompt p{margin:0; font-size:13px; color:var(--d-body);} .mk .prompt .car{width:1.5px; height:15px; background:var(--d-accent); animation:mkblink 1.1s steps(1) infinite;}
@keyframes mkblink{50%{opacity:0;}}
.mk .scan{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
.mk .scan .l{font-size:11px; color:#63727F;}
.mk .chip{font-family:var(--mono); font-size:10.5px; color:var(--d-body); border:1px solid var(--d-border); background:var(--d-surf);
  border-radius:8px; padding:4px 9px; display:inline-flex; align-items:center; gap:6px;}
.mk .chip .lv{width:5px; height:5px; border-radius:50%; background:var(--sage); animation:mkpulse 2.4s ease-out infinite;}
@keyframes mkpulse{0%{box-shadow:0 0 0 0 rgba(111,143,122,0.45);}70%{box-shadow:0 0 0 5px rgba(111,143,122,0);}100%{box-shadow:0 0 0 0 rgba(111,143,122,0);}}
.mk .rescard{border:1px solid var(--d-border); border-radius:12px; overflow:hidden; background:var(--d-surf);}
.mk .rc-h{display:flex; align-items:center; justify-content:space-between; padding:11px 14px; background:#0F141A; border-bottom:1px solid var(--d-line);}
.mk .rc-h .t{font-size:12px; font-weight:600; color:var(--d-text);}
.mk .pill{font-size:10.5px; font-weight:600; padding:3px 10px; border-radius:999px; border:1px solid; letter-spacing:0.01em;}
.mk .pill-v{color:#A7BDD0; border-color:rgba(143,166,186,0.42); background:rgba(82,103,122,0.16);}
.mk .rc-rows{padding:4px 14px 10px;}
.mk .rrow{display:flex; align-items:baseline; gap:12px; padding:8px 0; border-bottom:1px solid var(--d-line);} .mk .rrow:last-child{border-bottom:0;}
.mk .rrow .k{font-size:11px; color:#63727F; width:74px; flex:none;} .mk .rrow .v{font-size:12.5px; color:var(--d-body);} .mk .rrow .v b{color:var(--d-text); font-weight:640;}
.mk .script{display:grid; grid-template-columns:repeat(4,1fr); border-top:1px solid var(--d-line); background:#0C1116;}
.mk .sc{display:flex; align-items:center; gap:9px; padding:12px 14px; border-right:1px solid var(--d-line);} .mk .sc:last-child{border-right:0;}
.mk .sc .n{width:19px; height:19px; border-radius:6px; background:rgba(82,103,122,0.2); color:var(--d-accent); font-family:var(--mono); font-size:10px; font-weight:600; display:grid; place-items:center; flex:none;}
.mk .sc .tx{font-size:11px; color:var(--d-body); font-weight:500;}
.mk .play{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:13px; cursor:pointer; z-index:3; border:0;
  background:radial-gradient(48% 62% at 50% 42%, rgba(11,14,18,0.14), rgba(11,14,18,0.44));}
.mk .play-btn{width:68px; height:68px; border-radius:50%; background:rgba(247,249,251,0.97); display:grid; place-items:center;
  box-shadow:0 14px 36px -8px rgba(0,0,0,0.55),0 0 0 8px rgba(247,249,251,0.10); transition:transform .2s;}
.mk .play:hover .play-btn{transform:scale(1.06);}
.mk .play-btn svg{width:24px; height:24px; margin-left:3px; fill:#0F1729;}
.mk .play .cap{font-size:13px; font-weight:600; color:#F1F4F7; text-shadow:0 1px 14px rgba(0,0,0,0.7);}
.mk .ring{position:absolute; width:68px; height:68px; border-radius:50%; border:1.5px solid rgba(247,249,251,0.5); animation:mkring 2.6s ease-out infinite;}
@keyframes mkring{0%{transform:scale(1);opacity:.65;}100%{transform:scale(1.8);opacity:0;}}

/* sections */
.mk section{padding:68px 0;}
.mk .sec-label{font-family:var(--mono); font-size:11px; letter-spacing:0.09em; text-transform:uppercase; color:var(--accent); font-weight:600;}
.mk .h2{font-size:33px; line-height:1.13; letter-spacing:-0.025em; font-weight:680; margin:12px 0 0; text-wrap:balance; max-width:24ch;}
.mk .sec-sub{font-size:15.5px; color:var(--muted); margin:12px 0 0; max-width:60ch; line-height:1.6;}
.mk .center{text-align:center;} .mk .center .h2,.mk .center .sec-sub{margin-left:auto; margin-right:auto;}

/* workflow */
.mk .flow{display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:stretch; margin-top:34px;}
.mk .fcard{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:20px; box-shadow:0 6px 16px -12px rgba(16,24,39,0.10);}
.mk .fcard .top{display:flex; align-items:center; gap:11px; margin-bottom:9px;}
.mk .fcard .ico{width:36px; height:36px; border-radius:10px; background:var(--section); color:var(--accent); display:grid; place-items:center; flex:none;}
.mk .fcard .ico svg{width:18px; height:18px;}
.mk .fcard h3{font-size:15.5px; font-weight:640; letter-spacing:-0.012em; margin:0;}
.mk .fcard p{font-size:13px; color:var(--muted); line-height:1.5; margin:0;}
.mk .fjoin{display:flex; align-items:center; padding:0 14px; color:#B7C1CC;} .mk .fjoin svg{width:19px; height:19px;}

/* radar */
.mk .radar{background:linear-gradient(180deg,#FFFFFF,#F5F7FA); border-top:1px solid var(--border); border-bottom:1px solid var(--border);}
.mk .rgrid{display:grid; grid-template-columns:1fr 1fr; gap:52px; align-items:center;}
.mk .rgrid ul{list-style:none; padding:0; margin:22px 0 0; display:flex; flex-direction:column; gap:13px;}
.mk .rgrid li{display:flex; gap:12px; align-items:flex-start; font-size:14px; color:var(--body);}
.mk .rgrid li svg{width:17px; height:17px; color:var(--accent); flex:none; margin-top:1px;} .mk .rgrid li b{color:var(--ink); font-weight:620;}
.mk .panel{background:var(--d-bg); border:1px solid var(--d-border); border-radius:15px; padding:16px; box-shadow:0 26px 58px -30px rgba(11,14,18,0.5);}
.mk .p-h{display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;}
.mk .p-h .q{font-size:12.5px; color:var(--d-body); font-weight:500;}
.mk .pain{display:flex; align-items:center; justify-content:space-between; gap:16px; padding:10px 0; border-top:1px solid var(--d-line);} .mk .pain:first-of-type{border-top:0;}
.mk .pain .nm{font-size:12.5px; color:var(--d-text); font-weight:540;}
.mk .pain .bar{width:90px; height:5px; border-radius:3px; background:#1A222B; overflow:hidden; flex:none;} .mk .pain .bar i{display:block; height:100%; background:linear-gradient(90deg,#52677A,#7890A3); border-radius:3px;}
.mk .p-foot{display:flex; align-items:center; justify-content:space-between; margin-top:13px; padding-top:12px; border-top:1px solid var(--d-line);}
.mk .p-foot .l{font-size:11px; color:#63727F;}
.mk .sendbtn{font-size:11px; font-weight:600; color:#A7BDD0; border:1px solid rgba(143,166,186,0.35); border-radius:8px; padding:5px 10px; display:inline-flex; gap:6px; align-items:center;} .mk .sendbtn svg{width:12px; height:12px;}

/* why korvix */
.mk .why{background:linear-gradient(180deg,#F5F7FA,#EDEFF3); border-top:1px solid var(--border); border-bottom:1px solid var(--border);}
.mk .mflow{display:flex; align-items:center; justify-content:center; gap:8px; margin-top:34px; flex-wrap:wrap;}
.mk .mnode{background:var(--surface); border:1px solid var(--border); border-radius:11px; padding:11px 15px; font-size:12.5px; font-weight:560; color:var(--ink);
  display:flex; align-items:center; gap:9px; box-shadow:0 2px 8px -4px rgba(16,24,39,0.08);}
.mk .mnode .k{width:7px; height:7px; border-radius:2px; background:var(--accent);}
.mk .marrow{color:#AEB9C5; display:flex;} .mk .marrow svg{width:17px; height:17px;}

/* surfaces */
.mk .grid6{display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:36px;}
.mk .scard{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px 18px; min-height:150px;
  display:flex; flex-direction:column; transition:transform .16s,border-color .16s; text-decoration:none; color:inherit;}
.mk .scard:hover{transform:translateY(-2px); border-color:#C6D0DA;}
.mk .scard .top{display:flex; align-items:center; gap:10px; margin-bottom:10px;}
.mk .scard .ico{width:33px; height:33px; border-radius:9px; background:var(--section); color:var(--accent); display:grid; place-items:center; flex:none;} .mk .scard .ico svg{width:17px; height:17px;}
.mk .scard h3{font-size:14.5px; font-weight:640; letter-spacing:-0.01em; margin:0;}
.mk .scard .tag{font-family:var(--mono); font-size:8.5px; letter-spacing:0.05em; text-transform:uppercase; color:var(--accent); border:1px solid rgba(82,103,122,0.3); border-radius:5px; padding:2px 6px; margin-left:auto;}
.mk .scard p{font-size:12.5px; color:var(--muted); line-height:1.5; margin:0;}
.mk .undercopy{margin-top:18px; text-align:center; font-size:12.5px; color:var(--faint);}

/* use cases */
.mk .uc{display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top:32px;}
.mk .ucard{background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:13px 16px; display:flex; align-items:center; gap:10px;
  font-size:13px; font-weight:540; color:var(--body); transition:border-color .16s, transform .16s; text-decoration:none;}
.mk .ucard:hover{border-color:#C6D0DA; transform:translateY(-2px);}
.mk .ucard svg{width:15px; height:15px; color:var(--accent); flex:none;}

/* final cta */
.mk .final{background:radial-gradient(80% 130% at 50% 0%, #14202A 0%, #0B0E12 66%); border-top:1px solid var(--d-border); text-align:center; padding:74px 0 80px;}
.mk .final .h2{font-size:37px; letter-spacing:-0.03em; color:var(--d-text); max-width:20ch; margin:0 auto; text-wrap:balance;}
.mk .final p{font-size:16px; color:var(--d-muted); margin:15px auto 0; max-width:46ch;}
.mk .final .cta{margin-top:26px;}
.mk .btn-light{color:#0F1729; background:#F5F7FA; box-shadow:0 8px 24px -8px rgba(0,0,0,0.45);} .mk .btn-light:hover{transform:translateY(-1px); background:#fff;}
.mk .btn-dline{color:var(--d-body); background:transparent; border-color:rgba(255,255,255,0.16);} .mk .btn-dline:hover{border-color:rgba(255,255,255,0.34); color:#fff;}

.mk .ic{stroke:currentColor; stroke-width:1.7; fill:none; stroke-linecap:round; stroke-linejoin:round;}

@media (max-width:960px){
  .mk .h1{font-size:44px;}
  .mk .flow{grid-template-columns:1fr; gap:12px;} .mk .fjoin{transform:rotate(90deg); padding:2px 0; margin:0 auto;}
  .mk .script{grid-template-columns:repeat(2,1fr);} .mk .sc:nth-child(2){border-right:0;}
  .mk .rgrid{grid-template-columns:1fr; gap:32px;}
  .mk .grid6{grid-template-columns:1fr 1fr;}
  .mk .flowbar{overflow-x:auto;}
}
@media (max-width:560px){
  .mk .h1{font-size:35px;} .mk .sub{font-size:15.5px;} .mk .cta{flex-direction:column;} .mk .btn-lg{justify-content:center;}
  .mk .grid6{grid-template-columns:1fr;} .mk .final .h2{font-size:29px;}
  .mk .mflow{flex-direction:column;} .mk .marrow{transform:rotate(90deg);}
}
@media (prefers-reduced-motion:reduce){ .mk .prompt .car,.mk .chip .lv,.mk .ring{animation:none !important;} }
`;

/** Polished placeholder shown when a visitor clicks "Watch Demo" — no
 * real walkthrough video exists yet, so we're honest about it rather
 * than linking a fake asset. */
function DemoModal({ onClose, ctaTo, ctaLabel }: { onClose: () => void; ctaTo: string; ctaLabel: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(8,11,15,0.72)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Product walkthrough"
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border text-center"
        style={{ background: '#0B0E12', borderColor: '#28323D', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.7)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-[#93A3B5] transition-colors hover:text-[#F5F7FA]"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="px-8 py-12">
          <div
            className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full"
            style={{ background: 'rgba(247,249,251,0.97)', boxShadow: '0 14px 36px -8px rgba(0,0,0,0.55)' }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" style={{ marginLeft: 3, fill: '#0F1729' }}><path d="M8 5v14l11-7z" /></svg>
          </div>
          <h3 className="text-[19px] font-semibold tracking-tight text-[#F5F7FA]">Walkthrough coming soon</h3>
          <p className="mx-auto mt-2 max-w-[34ch] text-[13.5px] leading-relaxed text-[#93A3B5]">
            The full product tour is on the way. In the meantime, start a free
            workspace and run Startup Radar on your own idea.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              to={ctaTo}
              onClick={onClose}
              className="inline-flex h-10 items-center rounded-xl px-5 text-[13px] font-semibold text-[#0F1729]"
              style={{ background: '#F5F7FA' }}
            >
              {ctaLabel}
            </Link>
            <button
              onClick={onClose}
              className="inline-flex h-10 items-center rounded-xl px-5 text-[13px] font-semibold text-[#D7DEE8]"
              style={{ border: '1px solid rgba(255,255,255,0.16)', background: 'transparent' }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { isAuthenticated } = useAuthStore();
  const [showDemo, setShowDemo] = useState(false);
  const openDemo = useCallback(() => setShowDemo(true), []);

  // Auth-aware primary CTA: never show "Open Workspace" to logged-out
  // visitors (they have no account yet); send them to signup instead.
  // Routing is centralized in getLandingHref so logged-out clicks can
  // never enter the app.
  const primaryTo = getLandingHref('workspace', isAuthenticated);
  const primaryLabel = isAuthenticated ? 'Open Workspace' : 'Get Started Free';

  return (
    <div className="mk">
      <style>{MK_CSS}</style>
      <Navbar />

      <main>
        <div className="wrap">
          {/* HERO */}
          <div className="hero">
            <span className="eyebrow"><span className="d" /> One AI workspace for builders</span>
            <h1 className="h1">Research the market before you build.</h1>
            <p className="sub">Korvix helps founders and builders scan public signals, find real customer complaints, validate startup ideas, and turn the next step into focused AI work.</p>
            <div className="cta">
              <Link className="btn btn-dark btn-lg" to={primaryTo}>
                {primaryLabel}
                <svg className="ic" width="16" height="16" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
              <button className="btn btn-outline btn-lg" onClick={openDemo}>
                <svg className="ic" width="14" height="14" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none" /></svg>
                Watch Demo
              </button>
            </div>
            <div className="microcopy">Free to start · runs in your browser</div>
          </div>

          {/* DEMO FRAME */}
          <div className="stage" id="demo">
            <div className="stage-glow" />
            <div className="frame">
              <div className="chrome"><i /><i /><i /><span className="u">korvix.ai / workspace</span></div>
              <div className="flowbar">
                <span className="fb on"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 3v3M3 12h3M18 12h3" /></svg> Startup Radar</span>
                <span className="fb-arrow"><svg className="ic" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></span>
                <span className="fb"><svg className="ic" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h9" /></svg> Builder</span>
                <span className="fb-arrow"><svg className="ic" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></span>
                <span className="fb"><svg className="ic" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16" /></svg> Project</span>
              </div>
              <div className="canvas">
                <div className="prompt"><svg viewBox="0 0 24 24" className="ic"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg><p>Find startup pains in AI support tools</p><span className="car" /></div>
                <div className="scan"><span className="l">Scanning</span><span className="chip"><span className="lv" /> Web scan</span><span className="chip"><span className="lv" /> Founder forums</span><span className="chip"><span className="lv" /> Communities</span></div>
                <div className="rescard">
                  <div className="rc-h"><span className="t">Market read</span><span className="pill pill-v">Validate first</span></div>
                  <div className="rc-rows">
                    <div className="rrow"><span className="k">Top pain</span><span className="v"><b>Human handoff frustration</b></span></div>
                    <div className="rrow"><span className="k">Next step</span><span className="v">Draft a landing plan for the wedge</span></div>
                  </div>
                </div>
              </div>
              <div className="script">
                <div className="sc"><span className="n">1</span><span className="tx">Startup Radar</span></div>
                <div className="sc"><span className="n">2</span><span className="tx">Find top complaint</span></div>
                <div className="sc"><span className="n">3</span><span className="tx">Send to Builder</span></div>
                <div className="sc"><span className="n">4</span><span className="tx">Save to Project</span></div>
              </div>
              <button className="play" onClick={openDemo} aria-label="Watch demo">
                <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}><span className="ring" /><span className="play-btn"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span></span>
                <span className="cap">Watch Korvix turn market complaints into a build plan.</span>
              </button>
            </div>
          </div>
        </div>

        {/* WORKFLOW */}
        <section id="how">
          <div className="wrap center">
            <span className="sec-label">How it works</span>
            <h2 className="h2">From idea to evidence to execution.</h2>
            <p className="sec-sub">A straight line from a hunch to a decision you can defend.</p>
          </div>
          <div className="wrap">
            <div className="flow">
              <div className="fcard"><div className="top"><div className="ico"><svg className="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg></div><h3>Find the pain</h3></div><p>Scan public discussion and cluster the loudest complaints into plain-language themes.</p></div>
              <div className="fjoin"><svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
              <div className="fcard"><div className="top"><div className="ico"><svg className="ic" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg></div><h3>Validate the signal</h3></div><p>See where the market actually complains, with honest sources — before you commit.</p></div>
              <div className="fjoin"><svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
              <div className="fcard"><div className="top"><div className="ico"><svg className="ic" viewBox="0 0 24 24"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 21l-4.9-2.6.9-5.5-4-3.9 5.5-.8z" /></svg></div><h3>Build the next step</h3></div><p>Turn evidence into an MVP wedge, a page, or a build plan — inside the workspace.</p></div>
            </div>
          </div>
        </section>

        {/* STARTUP RADAR */}
        <section className="radar" id="startup-radar">
          <div className="wrap">
            <div className="rgrid">
              <div>
                <span className="sec-label">Startup Radar</span>
                <h2 className="h2">Find what people complain about before you build.</h2>
                <p className="sec-sub">Enter a market. Korvix reads current public discussion, ranks the real pains, and hands the result straight to a builder — not another dashboard.</p>
                <ul>
                  <li><svg className="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg><span><b>Honest sources:</b> public web, founder forums, and communities are labeled clearly.</span></li>
                  <li><svg className="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg><span><b>Ranked pain themes:</b> complaints are clustered into plain-language themes.</span></li>
                  <li><svg className="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg><span><b>Straight to build:</b> send the strongest wedge into a builder prompt.</span></li>
                </ul>
              </div>
              <div className="panel">
                <div className="p-h"><span className="q">“AI customer support tools”</span><span className="pill pill-v">Validate first</span></div>
                <div className="pain"><span className="nm">Human handoff frustration</span><span className="bar"><i style={{ width: '86%' }} /></span></div>
                <div className="pain"><span className="nm">Bot fails on complex tickets</span><span className="bar"><i style={{ width: '71%' }} /></span></div>
                <div className="pain"><span className="nm">Pricing / value unclear</span><span className="bar"><i style={{ width: '53%' }} /></span></div>
                <div className="p-foot"><span className="l">Illustrative — 3 pains · 12 sources</span><span className="sendbtn"><svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg> Send to builder</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* WHY KORVIX */}
        <section className="why">
          <div className="wrap center">
            <span className="sec-label">Why Korvix</span>
            <h2 className="h2">Not another chatbot. A workspace that moves ideas forward.</h2>
            <p className="sec-sub">Most AI tools stop at an answer. Korvix connects research, validation, building, and project memory so a rough idea can become a next action.</p>
            <div className="mflow">
              <span className="mnode"><span className="k" /> Question</span>
              <span className="marrow"><svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              <span className="mnode"><span className="k" /> Market evidence</span>
              <span className="marrow"><svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              <span className="mnode"><span className="k" /> Decision</span>
              <span className="marrow"><svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              <span className="mnode"><span className="k" /> Builder prompt</span>
              <span className="marrow"><svg className="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              <span className="mnode"><span className="k" /> Project memory</span>
            </div>
          </div>
        </section>

        {/* SURFACES */}
        <section id="features">
          <div className="wrap center">
            <span className="sec-label">Product surfaces</span>
            <h2 className="h2">Workspaces for turning signals into products.</h2>
            <p className="sec-sub">The surfaces you actually ship from — one connected workspace.</p>
          </div>
          <div className="wrap">
            <div className="grid6">
              <Link className="scard" to={getLandingHref('startup', isAuthenticated)}><div className="top"><div className="ico"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg></div><h3>Startup Intelligence</h3></div><p>Find market complaints, validation angles, and first-customer signals before building.</p></Link>
              <Link className="scard" to={getLandingHref('ecommerce', isAuthenticated)}><div className="top"><div className="ico"><svg className="ic" viewBox="0 0 24 24"><path d="M5 7h14l-1.2 10H6.2z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></svg></div><h3>Ecommerce Builder</h3></div><p>Research products, offers, pages, and store workflows from one workspace.</p></Link>
              <Link className="scard" to={getLandingHref('game', isAuthenticated)}><div className="top"><div className="ico"><svg className="ic" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="3" /><path d="M9 12h2M15 11v2" /></svg></div><h3>AI Game Builder</h3><span className="tag">Beta</span></div><p>Turn game ideas into structured build plans, scripts, and prototype steps.</p></Link>
              <Link className="scard" to={getLandingHref('app-builder', isAuthenticated)}><div className="top"><div className="ico"><svg className="ic" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h9" /></svg></div><h3>Website / App Builder</h3></div><p>Move from idea to landing page, app screen, or workflow plan.</p></Link>
              <Link className="scard" to={getLandingHref('agents', isAuthenticated)}><div className="top"><div className="ico"><svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" /></svg></div><h3>Agents &amp; Automation</h3></div><p>Create focused AI workers for repeatable research, building, and operations.</p></Link>
              <Link className="scard" to={getLandingHref('projects', isAuthenticated)}><div className="top"><div className="ico"><svg className="ic" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16" /></svg></div><h3>Project Memory</h3></div><p>Keep chats, research, files, decisions, and builds organized.</p></Link>
            </div>
            <p className="undercopy">Chat and research run underneath every workflow.</p>
          </div>
        </section>

        {/* USE CASES */}
        <section id="use-cases" style={{ paddingTop: 0 }}>
          <div className="wrap center">
            <span className="sec-label">Use cases</span>
            <h2 className="h2">Start from the work you already want to do.</h2>
            <div className="uc">
              <Link className="ucard" to={getLandingHref('startup', isAuthenticated)}><svg className="ic" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg> Validate a startup idea</Link>
              <Link className="ucard" to={getLandingHref('ecommerce', isAuthenticated)}><svg className="ic" viewBox="0 0 24 24"><path d="M5 7h14l-1.2 10H6.2z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></svg> Find ecommerce product angles</Link>
              <Link className="ucard" to={getLandingHref('game', isAuthenticated)}><svg className="ic" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="3" /><path d="M9 12h2M15 11v2" /></svg> Plan a game prototype</Link>
              <Link className="ucard" to={getLandingHref('projects', isAuthenticated)}><svg className="ic" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16" /></svg> Turn research into a project</Link>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="final">
          <div className="wrap">
            <h2 className="h2">Start with an idea. Leave with a next step.</h2>
            <p>Create your Korvix workspace, choose a flow, and turn research into action.</p>
            <div className="cta">
              <Link className="btn btn-light btn-lg" to={primaryTo}>
                {primaryLabel}
                <svg className="ic" width="16" height="16" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
              <button className="btn btn-dline btn-lg" onClick={openDemo}>
                <svg className="ic" width="14" height="14" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none" /></svg>
                Watch Demo
              </button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
      {showDemo && <DemoModal onClose={() => setShowDemo(false)} ctaTo={primaryTo} ctaLabel={primaryLabel} />}
    </div>
  );
}
