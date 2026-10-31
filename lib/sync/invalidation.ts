/** Shared notification policy. Delivery and role filtering belong to the transport; the outbox supplies own-id knowledge. */
export function createInvalidationScheduler(refresh: () => void, isOwn?: (id: string) => boolean, chairWindowMs = 0) {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let chairWindow: ReturnType<typeof setTimeout> | undefined;
  let foreign = false, disposed = false;
  const fire = () => { const go = foreign; foreign = false; if (go && !disposed) refresh(); };
  return {
    notify(topic?: string, mutationId?: unknown) {
      if (disposed) return;
      if (typeof mutationId !== 'string' || !isOwn?.(mutationId)) foreign = true;
      if (chairWindowMs > 0 && topic === 'chair') {
        if (debounce !== undefined || chairWindow !== undefined) return;
        chairWindow = setTimeout(() => { chairWindow = undefined; fire(); }, chairWindowMs);
      } else {
        clearTimeout(chairWindow); chairWindow = undefined;
        clearTimeout(debounce);
        debounce = setTimeout(() => { debounce = undefined; fire(); }, 350);
      }
    },
    dispose() { disposed = true; clearTimeout(debounce); clearTimeout(chairWindow); foreign = false; },
  };
}
