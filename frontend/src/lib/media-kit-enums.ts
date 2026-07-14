/**
 * Enum → label maps for the media-kit editors (Phase 8 Discovery, Cluster A).
 *
 * These mirror the Postgres enums in backend/migrations/001_extensions_and_enums.sql
 * EXACTLY — the KEYS are the on-the-wire enum values Supabase will accept; the labels
 * are display-only. If an enum changes in the DB, change it here too. Reused by the
 * rate-card + affiliation editors (and later the brand-facing profile screen, 8.3),
 * so a screen can never emit an invalid enum value.
 */

/** platform_enum */
export const PLATFORMS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'x', label: 'X / Twitter' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'threads', label: 'Threads' },
  { value: 'podcast', label: 'Podcast' },
] as const;

export type PlatformValue = (typeof PLATFORMS)[number]['value'];

/** content_format_enum */
export const CONTENT_FORMATS = [
  { value: 'reel', label: 'Reel' },
  { value: 'static_post', label: 'Static post' },
  { value: 'story', label: 'Story' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'yt_video', label: 'YouTube video' },
  { value: 'yt_short', label: 'YouTube Short' },
  { value: 'blog', label: 'Blog' },
  { value: 'ugc_photo', label: 'UGC photo' },
  { value: 'podcast_read', label: 'Podcast read' },
  { value: 'x_thread', label: 'X thread' },
  { value: 'linkedin_post', label: 'LinkedIn post' },
  { value: 'pinterest_pin', label: 'Pinterest pin' },
] as const;

export type ContentFormatValue = (typeof CONTENT_FORMATS)[number]['value'];

/** affiliation_type_enum */
export const AFFILIATION_TYPES = [
  { value: 'show', label: 'Show' },
  { value: 'award', label: 'Award' },
  { value: 'press', label: 'Press' },
  { value: 'podcast', label: 'Podcast' },
] as const;

export type AffiliationTypeValue = (typeof AFFILIATION_TYPES)[number]['value'];

const PLATFORM_LABELS = Object.fromEntries(PLATFORMS.map((p) => [p.value, p.label]));
const CONTENT_FORMAT_LABELS = Object.fromEntries(CONTENT_FORMATS.map((c) => [c.value, c.label]));
const AFFILIATION_TYPE_LABELS = Object.fromEntries(AFFILIATION_TYPES.map((a) => [a.value, a.label]));

export const platformLabel = (value: string): string => PLATFORM_LABELS[value] ?? value;
export const contentFormatLabel = (value: string): string => CONTENT_FORMAT_LABELS[value] ?? value;
export const affiliationTypeLabel = (value: string): string => AFFILIATION_TYPE_LABELS[value] ?? value;
