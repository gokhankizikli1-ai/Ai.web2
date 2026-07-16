import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu, Rocket, Wand2, Code, Cpu, LayoutDashboard, LogOut } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import BrandLogo from '@/components/BrandLogo';

// Public nav — matches the Web-Build-first landing story (Phase 14J.2). Each
// href is an anchor into a real landing section id; labels resolve through t().
const NAV_LINKS = [
  { key: 'navProduct', href: '/#product', icon: Code },
  { key: 'navVisualEdit', href: '/#visual-edit', icon: Wand2 },
  { key: 'navHowItWorks', href: '/#how', icon: Cpu },
  { key: 'navResearch', href: '/#research', icon: Rocket },
];

/**
 * Which page surface the shared Navbar sits on. This drives every
 * surface-dependent color (logo tone, nav text, auth controls, scrolled
 * background, borders, mobile trigger) from ONE place so the same component
 * reads correctly on both the porcelain landing and the dark public pages.
 *
 *   'light' (default) → the original porcelain landing styling, UNCHANGED.
 *   'dark'            → readable on the dark public pages (About + legal).
 */
export type NavbarSurface = 'light' | 'dark';

export default function Navbar({ surface = 'light' }: { surface?: NavbarSurface }) {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const { isAuthenticated, user, logout } = useAuthStore();
  const { t } = useLanguageStore();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/';
    return location.pathname === href;
  };

  // Centralized surface tokens. The `light` values are byte-identical to the
  // original single-surface Navbar, so the landing appearance is preserved
  // exactly; `dark` supplies light-on-dark equivalents for the dark pages.
  const isDark = surface === 'dark';
  const s = {
    logoTone: (isDark ? 'onDark' : 'onLight') as 'onLight' | 'onDark',
    scrolled: isDark
      ? 'bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/[0.08]'
      : 'bg-white/80 backdrop-blur-xl border-b border-slate-200/60',
    navActive: isDark ? 'text-white bg-white/10' : 'text-slate-900 bg-slate-100',
    navIdle: isDark
      ? 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60',
    ghost: isDark
      ? 'text-slate-300 hover:text-white hover:bg-white/10'
      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
    ghostSubtle: isDark
      ? 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60',
    divider: isDark ? 'border-white/10' : 'border-border',
    avatarWrap: isDark ? 'bg-white/10 border-white/15' : 'bg-[#EEF1F4] border-[#DDE3EA]',
    avatarText: isDark ? 'text-slate-100' : 'text-[#52677A]',
    userName: isDark ? 'text-slate-300' : 'text-slate-600',
    trigger: isDark ? 'text-slate-200 hover:text-white' : 'text-muted-foreground hover:text-foreground',
  };

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? s.scrolled : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Shared Korvix logo — wordmark tone follows the page surface */}
          <Link to="/" className="group">
            <BrandLogo tone={s.logoTone} wordSize={17} />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.key}
                to={link.href}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                  isActive(link.href) ? s.navActive : s.navIdle
                }`}
              >
                {t(link.key)}
              </Link>
            ))}
          </nav>

          {/* Right Side — Auth CTAs */}
          <div className="hidden md:flex items-center gap-2.5">
            {isAuthenticated ? (
              <>
                <Link to="/workspace">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`${s.ghost} text-[13px] gap-1.5 h-8`}
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Workspace
                  </Button>
                </Link>
                <div className={`flex items-center gap-2 pl-2.5 border-l ${s.divider}`}>
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full border ${s.avatarWrap}`}>
                    <span className={`text-[10px] font-semibold ${s.avatarText}`}>
                      {(user?.name || 'U').slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <span className={`text-[12px] ${s.userName} max-w-[80px] truncate`}>{user?.name || 'You'}</span>
                </div>
              </>
            ) : (
              <>
                <Link to="/login">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`${s.ghostSubtle} text-[13px] h-8`}
                  >
                    {t('signIn')}
                  </Button>
                </Link>
                <Link to="/signup">
                  <Button
                    size="sm"
                    className="bg-[#1B2230] text-white hover:bg-[#202736] font-semibold text-[13px] h-8 px-4 rounded-lg border border-white/[0.08] shadow-sm transition-all duration-200"
                  >
                    {t('ctaStartBuilding')}
                  </Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button
                variant="ghost"
                size="icon"
                className={`${s.trigger} h-8 w-8`}
                aria-label={isOpen ? t('menuClose') : t('menuOpen')}
              >
                <Menu aria-hidden="true" className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-card border-border">
              <div className="flex flex-col gap-1 mt-8">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.key}
                    to={link.href}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      isActive(link.href)
                        ? 'text-slate-900 bg-slate-100'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
                    }`}
                  >
                    <link.icon aria-hidden="true" className="h-4 w-4" />
                    {t(link.key)}
                  </Link>
                ))}
                <hr className="border-border my-2" />
                {isAuthenticated ? (
                  <>
                    <Link to="/workspace" onClick={() => setIsOpen(false)}>
                      <Button className="w-full bg-[#1B2230] text-white hover:bg-[#202736] font-semibold rounded-xl mb-2 gap-2 h-10 border border-white/[0.08]">
                        <LayoutDashboard className="h-4 w-4" />
                        Workspace
                      </Button>
                    </Link>
                    <button
                      onClick={() => { logout(); setIsOpen(false); }}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <LogOut className="h-4 w-4" /> Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <Link to="/login" onClick={() => setIsOpen(false)}>
                      <Button className="w-full bg-[#1B2230] text-white hover:bg-[#202736] font-semibold rounded-xl mb-2 h-10 border border-white/[0.08]">
                        {t('signIn')}
                      </Button>
                    </Link>
                    <Link to="/signup" onClick={() => setIsOpen(false)}>
                      <Button variant="outline" className="w-full border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 font-semibold rounded-xl h-10 bg-white">
                        {t('ctaStartBuilding')}
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </motion.header>
  );
}
