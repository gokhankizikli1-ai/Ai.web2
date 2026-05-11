import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2,
  PanelLeftClose, PanelLeftOpen,
  Crown, Clock, ArrowLeft, Search, X,
  FolderOpen, GraduationCap, Code, Rocket, Landmark, User,
} from 'lucide-react';
import type { ChatSession, ChatFolder } from '@/types';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  activeSessionId: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onMoveToFolder: (sessionId: string, folder: ChatFolder) => void;
  filteredSessions: ChatSession[];
  pinnedSessions?: string[];
}

const FOLDER_CONFIG: { id: ChatFolder; label: string; icon: typeof GraduationCap; color: string; accent: string }[] = [
  { id: 'study', label: 'Study', icon: GraduationCap, color: 'text-violet-400', accent: 'bg-violet-500/[0.06] border-violet-500/10' },
  { id: 'coding', label: 'Coding', icon: Code, color: 'text-blue-400', accent: 'bg-blue-500/[0.06] border-blue-500/10' },
  { id: 'startup', label: 'Startup', icon: Rocket, color: 'text-amber-400', accent: 'bg-amber-500/[0.06] border-amber-500/10' },
  { id: 'finance', label: 'Finance', icon: Landmark, color: 'text-emerald-400', accent: 'bg-emerald-500/[0.06] border-emerald-500/10' },
  { id: 'personal', label: 'Personal', icon: User, color: 'text-rose-400', accent: 'bg-rose-500/[0.06] border-rose-500/10' },
];

function timeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getFolderConfig(folder?: ChatFolder) {
  if (!folder || folder === 'none') return null;
  return FOLDER_CONFIG.find((f) => f.id === folder);
}

