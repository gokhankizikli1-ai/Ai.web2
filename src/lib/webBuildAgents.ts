/**
 * Web Build AGENT layer (Phase 1: Research Agent + UI / Art Director Agent).
 *
 * These are the two real UPSTREAM agents that run before layout/component
 * generation. Each produces a structured, backward-compatible artifact that
 * later agents (Layout Architect, Component Engineer — not built yet) and the
 * current design system / preview / files consume.
 *
 * HONESTY RULES (never violated here):
 *  - The Research Agent reports the REAL backend research status. It never
 *    claims sources it doesn't have and never fabricates citations. When no live
 *    sources exist it uses "strategy inference" language, not "research found".
 *  - The Art Director derives a DYNAMIC visual direction from the prompt + brief
 *    + research + the (already strategy-driven) design system — it is not a fixed
 *    industry theme and does not hardcode example websites.
 *
 * Everything here is a pure, deterministic derivation, so old saved builds
 * recompute the same artifacts and nothing needs to be persisted to work.
 */
import type { WebBuildBrief, WebBuildResearch, WebBuildResearchStatus, WebBuildSource } from '@/lib/webBuildApi';
import { designTokensForBrief, type InferredBrief } from '@/lib/webBuildBrief';
import { deriveDesignSystemFromStrategy } from '@/lib/webBuildDesignSystem';

type Lang = 'en' | 'tr' | string;
const L = (lang: Lang, en: string, tr: string) => (lang === 'tr' ? tr : en);
const uniq = (xs: string[]): string[] => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));

export type AgentStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/* ── Research Agent artifact ──────────────────────────────────────────── */
export interface ResearchAgentArtifact {
  didResearch: boolean;
  status: WebBuildResearchStatus;
  provider?: string;
  attemptedProviders?: string[];
  queryCount?: number;
  sourceCount?: number;
  sources?: WebBuildSource[];
  researchAngles: string[];
  /** Insights synthesized from what matters for THIS site (source-backed only
   *  when real sources exist — labeled honestly in `summary`). */
  sourceBackedInsights: string[];
  categoryLanguage: string[];
  audienceExpectations: string[];
  conversionPatterns: string[];
  trustSignals: string[];
  visualPatterns: string[];
  competitorOrAdjacentPatterns: string[];
  risksToAvoid: string[];
  differentiationOpportunities: string[];
  summary: string;
}

/* ── UI / Art Director artifact ───────────────────────────────────────── */
export interface ArtDirectionColorSystem {
  background: string;
  foreground: string;
  accent: string;
  accent2: string;
  muted: string;
  surface: string;
  border: string;
}

export type ArtDensity = 'minimal' | 'balanced' | 'rich' | 'immersive';

export interface ArtDirectionArtifact {
  visualMood: string;
  brandPersonality: string;
  typographyDirection: string;
  colorSystem: ArtDirectionColorSystem;
  layoutFeeling: string;
  visualMetaphor: string;
  imageryDirection: string;
  motionDirection: string;
  density: ArtDensity;
  premiumDetails: string[];
  avoid: string[];
  uiPrinciples: string[];
  componentStyleHints: string[];
  heroDirection: string;
  sectionRhythmDirection: string;
  summary: string;
}

export interface WebBuildAgent {
  id: 'research' | 'ui_art_director';
  name: string;
  status: AgentStatus;
  summary: string;
  artifact: ResearchAgentArtifact | ArtDirectionArtifact | Record<string, unknown>;
}

export interface WebBuildAgents {
  agents: WebBuildAgent[];
  artifacts: {
    research?: ResearchAgentArtifact;
    artDirection?: ArtDirectionArtifact;
  };
}

/* ── Research Agent ───────────────────────────────────────────────────── */

const ANGLE_LABELS = (lang: Lang): Record<string, string> => ({
  category: L(lang, 'Category & positioning', 'Kategori ve konumlandırma'),
  audience: L(lang, 'Audience expectations', 'Hedef kitle beklentileri'),
  conversion: L(lang, 'Conversion patterns', 'Dönüşüm kalıpları'),
  trust: L(lang, 'Trust & credibility', 'Güven ve itibar'),
  visual: L(lang, 'Visual & UI patterns', 'Görsel ve arayüz kalıpları'),
});

/**
 * Build the Research Agent artifact. Consumes the real backend research metadata
 * (when present) plus the inferred category playbook, and SYNTHESIZES why it
 * matters for the website — it never just passes URLs through. Honest about
 * whether live sources actually informed it.
 */
