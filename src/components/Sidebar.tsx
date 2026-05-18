import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2,
  PanelLeftClose, PanelLeftOpen,
  Crown, Clock, ArrowLeft, Search, X,
  FolderOpen, GraduationCap, Code, Rocket, Landmark, User,
  Sparkles, Zap, Bot, ChevronDown,
  Palette, TrendingUp, Briefcase, Brain,
} from 'lucide-react';
import type { ChatSession, ChatFolder } from '@/types';
import DeleteConfirmModal from './DeleteConfirmModal';
import UserAccountDropdown from './UserAccountDropdown';

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
  onOpenSettings: () => void;
  onOpenUpgrade: () => void;
}

/* ═══════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════ */

const FOLDER_CONFIG = [
  { id: 'study' as ChatFolder, label: 'Study', icon: GraduationCap, color: 'text-violet-400', accent: 'bg-violet-500/[0.06] border-violet-500/10' },
  { id: 'coding' as ChatFolder, label: 'Code', icon: Code, color: 'text-blue-400', accent: 'bg-blue-500/[0.06] border-blue-500/10' },
  { id: 'startup' as ChatFolder, label: 'Startup', icon: Rocket, color: 'text-amber-400', accent: 'bg-amber-500/[0.06] border-amber-500/10' },
  { id: 'finance' as ChatFolder, label: 'Finance', icon: Landmark, color: 'text-emerald-400', accent: 'bg-emerald-500/[0.06] border-emerald-500/10' },
  { id: 'personal' as ChatFolder, label: 'Personal', icon: User, color: 'text-rose-400', accent: 'bg-rose-500/[0.06] border-rose-500/10' },
];

/* ═══════════════════════════════════════════
   COLLAPSIBLE SECTION
   ═══════════════════════════════════════════ */

