import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import {
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { REDUCED } from '../motion.js';

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export default function EChart({ option, height = 280, active = true, animationKey = '', label = '' }) {
  const holder = useRef(null);
  const chart = useRef(null);
  const animKeyRef = useRef('');

  useEffect(() => {
    if (!holder.current) return undefined;
    const instance = echarts.init(holder.current, null, {
      renderer: 'canvas',
      devicePixelRatio: Math.min(2, window.devicePixelRatio || 1),
    });
    chart.current = instance;
    const ro = new ResizeObserver(() => instance.resize());
    ro.observe(holder.current);
    return () => {
      ro.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chart.current || !option) return;
    // 只在打开/切换范围时播放动画；增量刷新直接更新，避免每 1.2s 重播。
    const changed = animationKey !== animKeyRef.current;
    animKeyRef.current = animationKey;
    const next = changed && !REDUCED ? option : { ...option, animation: false };
    chart.current.setOption(next, { notMerge: true, lazyUpdate: false });
  }, [option, animationKey]);

  useEffect(() => {
    if (!active || !chart.current) return undefined;
    const id = requestAnimationFrame(() => chart.current?.resize());
    return () => cancelAnimationFrame(id);
  }, [active]);

  return (
    <div
      ref={holder}
      className="dash-chart-canvas"
      style={{ height }}
      role="img"
      aria-label={label}
    />
  );
}
