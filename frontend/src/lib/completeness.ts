/**
 * Profile-completeness scoring from the DB shape (Phase 8 Discovery).
 *
 * The onboarding wizard has its own computeCompleteness() in lib/onboarding.ts that
 * reads the in-memory wizard store and caps at 86 (onboarding never reaches 100 — the
 * media kit owns the rest). This sibling scores from what's actually persisted, so an
 * edit on the "You" tab can push a creator toward 100 as they fill rate card,
 * content category, affiliations, etc. Kept separate to avoid regressing onboarding.
 */

export type CreatorCompletenessInput = {
  city: string | null;
  niches: string[] | null;
  contentLanguages: string[] | null;
  bio: string | null;
  contentCategory: string | null;
  handleCount: number;
  rateCardEnabledWithItems: boolean;
  hasAffiliationOrPartnership: boolean;
};

/** 0–100. Additive weights; each block is independent enrichment. */
export function computeCreatorCompleteness(input: CreatorCompletenessInput): number {
  let pct = 40; // base: a profile row with a display name exists
  if (input.city?.trim()) pct += 6;
  if (input.niches?.length) pct += 8;
  if (input.contentLanguages?.length) pct += 6;
  if (input.bio?.trim()) pct += 6;
  if (input.contentCategory?.trim()) pct += 6;
  if (input.handleCount > 0) pct += 10;
  if (input.rateCardEnabledWithItems) pct += 12;
  if (input.hasAffiliationOrPartnership) pct += 6;
  return Math.min(pct, 100);
}

export type BrandCompletenessInput = {
  industry: string | null;
  domain: string | null;
  hasProfileAttributes: boolean;
};

/** 0–100 for a brand's own profile. */
export function computeBrandCompleteness(input: BrandCompletenessInput): number {
  let pct = 55; // base: company name + contact exist
  if (input.industry?.trim()) pct += 15;
  if (input.domain?.trim()) pct += 15;
  if (input.hasProfileAttributes) pct += 15;
  return Math.min(pct, 100);
}
