import { useState } from 'react';
import { X, Sparkles, Compass, MessageSquare, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface OnboardingProps {
  onDismiss: () => void;
  onStartChat: (prompt: string) => void;
}

const useCases = [
  { label: 'Write & Draft', prompt: 'Help me draft a professional email to my team about the new project timeline.' },
  { label: 'Code & Debug', prompt: 'Debug this Python function and explain the issue.' },
  { label: 'Analyze Data', prompt: 'Explain what a p-value means in statistics with a real-world example.' },
  { label: 'Brainstorm', prompt: 'Give me 5 unique startup ideas in the sustainability space.' },
  { label: 'Learn & Study', prompt: 'Explain quantum computing to me like I\'m a beginner.' },
  { label: 'Plan & Organize', prompt: 'Help me plan a productive week with time blocks and priorities.' },
];

export default function Onboarding({ onDismiss, onStartChat }: OnboardingProps) {
  const [step, setStep] = useState(0);

  if (step === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 animate-fade-in">
        <div className="max-w-md w-full">
          <div className="flex items-center justify-between mb-6">
            <span className="text-[11px] text-slate-600 font-medium uppercase tracking-wider">Welcome to KorvixAI</span>
            <button onClick={onDismiss} className="text-slate-600 hover:text-slate-400 transition-colors p-1 rounded-md hover:bg-white/[0.03]">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 mb-5 shadow-lg shadow-cyan-500/15">
            <Sparkles className="h-6 w-6 text-white" />
          </div>

          <h2 className="text-xl font-semibold text-white mb-2">Your AI workspace</h2>
          <p className="text-[13px] text-slate-500 leading-relaxed mb-8">
            KorvixAI helps you write, code, analyze, and create with context-aware intelligence.
            Everything stays private to your session.
          </p>

          <div className="space-y-2.5 mb-8">
            {[
              { icon: MessageSquare, text: 'Ask anything — code, writing, analysis, or brainstorming' },
              { icon: Compass, text: 'Switch modes between Fast, Deep Think, Research, and more' },
              { icon: Sparkles, text: 'Use the prompt library for quick, powerful starting points' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl bg-white/[0.02] border border-white/[0.04] px-4 py-3">
                <item.icon className="h-4 w-4 text-cyan-400/70 mt-0.5 shrink-0" />
                <span className="text-[12px] text-slate-400">{item.text}</span>
              </div>
            ))}
          </div>

          <Button
            onClick={() => setStep(1)}
            className="w-full bg-white text-slate-950 hover:bg-slate-200 font-medium h-10 rounded-xl transition-all duration-300"
          >
            Get Started
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 animate-fade-in">
        <div className="max-w-md w-full">
          <div className="flex items-center justify-between mb-6">
            <span className="text-[11px] text-slate-600 font-medium uppercase tracking-wider">Step 2 of 3</span>
            <button onClick={onDismiss} className="text-slate-600 hover:text-slate-400 transition-colors p-1 rounded-md hover:bg-white/[0.03]">
              <X className="h-4 w-4" />
            </button>
          </div>

          <h2 className="text-xl font-semibold text-white mb-2">What will you use KorvixAI for?</h2>
          <p className="text-[13px] text-slate-500 leading-relaxed mb-6">
            Choose your main use case. You can always change this later.
          </p>

          <div className="grid grid-cols-2 gap-2 mb-6">
            {useCases.map((uc) => (
              <button
                key={uc.label}
                onClick={() => setStep(2)}
                className="flex items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[13px] text-slate-300 hover:bg-white/[0.05] hover:border-white/[0.1] transition-all duration-200"
              >
                {uc.label}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            onClick={() => setStep(2)}
            className="w-full text-slate-500 hover:text-white text-[12px]"
          >
            Skip this step
          </Button>
        </div>
      </div>
    );
  }

  // Step 2
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 animate-fade-in">
      <div className="max-w-md w-full">
        <div className="flex items-center justify-between mb-6">
          <span className="text-[11px] text-slate-600 font-medium uppercase tracking-wider">Step 3 of 3</span>
          <button onClick={onDismiss} className="text-slate-600 hover:text-slate-400 transition-colors p-1 rounded-md hover:bg-white/[0.03]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="text-xl font-semibold text-white mb-2">Start with a prompt</h2>
        <p className="text-[13px] text-slate-500 leading-relaxed mb-6">
          Pick a starting point or type your own message.
        </p>

        <div className="space-y-2 mb-6">
          {useCases.slice(0, 4).map((uc) => (
            <button
              key={uc.label}
              onClick={() => {
                onStartChat(uc.prompt);
                onDismiss();
              }}
              className="w-full flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left hover:bg-white/[0.05] hover:border-white/[0.1] transition-all duration-200 group"
            >
              <MessageSquare className="h-4 w-4 text-cyan-400/60 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="text-[13px] text-slate-300">{uc.label}</span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-600 ml-auto group-hover:text-slate-400 transition-colors" />
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          onClick={onDismiss}
          className="w-full text-slate-500 hover:text-white text-[12px]"
        >
          I will type my own message
        </Button>
      </div>
    </div>
  );
}
