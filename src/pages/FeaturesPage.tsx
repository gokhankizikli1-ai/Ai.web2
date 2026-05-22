import { Link } from 'react-router';
import { ArrowLeft, Brain, Code2, Lock, Palette, Shield, Zap } from 'lucide-react';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';

const features = [
  {
    icon: Brain,
    title: 'Context Aware',
    description: 'Remembers conversation history and understands nuanced context across long threads.',
  },
  {
    icon: Zap,
    title: 'Lightning Fast',
    description: 'Responses generated in milliseconds with optimized inference infrastructure.',
  },
  {
    icon: Code2,
    title: 'Code Expert',
    description: 'Write, debug, and explain code in 50+ languages with production-ready suggestions.',
  },
  {
    icon: Shield,
    title: 'Privacy First',
    description: 'Your data is encrypted and never used to train models without explicit consent.',
  },
  {
    icon: Palette,
    title: 'Creative Partner',
    description: 'Brainstorm ideas, draft stories, and iterate on creative projects collaboratively.',
  },
  {
    icon: Lock,
    title: 'Enterprise Secure',
    description: 'SOC 2 compliant with SSO, audit logs, and role-based access controls.',
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-foreground">
      <Navbar />
      <main className="pt-28 pb-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {/* Breadcrumb */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>

          <div className="text-center mb-16">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">
              Built for Modern Teams
            </h1>
            <p className="text-slate-400 max-w-xl mx-auto text-base sm:text-lg">
              Everything you need to work smarter, faster, and more creatively with KorvixAI.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group relative rounded-2xl border border-white/10 bg-white/[0.02] p-6 hover:bg-white/[0.04] transition-all duration-300 hover:border-white/[0.06]0"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 text-cyan-400 group-hover:scale-110 transition-transform duration-300">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
