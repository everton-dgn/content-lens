import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import {
  type ChangeEventHandler,
  type KeyboardEventHandler,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import { Button } from './Button'
import type { SelectOption } from './SelectField'

export type ComboboxProps = {
  disabled?: boolean
  label: string
  onChange: ChangeEventHandler<HTMLSelectElement>
  options: readonly SelectOption[]
  searchLabel: string
  value: string
}

const filterOptions = (
  options: readonly SelectOption[],
  query: string,
  value: string
): readonly SelectOption[] => {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) {
    return options
  }
  const matches = options.filter(option =>
    option.label.toLocaleLowerCase().includes(normalized)
  )
  const selected = options.find(option => option.value === value)
  return selected && !matches.some(option => option.value === value)
    ? [selected, ...matches]
    : matches
}

const selectedOrFirstEnabledIndex = (
  options: readonly SelectOption[],
  value: string
): number => {
  const selectedIndex = options.findIndex(
    option => option.value === value && !option.disabled
  )
  return selectedIndex >= 0
    ? selectedIndex
    : options.findIndex(option => !option.disabled)
}

const firstEnabledQueryMatchIndex = (
  options: readonly SelectOption[],
  query: string
): number => {
  const normalized = query.trim().toLocaleLowerCase()
  return options.findIndex(
    option =>
      !option.disabled && option.label.toLocaleLowerCase().includes(normalized)
  )
}

export const Combobox = ({
  disabled,
  label,
  onChange,
  options,
  searchLabel,
  value
}: ComboboxProps) => {
  const searchId = useId()
  const selectId = useId()
  const listboxId = `${selectId}-listbox`
  const nativeRef = useRef<HTMLSelectElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const filtered = useMemo(
    () => filterOptions(options, query, value),
    [options, query, value]
  )

  const optionId = (option: SelectOption) =>
    `${listboxId}-option-${options.findIndex(
      candidate => candidate.value === option.value
    )}`
  const activeOption = filtered[activeIndex]
  const activeOptionId = activeOption ? optionId(activeOption) : undefined

  const resetActiveOption = (nextOptions: readonly SelectOption[]) => {
    setActiveIndex(selectedOrFirstEnabledIndex(nextOptions, value))
  }
  const updateOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    setQuery('')
    if (nextOpen) {
      resetActiveOption(options)
    } else {
      setActiveIndex(-1)
    }
  }

  const updateQuery: ChangeEventHandler<HTMLInputElement> = event => {
    const nextQuery = event.currentTarget.value
    const nextOptions = filterOptions(options, nextQuery, value)
    setQuery(nextQuery)
    setActiveIndex(
      nextQuery.trim()
        ? firstEnabledQueryMatchIndex(nextOptions, nextQuery)
        : selectedOrFirstEnabledIndex(nextOptions, value)
    )
  }
  const updateValue = (nextValue: string) => {
    const control = nativeRef.current
    if (!control) {
      return
    }
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )?.set
    valueSetter?.call(control, nextValue)
    control.dispatchEvent(new Event('change', { bubbles: true }))
    updateOpen(false)
  }
  const moveActiveOption = (
    direction: 'first' | 'last' | 'next' | 'previous'
  ) => {
    const enabledIndices = filtered.flatMap((option, index) =>
      option.disabled ? [] : [index]
    )
    if (enabledIndices.length === 0) {
      setActiveIndex(-1)
      return
    }
    if (direction === 'first') {
      setActiveIndex(enabledIndices[0] ?? -1)
      return
    }
    if (direction === 'last') {
      setActiveIndex(enabledIndices.at(-1) ?? -1)
      return
    }
    const currentPosition = enabledIndices.indexOf(activeIndex)
    const nextPosition =
      direction === 'next'
        ? Math.min(currentPosition + 1, enabledIndices.length - 1)
        : Math.max(
            currentPosition < 0
              ? enabledIndices.length - 1
              : currentPosition - 1,
            0
          )
    setActiveIndex(enabledIndices[nextPosition] ?? -1)
  }
  const handleSearchKeyDown: KeyboardEventHandler<HTMLInputElement> = event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActiveOption('next')
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActiveOption('previous')
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      moveActiveOption('first')
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      moveActiveOption('last')
      return
    }
    if (event.key === 'Enter' && activeOption && !activeOption.disabled) {
      event.preventDefault()
      updateValue(activeOption.value)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      updateOpen(false)
    }
  }
  const handleTriggerKeyDown: KeyboardEventHandler<
    HTMLButtonElement
  > = event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return
    }
    event.preventDefault()
    updateOpen(true)
    if (event.key === 'Home') {
      setActiveIndex(options.findIndex(option => !option.disabled))
    }
    if (event.key === 'End') {
      setActiveIndex(options.findLastIndex(option => !option.disabled))
    }
  }
  const selectedLabel = options.find(option => option.value === value)?.label

  return (
    <div className="cl-combobox" data-slot="combobox">
      <label className="cl-field__label" htmlFor={`${selectId}-trigger`}>
        {label}
      </label>
      <PopoverPrimitive.Root onOpenChange={updateOpen} open={open}>
        <PopoverPrimitive.Trigger asChild>
          <Button
            aria-controls={listboxId}
            aria-expanded={open}
            aria-haspopup="listbox"
            className="cl-combobox__trigger"
            disabled={disabled}
            id={`${selectId}-trigger`}
            onKeyDown={handleTriggerKeyDown}
            role="combobox"
            variant="secondary"
          >
            <span className="cl-combobox__value">{selectedLabel}</span>
            <ChevronsUpDown aria-hidden="true" />
          </Button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            className="cl-combobox__content"
            onOpenAutoFocus={event => {
              event.preventDefault()
              searchRef.current?.focus()
            }}
            sideOffset={6}
          >
            <label className="cl-combobox__search" htmlFor={searchId}>
              <Search aria-hidden="true" />
              <span className="cl-visually-hidden">{searchLabel}</span>
              <input
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                aria-controls={listboxId}
                disabled={disabled}
                id={searchId}
                onChange={updateQuery}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchLabel}
                ref={searchRef}
                type="search"
                value={query}
              />
            </label>
            <div
              aria-label={label}
              className="cl-combobox__options"
              id={listboxId}
              role="listbox"
            >
              {filtered.map((option, index) => (
                <button
                  aria-disabled={option.disabled || undefined}
                  aria-selected={value === option.value}
                  className="cl-combobox__option"
                  data-highlighted={activeIndex === index ? '' : undefined}
                  disabled={option.disabled}
                  id={optionId(option)}
                  key={option.value}
                  onClick={() => updateValue(option.value)}
                  onMouseMove={() => {
                    if (!option.disabled) {
                      setActiveIndex(index)
                    }
                  }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <span>{option.label}</span>
                  {value === option.value ? (
                    <Check
                      aria-hidden="true"
                      className="cl-combobox__indicator"
                    />
                  ) : null}
                </button>
              ))}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <label className="cl-visually-hidden" htmlFor={selectId}>
        {label}
      </label>
      <select
        aria-hidden="true"
        className="cl-visually-hidden"
        disabled={disabled}
        id={selectId}
        onChange={onChange}
        ref={nativeRef}
        tabIndex={-1}
        value={value}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
