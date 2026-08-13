import { injectedPrimitiveTokens } from '@/ui/styles/tokens/injected-primitives'

export const injectedColorTokens = {
  light: injectedPrimitiveTokens.color
} as const

export const injectedSurfaceStyles = `
  :host {
    --contentlens-action-background: ${injectedColorTokens.light.actionBackground};
    --contentlens-action-foreground: ${injectedColorTokens.light.actionForeground};
    --contentlens-background: ${injectedColorTokens.light.background};
    --contentlens-focus: ${injectedColorTokens.light.focus};
    --contentlens-foreground: ${injectedColorTokens.light.foreground};
    --contentlens-signal: ${injectedColorTokens.light.signal};
    color-scheme: light;
    font-family: ${injectedPrimitiveTokens.font.family};
  }

  * {
    box-sizing: border-box;
  }

  .surface {
    align-items: start;
    background: var(--contentlens-background);
    border: ${injectedPrimitiveTokens.shape.borderStrong} solid var(--contentlens-foreground);
    border-inline-start: ${injectedPrimitiveTokens.shape.gateWidth} solid var(--contentlens-signal);
    border-radius: ${injectedPrimitiveTokens.shape.radiusSurface};
    color: var(--contentlens-foreground);
    display: grid;
    gap: ${injectedPrimitiveTokens.space.group};
    inline-size: 100%;
    padding: ${injectedPrimitiveTokens.space.content};
  }

  .heading,
  .reason,
  .decision-status {
    margin: 0;
  }

  .heading {
    font-size: ${injectedPrimitiveTokens.font.sizeHeading};
    font-weight: ${injectedPrimitiveTokens.font.weightStrong};
  }

  .reason,
  .decision-status {
    font-size: ${injectedPrimitiveTokens.font.sizeBody};
  }

  .action {
    appearance: none;
    background: var(--contentlens-action-background);
    border: ${injectedPrimitiveTokens.shape.borderStrong} solid var(--contentlens-foreground);
    border-radius: ${injectedPrimitiveTokens.shape.radiusAction};
    color: var(--contentlens-action-foreground);
    cursor: pointer;
    font: inherit;
    font-weight: ${injectedPrimitiveTokens.font.weightStrong};
    min-block-size: ${injectedPrimitiveTokens.control.minBlock};
    padding: ${injectedPrimitiveTokens.control.paddingBlock} ${injectedPrimitiveTokens.control.paddingInline};
  }

  .action:focus-visible {
    outline: ${injectedPrimitiveTokens.shape.focusWidth} solid var(--contentlens-focus);
    outline-offset: ${injectedPrimitiveTokens.shape.focusOffset};
  }

  .candidate-actions {
    align-items: end;
    display: grid;
    gap: ${injectedPrimitiveTokens.space.group};
    justify-items: end;
    padding-block: ${injectedPrimitiveTokens.space.actionRow};
  }

  .decision-status {
    inline-size: 100%;
  }

  .decision-announcer {
    block-size: ${injectedPrimitiveTokens.accessibility.measure};
    clip-path: inset(${injectedPrimitiveTokens.accessibility.clipInset});
    inline-size: ${injectedPrimitiveTokens.accessibility.measure};
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
  }
`
