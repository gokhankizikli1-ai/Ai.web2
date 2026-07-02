import { Link } from 'react-router';
import { ArrowLeft, Shield, Eye, Users, Zap } from 'lucide-react';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';

const values = [
  {
    icon: Eye,
    title: 'Transparency',
    description: 'We believe in being open about how our AI works, what it can do, and where its limitations lie.',
  },
  {
    icon: Shield,
    title: 'Privacy First',
    description: 'Your data belongs to you. We never sell your information and always encrypt conversations.',
  },
  {
    icon: Users,
    title: 'Human Centered',
    description: 'Technology should serve people. Every feature we build starts with understanding real user needs.',
  },
  {
    icon: Zap,
    title: 'Relentless Improvement',
    description: 'We ship fast, learn from feedback, and continuously improve the quality of every interaction.',
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-foreground">
      <Navbar />
      <main className="pt-28 pb-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Breadcrumb */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">
            About KorvixAI
          </h1>

          <div className="space-y-6 text-slate-300 leading-relaxed mb-16">
            <p>
              KorvixAI is an intelligent assistant platform built for modern professionals.
              We combine state-of-the-art language models with a clean, privacy-focused
              interface designed for real work.
            </p>
            <p>
              Our mission is to make AI genuinely useful in everyday workflows — whether
              you are writing code, analyzing data, drafting documents, or brainstorming
              your next big idea. We focus on speed, accuracy, and a user experience that
              respects your time.
            </p>
            <p>
              Founded in 2025, KorvixAI serves thousands of users across development,
              design, content creation, and data analysis. We are a fully remote team
              distributed across North America and Europe, united by a shared obsession
              with quality and user experience.
            </p>
          </div>

          <h2 className="text-2xl font-bold text-white mb-8">Our Values</h2>

          <div className="grid sm:grid-cols-2 gap-6">
            {values.map((value) => (
              <div
                key={value.title}
                className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 hover:bg-white/[0.04] transition-all duration-300"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#52677A]/20 to-[#7890A3]/20 text-[#52677A]">
                  <value.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{value.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