export function deriveResearchAgent(
  brief: WebBuildBrief,
  research: WebBuildResearch | undefined,
  inferred: InferredBrief,
  lang: Lang = 'en',
): ResearchAgentArtifact {
  const sources = research?.sources || [];
  const sourceCount = research?.sourceCount ?? sources.length;
  const didResearch = !!research?.didResearch && sourceCount > 0;
  const status: WebBuildResearchStatus = research?.status
    || (didResearch ? 'used_sources' : sources.length ? 'no_sources' : 'fallback_strategy');

  const labels = ANGLE_LABELS(lang);
  const researchAngles = research?.angles?.length
    ? research.angles
    : [labels.category, labels.audience, labels.conversion, labels.trust, labels.visual];

  const items = (inferred.items || []).slice(0, 6);
  const categoryLanguage = uniq([brief.type || inferred.businessType, ...items]);
  const audienceExpectations = uniq([
    brief.audience || inferred.targetAudience,
    L(lang, `Understand the offer fast, then a clear next step (${inferred.conversionGoal}).`,
      `Teklifi hızla anlamak, sonra net bir adım (${inferred.conversionGoal}).`),
  ]);
  const conversionPatterns = uniq([
    L(lang, `Single primary action: ${inferred.primaryCTA}.`, `Tek ana eylem: ${inferred.primaryCTA}.`),
    L(lang, `Secondary path: ${inferred.secondaryCTA}.`, `İkincil yol: ${inferred.secondaryCTA}.`),
    inferred.conversionGoal,
  ]);
  const trustSignals = uniq((brief.trustSignals || inferred.trustSignals || '').split(/[,·|]/).map((s) => s.trim()));
  const visualPatterns = uniq([inferred.visualStyle, inferred.previewVisualIdea, inferred.recommendedMotion]);
  const competitorOrAdjacentPatterns = uniq([inferred.strategyNote]);
  const risksToAvoid = uniq([
    L(lang, 'Generic centered hero + three-card grid (reads as a template).',
      'Jenerik ortalanmış hero + üç kart grid (şablon gibi görünür).'),
    L(lang, 'Vague hype copy with no concrete offer or outcome.',
      'Somut teklif/sonuç içermeyen muğlak abartılı metin.'),
    L(lang, 'No single obvious conversion; competing CTAs.',
      'Tek net dönüşüm yok; birbiriyle yarışan CTA\'lar.'),
    L(lang, 'Empty decorative panels / blank placeholder boxes.',
      'Boş dekoratif paneller / boş yer tutucu kutular.'),
  ]);
  const differentiationOpportunities = uniq([
    inferred.previewVisualIdea,
    L(lang, `Lead with the strongest proof this category needs (${inferred.trustSignals}).`,
      `Bu kategorinin ihtiyaç duyduğu en güçlü kanıtla aç (${inferred.trustSignals}).`),
    L(lang, `A visual metaphor tied to the concept, not a stock hero.`,
      `Konsepte bağlı bir görsel metafor; stok bir hero değil.`),
  ]);

  // Insights: phrased as source-backed ONLY when real sources exist.
  const sourceBackedInsights = didResearch
    ? uniq([
        L(lang, `${sourceCount} live source(s) confirm the category conventions above.`,
          `${sourceCount} canlı kaynak yukarıdaki kategori kurallarını doğruluyor.`),
        ...sources.slice(0, 3).map((s) => s.title).filter(Boolean),
      ])
    : uniq([
        L(lang, 'No live sources — the above is strategy inference from the idea + category knowledge.',
          'Canlı kaynak yok — yukarıdakiler fikir + kategori bilgisinden çıkarılan stratejidir.'),
      ]);

  const summary = didResearch
    ? L(lang,
        `Researched ${sourceCount} source(s) across ${researchAngles.length} angles; synthesized category language, audience expectations, conversion patterns, trust signals and risks to avoid.`,
        `${researchAngles.length} açıdan ${sourceCount} kaynak araştırıldı; kategori dili, kitle beklentileri, dönüşüm kalıpları, güven sinyalleri ve kaçınılacak riskler sentezlendi.`)
    : L(lang,
        `No live sources available — inferred category language, audience expectations, conversion patterns and risks from the idea (strategy inference).`,
        `Canlı kaynak yok — fikirden kategori dili, kitle beklentileri, dönüşüm kalıpları ve riskler çıkarıldı (strateji çıkarımı).`);

  return {
    didResearch,
    status,
    provider: research?.provider,
    attemptedProviders: research?.attemptedProviders,
    queryCount: research?.queryCount,
    sourceCount,
    sources: sources.length ? sources : undefined,
    researchAngles,
    sourceBackedInsights,
    categoryLanguage,
    audienceExpectations,
    conversionPatterns,
    trustSignals,
    visualPatterns,
    competitorOrAdjacentPatterns,
    risksToAvoid,
    differentiationOpportunities,
    summary,
  };
}

