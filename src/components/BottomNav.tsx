import { useNavigate, useLocation } from 'react-router';
import { motion } from 'framer-motion';
import {
  MessageSquare, LayoutGrid, Bot, Wrench, Compass,
} from 'lucide-react';

const ITEMS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, path: '/chat' },
  { id: 'workspace', label: 'Work', icon: LayoutGrid, path: '/workspace' },
  { id: 'agents', label: 'Agents', icon: Bot, path: '/agents' },
  { id: 'tools', label: 'Tools', icon: Wrench, path: '/tools' },
  { id: 'explore', label: 'Explore', icon: Compass, path: '/explore' },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-[#0a0a0a]/80 backdrop-blur-xl border-t border-white/[0.03] sm:hidden">
      <div className="flex items-center justify-around h-full max-w-lg mx-auto px-2">
        {ITEMS.map((item) => {
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path);
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className="relative flex flex-col items-center justify-center gap-0.5 w-14 h-14"
            >
              {isActive && (
                <motion.div
                  layoutId="bottomNavActive"
                  className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-0.5 bg-cyan-400 rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <item.icon
                className={`w-[18px] h-[18px] transition-colors ${
                  isActive ? 'text-cyan-400' : 'text-slate-600'
                }`}
              />
              <span
                className={`text-[10px] font-medium transition-colors ${
                  isActive ? 'text-cyan-400' : 'text-slate-600'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
