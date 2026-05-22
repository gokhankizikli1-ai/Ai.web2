import { MessageSquare, Send, Sparkles, User } from 'lucide-react';

export default function AiMockupSection() {
  return (
    <section className="relative py-16 md:py-24 overflow-hidden">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#0d0d12] shadow-2xl animate-float">
          {/* Window chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-[#12121a]">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <div className="ml-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              KorvixAI
            </div>
          </div>

          {/* Chat content */}
          <div className="p-4 sm:p-6 space-y-5">
            {/* AI message */}
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-600 to-blue-600">
                <Sparkles className="h-4 w-4 text-[#111827]" />
              </div>
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">KorvixAI</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-500 border border-white/5">Demo</span>
                </div>
                <div className="rounded-2xl rounded-tl-none bg-white/5 px-4 py-3 text-sm text-foreground max-w-md">
                  Hello! I'm Korvix, your intelligent assistant. I can help you write, code, analyze data, brainstorm ideas, or just chat. What would you like to work on today?
                </div>
              </div>
            </div>

            {/* User message */}
            <div className="flex gap-3 flex-row-reverse">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700">
                <User className="h-4 w-4 text-foreground" />
              </div>
              <div className="space-y-1 text-right">
                <div className="text-xs text-muted-foreground font-medium">You</div>
                <div className="rounded-2xl rounded-tr-none bg-blue-600/20 border border-blue-500/20 px-4 py-3 text-sm text-slate-200 max-w-md">
                  Help me draft a professional email to my team about the new project timeline.
                </div>
              </div>
            </div>

            {/* AI response */}
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-600 to-blue-600">
                <Sparkles className="h-4 w-4 text-[#111827]" />
              </div>
              <div className="space-y-1 min-w-0 flex-1 max-w-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">KorvixAI</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-500 border border-white/5">Demo</span>
                </div>
                <div className="rounded-2xl rounded-tl-none bg-white/5 px-4 py-3 text-sm text-foreground">
                  <p className="mb-2">Of course! Here's a draft for you:</p>
                  <div className="rounded-lg bg-slate-900/30 p-3 text-muted-foreground text-xs font-mono space-y-1">
                    <p>Subject: Updated Project Timeline &amp; Next Steps</p>
                    <p>---</p>
                    <p>Hi team,</p>
                    <p>I wanted to share the updated timeline...</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Input area */}
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 mt-4">
              <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 text-sm text-muted-foreground">Type a message...</div>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-600 shrink-0">
                <Send className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