/* ── UI / Art Director Agent ──────────────────────────────────────────── */

/** Map the design system's spacing density into the art-direction vocabulary. */
function artDensity(density: 'compact' | 'comfortable' | 'spacious', motion: 'minimal' | 'subtle' | 'expressive'): ArtDensity {
  if (density === 'spacious') return motion === 'expressive' ? 'immersive' : 'minimal';
  if (density === 'compact') return 'rich';
  return 'balanced';
}

const isSerif = (font: string) => /serif|georgia|cambria|times/i.test(font);

/**
 * Build the UI / Art Director artifact. Converts research + brief into a strong,
 * DYNAMIC visual direction. The palette comes from the strategy-driven design
 * system (already prompt/industry/color-hint aware), so two different ideas
 * produce different color systems; the art director wraps it into a full system
 * (foreground/surface/border) and a coherent direction later agents can trust.
 */
export function deriveArtDirection(
  brief: WebBuildBrief,
  research: ResearchAgentArtifact,
  inferred: InferredBrief,
  lang: Lang = 'en',
): ArtDirectionArtifact {
  const ds = deriveDesignSystemFromStrategy(brief);
  // Resolve the palette from a brief whose mood/color words are populated, so the
  // color system reflects the intended direction (not a bare indigo default when
  // the backend returned no explicit color).
  const moodBrief = {
    ...brief,
    visualMood: brief.visualMood || brief.style || inferred.visualStyle,
    colorDirection: brief.colorDirection || brief.visualMood || brief.style || inferred.visualStyle,
  };
  const tokens = designTokensForBrief(moodBrief);

  const colorSystem: ArtDirectionColorSystem = {
    background: tokens.bg,
    foreground: '#f1f5f9',
    accent: tokens.accent,
    accent2: tokens.accent2,
    muted: '#94a3b8',
    surface: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.10)',
  };

  const visualMood = brief.visualMood || brief.style || inferred.visualStyle;
  const brandPersonality = uniq([inferred.tone, brief.audience || inferred.targetAudience]).join(' · ')
    || L(lang, 'confident, modern, premium', 'kendinden emin, modern, premium');
  const typographyDirection = brief.typographyDirection
    || (isSerif(tokens.headingFont)
      ? L(lang, 'Editorial serif headlines with a clean sans body — refined, premium.',
          'Editoryal serif başlıklar, temiz sans gövde — zarif, premium.')
      : L(lang, 'Modern geometric sans headlines with a neutral sans body — crisp, confident.',
          'Modern geometrik sans başlıklar, nötr sans gövde — net, kendinden emin.'));
  const layoutFeeling = brief.layoutLogic
    || L(lang, `A ${ds.sectionRhythm} rhythm with ${ds.density} spacing that fits the concept.`,
        `Konsepte uygun ${ds.density} boşluklu ${ds.sectionRhythm} bir ritim.`);
  const visualMetaphor = brief.visualMetaphor || inferred.previewVisualIdea;
  const imageryDirection = L(lang,
    `Composed CSS/SVG visuals (${inferred.previewVisualIdea}) — no stock photos, no blank boxes.`,
    `Kompoze CSS/SVG görseller (${inferred.previewVisualIdea}) — stok fotoğraf yok, boş kutu yok.`);
  const motionByLevel = ds.motion === 'minimal'
    ? L(lang, 'Restrained, quiet motion — a single calm reveal, no distraction.', 'Ölçülü, sakin hareket — tek bir sakin beliriş, dikkat dağıtmadan.')
    : ds.motion === 'expressive'
      ? L(lang, 'Expressive, kinetic motion — bold reveals and depth, still tasteful.', 'İfade dolu, kinetik hareket — cesur belirişler ve derinlik, yine de zevkli.')
      : L(lang, 'Subtle premium motion — gentle reveals and hover states.', 'İnce premium hareket — yumuşak belirişler ve hover durumları.');
  const motionDirection = brief.motionDirection || motionByLevel || inferred.recommendedMotion;
  const density = artDensity(ds.density, ds.motion);

  const premiumDetails = uniq([
    L(lang, 'Soft accent glow on primary actions', 'Ana eylemlerde yumuşak vurgu parıltısı'),
    L(lang, 'Consistent surface + border language', 'Tutarlı yüzey + kenarlık dili'),
    ds.cardStyle === 'glass' ? L(lang, 'Subtle glass/blur surfaces', 'İnce cam/blur yüzeyler')
      : ds.cardStyle === 'outline' ? L(lang, 'Precise hairline outlines', 'Hassas ince çizgi kenarlıklar')
      : L(lang, 'Solid, tactile surfaces', 'Dolgun, dokunsal yüzeyler'),
    L(lang, 'Tasteful reveal-on-scroll, never childish', 'Zevkli scroll-belirme, asla çocuksu değil'),
  ]);
  const avoid = uniq([
    ...research.risksToAvoid.slice(0, 2),
    L(lang, 'Default indigo/cyan when the concept implies another palette',
      'Konsept başka bir palet ima ederken varsayılan indigo/camgöbeği'),
    L(lang, 'Generic stock imagery and flat gray placeholders',
      'Jenerik stok görseller ve düz gri yer tutucular'),
  ]);
  const uiPrinciples = uniq([
    L(lang, 'One obvious conversion path per screen', 'Ekran başına tek net dönüşüm yolu'),
    L(lang, 'Strong typographic hierarchy over decoration', 'Dekorasyon yerine güçlü tipografik hiyerarşi'),
    L(lang, 'Generous, intentional whitespace', 'Cömert, amaçlı boşluk'),
    L(lang, 'A coherent surface language across all sections', 'Tüm bölümlerde tutarlı yüzey dili'),
  ]);
  const componentStyleHints = uniq([
    L(lang, `Cards: ${ds.cardStyle}`, `Kartlar: ${ds.cardStyle}`),
    L(lang, `Corner radius: ${tokens.radius}`, `Köşe yarıçapı: ${tokens.radius}`),
    L(lang, `Heading tracking: ${tokens.tracking}`, `Başlık aralığı: ${tokens.tracking}`),
    L(lang, `Accent used for a single focal action, not everywhere`, `Vurgu her yerde değil, tek odak eyleminde`),
  ]);
  const heroDirection = L(lang,
    `Lead with ${visualMetaphor}; place the primary CTA (${brief.primaryCTA || inferred.primaryCTA}) where the eye lands first.`,
    `${visualMetaphor} ile aç; ana CTA'yı (${brief.primaryCTA || inferred.primaryCTA}) gözün ilk indiği yere koy.`);
  const sectionRhythmDirection = L(lang,
    `Vary section composition (${ds.sectionRhythm}); avoid repeating one card grid down the page.`,
    `Bölüm kompozisyonunu değiştir (${ds.sectionRhythm}); sayfa boyunca tek kart gridini tekrarlama.`);

  const summary = L(lang,
    `Art direction: ${visualMood}. ${isSerif(tokens.headingFont) ? 'Editorial' : 'Modern'} type, ${density} density, ${ds.motion} motion, metaphor "${visualMetaphor}".`,
    `Sanat yönü: ${visualMood}. ${isSerif(tokens.headingFont) ? 'Editoryal' : 'Modern'} tipografi, ${density} yoğunluk, ${ds.motion} hareket, metafor "${visualMetaphor}".`);

  return {
    visualMood,
    brandPersonality,
    typographyDirection,
    colorSystem,
    layoutFeeling,
    visualMetaphor,
    imageryDirection,
    motionDirection: motionDirection || inferred.recommendedMotion,
    density,
    premiumDetails,
    avoid,
    uiPrinciples,
    componentStyleHints,
    heroDirection,
    sectionRhythmDirection,
    summary,
  };
}

