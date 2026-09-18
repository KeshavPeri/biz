import { ActivityIndicator, Text, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import { Skeleton } from '@/components/motion/skeleton';
import type { ChatArchiveStatus, PostCloseEntryFeed, PostCloseRatings } from '@/lib/deals';

export function PostCloseCard({
  ratings,
  shared,
  privateNotes,
  archive,
  loading,
  acting,
  error,
  onRetry,
  onRate,
  onAddShared,
  onAddPrivate,
  onMoreShared,
  onMorePrivate,
  onRetryArchive,
  onDownloadArchive,
}: {
  ratings: PostCloseRatings | null;
  shared: PostCloseEntryFeed | null;
  privateNotes: PostCloseEntryFeed | null;
  archive: ChatArchiveStatus | null;
  loading: boolean;
  acting: boolean;
  error: string | null;
  onRetry: () => void;
  onRate: () => void;
  onAddShared: () => void;
  onAddPrivate: () => void;
  onMoreShared: () => void;
  onMorePrivate: () => void;
  onRetryArchive: () => void;
  onDownloadArchive: () => void;
}) {
  return (
    <View className="gap-2.5">
      <Section title="Final ratings" description="One immutable rating per side updates verified trust scores.">
        {ratings ? (
          <View className="gap-2">
            {(['creator', 'brand'] as const).map((side) => {
              const rating = ratings.ratings.find((item) => item.side === side);
              return rating ? (
                <View key={side} className="rounded-xl bg-surface-recess px-3 py-2.5">
                  <View className="flex-row items-center justify-between gap-3">
                    <Text className="font-geist-semibold text-micro text-ink">{rating.display_label}</Text>
                    <Text accessibilityLabel={`${rating.score} out of 5 stars`} className="font-geist-semibold text-secondary text-ink">{'★'.repeat(rating.score)}{'☆'.repeat(5 - rating.score)}</Text>
                  </View>
                  {rating.review ? <Text className="mt-1 font-geist text-micro text-ink-2">{rating.review}</Text> : null}
                </View>
              ) : (
                <Text key={side} className="rounded-xl bg-surface-recess px-3 py-2.5 font-geist text-micro text-ink-3">{side === 'creator' ? 'Creator' : 'Brand'} rating pending</Text>
              );
            })}
            {ratings.allowed_actions.can_rate ? <InlineButton label="Leave final rating" onPress={onRate} disabled={acting} /> : null}
          </View>
        ) : <LoadingLine loading={loading} text="Rating status unavailable." rows={2} />}
      </Section>

      <FeedSection title="Shared follow-up comments" description="Visible to current participants; separate from the read-only chat." feed={shared} loading={loading} empty="No shared follow-up comments yet." addLabel="Add shared comment" onAdd={onAddShared} onMore={onMoreShared} acting={acting} />
      <FeedSection title="My private notes" description="Only you can retrieve these notes. No one else is notified." feed={privateNotes} loading={loading} empty="You have no private notes for this deal." addLabel="Add private note" onAdd={onAddPrivate} onMore={onMorePrivate} acting={acting} />

      <Section title="Immutable chat record" description="A private PDF snapshot of the terminal chat. Post-deal entries are excluded.">
        {!archive ? <LoadingLine loading={loading} text="Chat record status unavailable." rows={1} /> : archive.state === 'ready' ? (
          <View className="gap-2">
            <Text className="font-geist text-micro text-status-good-label">Ready · {archive.message_count} messages · {archive.page_count} pages</Text>
            <InlineButton label="Download private PDF" onPress={onDownloadArchive} disabled={acting} />
          </View>
        ) : archive.state === 'failed' ? (
          <View className="gap-2">
            <Text accessibilityRole="alert" className="font-geist text-micro text-status-critical">Could not prepare. The deal remains safely Closed.</Text>
            {archive.allowed_actions.can_retry ? <InlineButton label="Retry chat record" onPress={onRetryArchive} disabled={acting} /> : null}
          </View>
        ) : <View className="flex-row items-center gap-2"><ActivityIndicator size="small" color="#847F78" /><Text className="font-geist text-micro text-ink-2">Preparing private chat record…</Text></View>}
      </Section>

      {error ? (
        <View className="gap-2 rounded-panel bg-surface-recess px-3 py-2.5">
          <View className="flex-row items-start gap-2">
            <View className="mt-1.5 h-2 w-2 rounded-full bg-status-critical" />
            <Text accessibilityRole="alert" className="flex-1 font-geist text-micro text-status-critical">{error}</Text>
          </View>
          <InlineButton label="Refresh post-deal record" onPress={onRetry} disabled={loading || acting} />
        </View>
      ) : null}
    </View>
  );
}

function FeedSection({ title, description, feed, loading, empty, addLabel, onAdd, onMore, acting }: {
  title: string;
  description: string;
  feed: PostCloseEntryFeed | null;
  loading: boolean;
  empty: string;
  addLabel: string;
  onAdd: () => void;
  onMore: () => void;
  acting: boolean;
}) {
  return (
    <Section title={title} description={description}>
      {feed ? (
        <View className="gap-2">
          {feed.entries.length ? feed.entries.map((entry) => (
            <View key={entry.id} className="rounded-xl bg-surface-recess px-3 py-2.5">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="font-geist-semibold text-micro text-ink">{entry.author_label}</Text>
                <Text className="font-geist text-micro tabular-nums text-ink-3">{formatDate(entry.created_at)}</Text>
              </View>
              <Text className="mt-1 font-geist text-micro text-ink-2">{entry.body}</Text>
            </View>
          )) : <Text className="font-geist text-micro text-ink-3">{empty}</Text>}
          <View className="flex-row gap-2">
            <View className="flex-1"><InlineButton label={addLabel} onPress={onAdd} disabled={acting} /></View>
            {feed.next_cursor ? <View className="flex-1"><InlineButton label="Load older" onPress={onMore} disabled={acting} /></View> : null}
          </View>
        </View>
      ) : <LoadingLine loading={loading} text={`${title} unavailable.`} rows={2} />}
    </Section>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <View className="gap-2 rounded-2xl border border-hairline bg-surface-card p-3">
      <View>
        <Text className="font-geist-semibold text-secondary text-ink">{title}</Text>
        <Text className="mt-0.5 font-geist text-micro text-ink-2">{description}</Text>
      </View>
      {children}
    </View>
  );
}

function InlineButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Button action="secondary" accessibilityLabel={label} isDisabled={disabled} onPress={onPress}>
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}

function LoadingLine({ loading, text, rows }: { loading: boolean; text: string; rows: number }) {
  if (loading) {
    return (
      <View className="gap-2">
        {Array.from({ length: rows }).map((_, i) => <Skeleton.Block key={i} height={32} radius="panel" />)}
      </View>
    );
  }
  return <Text className="font-geist text-micro text-ink-3">{text}</Text>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recorded' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
