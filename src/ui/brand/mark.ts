export const brandMarkViewBox = '0 0 32 32'

export const brandMarkGeometry = {
  frame: {
    path: 'M12.2 4.8h7.6c.45 0 .85.18 1.2.53l5 5c.35.35.45.75.45 1.22V20c0 .45-.15.85-.5 1.2l-5.35 4.95c-.35.35-.7.4-1.15.4h-6.9c-.45 0-.8-.05-1.15-.4L6.05 21.2c-.35-.35-.5-.75-.5-1.2v-8.45c0-.45.15-.85.5-1.2L11 5.4c.35-.35.75-.6 1.2-.6Z',
    strokeWidth: 1.9
  },
  decision: {
    x: 15.1,
    y: 9.5,
    width: 1.8,
    height: 12,
    radius: 0.9
  },
  signal: {
    y: 15.72,
    radius: 1.65,
    barY: 15.09,
    barWidth: 5.6,
    barHeight: 1.26,
    barRadius: 0.3,
    left: {
      centerX: 8.95,
      barX: 8.95
    },
    right: {
      centerX: 23.05,
      barX: 17.45
    }
  }
} as const

export type BrandMarkPalette = {
  background?: string
  decision: string
  frame: string
  signal: string
}

export const brandIconPalette: BrandMarkPalette = {
  background: '#0B1220',
  decision: '#FFFFFF',
  frame: '#FFFFFF',
  signal: '#FF7A80'
}

const createBrandMarkMarkup = (palette: BrandMarkPalette): string => {
  const { frame, decision, signal } = brandMarkGeometry

  return [
    `<path d="${frame.path}" fill="none" stroke="${palette.frame}" stroke-linejoin="round" stroke-width="${frame.strokeWidth}"/>`,
    `<rect x="${decision.x}" y="${decision.y}" width="${decision.width}" height="${decision.height}" rx="${decision.radius}" fill="${palette.decision}"/>`,
    `<circle cx="${signal.left.centerX}" cy="${signal.y}" r="${signal.radius}" fill="${palette.signal}"/>`,
    `<rect x="${signal.left.barX}" y="${signal.barY}" width="${signal.barWidth}" height="${signal.barHeight}" rx="${signal.barRadius}" fill="${palette.signal}"/>`,
    `<circle cx="${signal.right.centerX}" cy="${signal.y}" r="${signal.radius}" fill="${palette.signal}"/>`,
    `<rect x="${signal.right.barX}" y="${signal.barY}" width="${signal.barWidth}" height="${signal.barHeight}" rx="${signal.barRadius}" fill="${palette.signal}"/>`
  ].join('')
}

export const createBrandIconSvg = (
  palette: BrandMarkPalette = brandIconPalette
): string => {
  const background = palette.background ?? 'transparent'

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${brandMarkViewBox}" width="32" height="32" role="img" aria-label="ContentLens">`,
    `<rect width="32" height="32" rx="7.5" fill="${background}"/>`,
    `<g transform="translate(-1.6 -1.6) scale(1.1)">${createBrandMarkMarkup(palette)}</g>`,
    '</svg>',
    ''
  ].join('\n')
}
