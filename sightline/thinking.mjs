/**
 * Soft verbal cues so FaceTime callers know Argo is still working
 * during Gemini vision delay.
 */

// One short cue only — repeats burn ElevenLabs TTS credits and interrupt answers.
const FILLERS = ['Looking.'];

/**
 * Speak a short filler immediately, then at most one more after `everyMs`.
 * Does not await playout — must not block the vision path.
 *
 * @param {{ say: (text: string, opts?: object) => unknown, interrupt?: Function }} session
 * @param {{ everyMs?: number }} [opts]
 * @returns {() => void}
 */
export function startThinkingFillers(session, opts = {}) {
  const everyMs = opts.everyMs ?? 7000;
  let index = 0;
  let stopped = false;

  const sayFiller = () => {
    if (stopped || !session || index >= 2) return;
    try {
      // Not interruptible: brief room noise was killing the cue and leaving dead air.
      session.say(FILLERS[index % FILLERS.length], { allowInterruptions: false });
      index += 1;
    } catch {
      /* call may have ended */
    }
  };

  sayFiller();
  const timer = setInterval(sayFiller, everyMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Run async work while thinking fillers play.
 * Stops fillers and force-interrupts queued filler speech before returning,
 * so the real answer is not cut off by another "Hmm".
 *
 * @template T
 * @param {{ say: Function, interrupt?: Function }} session
 * @param {() => Promise<T>} work
 * @param {{ everyMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function withThinking(session, work, opts) {
  const stop = startThinkingFillers(session, opts);
  try {
    return await work();
  } finally {
    stop();
    try {
      // Soft-clear fillers only — force:true was wiping the caller's in-flight turn
      // and leaving a long silence after overlaps.
      session.interrupt?.();
    } catch {
      /* ignore */
    }
  }
}
