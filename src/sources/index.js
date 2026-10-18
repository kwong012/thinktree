/**
 * 源注册表（可插拔）
 * ------------------
 * 新增一个 agent = 在 sources/ 下加一个文件并在这里登记，不动 UI / server。
 */
import { createOpencodeSource } from './opencode.js';

export function createSources() {
  const factories = [
    () => createOpencodeSource(),
    // 后续：pi / cline / kimi / zcode / codex
  ];

  const sources = [];
  for (const make of factories) {
    try {
      sources.push(make());
    } catch (err) {
      console.warn('[sources] 跳过不可用源:', err?.message || err);
    }
  }
  return sources;
}
