import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingLabel?: string;
  variant?: Variant;
  children: ReactNode;
}

const variantClass: Record<Variant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

/** Base button with loading and disabled states. */
export function Button({
  loading = false,
  loadingLabel,
  variant = "primary",
  children,
  disabled,
  className = "",
  ...rest
}: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        "px-6 py-3 rounded-lg font-medium",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variantClass[variant],
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? (loadingLabel ?? children) : children}
    </button>
  );
}
