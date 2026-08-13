import { ChevronDown } from 'lucide-react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
import type { ReactNode } from 'react'

export type DisclosureProps = {
  children: ReactNode
  defaultOpen?: boolean
  summary: string
}

export const Disclosure = ({
  children,
  defaultOpen,
  summary
}: DisclosureProps) => (
  <CollapsiblePrimitive.Root
    className="cl-disclosure"
    data-slot="disclosure"
    defaultOpen={defaultOpen}
  >
    <CollapsiblePrimitive.Trigger className="cl-disclosure__trigger">
      <span>{summary}</span>
      <ChevronDown aria-hidden="true" />
    </CollapsiblePrimitive.Trigger>
    <CollapsiblePrimitive.Content className="cl-disclosure__content">
      {children}
    </CollapsiblePrimitive.Content>
  </CollapsiblePrimitive.Root>
)
