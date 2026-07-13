import { create } from 'zustand';

/**
 * Onboarding wizard state (Phase 7 Cluster B). Every answer the user gives across
 * the multi-screen wizard is held here in memory, then committed to Supabase ONCE
 * at the finish step (see lib/onboarding.ts). Holding it in a store — rather than
 * writing per-screen — keeps the DB free of half-built profiles and lets the
 * onboarding gate key cleanly off a single "finished" signal.
 *
 * Nothing here is persisted to disk: if the user quits mid-wizard they simply
 * restart it (no profile row exists yet). Enrichment-after-onboarding is the
 * "nudges later" model from the mockup, out of scope for this cluster.
 */

export type OnboardingRole = 'creator' | 'brand';

/** One connected social platform's mock stats (golden rule #4 — real-looking fakes). */
export type ConnectedPlatform = {
  handle: string;
  followerCount: number;
  engagementRate: number; // percentage, e.g. 4.6
  weeklyReach: number;
};

/** platform_enum values we support in onboarding (data-model.md). */
export type PlatformKey = 'instagram' | 'youtube' | 'tiktok' | 'x';

type OnboardingState = {
  role: OnboardingRole | null;

  // Creator + shared identity
  displayName: string; // creator display name OR brand contact name → profiles.display_name
  city: string;
  niches: string[]; // up to 3 → creator_profiles.niches
  languages: string[]; // → creator_profiles.content_languages
  bio: string;
  platforms: Partial<Record<PlatformKey, ConnectedPlatform>>;
  inbound: boolean; // → creator_profiles.inbound_enabled
  outbound: boolean; // → creator_profiles.outbound_enabled

  // Brand
  companyName: string;
  industry: string;
  companyIdGst: string;
  domain: string;

  setRole: (role: OnboardingRole) => void;
  setField: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
  toggleInArray: (key: 'niches' | 'languages', value: string, max?: number) => void;
  connectPlatform: (key: PlatformKey, data: ConnectedPlatform) => void;
  reset: () => void;
};

const initial = {
  role: null,
  displayName: '',
  city: '',
  niches: [] as string[],
  languages: [] as string[],
  bio: '',
  platforms: {} as Partial<Record<PlatformKey, ConnectedPlatform>>,
  inbound: true,
  outbound: true,
  companyName: '',
  industry: '',
  companyIdGst: '',
  domain: '',
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initial,

  setRole: (role) => set({ role }),

  setField: (key, value) => set({ [key]: value } as Pick<OnboardingState, typeof key>),

  // Toggle a chip value in a string[] field, respecting an optional cap (niches = 3).
  toggleInArray: (key, value, max) =>
    set((state) => {
      const current = state[key];
      if (current.includes(value)) {
        return { [key]: current.filter((v) => v !== value) } as Pick<OnboardingState, typeof key>;
      }
      if (max !== undefined && current.length >= max) {
        return {} as Partial<OnboardingState>; // at cap — ignore (screen shows a hint)
      }
      return { [key]: [...current, value] } as Pick<OnboardingState, typeof key>;
    }),

  connectPlatform: (key, data) =>
    set((state) => ({ platforms: { ...state.platforms, [key]: data } })),

  reset: () => set({ ...initial }),
}));
