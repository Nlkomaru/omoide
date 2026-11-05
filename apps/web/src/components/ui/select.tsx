import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

const selectVariants = cva(
  "w-full min-w-0 appearance-none rounded-md border border-line bg-surface pr-7 text-ink transition-colors hover:border-line-strong disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      size: {
        sm: "h-7 px-2 text-xs",
        md: "h-8 px-2.5 text-sm",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export interface SelectProps
  extends Omit<ComponentProps<"select">, "size">,
    VariantProps<typeof selectVariants> {}

/** `className` sizes the wrapper, so width utilities apply; other props go to the `<select>`. */
export function Select({ size = "md", className, children, ...props }: SelectProps) {
  return (
    <span data-slot="select-wrapper" className={cn("relative inline-flex", className)}>
      <select data-slot="select" className={selectVariants({ size })} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      />
    </span>
  );
}

export { selectVariants };
