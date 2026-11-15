/**
 * Soft verbal cues so FaceTime callers know Argo is still working
 * during Gemini vision delay.
 */

const FILLERS = ['Looking.'];

/**
 * Run async work; only say "Looking." if it takes longer than `delayMs`.
 * That keeps fast OCR replies from waiting behind a filler TTS clip.
 * Filler is interruptible so the real answer can cut in immediately.
 *
 * @template T
 * @param {{ say: Function, interrupt?: Function }} session
 * @param {() => Promise<T>} work
 * @param {{ delayMs?: number, everyMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function withThinking(session, work, opts = {}) {
  // Prefer delayMs; everyMs kept as alias for older call sites.
  const delayMs = opts.delayMs ?? opts.everyMs ?? 700;
  let stopped = false;
  let spoke = false;

  const timer = setTimeout(() => {
    if (stopped || !session) return;
    try {
      session.say(FILLERS[0], { allowInterruptions: true });
      spoke = true;
    } catch {
      /* call may have ended */
    }
  }, delayMs);

  try {
    return await work();
  } finally {
    stopped = true;
    clearTimeout(timer);
    if (spoke) {
      try {
        session.interrupt?.();
      } catch {
        /* ignore */
      }
    }
  }
}
