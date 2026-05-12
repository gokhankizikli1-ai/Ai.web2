import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import {
  Bot, Wand2, Brain, Sparkles, Code2,
  Globe, Shield, BarChart3, Cpu,
  ChevronRight, Star, Zap, Users,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const AVATARS = [
  { id: 'bot', icon: Bot, color: 'cyan' },
  { id: 'brain', icon: Brain, color: 'violet' },
  { id: 'code', icon: Code2, color: 'blue' },
  { id: 'shield', icon: Shield, color: 'red' },
  { id: 'globe', icon: Globe, color: 'emerald' },
  { id: 'chart', icon: BarChart3, color: 'amber' },
  { id: 'cpu', icon: Cpu, color: 'indigo' },
  { id: 'spark', icon: Sparkles, color: 'orange' },
];

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  cyan: { bg: 'bg-cyan-500/[0.06]', text: 'text-cyan-400/60' },
  violet: { bg: 'bg-violet-500/[0.06]', text: 'text-violet-400/60' },
  blue: { bg: 'bg-blue-500/[0.06]', text: 'text-blue-400/60' },
  red: { bg: 'bg-red-500/[0.06]', text: 'text-red-400/60' },
  emerald: { bg: 'bg-emerald-500/[0.06]', text: 'text-emerald-400/60' },
  amber: { bg: 'bg-amber-500/[0.06]', text: 'text-amber-400/60' },
  indigo: { bg: 'bg-indigo-500/[0.06]', text: 'text-indigo-400/60' },
  orange: { bg: 'bg-orange-500/[0.06]', text: 'text-orange-400/60' },
};

const WORKSPACES = ['All', 'Startup', 'Ecommerce', 'Trading', 'Coding', 'Study'];
const PERSONALITIES = ['Professional', 'Friendly', 'Concise', 'Creative', 'Technical', 'Socratic'];
const TOOL_OPTIONS = [
  { id: 'web-search', label: 'Web Search' },
  { id: 'file-analysis', label: 'File Analysis' },
  { id: 'code-execution', label: 'Code Execution' },
  { id: 'chart-creation', label: 'Chart Creation' },
  { id: 'data-export', label: 'Data Export' },
  { id: 'api-access', label: 'API Access' },
];

