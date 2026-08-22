/**
 * WorkspaceSurface — the shared visual language and the STORY primitives of the
 * Project Workspace.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The Project page shows the same correlated STORY in three places, asking a
 * different question of it each time:
 *
 *   the Focus block      "why is this first, and who has to act?"
 *   the change list      "what happened while I was away?"
 *   current state        "what is going on in this project?"
 *
 * Before this, only one of those had evidence behind it, and each place drew
 * its own rows. One component per concept means one place where "how a story
 * looks" is decided, and — more importantly — one place where the rules about
 * what may be SAID about a story are enforced.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not an authority. Nothing here ranks, scores, correlates, groups or
 * infers. Every value it renders is either a stable code from the backend's
 * closed vocabularies (translated through the locale dictionaries) or a string
 * a provider wrote, which goes through `providerText` first and is rendered as
 * DATA. There is no health number, no percentage and no confidence arithmetic
 * anywhere in this file, and there is deliberately no way to add one: the
 * component props carry codes, not numbers to display.
 */
import React, { useId, useState } from 'react';
import {
  Activity, ArrowUpRight, BookMarked, Blocks, CalendarDays, Check,
  ChevronRight, Github, Hash, ListTodo, Mail, MessageSquare, Minus,
  Sparkles, Triangle, X,
} from 'lucide-react';
import {
  QUIET_BTN, SMALL_BTN, TONE_STYLE, useTimeAgo, type T,
} from '@/components/project/workspaceTokens';
import {
  adjacentClaims, areaKey, changeKindKeyOf, establishedClaims, evidenceCount,
  evidenceOutcomeKey, evidenceTone, groupingRationale, implicationKey,
  notEstablishedClaims, providerText,
  renderableCodes, sourceLabel, stateKey, stateTone, storyOutcomes,
  storyTimeline, uncertaintyKey,
  type EvidencePolarity, type ProjectStateItem, type RenderableClaim,
} from '@/lib/projectWorkspace';

/* Icon for an activity/attention SOURCE, keyed by the observation `source` the
 * backend registry emits (observations_store.CONNECTOR_SOURCES) plus Korvix's
 * own chat/build sources. An unknown source falls back to a neutral glyph
 * rather than being mislabelled as one of the known providers. */
export function SourceIcon({ source, className }: { source?: string | null; className?: string }) {
  const cls = className || 'h-3.5 w-3.5 shrink-0 text-white/35';
  switch (source) {
    case 'gmail': return <Mail className={cls} />;
    case 'calendar': return <CalendarDays className={cls} />;
    case 'github': return <Github className={cls} />;
    case 'vercel': return <Triangle className={cls} />;
    case 'slack': return <Hash className={cls} />;
    case 'chat': return <MessageSquare className={cls} />;
    case 'build': return <Blocks className={cls} />;
    case 'task': return <ListTodo className={cls} />;
    case 'knowledge': return <BookMarked className={cls} />;
    default: return <Activity className={cls} />;
  }
}

export function SourceName({ source, t }: { source: string; t: T }) {
  const label = sourceLabel(source);
  return <>{label.kind === 'provider' ? label.name : t(label.key)}</>;
}

/**
 * PROVIDER-AUTHORED TEXT — a Slack message, a mail subject, a PR title.
 *
 * Rendered as DATA and nothing else: normalized to one bounded line by
 * `providerText` (see that function for the newline / bidi / zero-width rules),
 * never given to the markdown renderer, never used as a heading, and styled a
 * notch quieter than Korvix's own words so a provider cannot borrow the
 * product's voice by writing something that looks like a section title.
 */
export function ProviderText({ value, className, limit }: {
  value?: string | null;
  className?: string;
  limit?: number;
}) {
  const text = providerText(value, limit);
  if (!text) return null;
  return (
    <span className={className || 'text-[12px] leading-snug text-white/50 break-words'}>
      {text}
    </span>
  );
}

