import { supabase } from '@/lib/supabase';

/**
 * Discovery browse data layer (Phase 8 Cluster B). Supabase-direct public reads
 * under RLS (creator_profiles/profiles/social_handles/brands are all readable by
 * any authenticated user). Returns lightweight card shapes; the detail screens
 * fetch the full record by id (see lib/media-kit.ts fetch*ById).
 *
 * Filtering/search is done client-side over these fetched sets — the Phase-8 seed
 * is small (~15 creators / ~10 brands), so a fetch-all-then-filter keeps the code
 * simple. RLS still governs which rows come back. (At real scale, facet filters
 * move into the query.)
 */

export type PrimaryHandle = {
  platform: string;
  followerCount: number | null;
  engagementRate: number | null;
  verified: boolean;
};

export type CreatorCardData = {
  creatorId: string;
  displayName: string;
  city: string | null;
  avatarPath: string | null;
  niches: string[];
  trustScore: number | null;
  platforms: string[];
  primary: PrimaryHandle | null;
};

export type BrandCardData = {
  brandId: string;
  companyName: string;
  industry: string | null;
  verified: boolean;
  trustRating: number | null;
  dealCompletionRate: number | null;
  hqCity: string | null;
};

type RawHandle = {
  platform: string;
  follower_count: number | null;
  engagement_rate: number | null;
  is_primary: boolean;
  verification_status: string;
};

export async function getMyAccountType(userId: string): Promise<'creator' | 'brand' | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('profiles')
    .select('account_type')
    .eq('id', userId)
    .maybeSingle();
  return (data?.account_type as 'creator' | 'brand' | undefined) ?? null;
}

function pickPrimary(handles: RawHandle[]): RawHandle | null {
  if (handles.length === 0) return null;
  const flagged = handles.find((h) => h.is_primary);
  if (flagged) return flagged;
  // Fall back to the biggest by followers.
  return handles.slice().sort((a, b) => (b.follower_count ?? 0) - (a.follower_count ?? 0))[0];
}

export async function fetchCreatorsForBrowse(): Promise<CreatorCardData[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('creator_profiles')
    .select(
      'id, niches, photo_carousel, trust_score, ' +
        'profiles!inner(display_name, city, avatar_url), ' +
        'social_handles(platform, follower_count, engagement_rate, is_primary, verification_status)',
    );
  if (error || !data) return [];

  // supabase-js can't infer the shape of an embedded select — treat rows loosely.
  const rows = data as unknown as Record<string, unknown>[];
  return rows.map((row) => {
    const profile = row.profiles as { display_name: string; city: string | null; avatar_url: string | null };
    const handles = (row.social_handles as RawHandle[]) ?? [];
    const carousel = (row.photo_carousel as string[]) ?? [];
    const primaryRaw = pickPrimary(handles);
    return {
      creatorId: row.id as string,
      displayName: profile?.display_name ?? 'Creator',
      city: profile?.city ?? null,
      avatarPath: carousel[0] ?? profile?.avatar_url ?? null,
      niches: (row.niches as string[]) ?? [],
      trustScore: (row.trust_score as number | null) ?? null,
      platforms: [...new Set(handles.map((h) => h.platform))],
      primary: primaryRaw
        ? {
            platform: primaryRaw.platform,
            followerCount: primaryRaw.follower_count,
            engagementRate: primaryRaw.engagement_rate,
            verified: primaryRaw.verification_status === 'verified',
          }
        : null,
    };
  });
}

export async function fetchBrandsForBrowse(): Promise<BrandCardData[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('brands')
    .select('id, company_name, industry, verified, trust_rating, deal_completion_rate, profile_attributes');
  if (error || !data) return [];

  return data.map((b) => {
    const attrs = (b.profile_attributes as Record<string, unknown> | null) ?? {};
    return {
      brandId: b.id as string,
      companyName: b.company_name as string,
      industry: (b.industry as string | null) ?? null,
      verified: Boolean(b.verified),
      trustRating: (b.trust_rating as number | null) ?? null,
      dealCompletionRate: (b.deal_completion_rate as number | null) ?? null,
      hqCity: typeof attrs.hq_city === 'string' ? (attrs.hq_city as string) : null,
    };
  });
}
