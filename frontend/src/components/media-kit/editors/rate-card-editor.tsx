import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EditSheet } from '@/components/ui/edit-sheet';
import { TextField } from '@/components/ui/text-field';
import { Toggle } from '@/components/ui/toggle';
import {
  CONTENT_FORMATS,
  PLATFORMS,
  contentFormatLabel,
  platformLabel,
} from '@/lib/media-kit-enums';
import { formatINR } from '@/lib/format';
import {
  deleteRateCardItem,
  ensureRateCard,
  setRateCardEnabled,
  upsertRateCardItem,
  type RateCard,
} from '@/lib/media-kit';

import TrashIcon from '@/assets/icons/trash.svg';

type Draft = {
  id?: string;
  title: string;
  platform: string;
  contentFormat: string;
  basePrice: string;
  description: string;
};

const EMPTY_DRAFT: Draft = {
  title: '',
  platform: 'instagram',
  contentFormat: 'reel',
  basePrice: '',
  description: '',
};

/**
 * Rate-card editor (B2-034 + the B2-037 enable toggle). CRUD over rate_card_items
 * on the creator's single rate_cards row (created lazily via ensureRateCard). All
 * owned-record writes under RLS. `onChanged` refetches after every mutation so the
 * list + the underlying media kit stay in sync.
 */
export function RateCardEditor({
  visible,
  onClose,
  onChanged,
  creatorId,
  rateCard,
}: {
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  creatorId: string;
  rateCard: RateCard | null;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = rateCard?.items ?? [];
  const priceNum = Number(draft.basePrice);
  const canAdd = draft.title.trim().length > 0 && Number.isFinite(priceNum) && priceNum > 0;

  const toggleEnabled = async (next: boolean) => {
    setError(null);
    const cardId = rateCard?.id ?? (await ensureRateCard(creatorId));
    if (!cardId) return setError('Could not update the rate card.');
    const res = await setRateCardEnabled(cardId, next);
    if (!res.ok) setError(res.message);
    onChanged();
  };

  const saveDraft = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    const cardId = rateCard?.id ?? (await ensureRateCard(creatorId));
    if (!cardId) {
      setBusy(false);
      return setError('Could not create the rate card.');
    }
    const res = await upsertRateCardItem(cardId, {
      id: draft.id,
      title: draft.title,
      platform: draft.platform,
      contentFormat: draft.contentFormat,
      basePrice: priceNum,
      description: draft.description,
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setDraft(EMPTY_DRAFT);
    onChanged();
  };

  const removeItem = async (id: string) => {
    setError(null);
    const res = await deleteRateCardItem(id);
    if (!res.ok) return setError(res.message);
    if (draft.id === id) setDraft(EMPTY_DRAFT);
    onChanged();
  };

  return (
    <EditSheet
      visible={visible}
      onClose={onClose}
      title="Rate card"
      subtitle="Prices are shown only to verified brands. Indicative — every deal is negotiated in chat."
      footer={
        <Button action="primary" size="lg" className="w-full" onPress={onClose}>
          <ButtonText>Done</ButtonText>
        </Button>
      }
    >
      {/* Enable toggle. */}
      <View className="mb-4 flex-row items-center gap-3 rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1">
        <View className="flex-1">
          <Text className="font-geist-semibold text-body text-ink">Show rate card to brands</Text>
          <Text className="mt-0.5 font-geist text-secondary text-ink-2">
            Off keeps prices private even from brands.
          </Text>
        </View>
        <Toggle
          value={Boolean(rateCard?.is_enabled)}
          onValueChange={toggleEnabled}
          accessibilityLabel="Show rate card to brands"
        />
      </View>

      {/* Existing items. */}
      {items.length > 0 ? (
        <View className="mb-4 rounded-card border border-hairline-card bg-surface-card p-2 shadow-l1">
          {items.map((item, i) => (
            <View
              key={item.id}
              className={`flex-row items-center gap-2 px-2 py-2.5 ${
                i === 0 ? '' : 'border-t border-hairline'
              }`}
            >
              <Pressable
                className="flex-1"
                onPress={() =>
                  setDraft({
                    id: item.id,
                    title: item.title,
                    platform: item.platform,
                    contentFormat: item.content_format,
                    basePrice: String(item.base_price),
                    description: item.description ?? '',
                  })
                }
              >
                <Text className="font-geist-medium text-body text-ink">{item.title}</Text>
                <Text className="mt-0.5 font-geist text-[11px] text-ink-3">
                  {platformLabel(item.platform)} · {contentFormatLabel(item.content_format)} ·{' '}
                  {formatINR(item.base_price)}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => removeItem(item.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.title}`}
              >
                <TrashIcon width={18} height={18} color="#C0392B" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* Add / edit form. */}
      <Text className="mb-2 font-geist-semibold text-body text-ink">
        {draft.id ? 'Edit rate' : 'Add a rate'}
      </Text>
      <TextField
        label="Title"
        value={draft.title}
        onChangeText={(v) => setDraft((d) => ({ ...d, title: v }))}
        placeholder="e.g. Instagram Reel"
      />

      <SelectRow
        label="Platform"
        options={PLATFORMS.map((p) => ({ value: p.value, label: p.label }))}
        value={draft.platform}
        onSelect={(v) => setDraft((d) => ({ ...d, platform: v }))}
      />
      <SelectRow
        label="Format"
        options={CONTENT_FORMATS.map((c) => ({ value: c.value, label: c.label }))}
        value={draft.contentFormat}
        onSelect={(v) => setDraft((d) => ({ ...d, contentFormat: v }))}
      />

      <TextField
        label="Base price (₹)"
        value={draft.basePrice}
        onChangeText={(v) => setDraft((d) => ({ ...d, basePrice: v }))}
        keyboardType="number-pad"
        placeholder="35000"
      />
      <TextField
        label="Description"
        labelHint="optional"
        value={draft.description}
        onChangeText={(v) => setDraft((d) => ({ ...d, description: v }))}
        placeholder="up to 60s · 2 revision rounds"
      />

      <View className="flex-row gap-2.5">
        {draft.id ? (
          <Button
            action="secondary"
            size="md"
            className="flex-1"
            onPress={() => setDraft(EMPTY_DRAFT)}
          >
            <ButtonText>Cancel edit</ButtonText>
          </Button>
        ) : null}
        <Button
          action="primary"
          size="md"
          className="flex-1"
          isDisabled={!canAdd || busy}
          onPress={saveDraft}
        >
          {busy ? <ButtonSpinner /> : null}
          <ButtonText>{draft.id ? 'Save rate' : 'Add rate'}</ButtonText>
        </Button>
      </View>

      {error ? (
        <Text className="mt-3 font-geist text-secondary text-status-critical">{error}</Text>
      ) : null}
    </EditSheet>
  );
}

/** A horizontal-wrapping chip picker for enum values. */
function SelectRow({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View className="mb-4">
      <Text className="mb-[7px] font-geist-semibold text-secondary text-ink-2">{label}</Text>
      <View className="flex-row flex-wrap gap-[9px]">
        {options.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            selected={value === opt.value}
            onPress={() => onSelect(opt.value)}
          />
        ))}
      </View>
    </View>
  );
}
