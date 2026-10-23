import { useCallback, useEffect, useRef, useState } from "react";

/** Loads data on mount / when deps change, with a `reload` for live refreshes (no spinner flash). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const run = useCallback(
    async (silent: boolean) => {
      const id = ++latest.current;
      if (!silent) setLoading(true);
      try {
        const result = await fn();
        if (id === latest.current) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (id === latest.current) setError(e as Error);
      } finally {
        if (id === latest.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    void run(false);
  }, [run]);

  return { data, error, loading, reload: () => run(true), setData };
}
