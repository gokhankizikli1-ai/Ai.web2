import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu, Sparkles, Rocket, ShoppingBag, TrendingUp, Code, Cpu, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';

const NAV_LINKS = [
  { label: 'Workspace', href: '/workspace', icon: Code },
  { label: 'Agents', href: '/agents', icon: Cpu },
  { label: 'Startup OS', href: '/startup', icon: Rocket },
  { label: 'Ecommerce', href: '/ecommerce', icon: ShoppingBag },
  { label: 'Trading', href: '/chat?tab=trading', icon: TrendingUp },
  { label: 'Pricing', href: '/pricing', icon: null },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  // Real signed-in users only — guests have provider === 'guest' and
  // isAuthenticated === false, so they keep the marketing CTAs.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const userInitials = (user?.name || user?.email || 'U').slice(0, 2).toUpperCase();
  const userLabel = user?.name || user?.email?.split('@')[0] || 'Account';

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/';
    return location.pathname === href;
  };

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' as const }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <nav
        className={`mx-3 md:mx-6 mt-3 md:mt-4 rounded-2xl border border-white/[0.08] shadow-lg transition-all duration-300 ${
          scrolled
            ? 'bg-[#0a0a0f]/80 backdrop-blur-2xl shadow-black/20'
            : 'bg-[#0a0a0f]/40 backdrop-blur-xl'
        }`}
        style={{
          boxShadow: scrolled
            ? '0 4px 30px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)'
            : '0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
      >
        <div className={`flex items-center justify-between px-4 md:px-6 transition-all duration-300 ${scrolled ? 'h-12' : 'h-14'}`}>
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 font-bold text-lg tracking-tight shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-white">KorvixAI</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.href}
                className={`relative px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                  isActive(link.href)
                    ? 'text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {link.label}
                {isActive(link.href) && (
                  <motion.div
                    layoutId="navActive"
                    className="absolute inset-0 rounded-lg bg-white/[0.06] border border-white/[0.08]"
                    style={{ zIndex: -1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </Link>
            ))}
          </div>

          {/* Right Side — Auth CTAs (signed-out) OR Workspace shortcut (signed-in) */}
          <div className="hidden md:flex items-center gap-2.5">
            {isAuthenticated ? (
              <>
                <Link
                  to="/chat"
                  title={userLabel}
                  className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.12] px-2.5 py-1.5 transition-all duration-200"
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/15 shrink-0">
                    <span className="text-[10px] font-semibold text-cyan-300">{userInitials}</span>
                  </div>
                  <span className="text-[12px] font-medium text-slate-200 max-w-[140px] truncate">{userLabel}</span>
                </Link>
                <Link to="/chat">
                  <Button className="bg-white text-slate-900 hover:bg-slate-200 font-semibold text-[13px] h-9 px-4 rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_-5px_rgba(255,255,255,0.15)]">
                    Open Workspace
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Link to="/login">
                  <Button
                    variant="ghost"
                    className="text-slate-400 hover:text-white hover:bg-white/5 text-[13px]"
                  >
                    Sign In
                  </Button>
                </Link>
                <Link to="/signup">
                  <Button className="bg-white text-slate-900 hover:bg-slate-200 font-semibold text-[13px] h-9 px-4 rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_-5px_rgba(255,255,255,0.15)]">
                    Create Account
                  </Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-white/5">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-[#0a0a0f] border-white/10">
              <div className="flex flex-col gap-2 mt-8">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.label}
                    to={link.href}
                    onClick={() => setIsOpen(false)}
                    className={`px-3 py-2.5 rounded-xl text-base font-medium transition-colors ${
                      isActive(link.href)
                        ? 'text-white bg-white/[0.06]'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.03]'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                <hr className="border-white/10 my-2" />
                {isAuthenticated ? (
                  <>
                    <div className="flex items-center gap-2.5 px-3 py-2 mb-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/15 shrink-0">
                        <span className="text-[11px] font-semibold text-cyan-300">{userInitials}</span>
                      </div>
                      <span className="text-[13px] font-medium text-slate-200 truncate">{userLabel}</span>
                    </div>
                    <Link to="/chat" onClick={() => setIsOpen(false)}>
                      <Button className="w-full bg-white text-slate-900 hover:bg-slate-200 font-semibold rounded-xl">
                        Open Workspace
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <Link to="/login" onClick={() => setIsOpen(false)}>
                      <Button className="w-full bg-white text-slate-900 hover:bg-slate-200 font-semibold rounded-xl mb-2">
                        Sign In
                      </Button>
                    </Link>
                    <Link to="/signup" onClick={() => setIsOpen(false)}>
                      <Button variant="outline" className="w-full border-white/15 text-white hover:bg-white/[0.04] font-semibold rounded-xl">
                        Create Account
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </motion.header>
  );
}
