/**
 * Views data hooks. Polls every 30s and on window focus — views are
 * agent-authored, so they update on a background timescale rather than
 * event-driven (no canvas WS signal). `useView(id)` fetches the detailed
 * manifest with inlined markdown sources.
 */

import { useEffect, useState, useCallback } from 'react';
import type { ViewManifest } from '../../shared/protocol.js';
import { listViews, getView as fetchView, RestError } from '../api/rest.js';

const POLL_MS = 30_000;

export interface ViewsStore {
  views: ViewManifest[];
  loading: boolean;
  refetch: () => void;
}

/** All view manifests (summaries, no inlined markdown). Polls every 30s and on
 *  window focus. */
export function useViews(): ViewsStore {
  const [views, setViews] = useState<ViewManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let disposed = false;

    const fetch = (): void => {
      listViews()
        .then((v) => {
          if (!disposed) {
            setViews(v);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!disposed) setLoading(false);
        });
    };

    fetch();

    const interval = setInterval(fetch, POLL_MS);

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') fetch();
    };
    const onFocus = (): void => fetch();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [nonce]);

  return { views, loading, refetch };
}

export interface ViewStore {
  view: ViewManifest | null;
  loading: boolean;
  error: string | null;
}

/** A single view with inlined markdown sources. Refetches when `id` changes. */
export function useView(id: string): ViewStore {
  const [view, setView] = useState<ViewManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setView(null);
      setLoading(false);
      return;
    }
    let disposed = false;
    setLoading(true);
    setError(null);
    fetchView(id)
      .then((v) => {
        if (!disposed) {
          setView(v);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const msg = err instanceof RestError ? err.message : String(err);
        setError(msg);
        setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [id]);

  return { view, loading, error };
}
