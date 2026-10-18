import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

/** 连线：虚线沿路径流动。 */
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
    data,
  } = props;

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isThread = !!data?.thread;
  const animate = !isThread && !!data?.animate;

  // 每条边的相位错开，避免全图同步闪烁
  const delay = -((hash(id) % 13) / 13) * 0.95;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={isThread ? 'edge-thread' : animate ? 'edge-flow' : 'edge-static'}
        style={{ ...(style || {}), animationDelay: animate ? `${delay}s` : undefined }}
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
