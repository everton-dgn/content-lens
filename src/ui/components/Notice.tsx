import { AlertTriangle, CheckCircle2, CircleAlert, Info } from 'lucide-react'

import type { ViewState } from '@/ui/styles/tokens/contract'

export type NoticeTone = Extract<
  ViewState,
  'info' | 'success' | 'degraded' | 'error'
>

export type NoticeProps = {
  body: string
  title: string
  tone?: NoticeTone
}

const noticeMarks: Record<NoticeTone, typeof Info> = {
  degraded: AlertTriangle,
  error: CircleAlert,
  info: Info,
  success: CheckCircle2
}

export const Notice = ({ body, title, tone = 'info' }: NoticeProps) => {
  const Mark = noticeMarks[tone]
  return (
    <div
      className="cl-notice"
      data-slot="notice"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span aria-hidden="true" className="cl-notice__mark">
        <Mark />
      </span>
      <p className="cl-notice__title">{title}</p>
      <p className="cl-notice__body">{body}</p>
    </div>
  )
}
