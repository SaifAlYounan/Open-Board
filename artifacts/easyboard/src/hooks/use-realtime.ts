import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";

/**
 * Real-time cache invalidation over Socket.IO.
 *
 * The server emits coarse `invalidate` events — { resource, boardId, id } —
 * whenever governance data changes (votes, tasks, documents, meetings, minutes,
 * pending actions). This hook maps each event to the react-query caches whose
 * keys start with the matching `/api/...` path (the orval-generated hooks use
 * the request path as the first key element) and invalidates them, so every
 * page refetches through the normal, access-controlled REST endpoints.
 *
 * Pure enhancement: the app works identically with sockets unavailable —
 * queries still refetch on mount/staleTime, and socket.io's built-in
 * reconnect/backoff handles network hiccups. Errors are deliberately ignored.
 */

/** Which query-key path prefixes each server-side resource invalidates. */
export const RESOURCE_PREFIXES: Record<string, string[]> = {
  votes: ["/api/votes", "/api/dashboard"],
  tasks: ["/api/tasks", "/api/dashboard"],
  documents: ["/api/documents", "/api/dashboard"],
  meetings: ["/api/meetings", "/api/dashboard"],
  minutes: ["/api/minutes", "/api/dashboard"],
  pendingActions: ["/api/pending-actions", "/api/dashboard"],
  boards: ["/api/boards"],
  people: ["/api/people"],
};

/** Exported for unit testing — the hook itself is a thin effect around this. */
export function invalidateForEvent(queryClient: QueryClient, resource: string): void {
  const prefixes = RESOURCE_PREFIXES[resource];
  if (!prefixes) return;
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return typeof head === "string" && prefixes.some((p) => head.startsWith(p));
    },
  });
}

export function useRealtime(): void {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    let socket: Socket | undefined;
    try {
      // Same-origin connection; the JWT cookie rides along on the handshake.
      // Dev: Vite proxies /socket.io to the API (ws: true). Prod: same origin.
      socket = io({ withCredentials: true });
      socket.on("invalidate", (event: { resource?: string }) => {
        if (event?.resource) invalidateForEvent(queryClient, event.resource);
      });
      // Sockets are an enhancement — never surface connection errors to the UI.
      socket.on("connect_error", () => {});
    } catch {
      // socket.io unavailable — polling/staleTime behavior continues unchanged.
    }

    return () => {
      socket?.disconnect();
    };
  }, [userId, queryClient]);
}
