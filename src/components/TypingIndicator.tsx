import { useState, useEffect } from 'react';

const STATUS_MESSAGES = [
  'Analyzing context...',
  'Building response...',
  'Reviewing patterns...',
  'Optimizing answer...',
  'Generating strategy...',
  'Processing request...',
  'Formulating reply...',
];

export default function TypingIndicator() {
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex items-center gap-[5px]">
        <div
          className="h-[6px] w-[6px] rounded-full bg-cyan-400/80 animate-typing-dot"
          style={{ animationDelay: '0ms' }}
        />
        <div
          className="h-[6px] w-[6px] rounded-full bg-cyan-400/80 animate-typing-dot"
          style={{ animationDelay: '200ms' }}
        />
        <div
          className="h-[6px] w-[6px] rounded-full bg-cyan-400/80 animate-typing-dot"
          style={{ animationDelay: '400ms' }}
        />
      </div>
      <span
        key={statusIndex}
        className="text-xs text-slate-500 font-medium animate-fade-in transition-all duration-500"
      >
        {STATUS_MESSAGES[statusIndex]}
      </span>
    </div>
  );
}
