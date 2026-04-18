import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/** Full-screen absolute overlay, content centered. */
export function Overlay({ children }: Props) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {children}
    </div>
  );
}
