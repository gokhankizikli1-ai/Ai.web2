import { useNavigate, useLocation } from 'react-router';
import { motion } from 'framer-motion';
import {
  MessageSquare, Compass, FolderOpen, Bot,
} from 'lucide-react';

const ITEMS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, path: '/chat' },
  { id: 'projects', label: 'Projects', icon: FolderOpen, path: '/projects' },
  { id: 'agents', label: 'Agents', icon: Bot, path: '/agents' },
  { id: 'explore', label: 'Explore', icon: Compass, path: '/explore' },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  // Determine active item based on current route
  const getActiveId = () => {
    if (pathname === '/chat' || pathname.startsWith('/chat')) return 'chat';
    if (pathname === '/projects' || pathname.startsWith('/projects')) return 'projects';
    if (pathname === '/agents' || pathname.startsWith('/agents')) return 'agents';
    if (pathname === '/explore') return 'explore';
    return 'chat';
  };

  const activeId = getActiveId();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a]/85 backdrop-blur-2xl border-t border-white/[0.03] sm:hidden safe-area-pb">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {ITEMS.map((item) => {
          const isActive = activeId === item.id;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className="relative flex flex-col items-center justify-center gap-1 w-16 h-14 active:scale-95 transition-transform"
            >
              {/* Active indicator */}
              {isActive && (
                <motion.div
                  layoutId="bottomNavActive"
                  className="absolute -top-px left-1/2 -translate-x-1/2 w-6 h-0.5 bg-[#8B5CF6] rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              {/* Subtle glow for active */}
              {isActive && (
                <div className="absolute inset-1 rounded-xl bg-[#8B5CF6]/[0.04]" />
              )}
              <item.icon
                className={`w-[18px] h-[18px] transition-colors relative z-10 ${
                  isActive ? 'text-[#8B5CF6]' : 'text-[#858B99]'
                }`}
              />
              <span
                className={`text-[10px] font-medium transition-colors relative z-10 ${
                  isActive ? 'text-[#8B5CF6]' : 'text-[#858B99]'
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
