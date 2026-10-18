import { createContext } from 'react';

/** 当前画布的 LOD 档位（far | mid | near）。 */
export const LodCtx = createContext('mid');

/** 当前界面语言（zh | en）。 */
export const LangCtx = createContext('zh');

/** 当前被点击展开的节点 id（null = 无）。 */
export const ExpandCtx = createContext(null);
