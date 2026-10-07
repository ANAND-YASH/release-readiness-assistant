// Deterministic detection of absolute claims ("fully tested", "no performance
// impact", "all users are unaffected", ...). Used to (1) find claim candidates in
// the release package before the model runs and (2) stop generated summaries
// from asserting such claims as fact.

const ABSOLUTE_CLAIM_PATTERNS: RegExp[] = [
  /\b(fully|thoroughly|comprehensively|completely|extensively|exhaustively) tested\b/i,
  /\b100\s?% (tested|test coverage|coverage|covered)\b/i,
  /\bno (performance|user|customer|functional|breaking|downstream|negative) impact\b/i,
  /\bzero (risk|downtime|impact|regressions?)\b/i,
  /\ball (users|customers) (are|will be|remain) unaffected\b/i,
  /\bno (users?|customers?) (are|is|will be) (affected|impacted)\b/i,
  /\b(fully|completely|100%) backwards?[- ]compatible\b/i,
  /\bbug[- ]free\b/i,
  /\bno known (issues|bugs|risks|problems)\b/i,
  /\bguaranteed?\b/i,
  /\bwithout any (risk|impact|issues|downtime)\b/i,
];

/** Words that turn an absolute claim into a hedged or reported one ("is described as fully tested, but..."). */
const HEDGE_PATTERN =
  /\b(not|unverified|unconfirmed|unsupported|unproven|no (qa )?evidence|claimed|claims?|stated|states|described as|has not|hasn't|have not|haven't|cannot|can't|may|might|unclear|pending|yet to)\b/i;

export interface ClaimMatch {
  phrase: string;
  sentence: string;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function findAbsoluteClaims(text: string): ClaimMatch[] {
  const matches: ClaimMatch[] = [];
  for (const sentence of sentences(text)) {
    for (const pattern of ABSOLUTE_CLAIM_PATTERNS) {
      const match = pattern.exec(sentence);
      if (match) matches.push({ phrase: match[0], sentence });
    }
  }
  return matches;
}

/** True when the text asserts an absolute claim without hedging or attributing it. */
export function containsUnhedgedClaim(text: string): boolean {
  return findAbsoluteClaims(text).some((claim) => !HEDGE_PATTERN.test(claim.sentence));
}
