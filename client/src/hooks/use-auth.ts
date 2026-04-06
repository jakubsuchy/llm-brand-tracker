import React, { createContext, useContext, ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

type AuthUser = { id: number; email: string; fullName: string; roles: string[]; apiKey?: string };
type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  googleEnabled: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (role: string) => boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['/api/auth/session'],
    queryFn: async () => {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
    staleTime: Infinity,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const res = await apiRequest('POST', '/api/auth/login', { email, password });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/auth/session'] }),
  });

  const logoutMutation = useMutation({
    mutationFn: async () => { await apiRequest('POST', '/api/auth/logout'); },
    onSuccess: () => { queryClient.clear(); window.location.href = '/login'; },
  });

  const user = data?.user || null;
  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    googleEnabled: data?.googleEnabled || false,
    login: async (email, password) => { await loginMutation.mutateAsync({ email, password }); },
    logout: async () => { await logoutMutation.mutateAsync(); },
    hasRole: (role) => user?.roles?.includes(role) || false,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
