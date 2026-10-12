import { create } from 'zustand';

// Holds only the in-memory session (D-25). Server data belongs in TanStack Query.
// status: 'idle'(아직 복원 시도 전) → 'restoring' → 'authenticated' | 'anonymous'
export const useSessionStore = create((set) => ({
  status: 'idle',
  accessToken: null,
  user: null,
  setSession: ({ accessToken, user }) => set({ accessToken, user, status: 'authenticated' }),
  setUser: (user) => set({ user }),
  markRestoring: () => set({ status: 'restoring' }),
  clearSession: () => set({ accessToken: null, user: null, status: 'anonymous' }),
}));
