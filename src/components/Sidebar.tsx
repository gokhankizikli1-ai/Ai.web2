import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Plus,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Crown,
  Clock,
  ArrowLeft,
  FlaskConical,
  Search,
  X,
  FolderOpen,
  GraduationCap,
  Code,
  Rocket,
  Landmark,
  User,
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
}

const FOLDER_CONFIG: { id: ChatFolder; label: string; icon: typeof GraduationCap }[] = [
  { id: 'study', label: 'Study', icon: GraduationCap },
  { id: 'coding', label: 'Coding', icon: Code },
  { id: 'startup', label: 'Startup', icon: Rocket },
  { id: 'finance', label: 'Finance', icon: Landmark },
  { id: 'personal', label: 'Personal', icon: User },
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

function getFolderLabel(folder?: ChatFolder): string | null {
  if (!folder || folder === 'none') return null;
  const cfg = FOLDER_CONFIG.find((f) => f.id === folder);
  return cfg?.label || null;
}

export default function Sidebar({
  isOpen,
  onToggle,
  filteredSessions,
  activeSessionId,
  searchQuery,
  onSearchChange,
  onSelect,
  onDelete,
  onNewChat,
  onMoveToFolder,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<ChatFolder | 'all'>('all');
  const userSessions = filteredSessions.filter((s) => !s.isDemo);
  const demoSessions = filteredSessions.filter((s) => s.isDemo);

  // Apply folder filter
  const displaySessions = activeFolder === 'all'
    ? userSessions
    : userSessions.filter((s) => s.folder === activeFolder);

  const renderSessionItem = (session: ChatSession) => {
    const isActive = activeSessionId === session.id;
    const isHovered = hoveredId === session.id;
    const folderLabel = getFolderLabel(session.folder);

    return (
      <div
        key={session.id}
        className="group relative"
        onMouseEnter={() => setHoveredId(session.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <button
          onClick={() => onSelect(session.id)}
          className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all duration-200 ${
            isActive
              ? 'bg-white/[0.07] text-white border border-white/[0.08] shadow-sm'
              : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300 border border-transparent'
          }`}
        >
          <MessageSquare
            className={`h-3.5 w-3.5 shrink-0 transition-colors ${
              isActive ? 'text-cyan-400' : 'text-slate-600'
            }`}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium truncate">{session.title}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-slate-600">{timeAgo(session.updatedAt)}</span>
              {folderLabel && (
                <span className="text-[9px] px-1 py-[1px] rounded bg-white/[0.04] text-slate-600 border border-white/[0.04]">
                  {folderLabel}
                </span>
              )}
            </div>
          </div>
        </button>

        {/* Hover actions */}
        {(isActive || isHovered) && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {/* Folder dropdown */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="relative group/folder">
                    <button className="p-1 rounded text-slate-600 hover:text-cyan-400 hover:bg-white/[0.05] transition-all">
                      <FolderOpen className="h-3 w-3" />
                    </button>
                    <div className="absolute bottom-full right-0 mb-1 hidden group-hover/folder:flex flex-col gap-0.5 rounded-lg border border-white/[0.08] bg-[#111118] p-1 shadow-xl z-50">
                      {FOLDER_CONFIG.map((f) => (
                        <button
                          key={f.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMoveToFolder(session.id, f.id);
                          }}
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-slate-500 hover:text-white hover:bg-white/[0.05] transition-all whitespace-nowrap"
                        >
                          <f.icon className="h-2.5 w-2.5" />
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px]">
                  <p>Move to folder</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(session.id);
                    }}
                    className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px]">
                  <p>Delete</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {!isOpen && (
        <div className="md:hidden fixed top-[18px] left-4 z-40">
          <Button variant="ghost" size="icon" onClick={onToggle} className="h-9 w-9 workspace-panel text-slate-400 hover:text-white">
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col sidebar-surface transition-all duration-[300ms] ${
          isOpen ? 'w-[280px] translate-x-0' : 'w-0 -translate-x-full md:translate-x-0 md:w-0'
        }`}
      >
        {isOpen && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-3.5 border-b border-white/[0.04]">
              <Link to="/" className="flex items-center gap-2 text-white hover:text-slate-200 transition-colors shrink-0">
                <ArrowLeft className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Exit</span>
              </Link>
              <Button variant="ghost" size="icon" onClick={onToggle} className="h-7 w-7 text-slate-500 hover:text-white hover:bg-white/[0.05] rounded-md transition-all">
                <PanelLeftClose className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* New Chat */}
            <div className="px-3 pt-3 pb-1.5">
              <Button
                variant="ghost"
                onClick={onNewChat}
                className="w-full h-9 gap-2 text-slate-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.1] rounded-xl transition-all duration-200 text-[13px] font-medium"
              >
                <Plus className="h-3.5 w-3.5" />
                New Chat
              </Button>
            </div>

            {/* Search */}
            <div className="px-3 pb-2">
              <div className="flex items-center gap-2 rounded-xl bg-white/[0.02] border border-white/[0.05] px-3 py-[7px] focus-within:border-cyan-500/20 transition-colors">
                <Search className="h-3 w-3 text-slate-600" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search conversations..."
                  className="flex-1 bg-transparent text-[12px] text-white placeholder:text-slate-600 outline-none min-w-0"
                />
                {searchQuery && (
                  <button onClick={() => onSearchChange('')} className="text-slate-600 hover:text-slate-400">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Folder filter tabs */}
            {!searchQuery && (
              <div className="flex items-center gap-1 px-3 pb-2 overflow-x-auto scrollbar-thin">
                <button
                  onClick={() => setActiveFolder('all')}
                  className={`shrink-0 rounded-md px-2 py-[2px] text-[10px] font-medium transition-all ${
                    activeFolder === 'all' ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'
                  }`}
                >
                  All
                </button>
                {FOLDER_CONFIG.map((f) => {
                  const count = userSessions.filter((s) => s.folder === f.id).length;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setActiveFolder(f.id)}
                      className={`shrink-0 rounded-md px-2 py-[2px] text-[10px] font-medium transition-all flex items-center gap-1 ${
                        activeFolder === f.id ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'
                      }`}
                    >
                      <f.icon className="h-2.5 w-2.5" />
                      {f.label}
                      {count > 0 && <span className="text-slate-700">{count}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Sessions List */}
            <ScrollArea className="flex-1 px-3 py-1.5">
              {/* User Chats */}
              {displaySessions.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 px-3 mb-1.5">
                    <Clock className="h-3 w-3 text-slate-700" />
                    <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                      {searchQuery ? 'Results' : activeFolder === 'all' ? 'Recent' : getFolderLabel(activeFolder) || 'Chats'}
                    </span>
                  </div>
                  <div className="space-y-0.5">{displaySessions.map(renderSessionItem)}</div>
                </div>
              )}

              {/* Demo Chats */}
              {demoSessions.length > 0 && !searchQuery && activeFolder === 'all' && (
                <div>
                  <div className="flex items-center gap-1.5 px-3 mb-1.5">
                    <FlaskConical className="h-3 w-3 text-amber-500/40" />
                    <span className="text-[10px] font-semibold text-amber-500/40 uppercase tracking-wider">Examples</span>
                  </div>
                  {demoSessions.map(renderSessionItem)}
                </div>
              )}

              {/* Empty */}
              {displaySessions.length === 0 && demoSessions.length === 0 && (
                <div className="px-3 py-10 text-center">
                  <MessageSquare className="h-5 w-5 text-slate-800 mx-auto mb-2" />
                  <p className="text-[11px] text-slate-700">
                    {searchQuery ? 'No results found' : 'No conversations yet'}
                  </p>
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            <div className="p-3 border-t border-white/[0.04]">
              <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.02] px-3 py-2 mb-2 border border-white/[0.04]">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 shadow-sm shadow-cyan-500/10">
                  <span className="text-[10px] font-bold text-white">Y</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-white truncate">You</div>
                  <div className="text-[10px] text-slate-700">Free Plan</div>
                </div>
              </div>
              <Button variant="ghost" className="w-full h-8 gap-2 text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/[0.06] text-[11px] rounded-xl transition-all border border-transparent hover:border-amber-500/[0.1]">
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
