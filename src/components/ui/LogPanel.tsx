import { useEffect, useRef } from "react";

interface Props {
  messages: string[];
  emptyText?: string;
}

/** Auto-scrolling monospace log panel. */
export function LogPanel({ messages, emptyText = "Waiting..." }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div ref={ref} className="text-xs font-mono space-y-0.5 max-h-56 overflow-y-auto">
      {messages.length === 0 ? (
        <span className="text-gray-400">{emptyText}</span>
      ) : (
        messages.map((msg, i) => (
          <div key={i} className={msg.startsWith("ERROR") ? "text-red-400" : ""}>
            {msg}
          </div>
        ))
      )}
    </div>
  );
}
