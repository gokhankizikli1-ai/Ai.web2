import { Star } from 'lucide-react';

const testimonials = [
  {
    quote: "KorvixAI has completely changed how I write code. It's like having a senior engineer pair-programming with me 24/7. The contextual awareness is unmatched.",
    author: 'Sarah Chen',
    role: 'Staff Engineer at Vercel',
    avatar: 'SC',
  },
  {
    quote: "I've tried every AI writing tool on the market. KorvixAI is the only one that actually sounds like me. The custom instructions feature is a game changer.",
    author: 'Marcus Johnson',
    role: 'Head of Content at Notion',
    avatar: 'MJ',
  },
  {
    quote: "Our team replaced three separate tools with KorvixAI. Data analysis, documentation, and brainstorming all in one interface. The ROI was immediate.",
    author: 'Elena Rodriguez',
    role: 'Product Lead at Linear',
    avatar: 'ER',
  },
];

export default function TestimonialsSection() {
  return (
    <section id="testimonials" className="py-24 relative">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Loved by Thinkers & Makers
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            See what industry leaders say about their experience.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((t) => (
            <div
              key={t.author}
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 hover:bg-white/[0.04] transition-all duration-300"
            >
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-cyan-400 text-cyan-400" />
                ))}
              </div>
              <p className="text-slate-300 mb-6 leading-relaxed text-sm">"{t.quote}"</p>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-white text-sm font-bold">
                  {t.avatar}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{t.author}</div>
                  <div className="text-xs text-slate-500">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
