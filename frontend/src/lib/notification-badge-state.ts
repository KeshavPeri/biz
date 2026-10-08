import { create } from 'zustand';

type BadgeState = {
  ownerId: string | null;
  count: number | null;
  set: (ownerId: string, count: number | null) => void;
  clear: () => void;
};
export const useNotificationBadgeState = create<BadgeState>((set) => ({
  ownerId: null, count: null,
  set: (ownerId, count) => set({ ownerId, count }),
  clear: () => set({ ownerId: null, count: null }),
}));
