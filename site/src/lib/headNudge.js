// A short shake on the phone head, as a quiet call to action.
// First shake about 8s after load, then about every 30s, and never more than 4
// on one page view. Hidden tabs pause the wait. The first tap cancels it.
export const HEAD_NUDGE = {
  firstMs: 8000,
  everyMs: 30000,
  shakeMs: 600,
  maxShakes: 4,
};

export function createHeadNudge({
  reducedMotion = false,
  initiallyHidden = false,
  now,
  schedule,
  cancel,
  onShake,
  firstMs = HEAD_NUDGE.firstMs,
  everyMs = HEAD_NUDGE.everyMs,
  maxShakes = HEAD_NUDGE.maxShakes,
}) {
  let hidden = !!initiallyHidden;
  let started = false;
  let stopped = false;
  let count = 0;
  let timer = null;
  let due = null;
  let remaining = null;

  function clearTimer() {
    if (timer != null) cancel(timer);
    timer = null;
    due = null;
  }

  function arm(delay) {
    clearTimer();
    if (stopped || reducedMotion || count >= maxShakes) return;
    const wait = Math.max(0, delay);
    due = now() + wait;
    timer = schedule(() => {
      timer = null;
      due = null;
      if (stopped || reducedMotion || count >= maxShakes) return;
      if (hidden) {
        remaining = 0;
        return;
      }
      count += 1;
      onShake();
      if (count < maxShakes) arm(everyMs);
    }, wait);
  }

  return {
    start() {
      if (started || stopped || reducedMotion) return;
      started = true;
      if (hidden) remaining = firstMs;
      else arm(firstMs);
    },
    stop() {
      stopped = true;
      remaining = null;
      clearTimer();
    },
    setHidden(next) {
      const isHidden = !!next;
      if (isHidden === hidden) return;
      hidden = isHidden;
      if (!started || stopped || reducedMotion) return;
      if (hidden) {
        if (due != null) remaining = Math.max(0, due - now());
        clearTimer();
        return;
      }
      if (remaining != null && count < maxShakes) {
        const wait = remaining;
        remaining = null;
        arm(wait);
      }
    },
    count() {
      return count;
    },
  };
}
