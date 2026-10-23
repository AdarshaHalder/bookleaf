import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler, tokenStore } from "../api/client";
import type { User } from "../api/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    api<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>("/auth/login", { method: "POST", json: { email, password } });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// -------------------------------------------------------------------------------------------
// Real-time: one EventSource per logged-in tab, fanned out to any component that subscribes.

export interface TicketEvent {
  type: "ticket.created" | "ticket.updated" | "ticket.message" | "ticket.note";
  ticketId: number;
}
type Listener = (e: TicketEvent) => void;

interface LiveState {
  connected: boolean;
  subscribe: (fn: Listener) => () => void;
}

const LiveContext = createContext<LiveState>({ connected: false, subscribe: () => () => {} });

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = tokenStore.get();
    if (!user || !token) return;
    // EventSource can't send headers, so the token goes in the query string (server allows
    // this only on the stream endpoint). The browser reconnects automatically on drops.
    const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    source.addEventListener("ready", () => setConnected(true));
    source.addEventListener("ticket", (msg) => {
      const event = JSON.parse((msg as MessageEvent).data) as TicketEvent;
      listeners.current.forEach((fn) => fn(event));
    });
    source.onerror = () => setConnected(false);
    return () => {
      source.close();
      setConnected(false);
    };
  }, [user]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  return <LiveContext.Provider value={{ connected, subscribe }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
