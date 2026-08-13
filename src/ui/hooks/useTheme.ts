import { use } from 'react'

import { ThemeContext } from '@/ui/styles/ThemeProvider'

export const useTheme = () => {
  const context = use(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider.')
  }
  return context
}
