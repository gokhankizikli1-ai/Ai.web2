/**
 * Web Build INTERACTION layer — deterministic anchor / CTA routing.
 *
 * Generated sites (and the preview) are a single scrolling page, but nav links
 * and CTA buttons used to be dead or point at hardcoded ids (`#contact`,
 * `#gallery`) that often did not exist. This pure module decides, from the ACTUAL
 * final section ids + the concept, where each nav item and CTA should scroll —
 * so Preview and All Files share one source of truth and never disagree.
 *
 * Pure, deterministic, no throws, no dependencies. Type-only import of
 * ArtRenderMode (leaf module → no import cycle).
 */
import type { ArtRenderMode } from '@/lib/webBuildArtIdentity';

export interface InteractionContext {
  /** The real, in-order section ids of the page (hero/footer included). */
  sectionIds: string[];
  /** href for the hero primary CTA (e.g. '#quote-cta'), or '#top'. */
  primaryTarget: string;
  /** href for the hero secondary CTA, or '#top'. */
  secondaryTarget: string;
  /** href for the strongest conversion action on the page, or '#top'. */
  conversionTarget: string;
  artMode: ArtRenderMode;
}

/** Normalize any section id/name into a safe, stable anchor id. */
export function anchorId(id: string): string {
  return (id || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** The `#id` href for a section. */
export function sectionHref(id: string): string {
  return `#${anchorId(id)}`;
}

/** Per-concept CTA target preferences (ordered id fragments, most-preferred first). */
const PRIMARY_PREFS: Partial<Record<ArtRenderMode, string[]>> = {
  archive: ['research-filters', 'collection-index'],
  landscaping: ['quote-cta', 'request-quote'],
  hospitality: ['reservation'],
  'trust-service': ['contact'],
  'product-saas': ['product-demo'],
  marketplace: ['collection-grid', 'featured-products'],
  education: ['pricing-enroll', 'curriculum'],
  event: ['tickets'],
  community: ['donation', 'volunteers'],
  industrial: ['request-quote'],
  portfolio: ['selected-work', 'start-project'],
  modern: ['pricing', 'contact', 'final-cta'],
};
const SECONDARY_PREFS: Partial<Record<ArtRenderMode, string[]>> = {
  archive: ['provenance', 'researcher-access'],
  landscaping: ['project-gallery', 'before-after'],
  hospitality: ['menu', 'location-hours'],
  'trust-service': ['credentials', 'process'],
  'product-saas': ['pricing', 'security-proof', 'integrations'],
  marketplace: ['trust-shipping', 'featured-products'],
  education: ['outcomes', 'curriculum'],
  event: ['agenda', 'speakers'],
  community: ['programs', 'impact'],
  industrial: ['capabilities', 'specifications'],
  portfolio: ['case-studies', 'selected-work'],
  modern: ['features', 'services'],
};
/** The generic ranking of conversion-strength sections (used for CTA targets). */
const CONVERSION_PREFS = [
  'quote-cta', 'request-quote', 'reservation', 'tickets', 'pricing-enroll', 'researcher-access',
  'contact', 'pricing-cart-cta', 'pricing', 'donation', 'start-project', 'final-cta',
];
/** Section ids that ARE a real conversion endpoint (a form/booking/request) — a
 *  CTA inside one targets itself. `final-cta`/`pricing` are prompts, not endpoints,
 *  so their CTA routes to the strongest conversion section instead. */
const CTA_LIKE = new Set([
  'quote-cta', 'request-quote', 'reservation', 'tickets', 'pricing-enroll',
  'pricing-cart-cta', 'researcher-access', 'contact', 'donation', 'volunteers', 'start-project',
]);

/** Find the first real section id matching a preference fragment (exact, then token). */
function findId(sectionIds: string[], pref: string): string {
  const norm = sectionIds.map(anchorId);
  const exact = norm.indexOf(pref);
  if (exact >= 0) return sectionIds[exact];
  const token = norm.findIndex((n) => n.startsWith(`${pref}-`) || n.endsWith(`-${pref}`) || n.includes(pref));
  return token >= 0 ? sectionIds[token] : '';
}

/** Resolve the first preference that maps to a real section → href, else ''. */
function pickTarget(sectionIds: string[], prefs: string[]): string {
  for (const p of prefs) {
    const hit = findId(sectionIds, p);
    if (hit) return sectionHref(hit);
  }
  return '';
}

/** The first non-hero/footer section href (optionally excluding one), else ''. */
function firstContentHref(sectionIds: string[], exclude?: string): string {
  for (const id of sectionIds) {
    if (/hero|footer/.test(anchorId(id))) continue;
    const href = sectionHref(id);
    if (href !== exclude) return href;
  }
  return '';
}

/**
 * Derive the shared interaction context from the real section ids + concept.
 * Always resolves to existing anchors when possible, else '#top'.
 */
export function deriveInteraction(sectionIds: string[], artMode: ArtRenderMode): InteractionContext {
  const ids = (sectionIds || []).filter(Boolean);
  const primary = pickTarget(ids, PRIMARY_PREFS[artMode] || []) || pickTarget(ids, CONVERSION_PREFS) || firstContentHref(ids) || '#top';
  const secondary = pickTarget(ids, SECONDARY_PREFS[artMode] || []) || firstContentHref(ids, primary) || primary || '#top';
  const conversion = pickTarget(ids, CONVERSION_PREFS) || primary || '#top';
  return { sectionIds: ids, primaryTarget: primary, secondaryTarget: secondary, conversionTarget: conversion, artMode };
}

/** CTA target for a specific section: a conversion section points at itself; any
 *  other section's CTA points at the page's conversion target (never a dead id). */
export function ctaTargetForSection(sectionId: string, ctx: InteractionContext): string {
  const self = anchorId(sectionId);
  if (CTA_LIKE.has(self)) return sectionHref(sectionId);
  return ctx.conversionTarget || ctx.primaryTarget || '#top';
}

export interface NavItem { id: string; name: string; href: string }

/** The most useful nav links (content sections only, capped) with real anchors. */
export function pickNavSections(sections: Array<{ id: string; name: string }>, max = 6): NavItem[] {
  return (sections || [])
    .filter((s) => s && s.id && !/hero|footer/.test(anchorId(s.id)))
    .map((s) => ({ id: s.id, name: s.name || s.id, href: sectionHref(s.id) }))
    .slice(0, max);
}
