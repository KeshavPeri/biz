import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';

import TagIcon from '@/assets/icons/tag.svg';
import { ListItemFade } from '@/components/motion/list-item-fade';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import {
  MAX_PRIVATE_DEAL_LABELS,
  normalizePrivateDealLabel,
  type PrivateDealLabel,
} from '@/lib/private-deal-labels';
import { PrivateDealLabelContextFence } from '@/lib/private-deal-label-state';

export function PrivateDealLabelSheet({
  visible, accountId, dealId, dealName, labels, suggestions, loading, initialError, onClose, onAdd, onRemove,
}: {
  visible: boolean; accountId: string; dealId: string; dealName: string;
  labels: PrivateDealLabel[]; suggestions: string[]; loading: boolean; initialError: string | null; onClose: () => void;
  onAdd: (label: string) => Promise<boolean>; onRemove: (annotationId: string) => Promise<boolean>;
}) {
  const identity = `${accountId}:${dealId}`;
  const fence = useRef(new PrivateDealLabelContextFence()).current;
  fence.switchContext(identity);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(''); setBusy(false); setError(null); }, [identity, visible]);

  const add = async (candidate: string) => {
    const label = normalizePrivateDealLabel(candidate);
    if (!label) { setError('Use 1–32 visible characters for a private label.'); return; }
    if (labels.some((row) => row.label === label)) { setError('That private label is already on this deal.'); return; }
    if (labels.length >= MAX_PRIVATE_DEAL_LABELS) { setError('You can keep up to eight private labels on a deal.'); return; }
    const ticket = fence.begin(identity);
    setBusy(true); setError(null);
    const saved = await onAdd(label);
    if (!fence.isCurrent(ticket)) return;
    setBusy(false);
    if (saved) setDraft(''); else setError("Couldn't update your private labels. Refresh and try again.");
  };
  const remove = async (annotationId: string) => {
    const ticket = fence.begin(identity);
    setBusy(true); setError(null);
    const saved = await onRemove(annotationId);
    if (!fence.isCurrent(ticket)) return;
    setBusy(false);
    if (!saved) setError("Couldn't update your private labels. Refresh and try again.");
  };
  const availableSuggestions = suggestions.filter((label) => !labels.some((row) => row.label === label));
  const canAdd = !busy && !loading && labels.length < MAX_PRIVATE_DEAL_LABELS;
  return <EditSheet visible={visible} onClose={() => { if (!busy) onClose(); }} title="Private labels" subtitle={`Only you can see these organizers for ${dealName}.`} footer={(
    <View className="flex-row gap-2"><Button action="ghost" onPress={onClose} isDisabled={busy} className="flex-1"><ButtonText>Done</ButtonText></Button><Button action="primary" onPress={() => { void add(draft); }} isDisabled={!canAdd || !draft} className="flex-1">{busy ? <ButtonSpinner /> : <ButtonText>Add label</ButtonText>}</Button></View>
  )}>
    <View className="gap-3">
      <View className="flex-row items-center gap-2"><TagIcon width={18} height={18} color="#847F78" /><TextInput value={draft} onChangeText={(value) => { setDraft(value); setError(null); }} editable={canAdd} maxLength={64} accessibilityLabel="New private label" placeholder="Add a label" placeholderTextColor="#847F78" className="min-h-11 flex-1 rounded-xl border border-hairline bg-surface-card px-3 font-geist text-secondary text-ink" /></View>
      {error || initialError ? <Text accessibilityRole="alert" className="font-geist text-secondary text-ink-2">{error ?? initialError}</Text> : null}
      {loading ? <ActivityIndicator color="#847F78" /> : labels.length === 0 ? <Text className="font-geist text-secondary text-ink-3">No private labels yet.</Text> : <LayoutAnimationConfig skipEntering><View className="gap-2">{labels.map((row) => <ListItemFade key={row.id}><View className="flex-row items-center justify-between rounded-xl border border-hairline bg-surface-card px-3 py-2"><Text className="font-geist-medium text-secondary text-ink">{row.label}</Text><Pressable accessibilityRole="button" accessibilityLabel="Remove private label" disabled={busy} onPress={() => { void remove(row.id); }}><Text className="font-geist-semibold text-secondary text-ink-2">Remove</Text></Pressable></View></ListItemFade>)}</View></LayoutAnimationConfig>}
      {availableSuggestions.length > 0 && labels.length < MAX_PRIVATE_DEAL_LABELS ? <View className="gap-2"><Text className="font-geist-medium text-micro text-ink-3">Your other labels</Text><View className="flex-row flex-wrap gap-2">{availableSuggestions.map((label) => <Pressable key={label} disabled={busy} onPress={() => { void add(label); }} className="rounded-pill border border-hairline bg-surface-card px-3 py-1.5"><Text className="font-geist-semibold text-micro text-ink-2">{label}</Text></Pressable>)}</View></View> : null}
    </View>
  </EditSheet>;
}
