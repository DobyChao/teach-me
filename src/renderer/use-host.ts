import { useCallback, useEffect, useState } from 'react';
import type { Action, Snapshot } from '../shared/protocol.ts';
const bridge = window.companion;
export function useHost() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState('');
  const receive = useCallback(
    (next: Snapshot) => setState((old) => (!old || next.revision >= old.revision ? next : old)),
    [],
  );
  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.subscribe(receive);
    bridge
      .snapshot()
      .then(receive)
      .catch((e) => setFailure(e.message));
    return unsubscribe;
  }, [receive]);
  const perform = useCallback(
    async (action: Action) => {
      if (!bridge) throw new Error('请从桌面应用打开');
      try {
        const next = await bridge.perform(action);
        receive(next);
        setFailure('');
        return next;
      } catch (e) {
        setFailure((e as Error).message);
        throw e;
      }
    },
    [receive],
  );
  const act = useCallback(
    (a: Action) => {
      perform(a).catch(() => {});
    },
    [perform],
  );
  return { state, failure, perform, act };
}