export default function Sidebar({
  isOpen, onToggle, filteredSessions, activeSessionId,
  searchQuery, onSearchChange, onSelect, onDelete, onNewChat, onMoveToFolder,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<ChatFolder | 'all'>('all');

  const displaySessions = activeFolder === 'all'
    ? filteredSessions
    : filteredSessions.filter((s) => s.folder === activeFolder);

  const renderSessionItem = (session: ChatSession) => {
    const isActive = activeSessionId === session.id;
    const isHovered = hoveredId === session.id;
    const folderCfg = getFolderConfig(session.folder);

    return (
      <div
        key={session.id}
        className="group relative"
        onMouseEnter={() => setHoveredId(session.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <motion.button
          layout
          onClick={() => onSelect(session.id)}
          className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all duration-200 ${
            isActive
              ? 'bg-white/[0.05] text-white border border-white/[0.06] shadow-[0_0_12px_-4px_rgba(255,255,255,0.03)]'
              : 'text-slate-500 hover:bg-white/[0.03] hover:text-slate-300 border border-transparent'
          }`}
        >
          {/* Folder color indicator */}
          <div className={`w-[2px] h-4 rounded-full shrink-0 transition-all ${
            isActive
              ? folderCfg ? folderCfg.accent.split(' ')[0] : 'bg-cyan-500/30'
              : 'bg-transparent'
          }`} />

          <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${
            isActive ? 'text-slate-400' : 'text-slate-700'
          }`} />

          <div className="flex-1 min-w-0">
            <div className="text-[13px] truncate">{session.title}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] text-slate-700">{timeAgo(session.updatedAt)}</span>
              {folderCfg && (
                <span className={`text-[9px] px-1 py-[1px] rounded ${folderCfg.accent} ${folderCfg.color}`}>
                  {folderCfg.label}
                </span>
              )}
            </div>
          </div>
        </motion.button>

        {/* Hover actions */}
        {(isActive || isHovered) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-[#0b0b0e]/90 backdrop-blur-sm rounded-md p-0.5"
          >
            {/* Folder dropdown */}
            <div className="relative group/folder">
              <button className="p-1 rounded text-slate-700 hover:text-cyan-400 hover:bg-cyan-500/[0.06] transition-all">
                <FolderOpen className="h-3 w-3" />
              </button>
              <div className="absolute bottom-full right-0 mb-1 hidden group-hover/folder:flex flex-col gap-0.5 rounded-lg border border-white/[0.06] bg-[#0e0e12] p-1 shadow-xl z-50 min-w-[100px]">
                {FOLDER_CONFIG.map((f) => (
                  <button
                    key={f.id}
                    onClick={(e) => { e.stopPropagation(); onMoveToFolder(session.id, f.id); }}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-all whitespace-nowrap ${f.color} hover:bg-white/[0.03]`}
                  >
                    <f.icon className="h-2.5 w-2.5" />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Delete */}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
              className="p-1 rounded text-slate-700 hover:text-red-400 hover:bg-red-500/[0.06] transition-all"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile toggle */}
      {!isOpen && (
        <div className="md:hidden fixed top-[18px] left-4 z-40">
          <Button variant="ghost" size="icon" onClick={onToggle}
            className="h-9 w-9 border border-white/[0.05] bg-[#0e0e14]/80 text-slate-500 hover:text-white hover:bg-white/[0.03] backdrop-blur-md"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col sidebar-surface transition-all duration-[300ms] ${
          isOpen ? 'w-[260px] translate-x-0' : 'w-0 -translate-x-full md:translate-x-0 md:w-0'
        }`}
      >
        {isOpen && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-white/[0.03]">
              <Link to="/" className="flex items-center gap-2 text-white hover:text-slate-300 transition-colors shrink-0">
                <ArrowLeft className="h-3.5 w-3.5 text-slate-600" />
                <span className="text-[11px] font-medium text-slate-600 uppercase tracking-wider">Exit</span>
              </Link>
              <button onClick={onToggle}
                className="h-7 w-7 flex items-center justify-center text-slate-600 hover:text-white hover:bg-white/[0.03] rounded-md transition-all"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* New Chat */}
            <div className="px-3 pt-3 pb-2">
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={onNewChat}
                className="w-full h-9 gap-2 flex items-center justify-center text-slate-300 hover:text-white bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] hover:border-cyan-500/15 rounded-lg transition-all duration-200 text-[13px] font-normal hover:shadow-[0_0_16px_-4px_rgba(34,211,238,0.06)]"
              >
                <Plus className="h-3.5 w-3.5" />
                New Chat
              </motion.button>
            </div>

            {/* Search */}
            <div className="px-3 pb-2">
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.015] border border-white/[0.04] px-3 py-1.5 focus-within:border-cyan-500/15 focus-within:bg-white/[0.02] transition-all">
                <Search className="h-3 w-3 text-slate-700" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search conversations..."
                  className="flex-1 bg-transparent text-[12px] text-white placeholder:text-slate-700 outline-none min-w-0"
                />
                {searchQuery && (
                  <button onClick={() => onSearchChange('')} className="text-slate-700 hover:text-slate-500">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Folder filter tabs with colors */}
            {!searchQuery && (
              <div className="flex items-center gap-0.5 px-3 pb-2 overflow-x-auto scrollbar-thin">
                <button
                  onClick={() => setActiveFolder('all')}
                  className={`shrink-0 rounded-md px-2 py-[2px] text-[11px] transition-all ${
                    activeFolder === 'all' ? 'bg-white/[0.06] text-white' : 'text-slate-700 hover:text-slate-500 hover:bg-white/[0.015]'
                  }`}
                >
                  All
                </button>
                {FOLDER_CONFIG.map((f) => {
                  const count = filteredSessions.filter((s) => s.folder === f.id).length;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setActiveFolder(f.id)}
                      className={`shrink-0 rounded-md px-2 py-[2px] text-[11px] transition-all flex items-center gap-1 ${
                        activeFolder === f.id
                          ? `${f.accent} ${f.color}`
                          : 'text-slate-700 hover:text-slate-500 hover:bg-white/[0.015]'
                      }`}
                    >
                      <f.icon className="h-2.5 w-2.5" />
                      {f.label}
                      {count > 0 && <span className="text-slate-800 ml-0.5">{count}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Sessions List */}
            <ScrollArea className="flex-1 px-3 py-1">
              {displaySessions.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 px-3 mb-1.5">
                    <Clock className="h-3 w-3 text-slate-800" />
                    <span className="text-[10px] font-semibold text-slate-800 uppercase tracking-wider">
                      {searchQuery ? 'Results' : activeFolder === 'all' ? 'Recent' : getFolderConfig(activeFolder)?.label || 'Chats'}
                    </span>
                  </div>
                  <div className="space-y-0.5">{displaySessions.map(renderSessionItem)}</div>
                </div>
              )}

              {displaySessions.length === 0 && (
                <div className="px-3 py-10 text-center">
                  <MessageSquare className="h-5 w-5 text-slate-800 mx-auto mb-2" />
                  <p className="text-[11px] text-slate-800">
                    {searchQuery ? 'No results found' : 'No conversations yet'}
                  </p>
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            <div className="p-3 border-t border-white/[0.03]">
              <div className="flex items-center gap-2.5 rounded-lg bg-white/[0.015] px-3 py-2 mb-2 border border-white/[0.03]">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/10">
                  <span className="text-[10px] font-medium text-cyan-400/80">Y</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-white truncate">You</div>
                  <div className="text-[10px] text-slate-700">Free Plan</div>
                </div>
              </div>
              <Button variant="ghost"
                className="w-full h-8 gap-2 text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] text-[11px] rounded-lg transition-all border border-transparent hover:border-white/[0.04]"
              >
                <Crown className="h-3.5 w-3.5" />
                Upgrade to Pro
              </Button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
