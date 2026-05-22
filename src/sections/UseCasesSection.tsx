import { PenTool, Terminal, BarChart3, Camera } from 'lucide-react';

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

export default function UseCasesSection() {
  return (
    <section id="use-cases" className="py-24 relative">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-[#111827] mb-4">
            Who Uses KorvixAI?
          </h2>
          <p className="text-slate-500 max-w-xl mx-auto">
            Trusted by professionals across every industry to accelerate their best work.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {useCases.map((useCase) => (
            <div
              key={useCase.title}
              className="flex items-start gap-5 rounded-2xl border border-slate-200 bg-white p-8 hover:bg-slate-50 transition-all duration-300 shadow-sm"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-100 to-pink-100 text-purple-600">
                <useCase.icon className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-[#111827] mb-2">{useCase.title}</h3>
                <p className="text-slate-600 leading-relaxed">{useCase.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
