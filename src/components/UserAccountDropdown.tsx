import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/stores/authStore';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useLanguageStore, LANGUAGES } from '@/stores/languageStore';
import type { Language } from '@/stores/languageStore';
import {
  User, Crown, Zap, Shield, Coins,
  CreditCard, Settings, Globe, BookOpen,
  Users, LogOut, Sparkles, ChevronRight,
  Landmark, LogIn,
} from 'lucide-react';
// import { Button } from '@/components/ui/button';

interface UserAccountDropdownProps {
  onOpenSettings: () => void;
  onOpenUpgrade: () => void;
}

const PLAN_CONFIG = {
  free:       { label: 'Free',       color: 'text-slate-400',       bg: 'bg-slate-500/[0.06]',       border: 'border-slate-500/10',       icon: Sparkles },
  basic:      { label: 'Basic',      color: 'text-cyan-400',        bg: 'bg-cyan-500/[0.06]',        border: 'border-cyan-500/10',        icon: Zap },
  pro:        { label: 'Pro',        color: 'text-amber-400',       bg: 'bg-amber-500/[0.06]',       border: 'border-amber-500/10',       icon: Crown },
  ultra:      { label: 'Ultra',      color: 'text-purple-400',      bg: 'bg-purple-500/[0.06]',      border: 'border-purple-500/10',      icon: Shield },
  enterprise: { label: 'Enterprise', color: 'text-rose-400',        bg: 'bg-rose-500/[0.06]',        border: 'border-rose-500/10',        icon: Landmark },
};

