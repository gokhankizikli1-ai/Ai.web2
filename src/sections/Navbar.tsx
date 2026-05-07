import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu, Sparkles } from 'lucide-react';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const navLinks = [
    { label: 'Features', href: '#features' },
    { label: 'Use Cases', href: '#use-cases' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'Testimonials', href: '#testimonials' },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <nav className="mx-4 mt-4 rounded-2xl glass border border-white/10 shadow-lg">
        <div className="flex h-14 items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-white">Velora AI</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm font-medium text-slate-300 hover:text-white transition-colors duration-200"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Button
              variant="ghost"
              className="text-slate-300 hover:text-white hover:bg-white/5"
              onClick={() => navigate('/chat')}
            >
              Log In
            </Button>
            <Button
              className="bg-white text-slate-900 hover:bg-slate-200 font-medium"
              onClick={() => navigate('/chat')}
            >
              Get Started
            </Button>
          </div>

          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon" className="text-slate-300 hover:text-white hover:bg-white/5">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-[#0a0a0f] border-white/10">
              <div className="flex flex-col gap-6 mt-8">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={() => setIsOpen(false)}
                    className="text-base font-medium text-slate-300 hover:text-white transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
                <hr className="border-white/10" />
                <Button
                  className="w-full bg-white text-slate-900 hover:bg-slate-200 font-medium"
                  onClick={() => {
                    setIsOpen(false);
                    navigate('/chat');
                  }}
                >
                  Get Started
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
