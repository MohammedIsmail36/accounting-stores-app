export interface RequestTimeout {
  signal: AbortSignal;
  didTimeout: () => boolean;
  clear: () => void;
}

/**
 * Creates an AbortSignal that fires after a bounded request window.
 * `didTimeout` distinguishes our timer from any other cancellation source.
 */
export function createRequestTimeout(timeoutMs: number): RequestTimeout {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("مهلة الطلب يجب أن تكون رقمًا موجبًا");
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    clear: () => globalThis.clearTimeout(timer),
  };
}
