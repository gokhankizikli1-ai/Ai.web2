import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Palette, Wand2, Loader2, Copy, CheckCircle2,
  PenTool, Users, Target, Sparkles,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
// CircularGauge available if needed for future enhancements

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const COLOR_PALETTE = [
  { name: 'Midnight Navy', hex: '#0A192F', role: 'Primary' },
  { name: 'Electric Cyan', hex: '#7890A3', role: 'Accent' },
  { name: 'Soft Coral', hex: '#F4726B', role: 'CTA' },
  { name: 'Cloud White', hex: '#F8FAFC', role: 'Background' },
  { name: 'Slate', hex: '#475569', role: 'Text' },
];

const BRAND_NAMES = ['Nexora', 'Veltrix', 'Aurion', 'Kyvos'];
const SLOGANS = ['Intelligence Meets Simplicity', 'Built for What\'s Next', 'Your Ideas, Amplified'];
const TONES = ['Professional yet approachable', 'Bold and innovative', 'Trustworthy and modern'];
const AUDIENCES = ['Tech-savvy professionals aged 25-45', 'Startup founders and product teams', 'Enterprise decision makers'];
const POSITIONING = ['The AI-powered platform that transforms how teams build products', 'Enterprise-grade intelligence with consumer-grade simplicity'];

export default function BrandBuilder() {
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const handleGenerate = () => {
    if (!description.trim()) return;
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 1500);
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

          <motion.div {...fadeUp(0)} className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#52677A]/[0.1] border border-[#52677A]/15">
                <Palette className="h-4 w-4 text-[#7890A3]" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Brand Builder</h1>
            </div>
            <p className="text-[13px] text-slate-500 ml-11">Generate brand identity — name, slogan, colors, typography, and positioning</p>
          </motion.div>

          {/* Input */}
          <motion.div {...fadeUp(0.05)} className="mb-6">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your business, product, or vision..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[14px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-[#52677A]/20 focus:bg-white/[0.03] transition-all resize-none"
            />
            <div className="flex justify-end mt-2">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerate}
                disabled={generating || !description.trim()}
                className="h-10 px-5 rounded-xl bg-[#52677A]/[0.1] border border-[#52677A]/15 text-[#7890A3] font-medium text-[13px] hover:bg-[#52677A]/[0.15] transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Generate Brand Kit
              </motion.button>
            </div>
          </motion.div>

          {generated && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">

              {/* Brand Name Ideas */}
              <div className="p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#7890A3]" /> Brand Name Ideas
                </h3>
                <div className="flex gap-2 flex-wrap">
                  {BRAND_NAMES.map((name) => (
                    <button
                      key={name}
                      onClick={() => copy(name, `name-${name}`)}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.03] hover:border-white/[0.08] transition-all group"
                    >
                      <span className="text-[13px] font-medium text-white">{name}</span>
                      {copied === `name-${name}` ? <CheckCircle2 className="w-3 h-3 text-[#6F8F7A]" /> : <Copy className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Slogan */}
              <div className="p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <PenTool className="w-4 h-4 text-[#7890A3]" /> Slogan Options
                </h3>
                <div className="space-y-2">
                  {SLOGANS.map((slogan, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02]">
                      <span className="text-[12px] text-slate-400 italic">"{slogan}"</span>
                      <button onClick={() => copy(slogan, `slogan-${i}`)}>
                        {copied === `slogan-${i}` ? <CheckCircle2 className="w-3.5 h-3.5 text-[#6F8F7A]" /> : <Copy className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400" />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Color Palette */}
              <div className="p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <Palette className="w-4 h-4 text-[#7890A3]" /> Color Palette
                </h3>
                <div className="flex gap-3">
                  {COLOR_PALETTE.map((color) => (
                    <div key={color.hex} className="flex flex-col items-center gap-1.5 flex-1">
                      <div
                        className="w-full h-14 rounded-xl border border-white/[0.06]"
                        style={{ backgroundColor: color.hex }}
                      />
                      <span className="text-[9px] text-slate-500 font-mono">{color.hex}</span>
                      <span className="text-[10px] text-slate-400">{color.role}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Two Column: Tone + Audience */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                  <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-[#7890A3]" /> Tone of Voice
                  </h3>
                  <div className="space-y-1.5">
                    {TONES.map((t, i) => (
                      <p key={i} className="text-[12px] text-slate-400">• {t}</p>
                    ))}
                  </div>
                </div>
                <div className="p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                  <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#7890A3]" /> Target Audience
                  </h3>
                  <div className="space-y-1.5">
                    {AUDIENCES.map((a, i) => (
                      <p key={i} className="text-[12px] text-slate-400">• {a}</p>
                    ))}
                  </div>
                </div>
              </div>

              {/* Positioning */}
              <div className="p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h3 className="text-sm font-medium text-white mb-3">Positioning Statement</h3>
                {POSITIONING.map((p, i) => (
                  <p key={i} className="text-[13px] text-slate-400 leading-relaxed mb-2">{p}</p>
                ))}
              </div>
            </motion.div>
          )}

          {!generated && !generating && (
            <motion.div {...fadeUp(0.1)} className="text-center py-16">
              <Palette className="w-12 h-12 text-[#64748B] mx-auto mb-4" />
              <h3 className="text-sm font-medium text-white mb-1">Describe your brand</h3>
              <p className="text-[12px] text-slate-500">AI will generate name ideas, slogan, color palette, tone, audience, and positioning</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
