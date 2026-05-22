import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2,
  PanelLeftClose, PanelLeftOpen,
  Crown, ArrowLeft, Search, X,
  LogIn, Sparkles, FolderOpen,
  Bot,
} from 'lucide-react';
import type { ChatSession, ChatFolder } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
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
  onMoveToFolder?: (sessionId: string, folder: ChatFolder) => void;
  filteredSessions: ChatSession[];
  onOpenSettings: () => void;
  onOpenUpgrade: () => void;
}

/* ═══════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════ */

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ═══════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════ */

export default function Sidebar({
  isOpen, onToggle, filteredSessions, activeSessionId,
  searchQuery, onSearchChange, onSelect, onDelete, onNewChat,
  onOpenSettings, onOpenUpgrade,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { isAuthenticated } = useAuthStore();
  const { t } = useLanguageStore();
  const navigate = useNavigate();

  const displaySessions = filteredSessions;

  /* ─── Session row ─── */
  const SessionRow = ({ session }: { session: ChatSession }) => {
    const active = activeSessionId === session.id;
    const hovered = hoveredId === session.id;

    return (
      <div
        className="group/row relative"
        onMouseEnter={() => setHoveredId(session.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <button
          onClick={() => onSelect(session.id)}
          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-[6px] text-left transition-all duration-200 border ${
            active
              ? 'border-white/[0.06] shadow-[0_0_12px_-4px_rgba(34,211,238,0.04)]'
              : 'border-transparent hover:border-white/[0.03]'
          }`}
          style={active
            ? { background: 'rgba(255,255,255,0.04)', color: '#E2E8F0' }
            : { color: 'rgba(148,163,184,0.4)' }
          }
        >
          {/* Active indicator dot */}
          <div className={`w-[3px] h-[3px] rounded-full shrink-0 transition-all duration-300 ${
            active ? 'bg-cyan-400/50 scale-100' : 'bg-transparent scale-0'
          }`} />

          <MessageSquare className={`h-2.5 w-2.5 shrink-0 transition-colors ${active ? 'text-white/40' : 'text-white/20'}`} />

          <div className="flex-1 min-w-0">
            <p className={`text-[11px] truncate leading-tight ${active ? 'text-white/80 font-medium' : 'text-white/50'}`}>
              {session.title}
            </p>
            <span className="text-[9px] text-white/20">{timeAgo(session.updatedAt)}</span>
          </div>
        </button>

        {/* Hover actions */}
        {(active || hovered) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-md p-0.5 z-10"
            style={{ background: 'rgba(23,28,36,0.95)', backdropFilter: 'blur(8px)' }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(session.id); }}
              className="p-1 rounded text-white/30 hover:text-red-400 hover:bg-red-500/[0.06] transition-all"
            >
              <Trash2 className="h-2.5 w-2.5" />
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
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.04] backdrop-blur-md transition-all"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Mobile overlay */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onToggle} />
      )}

      {/* ═══ SIDEBAR ═══ */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          width: 260,
          background: 'rgba(17,21,28,0.96)',
          backdropFilter: 'blur(12px) saturate(1.1)',
          borderRight: '1px solid rgba(255,255,255,0.035)',
        }}
      >
        {/* ═── Header ─══ */}
        <div className="shrink-0 flex items-center justify-between px-3 h-9" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <Link to="/" className="flex items-center gap-1.5 transition-colors text-white/30 hover:text-white/60">
            <ArrowLeft className="h-3 w-3" />
            <span className="text-[10px] font-medium uppercase tracking-wider">Home</span>
          </Link>
          <button
            onClick={onToggle}
            className="h-6 w-6 flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.04] rounded transition-all"
          >
            <PanelLeftClose className="h-3 w-3" />
          </button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-3 py-3 space-y-3">

            {/* ═══ 1. PROJECTS NAVIGATION ═══ */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate('/projects')}
              className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg transition-all duration-200 group"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)';
              }}
            >
              <div
                className="flex h-6 w-6 items-center justify-center rounded-md shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(34,211,238,0.15) 0%, rgba(59,130,246,0.15) 100%)',
                  boxShadow: '0 0 8px rgba(34,211,238,0.08), inset 0 1px 0 rgba(255,255,255,0.06)',
                }}
              >
                <FolderOpen className="h-3 w-3 text-cyan-400/70" />
              </div>
              <span className="text-[12px] font-medium text-white/60 group-hover:text-white/90 transition-colors">Projects</span>
              <div className="ml-auto flex items-center gap-0.5 text-white/15 group-hover:text-white/30 transition-colors">
                <span className="text-[9px]">Workspaces</span>
              </div>
            </motion.button>

            {/* ═══ 1.5. AGENTS ═══ */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate('/agents')}
              className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg transition-all duration-200 group"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)';
              }}
            >
              <div
                className="flex h-6 w-6 items-center justify-center rounded-md shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.15) 100%)',
                  boxShadow: '0 0 8px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.06)',
                }}
              >
                <Bot className="h-3 w-3 text-indigo-400/70" />
              </div>
              <span className="text-[12px] font-medium text-white/60 group-hover:text-white/90 transition-colors">Agents</span>
            </motion.button>

            {/* ═══ 2. NEW CHAT ═══ */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onNewChat}
              className="w-full h-8 gap-1.5 flex items-center justify-center text-white/50 hover:text-white/80 rounded-lg transition-all text-[12px]"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px dashed rgba(255,255,255,0.08)',
              }}
            >
              <Plus className="h-3.5 w-3.5" /> {t('newChat')}
            </motion.button>

            {/* ═══ 3. SEARCH ═══ */}
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <Search className="h-3 w-3 text-white/20 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t('searchChats')}
                className="flex-1 bg-transparent text-[11px] outline-none min-w-0 placeholder:text-white/20"
                style={{ color: '#CBD5E1' }}
              />
              {searchQuery && (
                <button onClick={() => onSearchChange('')} className="shrink-0 text-white/20 hover:text-white/40">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* ═══ 4. RECENT CHATS ═══ */}
            <div>
              <div className="flex items-center justify-between py-1.5 px-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-px bg-white/10" />
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-white/25">{t('recent')}</span>
                </div>
                <span className="text-[9px] text-white/15">{displaySessions.length}</span>
              </div>

              {displaySessions.length > 0 ? (
                <div className="space-y-[1px] ml-3" style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                  {displaySessions.map((s) => (
                    <div key={s.id} className="pl-2">
                      <SessionRow session={s} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center ml-3" style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                  <MessageSquare className="h-4 w-4 text-white/10 mx-auto mb-1.5" />
                  <p className="text-[11px] text-white/30 mb-0.5">{t('noChats')}</p>
                  <p className="text-[9px] text-white/15">{t('startConversation')}</p>
                </div>
              )}
            </div>

          </div>
        </ScrollArea>

        {/* ═── Footer ─══ */}
        <div className="shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>

          {/* Guest: Prominent auth CTA */}
          {!isAuthenticated && (
            <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => navigate('/signup')}
                  className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg bg-cyan-50 text-cyan-600 border border-cyan-100 text-[11px] font-medium hover:bg-cyan-100 transition-all"
                >
                  <Sparkles className="w-3 h-3" /> {t('createAccount')}
                </button>
                <button
                  onClick={() => navigate('/login')}
                  className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all"
                  style={{ border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <LogIn className="w-3 h-3" /> {t('signIn')}
                </button>
              </div>
              <p className="text-[9px] text-white/15 mt-1.5 text-center">
                {t('syncDevices')}
              </p>
            </div>
          )}

          {/* User card */}
          <div className="px-3 py-2">
            <UserAccountDropdown onOpenSettings={onOpenSettings} onOpenUpgrade={onOpenUpgrade} />
          </div>

          {/* Upgrade */}
          <div className="px-3 pb-3">
            <Button
              variant="ghost"
              onClick={onOpenUpgrade}
              className="w-full h-7 gap-1.5 text-[11px] text-white/30 hover:text-amber-500 hover:bg-amber-500/[0.06] rounded-lg transition-all border border-transparent hover:border-amber-500/20"
            >
              <Crown className="h-3 w-3" />
              {t('upgradePro')}
            </Button>
          </div>
        </div>
      </aside>

      {/* Delete confirmation */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Chat"
        description="This chat and all its messages will be permanently deleted."
        onConfirm={() => { if (deleteTarget) onDelete(deleteTarget); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
