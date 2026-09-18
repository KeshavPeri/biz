import { useState } from 'react';
import { Text, View } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';

import { ListItemFade } from '@/components/motion/list-item-fade';
import { Button, ButtonText } from '@/components/ui/button';
import { PrivateDeliverableLabelPicker } from '@/components/deal/private-deliverable-label-picker';
import type {
  CanonicalDeliverable,
  CanonicalDeliverableState,
  DeliverableContentFormat,
  DeliverablePlatform,
  ParticipantRole,
} from '@/lib/deals';
import type {
  PrivateDeliverableLabel,
  PrivateDeliverableLabelMap,
} from '@/lib/private-deliverable-labels';

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
  onApprove,
  onApprovalDecision,
  onDownload,
  myRole,
  privateLabels,
  onPrivateLabelChange,
  onLivePost,
  onFlagPost,
  onOpenVerifiedPost,
}: {
  state: CanonicalDeliverableState;
  acting: boolean;
  error: string | null;
  onSubmit: (deliverable: CanonicalDeliverable) => void;
  onRequestRevision: (deliverable: CanonicalDeliverable) => void;
  onApprove: (deliverable: CanonicalDeliverable) => void;
  onApprovalDecision: (deliverable: CanonicalDeliverable, decision: 'approve' | 'reject') => void;
  onDownload: (deliverableId: string, revisionId: string) => void;
  myRole: ParticipantRole | null;
  privateLabels: PrivateDeliverableLabelMap;
  onPrivateLabelChange: (deliverableId: string, value: PrivateDeliverableLabel | null) => void;
  onLivePost: (deliverable: CanonicalDeliverable) => void;
  onFlagPost: (deliverable: CanonicalDeliverable) => void;
  onOpenVerifiedPost: (url: string) => void;
}) {
  return (
    <View className="gap-3 rounded-2xl border border-hairline bg-surface-card p-3">
      <View>
        <Text className="font-geist-semibold text-subtitle text-ink">Agreed deliverables</Text>
        <Text className="mt-0.5 font-geist text-micro text-ink-3">
          {state.deliverables.length} item{state.deliverables.length === 1 ? '' : 's'} from the approved terms
        </Text>
      </View>
      {state.deliverables.length === 0 ? (
        <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess px-3 py-3">
          <View className="mt-1.5 h-2 w-2 rounded-full bg-status-critical" />
          <Text className="flex-1 font-geist-medium text-secondary text-status-critical">
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
          onApprove={() => onApprove(deliverable)}
          onApprovalDecision={(decision) => onApprovalDecision(deliverable, decision)}
          onDownload={(revisionId) => onDownload(deliverable.id, revisionId)}
          myRole={myRole}
          privateLabel={privateLabels[deliverable.id] ?? null}
          onPrivateLabelChange={(value) => onPrivateLabelChange(deliverable.id, value)}
          showPrivateLabel={state.stage === 'creating'}
          onLivePost={() => onLivePost(deliverable)}
          onFlagPost={() => onFlagPost(deliverable)}
          onOpenVerifiedPost={onOpenVerifiedPost}
        />
      ))}
      {error ? <Text className="font-geist-medium text-secondary text-status-critical">{error}</Text> : null}
    </View>
  );
}

