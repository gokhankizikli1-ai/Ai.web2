import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Globe, Search, Layout, Zap, FileText, BarChart3,
  AlertCircle, CheckCircle2, AlertTriangle,
  TrendingUp, Clock, Sparkles,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import WidgetCard from '@/components/WidgetCard';
import CircularGauge from '@/components/CircularGauge';

type Tab = 'ux' | 'seo' | 'conversion' | 'performance' | 'copywriting' | 'competitor';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const CHECKLIST = [
  { label: 'Mobile responsive', status: 'pass' },
  { label: 'Page has meta description', status: 'pass' },
  { label: 'Clear CTA above fold', status: 'pass' },
  { label: 'Heading hierarchy correct', status: 'warn' },
  { label: 'Image alt texts present', status: 'pass' },
  { label: 'SSL certificate active', status: 'pass' },
  { label: 'Loading time < 3s', status: 'warn' },
  { label: 'Social proof visible', status: 'fail' },
  { label: 'Contact info accessible', status: 'pass' },
  { label: 'Privacy policy linked', status: 'pass' },
];

export default function WebsiteAnalyzer() {
  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('ux');
  const [analyzed, setAnalyzed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = () => {
    if (!url.trim()) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setAnalyzed(true);
    }, 1500);
  };

  const tabs: { id: Tab; label: string; icon: typeof Layout; score: number }[] = [
    { id: 'ux', label: 'UX', icon: Layout, score: 78 },
    { id: 'seo', label: 'SEO', icon: BarChart3, score: 65 },
    { id: 'conversion', label: 'Conversion', icon: TrendingUp, score: 52 },
    { id: 'performance', label: 'Speed', icon: Zap, score: 71 },
    { id: 'copywriting', label: 'Copy', icon: FileText, score: 83 },
    { id: 'competitor', label: 'Competitors', icon: Globe, score: 0 },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">

          {/* Header */}
          <motion.div {...fadeUp(0)} className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#7EA6BF]/[0.1] border border-[#7EA6BF]/15">
                <Globe className="h-4 w-4 text-[#9CBBD1]" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Website Analyzer</h1>
            </div>
            <p className="text-[13px] text-[#7F8FA3] ml-11">Analyze any website for UX, SEO, conversion, speed, and copy</p>
          </motion.div>

          {/* URL Input */}
          <motion.div {...fadeUp(0.05)} className="mb-8">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7F8FA3]" />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full h-12 pl-11 pr-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[14px] text-slate-300 placeholder:text-[#7F8FA3] focus:outline-none focus:border-[#7EA6BF]/20 focus:bg-white/[0.03] transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                />
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleAnalyze}
                disabled={loading || !url.trim()}
                className="h-12 px-6 rounded-xl bg-[#7EA6BF]/[0.1] border border-[#7EA6BF]/15 text-[#9CBBD1] font-medium text-[13px] hover:bg-[#7EA6BF]/[0.15] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                    <Clock className="w-4 h-4" />
                  </motion.div>
                ) : (
                  <>
                    <Search className="w-4 h-4" /> Analyze
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>

          {/* Results */}
          {analyzed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {/* Overall Score */}
              <div className="mb-6 p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <div className="flex items-center gap-6">
                  <CircularGauge value={72} size={80} strokeWidth={6} label="Overall Score" />
                  <div className="flex-1 grid grid-cols-3 gap-4">
                    {tabs.slice(0, 5).map((t) => (
                      <div key={t.id} className="text-center">
                        <p className="text-lg font-semibold text-white">{t.score}</p>
                        <p className="text-[10px] text-[#7F8FA3]">{t.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Analysis Tabs */}
              <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.03] mb-6 overflow-x-auto">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
                      activeTab === t.id ? 'bg-white/[0.06] text-white' : 'text-[#7F8FA3] hover:text-slate-300'
                    }`}
                  >
                    <t.icon className="w-3.5 h-3.5" /> {t.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {activeTab === 'ux' && (
                  <>
                    <WidgetCard title="UX Findings" icon={<Layout className="w-3.5 h-3.5" />} delay={0}>
                      <div className="space-y-2">
                        {[
                          { text: 'Navigation is clear and consistent', score: 'good' },
                          { text: 'CTA placement could be improved', score: 'warn' },
                          { text: 'Mobile menu needs hamburger pattern', score: 'warn' },
                          { text: 'Form labels are well-associated', score: 'good' },
                          { text: 'Color contrast meets WCAG AA', score: 'good' },
                        ].map((item, i) => (
                          <div key={i} className="flex items-center gap-2">
                            {item.score === 'good' ? <CheckCircle2 className="w-3.5 h-3.5 text-[#86A88B] shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 text-[#C2A15A] shrink-0" />}
                            <span className="text-[12px] text-[#A9B7C6]">{item.text}</span>
                          </div>
                        ))}
                      </div>
                    </WidgetCard>
                  </>
                )}

                {activeTab === 'seo' && (
                  <WidgetCard title="SEO Analysis" icon={<BarChart3 className="w-3.5 h-3.5" />} delay={0}>
                    <div className="space-y-2">
                      {[
                        { text: 'Title tag is present and optimized', score: 'good' },
                        { text: 'Meta description missing on 2 pages', score: 'warn' },
                        { text: 'H1 used correctly, single per page', score: 'good' },
                        { text: 'No structured data / schema markup', score: 'warn' },
                        { text: 'Image alt text missing on 40% of images', score: 'fail' },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-2">
                          {item.score === 'good' && <CheckCircle2 className="w-3.5 h-3.5 text-[#86A88B] shrink-0" />}
                          {item.score === 'warn' && <AlertTriangle className="w-3.5 h-3.5 text-[#C2A15A] shrink-0" />}
                          {item.score === 'fail' && <AlertCircle className="w-3.5 h-3.5 text-[#C98282] shrink-0" />}
                          <span className="text-[12px] text-[#A9B7C6]">{item.text}</span>
                        </div>
                      ))}
                    </div>
                  </WidgetCard>
                )}

                {activeTab === 'competitor' && (
                  <div className="p-6 rounded-2xl border border-[#C2A15A]/10 bg-[#C2A15A]/[0.02] text-center">
                    <AlertCircle className="w-8 h-8 text-[#C2A15A] mx-auto mb-3" />
                    <h3 className="text-sm font-medium text-white mb-1">Competitor Analysis Backend Not Connected</h3>
                    <p className="text-[12px] text-[#7F8FA3]">This feature requires a research backend. Connect it to enable competitor comparisons.</p>
                  </div>
                )}

                {(activeTab === 'conversion' || activeTab === 'performance' || activeTab === 'copywriting') && (
                  <WidgetCard title={`${tabs.find((t) => t.id === activeTab)?.label} Analysis`} icon={<Sparkles className="w-3.5 h-3.5" />} delay={0}>
                    <div className="space-y-2">
                      {[
                        { text: 'Key strength identified in section analysis', score: 'good' },
                        { text: 'One area flagged for improvement', score: 'warn' },
                        { text: 'Overall structure meets best practices', score: 'good' },
                        { text: 'Recommendation: A/B test headline variants', score: 'warn' },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-2">
                          {item.score === 'good' ? <CheckCircle2 className="w-3.5 h-3.5 text-[#86A88B] shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 text-[#C2A15A] shrink-0" />}
                          <span className="text-[12px] text-[#A9B7C6]">{item.text}</span>
                        </div>
                      ))}
                    </div>
                  </WidgetCard>
                )}
              </motion.div>

              {/* Improvement Checklist */}
              <div className="mt-6 p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h3 className="text-sm font-medium text-white mb-4">Improvement Checklist</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {CHECKLIST.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 py-1">
                      {item.status === 'pass' && <CheckCircle2 className="w-3.5 h-3.5 text-[#86A88B] shrink-0" />}
                      {item.status === 'warn' && <AlertTriangle className="w-3.5 h-3.5 text-[#C2A15A] shrink-0" />}
                      {item.status === 'fail' && <AlertCircle className="w-3.5 h-3.5 text-[#C98282] shrink-0" />}
                      <span className="text-[11px] text-[#A9B7C6]">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Empty state before analysis */}
          {!analyzed && !loading && (
            <motion.div {...fadeUp(0.1)} className="text-center py-16">
              <Globe className="w-12 h-12 text-[#7F8FA3] mx-auto mb-4" />
              <h3 className="text-sm font-medium text-white mb-1">Enter a URL to start analyzing</h3>
              <p className="text-[12px] text-[#7F8FA3]">Get UX, SEO, conversion, and performance insights</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
