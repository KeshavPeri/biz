import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { CreativeBriefContent, CreativeBriefState, CreativeBriefVersion } from '@/lib/deals';

const EMPTY_CONTENT: CreativeBriefContent = {
  objective: '',
  guidelines: '',
  dos: [],
  donts: [],
  hashtags: [],
  caption_guidance: '',
};

export function CreativeBriefCard({
  state,
  acting,
  error,
  onCreateVersion,
  onAcknowledge,
}: {
  state: CreativeBriefState;
  acting: boolean;
  error: string | null;
  onCreateVersion: (expectedVersion: number, content: CreativeBriefContent) => void;
  onAcknowledge: (briefId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(state.latest?.id ?? null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setSelectedId(state.latest?.id ?? null);
    setEditing(false);
  }, [state.latest?.id]);

  const selected = state.history.find((brief) => brief.id === selectedId) ?? state.latest;

  return (
    <View className="gap-3 rounded-2xl border border-hairline bg-surface-card p-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-[14px] text-ink">Campaign brief</Text>
          <Text className="mt-0.5 font-geist text-[11px] text-ink-3">
            {state.latest
              ? `Latest v${state.latest.version} · ${state.latest.acknowledged_by_creator ? 'acknowledged' : 'awaiting creator acknowledgement'}`
              : 'No brief has been shared yet'}
          </Text>
        </View>
        {state.latest ? (
          <Text className="font-geist-semibold text-[11px] text-ink-2">v{state.latest.version}</Text>
        ) : null}
      </View>

      {state.history.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {state.history.map((brief) => (
            <Pressable
              key={brief.id}
              accessibilityRole="button"
              accessibilityLabel={`View brief version ${brief.version}`}
              onPress={() => setSelectedId(brief.id)}
              className={`rounded-full border px-3 py-1.5 ${selected?.id === brief.id ? 'border-ink bg-ink' : 'border-hairline bg-app'}`}
            >
              <Text className={`font-geist-semibold text-[11px] ${selected?.id === brief.id ? 'text-white' : 'text-ink-2'}`}>
                v{brief.version}{brief.id === state.latest?.id ? ' · latest' : ''}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {selected ? <BriefVersionView brief={selected} latest={selected.id === state.latest?.id} /> : (
        <View className="rounded-xl bg-surface-recess px-3 py-3">
          <Text className="font-geist text-[12px] leading-[17px] text-ink-3">
            The brand can share the structured objective and creative guidance here.
          </Text>
        </View>
      )}

      {editing ? (
        <BriefEditor
          initial={state.latest?.content ?? EMPTY_CONTENT}
          expectedVersion={state.latest?.version ?? 0}
          acting={acting}
          onCancel={() => setEditing(false)}
          onSubmit={onCreateVersion}
        />
      ) : state.allowed_actions.can_create_version ? (
        <ActionButton
          label={state.latest ? 'Create new version' : 'Share brief'}
          disabled={acting}
          onPress={() => setEditing(true)}
        />
      ) : null}

      {state.allowed_actions.can_acknowledge_latest && state.latest ? (
        <ActionButton
          label={acting ? 'Acknowledging…' : `Acknowledge v${state.latest.version}`}
          disabled={acting}
          onPress={() => onAcknowledge(state.latest!.id)}
        />
      ) : null}

      {error ? <Text className="font-geist text-[12px] text-status-critical">{error}</Text> : null}
    </View>
  );
}

function BriefVersionView({ brief, latest }: { brief: CreativeBriefVersion; latest: boolean }) {
  return (
    <View className="gap-3 rounded-xl bg-surface-recess p-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-[11.5px] text-ink">
            Shared by {brief.created_by_display_name}
          </Text>
          <Text className="font-geist text-[10px] text-ink-3">
            v{brief.version} · {formatDate(brief.created_at)}{latest ? ' · latest' : ' · history'}
          </Text>
        </View>
        <Text className={`font-geist-semibold text-[10.5px] ${brief.acknowledged_by_creator ? 'text-status-good-label' : 'text-ink-3'}`}>
          {brief.acknowledged_by_creator ? 'Acknowledged' : 'Unacknowledged'}
        </Text>
      </View>
      <BriefField label="Objective" value={brief.content.objective} />
      <BriefField label="Guidance" value={brief.content.guidelines} />
      <BriefField label="Must include" value={brief.content.dos.join(' · ')} />
      <BriefField label="Must avoid" value={brief.content.donts.join(' · ')} />
      <BriefField label="Hashtags" value={brief.content.hashtags.join(' · ')} />
      <BriefField label="Caption guidance" value={brief.content.caption_guidance} />
    </View>
  );
}

function BriefField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View className="border-t border-hairline pt-2">
      <Text className="font-geist-semibold text-[10.5px] uppercase tracking-wide text-ink-3">{label}</Text>
      <Text selectable className="mt-0.5 font-geist text-[12px] leading-[17px] text-ink-2">{value}</Text>
    </View>
  );
}

function BriefEditor({
  initial,
  expectedVersion,
  acting,
  onCancel,
  onSubmit,
}: {
  initial: CreativeBriefContent;
  expectedVersion: number;
  acting: boolean;
  onCancel: () => void;
  onSubmit: (expectedVersion: number, content: CreativeBriefContent) => void;
}) {
  const [objective, setObjective] = useState(initial.objective);
  const [guidelines, setGuidelines] = useState(initial.guidelines);
  const [dos, setDos] = useState(initial.dos.join('\n'));
  const [donts, setDonts] = useState(initial.donts.join('\n'));
  const [hashtags, setHashtags] = useState(initial.hashtags.join('\n'));
  const [captionGuidance, setCaptionGuidance] = useState(initial.caption_guidance);
  const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
  const content = {
    objective: objective.trim(),
    guidelines: guidelines.trim(),
    dos: lines(dos),
    donts: lines(donts),
    hashtags: lines(hashtags),
    caption_guidance: captionGuidance.trim(),
  };
  const invalid = !content.objective
    || content.dos.length > 20
    || content.donts.length > 20
    || content.hashtags.length > 20
    || content.dos.some((item) => item.length > 200)
    || content.donts.some((item) => item.length > 200)
    || content.hashtags.some((item) => item.length > 100);

  return (
    <View className="gap-2 rounded-xl border border-hairline bg-app p-3">
      <Text className="font-geist-semibold text-[12px] text-ink">
        {expectedVersion === 0 ? 'Share brief' : `Create v${expectedVersion + 1} from v${expectedVersion}`}
      </Text>
      <EditorField label="Objective *" value={objective} onChangeText={setObjective} maxLength={500} />
      <EditorField label="Guidance" value={guidelines} onChangeText={setGuidelines} maxLength={2000} multiline />
      <EditorField label="Must include · one per line" value={dos} onChangeText={setDos} maxLength={4019} multiline />
      <EditorField label="Must avoid · one per line" value={donts} onChangeText={setDonts} maxLength={4019} multiline />
      <EditorField label="Hashtags · one per line" value={hashtags} onChangeText={setHashtags} maxLength={2019} multiline />
      <EditorField label="Caption guidance" value={captionGuidance} onChangeText={setCaptionGuidance} maxLength={2000} multiline />
      <View className="flex-row gap-2">
        <SecondaryButton label="Cancel" disabled={acting} onPress={onCancel} />
        <ActionButton
          label={acting ? 'Saving…' : expectedVersion === 0 ? 'Share v1' : `Save v${expectedVersion + 1}`}
          disabled={acting || invalid}
          onPress={() => onSubmit(expectedVersion, content)}
        />
      </View>
    </View>
  );
}

function EditorField({
  label,
  value,
  onChangeText,
  maxLength,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  maxLength: number;
  multiline?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text className="font-geist-medium text-[10.5px] text-ink-3">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        multiline={multiline}
        placeholderTextColor="#847F78"
        className={`rounded-xl border border-hairline bg-surface-card px-3 py-2 font-geist text-[12px] text-ink ${multiline ? 'min-h-[58px]' : ''}`}
      />
    </View>
  );
}

function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`flex-1 items-center rounded-full bg-ink px-3 py-2.5 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="font-geist-semibold text-[12px] text-white">{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`flex-1 items-center rounded-full border border-hairline bg-app px-3 py-2.5 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="font-geist-semibold text-[12px] text-ink-2">{label}</Text>
    </Pressable>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
}
