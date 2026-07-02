import { motion } from 'framer-motion';
import { ArrowLeft, Clock } from 'lucide-react';
import { Link } from 'react-router';
import Navigation from '@/components/Navigation';

interface ComingSoonProps {
  title: string;
  description?: string;
  pageType?: 'blog' | 'careers' | 'contact' | 'pricing' | 'legal';
}

export default function ComingSoon({ title, description, pageType = 'blog' }: ComingSoonProps) {
  const messages: Record<string, { desc: string; eta: string }> = {
    blog: { desc: 'AI-powered insights on startups, trading, and building with intelligence.', eta: 'Q2 2026' },
    careers: { desc: 'Join the team building the future of AI-powered work.', eta: 'Hiring soon' },
    contact: { desc: 'Reach out for partnerships, support, or enterprise inquiries.', eta: 'Available now via chat' },
    pricing: { desc: 'Flexible plans for every stage of your journey.', eta: 'Launching soon' },
    legal: { desc: 'Our terms, privacy policy, and security commitments.', eta: 'Under review' },
  };
  const msg = messages[pageType] || messages.blog;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-md"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#52677A]/[0.06] border border-[#52677A]/10 mx-auto mb-5">
            <Clock className="h-6 w-6 text-[#7890A3]" />
          </div>
          <h1 className="text-2xl font-semibold text-white mb-2">{title}</h1>
          <p className="text-[13px] text-slate-500 mb-1">{description || msg.desc}</p>
          <p className="text-[11px] text-slate-600 mb-6">ETA: {msg.eta}</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-[13px] text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
