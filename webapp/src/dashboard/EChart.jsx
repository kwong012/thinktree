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

export default function EChart({ option, height = 280, active = true, label = '' }) {
  const holder = useRef(null);
  const chart = useRef(null);

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
    chart.current.setOption(option, { notMerge: true, lazyUpdate: false });
  }, [option]);

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
