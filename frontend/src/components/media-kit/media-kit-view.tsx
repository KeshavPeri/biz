import { type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import {
  type Affiliation,
  type BrandPartnership,
  type CreatorMediaKit,
  type RateCardItem,
  type SocialHandle,
} from '@/lib/media-kit';
import { affiliationTypeLabel, platformLabel } from '@/lib/media-kit-enums';
import { formatCount, formatINR } from '@/lib/format';
import { PlatformStatCard } from '@/components/media-kit/platform-stat-card';
import { PhotoCarousel } from '@/components/media-kit/photo-carousel';

import CheckIcon from '@/assets/icons/check.svg';
import LockIcon from '@/assets/icons/lock.svg';
import EditIcon from '@/assets/icons/edit.svg';

const HERO_H = 300;

/**
 * Who is looking. Drives what's shown vs locked.
 *
 * ⚠️ SECURITY NOTE — the visibility gating below is a CLIENT-SIDE SIMULATION used
 * only to preview "what a brand sees" (B2-035). It is NOT the security boundary.
 * The real boundary is RLS: a non-brand / non-owner literally cannot SELECT a
 * disabled rate card's rows (see 012_rls.sql rate_cards_read_brand_enabled and the
 * backend test test_media_kit_rls.py). Never treat this prop as access control.
 */
export type ViewerMode = 'own' | 'brand' | 'public';

export type MediaKitEditHandlers = {
  onEditProfile: () => void;
  onEditHandle: (handle: SocialHandle) => void;
  onEditRateCard: () => void;
  onEditPrivacy: () => void;
  onEditAffiliations: () => void;
  onEditPhotos: () => void;
};

/** Whether prices should be revealed to this viewer (client-side preview only). */
function rateCardRevealed(data: CreatorMediaKit, viewerMode: ViewerMode): boolean {
  if (viewerMode === 'own') return true;
  if (viewerMode === 'public') return false;
  // brand: only when the creator enabled the card AND left it visible.
  return Boolean(data.rateCard?.is_enabled) && data.privacy.rate_card_visible;
}

export function MediaKitView({
  data,
  viewerMode,
  edit,
  onConnect,
}: {
  data: CreatorMediaKit;
  viewerMode: ViewerMode;
  /** Section edit callbacks — supplied only in the owner's own view. */
  edit?: MediaKitEditHandlers;
  /** When set (real brand detail), the "Start a deal" CTA is enabled (B2-004). */
  onConnect?: () => void;
}) {
  const isOwn = viewerMode === 'own';
  const hasPhotos = data.photoCarousel.length > 0;
  const meta = [data.niches.slice(0, 2).map(cap).join(' · '), data.city, data.contentLanguages.join(' / ')]
    .filter((s) => s && s.length > 0)
    .join('  ·  ');

  return (
    <View className="pb-4">
      {/* HERO — real photos (B2-031) behind a scrim, or a warm gradient placeholder
          when the creator has none. The identity block overlays the bottom. */}
      <View className="relative overflow-hidden rounded-b-[26px]" style={{ minHeight: HERO_H }}>
        {hasPhotos ? (
          <PhotoCarousel paths={data.photoCarousel} height={HERO_H} />
        ) : (
          <LinearGradient
            colors={['#D9C7B4', '#9C7E86', '#6E5A78']}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={{ position: 'absolute', inset: 0 }}
          />
        )}

        {/* Bottom scrim for text legibility over any photo. */}
        <LinearGradient
          colors={['transparent', 'rgba(28,27,24,0.72)']}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.round(HERO_H * 0.7) }}
          pointerEvents="none"
        />

        {/* Own-view: edit-photos affordance. */}
        {isOwn && edit ? (
          <Pressable
            className="absolute right-3 top-6 flex-row items-center gap-1.5 rounded-pill bg-[rgba(28,27,24,0.4)] px-3 py-2"
            onPress={edit.onEditPhotos}
            accessibilityRole="button"
            accessibilityLabel="Edit photos"
          >
            <EditIcon width={14} height={14} color="#FBFAF6" />
            <Text className="font-geist-semibold text-[12px] text-white">
              {hasPhotos ? 'Edit photos' : 'Add photos'}
            </Text>
          </Pressable>
        ) : null}

        {/* Identity overlay. */}
        <View className="absolute inset-x-0 bottom-0 px-5 pb-5">
          {!hasPhotos ? (
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(251,250,246,0.22)]">
              <Text className="font-geist-bold text-[20px] text-white">
                {data.displayName.trim()[0]?.toUpperCase() ?? '·'}
              </Text>
            </View>
          ) : null}
          <View className="flex-row items-center gap-2">
            <Text className="font-geist-bold text-[26px] tracking-tight text-white">
              {data.displayName}
            </Text>
            <View className="h-5 w-5 items-center justify-center rounded-full bg-[rgba(251,250,246,0.22)]">
              <CheckIcon width={12} height={12} color="#FFFFFF" />
            </View>
          </View>
          {meta ? (
            <Text className="mt-1 font-geist-medium text-[13px] text-[rgba(251,250,246,0.85)]">
              {meta}
            </Text>
          ) : null}
          {data.bio ? (
            <Text className="mt-1.5 max-w-[300px] font-geist text-[13px] leading-[19px] text-[rgba(251,250,246,0.82)]">
              {data.bio}
            </Text>
          ) : null}
          {(data.inboundEnabled || data.outboundEnabled) && (
            <View className="mt-3 flex-row items-center gap-1.5 self-start rounded-pill border border-[rgba(251,250,246,0.22)] bg-[rgba(251,250,246,0.16)] px-3 py-1.5">
              <View className="h-1.5 w-1.5 rounded-full bg-status-good" />
              <Text className="font-geist-semibold text-[11.5px] text-white">
                {openToLabel(data.inboundEnabled, data.outboundEnabled)}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* TRUST STRIP — only the seeded, real columns (no review count: ratings is
          populated post-deal in Phase 9+). */}
      <View className="mx-4 mt-3.5 flex-row rounded-card border border-hairline-card bg-surface-card shadow-l1">
        <TrustCell
          value={data.trustScore !== null ? `★ ${data.trustScore.toFixed(1)}` : '—'}
          label="Trust score"
        />
        <TrustCell
          value={data.dealCompletionRate !== null ? `${Math.round(data.dealCompletionRate * 100)}%` : '—'}
          label="Deals completed"
          divider
        />
        <TrustCell
          value={data.responseTimeHours !== null ? `< ${Math.round(data.responseTimeHours)}h` : '—'}
          label="Responds in"
          divider
        />
      </View>

      {/* REACH — platform stat cards (B2-032). Handles are edited per-card, so the
          section has no header-level edit link (tap a card in own view). */}
      <Section title="Reach" sub="mock stats · no live API">
        {data.handles.length === 0 ? (
          <EmptyLine text="No platforms connected yet." />
        ) : (
          <View className="flex-row flex-wrap gap-[11px]">
            {data.handles.map((h) => (
              <View key={h.id} className="min-w-[46%] flex-1 basis-[46%]">
                <PlatformStatCard
                  handle={h}
                  onEdit={isOwn ? () => edit?.onEditHandle(h) : undefined}
                />
              </View>
            ))}
          </View>
        )}
      </Section>

      {/* RATE CARD — brand-only reveal (B2-034 + B2-037 privacy). */}
      <Section
        title="Rate card"
        sub={!isOwn ? 'brands only' : data.rateCard?.is_enabled ? 'visible to brands' : 'hidden'}
        onEdit={isOwn ? edit?.onEditRateCard : undefined}
        rightAccessory={!isOwn ? <LockChip /> : undefined}
      >
        <View className="rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1">
          {rateCardRevealed(data, viewerMode) ? (
            data.rateCard && data.rateCard.items.length > 0 ? (
              data.rateCard.items.map((item, i) => (
                <RateRow key={item.id} item={item} first={i === 0} />
              ))
            ) : (
              <EmptyLine
                text={isOwn ? 'Add your first rate to unlock the budget filter in Discover.' : 'No rates listed yet.'}
              />
            )
          ) : (
            <Text className="px-2 py-5 text-center font-geist text-[12.5px] leading-[19px] text-ink-3">
              Rates are visible only to verified brands — never to other creators, never public.
              Indicative only; every deal is negotiated in chat.
            </Text>
          )}
        </View>
      </Section>

      {/* AFFILIATIONS (B1-012). */}
      <Section title="Credentials" sub="self-declared" onEdit={isOwn ? edit?.onEditAffiliations : undefined}>
        <View className="rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1">
          {data.affiliations.length === 0 ? (
            <EmptyLine text={isOwn ? 'Add shows, awards or press features.' : 'None listed.'} />
          ) : (
            data.affiliations.map((a, i) => <AffiliationRow key={a.id} a={a} first={i === 0} />)
          )}
        </View>
      </Section>

      {/* BRAND HISTORY (brand_partnerships). */}
      <Section title="Brand history" sub={`${data.partnerships.length} listed`}>
        <View className="rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1">
          {data.partnerships.length === 0 ? (
            <EmptyLine text="No past partnerships listed." />
          ) : (
            data.partnerships.map((p, i) => <PartnershipRow key={p.id} p={p} first={i === 0} />)
          )}
        </View>
      </Section>

      {/* CTA — brand/preview only. ENABLED only when onConnect is supplied (the
          real brand-facing detail screen, B2-004); the You-tab "Preview as brand"
          passes no onConnect, so it stays a disabled placeholder. */}
      {!isOwn ? (
        <View className="mx-4 mt-5">
          {onConnect ? (
            <Pressable
              className="items-center justify-center rounded-button bg-ink py-3.5"
              onPress={onConnect}
              accessibilityRole="button"
            >
              <Text className="font-geist-semibold text-body text-white">Start a deal</Text>
            </Pressable>
          ) : (
            <>
              <View className="items-center justify-center rounded-button bg-cane-3 py-3.5 opacity-60">
                <Text className="font-geist-semibold text-body text-ink-2">Start a deal (coming soon)</Text>
              </View>
              <Text className="mt-1.5 text-center font-geist text-[11px] text-ink-3">
                Connect flow lands with the deal engine.
              </Text>
            </>
          )}
        </View>
      ) : null}

      {/* Privacy entry point — own view only. */}
      {isOwn ? (
        <Pressable
          className="mx-4 mt-5 flex-row items-center gap-3 rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1"
          onPress={edit?.onEditPrivacy}
          accessibilityRole="button"
        >
          <LockIcon width={18} height={18} color="#5E574E" />
          <View className="flex-1">
            <Text className="font-geist-semibold text-body text-ink">Privacy</Text>
            <Text className="mt-0.5 font-geist text-secondary text-ink-2">
              Control who sees your contact, rate card and handles.
            </Text>
          </View>
          <Text className="font-geist-semibold text-[13px] text-ink">›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── small building blocks ────────────────────────────────────────────────────

function Section({
  title,
  sub,
  onEdit,
  rightAccessory,
  children,
}: {
  title: string;
  sub?: string;
  onEdit?: () => void;
  rightAccessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View className="mx-4 mt-6">
      <View className="mb-3 flex-row items-baseline justify-between">
        <Text className="font-geist-semibold text-subtitle text-ink">{title}</Text>
        {onEdit ? (
          <Pressable onPress={onEdit} accessibilityRole="button">
            <Text className="font-geist-semibold text-[13px] text-ink">Edit ›</Text>
          </Pressable>
        ) : rightAccessory ? (
          rightAccessory
        ) : sub ? (
          <Text className="font-geist-medium text-[11.5px] text-ink-3">{sub}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function TrustCell({ value, label, divider }: { value: string; label: string; divider?: boolean }) {
  return (
    <View className={`flex-1 items-center px-1.5 py-3 ${divider ? 'border-l border-hairline' : ''}`}>
      <Text className="font-geist-bold text-[18px] text-ink">{value}</Text>
      <Text className="mt-0.5 font-geist-medium text-[10.5px] text-ink-3">{label}</Text>
    </View>
  );
}

function RateRow({ item, first }: { item: RateCardItem; first: boolean }) {
  return (
    <View
      className={`flex-row items-center justify-between py-2.5 ${
        first ? '' : 'border-t border-hairline'
      }`}
    >
      <View className="flex-1 pr-3">
        <Text className="font-geist-medium text-body text-ink">{item.title}</Text>
        <Text className="mt-0.5 font-geist text-[11px] text-ink-3">
          {platformLabel(item.platform)} · {item.description ?? ''}
        </Text>
      </View>
      <Text className="font-geist-bold text-body text-ink">{formatINR(item.base_price)}</Text>
    </View>
  );
}

function AffiliationRow({ a, first }: { a: Affiliation; first: boolean }) {
  return (
    <View className={`py-2.5 ${first ? '' : 'border-t border-hairline'}`}>
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 pr-3 font-geist-semibold text-body text-ink">{a.name}</Text>
        {a.year ? <Text className="font-geist text-[11px] text-ink-3">{a.year}</Text> : null}
      </View>
      <Text className="mt-0.5 font-geist text-[11.5px] text-ink-2">
        {affiliationTypeLabel(a.type)}
        {a.description ? ` · ${a.description}` : ''}
      </Text>
    </View>
  );
}

function PartnershipRow({ p, first }: { p: BrandPartnership; first: boolean }) {
  const parts = [
    p.platform ? platformLabel(p.platform) : null,
    p.views_reach ? `${formatCount(p.views_reach)} reach` : null,
    p.year ? `${p.year}` : null,
  ].filter(Boolean);
  return (
    <View className={`flex-row items-center gap-3 py-2.5 ${first ? '' : 'border-t border-hairline'}`}>
      <View className="h-9 w-9 items-center justify-center rounded-[11px] bg-avatar">
        <Text className="font-geist-semibold text-[12px] text-ink-2">
          {p.brand_name.trim().slice(0, 2).toUpperCase()}
        </Text>
      </View>
      <View className="flex-1">
        <Text className="font-geist-semibold text-body text-ink">{p.brand_name}</Text>
        {parts.length > 0 ? (
          <Text className="mt-0.5 font-geist text-[11.5px] text-ink-3">{parts.join(' · ')}</Text>
        ) : null}
      </View>
    </View>
  );
}

function LockChip() {
  return (
    <View className="flex-row items-center gap-1.5 rounded-pill bg-surface-recess px-2.5 py-1">
      <LockIcon width={11} height={11} color="#847F78" />
      <Text className="font-geist-semibold text-[10px] uppercase tracking-wide text-ink-3">
        Brands only
      </Text>
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <Text className="py-3 font-geist text-secondary text-ink-3">{text}</Text>;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function openToLabel(inbound: boolean, outbound: boolean): string {
  if (inbound && outbound) return 'Open to inbound & outbound deals';
  if (inbound) return 'Open to inbound deals';
  if (outbound) return 'Open to outbound deals';
  return 'Not currently taking deals';
}
