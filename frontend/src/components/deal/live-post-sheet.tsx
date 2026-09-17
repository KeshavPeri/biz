import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import type { CanonicalDeliverable } from '@/lib/deals';

type Result = { ok: true } | { ok: false; message: string };

export function LivePostSheet({
  deliverable,
  mode,
  onClose,
  onSubmit,
}: {
  deliverable: CanonicalDeliverable;
  mode: 'submit' | 'flag';
  onClose: () => void;
  onSubmit: (value: string) => Promise<Result>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue('');
    setBusy(false);
    setError(null);
  }, [deliverable.id, mode]);

  const trimmed = value.trim();
  const invalid = mode === 'flag'
    ? trimmed.length < 3 || trimmed.length > 500
    : trimmed.length < 1 || trimmed.length > 2048;

  const confirm = async () => {
    if (busy || invalid) return;
    setBusy(true);
    setError(null);
    const result = await onSubmit(trimmed);
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose();
  };

  const currentVersion = deliverable.post_state.current?.version ?? 0;
  return (
    <EditSheet
      visible
      onClose={() => { if (!busy) onClose(); }}
      title={mode === 'flag'
        ? `Flag ${deliverable.display_name}`
        : `${currentVersion ? 'Replace' : 'Submit'} live URL`}
      subtitle={mode === 'flag'
        ? `Explain the issue with the exact current proof (v${currentVersion}).`
        : `${deliverable.platform} · the server checks the public link and returns a safe text preview.`}
      footer={(
        <Button
          action="primary"
          size="lg"
          onPress={confirm}
          isDisabled={busy || invalid}
          accessibilityLabel={mode === 'flag' ? 'Flag this live post version' : 'Submit live post URL'}
        >
          {busy ? <ButtonSpinner /> : (
            <ButtonText>{mode === 'flag' ? 'Flag this version' : 'Verify and submit'}</ButtonText>
          )}
        </Button>
      )}
    >
      <View className="gap-3">
        {mode === 'submit' ? (
          <View className="rounded-xl bg-surface-recess px-3 py-3">
            <Text className="font-geist-semibold text-[12px] text-ink">Public link verification</Text>
            <Text className="mt-1 font-geist text-[11px] leading-[16px] text-ink-2">
              Inflo verifies the public HTTPS destination for this platform. It does not check authenticity or private content.
            </Text>
          </View>
        ) : null}
        <TextInput
          value={value}
          onChangeText={setValue}
          editable={!busy}
          multiline={mode === 'flag'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={mode === 'submit' ? 'url' : 'default'}
          maxLength={mode === 'flag' ? 500 : 2048}
          placeholder={mode === 'flag' ? 'Describe what is wrong with this link…' : 'https://…'}
          placeholderTextColor="#847F78"
          className={`rounded-xl border border-hairline bg-surface-card px-3 py-3 font-geist text-[13px] text-ink ${mode === 'flag' ? 'min-h-28' : ''}`}
        />
        <Text className="text-right font-geist text-[10.5px] text-ink-3">
          {value.length}/{mode === 'flag' ? 500 : 2048}
        </Text>
        {error ? <Text className="font-geist-medium text-[12px] text-status-critical">{error}</Text> : null}
      </View>
    </EditSheet>
  );
}
