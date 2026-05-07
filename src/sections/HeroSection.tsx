import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ArrowRight, Play, Zap } from 'lucide-react';

export default function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[128px] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto px-6 text-center">
        <div className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 mb-8 animate-fade-in-up">
          <Zap className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-xs font-medium text-slate-300">Introducing Velora AI 2.0</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          Intelligence,{' '}
          <span className="text-gradient">refined.</span>
        </h1>

        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          The next generation AI assistant. Context-aware, deeply knowledgeable, and designed for the way you actually work.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <Button
            size="lg"
            className="bg-white text-slate-900 hover:bg-slate-200 font-semibold px-8 h-12 text-base group"
            onClick={() => navigate('/chat')}
          >
            Start Chatting
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="border-white/20 text-white hover:bg-white/5 font-semibold px-8 h-12 text-base backdrop-blur-sm"
            onClick={() => navigate('/chat')}
          >
            <Play className="mr-2 h-4 w-4 fill-current" />
            Watch Demo
          </Button>
        </div>
      </div>
    </section>
  );
}
