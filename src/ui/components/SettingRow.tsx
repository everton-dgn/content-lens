import type { ReactNode } from 'react'

export type SettingRowProps = {
  control: ReactNode
  description?: string
  title: string
}

export const SettingRow = ({
  control,
  description,
  title
}: SettingRowProps) => (
  <div className="cl-setting-row" data-slot="setting-row">
    <div className="cl-setting-row__copy">
      <strong>{title}</strong>
      {description ? <small>{description}</small> : null}
    </div>
    <div className="cl-setting-row__control">{control}</div>
  </div>
)
