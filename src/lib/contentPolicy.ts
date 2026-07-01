// Build-scope content policy — frontend mirror of
// backend/services/generation/content_policy.py.
//
// The backend gate is the source of truth (start_project_run raises
// `unsupported_request` before any template is selected). This mirror
// exists so Build Studio can decline BEFORE opening the Design Interview
// or spending a network round-trip — an unsupported prompt should never
// walk the user through four design questions first.
//
// Patterns are deliberately narrow so legitimate prompts ("adult
// education platform", "young adult book club site") never trip them.

const BLOCKED_RULES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: new RegExp(
      String.raw`(?:\+\s*18|18\s*\+|\bporn\w*|\bnsfw\b|\bxxx\b|\bx-?rated\b|\berotic\w*|` +
      String.raw`\bhentai\b|\bonlyfans\b|\bescorts?\b|\bstrip\s*club\b|` +
      String.raw`\badult\s*(?:web\s*)?(?:site|website|content|entertainment|video|movie|film|cam|chat|shop|store)\b|` +
      String.raw`\bsex\s*(?:cam|chat|site|shop|toy|work)\w*)`, 'i'),
    reason: 'adult or sexually explicit content',
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:guns?|firearms?|weapons?|ammunition|ammo|explosives?|silencers?)\s+` +
      String.raw`(?:store|shop|market\w*|marketplace|sales?|selling|site|website)\b`, 'i'),
    reason: 'weapons sales',
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:drugs?|narcotics?|cocaine|heroin|meth|fentanyl|mdma)\s+` +
      String.raw`(?:store|shop|market\w*|marketplace|sales?|selling|site|website)\b`, 'i'),
    reason: 'illegal drug sales',
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:phishing|malware|ransomware|botnet|carding|card\s*skimm\w*|` +
      String.raw`credential\s*stuff\w*|fake\s*ids?|counterfeit\s+(?:money|goods|documents))\b`, 'i'),
    reason: 'fraud or malicious tooling',
  },
];

/** Short human-readable reason when the prompt is outside the builder's
    supported scope, else null. Scans only the user's own words — a
    trailing DESIGN_BRIEF block is stripped first. */
export function unsupportedBuildReason(prompt: string): string | null {
  let text = prompt || '';
  const idx = text.indexOf('\n\nDESIGN_BRIEF:');
  if (idx !== -1) text = text.slice(0, idx);
  for (const { pattern, reason } of BLOCKED_RULES) {
    if (pattern.test(text)) return reason;
  }
  return null;
}
