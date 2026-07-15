import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { ImagePickerAsset } from 'expo-image-picker';

import { supabase } from '@/lib/supabase';
import {
  computeBrandCompleteness,
  computeCreatorCompleteness,
} from '@/lib/completeness';

/**
 * Media-kit data layer (Phase 8 Discovery, Cluster A).
 *
 * Everything here is OWNED-RECORD CRUD → Supabase-direct under RLS (see
 * docs/api-architecture.md 63–75). No FastAPI. The anon client only ever touches
 * rows RLS lets this user touch; these helpers add no privilege of their own.
 *
 * fetchOwnMediaKit() assembles the whole kit for a signed-in creator. The write
 * helpers each update one owned slice and (where relevant) refresh
 * profiles.profile_completeness. Every helper returns a Result and never surfaces
 * a raw DB error to the caller (house style — see lib/onboarding.ts).
 */

export type Result = { ok: true } | { ok: false; message: string };

const GENERIC_ERROR = "Something went wrong saving that. Please try again.";
const NO_CLIENT: Result = { ok: false, message: GENERIC_ERROR };

// ── Types (mirror the DB columns; see 002_identity_profile.sql) ──────────────

export type PrivacySettings = {
  contact_visible: boolean;
  rate_card_visible: boolean;
  handles_visible: boolean;
};

export type SocialHandle = {
  id: string;
  platform: string;
  handle: string;
  follower_count: number | null;
  engagement_rate: number | null;
  weekly_reach: number | null;
  is_primary: boolean;
  verification_status: 'pending' | 'verified';
};

export type RateCardItem = {
  id: string;
  platform: string;
  content_format: string;
  base_price: number;
  currency: string;
  title: string;
  description: string | null;
  add_ons: unknown | null;
};

export type RateCard = {
  id: string;
  is_enabled: boolean;
  items: RateCardItem[];
};

export type Affiliation = {
  id: string;
  type: string;
  name: string;
  year: number | null;
  description: string | null;
};

export type BrandPartnership = {
  id: string;
  brand_name: string;
  platform: string | null;
  views_reach: number | null;
  year: number | null;
  description: string | null;
};

export type CreatorMediaKit = {
  kind: 'creator';
  profileId: string;
  /** creator_profiles.id — the FK target for handles/rate cards/affiliations. */
  creatorId: string;
  displayName: string;
  city: string | null;
  avatarUrl: string | null;
  niches: string[];
  contentCategory: string | null;
  bio: string | null;
  /** Ordered storage paths (NOT URLs) — index 0 is primary; resolve via StorageImage. */
  photoCarousel: string[];
  contentLanguages: string[];
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  trustScore: number | null;
  dealCompletionRate: number | null;
  responseTimeHours: number | null;
  privacy: PrivacySettings;
  handles: SocialHandle[];
  rateCard: RateCard | null;
  affiliations: Affiliation[];
  partnerships: BrandPartnership[];
};

export type BrandProfile = {
  kind: 'brand';
  brandId: string;
  companyName: string;
  industry: string | null;
  domain: string | null;
  verified: boolean;
  trustRating: number | null;
  dealCompletionRate: number | null;
  profileAttributes: Record<string, unknown> | null;
};

export type MediaKitData = CreatorMediaKit | BrandProfile;

const DEFAULT_PRIVACY: PrivacySettings = {
  contact_visible: true,
  rate_card_visible: true,
  handles_visible: true,
};

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Assemble the signed-in user's own media kit / brand profile. Returns null when
 * there's no client or the profile can't be resolved (caller shows an empty state).
 */
