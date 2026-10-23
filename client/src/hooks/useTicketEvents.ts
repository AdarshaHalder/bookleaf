import { useEffect, useRef } from "react";
import { useLive, type TicketEvent } from "../auth/AuthContext";

/**
 * Calls `onEvent` for every live ticket event (optionally only for one ticket). Also refires
 * when the tab becomes visible again, as a safety net for events missed while asleep.
 */
export function useTicketEvents(onEvent: (e: TicketEvent | null) => void, ticketId?: number) {
  const { subscribe } = useLive();
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const unsubscribe = subscribe((e) => {
      if (ticketId === undefined || e.ticketId === ticketId) handler.current(e);
    });
    const onVisible = () => document.visibilityState === "visible" && handler.current(null);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [subscribe, ticketId]);
}
