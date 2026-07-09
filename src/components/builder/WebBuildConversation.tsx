import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, FolderTree, ArrowRight, X, Check, Minus } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import KorvixAvatar from '@/components/builder/KorvixAvatar';
import WebBuildFileView from '@/components/builder/WebBuildFileView';
import WebBuildPreviewPanel from '@/components/builder/WebBuildPreviewPanel';
import type {
  WebBuildStep, WebBuildFile, WebBuildSectionItem, PlanningQuality,
} from '@/lib/webBuildPayload';
import type { WebBuildResearch } from '@/lib/webBuildApi';
import { deriveAgentWorkLog, type WebBuildAgentWorkLogEntry } from '@/lib/webBuildAgents';

/**
 * The Web Build conversation — a Kimi/Claude-style agent run per turn: the
 * assistant writes short natural messages, compact action blocks appear as real
 * operations, file changes render as clickable tool rows, and Preview / All
 * files / Save to Project artifact cards close the run. Shared by the live Web
 * Build page and the saved-project view. No checklist / table / tick waterfall.
 */

/* ── Live run shown WHILE the backend call is in flight ──────────────────
 * The whole build is a SINGLE backend request, so there is no per-agent stream to
 * read. This live view is therefore a deterministic, frontend-only PLAN — never a
 * claim of completed work: a compact "Think" block with short planning rows,
 * followed by the known agent pipeline rendered as queued rows (one "running"
 * highlight cycles for a progress feel). It never shows source counts, file diffs
 * or agent completion — those only appear in the completed workstream once real
 * artifacts exist. When the build finishes the parent swaps this for the result
 * turn (with the real workstream + Preview / All Files cards). */

/** Short, honest planning rows for the Think block (no completion claims). The
 *  first build row reuses the existing "Reading your request" label. */
const BUILD_THINK_KEYS = ['wbActRead', 'wbLiveThinkScope', 'wbLiveThinkPipeline', 'wbLiveThinkPackage'] as const;
const REVISE_THINK_KEYS = ['wbLiveThinkReviseRead', 'wbLiveThinkRevisePlan', 'wbLiveThinkRevisePackage'] as const;
/** The known pipeline order, shown as queued rows. Revisions skip the fresh
 *  research pre-pass on the backend, so the Research row is omitted — the live
 *  view never implies a new research pass for a revision. */
const BUILD_PIPELINE_KEYS = ['wbAgentResearch', 'wbAgentArt', 'wbAgentStrategy', 'wbAgentLayout', 'wbAgentComponent'] as const;
const REVISE_PIPELINE_KEYS = ['wbAgentArt', 'wbAgentStrategy', 'wbAgentLayout', 'wbAgentComponent'] as const;

/** A small pulsing dot marking the currently-active (running) row. */
function PulseDot() {
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#60A5FA] opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#60A5FA]" />
    </span>
  );
}

/**
 * The live Think block + queued agent pipeline. Purely presentational and
 * deterministic: it reveals the planning rows one at a time, then cycles a single
 * "running" highlight through the queued pipeline. It NEVER marks a row complete
 * or shows any real metric — honesty during the in-flight phase.
 */
