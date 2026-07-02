import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen, Plus, ArrowLeft, Sparkles, X, Pencil, Check,
} from 'lucide-react';
import type { Project } from '@/types/projects';
import ProjectCard from '@/components/ProjectCard';
import DeleteConfirmModal from '@/components/DeleteConfirmModal';
import { getProjects, addProject, deleteProject as deleteProjectFromStore } from '@/stores/projectStore';

/* ─── Category config ─── */
const CATEGORIES = [
  { id: 'ecommerce', label: 'Ecommerce', gradient: 'from-[#8B5CF6] to-[#A78BFA]', glow: 'rgba(139, 92, 246,0.2)', color: 'emerald' },
  { id: 'trading', label: 'Trading', gradient: 'from-[#8B5CF6] to-[#A78BFA]', glow: 'rgba(139, 92, 246,0.2)', color: 'cyan' },
  { id: 'startup', label: 'Startup', gradient: 'from-[#8B5CF6] to-[#A78BFA]', glow: 'rgba(139, 92, 246,0.2)', color: 'amber' },
  { id: 'development', label: 'Development', gradient: 'from-[#8B5CF6] to-[#A78BFA]', glow: 'rgba(139, 92, 246,0.2)', color: 'indigo' },
  { id: 'custom', label: 'Custom', gradient: 'from-slate-400 to-slate-500', glow: 'rgba(182, 187, 198,0.12)', color: 'slate' },
];

const CAT_GRADIENT: Record<string, string> = {
  ecommerce: 'from-[#8B5CF6] to-[#A78BFA]',
  trading: 'from-[#8B5CF6] to-[#A78BFA]',
  startup: 'from-[#8B5CF6] to-[#A78BFA]',
  development: 'from-[#8B5CF6] to-[#A78BFA]',
};

/* ─── Helpers ─── */
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function makeProject(name: string, category: string, description: string): Project {
  const now = new Date().toISOString();
  const grad = CAT_GRADIENT[category] || 'from-slate-400 to-slate-500';
  return {
    id: `proj-${uid()}`,
    name: name.trim(),
    description: description.trim(),
    category: category === 'custom' ? 'Custom' : CATEGORIES.find(c => c.id === category)?.label || category,
    status: 'active',
    progress: 0,
    agents: [],
    tasks: [],
    memory: [],
    files: [],
    createdAt: now,
    updatedAt: 'Just now',
    color: 'slate',
    gradient: grad,
    icon: 'FolderOpen',
  };
}

/* ═══════════════════════════════════════════ */

