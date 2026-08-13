import { Dialog as DialogPrimitive } from 'radix-ui'
import { type ReactNode, type RefObject, useId } from 'react'

export type DialogProps = {
  cancelRef: RefObject<HTMLButtonElement | null>
  children: ReactNode
  description: string
  onDismiss(): void
  title: string
}

export const Dialog = ({
  cancelRef,
  children,
  description,
  onDismiss,
  title
}: DialogProps) => {
  const titleId = useId()
  const descriptionId = useId()
  return (
    <DialogPrimitive.Root
      onOpenChange={nextOpen => {
        if (!nextOpen) {
          onDismiss()
        }
      }}
      open
    >
      <DialogPrimitive.Overlay className="cl-dialog__overlay" />
      <DialogPrimitive.Content
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className="cl-dialog"
        data-slot="dialog"
        onOpenAutoFocus={event => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogPrimitive.Title className="cl-dialog__title" id={titleId}>
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description
          className="cl-dialog__description"
          id={descriptionId}
        >
          {description}
        </DialogPrimitive.Description>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  )
}
