import React from 'react';

/** 极简抽象图形（无 emoji，纯线条）。 */
export default function KindIcon({ kind }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 12 12',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  switch (kind) {
    case 'send':
      return (
        <svg {...common}>
          <path d="M2.4 6h6.6" />
          <path d="M6.6 3.4 9.2 6l-2.6 2.6" />
        </svg>
      );
    case 'context':
      return (
        <svg {...common}>
          <path d="M2.4 3.4h7.2M2.4 6h7.2M2.4 8.6h4.6" />
        </svg>
      );
    case 'model':
      return (
        <svg {...common}>
          <path d="M6 2.2 9.8 6 6 9.8 2.2 6Z" />
        </svg>
      );
    case 'reason':
      return (
        <svg {...common}>
          <path d="M6 2.4v7.2M3.1 4.1l5.8 3.8M8.9 4.1 3.1 7.9" />
        </svg>
      );
    case 'tool':
      return (
        <svg {...common}>
          <rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1.7" />
          <circle cx="6" cy="6" r="1.05" />
        </svg>
      );
    case 'answer':
      return (
        <svg {...common}>
          <path d="M2.8 6.3 4.9 8.4 9.2 3.7" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
        </svg>
      );
  }
}