export async function fetchOwnMediaKit(userId: string): Promise<MediaKitData | null> {
  if (!supabase) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('account_type, display_name, city, avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile) return null;

  if (profile.account_type === 'brand') {
    return fetchBrandProfile(userId, profile.display_name);
  }
  return fetchCreatorMediaKit(userId, profile);
}

async function fetchBrandProfile(
  userId: string,
  _displayName: string,
): Promise<BrandProfile | null> {
  const client = supabase!;
  // A brand user's own brand via their membership.
  const { data: membership } = await client
    .from('brand_members')
    .select('brand_id')
    .eq('profile_id', userId)
    .maybeSingle();
  if (!membership) return null;

  const { data: brand } = await client
    .from('brands')
    .select('id, company_name, industry, domain, verified, trust_rating, deal_completion_rate, profile_attributes')
    .eq('id', membership.brand_id)
    .maybeSingle();
  if (!brand) return null;

  return {
    kind: 'brand',
    brandId: brand.id,
    companyName: brand.company_name,
    industry: brand.industry,
    domain: brand.domain,
    verified: brand.verified,
    trustRating: brand.trust_rating,
    dealCompletionRate: brand.deal_completion_rate,
    profileAttributes: (brand.profile_attributes as Record<string, unknown> | null) ?? null,
  };
}

async function fetchCreatorMediaKit(
  userId: string,
  profile: { display_name: string; city: string | null; avatar_url: string | null },
): Promise<CreatorMediaKit | null> {
  const client = supabase!;

  const { data: cp } = await client
    .from('creator_profiles')
    .select(
      'id, niches, content_category, bio, content_languages, photo_carousel, inbound_enabled, outbound_enabled, trust_score, deal_completion_rate, response_time_hours, privacy_settings',
    )
    .eq('profile_id', userId)
    .maybeSingle();
  if (!cp) return null;

  const creatorId = cp.id as string;

  const [{ data: handles }, { data: rateCards }, { data: affiliations }, { data: partnerships }] =
    await Promise.all([
      client
        .from('social_handles')
        .select('id, platform, handle, follower_count, engagement_rate, weekly_reach, is_primary, verification_status')
        .eq('creator_id', creatorId),
      client
        .from('rate_cards')
        .select('id, is_enabled, rate_card_items(id, platform, content_format, base_price, currency, title, description, add_ons)')
        .eq('creator_id', creatorId),
      client
        .from('affiliations')
        .select('id, type, name, year, description')
        .eq('creator_id', creatorId),
      client
        .from('brand_partnerships')
        .select('id, brand_name, platform, views_reach, year, description')
        .eq('creator_id', creatorId),
    ]);

  return buildCreatorMediaKit(userId, creatorId, cp, profile, handles, rateCards, affiliations, partnerships);
}

/**
 * Shared mapper from the raw creator_profiles row + its children into the
 * CreatorMediaKit shape. Used by both the own-profile fetch (by profile_id) and
 * the by-id fetch (Discovery detail), so the two can never drift.
 */
function buildCreatorMediaKit(
  profileId: string,
  creatorId: string,
  cp: Record<string, unknown>,
  profile: { display_name: string; city: string | null; avatar_url: string | null },
  handles: unknown,
  rateCards: unknown,
  affiliations: unknown,
  partnerships: unknown,
): CreatorMediaKit {
  // One rate card per creator (data-model); take the first RLS returned. For a
  // non-brand, non-owner viewer RLS returns none — so the card is simply absent.
  const rawCard = ((rateCards as { id: string; is_enabled: boolean; rate_card_items?: RateCardItem[] }[]) ?? [])[0];
  const rateCard: RateCard | null = rawCard
    ? {
        id: rawCard.id,
        is_enabled: rawCard.is_enabled,
        items: (rawCard.rate_card_items ?? []).sort((a, b) => a.title.localeCompare(b.title)),
      }
    : null;

  const privacy = { ...DEFAULT_PRIVACY, ...((cp.privacy_settings as Partial<PrivacySettings>) ?? {}) };

  // Primary handle first, then by follower_count desc.
  const sortedHandles = ((handles as SocialHandle[]) ?? []).slice().sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return (b.follower_count ?? 0) - (a.follower_count ?? 0);
  });

  return {
    kind: 'creator',
    profileId,
    creatorId,
    displayName: profile.display_name,
    city: profile.city,
    avatarUrl: profile.avatar_url,
    niches: (cp.niches as string[]) ?? [],
    contentCategory: (cp.content_category as string | null) ?? null,
    bio: (cp.bio as string | null) ?? null,
    photoCarousel: (cp.photo_carousel as string[]) ?? [],
    contentLanguages: (cp.content_languages as string[]) ?? [],
    inboundEnabled: cp.inbound_enabled as boolean,
    outboundEnabled: cp.outbound_enabled as boolean,
    trustScore: (cp.trust_score as number | null) ?? null,
    dealCompletionRate: (cp.deal_completion_rate as number | null) ?? null,
    responseTimeHours: (cp.response_time_hours as number | null) ?? null,
    privacy,
    handles: sortedHandles,
    rateCard,
    affiliations: (affiliations as Affiliation[]) ?? [],
    partnerships: (partnerships as BrandPartnership[]) ?? [],
  };
}

