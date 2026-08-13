export const injectedPrimitiveTokens = {
  accessibility: {
    clipInset: '50%',
    measure: '0.0625rem'
  },
  color: {
    actionBackground: '#d9252e',
    actionForeground: '#ffffff',
    background: '#151317',
    focus: '#ff4d55',
    foreground: '#faf7f4',
    signal: '#ff4d55'
  },
  control: {
    minBlock: '2.75rem',
    paddingBlock: '0.5rem',
    paddingInline: '0.75rem'
  },
  font: {
    family:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    sizeBody: '0.875rem',
    sizeHeading: '1rem',
    weightStrong: 700
  },
  shape: {
    borderStrong: '0.125rem',
    focusOffset: '0.125rem',
    focusWidth: '0.1875rem',
    gateWidth: '0.1875rem',
    radiusAction: '0.625rem',
    radiusSurface: '0.75rem'
  },
  space: {
    actionRow: '0.5rem',
    content: '1rem',
    group: '0.75rem'
  }
} as const
