import { Text, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import type { DisputeItem, DisputeProjection } from '@/lib/deals';

export function DisputeCard({
  dispute,
  loading,
  error,
  feedback,
  onRetry,
  onRaise,
  onView,
}: {
  dispute: DisputeProjection | null;
  loading: boolean;
  error: string | null;
  feedback: string | null;
  onRetry: () => void;
  onRaise: () => void;
  onView: () => void;
}) {
  if (loading && !dispute) return <Notice title="Payment dispute" message="Loading the current dispute record…" />;
  if (!dispute) {
    return <Notice title="Payment dispute" message={error ?? 'The current dispute record is unavailable.'} actionLabel="Retry dispute record" onAction={onRetry} />;
  }
  if (!dispute.available) return null;

  if (dispute.current_open) {
    const current = dispute.current_open;
    return (
      <View className="gap-2 rounded-2xl border border-hairline bg-surface-recess p-3">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="font-geist-semibold text-secondary text-status-critical">Payment dispute open</Text>
            <Text className="mt-0.5 font-geist text-micro text-ink-2">
              Raised by {current.raised_by.display_name}. Payment tracking is paused while this is reviewed.
            </Text>
          </View>
          {loading ? <Text className="font-geist-medium text-micro text-ink-3">Refreshing…</Text> : null}
        </View>
        <Button action="secondary" accessibilityLabel="View current payment dispute" onPress={onView}>
          {/* Dispute is real harm: a small red dot carries it, never a red outline or fill. */}
          <View className="h-2 w-2 rounded-full bg-status-critical" />
          <ButtonText>View dispute</ButtonText>
        </Button>
        {feedback ? <Text accessibilityRole="alert" className="font-geist text-micro text-ink-2">{feedback}</Text> : null}
        {error ? <Retry message={error} onRetry={onRetry} /> : null}
      </View>
    );
  }

  if (!dispute.allowed_actions.can_raise) {
    return error ? <Notice title="Payment dispute" message={error} actionLabel="Retry dispute record" onAction={onRetry} /> : null;
  }
  return (
    <View className="gap-2 rounded-2xl border border-hairline bg-surface-card p-3">
      <Text className="font-geist-semibold text-secondary text-ink">Need to pause payment tracking?</Text>
      <Text className="font-geist text-micro text-ink-2">
        Raise a dispute to pause Payment while platform operations reviews it. This does not resolve the issue or move money.
      </Text>
      <Button action="secondary" accessibilityLabel="Raise a payment dispute" onPress={onRaise}>
        <ButtonText>Raise dispute</ButtonText>
      </Button>
      {error ? <Retry message={error} onRetry={onRetry} /> : null}
    </View>
  );
}

function Notice({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View className="gap-2 rounded-2xl border border-hairline bg-surface-card p-3">
      <Text className="font-geist-semibold text-secondary text-ink">{title}</Text>
      <Text className="font-geist text-micro text-ink-2">{message}</Text>
      {actionLabel && onAction ? (
        <Button action="secondary" accessibilityLabel={actionLabel} onPress={onAction}>
          <ButtonText>Retry</ButtonText>
        </Button>
      ) : null}
    </View>
  );
}

function Retry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="gap-2 rounded-xl bg-app px-3 py-2.5">
      <Text className="font-geist-medium text-micro text-status-critical">{message}</Text>
      <Button action="secondary" accessibilityLabel="Retry dispute record" onPress={onRetry}>
        <ButtonText>Retry</ButtonText>
      </Button>
    </View>
  );
}

export function DisputeDetailSheet({
  visible,
  dispute,
  history,
  onClose,
}: {
  visible: boolean;
  dispute: DisputeItem | null;
  history: DisputeItem[];
  onClose: () => void;
}) {
  if (!dispute) return null;
  return (
    <EditSheet visible={visible} onClose={onClose} title="Payment dispute" subtitle="Payment tracking is paused while this dispute is reviewed.">
      <View className="gap-3">
        <DisputeDetail item={dispute} current />
        {history.length > 1 ? (
          <View className="gap-2">
            <Text className="font-geist-semibold text-secondary text-ink">History</Text>
            {history.filter((item) => item.id !== dispute.id).map((item) => <DisputeDetail key={item.id} item={item} />)}
          </View>
        ) : null}
      </View>
    </EditSheet>
  );
}

function DisputeDetail({ item, current = false }: { item: DisputeItem; current?: boolean }) {
  return (
    <View className={`gap-2 rounded-xl border p-3 ${current ? 'border-hairline bg-surface-recess' : 'border-hairline bg-surface-card'}`}>
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          {current ? <View className="h-2 w-2 rounded-full bg-status-critical" /> : null}
          <Text className={`font-geist-semibold text-secondary ${current ? 'text-status-critical' : 'text-ink'}`}>{item.status === 'open' ? 'Open dispute' : 'Resolved dispute'}</Text>
        </View>
        <Text className="font-geist text-micro tabular-nums text-ink-3">{item.created_at}</Text>
      </View>
      <Text className="font-geist text-micro text-ink">{item.description}</Text>
      <Text className="font-geist text-micro text-ink-2">Raised by {item.raised_by.display_name} · {item.raised_by.role_label}</Text>
      {item.evidence.length ? (
        <View className="gap-1 rounded-lg bg-app px-2.5 py-2">
          <Text className="font-geist-semibold text-micro text-ink-2">Evidence</Text>
          {item.evidence.map((evidence) => <Text key={`${evidence.kind}:${evidence.id}`} numberOfLines={2} className="font-geist text-micro text-ink-2">{evidence.kind === 'message' ? 'Message' : 'Live post'} · {evidence.snippet}</Text>)}
        </View>
      ) : null}
      {item.resolved_at && item.resolution_note ? (
        <View className="rounded-lg bg-surface-recess px-2.5 py-2"><Text className="font-geist-semibold text-micro text-ink">Resolution · {item.resolved_at}</Text><Text className="mt-0.5 font-geist text-micro text-ink-2">{item.resolution_note}</Text></View>
      ) : null}
    </View>
  );
}
