import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Cpu, Wand2, Layers, Database,
  CheckCircle2, ChevronRight, Loader2,
  Monitor, Server, Code2, Box,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const TECH_STACKS = [
  { name: 'React + Node.js + PostgreSQL', match: 94, tags: ['Full-stack', 'Scalable'] },
  { name: 'Next.js + Prisma + Vercel', match: 89, tags: ['Serverless', 'Fast'] },
  { name: 'Vue + Firebase', match: 82, tags: ['Rapid', 'Realtime'] },
];

const MVP_CHECKLIST = [
  'User authentication (OAuth + email)',
  'Core feature implementation',
  'Basic dashboard / admin panel',
  'Payment integration (Stripe)',
  'Email notifications',
  'Basic analytics',
  'Mobile responsive design',
  'Deploy to production',
];

export default function AppBuilder() {
  const [idea, setIdea] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [expanded, setExpanded] = useState<string | null>('structure');

  const handleGenerate = () => {
    if (!idea.trim()) return;
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 1800);
  };

  const sections = [
    {
      id: 'structure',
      title: 'App Structure',
      icon: Layers,
      content: 'Frontend (React SPA)\\nBackend (REST API + WebSocket)\\nDatabase (PostgreSQL)\\nAuth (JWT + OAuth2)\\nStorage (S3-compatible)\\nCache (Redis)',
    },
    {
      id: 'pages',
      title: 'Pages',
      icon: Monitor,
      content: '/ — Landing page with hero, features, CTA\\n/dashboard — Main dashboard with analytics\\n/settings — User preferences and account\\n/projects — Project management CRUD\\n/team — Team members and roles\\n/billing — Subscription and invoices',
    },
    {
      id: 'components',
      title: 'Components',
      icon: Box,
      content: 'Layout — Header, Sidebar, Footer, Shell\\nData — Table, Card, Chart, FilterBar\\nForms — Input, Select, DatePicker, Upload\\nFeedback — Toast, Modal, Skeleton, EmptyState\\nNavigation — Breadcrumb, Tabs, Pagination',
    },
    {
      id: 'database',
      title: 'Database Model',
      icon: Database,
      content: 'users (id, email, name, role, created_at)\\nprojects (id, user_id, title, status, config)\\ntasks (id, project_id, title, status, priority, due_date)\\nteams (id, name, owner_id)\\nmemberships (team_id, user_id, role)\\nactivities (id, actor_id, action, target, created_at)',
    },
    {
      id: 'api',
      title: 'API Routes',
      icon: Server,
      content: 'GET /api/projects — List projects\\nPOST /api/projects — Create project\\nGET /api/projects/:id — Get project\\nPUT /api/projects/:id — Update project\\nDELETE /api/projects/:id — Delete project\\nGET /api/analytics — Dashboard metrics',
    },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

          <motion.div {...fadeUp(0)} className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/[0.1] border border-indigo-500/15">
                <Cpu className="h-4 w-4 text-indigo-400" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">App Builder</h1>
            </div>
            <p className="text-[13px] text-slate-500 ml-11">Describe your app idea and get structure, stack, and MVP plan</p>
          </motion.div>

          {/* Input */}
          <motion.div {...fadeUp(0.05)} className="mb-6">
            <div className="flex gap-2">
              <input
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Describe your app idea..."
                className="flex-1 h-12 px-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[14px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/20 focus:bg-white/[0.03] transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerate}
                disabled={generating || !idea.trim()}
                className="h-12 px-6 rounded-xl bg-indigo-500/[0.1] border border-indigo-500/15 text-indigo-400 font-medium text-[13px] hover:bg-indigo-500/[0.15] transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Plan
              </motion.button>
            </div>
          </motion.div>

          {generated && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">

              {/* Tech Stack */}
              <div className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-indigo-400" /> Recommended Tech Stack
                </h3>
                <div className="space-y-2">
                  {TECH_STACKS.map((stack, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02]">
                      <div className="flex-1">
                        <p className="text-[12px] font-medium text-white">{stack.name}</p>
                        <div className="flex gap-1.5 mt-1">
                          {stack.tags.map((t) => (
                            <span key={t} className="px-1.5 py-0.5 rounded bg-white/[0.03] text-[9px] text-slate-500">{t}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[14px] font-semibold text-emerald-400">{stack.match}%</span>
                        <p className="text-[9px] text-slate-600">match</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Expandable Sections */}
              {sections.map((section) => (
                <motion.div
                  key={section.id}
                  layout
                  className="rounded-2xl border border-white/[0.03] bg-white/[0.01] overflow-hidden"
                >
                  <button
                    onClick={() => setExpanded(expanded === section.id ? null : section.id)}
                    className="flex items-center gap-3 w-full px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <section.icon className="w-4 h-4 text-indigo-400" />
                    <span className="text-[13px] font-medium text-white flex-1">{section.title}</span>
                    <motion.div animate={{ rotate: expanded === section.id ? 90 : 0 }}>
                      <ChevronRight className="w-4 h-4 text-slate-600" />
                    </motion.div>
                  </button>
                  <motion.div
                    initial={false}
                    animate={{ height: expanded === section.id ? 'auto' : 0, opacity: expanded === section.id ? 1 : 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4">
                      <pre className="whitespace-pre-line text-[12px] text-slate-400 leading-relaxed font-mono bg-white/[0.02] p-4 rounded-xl">
                        {section.content}
                      </pre>
                    </div>
                  </motion.div>
                </motion.div>
              ))}

              {/* MVP Checklist */}
              <div className="p-5 rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.02]">
                <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" /> MVP Checklist
                </h3>
                <div className="space-y-2">
                  {MVP_CHECKLIST.map((item, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <div className="flex h-4 w-4 items-center justify-center rounded border border-emerald-500/30 bg-emerald-500/[0.06]">
                        <span className="text-[9px] text-emerald-400">{i + 1}</span>
                      </div>
                      <span className="text-[12px] text-slate-400">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {!generated && !generating && (
            <motion.div {...fadeUp(0.1)} className="text-center py-16">
              <Cpu className="w-12 h-12 text-slate-700 mx-auto mb-4" />
              <h3 className="text-sm font-medium text-white mb-1">Describe your app idea</h3>
              <p className="text-[12px] text-slate-500">Get app structure, pages, components, database model, API routes, and tech stack</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