const CREATOR_KIT_SELECT =
  'id, profile_id, niches, content_category, bio, content_languages, photo_carousel, inbound_enabled, outbound_enabled, trust_score, deal_completion_rate, response_time_hours, privacy_settings, ' +
  'profiles(display_name, city, avatar_url), ' +
  'social_handles(id, platform, handle, follower_count, engagement_rate, weekly_reach, is_primary, verification_status), ' +
  'rate_cards(id, is_enabled, rate_card_items(id, platform, content_format, base_price, currency, title, description, add_ons)), ' +
  'affiliations(id, type, name, year, description), ' +
  'brand_partnerships(id, brand_name, platform, views_reach, year, description)';

/**
 * Fetch any creator's media kit by their creator_profiles.id (Discovery detail,
 * B2-002). Works for ANY authenticated caller — creator_profiles/profiles/handles
 * are public reads; the rate card is returned by RLS ONLY to brand accounts (and
 * the owner). The client never gates this; it renders exactly what RLS returned.
 */
export async function fetchCreatorMediaKitById(creatorId: string): Promise<CreatorMediaKit | null> {
  if (!supabase) return null;
  const { data: row, error } = await supabase
    .from('creator_profiles')
    .select(CREATOR_KIT_SELECT)
    .eq('id', creatorId)
    .maybeSingle();
  if (error || !row) return null;

  // supabase-js can't infer the shape of an embedded select — treat the row loosely.
  const r = row as unknown as Record<string, unknown>;
  const profile = (r.profiles as { display_name: string; city: string | null; avatar_url: string | null } | null) ?? {
    display_name: 'Creator',
    city: null,
    avatar_url: null,
  };
  return buildCreatorMediaKit(
    r.profile_id as string,
    r.id as string,
    r,
    profile,
    r.social_handles,
    r.rate_cards,
    r.affiliations,
    r.brand_partnerships,
  );
}

/** Fetch any brand's public profile by id (Discovery detail, B2-006/B2-038). */
export async function fetchBrandProfileById(brandId: string): Promise<BrandProfile | null> {
  if (!supabase) return null;
  const { data: brand, error } = await supabase
    .from('brands')
    .select('id, company_name, industry, domain, verified, trust_rating, deal_completion_rate, profile_attributes')
    .eq('id', brandId)
    .maybeSingle();
  if (error || !brand) return null;
  return {
    kind: 'brand',
    brandId: brand.id,
    companyName: brand.company_name,
    industry: brand.industry,
    domain: brand.domain,
    verified: brand.verified,
    trustRating: brand.trust_rating,
    dealCompletionRate: brand.deal_completion_rate,
    profileAttributes: (brand.profile_attributes as Record<string, unknown> | null) ?? null,
  };
}

// ── Completeness refresh (called after creator/brand edits) ──────────────────

async function refreshCreatorCompleteness(userId: string): Promise<void> {
  const kit = await fetchOwnMediaKit(userId);
  if (!kit || kit.kind !== 'creator') return;
  const pct = computeCreatorCompleteness({
    city: kit.city,
    niches: kit.niches,
    contentLanguages: kit.contentLanguages,
    bio: kit.bio,
    contentCategory: kit.contentCategory,
    handleCount: kit.handles.length,
    rateCardEnabledWithItems: Boolean(kit.rateCard?.is_enabled && kit.rateCard.items.length > 0),
    hasAffiliationOrPartnership: kit.affiliations.length > 0 || kit.partnerships.length > 0,
    hasPhotos: kit.photoCarousel.length > 0,
  });
  await supabase!.from('profiles').update({ profile_completeness: pct }).eq('id', userId);
}

async function refreshBrandCompleteness(userId: string, brandId: string): Promise<void> {
  const { data: brand } = await supabase!
    .from('brands')
    .select('industry, domain, profile_attributes')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand) return;
  const pct = computeBrandCompleteness({
    industry: brand.industry,
    domain: brand.domain,
    hasProfileAttributes:
      Boolean(brand.profile_attributes) && Object.keys(brand.profile_attributes).length > 0,
  });
  await supabase!.from('profiles').update({ profile_completeness: pct }).eq('id', userId);
}

// ── B2-036: Edit profile (creator identity + creator_profiles) ───────────────