export default function UserAccountDropdown({ onOpenSettings, onOpenUpgrade }: UserAccountDropdownProps) {
  const { settings } = useApp();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthStore();
  // Phase 9 — owner-token unlock counts as "session active" too, so
  // someone who unlocked owner mode via OWNER_TOKEN (no JWT) still
  // sees their owner identity instead of "You / Guest User".
  const { isOwner } = useOwnerMode();
  // Same safety net as Sidebar — when a JWT is in localStorage but
  // the auth store hasn't yet flipped isAuthenticated to true (flaky
  // /auth/me, CORS hiccup), assume session is active rather than
  // immediately falling back to guest UI.
  const hasStoredToken = (() => {
    try { return !!localStorage.getItem('korvix_access_token'); }
    catch { return false; }
  })();
  const sessionActive = isAuthenticated || isOwner || hasStoredToken;
  const { lang, setLang } = useLanguageStore();

  // Display name — honest cascade so we never render "You" when we
  // actually know the user's identity:
  //   1. user.name        (set by /auth/me, Google login, signup)
  //   2. email prefix     (anything before the @ — last resort fallback
  //                        that's still personalized)
  //   3. "Owner"          (when isOwner but no email, e.g. token unlock)
  //   4. "You"            (truly anonymous / guest)
  const emailPrefix = (user?.email || '').split('@')[0].trim();
  const displayName = (
    (user?.name && user.name.trim()) ||
    (emailPrefix && emailPrefix) ||
    (isOwner ? 'Owner' : 'You')
  );
  const displaySubtitle = user?.email || (isOwner ? 'Owner session' : '');
  const avatarInitials = (() => {
    const src = (user?.name?.trim() || emailPrefix || 'U');
    // Strip non-letters, take first two characters of the result.
    const clean = src.replace(/[^\p{L}\p{N}]+/gu, '');
    return (clean || 'U').slice(0, 2).toUpperCase();
  })();
  const [open, setOpen] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const plan = PLAN_CONFIG[settings.plan] || PLAN_CONFIG.free;
  const PlanIcon = plan.icon;

  // Credit info
  const totalCredits = settings.creditsTotal;
  const remainingCredits = settings.creditsRemaining;
  const usagePercent = Math.round((totalCredits - remainingCredits) / totalCredits * 100);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowLangMenu(false);
      }
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, [open]);

  // Keyboard escape
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setShowLangMenu(false);
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open]);

  const handleUpgrade = () => {
    setOpen(false);
    onOpenUpgrade();
  };

  const handleBuyCredits = () => {
    setOpen(false);
    navigate('/credits');
  };

  const handleSettings = () => {
    setOpen(false);
    onOpenSettings();
  };

  const handleLanguage = () => {
    setShowLangMenu(true);
  };

  const selectLanguage = (language: Language) => {
    setLang(language);
    addToast(`${LANGUAGES.find((l) => l.code === language)?.label || language} selected`, 'success');
    setShowLangMenu(false);
    setOpen(false);
  };

  const handleComingSoon = (label: string) => {
    addToast(`${label} — coming soon`, 'info');
    setOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    addToast('Logged out successfully', 'success');
    setOpen(false);
    window.location.href = '/';
  };

  return (
    <div ref={containerRef} className="relative">
      {/* ═── User Card (click target) ─══ */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 border transition-all duration-200 ${
          open
            ? 'bg-white/[0.04] border-white/[0.08]'
            : 'bg-white/[0.015] border-white/[0.03] hover:bg-white/[0.03] hover:border-white/[0.06]'
        }`}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/10 shrink-0">
          {sessionActive ? (
            <span className="text-[10px] font-medium text-cyan-400/80">
              {avatarInitials}
            </span>
          ) : (
            <User className="w-3.5 h-3.5 text-cyan-400/70" />
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[12px] text-white truncate font-medium">
            {displayName}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-1 h-1 rounded-full bg-emerald-400/60" />
            <span className="text-[10px] text-slate-600">
              {isOwner ? 'Owner' : plan.label}
            </span>
          </div>
        </div>
        <span className="text-[10px] text-amber-400/60 tabular-nums shrink-0">{remainingCredits}</span>
      </button>

      {/* ═── Dropdown Menu ─══ */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] as const }}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-white/[0.06] bg-[#171C24]/95 backdrop-blur-2xl shadow-2xl shadow-[#0a0f1a]/60 overflow-hidden z-[60]"
            style={{ maxHeight: 'calc(100vh - 200px)' }}
          >
            {/* Language sub-menu */}
            <AnimatePresence mode="wait">
              {showLangMenu ? (
                <motion.div
                  key="lang"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                >
                  {/* Language header */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.04] shrink-0">
                    <button
                      onClick={() => setShowLangMenu(false)}
                      className="h-6 w-6 flex items-center justify-center rounded-md text-slate-600 hover:text-white hover:bg-white/[0.04] transition-all"
                    >
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                    </button>
                    <span className="text-[12px] font-medium text-white">Language</span>
                  </div>

                  {/* Scrollable language list with fade gradients */}
                  <div className="relative">
                    {/* Top fade gradient */}
                    <div className="absolute top-0 left-0 right-0 h-3 bg-gradient-to-b from-[#0e0e14] to-transparent z-10 pointer-events-none rounded-t-lg" />

                    <div
                      className="p-2 overflow-y-auto scrollbar-thin"
                      style={{
                        maxHeight: '240px',
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(255,255,255,0.08) transparent',
                      }}
                    >
                      {LANGUAGES.map((l) => (
                        <button
                          key={l.code}
                          onClick={() => selectLanguage(l.code)}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] transition-all ${
                            lang === l.code
                              ? 'bg-white/[0.05] text-white'
                              : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
                          }`}
                        >
                          <Globe className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                          <span className="flex-1">{l.label}</span>
                          {lang === l.code && (
                            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Bottom fade gradient */}
                    <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-[#0e0e14] to-transparent z-10 pointer-events-none rounded-b-lg" />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="main"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-y-auto scrollbar-thin"
                  style={{ maxHeight: 'calc(100vh - 200px)' }}
                >
                  {/* User Info Header */}
                  <div className="px-4 py-3.5 border-b border-white/[0.04]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/10 shrink-0">
                        {sessionActive ? (
                          <span className="text-[11px] font-medium text-cyan-400/80">
                            {avatarInitials}
                          </span>
                        ) : (
                          <User className="w-4 h-4 text-cyan-400/70" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-white truncate">
                          {sessionActive ? displayName : 'Guest User'}
                        </p>
                        <p className="text-[11px] text-slate-600 truncate">
                          {sessionActive ? (displaySubtitle || ' ') : 'user@korvix.ai'}
                        </p>
                      </div>
                    </div>

                    {/* Plan Badge */}
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${plan.bg} ${plan.border} border`}>
                      <PlanIcon className={`w-3 h-3 ${plan.color}`} />
                      <span className={`text-[11px] font-medium ${plan.color}`}>{plan.label} Plan</span>
                    </div>
                  </div>

                  {/* ─── Guest: Prominent auth actions (stacked for narrow sidebar) ─── */}
                  {!sessionActive && (
                    <div className="px-4 py-3 border-b border-white/[0.04]">
                      <div className="flex flex-col gap-1.5">
                        <button
                          onClick={() => { setOpen(false); navigate('/signup'); }}
                          className="w-full h-8 flex items-center justify-center gap-1.5 rounded-xl bg-cyan-500/[0.08] text-cyan-400 border border-cyan-500/15 text-[11px] font-medium hover:bg-cyan-500/[0.12] transition-all"
                        >
                          <Sparkles className="w-3 h-3" /> Create Account
                        </button>
                        <button
                          onClick={() => { setOpen(false); navigate('/login'); }}
                          className="w-full h-8 flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.02] text-slate-400 border border-white/[0.04] text-[11px] hover:bg-white/[0.04] hover:text-slate-300 transition-all"
                        >
                          <LogIn className="w-3 h-3" /> Sign In
                        </button>
                      </div>
                      <p className="text-[9px] text-[#64748B] mt-1.5 text-center">Sync across devices</p>
                    </div>
                  )}

                  {/* Credits Section — compact */}
                  <div className="px-4 py-3 border-b border-white/[0.04]">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-amber-400/60" />
                        <span className="text-[11px] text-slate-400">Credits</span>
                      </div>
                      <span className="text-[11px] font-medium text-white tabular-nums">
                        {remainingCredits} <span className="text-[#64748B]">/ {totalCredits}</span>
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1 bg-white/[0.03] rounded-full overflow-hidden mb-2">
                      <motion.div
                        className="h-full rounded-full bg-cyan-400/40"
                        initial={{ width: 0 }}
                        animate={{ width: `${usagePercent}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      />
                    </div>

                    {/* Free chat badge */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-1 h-1 rounded-full bg-emerald-400/40" />
                      <span className="text-[9px] text-emerald-400/50">Casual chat is free</span>
                    </div>

                    {/* Action Buttons — stacked for narrow sidebar */}
                    <div className="flex flex-col gap-1.5">
                      <button
                        onClick={handleBuyCredits}
                        className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500/[0.05] text-cyan-400 border border-cyan-500/8 text-[11px] font-medium hover:bg-cyan-500/[0.08] transition-all"
                      >
                        <CreditCard className="w-3 h-3" /> Buy Credits
                      </button>
                      <button
                        onClick={handleUpgrade}
                        className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/[0.05] text-amber-400 border border-amber-500/8 text-[11px] hover:bg-amber-500/[0.08] transition-all"
                      >
                        <Crown className="w-3 h-3" /> Upgrade Plan
                      </button>
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div className="p-2">
                    <MenuItem icon={Settings} label="Account Settings" onClick={handleSettings} />
                    <MenuItem icon={Globe} label="Language" onClick={handleLanguage} hasSubmenu />
                    <MenuItem icon={BookOpen} label="Learning Center" onClick={() => handleComingSoon('Learning Center')} />
                    <MenuItem icon={BookOpen} label="Documentation" onClick={() => handleComingSoon('Documentation')} />
                    <MenuItem icon={Users} label="Community" onClick={() => handleComingSoon('Community')} />

                    <div className="border-t border-white/[0.03] mt-1 pt-1">
                      {isAuthenticated && (
                        <MenuItem icon={LogOut} label="Log Out" onClick={handleLogout} danger />
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═── Menu Item sub-component ─══ */
function MenuItem({
  icon: Icon,
  label,
  onClick,
  hasSubmenu,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  hasSubmenu?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] transition-all ${
        danger
          ? 'text-red-400/60 hover:text-red-400 hover:bg-red-500/[0.04]'
          : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${danger ? 'text-red-400/40' : 'text-slate-600'}`} />
      <span className="flex-1">{label}</span>
      {hasSubmenu && <ChevronRight className="w-3 h-3 text-[#64748B]" />}
    </button>
  );
}
