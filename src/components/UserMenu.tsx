import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LogOut, Settings, Crown, CreditCard,
  ChevronDown, Sparkles,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

export default function UserMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  if (!user) return null;

  const initials = user.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : user.email.slice(0, 2).toUpperCase();

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    window.location.href = '/';
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg hover:bg-white/[0.03] transition-all border border-transparent hover:border-white/[0.04]"
      >
        {/* Avatar */}
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/[0.1] border border-cyan-500/15 text-[10px] font-medium text-cyan-400/80">
          {initials}
        </div>
        <div className="hidden sm:flex items-center gap-1">
          <span className="text-[11px] text-slate-400 max-w-[80px] truncate">{user.name || user.email.split('@')[0]}</span>
          <ChevronDown className={`h-3 w-3 text-slate-600 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full right-0 mt-1.5 w-56 rounded-xl border border-white/[0.06] bg-[#0e0e14] shadow-2xl overflow-hidden z-50 py-1"
          >
            {/* User info header */}
            <div className="px-3 py-2.5 border-b border-white/[0.03]">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/[0.1] border border-cyan-500/15 text-[11px] font-medium text-cyan-400/80">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-white truncate">{user.name || 'User'}</p>
                  <p className="text-[10px] text-slate-600 truncate">{user.email}</p>
                </div>
              </div>
              {/* Plan badge */}
              <div className="mt-2 flex items-center gap-1.5">
                <span className={`text-[9px] px-1.5 py-[1px] rounded-full font-medium capitalize ${
                  user.plan === 'pro' ? 'bg-amber-500/[0.08] text-amber-400 border border-amber-500/10' :
                  user.plan === 'enterprise' ? 'bg-purple-500/[0.08] text-purple-400 border border-purple-500/10' :
                  'bg-white/[0.03] text-slate-500 border border-white/[0.04]'
                }`}>
                  {user.plan === 'free' && <Sparkles className="h-2.5 w-2.5 inline mr-0.5" />}
                  {user.plan === 'pro' && <Crown className="h-2.5 w-2.5 inline mr-0.5" />}
                  {user.plan}
                </span>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <button
                onClick={() => { setOpen(false); navigate('/settings'); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] transition-all"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </button>
              <button
                onClick={() => { setOpen(false); navigate('/credits'); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] transition-all"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Credits
              </button>
            </div>

            {/* Logout */}
            <div className="border-t border-white/[0.03] py-1">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-red-400/70 hover:text-red-400 hover:bg-red-500/[0.04] transition-all"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
