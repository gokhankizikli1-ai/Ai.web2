import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/contexts/AppContext';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/stores/authStore';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useLanguageStore, LANGUAGES } from '@/stores/languageStore';
import type { Language } from '@/stores/languageStore';
import { resolvePlanKey } from '@/lib/plan';
import {
  User, Crown, Zap, Shield, Coins,
  CreditCard, Settings, Globe,
  LogOut, Sparkles, ChevronRight,
  Landmark, LogIn,
} from 'lucide-react';
// import { Button } from '@/components/ui/button';

interface UserAccountDropdownProps {
  onOpenSettings: () => void;
  onOpenUpgrade: () => void;
}

const PLAN_CONFIG = {
  free:       { label: 'Free',       color: 'text-[#CBD5E1]',       bg: 'bg-slate-500/[0.06]',       border: 'border-slate-500/10',       icon: Sparkles },
  basic:      { label: 'Basic',      color: 'text-[#3B82F6]',        bg: 'bg-[#3B82F6]/[0.06]',        border: 'border-[#3B82F6]/10',        icon: Zap },
  pro:        { label: 'Pro',        color: 'text-[#3B82F6]',       bg: 'bg-[#3B82F6]/[0.06]',       border: 'border-[#3B82F6]/10',       icon: Crown },
  ultra:      { label: 'Ultra',      color: 'text-[#3B82F6]',      bg: 'bg-[#3B82F6]/[0.06]',      border: 'border-[#3B82F6]/10',      icon: Shield },
  enterprise: { label: 'Enterprise', color: 'text-[#3B82F6]',        bg: 'bg-[#3B82F6]/[0.06]',        border: 'border-[#3B82F6]/10',        icon: Landmark },
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
  const { lang, setLang, t } = useLanguageStore();

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
  const displaySubtitle = user?.email || (isOwner ? t('ownerSession') : '');
  const avatarInitials = (() => {
    const src = (user?.name?.trim() || emailPrefix || 'U');
    // Strip non-letters, take first two characters of the result.
    const clean = src.replace(/[^\p{L}\p{N}]+/gu, '');
    return (clean || 'U').slice(0, 2).toUpperCase();
  })();
  const [open, setOpen] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Single source of truth (src/lib/plan.ts) — same resolution the top-right
  // PremiumBadge uses, so the account card and the badge can never disagree.
  const planKey = resolvePlanKey(user?.plan, settings.plan) ?? 'free';
  const plan = PLAN_CONFIG[planKey] || PLAN_CONFIG.free;
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
    addToast(t('languageSelected', { lang: LANGUAGES.find((l) => l.code === language)?.label || language }), 'success');
    setShowLangMenu(false);
    setOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    addToast(t('loggedOutSuccess'), 'success');
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
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#3B82F6]/20 to-[#60A5FA]/20 border border-[#3B82F6]/10 shrink-0">
          {sessionActive ? (
            <span className="text-[10px] font-medium text-[#3B82F6]/80">
              {avatarInitials}
            </span>
          ) : (
            <User className="w-3.5 h-3.5 text-[#3B82F6]/70" />
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[12px] text-white truncate font-medium">
            {displayName}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-1 h-1 rounded-full bg-[#4ADE80]/60" />
            <span className="text-[10px] text-[#94A3B8]">
              {isOwner ? t('ownerRole') : plan.label}
            </span>
          </div>
        </div>
        <span className="text-[10px] text-[#FACC15]/60 tabular-nums shrink-0">{remainingCredits}</span>
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
                      className="h-6 w-6 flex items-center justify-center rounded-md text-[#94A3B8] hover:text-white hover:bg-white/[0.04] transition-all"
                    >
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                    </button>
                    <span className="text-[12px] font-medium text-white">{t('language')}</span>
                  </div>

                  {/* Scrollable language list with fade gradients */}
                  <div className="relative">
                    {/* Top fade gradient */}
                    <div className="absolute top-0 left-0 right-0 h-3 bg-gradient-to-b from-[#0A0D12] to-transparent z-10 pointer-events-none rounded-t-lg" />

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
                              : 'text-[#94A3B8] hover:text-slate-300 hover:bg-white/[0.03]'
                          }`}
                        >
                          <Globe className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
                          <span className="flex-1">{l.label}</span>
                          {lang === l.code && (
                            <div className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Bottom fade gradient */}
                    <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-[#0A0D12] to-transparent z-10 pointer-events-none rounded-b-lg" />
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
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#3B82F6]/20 to-[#60A5FA]/20 border border-[#3B82F6]/10 shrink-0">
                        {sessionActive ? (
                          <span className="text-[11px] font-medium text-[#3B82F6]/80">
                            {avatarInitials}
                          </span>
                        ) : (
                          <User className="w-4 h-4 text-[#3B82F6]/70" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-white truncate">
                          {sessionActive ? displayName : t('guestUser')}
                        </p>
                        <p className="text-[11px] text-[#94A3B8] truncate">
                          {sessionActive ? (displaySubtitle || ' ') : 'user@korvix.ai'}
                        </p>
                      </div>
                    </div>

                    {/* Plan Badge */}
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${plan.bg} ${plan.border} border`}>
                      <PlanIcon className={`w-3 h-3 ${plan.color}`} />
                      <span className={`text-[11px] font-medium ${plan.color}`}>{t('planBadge', { plan: plan.label })}</span>
                    </div>
                  </div>

                  {/* ─── Guest: Prominent auth actions (stacked for narrow sidebar) ─── */}
                  {!sessionActive && (
                    <div className="px-4 py-3 border-b border-white/[0.04]">
                      <div className="flex flex-col gap-1.5">
                        <button
                          onClick={() => { setOpen(false); navigate('/signup'); }}
                          className="w-full h-8 flex items-center justify-center gap-1.5 rounded-xl bg-[#3B82F6]/[0.08] text-[#3B82F6] border border-[#3B82F6]/15 text-[11px] font-medium hover:bg-[#3B82F6]/[0.12] transition-all"
                        >
                          <Sparkles className="w-3 h-3" /> {t('createAccount')}
                        </button>
                        <button
                          onClick={() => { setOpen(false); navigate('/login'); }}
                          className="w-full h-8 flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.02] text-[#CBD5E1] border border-white/[0.04] text-[11px] hover:bg-white/[0.04] hover:text-slate-300 transition-all"
                        >
                          <LogIn className="w-3 h-3" /> {t('signIn')}
                        </button>
                      </div>
                      <p className="text-[9px] text-[#94A3B8] mt-1.5 text-center">{t('syncDevices')}</p>
                    </div>
                  )}

                  {/* Credits Section — compact */}
                  <div className="px-4 py-3 border-b border-white/[0.04]">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-[#FACC15]/60" />
                        <span className="text-[11px] text-[#CBD5E1]">{t('credits')}</span>
                      </div>
                      <span className="text-[11px] font-medium text-white tabular-nums">
                        {remainingCredits} <span className="text-[#94A3B8]">/ {totalCredits}</span>
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1 bg-white/[0.03] rounded-full overflow-hidden mb-2">
                      <motion.div
                        className="h-full rounded-full bg-[#3B82F6]/40"
                        initial={{ width: 0 }}
                        animate={{ width: `${usagePercent}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      />
                    </div>

                    {/* Free chat badge */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-1 h-1 rounded-full bg-[#4ADE80]/40" />
                      <span className="text-[9px] text-[#4ADE80]/50">{t('casualChatFree')}</span>
                    </div>

                    {/* Action Buttons — stacked for narrow sidebar */}
                    <div className="flex flex-col gap-1.5">
                      <button
                        onClick={handleBuyCredits}
                        className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg bg-[#3B82F6]/[0.05] text-[#3B82F6] border border-[#3B82F6]/8 text-[11px] font-medium hover:bg-[#3B82F6]/[0.08] transition-all"
                      >
                        <CreditCard className="w-3 h-3" /> {t('buyCredits')}
                      </button>
                      <button
                        onClick={handleUpgrade}
                        className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg bg-[#FACC15]/[0.05] text-[#FACC15] border border-[#FACC15]/8 text-[11px] hover:bg-[#FACC15]/[0.08] transition-all"
                      >
                        <Crown className="w-3 h-3" /> {t('upgradePlan')}
                      </button>
                    </div>
                  </div>

                  {/* Menu Items — Phase 14F: Documentation / Community /
                      Learning Center removed (no completed destination). Only
                      real, working profile actions remain. */}
                  <div className="p-2">
                    <MenuItem icon={Settings} label={t('accountSettings')} onClick={handleSettings} />
                    <MenuItem icon={Globe} label={t('language')} onClick={handleLanguage} hasSubmenu />

                    {isAuthenticated && (
                      <div className="border-t border-white/[0.03] mt-1 pt-1">
                        <MenuItem icon={LogOut} label={t('logout')} onClick={handleLogout} danger />
                      </div>
                    )}
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
          ? 'text-[#F87171]/60 hover:text-[#F87171] hover:bg-[#F87171]/[0.04]'
          : 'text-[#94A3B8] hover:text-slate-300 hover:bg-white/[0.03]'
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${danger ? 'text-[#F87171]/40' : 'text-[#94A3B8]'}`} />
      <span className="flex-1">{label}</span>
      {hasSubmenu && <ChevronRight className="w-3 h-3 text-[#94A3B8]" />}
    </button>
  );
}
