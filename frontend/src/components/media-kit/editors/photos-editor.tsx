import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { Button, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import { StorageImage } from '@/components/media-kit/storage-image';
import {
  MAX_PHOTOS,
  removeProfilePhoto,
  savePhotoCarousel,
  uploadProfilePhoto,
} from '@/lib/media-kit';

import TrashIcon from '@/assets/icons/trash.svg';
import StarIcon from '@/assets/icons/star.svg';
import ChevronUpIcon from '@/assets/icons/chevron-up.svg';
import ChevronDownIcon from '@/assets/icons/chevron-down.svg';

/**
 * Photos editor (B2-031). Add (pick → upload to the caller's own folder → append),
 * remove (also deletes the storage object), and reorder (set-primary / move) up to
 * MAX_PHOTOS. Photo order IS display order; index 0 is the primary → the app-wide
 * avatar. Persists the whole ordered path array via savePhotoCarousel after each
 * change, then onChanged refetches.
 */
export function PhotosEditor({
  visible,
  onClose,
  onChanged,
  userId,
  photoCarousel,
}: {
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  userId: string;
  photoCarousel: string[];
}) {
  const [paths, setPaths] = useState<string[]>(photoCarousel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync from the (refetched) prop whenever the sheet opens or data changes.
  useEffect(() => {
    if (visible) setPaths(photoCarousel);
  }, [visible, photoCarousel]);

  const persist = async (next: string[]) => {
    setPaths(next); // optimistic
    const res = await savePhotoCarousel(userId, next);
    if (!res.ok) {
      setError(res.message);
      setPaths(photoCarousel); // revert to last known-good
      return false;
    }
    onChanged();
    return true;
  };

  const addPhoto = async () => {
    setError(null);
    if (paths.length >= MAX_PHOTOS) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo access is needed to add a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [4, 5],
    });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    const up = await uploadProfilePhoto(userId, result.assets[0]);
    if (!up.ok) {
      setBusy(false);
      setError(up.message);
      return;
    }
    await persist([...paths, up.path]);
    setBusy(false);
  };

  const removeAt = async (i: number) => {
    setError(null);
    const path = paths[i];
    const next = paths.filter((_, idx) => idx !== i);
    const ok = await persist(next);
    if (ok) void removeProfilePhoto(path); // best-effort object cleanup after the DB is updated
  };

  const confirmRemoveAt = (i: number) => {
    Alert.alert('Remove this photo?', 'It will be deleted from your media kit.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void removeAt(i); } },
    ]);
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= paths.length) return;
    const next = [...paths];
    [next[i], next[j]] = [next[j], next[i]];
    await persist(next);
  };

  const setPrimary = async (i: number) => {
    if (i === 0) return;
    const next = [...paths];
    const [chosen] = next.splice(i, 1);
    next.unshift(chosen);
    await persist(next);
  };

  return (
    <EditSheet
      visible={visible}
      onClose={onClose}
      title="Photos"
      subtitle={`Up to ${MAX_PHOTOS}. The first photo is your primary — it's your avatar across Inflo.`}
      footer={
        <Button action="primary" size="lg" className="w-full" onPress={onClose}>
          <ButtonText>Done</ButtonText>
        </Button>
      }
    >
      {paths.length === 0 ? (
        <Text className="mb-4 font-geist text-secondary text-ink-3">No photos yet.</Text>
      ) : (
        <View className="mb-4">
          {paths.map((path, i) => (
            <View
              key={path}
              className="mb-2.5 flex-row items-center gap-3 rounded-card border border-hairline-card bg-surface-card p-2.5 shadow-l1"
            >
              <StorageImage path={path} className="h-16 w-14 rounded-panel" />
              <View className="flex-1">
                {i === 0 ? (
                  <View className="flex-row items-center gap-1.5">
                    <StarIcon width={13} height={13} color="#4F7A1E" />
                    <Text className="font-geist-semibold text-[12px] text-status-good-label">
                      Primary · avatar
                    </Text>
                  </View>
                ) : (
                  <Pressable onPress={() => setPrimary(i)} accessibilityRole="button">
                    <Text className="font-geist-semibold text-[12px] text-ink">
                      Set as primary
                    </Text>
                  </Pressable>
                )}
              </View>

              <View className="flex-row items-center">
                <Pressable
                  onPress={() => move(i, -1)}
                  disabled={i === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Move up"
                  className={`h-11 w-11 items-center justify-center ${i === 0 ? 'opacity-30' : ''}`}
                >
                  <ChevronUpIcon width={20} height={20} color="#5E574E" />
                </Pressable>
                <Pressable
                  onPress={() => move(i, 1)}
                  disabled={i === paths.length - 1}
                  accessibilityRole="button"
                  accessibilityLabel="Move down"
                  className={`h-11 w-11 items-center justify-center ${i === paths.length - 1 ? 'opacity-30' : ''}`}
                >
                  <ChevronDownIcon width={20} height={20} color="#5E574E" />
                </Pressable>
                <Pressable
                  onPress={() => confirmRemoveAt(i)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  className="ml-3 h-11 w-11 items-center justify-center"
                >
                  <TrashIcon width={18} height={18} color="#847F78" />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <Button
        action="secondary"
        size="md"
        className="w-full"
        isDisabled={busy || paths.length >= MAX_PHOTOS}
        onPress={addPhoto}
      >
        <ButtonText>
          {busy ? 'Uploading…' : paths.length >= MAX_PHOTOS ? 'Maximum 5 photos' : 'Add photo'}
        </ButtonText>
      </Button>

      {error ? (
        <Text className="mt-3 font-geist text-secondary text-status-critical">{error}</Text>
      ) : null}
    </EditSheet>
  );
}
