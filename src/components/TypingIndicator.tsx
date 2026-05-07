export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <div className="h-2 w-2 rounded-full bg-slate-400 animate-typing-dot" style={{ animationDelay: '0ms' }} />
      <div className="h-2 w-2 rounded-full bg-slate-400 animate-typing-dot" style={{ animationDelay: '200ms' }} />
      <div className="h-2 w-2 rounded-full bg-slate-400 animate-typing-dot" style={{ animationDelay: '400ms' }} />
    </div>
  );
}
