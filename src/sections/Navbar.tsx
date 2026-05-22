import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu, Sparkles, Rocket, ShoppingBag, TrendingUp, Code, Cpu, LayoutDashboard, LogOut } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';

const NAV_LINKS = [
  { label: 'Features', href: '/#features', icon: Code },
  { label: 'Startup', href: '/#startup', icon: Rocket },
  { label: 'Ecommerce', href: '/#ecommerce', icon: ShoppingBag },
  { label: 'Trading', href: '/#trading', icon: TrendingUp },
  { label: 'Agents', href: '/#agents', icon: Cpu },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const { isAuthenticated, user, logout } = useAuthStore();

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
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/80 backdrop-blur-xl border-b border-slate-200/60'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/[0.08] border border-cyan-100 group-hover:bg-cyan-500/[0.12] transition-all">
              <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
            </div>
            <span className="text-[15px] font-bold tracking-tight text-foreground">KorvixAI</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.href}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                  isActive(link.href)
                    ? 'text-slate-900 bg-slate-100'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
                }`}
              >
                {link.label}
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
                    className="text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-[13px] gap-1.5 h-8"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Workspace
                  </Button>
                </Link>
                <div className="flex items-center gap-2 pl-2.5 border-l border-border">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-50 border border-cyan-100">
                    <span className="text-[10px] font-semibold text-cyan-600">
                      {(user?.name || 'U').slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-[12px] text-slate-600 max-w-[80px] truncate">{user?.name || 'You'}</span>
                </div>
              </>
            ) : (
              <>
                <Link to="/login">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-600 hover:text-slate-900 hover:bg-slate-100/60 text-[13px] h-8"
                  >
                    Sign In
                  </Button>
                </Link>
                <Link to="/signup">
                  <Button
                    size="sm"
                    className="bg-[#1B2230] text-white hover:bg-[#202736] font-semibold text-[13px] h-8 px-4 rounded-lg border border-white/[0.08] shadow-sm transition-all duration-200"
                  >
                    Get Started
                  </Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground h-8 w-8">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-card border-border">
              <div className="flex flex-col gap-1 mt-8">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.label}
                    to={link.href}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      isActive(link.href)
                        ? 'text-slate-900 bg-slate-100'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
                    }`}
                  >
                    <link.icon className="h-4 w-4" />
                    {link.label}
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
                        Sign In
                      </Button>
                    </Link>
                    <Link to="/signup" onClick={() => setIsOpen(false)}>
                      <Button variant="outline" className="w-full border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 font-semibold rounded-xl h-10 bg-white">
                        Get Started
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
