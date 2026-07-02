import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Flame, Wand2, Loader2, Copy, CheckCircle2, Sparkles,
  Video, Camera, MessageSquare, ThumbsUp, Eye,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const CONTENT_TYPES = [
  { id: 'tiktok', label: 'TikTok Scripts', icon: Video, color: 'rose' },
  { id: 'youtube', label: 'YouTube Ideas', icon: Camera, color: 'red' },
  { id: 'instagram', label: 'Instagram Carousel', icon: Camera, color: 'pink' },
  { id: 'twitter', label: 'X / Twitter Threads', icon: MessageSquare, color: 'blue' },
  { id: 'adhooks', label: 'Ad Hooks', icon: Sparkles, color: 'amber' },
  { id: 'videoangles', label: 'Video Angles', icon: Video, color: 'violet' },
  { id: 'thumbnails', label: 'Thumbnail Prompts', icon: Eye, color: 'orange' },
  { id: 'ctas', label: 'CTA Generator', icon: ThumbsUp, color: 'emerald' },
];

const MOCK_OUTPUTS: Record<string, string[]> = {
  tiktok: [
    'Hook: "This $19 gadget saved me $400 last month"',
    'Hook: "POV: You finally found the product that actually works"',
    'Hook: "3 things I wish I knew before starting [niche]"',
    'CTA: "Link in bio — limited stock"',
  ],
  youtube: [
    'Video: "I Tried [Product] for 30 Days — Here\'s What Happened"',
    'Video: "The Truth About [Industry] Nobody Talks About"',
    'Video: "How I Made $X in [Timeframe] With [Method]"',
    'Video: "5 [Niche] Mistakes That Cost You Money"',
  ],
  instagram: [
    'Slide 1: Problem statement hook',
    'Slide 2: Statistics that shock',
    'Slide 3: The solution revealed',
    'Slide 4: Social proof / testimonial',
    'Slide 5: CTA with link',
  ],
  twitter: [
    'Tweet 1/5: "I spent 6 months studying [topic]. Here are 5 insights that changed everything:"',
    'Tweet 2/5: "Most people get [topic] wrong because they focus on X instead of Y."',
    'Tweet 3/5: "The counter-intuitive truth: [insight]"',
    'Tweet 4/5: "Here\'s the framework I use: [simple breakdown]"',
    'Tweet 5/5: "If you found this helpful, follow @handle for more [topic] insights."',
  ],
  adhooks: [
    '"Stop scrolling if you\'re tired of [pain point]"',
    '"The [product] that [benefit] in just [timeframe]"',
    '"Why [target audience] are switching to [product]"',
    '"This one trick [result] without [common objection]"',
  ],
  videoangles: [
    'Behind-the-scenes: Show the making of your product',
    'Before/After: Dramatic transformation narrative',
    'Day in the life: Founder/product user routine',
    'Myth-busting: Debunk common misconceptions',
  ],
  thumbnails: [
    ' shocked face + red circle around product + "YOU WON\'T BELIEVE"',
    ' split screen: before/after with dramatic lighting',
    ' close-up of result + large text overlay + arrow pointing',
    ' money/visual representation of savings + surprised expression',
  ],
  ctas: [
    'Shop Now — Free shipping ends tonight',
    'Get 50% Off — First 100 customers only',
    'Try Free for 14 Days — No credit card required',
    'Join 10,000+ Happy Customers — Start today',
  ],
};

export default function ViralContent() {
  const [activeType, setActiveType] = useState('tiktok');
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState<string[] | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const handleGenerate = () => {
    if (!topic.trim()) return;
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setOutput(MOCK_OUTPUTS[activeType] || MOCK_OUTPUTS.tiktok);
    }, 1200);
  };

  const copyItem = (text: string, i: number) => {
    navigator.clipboard.writeText(text);
    setCopied(i);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">

          <motion.div {...fadeUp(0)} className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#8B5CF6]/[0.1] border border-[#8B5CF6]/15">
                <Flame className="h-4 w-4 text-[#A78BFA]" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Viral Content Engine</h1>
            </div>
            <p className="text-[13px] text-[#858B99] ml-11">Generate TikTok scripts, YouTube ideas, Instagram carousels, X threads, and more</p>
          </motion.div>

          {/* Type Selector */}
          <motion.div {...fadeUp(0.05)} className="mb-6">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {CONTENT_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setActiveType(t.id); setOutput(null); }}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium transition-all whitespace-nowrap ${
                    activeType === t.id
                      ? 'bg-white/[0.06] text-white border border-white/[0.06]'
                      : 'text-[#858B99] hover:text-slate-300 bg-white/[0.02] border border-white/[0.03]'
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Topic Input */}
          <motion.div {...fadeUp(0.08)} className="mb-6">
            <div className="flex gap-2">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What topic or product?"
                className="flex-1 h-11 px-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[14px] text-slate-300 placeholder:text-[#858B99] focus:outline-none focus:border-[#8B5CF6]/20 focus:bg-white/[0.03] transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerate}
                disabled={generating || !topic.trim()}
                className="h-11 px-5 rounded-xl bg-[#8B5CF6]/[0.1] border border-[#8B5CF6]/15 text-[#A78BFA] font-medium text-[13px] hover:bg-[#8B5CF6]/[0.15] transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Generate
              </motion.button>
            </div>
          </motion.div>

          {/* Output */}
          {output && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
              {output.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.03] hover:border-white/[0.06] transition-all group"
                >
                  <span className="text-[10px] text-[#858B99] font-mono mt-0.5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                  <p className="text-[13px] text-slate-300 flex-1">{line}</p>
                  <button
                    onClick={() => copyItem(line, i)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    {copied === i ? <CheckCircle2 className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5 text-[#858B99]" />}
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}

          {!output && !generating && (
            <motion.div {...fadeUp(0.1)} className="text-center py-16">
              <Flame className="w-12 h-12 text-[#858B99] mx-auto mb-4" />
              <h3 className="text-sm font-medium text-white mb-1">Select a content type and enter a topic</h3>
              <p className="text-[12px] text-[#858B99]">AI will generate viral content optimized for your platform</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
