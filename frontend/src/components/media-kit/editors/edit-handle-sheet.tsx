import { useState } from 'react';
import { Text } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import { TextField } from '@/components/ui/text-field';
import { platformLabel } from '@/lib/media-kit-enums';
import { updateSocialHandle, type SocialHandle } from '@/lib/media-kit';

/** Parse a possibly-empty numeric field; blank → null, invalid → null. */
function toNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Edit an existing social handle (B2-032). Adding/removing handles stays with the
 * onboarding flow; here a creator corrects the handle string and the mock stats on
 * a row they already own. Owned-record UPDATE (social_handles_update_own).
 */
export function EditHandleSheet({
  visible,
  onClose,
  onSaved,
  handle,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  handle: SocialHandle | null;
}) {
  const [handleText, setHandleText] = useState('');
  const [followers, setFollowers] = useState('');
  const [engagement, setEngagement] = useState('');
  const [reach, setReach] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed local state when a new handle is passed in (sheet opened for a row).
  if (handle && seededFor !== handle.id) {
    setSeededFor(handle.id);
    setHandleText(handle.handle);
    setFollowers(handle.follower_count?.toString() ?? '');
    setEngagement(handle.engagement_rate?.toString() ?? '');
    setReach(handle.weekly_reach?.toString() ?? '');
    setError(null);
  }

  if (!handle) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await updateSocialHandle(handle.id, {
      handle: handleText,
      followerCount: toNum(followers),
      engagementRate: toNum(engagement),
      weeklyReach: toNum(reach),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.message);
  };

  return (
    <EditSheet
      visible={visible}
      onClose={onClose}
      title={`Edit ${platformLabel(handle.platform)}`}
      subtitle="Enter your latest numbers. Brands see these as indicative."
      footer={
        <Button
          action="primary"
          size="lg"
          className="w-full"
          isDisabled={saving || handleText.trim().length === 0}
          onPress={save}
        >
          {saving ? <ButtonSpinner /> : null}
          <ButtonText>Save</ButtonText>
        </Button>
      }
    >
      <TextField label="Handle" value={handleText} onChangeText={setHandleText} autoCapitalize="none" />
      <TextField
        label="Followers"
        value={followers}
        onChangeText={setFollowers}
        keyboardType="number-pad"
        placeholder="48200"
      />
      <TextField
        label="Engagement rate (%)"
        value={engagement}
        onChangeText={setEngagement}
        keyboardType="decimal-pad"
        placeholder="4.6"
      />
      <TextField
        label="Weekly reach"
        value={reach}
        onChangeText={setReach}
        keyboardType="number-pad"
        placeholder="96000"
      />
      {error ? <Text className="font-geist text-secondary text-status-critical">{error}</Text> : null}
    </EditSheet>
  );
}
