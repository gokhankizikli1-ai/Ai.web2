import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Compass } from 'lucide-react';

export default function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="relative pt-28 pb-16 md:pt-44 md:pb-28 overflow-hidden">
      {/* Animated gradient orbs */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/[0.07] rounded-full blur-[140px] pointer-events-none animate-pulse-soft" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-500/[0.06] rounded-full blur-[140px] pointer-events-none animate-pulse-soft" style={{ animationDelay: '1s' }} />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-blue-500/[0.04] rounded-full blur-[100px] pointer-events-none" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(rgba(255,255,255,0.3) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <div className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 mb-8 animate-fade-in-up cursor-default hover:border-cyan-500/20 transition-colors duration-300">
          <Sparkles className="h-3 w-3 text-cyan-400" />
          <span className="text-[12px] font-medium text-slate-400">Introducing KorvixAI</span>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight text-white mb-6 animate-fade-in-up leading-[1.1]" style={{ animationDelay: '0.08s' }}>
          Intelligence,{' '}
          <span className="text-gradient">refined.</span>
        </h1>

        <p className="text-base sm:text-lg md:text-xl text-slate-500 max-w-xl mx-auto mb-10 leading-relaxed animate-fade-in-up" style={{ animationDelay: '0.16s' }}>
          The AI workspace for modern teams. Write, code, analyze, and create with context-aware intelligence.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-in-up" style={{ animationDelay: '0.24s' }}>
          <Button
            size="lg"
            className="bg-white text-slate-950 hover:bg-slate-200 font-semibold px-7 h-12 text-[14px] group w-full sm:w-auto rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_-5px_rgba(255,255,255,0.15)]"
            onClick={() => navigate('/chat')}
          >
            Start Chatting
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="border-white/10 text-white hover:bg-white/[0.04] hover:border-white/15 font-semibold px-7 h-12 text-[14px] w-full sm:w-auto rounded-xl backdrop-blur-sm transition-all duration-300"
            onClick={() => navigate('/features')}
          >
            <Compass className="mr-2 h-4 w-4" />
            Explore Features
          </Button>
        </div>
      </div>
    </section>
  );
}
