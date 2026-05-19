import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2,
  PanelLeftClose, PanelLeftOpen,
  Crown, ArrowLeft, Search, X,
  LogIn, Sparkles, Settings,
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
          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-left transition-all duration-200 ${
            active
              ? 'bg-white/[0.04] text-white border border-white/[0.06] shadow-[0_0_12px_-4px_rgba(34,211,238,0.04)]'
              : 'text-slate-600 hover:bg-white/[0.025] hover:text-slate-300 border border-transparent'
          }`}
        >
          <div className={`w-[3px] h-[3px] rounded-full shrink-0 transition-all duration-300 ${
            active ? 'bg-cyan-400/50 scale-100' : 'bg-transparent scale-0'
          }`} />

          <MessageSquare className={`h-3 w-3 shrink-0 transition-colors ${active ? 'text-slate-400' : 'text-slate-700'}`} />

          <div className="flex-1 min-w-0">
            <p className={`text-[12px] truncate leading-tight ${active ? 'text-white' : ''}`}>
              {session.title}
            </p>
            <span className="text-[10px] text-slate-700">{timeAgo(session.updatedAt)}</span>
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
        style={{ width: 220 }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-3 h-10 border-b border-white/[0.03]">
          <Link to="/" className="flex items-center gap-2 text-white hover:text-slate-300 transition-colors">
            <ArrowLeft className="h-3 w-3 text-slate-600" />
            <span className="text-[11px] font-medium text-slate-600 uppercase tracking-wider">Home</span>
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
            <Plus className="h-3.5 w-3.5" /> {t('newChat')}
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
              placeholder={t('searchChats')}
              className="flex-1 bg-transparent text-[12px] text-white placeholder:text-slate-700 outline-none min-w-0"
            />
            {searchQuery && (
              <button onClick={() => onSearchChange('')} className="text-slate-700 hover:text-slate-500 shrink-0">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* ═── Recent Chats ─══ */}
        <ScrollArea className="flex-1 min-h-0 px-3">
          {/* Section label */}
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
              {t('recent')}
            </span>
            <span className="text-[10px] text-slate-800">{displaySessions.length}</span>
          </div>

          {displaySessions.length > 0 ? (
            <div className="space-y-[1px] pb-3">
              {displaySessions.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </div>
          ) : (
            <div className="py-6 text-center">
              <MessageSquare className="h-5 w-5 text-slate-800 mx-auto mb-2" />
              <p className="text-[12px] text-slate-700 mb-0.5">{t('noChats')}</p>
              <p className="text-[10px] text-slate-800">{t('startConversation')}</p>
            </div>
          )}
        </ScrollArea>

        {/* ═── Footer ─══ */}
        <div className="shrink-0 border-t border-white/[0.03]">

          {/* Guest: Prominent auth CTA — stacked for narrow sidebar */}
          {!isAuthenticated && (
            <div className="px-3 py-2 border-b border-white/[0.03]">
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => { window.location.href = '/#/signup'; }}
                  className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500/[0.08] text-cyan-400 border border-cyan-500/12 text-[11px] font-medium hover:bg-cyan-500/[0.12] transition-all"
                >
                  <Sparkles className="w-3 h-3" /> {t('createAccount')}
                </button>
                <button
                  onClick={() => { window.location.href = '/#/login'; }}
                  className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg bg-white/[0.02] text-slate-400 border border-white/[0.04] text-[11px] hover:bg-white/[0.04] hover:text-slate-300 transition-all"
                >
                  <LogIn className="w-3 h-3" /> {t('signIn')}
                </button>
              </div>
              <p className="text-[9px] text-slate-700 mt-1.5 text-center">
                {t('syncDevices')}
              </p>
            </div>
          )}

          {/* User card */}
          <div className="px-3 py-2">
            <UserAccountDropdown onOpenSettings={onOpenSettings} onOpenUpgrade={onOpenUpgrade} />
          </div>

          {/* Settings & Language */}
          <div className="px-3 pb-2">
            <button
              onClick={onOpenSettings}
              className="w-full h-7 flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-300 hover:bg-white/[0.03] rounded-lg transition-all px-2"
            >
              <Settings className="h-3 w-3" />
              {t('settings')}
            </button>
          </div>

          {/* Upgrade */}
          <div className="px-3 pb-3">
            <Button
              variant="ghost"
              onClick={onOpenUpgrade}
              className="w-full h-7 gap-1.5 text-[11px] text-slate-600 hover:text-amber-300 hover:bg-amber-500/[0.04] rounded-lg transition-all border border-transparent hover:border-amber-500/10"
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
