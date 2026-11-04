import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger-ghost";
type ControlSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "border border-line bg-surface text-ink hover:border-line-strong hover:bg-subtle",
  ghost: "text-ink-muted hover:bg-subtle hover:text-ink",
  "danger-ghost": "text-danger hover:bg-danger/10",
};

const BUTTON_SIZES: Record<ControlSize, string> = {
  sm: "h-7 gap-1 px-2 text-xs [&_svg]:size-3.5",
  md: "h-8 gap-1.5 px-3 text-sm [&_svg]:size-4",
};

const ICON_BUTTON_SIZES: Record<ControlSize, string> = {
  sm: "size-7 [&_svg]:size-3.5",
  md: "size-8 [&_svg]:size-4",
};

const FIELD_BASE =
  "rounded-md border border-line bg-surface text-ink transition-colors hover:border-line-strong disabled:pointer-events-none disabled:opacity-50";

const FIELD_SIZES: Record<ControlSize, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-2.5 text-sm",
};

/** Button styling for elements that must stay anchors, such as download links. */
export function buttonClassName(variant: ButtonVariant = "secondary", size: ControlSize = "md") {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`;
}

interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ControlSize;
}

export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={`${buttonClassName(variant, size)} ${className}`} {...props} />
  );
}

interface IconButtonProps extends ButtonProps {
  "aria-label": string;
}

export function IconButton({
  variant = "ghost",
  size = "md",
  type = "button",
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${ICON_BUTTON_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

interface SelectProps extends Omit<ComponentProps<"select">, "size"> {
  size?: ControlSize;
}

/** `className` sizes the wrapper, so width utilities apply; other props go to the `<select>`. */
export function Select({ size = "md", className = "", children, ...props }: SelectProps) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        className={`w-full min-w-0 appearance-none pr-7 ${FIELD_BASE} ${FIELD_SIZES[size]}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      />
    </span>
  );
}

interface TextInputProps extends Omit<ComponentProps<"input">, "size"> {
  size?: ControlSize;
}

export function TextInput({
  size = "md",
  type = "text",
  className = "",
  ...props
}: TextInputProps) {
  return (
    <input
      type={type}
      className={`placeholder:text-ink-faint ${FIELD_BASE} ${FIELD_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

export function Badge({ className = "", ...props }: ComponentProps<"span">) {
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 rounded-sm bg-subtle px-1.5 text-xs font-medium whitespace-nowrap text-ink-muted ${className}`}
      {...props}
    />
  );
}
