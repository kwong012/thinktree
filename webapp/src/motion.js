/**
 * motion.js — 动效基础：缓动、插值与一次性补间。
 *
 * 设计基调：一次性动作允许轻微过冲，连续/高频动作保持克制。
 * 所有时长集中在这里，避免散落魔数。
 */

export const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const MOTION = {
  micro: 180,
  fast: 220,
  panel: 340,
  camera: 380,
  cameraFar: 620,
  enter: 240,
  enterStagger: 22,
  countUp: 640,
  chart: 360,
};

export const lerp = (a, b, t) => a + (b - a) * t;

export const lerpLog = (a, b, t) => Math.exp(lerp(Math.log(a), Math.log(b), t));

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

export const easeOutBack = (s = 1.2) => (t) => {
  const c3 = s + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
};

/** requestAnimationFrame 补间；返回取消函数。 */
export function tween({ from = 0, to = 1, duration = 300, ease = easeOutQuint, onUpdate, onDone }) {
  if (REDUCED || !(duration > 0)) {
    onUpdate?.(to, 1);
    onDone?.();
    return () => {};
  }
  const t0 = performance.now();
  let raf = 0;
  let cancelled = false;
  const tick = (now) => {
    if (cancelled) return;
    const p = Math.min(1, (now - t0) / duration);
    onUpdate?.(lerp(from, to, ease(p)), p);
    if (p < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
      onDone?.();
    }
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}
