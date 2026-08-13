export const DESIGN_SYSTEM_VERSION = '0.5.0'

export const panelStatuses = [
  'ready',
  'loading',
  'degraded',
  'offline',
  'error'
] as const

export type PanelStatus = (typeof panelStatuses)[number]

export const viewStates = [
  'empty',
  'info',
  'loading',
  'offline',
  'degraded',
  'success',
  'error'
] as const

export type ViewState = (typeof viewStates)[number]
