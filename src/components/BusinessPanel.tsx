import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Rocket, TrendingUp, Users, Target,
  Building2, Search, Shield, Globe, Cpu, BarChart3,
} from 'lucide-react';
import type { StartupIdea, CompetitorInsight } from '@/types';

const STARTUPS: StartupIdea[] = [
  { id: 'i1', title: 'AI-Powered Contract Intelligence', category: 'LegalTech', score: 94, trend: 'rising', description: 'Real-time contract risk analysis using multimodal LLMs', marketSize: '$18B' },
  { id: 'i2', title: 'Carbon Intelligence Platform', category: 'ClimateTech', score: 89, trend: 'rising', description: 'Automated Scope 3 emissions tracking for enterprise supply chains', marketSize: '$12B' },
  { id: 'i3', title: 'Cross-Chain Liquidity Router', category: 'DeFi', score: 86, trend: 'stable', description: 'Optimal yield routing across L1/L2 protocols with MEV protection', marketSize: '$67B' },
  { id: 'i4', title: 'Distributed Team OS', category: 'Future of Work', score: 82, trend: 'emerging', description: 'Async-first collaboration with AI-generated meeting artifacts', marketSize: '$9B' },
  { id: 'i5', title: 'Neuro-Symbolic QA Engine', category: 'Enterprise AI', score: 91, trend: 'rising', description: 'Hybrid reasoning system combining neural + symbolic logic for regulated industries', marketSize: '$24B' },
];

const COMPETITORS: CompetitorInsight[] = [
  { id: 'c1', company: 'OpenAI', metric: 'API Revenue', value: '$3.4B', change: '+142% YoY', positive: true },
  { id: 'c2', company: 'Anthropic', metric: 'Enterprise Seats', value: '48K', change: '+210% YoY', positive: true },
  { id: 'c3', company: 'Stripe', metric: 'Payment Volume', value: '$1.2T', change: '+34% YoY', positive: true },
  { id: 'c4', company: 'Vercel', metric: 'Active Devs', value: '6.8M', change: '+45% YoY', positive: true },
  { id: 'c5', company: 'Notion', metric: 'Paid Teams', value: '4M+', change: '+28% YoY', positive: true },
];

function ScoreBadge({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-1 text-slate-500 bg-white/[0.015] px-2 py-[2px] rounded border border-white/[0.03]">
      <Target className="h-2.5 w-2.5" />
      <span className="text-[11px] font-mono">{score}</span>
    </div>
  );
}

function TrendBadge({ trend }: { trend: StartupIdea['trend'] }) {
  const config = {
    rising: { icon: TrendingUp, label: 'Rising' },
    stable: { icon: Shield, label: 'Stable' },
    emerging: { icon: Rocket, label: 'Emerging' },
  };
  const c = config[trend];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-slate-600 bg-white/[0.015] border border-white/[0.03] px-1.5 py-[1px] rounded">
      <c.icon className="h-2.5 w-2.5" />
      {c.label}
    </span>
  );
}

function HeatmapBar({ score }: { score: number }) {
  const segments = 10;
  const filled = Math.round((score / 100) * segments);
  return (
    <div className="flex items-center gap-[2px]">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1 rounded-full transition-all duration-500 ${
            i < filled ? 'bg-white/[0.12]' : 'bg-white/[0.02]'
          }`}
        />
      ))}
    </div>
  );
}

export default function BusinessPanel() {
  const [activeTab, setActiveTab] = useState<'scanner' | 'competitors' | 'market'>('scanner');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.02] shrink-0">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-500" />
          <span className="text-[13px] font-medium text-white">Business Intelligence</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cpu className="h-3 w-3 text-slate-800" />
          <span className="text-[10px] text-slate-800">AI-Powered</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-5 py-2 border-b border-white/[0.02] shrink-0">
        {[
          { id: 'scanner' as const, label: 'Startup Scanner', icon: Search },
          { id: 'competitors' as const, label: 'Competitor Watch', icon: Users },
          { id: 'market' as const, label: 'Market Radar', icon: Globe },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] transition-all duration-150 ${
              activeTab === tab.id
                ? 'bg-white/[0.03] text-white'
                : 'text-slate-700 hover:text-slate-500 hover:bg-white/[0.015]'
            }`}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {activeTab === 'scanner' && (
          <div className="space-y-1.5">
            {/* Header stats */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: 'Ideas Scored', value: STARTUPS.length.toString(), icon: Search },
                { label: 'Avg Score', value: Math.round(STARTUPS.reduce((a, s) => a + s.score, 0) / STARTUPS.length).toString(), icon: Target },
                { label: 'TAM Coverage', value: '$130B+', icon: BarChart3 },
              ].map((stat) => (
                <div key={stat.label} className="rounded-md bg-white/[0.005] border border-white/[0.02] px-3 py-2.5 text-center">
                  <div className="text-[13px] font-medium text-white">{stat.value}</div>
                  <div className="text-[10px] text-slate-700 mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            {STARTUPS.map((idea, i) => (
              <motion.div
                key={idea.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-lg border border-white/[0.02] bg-white/[0.005] p-3.5 hover:bg-white/[0.01] hover:border-white/[0.04] transition-all duration-200 group cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-slate-800 font-mono shrink-0">#{i + 1}</span>
                    <h4 className="text-[12px] font-normal text-slate-300 group-hover:text-white transition-colors truncate">
                      {idea.title}
                    </h4>
                  </div>
                  <ScoreBadge score={idea.score} />
                </div>

                <HeatmapBar score={idea.score} />

                <p className="text-[11px] text-slate-600 leading-relaxed mt-2 mb-2">{idea.description}</p>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-700 bg-white/[0.01] px-1.5 py-[1px] rounded border border-white/[0.02]">{idea.category}</span>
                  <TrendBadge trend={idea.trend} />
                  <span className="text-[10px] text-slate-800 ml-auto flex items-center gap-1">
                    <Globe className="h-2.5 w-2.5" />
                    TAM: {idea.marketSize}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {activeTab === 'competitors' && (
          <div className="rounded-lg border border-white/[0.02] bg-white/[0.005] divide-y divide-white/[0.015]">
            {COMPETITORS.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.01] transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.02] border border-white/[0.03]">
                    <span className="text-[9px] font-medium text-slate-600">{c.company.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div>
                    <span className="text-[12px] text-slate-400 group-hover:text-slate-300 transition-colors">{c.company}</span>
                    <div className="text-[10px] text-slate-800">{c.metric}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12px] text-slate-300 font-mono">{c.value}</span>
                  <span className="text-[10px] text-slate-600 flex items-center gap-0.5">
                    <TrendingUp className="h-3 w-3" />
                    {c.change}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {activeTab === 'market' && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <Globe className="h-8 w-8 text-slate-800 mb-3" />
            <p className="text-[12px] text-slate-700 mb-1">Market Radar</p>
            <p className="text-[11px] text-slate-800 max-w-xs">Real-time market intelligence dashboard coming soon. Track sector momentum, funding rounds, and acquisition signals.</p>
          </div>
        )}
      </div>
    </div>
  );
}
