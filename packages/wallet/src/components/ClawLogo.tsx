import React from 'react';

export const ClawLogo: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="clawLogoGrad" x1="3" y1="0" x2="29" y2="29" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="100%" stopColor="#0054e9" />
      </linearGradient>
    </defs>
    <g fill="url(#clawLogoGrad)">
      <g transform="translate(0,0)"><rect x="3" y="3" width="4" height="4" rx="1.2"/><rect x="3" y="8.5" width="4" height="4" rx="1.2"/><rect x="3" y="14" width="4" height="4" rx="1.2"/><rect x="3" y="19.5" width="4" height="4" rx="1.2"/><rect x="3" y="25" width="4" height="4" rx="1.2"/></g>
      <g transform="translate(0,-2)"><rect x="8.5" y="3" width="4" height="4" rx="1.2"/><rect x="8.5" y="8.5" width="4" height="4" rx="1.2"/><rect x="8.5" y="14" width="4" height="4" rx="1.2"/><rect x="8.5" y="19.5" width="4" height="4" rx="1.2"/><rect x="8.5" y="25" width="4" height="4" rx="1.2"/></g>
      <g transform="translate(0,-3)"><rect x="14" y="3" width="4" height="4" rx="1.2"/><rect x="14" y="8.5" width="4" height="4" rx="1.2"/><rect x="14" y="14" width="4" height="4" rx="1.2"/><rect x="14" y="19.5" width="4" height="4" rx="1.2"/><rect x="14" y="25" width="4" height="4" rx="1.2"/></g>
      <g transform="translate(0,-2)"><rect x="19.5" y="3" width="4" height="4" rx="1.2"/><rect x="19.5" y="8.5" width="4" height="4" rx="1.2"/><rect x="19.5" y="14" width="4" height="4" rx="1.2"/><rect x="19.5" y="19.5" width="4" height="4" rx="1.2"/><rect x="19.5" y="25" width="4" height="4" rx="1.2"/></g>
      <g transform="translate(0,0)"><rect x="25" y="3" width="4" height="4" rx="1.2"/><rect x="25" y="8.5" width="4" height="4" rx="1.2"/><rect x="25" y="14" width="4" height="4" rx="1.2"/><rect x="25" y="19.5" width="4" height="4" rx="1.2"/><rect x="25" y="25" width="4" height="4" rx="1.2"/></g>
    </g>
  </svg>
);
