"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        // `[&>div]:!block [&>div]:!min-w-0` targets the wrapper Radix renders
        // INSIDE the viewport, which it hard-codes to
        // `style={{ minWidth: "100%", display: "table" }}`.
        //
        // A `display: table` box is shrink-to-fit and sizes to MAX-CONTENT, so
        // it silently becomes as wide as its widest descendant. That breaks the
        // containing block for everything inside: `w-full` resolves against the
        // grown table instead of the viewport, and any `min-w-0` + `truncate`
        // chain below it can never take effect — the content overflows
        // horizontally instead of ellipsizing (this is what made the chat
        // sidebar bleed sideways).
        //
        // Forcing the wrapper back to a normal block with `min-width: 0`
        // restores the viewport as the real width constraint, so the existing
        // min-w-0/truncate work in consumers behaves as written. Vertical
        // scrolling is unaffected, and a deliberately horizontal ScrollArea
        // still scrolls (its children opt in via `shrink-0`/`w-max`).
        className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1 [&>div]:!block [&>div]:!min-w-0"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
