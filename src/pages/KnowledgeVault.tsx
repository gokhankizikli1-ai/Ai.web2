import { motion } from 'framer-motion';
import {
  BookOpen, Upload, FileText, Brain, Search,
  AlertCircle, MessageSquare,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import { useState } from 'react';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const COLLECTIONS = [
  { name: 'Startup Research', count: 24, icon: FileText, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.06]' },
  { name: 'Product Docs', count: 12, icon: FileText, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.06]' },
  { name: 'Market Analysis', count: 8, icon: Brain, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.06]' },
  { name: 'Brand Guidelines', count: 5, icon: BookOpen, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.06]' },
];

const SOURCES = [
  { name: 'NVDA_Q3_Report.pdf', type: 'PDF', size: '2.4 MB', date: '2 days ago', indexed: true },
  { name: 'Competitor_Analysis.docx', type: 'DOC', size: '1.1 MB', date: '5 days ago', indexed: true },
  { name: 'Product_Roadmap_2026.md', type: 'MD', size: '156 KB', date: '1 week ago', indexed: false },
  { name: 'Brand_Voice_Guide.pdf', type: 'PDF', size: '890 KB', date: '2 weeks ago', indexed: true },
];

export default function KnowledgeVault() {
  const [query, setQuery] = useState('');

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">

          <motion.div {...fadeUp(0)} className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#52677A]/[0.1] border border-[#52677A]/15">
                <BookOpen className="h-4 w-4 text-[#7890A3]" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Knowledge Vault</h1>
            </div>
            <p className="text-[13px] text-slate-500 ml-11">Store, organize, and query your documents and knowledge base</p>
          </motion.div>

          {/* Upload Area */}
          <motion.div {...fadeUp(0.05)} className="mb-6 p-6 rounded-2xl border border-dashed border-white/[0.06] bg-white/[0.01] text-center hover:border-white/[0.1] hover:bg-white/[0.02] transition-all cursor-pointer">
            <Upload className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <h3 className="text-[13px] font-medium text-white mb-1">Upload Documents</h3>
            <p className="text-[11px] text-slate-500">PDFs, Word docs, Markdown files, and text notes</p>
            <p className="text-[10px] text-slate-600 mt-2">Backend not connected — upload is simulated</p>
          </motion.div>

          {/* Collections */}
          <motion.div {...fadeUp(0.1)} className="mb-6">
            <h3 className="text-sm font-medium text-white mb-3">Collections</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {COLLECTIONS.map((c) => (
                <motion.div
                  key={c.name}
                  whileHover={{ y: -2 }}
                  className="p-4 rounded-xl border border-white/[0.03] bg-white/[0.01] hover:border-white/[0.06] cursor-pointer transition-all"
                >
                  <div className={`p-2 rounded-lg ${c.bg} w-fit mb-2`}>
                    <c.icon className={`w-4 h-4 ${c.color}`} />
                  </div>
                  <p className="text-[12px] font-medium text-white">{c.name}</p>
                  <p className="text-[10px] text-slate-500">{c.count} documents</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Sources */}
          <motion.div {...fadeUp(0.15)} className="mb-6">
            <h3 className="text-sm font-medium text-white mb-3">Recent Sources</h3>
            <div className="space-y-1">
              {SOURCES.map((s, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.02] bg-white/[0.01]">
                  <FileText className="w-4 h-4 text-slate-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-slate-300 truncate">{s.name}</p>
                    <p className="text-[10px] text-slate-600">{s.type} · {s.size} · {s.date}</p>
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full ${s.indexed ? 'bg-[#6F8F7A]/[0.08] text-[#6F8F7A]' : 'bg-[#A68A5B]/[0.08] text-[#A68A5B]'}`}>
                    {s.indexed ? 'Indexed' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Memory Status */}
          <motion.div {...fadeUp(0.2)} className="mb-6 p-4 rounded-2xl border border-[#6F8F7A]/10 bg-[#6F8F7A]/[0.02]">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-4 h-4 text-[#6F8F7A]" />
              <span className="text-[12px] font-medium text-white">Memory Status</span>
              <span className="text-[10px] text-[#6F8F7A] ml-auto">Active</span>
            </div>
            <p className="text-[11px] text-slate-500">49 documents indexed · 12 collections · Last indexed: 2 hours ago</p>
          </motion.div>

          {/* Ask Knowledge Base */}
          <motion.div {...fadeUp(0.25)}>
            <h3 className="text-sm font-medium text-white mb-3">Ask Your Knowledge Base</h3>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <MessageSquare className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask anything about your documents..."
                  className="w-full h-12 pl-11 pr-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[14px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-[#52677A]/20 focus:bg-white/[0.03] transition-all"
                />
              </div>
              <button className="h-12 px-5 rounded-xl bg-[#52677A]/[0.1] border border-[#52677A]/15 text-[#7890A3] hover:bg-[#52677A]/[0.15] transition-colors">
                <Search className="w-4 h-4" />
              </button>
            </div>
          </motion.div>

          {/* Placeholder notice */}
          <motion.div {...fadeUp(0.3)} className="mt-6 p-4 rounded-2xl border border-[#A68A5B]/10 bg-[#A68A5B]/[0.02] text-center">
            <AlertCircle className="w-5 h-5 text-[#A68A5B] mx-auto mb-2" />
            <p className="text-[11px] text-slate-500">Knowledge Vault backend not fully connected. Upload and indexing are simulated.</p>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
