import { useState } from 'react';
import { Copy, Check, FileText, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatSession } from '@/types';

interface ExportChatProps {
  open: boolean;
  onClose: () => void;
  session: ChatSession;
}

export default function ExportChat({ open, onClose, session }: ExportChatProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const asMarkdown = () => {
    return session.messages.map((m) => {
      const role = m.role === 'user' ? '**You**' : '**KorvixAI**';
      return `### ${role}\n\n${m.content}\n`;
    }).join('\n---\n\n');
  };

  const asText = () => {
    return session.messages.map((m) => {
      const role = m.role === 'user' ? 'You' : 'KorvixAI';
      return `[${role}]\n${m.content}`;
    }).join('\n\n---\n\n');
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(asMarkdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fail silently */ }
  };

  const handleDownloadTxt = () => {
    const blob = new Blob([asText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const html = `
      <html>
        <head><title>${session.title}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 20px; background: #0a0a0f; color: #e2e2e2; line-height: 1.6; }
          h1 { font-size: 20px; color: #fff; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; }
          .msg { margin-bottom: 16px; padding: 12px 16px; border-radius: 12px; }
          .user { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.12); }
          .ai { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
          .role { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
          .user .role { color: #9CBBD1; }
          .ai .role { color: #9CBBD1; }
          .content { font-size: 13px; white-space: pre-wrap; }
          pre { background: rgba(255,255,255,0.04); padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
          code { font-family: ui-monospace, monospace; }
          @media print { body { background: #fff; color: #000; } .msg { border: 1px solid #ddd; } }
        </style></head>
        <body>
          <h1>${session.title}</h1>
          ${session.messages.map(m => `
            <div class="msg ${m.role === 'user' ? 'user' : 'ai'}">
              <div class="role">${m.role === 'user' ? 'You' : 'KorvixAI'}</div>
              <div class="content">${m.content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
            </div>
          `).join('')}
        </body>
      </html>`;
    w.document.write(html);
    w.document.close();
    w.print();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0a0f1a]/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-sm mx-4 rounded-2xl border border-white/[0.08] bg-[#171C24] shadow-2xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold text-white">Export Conversation</h3>
          <button onClick={onClose} className="text-[#7F8FA3] hover:text-white transition-colors p-1 rounded-md hover:bg-white/[0.05]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-2">
          <Button
            variant="ghost"
            onClick={handleCopyMarkdown}
            className="w-full justify-start h-10 gap-3 text-[13px] text-slate-300 hover:text-white hover:bg-white/[0.05] border border-white/[0.04]"
          >
            {copied ? <Check className="h-4 w-4 text-[#6F8F7A]" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied Markdown' : 'Copy as Markdown'}
          </Button>

          <Button
            variant="ghost"
            onClick={handleDownloadTxt}
            className="w-full justify-start h-10 gap-3 text-[13px] text-slate-300 hover:text-white hover:bg-white/[0.05] border border-white/[0.04]"
          >
            <FileText className="h-4 w-4" />
            Download as TXT
          </Button>

          <Button
            variant="ghost"
            onClick={handlePrint}
            className="w-full justify-start h-10 gap-3 text-[13px] text-slate-300 hover:text-white hover:bg-white/[0.05] border border-white/[0.04]"
          >
            <Printer className="h-4 w-4" />
            Print / PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