export async function updateCreatorProfile(
  userId: string,
  fields: {
    displayName: string;
    city: string;
    bio: string;
    niches: string[];
    contentLanguages: string[];
    contentCategory: string;
  },
): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    // profiles: display_name + city (owned-record UPDATE, profiles_update_own).
    const { error: pErr } = await supabase
      .from('profiles')
      .update({ display_name: fields.displayName.trim(), city: fields.city.trim() || null })
      .eq('id', userId);
    if (pErr) throw pErr;

    // creator_profiles: bio, niches (≤3, DB CHECK), languages, category.
    const { error: cErr } = await supabase
      .from('creator_profiles')
      .update({
        bio: fields.bio.trim() || null,
        niches: fields.niches,
        content_languages: fields.contentLanguages,
        content_category: fields.contentCategory.trim() || null,
      })
      .eq('profile_id', userId);
    if (cErr) throw cErr;

    await refreshCreatorCompleteness(userId);
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// ── B2-036: Edit brand profile ───────────────────────────────────────────────

export async function updateBrandProfile(
  userId: string,
  brandId: string,
  fields: {
    companyName: string;
    industry: string;
    domain: string;
    profileAttributes: Record<string, unknown>;
  },
): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    const { error } = await supabase
      .from('brands')
      .update({
        company_name: fields.companyName.trim(),
        industry: fields.industry.trim() || null,
        domain: fields.domain.trim() || null,
        profile_attributes: fields.profileAttributes,
      })
      .eq('id', brandId);
    if (error) throw error;
    await refreshBrandCompleteness(userId, brandId);
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// ── B2-032: Edit an existing social handle ───────────────────────────────────

export async function updateSocialHandle(
  handleId: string,
  fields: {
    handle: string;
    followerCount: number | null;
    engagementRate: number | null;
    weeklyReach: number | null;
  },
): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    const { error } = await supabase
      .from('social_handles')
      .update({
        handle: fields.handle.trim(),
        follower_count: fields.followerCount,
        engagement_rate: fields.engagementRate,
        weekly_reach: fields.weeklyReach,
      })
      .eq('id', handleId);
    if (error) throw error;
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// ── B2-034: Rate card ─────────────────────────────────────────────────────────

/** Ensure a rate_card row exists for this creator; returns its id. */
export async function ensureRateCard(creatorId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data: existing } = await supabase
    .from('rate_cards')
    .select('id')
    .eq('creator_id', creatorId)
    .maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await supabase
    .from('rate_cards')
    .insert({ creator_id: creatorId, is_enabled: false })
    .select('id')
    .single();
  if (error || !created) return null;
  return created.id;
}

export async function setRateCardEnabled(rateCardId: string, enabled: boolean): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    const { error } = await supabase
      .from('rate_cards')
      .update({ is_enabled: enabled })
      .eq('id', rateCardId);
    if (error) throw error;
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

export type RateCardItemInput = {
  id?: string;
  platform: string;
  contentFormat: string;
  basePrice: number;
  title: string;
  description: string;
};

export async function upsertRateCardItem(
  rateCardId: string,
  item: RateCardItemInput,
): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    const row = {
      rate_card_id: rateCardId,
      platform: item.platform,
      content_format: item.contentFormat,
      base_price: item.basePrice,
      currency: 'INR',
      title: item.title.trim(),
      description: item.description.trim() || null,
    };
    const query = item.id
      ? supabase.from('rate_card_items').update(row).eq('id', item.id)
      : supabase.from('rate_card_items').insert(row);
    const { error } = await query;
    if (error) throw error;
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

export async function deleteRateCardItem(itemId: string): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    const { error } = await supabase.from('rate_card_items').delete().eq('id', itemId);
    if (error) throw error;
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// ── B2-037: Privacy settings ──────────────────────────────────────────────────

export async function updatePrivacySettings(
  userId: string,
  privacy: PrivacySettings,
): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    const { error } = await supabase
      .from('creator_profiles')
      .update({ privacy_settings: privacy })
      .eq('profile_id', userId);
    if (error) throw error;
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// ── B1-012: Affiliations ──────────────────────────────────────────────────────

export type AffiliationInput = {
  id?: string;
  type: string;
  name: string;
  year: number | null;
  description: string;
};

export async function saveAffiliation(
  creatorId: string,
  userId: string,
  input: AffiliationInput,
): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    const row = {
      creator_id: creatorId,
      type: input.type,
      name: input.name.trim(),
      year: input.year,
      description: input.description.trim() || null,
    };
    const query = input.id
      ? supabase.from('affiliations').update(row).eq('id', input.id)
      : supabase.from('affiliations').insert(row);
    const { error } = await query;
    if (error) throw error;
    await refreshCreatorCompleteness(userId);
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

