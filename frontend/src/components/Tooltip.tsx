import { Children, cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX, ReactElement, ReactNode } from 'react'

interface DescribableProps {
  'aria-describedby'?: string
}

interface TooltipProps {
  label: string
  children: ReactNode
  placement?: 'top' | 'bottom'
  block?: boolean
  dismissOnPointerDown?: boolean
}

const SHOW_DELAY_MS = 400
const GAP_PX = 8
const VIEWPORT_MARGIN_PX = 8

export function Tooltip({ label, children, placement = 'top', block = false, dismissOnPointerDown = false }: TooltipProps): JSX.Element {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const showTimerRef = useRef<number | null>(null)
  const suppressFocusRef = useRef(false)
  const id = useId()
  const visible = targetRect !== null

  function clearShowTimer(): void {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }

  function show(): void {
    clearShowTimer()
    showTimerRef.current = window.setTimeout(() => {
      setTargetRect(wrapperRef.current?.getBoundingClientRect() ?? null)
    }, SHOW_DELAY_MS)
  }

  function hide(): void {
    clearShowTimer()
    setTargetRect(null)
  }

  function handleFocus(): void {
    if (suppressFocusRef.current) {
      suppressFocusRef.current = false
      return
    }
    show()
  }

  function handlePointerDown(): void {
    suppressFocusRef.current = true
    hide()
  }

  useEffect(() => {
    if (!visible) return
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible])

  // Unmount-only: cancel a pending show so it can't fire after the trigger is gone.
  useEffect(() => clearShowTimer, [])

  const child = Children.only(children)
  const describedChild = isValidElement(child)
    ? cloneElement(child as ReactElement<DescribableProps>, { 'aria-describedby': visible ? id : undefined })
    : child

  return (
    <span
      ref={wrapperRef}
      className={block ? 'flex w-full' : 'inline-flex'}
      onMouseEnter={show}
      onMouseLeave={() => {
        suppressFocusRef.current = false
        hide()
      }}
      onPointerDown={dismissOnPointerDown ? handlePointerDown : undefined}
      onFocus={handleFocus}
      onBlur={hide}
    >
      {describedChild}
      {visible &&
        targetRect &&
        createPortal(
          <TooltipBubble id={id} label={label} targetRect={targetRect} placement={placement} />,
          document.body
        )}
    </span>
  )
}

function TooltipBubble({
  id,
  label,
  targetRect,
  placement,
}: {
  id: string
  label: string
  targetRect: DOMRect
  placement: 'top' | 'bottom'
}): JSX.Element {
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; ready: boolean }>({
    top: 0,
    left: 0,
    ready: false,
  })

  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!bubble) return
    const { width, height } = bubble.getBoundingClientRect()

    let resolvedPlacement = placement
    const fitsAbove = targetRect.top - height - GAP_PX >= VIEWPORT_MARGIN_PX
    const fitsBelow = targetRect.bottom + height + GAP_PX <= window.innerHeight - VIEWPORT_MARGIN_PX
    if (placement === 'top' && !fitsAbove && fitsBelow) {
      resolvedPlacement = 'bottom'
    } else if (placement === 'bottom' && !fitsBelow && fitsAbove) {
      resolvedPlacement = 'top'
    }

    const top = resolvedPlacement === 'top' ? targetRect.top - height - GAP_PX : targetRect.bottom + GAP_PX

    const centerX = targetRect.left + targetRect.width / 2
    const idealLeft = centerX - width / 2
    const maxLeft = Math.max(window.innerWidth - width - VIEWPORT_MARGIN_PX, VIEWPORT_MARGIN_PX)
    const left = Math.min(Math.max(idealLeft, VIEWPORT_MARGIN_PX), maxLeft)

    setPosition({ top, left, ready: true })
  }, [targetRect, placement])

  return (
    <div
      ref={bubbleRef}
      role="tooltip"
      id={id}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      className="z-[100] bg-foreground text-brand-surface text-xs px-2 py-1 rounded-[var(--radius-btn)] whitespace-nowrap shadow-md pointer-events-none"
    >
      {label}
    </div>
  )
}
