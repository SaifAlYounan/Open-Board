import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'wouter';

export interface Person {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | 'observer' | 'management';
  title?: string | null;
  avatarColor?: string | null;
  mustResetPassword?: boolean;
  createdAt: string;
}

interface AuthContextType {
  user: Person | null;
  login: (token: string, user: Person) => void;
  logout: () => void;
  refresh: () => Promise<void>;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  login: () => {},
  logout: () => {},
  refresh: async () => {},
  isLoading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Person | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) throw new Error('Unauthorized');
      setUser((await res.json()) as Person);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, []);

  const login = (_token: string, newUser: Person) => {
    setUser(newUser);
  };

  const logout = () => {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refresh, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function getAvatarInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
