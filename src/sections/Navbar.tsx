import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu, Sparkles } from 'lucide-react';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  const navLinks = [
    { label: 'Home', href: '/' },
    { label: 'Features', href: '/features' },
    { label: 'Use Cases', href: '/use-cases' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'About', href: '/about' },
  ];

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/';
    return location.pathname === href;
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <nav className="mx-3 md:mx-4 mt-3 md:mt-4 rounded-2xl glass border border-white/10 shadow-lg">
        <div className="flex h-14 items-center justify-between px-4 md:px-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg tracking-tight shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-white">KorvixAI</span>
          </Link>

          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                to={link.href}
                className={`text-sm font-medium transition-colors duration-200 ${
                  isActive(link.href)
                    ? 'text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/chat">
              <Button
                variant="ghost"
                className="text-slate-400 hover:text-white hover:bg-white/5"
              >
                Chat
              </Button>
            </Link>
            <Link to="/chat">
              <Button className="bg-white text-slate-900 hover:bg-slate-200 font-medium">
                Get Started
              </Button>
            </Link>
          </div>

          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-white/5">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-[#0a0a0f] border-white/10">
              <div className="flex flex-col gap-5 mt-8">
                {navLinks.map((link) => (
                  <Link
                    key={link.label}
                    to={link.href}
                    onClick={() => setIsOpen(false)}
                    className={`text-base font-medium transition-colors ${
                      isActive(link.href)
                        ? 'text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                <hr className="border-white/10" />
                <Link to="/chat" onClick={() => setIsOpen(false)}>
                  <Button className="w-full bg-white text-slate-900 hover:bg-slate-200 font-medium">
                    Get Started
                  </Button>
                </Link>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
