import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LayoutAnimationConfig } from 'react-native-reanimated';

import { Button, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import { IconButton } from '@/components/ui/icon-button';
import { PressableScale } from '@/components/motion/pressable-scale';
import { ListItemFade } from '@/components/motion/list-item-fade';
import { Skeleton } from '@/components/motion/skeleton';
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedPaths = useRef(photoCarousel);

  // Re-sync from the (refetched) prop whenever the sheet opens or data changes.
  useEffect(() => {
    if (visible) {
      savedPaths.current = photoCarousel;
      setPaths(photoCarousel);
      setError(null);
    }
  }, [visible, photoCarousel]);

  const persist = async (next: string[]) => {
    if (busy) return false;
    setBusy(true);
    setPaths(next); // optimistic
    const res = await savePhotoCarousel(userId, next);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      setPaths(savedPaths.current); // revert to last known-good
      return false;
    }
    savedPaths.current = next;
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

    setUploading(true);
    setBusy(true);
    const up = await uploadProfilePhoto(userId, result.assets[0]);
    if (!up.ok) {
      setBusy(false);
      setUploading(false);
      setError(up.message);
      return;
    }
    setBusy(false);
    setUploading(false);
    await persist([...paths, up.path]);
  };

  const removeAt = async (i: number) => {
    if (busy) return;
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
    if (busy) return;
    const j = i + dir;
    if (j < 0 || j >= paths.length) return;
    const next = [...paths];
    [next[i], next[j]] = [next[j], next[i]];
    void Haptics.selectionAsync();
    await persist(next);
  };

  const setPrimary = async (i: number) => {
    if (busy) return;
    if (i === 0) return;
    const next = [...paths];
    const [chosen] = next.splice(i, 1);
    next.unshift(chosen);
    void Haptics.selectionAsync();
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
      {paths.length === 0 && !uploading ? (
        <Text className="mb-4 font-geist text-secondary text-ink-3">No photos yet.</Text>
      ) : (
        <LayoutAnimationConfig skipEntering>
          <View className="mb-4">
            {paths.map((path, i) => (
              <ListItemFade key={path}>
                <View className="mb-2.5 flex-row items-center gap-3 rounded-card border border-hairline-card bg-surface-card p-2.5 shadow-l1">
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
                      <PressableScale
                        onPress={() => setPrimary(i)}
                        disabled={busy}
                        haptic="selection"
                        hitSlop={12}
                      >
                        <Text className="font-geist-semibold text-[12px] text-ink">
                          Set as primary
                        </Text>
                      </PressableScale>
                    )}
                  </View>

                  <View className="flex-row items-center">
                    <IconButton
                      icon={ChevronUpIcon}
                      label="Move up"
                      onPress={() => void move(i, -1)}
                      disabled={busy || i === 0}
                    />
                    <IconButton
                      icon={ChevronDownIcon}
                      label="Move down"
                      onPress={() => void move(i, 1)}
                      disabled={busy || i === paths.length - 1}
                    />
                    <View className="ml-3">
                      <IconButton
                        icon={TrashIcon}
                        label="Remove photo"
                        onPress={() => confirmRemoveAt(i)}
                        disabled={busy}
                        color="#847F78"
                      />
                    </View>
                  </View>
                </View>
              </ListItemFade>
            ))}
            {uploading ? (
              <View className="mb-2.5 flex-row items-center gap-3 rounded-card border border-hairline-card bg-surface-card p-2.5">
                <Skeleton.Block width={56} height={64} radius="panel" />
                <View className="flex-1 gap-2">
                  <Skeleton.Block width="55%" height={14} radius="pill" />
                  <Skeleton.Block width="35%" height={12} radius="pill" />
                </View>
              </View>
            ) : null}
          </View>
        </LayoutAnimationConfig>
      )}

      <Button
        action="secondary"
        size="md"
        className="w-full"
        isDisabled={busy || uploading || paths.length >= MAX_PHOTOS}
        onPress={addPhoto}
      >
        <ButtonText>
          {uploading ? 'Uploading…' : paths.length >= MAX_PHOTOS ? 'Maximum 5 photos' : 'Add photo'}
        </ButtonText>
      </Button>

      {error ? (
        <Text className="mt-3 font-geist text-secondary text-status-critical">{error}</Text>
      ) : null}
    </EditSheet>
  );
}
