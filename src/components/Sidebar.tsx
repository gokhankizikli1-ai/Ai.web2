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
  User,
} from 'lucide-react';
import type { ChatSession } from '@/types';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Sidebar({
  isOpen,
  onToggle,
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onNewChat,
}: SidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      {!isOpen && (
        <div className="md:hidden fixed top-4 left-4 z-40">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-9 w-9 bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/10 bg-[#0d0d12] transition-all duration-300 ease-in-out ${
          isOpen ? 'w-72 translate-x-0' : 'w-0 -translate-x-full md:translate-x-0 md:w-0'
        }`}
      >
        {isOpen && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <Button
                variant="ghost"
                className="h-8 gap-2 text-slate-300 hover:text-white hover:bg-white/5"
                onClick={onNewChat}
              >
                <Plus className="h-4 w-4" />
                <span className="text-sm font-medium">New Chat</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggle}
                className="h-8 w-8 text-slate-500 hover:text-white hover:bg-white/5"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>

            {/* Sessions List */}
            <ScrollArea className="flex-1 px-3 py-2">
              <div className="space-y-1">
                {sessions.map((session) => (
                  <div key={session.id} className="group relative">
                    <button
                      onClick={() => onSelect(session.id)}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 ${
                        activeSessionId === session.id
                          ? 'bg-white/10 text-white'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      }`}
                    >
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {session.title}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {timeAgo(session.updatedAt)}
                        </div>
                      </div>
                    </button>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(session.id);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-white/5"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p>Delete chat</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="p-3 border-t border-white/5">
              <div className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5 mb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600">
                  <User className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">Alex Developer</div>
                  <div className="text-[10px] text-slate-500">Pro Plan</div>
                </div>
              </div>

              <Button
                variant="ghost"
                className="w-full h-8 gap-2 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 text-xs"
              >
                <Crown className="h-3.5 w-3.5" />
                Upgrade to Ultra
              </Button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
