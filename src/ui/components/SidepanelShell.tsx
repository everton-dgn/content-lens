import type { ReactNode } from 'react'

import { Brand } from '@/ui/components/Brand'
import { StatusRail } from '@/ui/components/StatusRail'
import type { PanelStatus } from '@/ui/styles/tokens/contract'

export type SidepanelShellProps = {
  children: ReactNode
  footer: string
  navigation?: ReactNode
  productName: string
  status: PanelStatus
  statusLabel: string
}

export const SidepanelShell = ({
  children,
  footer,
  navigation,
  productName,
  status,
  statusLabel
}: SidepanelShellProps) => (
  <div
    className={navigation ? 'cl-shell cl-shell--with-navigation' : 'cl-shell'}
    data-slot="sidepanel-shell"
  >
    <header className="cl-shell__header">
      <div className="cl-shell__identity">
        <h1 className="cl-shell__title">
          <Brand name={productName} />
        </h1>
        <StatusRail label={statusLabel} status={status} />
      </div>
    </header>
    <main className="cl-shell__content">{children}</main>
    {navigation ? (
      <div className="cl-shell__navigation">{navigation}</div>
    ) : null}
    <footer className="cl-shell__footer">{footer}</footer>
  </div>
)
