import type { ReactNode } from 'react'

export type DataListItem = {
  description: ReactNode
  term: string
}

export type DataListProps = {
  items: readonly DataListItem[]
  layout?: 'grid' | 'summary'
}

export const DataList = ({ items, layout = 'grid' }: DataListProps) => (
  <dl className="cl-data-list" data-layout={layout} data-slot="data-list">
    {items.map(item => (
      <div className="cl-data-list__item" key={item.term}>
        <dt>{item.term}</dt>
        <dd>{item.description}</dd>
      </div>
    ))}
  </dl>
)