function LiveThink({ kind }: { kind: 'build' | 'revision' }) {
  const { t } = useLanguageStore();
  const isRevision = kind === 'revision';
  const thinkKeys = useMemo<readonly string[]>(
    () => (isRevision ? REVISE_THINK_KEYS : BUILD_THINK_KEYS).slice(),
    [isRevision],
  );
  const pipeKeys = useMemo<readonly string[]>(
    () => (isRevision ? REVISE_PIPELINE_KEYS : BUILD_PIPELINE_KEYS).slice(),
    [isRevision],
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setTick(0);
    const id = setInterval(() => setTick((x) => x + 1), 1400);
    return () => clearInterval(id);
  }, [kind]);

  // Reveal the planning rows one by one; once they are all shown, cycle a single
  // "running" highlight through the queued pipeline. No row is ever marked done.
  const revealedThink = Math.min(tick + 1, thinkKeys.length);
  const activePipe = tick < thinkKeys.length
    ? -1
    : (tick - thinkKeys.length) % Math.max(pipeKeys.length, 1);

  return (
    <div className="min-w-0 flex-1 space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <PulseDot />
          <span className="text-[12.5px] font-medium text-slate-200">{t('wbThinkLabel')}</span>
        </div>
        <div className="mt-1.5 space-y-1 pl-[13px]">
          {thinkKeys.slice(0, revealedThink).map((k) => (
            <motion.div
              key={k}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-start gap-2 text-[12px] leading-relaxed text-[#94A3B8]"
            >
              <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[#475569]" />
              <span className="min-w-0">{t(k)}</span>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="pl-[13px] text-[10.5px] font-medium uppercase tracking-wide text-[#64748B]">
          {t('wbLivePipelineLabel')}
        </div>
        {pipeKeys.map((k, idx) => {
          const running = idx === activePipe;
          return (
            <motion.div
              key={k}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: Math.min(idx * 0.05, 0.3) }}
              className="flex items-center gap-2 pl-[13px] text-[12px] leading-relaxed"
            >
              {running
                ? <PulseDot />
                : <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-[#475569]" />}
              <span className={`min-w-0 truncate ${running ? 'text-slate-200' : 'text-[#94A3B8]'}`}>{t(k)}</span>
              <span className="ml-auto shrink-0 text-[10.5px] text-[#64748B]">
                {running ? t('wbLiveStatusRunning') : t('wbLiveStatusQueued')}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function LivePhases({ prompt, kind = 'build' }: { prompt: string; kind?: 'build' | 'revision' }) {
  return (
    <div className="space-y-3">
      <UserMessage text={prompt} />
      <div className="flex items-start gap-2.5">
        <div className="mt-[3px]"><KorvixAvatar size={15} active /></div>
        <LiveThink kind={kind} />
      </div>
    </div>
  );
}

/* ── Attachment / artifact card ──────────────────────────────────────── */
function AttachmentCard({
  icon: Icon, title, subtitle, actionLabel, onClick, tone = 'default',
}: {
  icon: typeof Monitor; title: string; subtitle: string;
  actionLabel: string; onClick?: () => void; tone?: 'default' | 'accent' | 'success';
}) {
  const border = tone === 'success' ? 'border-[#4ADE80]/25' : tone === 'accent' ? 'border-[#3B82F6]/25' : 'border-white/[0.08]';
  const iconBg = tone === 'success' ? 'bg-[#4ADE80]/[0.1]' : `bg-[#3B82F6]/[0.1]`;
  const iconColor = tone === 'success' ? 'text-[#86A08F]' : 'text-[#60A5FA]';
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`group w-full max-w-sm flex items-center gap-3 rounded-xl border ${border} bg-white/[0.02] px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors disabled:cursor-default`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-slate-100 truncate">{title}</div>
        <div className="text-[11px] text-[#94A3B8] truncate">{subtitle}</div>
      </div>
      {onClick && (
        <span className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-[#CBD5E1] group-hover:border-white/[0.15] transition-colors">
          {actionLabel} <ArrowRight className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

/* ── Message bubbles ─────────────────────────────────────────────────── */
function UserMessage({ text }: { text: string }) {
  const { t } = useLanguageStore();
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] text-[#64748B] mb-1 mr-1">{t('wbFeedYou')}</span>
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-white/[0.05] border border-white/[0.06] px-3.5 py-2 text-[13px] text-slate-100 leading-relaxed">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-[3px]">
        <KorvixAvatar size={15} active={active} />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">{children}</div>
    </div>
  );
}

/* ── Owner/admin-only research debug (subtle, collapsible) ────────────── */
/** Renders the honest research diagnostics for a build step — status, provider,
 *  attempted providers, counts, fallback reason, real source URLs. Owner/admin
 *  only, so it never clutters the normal user's polished feed. Never invents
 *  data: it reflects exactly what the backend reported. */
function ResearchDebug({ research }: { research?: WebBuildResearch }) {
  const { isOwner } = useOwnerMode();
  if (!isOwner || !research) return null;
  const rows: Array<[string, string]> = [
    ['Status', research.status],
    ['did_research', String(research.didResearch)],
  ];
  if (research.provider) rows.push(['Provider', research.provider]);
  if (research.attemptedProviders?.length) rows.push(['Attempted', research.attemptedProviders.join(', ')]);
  if (typeof research.queryCount === 'number') rows.push(['Queries', String(research.queryCount)]);
  if (research.angles?.length) rows.push(['Angles', research.angles.join(', ')]);
  if (typeof research.sourceCount === 'number') rows.push(['Sources', String(research.sourceCount)]);
  if (research.fallbackReason) rows.push(['Fallback reason', research.fallbackReason]);
  return (
    <details className="mt-1 rounded-lg border border-white/[0.07] bg-white/[0.015] px-2.5 py-1.5 text-[11px] text-[#94A3B8]">
      <summary className="cursor-pointer select-none text-[10.5px] uppercase tracking-wide text-[#64748B] hover:text-[#94A3B8]">
        Research debug · owner
      </summary>
      <div className="mt-1.5 space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="w-28 shrink-0 text-[#64748B]">{k}</span>
            <span className="min-w-0 break-words text-[#CBD5E1]">{v}</span>
          </div>
        ))}
        {research.sources?.length ? (
          <div className="pt-1">
            <span className="text-[#64748B]">Source URLs</span>
            <ul className="mt-0.5 space-y-0.5">
              {research.sources.map((s) => (
                <li key={s.url} className="truncate">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[#60A5FA] hover:underline">
                    {s.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/* ── Completed-run Plan Summary (Phase 4.5) ──────────────────────────────
 * After a build completes the user should SEE what the AI planned — not a live
 * "Think" stream (that only runs in-flight), and not chain-of-thought. This is a
 * compact, honest product/design plan summary derived ONLY from already-persisted
 * artifacts (the Website Experience Plan, the Interaction Contract, Art Direction,
 * the layout plan, research status, section names). It never fabricates and never
 * claims real backend/product functionality — the build is website + front-end
 * demo only. Fully guarded: missing/old artifacts → a tiny safe summary or nothing. */
const firstStr = (...xs: Array<string | undefined | null>): string => {
  for (const x of xs) { const v = (x || '').trim(); if (v) return v; }
  return '';
};
const shortStr = (s: string, n = 90): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const listStr = (xs: unknown, n = 3): string =>
  Array.isArray(xs) ? xs.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, n).join(', ') : '';

interface PlanSummaryData {
  experienceModel: string;
  pageScreen: string;
  primaryExp: string;
  demoSurfaces: string;
  visual: string;
  shellFromModel: boolean;
  planningQuality?: PlanningQuality;
  ownerRows: Array<[string, string]>;
}

/** Pure, guarded derivation — real persisted artifacts only. Returns null when
 *  there is nothing meaningful to show (so old/empty builds render nothing). */
function computePlanSummary(step: WebBuildStep): PlanSummaryData | null {
  try {
    const strategy = step.artifacts?.strategy;
    const wep = strategy?.websiteExperiencePlan;
    const contract = strategy?.interactionContract;
    const art = step.artifacts?.artDirection;
    const plan = step.layoutPlan;
    const research = step.research;
    const pd = step.planningDiagnostics;
    const names = step.summary?.sectionNames || [];
    if (!strategy && !plan && !art && !pd && !names.length) return null;

    const experienceModel = firstStr(wep?.websiteExperienceModel, contract?.websiteExperienceModel, plan ? `${plan.archetype} site` : '', 'Single-page site');
    const pageScreen = firstStr(wep?.pageScreenModel, contract?.pageScreenModel, contract?.experienceMode ? `${contract.experienceMode} shell` : '', names.length ? `${names.length} sections` : '');
    const primaryExp = firstStr(wep?.primaryWebsiteExperience, contract?.primaryWebsiteExperience, contract?.primaryAction?.label, contract?.primaryAction?.type);
    const demoSurfaces = firstStr(listStr(wep?.demoSurfaces), listStr((contract?.suggestedScreens || []).map((s) => s?.name)), listStr(contract?.requiredStatefulComponents));
    const visual = firstStr(art?.designArchetype?.name, art?.visualSignature, listStr(art?.visualDifferentiators, 2), plan?.visualSystem?.motif, art?.visualMood);
    const shellFromModel = !!(contract?.experienceMode || wep?.websiteExperienceModel || wep?.navigationModel || contract?.navigationModel);

    const ownerRows: Array<[string, string]> = [];
    if (research?.status) ownerRows.push(['research', `${research.status}${research.provider ? ` · ${research.provider}` : ''}${typeof research.sourceCount === 'number' ? ` · ${research.sourceCount} src` : ''}`]);
    if (contract?.experienceMode) ownerRows.push(['experienceMode', contract.experienceMode]);
    const navM = firstStr(contract?.navigationModel, wep?.navigationModel);
    if (navM) ownerRows.push(['navigationModel', navM]);
    const reqComps = listStr(contract?.requiredStatefulComponents, 8);
    if (reqComps) ownerRows.push(['requiredStatefulComponents', reqComps]);
    if (plan?.heroComposition) ownerRows.push(['heroComposition', plan.heroComposition]);
    if (plan?.primaryVisualModule) ownerRows.push(['primaryVisualModule', plan.primaryVisualModule]);
    if (plan?.visualSystem?.motif) ownerRows.push(['visualSystem.motif', plan.visualSystem.motif]);
    const reviewer = step.artifacts?.reviewer;
    if (reviewer?.status) ownerRows.push(['reviewer', reviewer.status]);
    // Quality Director (Phase 7A) — premium-quality judge over the real artifacts.
    const qd = step.artifacts?.qualityDirector;
    if (qd) ownerRows.push(['qualityDirector', `${qd.status} · ${qd.score}/100`]);
    const fixer = step.artifacts?.fixer;
    if (fixer) {
      const qc = (fixer.qualityAppliedChanges || []).length;
      ownerRows.push(['fixer', `${fixer.status} · ${(fixer.appliedChanges || []).length + qc} applied`]);
    }
    // Phase 9C-1 — public-facing copy smells (Quality Director) + repairs (Fixer).
    const pcSmells = (qd?.issues || []).filter((i) => i.category === 'public-copy-smell').length;
    if (pcSmells) ownerRows.push(['publicCopySmells', String(pcSmells)]);
    const pcRepairs = (fixer?.qualityAppliedChanges || []).filter((c) => c.category === 'public-copy');
    if (pcRepairs.length) {
      const ex = pcRepairs.slice(0, 2).map((c) => `${c.before} → ${c.after}`).join('; ');
      ownerRows.push(['publicCopyRepairs', `${pcRepairs.length}${ex ? ` · ${ex}` : ''}`]);
    }
    // Phase 9C-2 — generic content-depth smells (Quality Director) + repairs (Fixer).
    const gcSmells = (qd?.issues || []).filter((i) => i.category === 'generic-content-depth').length;
    if (gcSmells) ownerRows.push(['genericContentSmells', String(gcSmells)]);
    const cdRepairs = (fixer?.qualityAppliedChanges || []).filter((c) => c.category === 'content-depth');
    if (cdRepairs.length) {
      const ex = cdRepairs.slice(0, 2).map((c) => `${c.before} → ${c.after}`).join('; ');
      ownerRows.push(['contentDepthRepairs', `${cdRepairs.length}${ex ? ` · ${ex}` : ''}`]);
    }
    // Phase 9C-3 — demo-surface copy repairs (Fixer) consumed by preview demo/nav.
    const dsRepairs = (fixer?.qualityAppliedChanges || []).filter((c) => c.category === 'demo-copy');
    if (dsRepairs.length) {
      const ex = dsRepairs.slice(0, 2).map((c) => `${c.before} → ${c.after}`).join('; ');
      ownerRows.push(['demoSurfaceCopyRepairs', `${dsRepairs.length}${ex ? ` · ${ex}` : ''}`]);
    }

    // Concept Authority + Visual Quality gate (Phase 5) — real artifact data only.
    const ca = step.artifacts?.research?.conceptAuthority;
    if (ca) {
      ownerRows.push(['primaryConcept', `${ca.primaryConcept}${ca.targetVertical ? ` · vertical: ${ca.targetVertical}` : ''} · ${ca.confidence}`]);
    }
    // Strategic Thinking Ledger (Phase 8A) — the decision downstream agents obeyed.
    const tl = step.artifacts?.thinkingLedger;
    if (tl) {
      ownerRows.push(['thinkingLedger', `${tl.primaryConcept}${tl.targetVertical ? ` · vertical: ${tl.targetVertical}` : ''} · demo: ${tl.demoSurfaceIntent} · lang: ${tl.languageIntent}`]);
      if (tl.mustNotBecome?.length) ownerRows.push(['ledger.mustNotBecome', tl.mustNotBecome.join(', ')]);
      // Model-native Design Thinking Plan (Phase 9A) — the model's OWN design decision.
      const mdp = tl.modelDesignPlan;
      if (mdp) {
        ownerRows.push(['designPlan', `specificity ${mdp.planSpecificityScore}/100${mdp.hasMeaningfulRejectedDirections ? ' · rejected ✓' : ' · no rejects'}${mdp.avoidGold ? ' · avoid-gold' : ''}`]);
        if (mdp.designThesis) ownerRows.push(['plan.thesis', mdp.designThesis]);
        if (mdp.selectedVisualDirection) ownerRows.push(['plan.visualDirection', mdp.selectedVisualDirection]);
        if (mdp.rejectedDirections) ownerRows.push(['plan.rejected', mdp.rejectedDirections]);
        if (mdp.heroCompositionDecision) ownerRows.push(['plan.hero', `${mdp.heroCompositionDecision}${mdp.heroComposition ? ` → ${mdp.heroComposition}` : ''}`]);
        if (mdp.paletteDecision) ownerRows.push(['plan.palette', `${mdp.paletteDecision}${mdp.paletteFamily ? ` → ${mdp.paletteFamily}` : ''}`]);
        if (mdp.differentiationMove) ownerRows.push(['plan.differentiation', mdp.differentiationMove]);
        if (mdp.templateTrapsToAvoid) ownerRows.push(['plan.trapsAvoided', mdp.templateTrapsToAvoid]);
        if (mdp.weakDesignPlanWarnings.length) ownerRows.push(['plan.weakWarnings', mdp.weakDesignPlanWarnings.slice(0, 3).join('; ')]);
      }
    }
    const enf = step.artifacts?.enforcement;
    if (enf?.didDetectConceptDrift) ownerRows.push(['conceptDrift', `detected${enf.didFixConceptDrift ? ' · fixed' : ''}`]);
    else if (ca) ownerRows.push(['conceptDrift', art?.correctedConceptDrift ? 'guarded' : 'none']);
    if (art?.visualAssetPlan?.heroVisualType) ownerRows.push(['visualAssetPlan', art.visualAssetPlan.heroVisualType]);

    // Quality Director + Copy/CTA Fixer enforcement (Phase 7A) — real artifact data.
    if (enf?.didRunQualityDirector) {
      ownerRows.push(['qualityGate', `${enf.qualityStatus || 'n/a'} · score ${enf.qualityScore ?? 'n/a'} · ${enf.qualityCriticalCount ?? 0} critical · ${enf.qualityWarningCount ?? 0} warning`]);
      const fixed = [
        enf.didFixCopyLabels ? 'copy-labels' : '',
        enf.didFixCtaConsistency ? 'cta' : '',
        enf.didFixFlowLabels ? 'flow-labels' : '',
      ].filter(Boolean);
      ownerRows.push(['qualityFixesApplied', fixed.length ? fixed.join(' · ') : 'none']);
    }

    // Visual Exploration + anti-template gate (Phase 7B) — real artifact data.
    const explo = art?.visualExploration;
    if (explo || enf?.paletteFamily) {
      ownerRows.push(['paletteFamily', enf?.paletteFamily || art?.paletteFamily || 'default']);
      if (explo) {
        ownerRows.push(['visualCandidates', `${(explo.candidates || []).length} · selected: ${explo.selectedCandidateId}${explo.rejectedCandidateIds?.length ? ` · rejected: ${explo.rejectedCandidateIds.join(', ')}` : ''}`]);
        if (explo.selectionReason) ownerRows.push(['visualSelectionReason', explo.selectionReason]);
      }
      const atWarn = enf?.antiTemplateWarnings ?? 0;
      ownerRows.push(['antiTemplate', `${atWarn} warning${atWarn === 1 ? '' : 's'}${enf?.qualitySameTemplateIssues ? ` · ${enf.qualitySameTemplateIssues} same-template` : ''}${enf?.correctedAntiTemplateDrift ? ' · corrected' : ''}`]);
    }

    // Phase 6A: is the Preview using the model-native Interaction Contract (its own
    // Website Experience Plan), not just a re-derived fallback? Real fields only.
    const modelNativeContract = !!(contract?.experienceMode || contract?.navigationModel
      || contract?.websiteExperienceModel || contract?.pageScreenModel || (contract?.suggestedScreens?.length));
    if (contract) {
      ownerRows.push(['previewContract', modelNativeContract ? 'model-native' : 're-derived']);
      const scr = (contract.suggestedScreens || []).map((s) => s?.name).filter(Boolean);
      if (scr.length) ownerRows.push(['suggestedScreens', scr.join(', ')]);
      // Phase 6B: Entry Flow diagnostics (real contract fields only).
      if (contract.entryFlowModel) ownerRows.push(['entryFlowModel', contract.entryFlowModel]);
      if (typeof contract.landingRequired === 'boolean') ownerRows.push(['landingRequired', String(contract.landingRequired)]);
      if (contract.entryScreen) ownerRows.push(['entryScreen', contract.entryScreen]);
      if (contract.postEntryScreen) ownerRows.push(['postEntryScreen', contract.postEntryScreen]);
      if (contract.primaryEntryCTA) ownerRows.push(['primaryEntryCTA', contract.primaryEntryCTA]);
      if (contract.secondaryEntryCTA) ownerRows.push(['secondaryEntryCTA', contract.secondaryEntryCTA]);
      if (contract.navigationBehavior) ownerRows.push(['navigationBehavior', contract.navigationBehavior]);
      if (contract.initialScreenId) ownerRows.push(['initialScreenId', contract.initialScreenId]);
      if (contract.postEntryScreenId) ownerRows.push(['postEntryScreenId', contract.postEntryScreenId]);
      // Phase 6C: nav discipline + entry transition diagnostics (contract-derived).
      const entryMode = contract.entryAction ? 'contract-action' : contract.postEntryScreenId ? 'fallback-entry-link' : 'none';
      ownerRows.push(['entryTransitionMode', entryMode]);
      const conceptAiSaas = /^(ai|saas)$/.test((contract.conceptCategory || '').toLowerCase())
        || (contract.requiredStatefulComponents || []).some((c) => /chat|product-?demo|assistant/i.test(c));
      const teaserExpected = conceptAiSaas
        && /chat|product-demo/.test(`${contract.postEntryScreenId || ''} ${(contract.requiredStatefulComponents || []).join(' ')}`);
      ownerRows.push(['demoTeaserExpected', String(!!teaserExpected)]);
      // Planned nav breadth (Home + experience + screens), capped like the Preview.
      const plannedScreens = (contract.suggestedScreens || []).length;
      ownerRows.push(['navPlanned', `${Math.min(6, 1 + (contract.postEntryScreenId ? 1 : 0) + plannedScreens)} (cap 6)`]);
      // Phase 6E: visual-calm posture (the Preview applies these unconditionally).
      const demoDensity = /chat|product-demo/.test(contract.postEntryScreenId || '') ? 'compact' : 'balanced';
      ownerRows.push(['visualCalmApplied', 'true']);
      ownerRows.push(['accentUsage', 'restrained']);
      ownerRows.push(['demoDensity', demoDensity]);
      ownerRows.push(['teaserDensity', 'compact']);
      // Phase 6F: conversion journey / lead-capture gate diagnostics.
      if (contract.conversionJourneyModel) ownerRows.push(['conversionJourneyModel', contract.conversionJourneyModel]);
      if (contract.primaryConversionIntent) ownerRows.push(['primaryConversionIntent', contract.primaryConversionIntent]);
      if (typeof contract.leadCaptureRequired === 'boolean') ownerRows.push(['leadCaptureRequired', String(contract.leadCaptureRequired)]);
      if (contract.leadCaptureFields) ownerRows.push(['leadCaptureFields', contract.leadCaptureFields]);
      if (contract.leadCaptureScreenId) ownerRows.push(['leadCaptureScreenId', contract.leadCaptureScreenId]);
      if (contract.afterLeadCaptureScreenId) ownerRows.push(['afterLeadCaptureScreenId', contract.afterLeadCaptureScreenId]);
      if (contract.ctaConsistencyRule) ownerRows.push(['ctaConsistencyRule', contract.ctaConsistencyRule]);
      // primaryCtaNormalized — the clean CTA label the Preview shows for the intent.
      const ci = (contract.primaryConversionIntent || '').toLowerCase();
      const primaryCtaNormalized = /free|try|get\s*started/.test(ci) ? 'Get started free'
        : /book/.test(ci) ? 'Book a demo' : /contact/.test(ci) ? 'Contact sales'
        : /quote/.test(ci) ? 'Request a quote' : /browse|catalog/.test(ci) ? 'Browse catalog'
        : /access/.test(ci) ? 'Request access' : /learn|how/.test(ci) ? 'See how it works'
        : (contract.primaryEntryCTA || '—');
      ownerRows.push(['primaryCtaNormalized', primaryCtaNormalized]);
    }

    // Planning-quality diagnostics (the honesty gate — model-planned vs fallback).
    if (pd) {
      const parse = pd.parse;
      if (parse?.canonicalSectionsMissing?.length) ownerRows.push(['canonicalSectionsMissing', parse.canonicalSectionsMissing.join(', ')]);
      ownerRows.push(['usedOverviewFallback', String(!!parse?.usedOverviewFallback)]);
      ownerRows.push(['hasWebsiteExperiencePlanFields', String(!!parse?.hasWebsiteExperiencePlanFields)]);
      // Phase 6D — planning contract (Preview bar) vs full code contract (All-Files bar).
      if (typeof parse?.planningContractPresent === 'boolean') ownerRows.push(['planningContractPresent', String(parse.planningContractPresent)]);
      if (typeof parse?.fullCodeContractPresent === 'boolean') ownerRows.push(['fullCodeContractPresent', String(parse.fullCodeContractPresent)]);
      // Phase 9B-1 — Design Thinking Plan quality + the one-shot repair outcome.
      if (typeof parse?.designPlanSpecificityScore === 'number') {
        ownerRows.push(['designPlanScore', `${parse.designPlanSpecificityScore}/100${parse.hasDesignThinkingPlanSection ? '' : ' · no section'}`]);
      }
      if (parse?.weakDesignPlanWarnings?.length) ownerRows.push(['designPlanWeak', parse.weakDesignPlanWarnings.slice(0, 3).join('; ')]);
      if (parse?.designPlanRepairAttempted) {
        ownerRows.push(['designPlanRepair', `${parse.designPlanRepairSucceeded ? 'succeeded' : 'kept-first'}${parse.designPlanRepairReason ? ` · ${parse.designPlanRepairReason}` : ''}`]);
      }
      // Phase 9B-2A — strict repair accepted as preview-viable (full contract NOT met).
      if (parse?.strictRepairAcceptedAsPreviewViable) {
        ownerRows.push(['strictRepairPreviewViable', `true${parse.strictRepairContractGapReason ? ` · ${parse.strictRepairContractGapReason}` : ''}`]);
      }
      if (pd.codeContractPending) ownerRows.push(['codeContractPending', 'true (All Files parity pending)']);
      ownerRows.push(['usedArchitectureRewrite', String(!!pd.usedArchitectureRewrite)]);
      ownerRows.push(['usedQualityFallbackSections', String(!!pd.usedQualityFallbackSections)]);
      ownerRows.push(['usedFileSynthesisFallback', String(!!pd.usedFileSynthesisFallback)]);
      ownerRows.push(['usedSafePayloadFallback', String(!!pd.usedSafePayloadFallback)]);
      if (pd.warnings?.length) ownerRows.push(['warnings', pd.warnings.join(' · ')]);
    }

    return { experienceModel, pageScreen, primaryExp, demoSurfaces, visual, shellFromModel, planningQuality: pd?.planningQuality, ownerRows };
  } catch {
    return null;
  }
}

/** Compact, subtle plan summary shown ABOVE the Preview / All Files cards for the
 *  latest completed run. User-visible; owner mode can expand raw diagnostics. */
function CompletedPlanSummary({ step }: { step: WebBuildStep }) {
  const { lang } = useLanguageStore();
  const { isOwner } = useOwnerMode();
  const data = useMemo(() => computePlanSummary(step), [step]);
  if (!data) return null;
  const L = (en: string, tr: string) => (lang === 'tr' ? tr : en);

  const rows: Array<[string, string]> = [];
  if (data.experienceModel) rows.push([L('Experience model', 'Deneyim modeli'), shortStr(data.experienceModel, 70)]);
  if (data.pageScreen) rows.push([L('Page plan', 'Sayfa planı'), shortStr(data.pageScreen, 90)]);
  if (data.primaryExp) rows.push([L('Primary experience', 'Birincil deneyim'), shortStr(data.primaryExp, 100)]);
  if (data.demoSurfaces) rows.push([L('Demo surfaces', 'Demo yüzeyleri'), shortStr(data.demoSurfaces, 90)]);
  if (data.visual) rows.push([L('Visual direction', 'Görsel yön'), shortStr(data.visual, 90)]);
  if (!rows.length) return null;

  const quality = L(
    `Front-end demo only — no real backend, AI, database or payments; no fake metrics, logos or testimonials. Preview shell: ${data.shellFromModel ? 'from model plan' : 'fallback'}. All Files parity: pending.`,
    `Yalnızca ön yüz demosu — gerçek arka uç, yapay zekâ, veritabanı veya ödeme yok; sahte metrik, logo veya yorum yok. Önizleme kabuğu: ${data.shellFromModel ? 'model planından' : 'yedek'}. Tüm Dosyalar eşleşmesi: bekliyor.`,
  );

  return (
    <div className="space-y-1 pt-0.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-[#64748B]">{L('Plan summary', 'Plan özeti')}</div>
      <div className="space-y-1 text-[12px] leading-relaxed">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="w-32 shrink-0 text-[#64748B]">{k}</span>
            <span className="min-w-0 break-words text-[#CBD5E1]">{v}</span>
          </div>
        ))}
        {data.planningQuality && (() => {
          const q = data.planningQuality;
          // model-planned reads as calm success; everything else is an amber warning
          // so a fallback/repaired build is never mistaken for a real model-planned one.
          const color = q === 'model-planned' ? '#86A08F' : q === 'model-partial' ? '#D9A441' : '#E0A35B';
          const text = q === 'model-planned' ? L('Model plan detected', 'Model planı algılandı')
            : q === 'model-partial' ? L('Partial model output; frontend repaired missing pieces', 'Kısmi model çıktısı; ön yüz eksikleri tamamladı')
              : q === 'frontend-repaired' ? L('Frontend repaired weak output; inspect before trusting', 'Ön yüz zayıf çıktıyı onardı; güvenmeden önce inceleyin')
                : L('Fallback build; backend did not return a full model-planned package', 'Yedek yapı; arka uç tam model-planlı bir paket döndürmedi');
          return (
            <div className="flex gap-2">
              <span className="w-32 shrink-0 text-[#64748B]">{L('Planning quality', 'Planlama kalitesi')}</span>
              <span className="min-w-0 break-words font-medium" style={{ color }}>{q} — {text}</span>
            </div>
          );
        })()}
      </div>
      <p className="text-[11px] leading-relaxed text-[#64748B]">{quality}</p>
      {isOwner && data.ownerRows.length > 0 && (
        <details className="mt-1 rounded-lg border border-white/[0.07] bg-white/[0.015] px-2.5 py-1.5 text-[11px] text-[#94A3B8]">
          <summary className="cursor-pointer select-none text-[10.5px] uppercase tracking-wide text-[#64748B] hover:text-[#94A3B8]">
            {L('Plan diagnostics', 'Plan tanılama')} · owner
          </summary>
          <div className="mt-1.5 space-y-1">
            {data.ownerRows.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="w-40 shrink-0 text-[#64748B]">{k}</span>
                <span className="min-w-0 break-words text-[#CBD5E1]">{v}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/* ── Agent workstream (work log) ─────────────────────────────────────────
 * The single running-activity surface for a finished turn: a compact work log
 * of the REAL agent pipeline — what each agent did, which fields it passed to the
 * next agent, and the real files the Component Engineer wrote with their real +/-
 * line diffs. Derived from deriveAgentWorkLog(step.agents, step.files); never
 * fabricated, honest fallback wording, no borders/panel, no future checklist.
 * Renders nothing for old builds / kill-switched agents. */
function WorkLogLine({ entry }: { entry: WebBuildAgentWorkLogEntry }) {
  if (entry.type === 'file') {
    return (
      <div className="flex items-center gap-2 pl-5 text-[11.5px] leading-relaxed">
        <span className="min-w-0 truncate font-mono text-[#CBD5E1]">{entry.filePath}</span>
        <span className="shrink-0 font-mono">
          <span className="text-[#86A08F]">+{entry.linesAdded ?? 0}</span>{' '}
          <span className="text-[#C98A93]">-{entry.linesRemoved ?? 0}</span>
        </span>
      </div>
    );
  }
  const isDid = entry.type === 'completed';
  const isHandoff = entry.type === 'handoff';
  const Icon = isDid ? Check : isHandoff ? ArrowRight : Minus;
  const color = isDid ? '#86A08F' : isHandoff ? '#64748B' : '#94A3B8';
  return (
    <div className={`flex items-start gap-1.5 text-[12px] leading-relaxed ${isDid ? '' : 'pl-5'}`}>
      <Icon
        className="mt-[2px] h-3.5 w-3.5 shrink-0"
        style={{ color, opacity: isDid ? 1 : 0.75 }}
        strokeWidth={isDid ? 2.5 : 2}
      />
      <span className={`min-w-0 ${isDid ? 'text-slate-200' : 'text-[#94A3B8]'}`}>{entry.message}</span>
    </div>
  );
}

function AgentWorkLog({ agents, files }: { agents: WebBuildStep['agents']; files: WebBuildStep['files'] }) {
  const { lang } = useLanguageStore();
  // Guarded — a workstream derivation failure must NEVER take down the sibling
  // Preview / All Files cards. On any error the workstream simply omits itself.
  const entries = useMemo(() => {
    try { return deriveAgentWorkLog(agents, files, lang); }
    catch { return []; }
  }, [agents, files, lang]);
  if (!entries.length) return null;
  return (
    <div className="flex flex-col gap-[3px]">
      {entries.map((entry, idx) => (
        <motion.div
          key={entry.id}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: Math.min(idx * 0.045, 0.5) }}
        >
          <WorkLogLine entry={entry} />
        </motion.div>
      ))}
    </div>
  );
}

/* ── One finished build/revision turn ────────────────────────────────────
 * A completed turn is a normal assistant response: the user's prompt, the compact
 * agent workstream (what each agent did / passed / wrote, from real artifacts and
 * real file diffs), then the result cards (Preview / All Files / Save). The work
 * log + cards render only on the last (current) turn — kept compact, never a giant
 * panel. The owner-only research debug (after completion) is kept. */
function RunTurn({ step, children }: { step: WebBuildStep; children?: ReactNode }) {
  return (
    <div className="space-y-3">
      <UserMessage text={step.prompt} />
      <AssistantMessage>
        <ResearchDebug research={step.research} />
        {children}
      </AssistantMessage>
    </div>
  );
}

/* ── Conversation ────────────────────────────────────────────────────── */
interface WebBuildConversationProps {
  steps: WebBuildStep[];
  /** Latest file set + sections for the panels (current state). */
  files: WebBuildFile[];
  sectionItems: WebBuildSectionItem[];
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  /** A build in progress to append at the bottom (phases run during the call). */
  live?: { prompt: string; kind?: 'build' | 'revision' } | null;
  /** Extra cards (e.g. Save to Project) appended after the last assistant msg. */
  extraCards?: ReactNode;
  slug?: string;
  /** The newest step id — its run plays the sequential live reveal. */
  animateStepId?: string;
  /** Stable id for the preview route (/preview/web-build/:runId). */
  runId?: string;
}

export default function WebBuildConversation({
  steps, files, sectionItems, brief, live, extraCards, slug, runId,
}: WebBuildConversationProps) {
  const { t } = useLanguageStore();
  const [panel, setPanel] = useState<'preview' | 'files' | null>(null);
  const [filePath, setFilePath] = useState<string | undefined>(undefined);
  const lastIdx = steps.length - 1;
  const openFile = (path?: string) => { setFilePath(path); setPanel('files'); };

  return (
    <div className="space-y-5">
      {steps.map((step, i) => {
        const isLast = i === lastIdx && !live;
        return (
          <RunTurn key={step.id} step={step}>
            {isLast && (
              <>
                <AgentWorkLog agents={step.agents} files={step.files} />
                <CompletedPlanSummary step={step} />
                <div className="flex flex-col gap-2 pt-0.5">
                  <AttachmentCard icon={Monitor} title={t('wbCardPreview')} subtitle={t('wbCardPreviewSub')} actionLabel={t('wbCardOpen')} tone="accent" onClick={() => setPanel('preview')} />
                  <AttachmentCard icon={FolderTree} title={t('wbCardAllFiles')} subtitle={t('wbCardAllFilesSub')} actionLabel={t('wbCardOpen')} onClick={() => openFile(undefined)} />
                  {extraCards}
                </div>
              </>
            )}
          </RunTurn>
        );
      })}

      {live && <LivePhases prompt={live.prompt} kind={live.kind || 'build'} />}

      {/* Slide-in panel (Preview / All files) */}
      <AnimatePresence>
        {panel && (
          <motion.div
            className="fixed inset-0 z-[60] flex justify-end"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/50" onClick={() => setPanel(null)} />
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
              className="relative w-full max-w-2xl h-full overflow-y-auto scrollbar-thin bg-[#0D1117] border-l border-white/[0.08] p-4 sm:p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-[13px] font-semibold text-white">
                  {panel === 'preview' ? t('wbCardPreview') : t('wbCardAllFiles')}
                </span>
                <button onClick={() => setPanel(null)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/[0.05] transition-colors" aria-label={t('wbClosePanel')}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              {panel === 'preview'
                ? <WebBuildPreviewPanel sectionItems={sectionItems} brief={brief} slug={slug} runId={runId} interactionContract={steps[lastIdx]?.artifacts?.strategy?.interactionContract} visualAssetPlan={steps[lastIdx]?.artifacts?.artDirection?.visualAssetPlan} />
                : <WebBuildFileView files={files} initialPath={filePath} />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
