import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Quiet Instrument textarea — mirrors the `.input-shell` / `.search` atom
        "flex field-sizing-content min-h-16 w-full rounded-[11px] border border-[var(--line)] bg-[oklch(0_0_0/0.3)] px-4 py-3 text-[13.5px] text-[var(--ink)] shadow-[inset_0_2px_6px_oklch(0_0_0/0.3)] transition-[color,box-shadow] outline-none placeholder:text-[var(--dim)] focus-visible:border-[var(--line2)] focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
