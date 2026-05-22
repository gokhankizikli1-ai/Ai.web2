import { Brain, Code2, Lock, Palette, Shield, Zap } from 'lucide-react';

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

export default function FeaturesSection() {
  return (
    <section id="features" className="py-20 md:py-28 relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-[#111827] mb-3">
            Built for Modern Teams
          </h2>
          <p className="text-slate-500 max-w-md mx-auto text-base">
            Everything you need to work smarter, faster, and more creatively.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature, i) => (
            <div
              key={feature.title}
              className="group relative rounded-2xl border border-slate-200 bg-slate-50 p-6 hover:bg-white transition-all duration-300 hover:border-slate-300 hover:shadow-md"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-100 to-blue-100 text-cyan-600 group-hover:scale-110 transition-transform duration-300">
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="text-[15px] font-semibold text-[#111827] mb-1.5">{feature.title}</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