function CollapsibleSection({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  icon: typeof Sparkles;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string | number;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-2 px-0.5 group transition-all"
      >
        <span className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-slate-700" />
          <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
            {title}
          </span>
          {badge !== undefined && (
            <span className="text-[9px] text-slate-800 ml-0.5">{badge}</span>
          )}
        </span>
        <motion.div
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="h-3 w-3 text-slate-700 group-hover:text-slate-500 transition-colors" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════
   WORKSPACE SHORTCUTS
   ═══════════════════════════════════════════ */

const WORKSPACE_SHORTCUTS = [
  { id: 'chat', label: 'Chat', icon: Sparkles },
  { id: 'research', label: 'Research', icon: Brain },
  { id: 'coding', label: 'Coding', icon: Code },
  { id: 'trading', label: 'Trading', icon: TrendingUp },
  { id: 'business', label: 'Business', icon: Briefcase },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'startup', label: 'Startup', icon: Rocket },
  { id: 'creative', label: 'Creative', icon: Palette },
];

/* ═══════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════ */

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getFolderCfg(folder?: ChatFolder) {
  if (!folder || folder === 'none') return null;
  return FOLDER_CONFIG.find((f) => f.id === folder);
}

/* ═══════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════ */

export default function Sidebar({
  isOpen, onToggle, filteredSessions, activeSessionId,
  searchQuery, onSearchChange, onSelect, onDelete, onNewChat, onMoveToFolder,
  onOpenSettings, onOpenUpgrade,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<ChatFolder | 'all'>('all');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const displaySessions = activeFolder === 'all'
    ? filteredSessions
    : filteredSessions.filter((s) => s.folder === activeFolder);

  const switchWorkspace = (id: string) => {
    window.dispatchEvent(new CustomEvent('korvix-switch-workspace', { detail: id }));
  };

  /* ─── Session row ─── */
  const SessionRow = ({ session }: { session: ChatSession }) => {
    const active = activeSessionId === session.id;
    const hovered = hoveredId === session.id;
    const fc = getFolderCfg(session.folder);

    return (
      <div
        className="group/row relative"
        onMouseEnter={() => setHoveredId(session.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <button
          onClick={() => onSelect(session.id)}
          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-left transition-all duration-200 ${
            active
              ? 'bg-white/[0.04] text-white border border-white/[0.06] shadow-[0_0_12px_-4px_rgba(34,211,238,0.04)]'
              : 'text-slate-600 hover:bg-white/[0.025] hover:text-slate-300 border border-transparent'
          }`}
        >
          {/* Active indicator */}
          <div className={`w-[3px] h-[3px] rounded-full shrink-0 transition-all duration-300 ${
            active ? 'bg-cyan-400/50 scale-100' : 'bg-transparent scale-0'
          }`} />

          <MessageSquare className={`h-3 w-3 shrink-0 transition-colors ${active ? 'text-slate-400' : 'text-slate-700'}`} />

          <div className="flex-1 min-w-0">
            <p className={`text-[12px] truncate leading-tight ${active ? 'text-white' : ''}`}>
              {session.title}
            </p>
            <div className="flex items-center gap-1.5 mt-[2px]">
              <span className="text-[10px] text-slate-700">{timeAgo(session.updatedAt)}</span>
              {fc && (
                <span className={`text-[9px] px-1 py-[1px] rounded ${fc.accent} ${fc.color}`}>
                  {fc.label}
                </span>
              )}
            </div>
          </div>
        </button>

        {/* Hover actions */}
        {(active || hovered) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-[#0b0b0e]/95 backdrop-blur-sm rounded-md p-0.5 z-10"
          >
            <div className="relative group/folder">
              <button className="p-1 rounded text-slate-700 hover:text-cyan-400 hover:bg-cyan-500/[0.06] transition-all">
                <FolderOpen className="h-3 w-3" />
              </button>
              <div className="absolute bottom-full right-0 mb-1 hidden group-hover/folder:flex flex-col gap-0.5 rounded-lg border border-white/[0.06] bg-[#0e0e12] p-1 shadow-xl z-50 min-w-[100px]">
                {FOLDER_CONFIG.map((f) => (
                  <button
                    key={f.id}
                    onClick={(e) => { e.stopPropagation(); onMoveToFolder(session.id, f.id); }}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${f.color} hover:bg-white/[0.03]`}
                  >
                    <f.icon className="h-2.5 w-2.5" /> {f.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(session.id); }}
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
        <div className="lg:hidden fixed top-[14px] left-3 z-40">
          <button
            onClick={onToggle}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[0.05] bg-[#0e0e14]/80 text-slate-600 hover:text-white hover:bg-white/[0.03] backdrop-blur-md transition-all"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Mobile overlay */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onToggle} />
      )}

      {/* ═══ SIDEBAR ═══ */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-[#0b0b0e] border-r border-white/[0.03] transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ width: 240 }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-3 h-10 border-b border-white/[0.03]">
          <Link to="/" className="flex items-center gap-2 text-white hover:text-slate-300 transition-colors">
            <ArrowLeft className="h-3 w-3 text-slate-600" />
            <span className="text-[11px] font-medium text-slate-600 uppercase tracking-wider">Exit</span>
          </Link>
          <button
            onClick={onToggle}
            className="h-6 w-6 flex items-center justify-center text-slate-600 hover:text-white hover:bg-white/[0.03] rounded transition-all"
          >
            <PanelLeftClose className="h-3 w-3" />
          </button>
        </div>

        {/* New Chat */}
        <div className="shrink-0 px-3 pt-3 pb-2">
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onNewChat}
            className="w-full h-8 gap-1.5 flex items-center justify-center text-slate-300 hover:text-white bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] hover:border-cyan-500/15 rounded-lg transition-all text-[12px]"
          >
            <Plus className="h-3.5 w-3.5" /> New Chat
          </motion.button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg bg-white/[0.015] border border-white/[0.04] px-2.5 py-1.5 focus-within:border-cyan-500/15 focus-within:bg-white/[0.02] transition-all">
            <Search className="h-3 w-3 text-slate-700 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search..."
              className="flex-1 bg-transparent text-[12px] text-white placeholder:text-slate-700 outline-none min-w-0"
            />
            {searchQuery && (
              <button onClick={() => onSearchChange('')} className="text-slate-700 hover:text-slate-500 shrink-0">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* ═── Main scrollable content ─══ */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-3 pb-3">

            {/* ─── Workspaces: collapsible ─── */}
            {!searchQuery && (
              <CollapsibleSection title="Workspaces" icon={Zap} defaultOpen={false}>
                <div className="grid grid-cols-4 gap-1 pb-1">
                  {WORKSPACE_SHORTCUTS.map((ws) => (
                    <button
                      key={ws.id}
                      onClick={() => switchWorkspace(ws.id)}
                      title={ws.label}
                      className="flex flex-col items-center gap-[3px] rounded-lg py-1.5 px-1 bg-white/[0.015] hover:bg-white/[0.03] border border-white/[0.02] hover:border-white/[0.05] transition-all"
                    >
                      <ws.icon className="h-3 w-3 text-slate-600" />
                      <span className="text-[8px] text-slate-700">{ws.label}</span>
                    </button>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* ─── Folder tabs ─── */}
            {!searchQuery && (
              <div className="flex items-center gap-0.5 py-1 overflow-x-auto scrollbar-thin">
                <button
                  onClick={() => setActiveFolder('all')}
                  className={`shrink-0 rounded-md px-1.5 py-[2px] text-[10px] transition-all ${
                    activeFolder === 'all' ? 'bg-white/[0.06] text-slate-300' : 'text-slate-700 hover:text-slate-500 hover:bg-white/[0.015]'
                  }`}
                >
                  All
                </button>
                {FOLDER_CONFIG.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setActiveFolder(f.id)}
                    className={`shrink-0 rounded-md px-1.5 py-[2px] text-[10px] transition-all flex items-center gap-1 ${
                      activeFolder === f.id ? `${f.accent} ${f.color}` : 'text-slate-700 hover:text-slate-500 hover:bg-white/[0.015]'
                    }`}
                  >
                    <f.icon className="h-2.5 w-2.5" />
                    {f.label}
                  </button>
                ))}
              </div>
            )}

            {/* ─── Recent Chats: collapsible ─── */}
            <CollapsibleSection
              title="Recent"
              icon={Clock}
              defaultOpen={true}
              badge={filteredSessions.length}
            >
              {displaySessions.length > 0 ? (
                <div className="space-y-[1px]">
                  {displaySessions.map((s) => (
                    <SessionRow key={s.id} session={s} />
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center">
                  <MessageSquare className="h-4 w-4 text-slate-800 mx-auto mb-1.5" />
                  <p className="text-[11px] text-slate-800">No conversations yet</p>
                  <p className="text-[10px] text-slate-800 mt-0.5">Start a new chat</p>
                </div>
              )}
            </CollapsibleSection>

          </div>
        </ScrollArea>

        {/* ═── Footer ─══ */}
        <div className="shrink-0 p-3 border-t border-white/[0.03]">
          <UserAccountDropdown onOpenSettings={onOpenSettings} onOpenUpgrade={onOpenUpgrade} />

          <Button
            variant="ghost"
            onClick={onOpenUpgrade}
            className="w-full h-7 gap-1.5 mt-2 text-[11px] text-slate-600 hover:text-amber-300 hover:bg-amber-500/[0.04] rounded-lg transition-all border border-transparent hover:border-amber-500/10"
          >
            <Crown className="h-3 w-3" />
            Upgrade to Pro
          </Button>
        </div>
      </aside>

      {/* Delete confirmation */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Conversation"
        description="This conversation and all its messages will be permanently deleted."
        onConfirm={() => { if (deleteTarget) onDelete(deleteTarget); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