/* ── Orchestration ────────────────────────────────────────────────────── */

/**
 * Run the two Phase-1 upstream agents in order (Research → UI / Art Director)
 * and return their artifacts + row-ready agent list. Deterministic and honest:
 * the Research Agent reflects the real backend research status; the Art Director
 * builds on the research + brief.
 */
export function deriveWebBuildAgents(
  // `_prompt` already shaped `inferred` (via inferWebsiteBrief) upstream; kept in
  // the signature so the pipeline entry point clearly consumes the user prompt.
  _prompt: string,
  brief: WebBuildBrief,
  research: WebBuildResearch | undefined,
  inferred: InferredBrief,
  lang: Lang = 'en',
): WebBuildAgents {
  const researchArtifact = deriveResearchAgent(brief, research, inferred, lang);
  const artDirection = deriveArtDirection(brief, researchArtifact, inferred, lang);

  const agents: WebBuildAgent[] = [
    {
      id: 'research',
      name: L(lang, 'Research Agent', 'Araştırma Ajanı'),
      status: 'done',
      summary: researchArtifact.summary,
      artifact: researchArtifact,
    },
    {
      id: 'ui_art_director',
      name: L(lang, 'UI / Art Director Agent', 'UI / Sanat Yönetmeni Ajanı'),
      status: 'done',
      summary: artDirection.summary,
      artifact: artDirection,
    },
  ];

  return { agents, artifacts: { research: researchArtifact, artDirection } };
}