function DeliverableRow({
  deliverable,
  acting,
  onSubmit,
  onRequestRevision,
  onApprove,
  onApprovalDecision,
  onDownload,
  myRole,
  privateLabel,
  onPrivateLabelChange,
  showPrivateLabel,
  onLivePost,
  onFlagPost,
  onOpenVerifiedPost,
}: {
  deliverable: CanonicalDeliverable;
  acting: boolean;
  onSubmit: () => void;
  onRequestRevision: () => void;
  onApprove: () => void;
  onApprovalDecision: (decision: 'approve' | 'reject') => void;
  onDownload: (revisionId: string) => void;
  myRole: ParticipantRole | null;
  privateLabel: PrivateDeliverableLabel | null;
  onPrivateLabelChange: (value: PrivateDeliverableLabel | null) => void;
  showPrivateLabel: boolean;
  onLivePost: () => void;
  onFlagPost: () => void;
  onOpenVerifiedPost: (url: string) => void;
}) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const currentPost = deliverable.post_state.current;
  const priorPosts = deliverable.post_state.history.filter((item) => item.id !== currentPost?.id);
  return (
    <View className="gap-2 rounded-xl bg-surface-recess p-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-secondary text-ink">{deliverable.display_name}</Text>
          <Text className="mt-0.5 font-geist text-micro text-ink-2">
            {PLATFORM_LABELS[deliverable.platform]} · {FORMAT_LABELS[deliverable.content_format]}
          </Text>
        </View>
        <Text className="font-geist-semibold text-micro text-ink-2">
          {STATUS_LABELS[deliverable.status]}
        </Text>
      </View>
      <Detail label="Posting" value={postingLabel(deliverable)} />
      {deliverable.location ? <Detail label="Location" value={deliverable.location} /> : null}
      <Detail label="Revisions" value={`Round ${deliverable.revision_current} of ${deliverable.revision_max}`} />
      {showPrivateLabel && myRole === 'creator' ? (
        <PrivateDeliverableLabelPicker
          deliverableName={deliverable.display_name}
          value={privateLabel}
          acting={acting}
          onChange={onPrivateLabelChange}
        />
      ) : null}
      {currentPost ? (
        <View className="gap-2 border-t border-hairline pt-2">
          <Text className="font-geist-medium text-micro text-ink-3">Current live proof</Text>
          <PostEvidence evidence={currentPost} current onOpenVerifiedPost={onOpenVerifiedPost} />
          {currentPost.verification_status === 'flagged' && currentPost.flag_reason ? (
            <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess px-2.5 py-2">
              <View className="mt-1.5 h-2 w-2 rounded-full bg-status-critical" />
              <View className="min-w-0 flex-1">
                <Text className="font-geist-semibold text-secondary text-status-critical">Flagged for correction</Text>
                <Text selectable className="mt-0.5 font-geist text-micro text-ink-2">{currentPost.flag_reason}</Text>
              </View>
            </View>
          ) : null}
          {priorPosts.length || deliverable.post_state.history_truncated ? (
            <Button
              action="ghost"
              accessibilityLabel={historyExpanded ? 'Hide prior live post versions' : 'Show prior live post versions'}
              onPress={() => setHistoryExpanded((value) => !value)}
            >
              <ButtonText>
                {historyExpanded ? 'Hide prior versions' : `Show prior versions${priorPosts.length ? ` (${priorPosts.length})` : ''}`}
              </ButtonText>
            </Button>
          ) : null}
          {historyExpanded ? (
            <View className="gap-2">
              {priorPosts.map((evidence) => <PostEvidence key={evidence.id} evidence={evidence} current={false} onOpenVerifiedPost={onOpenVerifiedPost} />)}
              {deliverable.post_state.history_truncated ? (
                <Text className="font-geist text-micro text-ink-3">Earlier proof history is truncated.</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : deliverable.status === 'approved' ? (
        <Text className="border-t border-hairline pt-2 font-geist text-micro text-ink-3">No live URL submitted yet.</Text>
      ) : null}
      {deliverable.content_ops_attention ? (
        <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess px-2.5 py-2">
          <View className="mt-1.5 h-2 w-2 rounded-full bg-status-critical" />
          <View className="min-w-0 flex-1">
            <Text className="font-geist-semibold text-secondary text-status-critical">Revision rounds exhausted</Text>
            <Text className="mt-0.5 font-geist text-micro text-ink-2">
              This deal remains in Creating and is paused for platform help.
            </Text>
          </View>
        </View>
      ) : null}
      {deliverable.submission_history.length ? (
        <View className="gap-2 border-t border-hairline pt-2">
          <Text className="font-geist-medium text-micro text-ink-3">Submission history</Text>
          <LayoutAnimationConfig skipEntering>
            {deliverable.submission_history.map((submission) => (
              <ListItemFade key={submission.id}>
                <View className="rounded-lg bg-surface-card px-2.5 py-2">
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="min-w-0 flex-1">
                      <Text selectable numberOfLines={1} ellipsizeMode="middle" className="font-geist-semibold text-secondary text-ink">
                        Round {submission.round_number} · {submission.original_filename}
                      </Text>
                      <Text className="mt-0.5 font-geist text-micro text-ink-3">
                        {submissionLabel(submission.lifecycle)} · {formatBytes(submission.size_bytes)}
                      </Text>
                    </View>
                    <Button action="secondary" onPress={() => onDownload(submission.id)} isDisabled={acting} className="px-4">
                      <ButtonText>Open</ButtonText>
                    </Button>
                  </View>
                  {submission.comment ? (
                    <Text className="mt-2 border-t border-hairline pt-2 font-geist text-secondary text-ink-2">
                      Revision note: {submission.comment}
                    </Text>
                  ) : null}
                </View>
              </ListItemFade>
            ))}
          </LayoutAnimationConfig>
        </View>
      ) : (
        <Text className="border-t border-hairline pt-2 font-geist text-micro text-ink-3">No draft submitted yet.</Text>
      )}
      {deliverable.content_approval ? (
        <View className={`flex-row items-start gap-2 rounded-panel px-2.5 py-2 ${
          deliverable.content_approval.status === 'rejected'
            ? 'bg-surface-recess'
            : deliverable.content_approval.status === 'approved'
              ? 'bg-surface-recess'
              : 'bg-cane-1'
        }`}>
          {deliverable.content_approval.status !== 'pending' ? (
            <View className={`mt-1.5 h-2 w-2 rounded-full ${deliverable.content_approval.status === 'rejected' ? 'bg-status-critical' : 'bg-status-good'}`} />
          ) : null}
          <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-secondary text-ink">
            {deliverable.content_approval.status === 'pending'
              ? `Awaiting checker · ${deliverable.content_approval.checker_name}`
              : deliverable.content_approval.status === 'approved'
                ? `Checker confirmed ${deliverable.content_approval.maker_name}'s approval`
                : `Checker rejected ${deliverable.content_approval.maker_name}'s approval`}
          </Text>
          <Text className="mt-0.5 font-geist text-micro text-ink-2">
            Maker: {deliverable.content_approval.maker_name} · Round {deliverable.content_approval.round_number}
          </Text>
          {deliverable.content_approval.comment ? (
            <Text className="mt-1 font-geist text-micro text-ink-2">
              Explanation: {deliverable.content_approval.comment}
            </Text>
          ) : null}
          {deliverable.content_approval.can_decide ? (
            <View className="mt-2 flex-row gap-2">
              <Button action="secondary" onPress={() => onApprovalDecision('reject')} isDisabled={acting} className="flex-1 px-3">
                <ButtonText>Reject</ButtonText>
              </Button>
              <Button action="primary" onPress={() => onApprovalDecision('approve')} isDisabled={acting} className="flex-1 px-3">
                <ButtonText>Confirm approval</ButtonText>
              </Button>
            </View>
          ) : null}
          </View>
        </View>
      ) : null}
      {deliverable.available_actions.can_submit_content ? (
        <Button action="primary" onPress={onSubmit} isDisabled={acting}>
          <ButtonText>
            {deliverable.revision_current === 0 ? 'Submit content' : `Submit round ${deliverable.revision_current + 1}`}
          </ButtonText>
        </Button>
      ) : null}
      {deliverable.available_actions.can_request_revision ? (
        <Button action="secondary" onPress={onRequestRevision} isDisabled={acting}>
          <ButtonText>Request revision</ButtonText>
        </Button>
      ) : null}
      {deliverable.available_actions.can_approve_content ? (
        <Button action="primary" onPress={onApprove} isDisabled={acting}>
          <ButtonText>Approve content</ButtonText>
        </Button>
      ) : null}
      {deliverable.post_state.future_actions.can_submit_or_replace ? (
        <Button
          action="primary"
          onPress={onLivePost}
          isDisabled={acting}
          accessibilityLabel={`${currentPost ? 'Replace' : 'Submit'} live URL for ${deliverable.display_name}`}
        >
          <ButtonText>{currentPost ? 'Replace live URL' : 'Submit live URL'}</ButtonText>
        </Button>
      ) : null}
      {deliverable.post_state.future_actions.can_flag && currentPost ? (
        <Button
          action="secondary"
          onPress={onFlagPost}
          isDisabled={acting}
          accessibilityLabel={`Flag live URL for ${deliverable.display_name}`}
        >
          <ButtonText>Flag issue</ButtonText>
        </Button>
      ) : null}
      {deliverable.status === 'submitted' && !deliverable.available_actions.can_approve_content && !deliverable.content_approval ? (
        <Text className="font-geist text-micro text-ink-3">
          This submission is awaiting brand review.
        </Text>
      ) : null}
    </View>
  );
}

function PostEvidence({ evidence, current, onOpenVerifiedPost }: {
  evidence: CanonicalDeliverable['post_state']['history'][number];
  current: boolean;
  onOpenVerifiedPost: (url: string) => void;
}) {
  const status = evidence.verification_status === 'confirmed'
    ? 'Confirmed'
    : evidence.verification_status === 'flagged' ? 'Flagged' : 'Verified';
  return (
    <View className="gap-1 rounded-lg bg-surface-card px-2.5 py-2">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="min-w-0 flex-1 font-geist-semibold text-secondary text-ink">
          {status} · v{evidence.version}{current ? ' · current' : ''}
        </Text>
        <Text className="font-geist text-micro text-ink-3">{evidence.host}</Text>
      </View>
      {evidence.title ? <Text selectable numberOfLines={1} ellipsizeMode="middle" className="font-geist-semibold text-secondary text-ink-2">{evidence.title}</Text> : null}
      {evidence.site_name ? <Text selectable numberOfLines={1} ellipsizeMode="middle" className="font-geist text-micro text-ink-3">{evidence.site_name}</Text> : null}
      {evidence.description ? <Text selectable numberOfLines={2} ellipsizeMode="tail" className="font-geist text-micro text-ink-2">{evidence.description}</Text> : null}
      <Text selectable numberOfLines={1} ellipsizeMode="middle" className="font-geist text-micro text-ink-2">
        {evidence.final_url}
      </Text>
      <Text className="font-geist text-micro text-ink-3">Submitted by {evidence.submitted_by_name} · {formatTimestamp(evidence.verified_at)}</Text>
      {evidence.flagged_at && evidence.flagged_by_name ? (
        <Text className="font-geist text-micro text-ink-3">Flagged by {evidence.flagged_by_name} · {formatTimestamp(evidence.flagged_at)}</Text>
      ) : null}
      {evidence.confirmed_at && evidence.confirmed_by_name ? (
        <Text className="font-geist text-micro text-ink-3">Confirmed by {evidence.confirmed_by_name} · {formatTimestamp(evidence.confirmed_at)}</Text>
      ) : null}
      {current ? (
        <Button
          action="secondary"
          accessibilityRole="link"
          accessibilityLabel={`Open verified post version ${evidence.version}`}
          onPress={() => onOpenVerifiedPost(evidence.final_url)}
          className="mt-1 self-start"
        >
          <ButtonText>Open verified post</ButtonText>
        </Button>
      ) : null}
    </View>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
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
      <Text className="font-geist-medium text-micro text-ink-3">{label}</Text>
      <Text selectable className="min-w-0 flex-1 text-right font-geist-medium text-secondary text-ink-2">{value}</Text>
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
