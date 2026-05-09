import { Link } from 'react-router';
import { ArrowLeft, PenTool, Terminal, BarChart3, Camera } from 'lucide-react';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';

const useCases = [
  {
    icon: Terminal,
    title: 'Developers',
    description: 'Write boilerplate, debug errors, review code, and learn new frameworks faster than ever.',
  },
  {
    icon: PenTool,
    title: 'Writers & Editors',
    description: 'Draft articles, rewrite paragraphs, brainstorm headlines, and maintain consistent tone.',
  },
  {
    icon: BarChart3,
    title: 'Analysts',
    description: 'Interpret data, generate insights, build models, and visualize trends with natural language.',
  },
  {
    icon: Camera,
    title: 'Designers',
    description: 'Generate copy, brainstorm concepts, write design system docs, and critique UX flows.',
  },
];

export default function UseCasesPage() {
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
              Who Uses KorvixAI?
            </h1>
            <p className="text-slate-400 max-w-xl mx-auto text-base sm:text-lg">
              Trusted by professionals across every industry to accelerate their best work.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {useCases.map((useCase) => (
              <div
                key={useCase.title}
                className="flex items-start gap-5 rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8 hover:bg-white/[0.04] transition-all duration-300"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 text-purple-400">
                  <useCase.icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white mb-2">{useCase.title}</h3>
                  <p className="text-slate-400 leading-relaxed">{useCase.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
