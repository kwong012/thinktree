/** 语义缩放（LOD）：由画布 zoom 决定信息密度。 */

export const LOD = { FAR: 'far', MID: 'mid', NEAR: 'near' };

export function lodFor(zoom) {
  if (zoom < 0.16) return LOD.FAR;
  if (zoom < 0.8) return LOD.MID;
  return LOD.NEAR;
}

export const LOD_LABEL = {
  far: '远 · 只看结构',
  mid: '中 · 标题',
  near: '近 · 细节',
};
