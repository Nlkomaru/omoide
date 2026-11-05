import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent-hover",
        primary: "bg-accent text-white hover:bg-accent-hover",
        outline: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-subtle",
        secondary:
          "border border-line bg-surface text-ink hover:border-line-strong hover:bg-subtle",
        ghost: "text-ink-muted hover:bg-subtle hover:text-ink",
        "danger-ghost": "text-danger hover:bg-danger/10",
        destructive: "bg-danger/10 text-danger hover:bg-danger/20",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-3 text-sm [&_svg]:size-4",
        md: "h-8 gap-1.5 px-3 text-sm [&_svg]:size-4",
        sm: "h-7 gap-1 px-2 text-xs [&_svg]:size-3.5",
        lg: "h-9 gap-1.5 px-3.5 text-sm [&_svg]:size-4",
        icon: "size-8 [&_svg]:size-4",
        "icon-sm": "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ControlSize = "sm" | "md";

/** Button styling for elements that must stay anchors, such as download links. */
export function buttonClassName(
  variant: ButtonVariant = "secondary",
  size: VariantProps<typeof buttonVariants>["size"] = "md",
) {
  return cn(buttonVariants({ variant, size }));
}

export interface ButtonProps
  extends ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {}

export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "size"> {
  "aria-label": string;
  size?: ControlSize;
}

export function IconButton({
  variant = "ghost",
  size = "md",
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      data-slot="icon-button"
      className={cn(
        buttonVariants({
          variant,
          size: size === "sm" ? "icon-sm" : "icon",
        }),
        className,
      )}
      {...props}
    />
  );
}

export { buttonVariants };