export default function ProjectsDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /* ── Projects state ── */
  const [projects, setProjects] = useState<Project[]>(getProjects());

  /* ── Modal state ──
     `?new=1` opens the create modal directly — the workspace's
     "Project not found" recovery screen links here. */
  const [showCreate, setShowCreate] = useState(() => searchParams.get('new') === '1');
  const [projectName, setProjectName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [customCategory, setCustomCategory] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ name?: string; category?: string }>({});

  // Project being deleted (null when no modal open). Local state is
  // updated optimistically on confirm; the projectStore.deleteProject
  // fires the backend DELETE in the background (best-effort —
  // localStorage is the source of truth on this app).
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setDeleteTarget(null);
    // Best-effort: also clear from the store + backend. If the backend
    // DELETE fails (network, unauth, route missing) the local state
    // already reflects the removal — the user isn't blocked.
    try { deleteProjectFromStore(id); }
    catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[ProjectsDashboard] deleteProject backend call failed:', e);
    }
  };

  const isCustom = selectedCategory === 'custom';

  /* ── Create project ── */
  const handleCreate = () => {
    const newErrors: { name?: string; category?: string } = {};

    if (!projectName.trim()) newErrors.name = 'Project name is required';
    if (!selectedCategory) newErrors.category = 'Select a category';
    if (isCustom && !customCategory.trim()) newErrors.category = 'Enter a custom category';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const project = makeProject(projectName, selectedCategory, description);
    if (isCustom) project.category = customCategory.trim();

    addProject(project);
    setProjects(getProjects());

    // Reset form
    setProjectName('');
    setSelectedCategory('');
    setCustomCategory('');
    setDescription('');
    setErrors({});
    setShowCreate(false);
  };

  /* ── Close modal + reset ── */
  const handleClose = () => {
    setShowCreate(false);
    setProjectName('');
    setSelectedCategory('');
    setCustomCategory('');
    setDescription('');
    setErrors({});
  };

  return (
    <div className="min-h-[100dvh]" style={{ background: '#11151C', color: '#E2E8F0' }}>
      {/* Ambient orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[200px] -right-[200px] w-[600px] h-[600px] rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #8B5CF6 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full opacity-[0.03]" style={{ background: 'radial-gradient(circle, #A78BFA 0%, transparent 70%)' }} />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => navigate('/chat')} className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          </div>

          <div className="flex items-start justify-between mb-8">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)', boxShadow: '0 2px 8px rgba(139, 92, 246,0.2)' }}>
                <FolderOpen className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white/90 tracking-tight">Projects</h1>
                <p className="text-[11px] text-white/35">Multi-agent workspaces</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all"
              style={{ background: 'linear-gradient(180deg, #161820 0%, #11151C 100%)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)' }}
            >
              <Plus className="h-4 w-4" /> New Project
            </motion.button>
          </div>
        </motion.div>

        {/* ── Project Grid OR Empty State ── */}
        <AnimatePresence mode="wait">
          {projects.length > 0 ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
            >
              {projects.map((project, i) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  index={i}
                  onDelete={(p) => setDeleteTarget(p)}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="flex flex-col items-center justify-center py-24"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl mb-5" style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246,0.08) 0%, rgba(139, 92, 246,0.08) 100%)', boxShadow: '0 0 24px rgba(139, 92, 246,0.06), inset 0 1px 0 rgba(255,255,255,0.04)', border: '1px solid rgba(139, 92, 246,0.08)' }}>
                <FolderOpen className="h-7 w-7 text-[#A78BFA]/40" />
              </div>
              <h2 className="text-[15px] font-semibold text-white/70 mb-1.5">No projects yet</h2>
              <p className="text-[13px] text-white/30 mb-6">Create your first AI workspace</p>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all"
                style={{ background: 'linear-gradient(180deg, #161820 0%, #11151C 100%)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)' }}
              >
                <Plus className="h-4 w-4" /> New Project
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══ Create Project Modal ═══ */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
            onClick={handleClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl p-6"
              style={{ background: 'linear-gradient(180deg, #161820 0%, #171C24 100%)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 24px 48px rgba(0,0,0,0.4)' }}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'linear-gradient(135deg, #8B5CF6, #A78BFA)' }}>
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <h2 className="text-[15px] font-semibold text-white/90">Create Project</h2>
                </div>
                <button onClick={handleClose} className="text-white/30 hover:text-white/60 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Project Name */}
                <div>
                  <label className="text-[11px] font-medium text-white/40 mb-1.5 block">Project Name <span className="text-[#F87171]/60">*</span></label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => { setProjectName(e.target.value); if (errors.name) setErrors(p => ({ ...p, name: undefined })); }}
                    placeholder="e.g., AI SaaS Platform"
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] text-white/80 placeholder:text-white/20 outline-none transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px solid ${errors.name ? 'rgba(201, 130, 130,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    }}
                  />
                  {errors.name && <p className="text-[10px] text-[#F87171]/70 mt-1">{errors.name}</p>}
                </div>

                {/* Category */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-medium text-white/40">Category <span className="text-[#F87171]/60">*</span></label>
                    <span className="text-[9px] text-white/20">{isCustom ? 'Type your own' : 'Select one'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CATEGORIES.map((cat) => {
                      const active = selectedCategory === cat.id;
                      return (
                        <motion.button
                          key={cat.id}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => { setSelectedCategory(cat.id); if (cat.id !== 'custom') setCustomCategory(''); if (errors.category) setErrors(p => ({ ...p, category: undefined })); }}
                          className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200"
                          style={{
                            background: active
                              ? `linear-gradient(135deg, ${cat.glow.replace('0.2', '0.15')}, rgba(255,255,255,0.02))`
                              : 'rgba(255,255,255,0.02)',
                            border: active
                              ? `1px solid ${cat.glow.replace('0.2', '0.4')}`
                              : '1px solid rgba(255,255,255,0.05)',
                            color: active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.3)',
                            boxShadow: active ? `0 0 12px ${cat.glow}` : 'none',
                          }}
                        >
                          {active && <Check className="h-3 w-3 shrink-0" style={{ color: cat.glow.replace('0.2', '0.8') }} />}
                          <span>{cat.label}</span>
                        </motion.button>
                      );
                    })}
                  </div>
                  {errors.category && <p className="text-[10px] text-[#F87171]/70 mt-1">{errors.category}</p>}

                  {/* Custom input */}
                  <AnimatePresence>
                    {isCustom && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, marginTop: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <Pencil className="h-3 w-3 text-white/20 shrink-0" />
                          <input
                            type="text"
                            value={customCategory}
                            onChange={(e) => { setCustomCategory(e.target.value); if (errors.category) setErrors(p => ({ ...p, category: undefined })); }}
                            placeholder="Describe your project type..."
                            className="flex-1 bg-transparent text-[12px] text-white/70 placeholder:text-white/15 outline-none"
                            autoFocus
                          />
                        </div>
                        <p className="text-[9px] text-white/15 mt-1 ml-1">Examples: homework, research, finance, design, school project, content, automation...</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Description */}
                <div>
                  <label className="text-[11px] font-medium text-white/40 mb-1.5 block">Description <span className="text-white/15">(optional)</span></label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this project about?"
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] text-white/80 placeholder:text-white/20 outline-none resize-none transition-all"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  />
                </div>

                {/* Submit */}
                <div className="pt-1">
                  <button
                    onClick={handleCreate}
                    className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:brightness-110"
                    style={{ background: 'linear-gradient(135deg, #8B5CF6, #A78BFA)', boxShadow: '0 4px 16px rgba(139, 92, 246,0.2)' }}
                  >
                    Create Project
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete-project confirmation. Mounted at the page root so it
          renders above ProjectCard hover states. */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Project"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" and all its agents, tasks, and local memory will be permanently removed from this browser. This cannot be undone.`
            : ''
        }
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
