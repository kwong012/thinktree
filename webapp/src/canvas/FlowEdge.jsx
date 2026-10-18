import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

/** 连线：实线 + 间隔流动的光点。 */
export default function FlowEdge(props) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    className,
    label,
    labelStyle,
  } = props;

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // 每条边的点相位错开，避免全图同步闪烁
  const delay = -((hash(id) % 13) / 13) * 1.3;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} className={className} />
      <path
        d={path}
        className="edge-particles"
        style={{ stroke: style?.stroke, animationDelay: `${delay}s` }}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              ...(labelStyle || {}),
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
