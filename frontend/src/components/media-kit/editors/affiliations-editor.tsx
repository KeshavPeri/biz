import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EditSheet } from '@/components/ui/edit-sheet';
import { TextField } from '@/components/ui/text-field';
import { AFFILIATION_TYPES, affiliationTypeLabel } from '@/lib/media-kit-enums';
import {
  deleteAffiliation,
  saveAffiliation,
  type Affiliation,
} from '@/lib/media-kit';

import TrashIcon from '@/assets/icons/trash.svg';

type Draft = { id?: string; type: string; name: string; year: string; description: string };

const EMPTY_DRAFT: Draft = { type: 'show', name: '', year: '', description: '' };

/**
 * Affiliations / credentials editor (B1-012 — deferred from Phase 7, built here).
 * CRUD over the affiliations table for the signed-in creator. Owned-record writes
 * under RLS; onChanged refetches after each mutation.
 */
export function AffiliationsEditor({
  visible,
  onClose,
  onChanged,
  creatorId,
  profileId,
  affiliations,
}: {
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  creatorId: string;
  profileId: string;
  affiliations: Affiliation[];
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearNum = draft.year.trim() ? Number(draft.year) : null;
  const canSave =
    draft.name.trim().length > 0 && (yearNum === null || Number.isFinite(yearNum));

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const res = await saveAffiliation(creatorId, profileId, {
      id: draft.id,
      type: draft.type,
      name: draft.name,
      year: yearNum,
      description: draft.description,
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setDraft(EMPTY_DRAFT);
    onChanged();
  };

  const remove = async (id: string) => {
    setError(null);
    const res = await deleteAffiliation(id, profileId);
    if (!res.ok) return setError(res.message);
    if (draft.id === id) setDraft(EMPTY_DRAFT);
    onChanged();
  };

  const confirmRemove = (a: Affiliation) => {
    Alert.alert('Remove this credential?', `"${a.name}" will be removed from your media kit.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void remove(a.id); } },
    ]);
  };

  return (
    <EditSheet
      visible={visible}
      onClose={onClose}
      title="Credentials"
      subtitle="Shows, awards, press and podcast features. Self-declared."
      footer={
        <Button action="primary" size="lg" className="w-full" onPress={onClose}>
          <ButtonText>Done</ButtonText>
        </Button>
      }
    >
      {affiliations.length > 0 ? (
        <View className="mb-4 rounded-card border border-hairline-card bg-surface-card p-2 shadow-l1">
          {affiliations.map((a, i) => (
            <View
              key={a.id}
              className={`flex-row items-center gap-2 px-2 py-2.5 ${
                i === 0 ? '' : 'border-t border-hairline'
              }`}
            >
              <Pressable
                className="flex-1"
                onPress={() =>
                  setDraft({
                    id: a.id,
                    type: a.type,
                    name: a.name,
                    year: a.year?.toString() ?? '',
                    description: a.description ?? '',
                  })
                }
              >
                <Text className="font-geist-medium text-body text-ink">{a.name}</Text>
                <Text className="mt-0.5 font-geist text-[11px] text-ink-3">
                  {affiliationTypeLabel(a.type)}
                  {a.year ? ` · ${a.year}` : ''}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => confirmRemove(a)}
                hitSlop={13}
                className="h-11 w-11 items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel={`Remove ${a.name}`}
              >
                <TrashIcon width={18} height={18} color="#847F78" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Text className="mb-2 font-geist-semibold text-body text-ink">
        {draft.id ? 'Edit credential' : 'Add a credential'}
      </Text>

      <View className="mb-4">
        <Text className="mb-[7px] font-geist-semibold text-secondary text-ink-2">Type</Text>
        <View className="flex-row flex-wrap gap-[9px]">
          {AFFILIATION_TYPES.map((t) => (
            <Chip
              key={t.value}
              label={t.label}
              selected={draft.type === t.value}
              onPress={() => setDraft((d) => ({ ...d, type: t.value }))}
            />
          ))}
        </View>
      </View>

      <TextField
        label="Name"
        value={draft.name}
        onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
        placeholder="e.g. Cosmopolitan India feature"
      />
      <TextField
        label="Year"
        labelHint="optional"
        value={draft.year}
        onChangeText={(v) => setDraft((d) => ({ ...d, year: v }))}
        keyboardType="number-pad"
        placeholder="2026"
      />
      <TextField
        label="Description"
        labelHint="optional"
        value={draft.description}
        onChangeText={(v) => setDraft((d) => ({ ...d, description: v }))}
        placeholder="A short line about it."
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
        <Button action="primary" size="md" className="flex-1" isDisabled={!canSave || busy} onPress={save}>
          {busy ? <ButtonSpinner /> : null}
          <ButtonText>{draft.id ? 'Save' : 'Add'}</ButtonText>
        </Button>
      </View>

      {error ? (
        <Text className="mt-3 font-geist text-secondary text-status-critical">{error}</Text>
      ) : null}
    </EditSheet>
  );
}
