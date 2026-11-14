import { useEffect, useRef, useState } from 'react';
import type { Issue } from '@/lib/schedule/validate';

export interface LiveState { issues: Issue[]; checking: boolean; failed: boolean }
const IDLE: LiveState = { issues: [], checking: false, failed: false };

/**
 * Runs a schedule check shortly after the form stops changing, and re-runs it whenever `key` changes.
 * An older, slower answer can never overwrite a newer one. Failures are reported as `failed`, never thrown:
 * the preview is advice, and the check on Save remains the one that decides.
 */
export function useLiveIssues(run: () => Promise<Issue[]>, key: string, enabled: boolean, delayMs = 600): LiveState {
  const [state, setState] = useState<LiveState>(IDLE);
  const latest = useRef(run); latest.current = run;
  useEffect(() => {
    if (!enabled) { setState(IDLE); return; }
    let live = true;
    setState((s) => ({ ...s, checking: true }));
    const t = setTimeout(() => {
      latest.current().then((issues) => { if (live) setState({ issues, checking: false, failed: false }); })
        .catch(() => { if (live) setState({ issues: [], checking: false, failed: true }); });
    }, delayMs);
    return () => { live = false; clearTimeout(t); };
  }, [key, enabled, delayMs]);
  return state;
}
