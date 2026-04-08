"use client";
import { useState, useEffect, useCallback } from "react";

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      // Keep previous data on error so UI doesn't blank out,
      // but callers can check `error` to show error state
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

/**
 * Reusable error banner component for use in pages that use useApi.
 * Usage: {error && <ApiErrorBanner error={error} onRetry={reload} />}
 */
export function ApiErrorBanner({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-red-700">
        <span className="flex-shrink-0">&#x26A0;</span>
        <span>{error}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-4 px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 transition-colors flex-shrink-0"
        >
          Retry
        </button>
      )}
    </div>
  );
}