/** The correlated state, in the backend's own closed vocabulary. */
export function StateChip({ state, t, subtle }: { state: string; t: T; subtle?: boolean }) {
  const tone = TONE_STYLE[stateTone(state)];
  if (subtle) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium"
        style={{ color: tone.text }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
        {t(stateKey(state))}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10.5px] font-medium"
      style={{ color: tone.text, borderColor: `${tone.dot}40`, background: `${tone.dot}14` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
      {t(stateKey(state))}
    </span>
  );
}

/* ── Evidence marks ──────────────────────────────────────────────────────────
   ✓ / ✕ / – for the backend's OWN polarity. The page never reads an outcome
   out of a title, so an event whose polarity the backend did not decide simply
   gets no mark rather than an invented one. */
export function PolarityMark({ polarity }: { polarity: EvidencePolarity }) {
  const tone = evidenceTone(polarity);
  if (tone === 'positive') return <Check className="h-3 w-3 shrink-0" style={{ color: TONE_STYLE.positive.dot }} />;
  if (tone === 'negative') return <X className="h-3 w-3 shrink-0" style={{ color: TONE_STYLE.critical.dot }} />;
  if (tone === 'pending') return <Minus className="h-3 w-3 shrink-0" style={{ color: TONE_STYLE.warning.dot }} />;
  return null;
}

/**
 * The compact per-source outcome strip: "GitHub ✓ Merged · Vercel ✕ Deployment
 * failed · production".
 *
 * This is the line that turns four provider cards into one story. Every part of
 * it is backend truth — the source, the semantic type and the polarity all
 * travel on the evidence row — and a preview that passed is never merged with a
 * production deploy that failed, because the environment is part of the
 * identity `storyOutcomes` keys on.
 */
export function OutcomeStrip({ item, t, limit = 4 }: {
  item: ProjectStateItem | null;
  t: T;
  limit?: number;
}) {
  const outcomes = storyOutcomes(item, limit);
  if (!outcomes.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {outcomes.map((o) => {
        const outcomeKey = evidenceOutcomeKey(o.semantic_type);
        return (
          <span key={`${o.source}|${o.environment}|${o.polarity}`}
            className="inline-flex flex-wrap items-center gap-1 max-w-full text-[11.5px] text-white/55">
            <SourceIcon source={o.source} className="h-3 w-3 shrink-0 text-white/35" />
            <SourceName source={o.source} t={t} />
            <PolarityMark polarity={o.polarity} />
            {outcomeKey && <span className="text-white/70">{t(outcomeKey)}</span>}
            {/* The environment name comes from the provider's own deployment
                target, so it is DATA like any other provider string. */}
            {o.environment && (
              <span className="text-white/35">· {providerText(o.environment, 40)}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ── "Why Korvix thinks this" ─────────────────────────────────────────────── */

function ClaimList({ claims, t, muted }: {
  claims: RenderableClaim[];
  t: T;
  muted?: boolean;
}) {
  if (!claims.length) return null;
  return (
    <ul className="space-y-1">
      {claims.map((c) => (
        <li key={c.claim}
          className={`text-[12px] leading-snug break-words ${muted ? 'text-white/40' : 'text-white/60'}`}>
          {t(c.key)}
          {/* The honesty riders, attached to the claim rather than filed as a
              footnote somewhere else on the page. */}
          {c.singleSource && (
            <span className="text-white/35"> · {t('projectWhySingleSource')}</span>
          )}
          {c.basis === 'textual' && (
            <span className="text-white/35"> · {t('projectWhyBasisTextual')}</span>
          )}
          {muted && c.missingKeys.length > 0 && (
            <span className="text-white/30">
              {' '}· {t('projectWhyWouldEstablish', {
                items: c.missingKeys.map((k) => t(k)).join(', '),
              })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
      {children}
    </div>
  );
}

/**
 * The evidence panel — the surface this whole feature exists for.
 *
 * It answers, in order: why these events were grouped, what actually happened
 * (as a chronology, oldest first), what that evidence ESTABLISHES, what it only
 * points at, what it does NOT establish, and what is still unknown.
 *
 * Every line is a translated backend code or a piece of provider text rendered
 * as data. The "not established" list is the grounding authority's own answer,
 * not a rhetorical device: on a project whose only tool is Vercel it is what
 * stops the page from implying that a green deployment means the product works.
 */
export function EvidencePanel({ item, onAsk, t }: {
  item: ProjectStateItem;
  onAsk?: (prompt: string) => void;
  t: T;
}) {
  const timeAgo = useTimeAgo(t);
  const rationale = groupingRationale(item);
  const timeline = storyTimeline(item);
  const established = establishedClaims(item.grounding);
  const adjacent = adjacentClaims(item.grounding);
  const notEstablished = notEstablishedClaims(item.grounding);
  const uncertainty = renderableCodes(item.understanding?.uncertainty, uncertaintyKey, 3);
  const total = evidenceCount(item);

  return (
    <div className="mt-2.5 space-y-3 rounded-xl border border-white/[0.05] bg-white/[0.015] p-3">
      {rationale && (
        <div>
          <PanelHeading>{t('projectStateWhyTitle')}</PanelHeading>
          <div className="text-[12px] leading-relaxed text-white/55">
            {t(rationale.wordingOnly
              ? 'projectStateGroupedByWording'
              : 'projectStateGroupedByResource', {
              evidence: rationale.evidenceCount,
              sources: rationale.sourceCount,
            })}
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <div>
          <PanelHeading>{t('projectWhyTimeline')}</PanelHeading>
          <ol className="space-y-1.5">
            {timeline.map((e) => {
              const outcomeKey = evidenceOutcomeKey(e.semantic_type);
              return (
                <li key={`${e.observation_id}|${e.semantic_type}|${e.observed_at}`}
                  className="flex items-start gap-2">
                  <SourceIcon source={e.source} className="mt-[3px] h-3 w-3 shrink-0 text-white/30" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-white/60">
                      <span className="text-white/45"><SourceName source={e.source} t={t} /></span>
                      <PolarityMark polarity={e.polarity} />
                      {outcomeKey && <span className="text-white/75">{t(outcomeKey)}</span>}
                      {e.environment && (
                        <span className="text-white/35">· {providerText(e.environment, 40)}</span>
                      )}
                      {e.observed_at && <span className="text-white/30">· {timeAgo(e.observed_at)}</span>}
                    </div>
                    <ProviderText value={e.title}
                      className="text-[11.5px] leading-snug text-white/45 break-words" />
                  </div>
                </li>
              );
            })}
          </ol>
          {total > timeline.length && (
            <p className="mt-1.5 text-[10.5px] text-white/25">
              {t('projectChangesMore', { count: total - timeline.length })}
            </p>
          )}
        </div>
      )}

      {established.length > 0 && (
        <div>
          <PanelHeading>{t('projectWhyEstablished')}</PanelHeading>
          <ClaimList claims={established} t={t} />
        </div>
      )}

      {adjacent.length > 0 && (
        <div>
          <PanelHeading>{t('projectWhyAdjacent')}</PanelHeading>
          <ClaimList claims={adjacent} t={t} muted />
          <p className="mt-1 text-[11px] leading-snug text-white/30">
            {t('projectWhyAdjacentNote')}
          </p>
        </div>
      )}

      {notEstablished.length > 0 && (
        <div>
          <PanelHeading>{t('projectWhyNotEstablished')}</PanelHeading>
          <ClaimList claims={notEstablished} t={t} muted />
        </div>
      )}

      {uncertainty.length > 0 && (
        <div>
          <PanelHeading>{t('projectStateUncertainTitle')}</PanelHeading>
          <ul className="space-y-1">
            {uncertainty.map((u) => (
              <li key={u.code} className="text-[12px] leading-snug text-white/50 break-words">
                {t(u.key)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onAsk && (
        <button type="button"
          onClick={() => onAsk(t('projectStateAskPrompt', { subject: item.subject }))}
          className={SMALL_BTN}>
          <Sparkles className="h-3 w-3" />
          {t('projectActionAsk')}
        </button>
      )}
    </div>
  );
}

/**
 * The low-chrome "N evidence" affordance and the panel it opens.
 *
 * Deliberately NOT a button per row with a border and a label: an explanation
 * offered as loudly as the thing it explains stops being progressive
 * disclosure. It prints the evidence count, which is both the affordance and
 * the most useful single fact about how well-supported the row is.
 */
export function EvidenceDisclosure({ item, onAsk, t, labelKey }: {
  item: ProjectStateItem | null;
  onAsk?: (prompt: string) => void;
  t: T;
  labelKey?: string;
}) {
  const [open, setOpen] = useState(false);
  // Hooks run before the early return, so the id is stable for a given row
  // whether or not this instance has anything to disclose.
  const panelId = useId();
  if (!item) return null;
  const count = evidenceCount(item);
  if (!count && !item.grounding) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-controls={panelId} className={QUIET_BTN}>
        {labelKey
          ? t(labelKey)
          : t(count === 1 ? 'projectWhyEvidenceOne' : 'projectWhyEvidenceMany', { count })}
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div id={panelId}>
          <EvidencePanel item={item} onAsk={onAsk} t={t} />
        </div>
      )}
    </>
  );
}

/**
 * ONE CORRELATED STORY, as a row.
 *
 * The single unit the Workspace shows for connected-tool activity. It carries
 * the subject Korvix resolved, its state, what the evidence implies, the
 * per-source outcome strip, and the evidence disclosure — so a GitHub merge, a
 * Vercel deployment and a Slack thread about them are ONE thing on screen
 * rather than three cards a reader has to re-correlate.
 *
 * `fallbackTitle` covers a change the correlation authority did not speak for:
 * the row still renders, from the provider's own summary, with no story
 * attached. That is the honest presentation of an uncorrelated event — never a
 * fabricated grouping.
 */
export function StoryRow({ item, fallbackTitle, fallbackSource, when, onAsk, t }: {
  item: ProjectStateItem | null;
  fallbackTitle?: string;
  fallbackSource?: string;
  when?: string;
  onAsk?: (prompt: string) => void;
  t: T;
}) {
  const timeAgo = useTimeAgo(t);
  const implications = renderableCodes(item?.understanding?.implications, implicationKey, 2);
  const areas = (item?.understanding?.areas || [])
    .map((a) => ({ ...a, key: areaKey(a.area) }))
    .filter((a) => a.key && a.area !== 'unknown');
  const kindKey = changeKindKeyOf(item?.understanding?.change_kind.kind || '');
  const stamp = when || item?.last_seen || '';

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {item && <StateChip state={item.state} t={t} subtle />}
        {/* The SUBJECT is Korvix's label for the story, but the correlation
            authority builds it from provider identities (a repository, a pull
            request title), so it is normalized like every other provider
            string before it is allowed to sit at heading weight. */}
        <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-white/90 break-words">
          {providerText(item?.subject, 160) || providerText(fallbackTitle)}
        </span>
        {stamp && <span className="shrink-0 text-[10.5px] text-white/30">{timeAgo(stamp)}</span>}
      </div>

      {implications.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {implications.map((imp) => (
            <li key={imp.code} className="text-[12.5px] leading-snug text-white/60 break-words">
              {t(imp.key)}
            </li>
          ))}
        </ul>
      )}

      {item
        ? <OutcomeStrip item={item} t={t} />
        : fallbackSource && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-white/35">
            <SourceIcon source={fallbackSource} className="h-3 w-3 shrink-0 text-white/30" />
            <SourceName source={fallbackSource} t={t} />
          </div>
        )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-white/30">
        {areas.map((a) => (
          <span key={a.area} className="rounded-md bg-white/[0.05] px-1.5 py-[2px] text-white/45">
            {t(a.key as string)}
          </span>
        ))}
        {kindKey && (
          <span className="rounded-md bg-white/[0.05] px-1.5 py-[2px] text-white/45">
            {t(kindKey)}
          </span>
        )}
        <span className="ml-auto">
          <EvidenceDisclosure item={item} onAsk={onAsk} t={t} />
        </span>
      </div>
    </li>
  );
}

/** A quiet "go to the full surface" link. Used instead of a second card
 *  whenever a bounded list has more behind it. */
export function MoreLink({ label, onClick, external }: {
  label: string;
  onClick: () => void;
  external?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1 text-[11.5px] text-white/45 hover:text-white transition-colors">
      {label}
      {external
        ? <ArrowUpRight className="h-3 w-3" />
        : <ChevronRight className="h-3 w-3" />}
    </button>
  );
}
