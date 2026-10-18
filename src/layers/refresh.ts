/** Independent layer lifetime: cancellation prevents late responses from changing a disabled layer. */
export function refreshLayer(interval: number, run: (signal: AbortSignal) => Promise<void>, fail: () => void) {
  let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, epoch = 0;
  function stop() { epoch++; clearTimeout(timer); controller?.abort(); }
  function start() {
    stop();
    const current = epoch;
    async function refresh() {
      controller = new AbortController();
      let failed = false;
      const signal = controller.signal;
      try { await run(signal); } catch { failed = true; if (!signal.aborted) fail(); }
      if (current === epoch) timer = setTimeout(refresh, failed ? Math.max(interval,60000) : interval);
    }
    void refresh();
  }
  return { start, stop };
}
