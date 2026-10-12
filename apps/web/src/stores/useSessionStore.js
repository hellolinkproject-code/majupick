import { create } from 'zustand';

// Holds only the in-memory session (D-25). Server data belongs in TanStack Query.
export const useSessionStore = create((set) => ({
  accessToken: null,
  user: null,
  setSession: ({ accessToken, user }) => set({ accessToken, user }),
  clearSession: () => set({ accessToken: null, user: null }),
}));
