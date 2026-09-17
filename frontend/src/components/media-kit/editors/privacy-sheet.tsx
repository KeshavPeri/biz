import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Button, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import { Toggle } from '@/components/ui/toggle';
import {
  ensureRateCard,
  setRateCardEnabled,
  updatePrivacySettings,
  type CreatorMediaKit,
  type PrivacySettings,
} from '@/lib/media-kit';

/**
 * Privacy settings (B2-037). Edits creator_profiles.privacy_settings (jsonb) plus
 * the rate_cards.is_enabled flag — the two levers that decide what a browsing brand
 * sees. Owned-record writes under RLS. The client media-kit preview honours these,
 * but the REAL enforcement is RLS (see media-kit-view.tsx security note).
 */
export function PrivacySheet({
  visible,
  onClose,
  onSaved,
  data,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  data: CreatorMediaKit;
}) {
  const [privacy, setPrivacy] = useState<PrivacySettings>(data.privacy);
  const [error, setError] = useState<string | null>(null);

  const rows: { key: keyof PrivacySettings; label: string; desc: string }[] = [
    { key: 'handles_visible', label: 'Show platform handles', desc: 'Let brands see your @handles.' },
    { key: 'contact_visible', label: 'Show contact', desc: 'Reveal contact details on your profile.' },
  ];

  // One switch decides whether prices are visible at all — it writes both the
  // privacy flag and the rate_cards.is_enabled flag together (B5-47: these used
  // to be two separate switches for the same outcome).
  const rateCardVisible = privacy.rate_card_visible;

  // Toggles write immediately (B5-50) — iOS switches apply on flip, they don't
  // wait behind a Save button. Optimistic update + selection haptic, reverted
  // with an inline message if the write fails.
  const updateField = async (key: keyof PrivacySettings, value: boolean) => {
    const previous = privacy[key];
    setPrivacy((p) => ({ ...p, [key]: value }));
    setError(null);
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    const res = await updatePrivacySettings(data.profileId, { ...privacy, [key]: value });
    if (!res.ok) {
      setPrivacy((p) => ({ ...p, [key]: previous }));
      setError(res.message);
      return;
    }
    onSaved();
  };

  const updateRateCardVisible = async (value: boolean) => {
    const previous = rateCardVisible;
    setPrivacy((p) => ({ ...p, rate_card_visible: value }));
    setError(null);
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    // Sync the rate-card enable flag too (create the card lazily if needed;
    // turning it off with no card yet is a no-op, there's nothing to disable).
    const cardId = data.rateCard?.id ?? (value ? await ensureRateCard(data.creatorId) : null);
    const cardRes = cardId ? await setRateCardEnabled(cardId, value) : { ok: true as const };
    const settingsRes = cardRes.ok
      ? await updatePrivacySettings(data.profileId, { ...privacy, rate_card_visible: value })
      : cardRes;
    if (!settingsRes.ok) {
      setPrivacy((p) => ({ ...p, rate_card_visible: previous }));
      setError(settingsRes.message);
      return;
    }
    onSaved();
  };

  return (
    <EditSheet
      visible={visible}
      onClose={onClose}
      title="Privacy"
      subtitle="You control what a browsing brand can see."
      footer={
        <Button action="primary" size="lg" className="w-full" onPress={onClose}>
          <ButtonText>Done</ButtonText>
        </Button>
      }
    >
      {/* Grouped L0 list (B5-49) — one hairline-bordered card, dividers between
          rows, no per-row shadow. */}
      <View className="overflow-hidden rounded-card border border-hairline-card bg-surface-card">
        {rows.map((row, i) => (
          <View
            key={row.key}
            className={`flex-row items-center gap-3.5 p-4 ${i > 0 ? 'border-t border-hairline-card' : ''}`}
          >
            <View className="flex-1">
              <Text className="font-geist-semibold text-body text-ink">{row.label}</Text>
              <Text className="mt-0.5 font-geist text-secondary leading-[18px] text-ink-2">{row.desc}</Text>
            </View>
            <Toggle
              value={privacy[row.key]}
              onValueChange={(v) => updateField(row.key, v)}
              accessibilityLabel={row.label}
            />
          </View>
        ))}

        <View className="flex-row items-center gap-3.5 border-t border-hairline-card p-4">
          <View className="flex-1">
            <Text className="font-geist-semibold text-body text-ink">Show rate card to verified brands</Text>
            <Text className="mt-0.5 font-geist text-secondary leading-[18px] text-ink-2">
              {rateCardVisible
                ? 'Verified brands can see your prices.'
                : 'Your prices are hidden from everyone.'}
            </Text>
          </View>
          <Toggle
            value={rateCardVisible}
            onValueChange={updateRateCardVisible}
            accessibilityLabel="Show rate card to verified brands"
          />
        </View>
      </View>

      {/* Routine settings error, not a payment/contract failure — ink-2, no red (decision 11). */}
      {error ? <Text className="mt-3 font-geist text-secondary text-ink-2">{error}</Text> : null}
    </EditSheet>
  );
}
