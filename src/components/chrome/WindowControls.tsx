import type { WindowState } from "../../hooks/useWindowState";

interface Props {
  win: WindowState;
}

export function WindowControls({ win }: Props) {
  const { isMaximized, isFullscreen, minimize, toggleMaximize, close, toggleFullscreen } = win;

  return (
    <div className="flex h-full no-drag">
      {!isFullscreen && (
        <CtrlButton title="Minimize" onClick={minimize}>
          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </CtrlButton>
      )}
      <CtrlButton
        title={isFullscreen ? "Exit full screen" : isMaximized ? "Restore" : "Maximize"}
        onClick={isFullscreen ? toggleFullscreen : toggleMaximize}
      >
        {isFullscreen ? (
          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M3 1v2H1M7 1v2h2M3 9v-2H1M7 9v-2h2" />
          </svg>
        ) : isMaximized ? (
          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2.5" y="0.5" width="7" height="7" />
            <rect x="0.5" y="2.5" width="7" height="7" fill="currentColor" fillOpacity="0" />
            <path d="M0.5 2.5h7v7h-7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </CtrlButton>
      <CtrlButton title="Close" onClick={close} variant="close">
        <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </CtrlButton>
    </div>
  );
}

interface BtnProps {
  title: string;
  onClick: () => void | Promise<void>;
  variant?: "default" | "close";
  children: React.ReactNode;
}

function CtrlButton({ title, onClick, variant = "default", children }: BtnProps) {
  const base =
    "inline-flex items-center justify-center w-[46px] h-full text-slate-300 transition-colors duration-150";
  const hover =
    variant === "close"
      ? "hover:bg-red-500/90 hover:text-white"
      : "hover:bg-white/10 hover:text-white";
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`${base} ${hover}`}
    >
      {children}
    </button>
  );
}
