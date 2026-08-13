import { ArrowLeft } from 'lucide-react'

import { Button, type ButtonProps } from './Button'

export type BackActionProps = Omit<
  ButtonProps,
  'children' | 'size' | 'variant'
> & {
  label: string
}

export const BackAction = ({ label, ...props }: BackActionProps) => (
  <Button {...props} data-slot="back-action" size="compact" variant="quiet">
    <ArrowLeft aria-hidden="true" />
    {label}
  </Button>
)
