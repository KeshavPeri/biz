import { Pressable, Text, View } from 'react-native';

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

export function DeliverablesCard({
  state,
  acting,
  error,
  onSubmit,
  onRequestRevision,
  onDownload,
}: {
  state: CanonicalDeliverableState;
  acting: boolean;
  error: string | null;
  onSubmit: (deliverable: CanonicalDeliverable) => void;
  onRequestRevision: (deliverable: CanonicalDeliverable) => void;
  onDownload: (deliverableId: string, revisionId: string) => void;
}) {
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
        <DeliverableRow
          key={deliverable.id}
          deliverable={deliverable}
          acting={acting}
          onSubmit={() => onSubmit(deliverable)}
          onRequestRevision={() => onRequestRevision(deliverable)}
          onDownload={(revisionId) => onDownload(deliverable.id, revisionId)}
        />
      ))}
      {error ? <Text className="font-geist-medium text-[12px] text-status-critical">{error}</Text> : null}
    </View>
  );
}

function DeliverableRow({
  deliverable,
  acting,
  onSubmit,
  onRequestRevision,
  onDownload,
}: {
  deliverable: CanonicalDeliverable;
  acting: boolean;
  onSubmit: () => void;
  onRequestRevision: () => void;
  onDownload: (revisionId: string) => void;
}) {
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
      {deliverable.content_ops_attention ? (
        <View className="rounded-lg bg-status-critical-tint px-2.5 py-2">
          <Text className="font-geist-semibold text-[11px] text-status-critical">Revision rounds exhausted</Text>
          <Text className="mt-0.5 font-geist text-[10.5px] text-ink-2">
            This deal remains in Creating and is paused for platform help.
          </Text>
        </View>
      ) : null}
      {deliverable.submission_history.length ? (
        <View className="gap-2 border-t border-hairline pt-2">
          <Text className="font-geist-medium text-[10.5px] uppercase tracking-wide text-ink-3">Submission history</Text>
          {deliverable.submission_history.map((submission) => (
            <View key={submission.id} className="rounded-lg bg-surface-card px-2.5 py-2">
              <View className="flex-row items-start justify-between gap-2">
                <View className="min-w-0 flex-1">
                  <Text selectable className="font-geist-semibold text-[11.5px] text-ink">
                    Round {submission.round_number} · {submission.original_filename}
                  </Text>
                  <Text className="mt-0.5 font-geist text-[10.5px] text-ink-3">
                    {submissionLabel(submission.lifecycle)} · {formatBytes(submission.size_bytes)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => onDownload(submission.id)}
                  disabled={acting}
                  accessibilityRole="button"
                  className="rounded-full border border-hairline px-2.5 py-1"
                >
                  <Text className="font-geist-semibold text-[10.5px] text-ink-2">Open</Text>
                </Pressable>
              </View>
              {submission.comment ? (
                <Text className="mt-2 border-t border-hairline pt-2 font-geist text-[11px] text-ink-2">
                  Revision note: {submission.comment}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text className="border-t border-hairline pt-2 font-geist text-[10.5px] text-ink-3">No draft submitted yet.</Text>
      )}
      {deliverable.available_actions.can_submit_content ? (
        <Pressable
          onPress={onSubmit}
          disabled={acting}
          accessibilityRole="button"
          className={`items-center rounded-full bg-ink py-2.5 ${acting ? 'opacity-50' : ''}`}
        >
          <Text className="font-geist-semibold text-[12px] text-white">
            {deliverable.revision_current === 0 ? 'Submit content' : `Submit round ${deliverable.revision_current + 1}`}
          </Text>
        </Pressable>
      ) : null}
      {deliverable.available_actions.can_request_revision ? (
        <Pressable
          onPress={onRequestRevision}
          disabled={acting}
          accessibilityRole="button"
          className={`items-center rounded-full border border-hairline bg-surface-card py-2.5 ${acting ? 'opacity-50' : ''}`}
        >
          <Text className="font-geist-semibold text-[12px] text-ink">Request revision</Text>
        </Pressable>
      ) : null}
      {deliverable.status === 'submitted' ? (
        <Text className="font-geist text-[10.5px] text-ink-3">
          Final approval is not available yet; this slice supports revision requests only.
        </Text>
      ) : null}
    </View>
  );
}

function submissionLabel(value: CanonicalDeliverable['submission_history'][number]['lifecycle']): string {
  if (value === 'awaiting_review') return 'Awaiting brand review';
  if (value === 'revision_requested') return 'Revision requested';
  return 'Approved';
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
