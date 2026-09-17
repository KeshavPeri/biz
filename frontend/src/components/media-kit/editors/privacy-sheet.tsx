import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: { key: keyof PrivacySettings; label: string; desc: string }[] = [
    { key: 'handles_visible', label: 'Show platform handles', desc: 'Let brands see your @handles.' },
    { key: 'contact_visible', label: 'Show contact', desc: 'Reveal contact details on your profile.' },
  ];

  // One switch decides whether prices are visible at all — it writes both the
  // privacy flag and the rate_cards.is_enabled flag together (B5-47: these used
  // to be two separate switches for the same outcome).
  const rateCardVisible = privacy.rate_card_visible;
  const setRateCardVisible = (v: boolean) => setPrivacy((p) => ({ ...p, rate_card_visible: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await updatePrivacySettings(data.profileId, privacy);
    if (!res.ok) {
      setSaving(false);
      return setError(res.message);
    }
    // Sync the rate-card enable flag too (create the card lazily if needed).
    if (rateCardVisible !== Boolean(data.rateCard?.is_enabled)) {
      const cardId = data.rateCard?.id ?? (await ensureRateCard(data.creatorId));
      if (cardId) await setRateCardEnabled(cardId, rateCardVisible);
    }
    setSaving(false);
    onSaved();
  };

  return (
    <EditSheet
      visible={visible}
      onClose={onClose}
      title="Privacy"
      subtitle="You control what a browsing brand can see."
      footer={
        <Button action="primary" size="lg" className="w-full" isDisabled={saving} onPress={save}>
          {saving ? <ButtonSpinner color="#FBFAF6" /> : null}
          <ButtonText>Save</ButtonText>
        </Button>
      }
    >
      {rows.map((row) => (
        <View
          key={row.key}
          className="mb-3 flex-row items-center gap-3.5 rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1"
        >
          <View className="flex-1">
            <Text className="font-geist-semibold text-body text-ink">{row.label}</Text>
            <Text className="mt-0.5 font-geist text-secondary leading-[18px] text-ink-2">{row.desc}</Text>
          </View>
          <Toggle
            value={privacy[row.key]}
            onValueChange={(v) => setPrivacy((p) => ({ ...p, [row.key]: v }))}
            accessibilityLabel={row.label}
          />
        </View>
      ))}

      <View className="mb-3 flex-row items-center gap-3.5 rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1">
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
          onValueChange={setRateCardVisible}
          accessibilityLabel="Show rate card to verified brands"
        />
      </View>

      {error ? <Text className="font-geist text-secondary text-status-critical">{error}</Text> : null}
    </EditSheet>
  );
}