export async function deleteAffiliation(affiliationId: string, userId: string): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    const { error } = await supabase.from('affiliations').delete().eq('id', affiliationId);
    if (error) throw error;
    await refreshCreatorCompleteness(userId);
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// ── B2-031: Profile photos (private Storage bucket, signed-URL serving) ────────

export const PROFILE_PHOTOS_BUCKET = 'profile-photos';
export const MAX_PHOTOS = 5;
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days
// Re-sign a bit before expiry so an in-flight render never gets a dead URL.
const SIGNED_URL_REFRESH_BUFFER_MS = 60 * 60 * 1000; // 1 hour

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Resolve a storage PATH to a temporary signed URL (the bucket is private, so
 * getPublicUrl does not apply). Cached in memory keyed by the stable path; the
 * DB only ever stores the path, never a URL. Returns null on failure so the
 * caller can show a placeholder.
 */
export async function getSignedProfilePhotoUrl(path: string): Promise<string | null> {
  if (!supabase || !path) return null;
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt - SIGNED_URL_REFRESH_BUFFER_MS > Date.now()) {
    return cached.url;
  }
  const { data, error } = await supabase.storage
    .from(PROFILE_PHOTOS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return null;
  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL * 1000 });
  return data.signedUrl;
}

/**
 * Read a picked image's bytes for upload. Expo SDK 54's FileSystem is class-based
 * (legacy readAsStringAsync throws), so native uses `new File(uri).bytes()`; web
 * has no File API, so it fetches the (blob:/data:) uri to an ArrayBuffer. Both
 * types are accepted by supabase-js upload().
 */
async function readImageBytes(uri: string): Promise<Uint8Array | ArrayBuffer> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return res.arrayBuffer();
  }
  return new FileSystem.File(uri).bytes();
}

function extAndType(asset: ImagePickerAsset): { ext: string; contentType: string } {
  const mime = asset.mimeType ?? 'image/jpeg';
  const fromName = asset.fileName?.split('.').pop()?.toLowerCase();
  const fromMime = mime.split('/').pop()?.toLowerCase();
  let ext = fromName || fromMime || 'jpg';
  if (ext === 'jpeg') ext = 'jpg';
  return { ext, contentType: mime };
}

/**
 * Upload one picked photo to the caller's OWN folder. Path is EXACTLY
 * `${userId}/${uuid}.${ext}` — the top folder equals auth.uid(), which the 016
 * owner-write policy requires. Returns the storage path (to persist), or an error.
 */
export async function uploadProfilePhoto(
  userId: string,
  asset: ImagePickerAsset,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: GENERIC_ERROR };
  try {
    const { ext, contentType } = extAndType(asset);
    const path = `${userId}/${Crypto.randomUUID()}.${ext}`;
    const bytes = await readImageBytes(asset.uri);
    const { error } = await supabase.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (error) throw error;
    return { ok: true, path };
  } catch {
    return { ok: false, message: "Couldn't upload that photo. Please try again." };
  }
}

/** Delete a storage object (owner-delete policy). Best-effort — logs nothing to the user. */
export async function removeProfilePhoto(path: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove([path]);
    signedUrlCache.delete(path);
  } catch {
    // A dangling object is harmless (owner-scoped, re-cleanable); don't block the UI.
  }
}

/**
 * Persist the ordered carousel. Writes creator_profiles.photo_carousel (jsonb array
 * of PATHS, order = display order) and profiles.avatar_url = the primary (index 0).
 * NOTE: avatar_url stores a STORAGE PATH, not a URL — it is only ever turned into a
 * picture via StorageImage/getSignedProfilePhotoUrl. Refreshes completeness.
 */
export async function savePhotoCarousel(
  userId: string,
  paths: string[],
): Promise<Result> {
  if (!supabase) return NO_CLIENT;
  try {
    const capped = paths.slice(0, MAX_PHOTOS);
    const { error: cErr } = await supabase
      .from('creator_profiles')
      .update({ photo_carousel: capped })
      .eq('profile_id', userId);
    if (cErr) throw cErr;

    const { error: pErr } = await supabase
      .from('profiles')
      // Stores the primary photo's STORAGE PATH (not a URL); resolved via StorageImage.
      .update({ avatar_url: capped[0] ?? null })
      .eq('id', userId);
    if (pErr) throw pErr;

    await refreshCreatorCompleteness(userId);
    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}
