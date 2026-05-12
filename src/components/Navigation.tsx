import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, LayoutGrid, Bot, Wrench, Compass,
  ChevronDown, Sparkles, Settings, Crown,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import CreditDisplay from './CreditDisplay';

interface NavItem {
  id: string;
  label: string;
  icon: typeof MessageSquare;
  path: string;
  badge?: string;
  children?: { id: string; label: string; path: string }[];
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'chat', label: 'Chat', icon: MessageSquare, path: '/chat',
    children: [
      { id: 'research', label: 'Research', path: '/chat?tab=research' },
      { id: 'study', label: 'Study', path: '/chat?tab=study' },
      { id: 'creative', label: 'Creative', path: '/chat?tab=creative' },
    ],
  },
  {
    id: 'workspace', label: 'Workspace', icon: LayoutGrid, path: '/workspace',
    children: [
      { id: 'startup', label: 'Startup Hub', path: '/startup' },
      { id: 'ecommerce', label: 'Ecommerce OS', path: '/ecommerce' },
      { id: 'trading', label: 'Trading', path: '/chat?tab=trading' },
      { id: 'business', label: 'Business', path: '/chat?tab=business' },
    ],
  },
  { id: 'agents', label: 'Agents', icon: Bot, path: '/agents', badge: '8' },
  { id: 'tools', label: 'Tools', icon: Wrench, path: '/tools' },
  { id: 'explore', label: 'Explore', icon: Compass, path: '/explore' },
];

export default function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  useApp(); // settings context available
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setActiveDropdown(null);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Close dropdown on route change
  useEffect(() => {
    setActiveDropdown(null);
  }, [location.pathname]);

  const isActive = (item: NavItem) => {
    if (location.pathname === item.path) return true;
    if (item.children?.some((c) => location.pathname === c.path.split('?')[0])) return true;
    return false;
  };

  return (
    <nav className="flex items-center h-11 px-3 border-b border-white/[0.02] bg-[#0a0a0a]/60 backdrop-blur-xl shrink-0 z-50">
      {/* Logo */}
      <button onClick={() => navigate('/')} className="flex items-center gap-2 mr-4 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/[0.1] border border-cyan-500/15">
          <Sparkles className="h-3.5 w-3.5 text-cyan-400/80" />
        </div>
        <span className="text-[14px] font-semibold text-white tracking-tight hidden sm:inline">Korvix</span>
      </button>

      {/* Nav items */}
      <div ref={dropdownRef} className="flex items-center gap-0.5 flex-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const hasChildren = !!item.children;
          const dropdownOpen = activeDropdown === item.id;

          return (
            <div key={item.id} className="relative">
              <button
                onClick={() => {
                  if (hasChildren) {
                    setActiveDropdown(dropdownOpen ? null : item.id);
                  } else {
                    navigate(item.path);
                  }
                }}
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-normal transition-all duration-200 ${
                  active ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="navActive"
                    className="absolute inset-0 bg-white/[0.06] rounded-lg border border-white/[0.08]"
                    transition={{ type: 'spring', duration: 0.4, bounce: 0.1 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <item.icon className={`h-3.5 w-3.5 ${active ? 'text-cyan-400/70' : ''}`} />
                  <span className="hidden md:inline">{item.label}</span>
                  {item.badge && (
                    <span className="text-[9px] px-1 py-[1px] rounded bg-cyan-500/[0.1] text-cyan-400/60 font-mono">{item.badge}</span>
                  )}
                  {hasChildren && <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />}
                </span>
              </button>

              {/* Dropdown */}
              <AnimatePresence>
                {hasChildren && dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.97 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute top-full left-0 mt-1.5 w-44 rounded-xl border border-white/[0.06] bg-[#0e0e14] shadow-2xl overflow-hidden z-50 py-1"
                  >
                    {item.children?.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => { navigate(child.path); setActiveDropdown(null); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] transition-all"
                      >
                        {child.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="hidden sm:block">
          <CreditDisplay />
        </div>
        <button onClick={() => navigate('/settings')} className="h-7 w-7 flex items-center justify-center text-slate-600 hover:text-amber-400 hover:bg-amber-500/[0.06] rounded-md transition-all border border-white/[0.04]">
          <Settings className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => navigate('/upgrade')} className="hidden sm:flex items-center gap-1 rounded-md bg-white/[0.03] border border-white/[0.05] px-2 py-1 text-[11px] text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all">
          <Crown className="h-3 w-3" />
          <span>Pro</span>
        </button>
      </div>
    </nav>
  );
}
