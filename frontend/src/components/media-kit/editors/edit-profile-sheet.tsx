import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EditSheet } from '@/components/ui/edit-sheet';
import { TextField } from '@/components/ui/text-field';
import {
  updateBrandProfile,
  updateCreatorProfile,
  type BrandProfile,
  type CreatorMediaKit,
} from '@/lib/media-kit';

const MAX_NICHES = 3;
const NICHES = [
  'Fashion', 'Beauty', 'Fitness', 'Food', 'Tech', 'Travel',
  'Finance', 'Gaming', 'Parenting', 'Comedy', 'Education', 'Lifestyle',
];
const LANGS = ['Hindi', 'English', 'Tamil', 'Telugu', 'Kannada', 'Marathi', 'Bengali'];

/**
 * Edit profile (B2-036). One sheet, two branches: a creator edits identity +
 * creator_profiles; a brand edits its brands row. Both are owned-record UPDATEs
 * (Supabase-direct, RLS). On success the parent refetches and closes.
 */
export function EditProfileSheet({
  visible,
  onClose,
  onSaved,
  data,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  data: CreatorMediaKit | BrandProfile;
}) {
  if (data.kind === 'brand') {
    return <BrandForm visible={visible} onClose={onClose} onSaved={onSaved} data={data} />;
  }
  return <CreatorForm visible={visible} onClose={onClose} onSaved={onSaved} data={data} />;
}

function CreatorForm({
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
  const [displayName, setDisplayName] = useState(data.displayName);
  const [city, setCity] = useState(data.city ?? '');
  const [bio, setBio] = useState(data.bio ?? '');
  const [contentCategory, setContentCategory] = useState(data.contentCategory ?? '');
  const [niches, setNiches] = useState<string[]>(data.niches);
  const [languages, setLanguages] = useState<string[]>(data.contentLanguages);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Case-insensitive so re-picking a seeded niche (stored lowercase) replaces it
  // rather than adding a duplicate-with-different-casing.
  const toggle = (list: string[], set: (v: string[]) => void, value: string, max?: number) => {
    const match = list.find((v) => v.toLowerCase() === value.toLowerCase());
    if (match) return set(list.filter((v) => v !== match));
    if (max !== undefined && list.length >= max) return;
    set([...list, value]);
  };

  const canSave = displayName.trim().length > 0 && niches.length > 0 && languages.length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await updateCreatorProfile(data.profileId, {
      displayName,
      city,
      bio,
      niches,
      contentLanguages: languages,
      contentCategory,
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.message);
  };

  return (
    <EditSheet
      visible={visible}
      onClose={onClose}
      title="Edit profile"
      subtitle="This is what brands filter and land on."
      footer={
        <Button action="primary" size="xl" className="w-full" isDisabled={!canSave || saving} onPress={save}>
          {saving ? <ButtonSpinner color="#FBFAF6" /> : null}
          <ButtonText>Save</ButtonText>
        </Button>
      }
    >
      <TextField label="Display name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
      <TextField label="City" value={city} onChangeText={setCity} autoCapitalize="words" />
      <TextField
        label="Content category"
        labelHint="one line"
        value={contentCategory}
        onChangeText={setContentCategory}
        placeholder="e.g. Skincare & beauty"
      />

      <ChipGroup
        label="Niches"
        hint={`pick up to ${MAX_NICHES}`}
        options={NICHES}
        selected={niches}
        onToggle={(v) => toggle(niches, setNiches, v, MAX_NICHES)}
      />
      <ChipGroup
        label="Content languages"
        options={LANGS}
        selected={languages}
        onToggle={(v) => toggle(languages, setLanguages, v)}
      />

      <TextField
        label="Bio"
        labelHint={`${bio.length} / 160`}
        value={bio}
        onChangeText={(v) => setBio(v.slice(0, 160))}
        placeholder="Honest skincare, real routines."
        multiline
        maxLength={160}
      />

      {error ? <Text className="font-geist text-secondary text-status-critical">{error}</Text> : null}
    </EditSheet>
  );
}

function BrandForm({
  visible,
  onClose,
  onSaved,
  data,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  data: BrandProfile;
}) {
  const [companyName, setCompanyName] = useState(data.companyName);
  const [industry, setIndustry] = useState(data.industry ?? '');
  const [domain, setDomain] = useState(data.domain ?? '');
  const [hqCity, setHqCity] = useState(
    typeof data.profileAttributes?.hq_city === 'string' ? (data.profileAttributes.hq_city as string) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = companyName.trim().length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    // Preserve any existing attributes; only overwrite the one field we expose.
    const profileAttributes = { ...(data.profileAttributes ?? {}), hq_city: hqCity.trim() || null };
    const res = await updateBrandProfile(data.brandId, data.brandId, {
      companyName,
      industry,
      domain,
      profileAttributes,
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setError(res.message);
  };

  return (
    <EditSheet
      visible={visible}
      onClose={onClose}
      title="Edit brand profile"
      subtitle="How creators see your company in Discovery."
      footer={
        <Button action="primary" size="xl" className="w-full" isDisabled={!canSave || saving} onPress={save}>
          {saving ? <ButtonSpinner color="#FBFAF6" /> : null}
          <ButtonText>Save</ButtonText>
        </Button>
      }
    >
      <TextField label="Company name" value={companyName} onChangeText={setCompanyName} autoCapitalize="words" />
      <TextField label="Industry" value={industry} onChangeText={setIndustry} placeholder="e.g. Beauty & Personal Care" />
      <TextField
        label="Website"
        value={domain}
        onChangeText={setDomain}
        placeholder="brand.in"
        autoCapitalize="none"
        keyboardType="url"
      />
      <TextField label="HQ city" value={hqCity} onChangeText={setHqCity} autoCapitalize="words" />
      {error ? <Text className="font-geist text-secondary text-status-critical">{error}</Text> : null}
    </EditSheet>
  );
}

function ChipGroup({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  label: string;
  hint?: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <View className="mb-4">
      <View className="mb-[7px] flex-row items-center justify-between">
        <Text className="font-geist-semibold text-secondary text-ink-2">{label}</Text>
        {hint ? <Text className="font-geist text-secondary text-ink-3">{hint}</Text> : null}
      </View>
      <View className="flex-row flex-wrap gap-[9px]">
        {options.map((opt) => (
          <Chip
            key={opt}
            label={opt}
            selected={selected.some((s) => s.toLowerCase() === opt.toLowerCase())}
            onPress={() => onToggle(opt)}
          />
        ))}
      </View>
    </View>
  );
}
