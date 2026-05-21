"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { SessionProvider, useSession, signOut as nextAuthSignOut } from "next-auth/react";
import { getProfile } from "@/app/actions/auth";
import { Profile } from "@/types";

interface AuthContextValue {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthContextInternalProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (status !== "authenticated" || !session?.user?.id) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    try {
      const res = await getProfile();
      if (res.success && res.data) {
        setProfile({
          id: res.data.id,
          user_id: res.data.user_id,
          full_name: res.data.full_name,
          email: res.data.email,
          avatar_url: res.data.avatar_url,
          role: res.data.role,
          created_at: res.data.created_at,
        });
      }
    } catch (err) {
      console.error("[AuthProvider] fetchProfile error:", err);
    } finally {
      setProfileLoading(false);
    }
  }, [session?.user?.id, status]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    await nextAuthSignOut({ redirect: false });
    window.location.href = "/login";
  }, []);

  const refreshProfile = useCallback(async () => {
    await fetchProfile();
  }, [fetchProfile]);

  const user = session?.user
    ? {
        id: session.user.id,
        email: session.user.email,
      }
    : null;

  // loading is true when next-auth session is loading, OR when session exists but we haven't loaded profile yet.
  const loading = status === "loading" || (status === "authenticated" && !profile && profileLoading);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AuthContextInternalProvider>{children}</AuthContextInternalProvider>
    </SessionProvider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      profile: null,
      loading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
    };
  }
  return ctx;
}
