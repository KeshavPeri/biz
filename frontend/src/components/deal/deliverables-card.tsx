import { Text, View } from 'react-native';

import type {
  CanonicalDeliverable,
  CanonicalDeliverableState,
  DeliverableContentFormat,
  DeliverablePlatform,
} from '@/lib/deals';

const FORMAT_LABELS: Record<DeliverableContentFormat, string> = {
  reel: 'Reel',
  static_post: 'Static post',
  story: 'Story',
  carousel: 'Carousel',
  yt_video: 'YouTube video',
  yt_short: 'YouTube Short',
  blog: 'Blog post',
  ugc_photo: 'UGC photo',
  podcast_read: 'Podcast read',
  x_thread: 'X/Twitter thread',
  linkedin_post: 'LinkedIn post',
  pinterest_pin: 'Pinterest Pin',
};

const PLATFORM_LABELS: Record<DeliverablePlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  x: 'X/Twitter',
  pinterest: 'Pinterest',
  threads: 'Threads',
  podcast: 'Podcast platform',
};

const STATUS_LABELS: Record<CanonicalDeliverable['status'], string> = {
  pending: 'Pending',
  submitted: 'Submitted',
  in_revision: 'In revision',
  approved: 'Approved',
  posted: 'Posted',
};

export function DeliverablesCard({ state }: { state: CanonicalDeliverableState }) {
  return (
    <View className="gap-3 rounded-2xl border border-hairline bg-surface-card p-3">
      <View>
        <Text className="font-geist-semibold text-[14px] text-ink">Agreed deliverables</Text>
        <Text className="mt-0.5 font-geist text-[11px] text-ink-3">
          {state.deliverables.length} item{state.deliverables.length === 1 ? '' : 's'} from the approved terms
        </Text>
      </View>
      {state.deliverables.length === 0 ? (
        <View className="rounded-xl bg-status-critical-tint px-3 py-3">
          <Text className="font-geist-medium text-[12px] text-status-critical">
            The agreed plan is empty. Refresh or ask support to review the approved terms.
          </Text>
        </View>
      ) : state.deliverables.map((deliverable) => (
        <DeliverableRow key={deliverable.id} deliverable={deliverable} />
      ))}
    </View>
  );
}

function DeliverableRow({ deliverable }: { deliverable: CanonicalDeliverable }) {
  return (
    <View className="gap-2 rounded-xl bg-surface-recess p-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-[13px] text-ink">{deliverable.display_name}</Text>
          <Text className="mt-0.5 font-geist text-[11px] text-ink-2">
            {PLATFORM_LABELS[deliverable.platform]} · {FORMAT_LABELS[deliverable.content_format]}
          </Text>
        </View>
        <Text className="font-geist-semibold text-[10.5px] text-ink-2">
          {STATUS_LABELS[deliverable.status]}
        </Text>
      </View>
      <Detail label="Posting" value={postingLabel(deliverable)} />
      {deliverable.location ? <Detail label="Location" value={deliverable.location} /> : null}
      <Detail label="Revisions" value={`Round ${deliverable.revision_current} of ${deliverable.revision_max}`} />
      <Text className="border-t border-hairline pt-2 font-geist text-[10.5px] text-ink-3">
        Draft submission arrives in the next Creating update.
      </Text>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3 border-t border-hairline pt-2">
      <Text className="font-geist-medium text-[10.5px] uppercase tracking-wide text-ink-3">{label}</Text>
      <Text selectable className="min-w-0 flex-1 text-right font-geist-medium text-[11.5px] text-ink-2">{value}</Text>
    </View>
  );
}

function postingLabel(deliverable: CanonicalDeliverable): string {
  if (deliverable.posting_date) return formatCalendarDate(deliverable.posting_date);
  if (deliverable.posting_window_start && deliverable.posting_window_end) {
    return `${formatCalendarDate(deliverable.posting_window_start)} – ${formatCalendarDate(deliverable.posting_window_end)}`;
  }
  return 'Timing unavailable';
}

function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}