export default function AgentBuilder() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [agent, setAgent] = useState({
    name: '', role: '', description: '',
    avatar: 'bot', color: 'cyan',
    personality: 'Professional',
    workspace: 'All',
    systemPrompt: '',
    tools: [] as string[],
    memoryMode: 'session',
    visibility: 'private',
  });

  const update = (partial: Partial<typeof agent>) => setAgent((prev) => ({ ...prev, ...partial }));
  const toggleTool = (id: string) => update({ tools: agent.tools.includes(id) ? agent.tools.filter((t) => t !== id) : [...agent.tools, id] });

  const selectedAvatar = AVATARS.find((a) => a.id === agent.avatar) || AVATARS[0];
  const c = COLOR_MAP[agent.color] || COLOR_MAP.cyan;

  const steps = [
    { label: 'Identity', desc: 'Name, avatar, role' },
    { label: 'Personality', desc: 'Behavior & prompt' },
    { label: 'Tools', desc: 'Capabilities' },
    { label: 'Publish', desc: 'Deploy or save' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navigation />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-6 pb-12">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/[0.08] border border-indigo-500/15">
              <Wand2 className="h-5 w-5 text-indigo-400/70" />
            </div>
            <div>
              <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight">Agent Builder</h1>
              <p className="text-[13px] text-slate-500">Design, configure, and launch your own AI agent.</p>
            </div>
          </div>
        </motion.div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((s, i) => (
            <button key={s.label} onClick={() => setStep(i)}
              className={`flex-1 rounded-lg border px-3 py-2 text-left transition-all ${
                i === step ? 'bg-white/[0.04] border-white/[0.06]' : 'bg-transparent border-white/[0.02] opacity-50 hover:opacity-70'
              }`}>
              <div className="text-[11px] font-medium text-slate-400">{s.label}</div>
              <div className="text-[9px] text-slate-700">{s.desc}</div>
            </button>
          ))}
        </div>

        {/* Step content */}
        <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="space-y-5">

          {/* ── Step 1: Identity ── */}
          {step === 0 && (
            <>
              <div>
                <label className="text-[12px] text-slate-400 mb-2 block">Agent Name</label>
                <input type="text" value={agent.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Startup Mentor"
                  className="w-full rounded-lg bg-white/[0.02] border border-white/[0.05] px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-700 outline-none focus:border-indigo-500/20 transition-colors" />
              </div>

              <div>
                <label className="text-[12px] text-slate-400 mb-2 block">Role / Title</label>
                <input type="text" value={agent.role} onChange={(e) => update({ role: e.target.value })} placeholder="e.g. AI Startup Advisor"
                  className="w-full rounded-lg bg-white/[0.02] border border-white/[0.05] px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-700 outline-none focus:border-indigo-500/20 transition-colors" />
              </div>

              <div>
                <label className="text-[12px] text-slate-400 mb-2 block">Description</label>
                <textarea value={agent.description} onChange={(e) => update({ description: e.target.value })} placeholder="What does this agent do?" rows={3}
                  className="w-full rounded-lg bg-white/[0.02] border border-white/[0.05] px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-700 outline-none focus:border-indigo-500/20 resize-none transition-colors" />
              </div>

              <div>
                <label className="text-[12px] text-slate-400 mb-2 block">Avatar</label>
                <div className="flex gap-2">
                  {AVATARS.map((a) => (
                    <button key={a.id} onClick={() => update({ avatar: a.id, color: a.color })}
                      className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-all ${
                        agent.avatar === a.id ? `${COLOR_BG[a.color] || ''} border-${a.color}-500/20 ring-1 ring-${a.color}-400/20` : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.04]'
                      }`}>
                      <a.icon className={`h-4 w-4 ${COLOR_TEXT[a.color] || ''}`} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Step 2: Personality ── */}
          {step === 1 && (
            <>
              <div>
                <label className="text-[12px] text-slate-400 mb-2 block">Personality</label>
                <div className="flex flex-wrap gap-1.5">
                  {PERSONALITIES.map((p) => (
                    <button key={p} onClick={() => update({ personality: p })}
                      className={`px-3 py-1.5 rounded-md text-[11px] transition-all ${agent.personality === p ? 'bg-white/[0.06] text-white border border-white/[0.08]' : 'text-slate-600 hover:text-slate-400 bg-white/[0.01] border border-white/[0.03]'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[12px] text-slate-400 mb-2 block">System Prompt</label>
                <textarea value={agent.systemPrompt} onChange={(e) => update({ systemPrompt: e.target.value })}
                  placeholder="You are a helpful AI assistant specialized in..." rows={6}
                  className="w-full rounded-lg bg-white/[0.02] border border-white/[0.05] px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-700 outline-none focus:border-indigo-500/20 resize-none font-mono transition-colors" />
              </div>

              <div>
                <label className="text-[12px] text-slate-400 mb-2 block">Default Workspace</label>
                <div className="flex flex-wrap gap-1.5">
                  {WORKSPACES.map((w) => (
                    <button key={w} onClick={() => update({ workspace: w })}
                      className={`px-3 py-1.5 rounded-md text-[11px] transition-all ${agent.workspace === w ? 'bg-white/[0.06] text-white border border-white/[0.08]' : 'text-slate-600 hover:text-slate-400 bg-white/[0.01] border border-white/[0.03]'}`}>
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[12px] text-slate-400 mb-2 block">Memory Mode</label>
                <div className="flex gap-1.5">
                  {[
                    { id: 'session', label: 'Session Only' },
                    { id: 'workspace', label: 'Workspace' },
                    { id: 'global', label: 'Global' },
                  ].map((m) => (
                    <button key={m.id} onClick={() => update({ memoryMode: m.id })}
                      className={`flex-1 px-3 py-2 rounded-md text-[11px] transition-all ${agent.memoryMode === m.id ? 'bg-white/[0.06] text-white border border-white/[0.08]' : 'text-slate-600 hover:text-slate-400 bg-white/[0.01] border border-white/[0.03]'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Step 3: Tools ── */}
          {step === 2 && (
            <>
              <div>
                <label className="text-[12px] text-slate-400 mb-2 block">Enabled Tools</label>
                <div className="space-y-2">
                  {TOOL_OPTIONS.map((tool) => (
                    <button key={tool.id} onClick={() => toggleTool(tool.id)}
                      className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-all ${
                        agent.tools.includes(tool.id) ? 'bg-indigo-500/[0.04] border-indigo-500/15' : 'bg-white/[0.01] border-white/[0.03] hover:bg-white/[0.015]'
                      }`}>
                      <span className="text-[12px] text-slate-300">{tool.label}</span>
                      {agent.tools.includes(tool.id) && <Star className="h-3.5 w-3.5 text-indigo-400/50" />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Step 4: Publish ── */}
          {step === 3 && (
            <>
              <div className="rounded-xl border border-white/[0.04] bg-white/[0.005] p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${c.bg} border border-${agent.color}-500/15`}>
                    <selectedAvatar.icon className={`h-7 w-7 ${c.text}`} />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-semibold text-white">{agent.name || 'Untitled Agent'}</h3>
                    <p className="text-[12px] text-slate-500">{agent.role || 'No role defined'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    { label: 'Personality', value: agent.personality },
                    { label: 'Workspace', value: agent.workspace },
                    { label: 'Memory', value: agent.memoryMode },
                    { label: 'Tools', value: `${agent.tools.length} enabled` },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg bg-white/[0.015] border border-white/[0.03] px-3 py-2">
                      <div className="text-[10px] text-slate-700">{item.label}</div>
                      <div className="text-[12px] text-slate-400">{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-1.5 mb-4">
                  {[
                    { id: 'private', label: 'Private', icon: Users },
                    { id: 'public', label: 'Public', icon: Globe },
                  ].map((v) => (
                    <button key={v.id} onClick={() => update({ visibility: v.id })}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] transition-all ${
                        agent.visibility === v.id ? 'bg-white/[0.05] text-white border-white/[0.08]' : 'text-slate-600 hover:text-slate-400 border-white/[0.03]'
                      }`}>
                      <v.icon className="h-3 w-3" /> {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                onClick={() => navigate('/agents')}
                className="w-full h-10 rounded-lg bg-indigo-500/[0.08] hover:bg-indigo-500/[0.12] border border-indigo-500/15 text-indigo-400 text-[13px] font-medium transition-all flex items-center justify-center gap-2">
                <Zap className="h-4 w-4" /> Launch Agent
              </motion.button>
            </>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between pt-2">
            <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
              className="text-[12px] text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1">
              <ChevronRight className="h-3 w-3 rotate-180" /> Back
            </button>
            {step < steps.length - 1 ? (
              <button onClick={() => setStep(step + 1)}
                className="flex items-center gap-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.06] border border-white/[0.06] px-4 py-2 text-[12px] text-white transition-all">
                Next <ChevronRight className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

const COLOR_BG: Record<string, string> = {
  cyan: 'bg-cyan-500/[0.06]', violet: 'bg-violet-500/[0.06]', blue: 'bg-blue-500/[0.06]',
  red: 'bg-red-500/[0.06]', emerald: 'bg-emerald-500/[0.06]', amber: 'bg-amber-500/[0.06]',
  indigo: 'bg-indigo-500/[0.06]', orange: 'bg-orange-500/[0.06]',
};
const COLOR_TEXT: Record<string, string> = {
  cyan: 'text-cyan-400/60', violet: 'text-violet-400/60', blue: 'text-blue-400/60',
  red: 'text-red-400/60', emerald: 'text-emerald-400/60', amber: 'text-amber-400/60',
  indigo: 'text-indigo-400/60', orange: 'text-orange-400/60',
};
