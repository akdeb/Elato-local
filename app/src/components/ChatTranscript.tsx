import { useEffect, useMemo, useRef, useState } from "react";

export type ChatMessage = {
  id: string;
  role: "ai" | "user";
  text: string;
  timestamp: number;
};

type ChatTranscriptProps = {
  messages: ChatMessage[];
  isLive?: boolean;
  autoScroll?: boolean;
  scrollMarginTop?: number;
  emptyLabel?: string;
  className?: string;
  progressiveAi?: boolean;
};

const ProgressiveAiText = ({ text, enabled }: { text: string; enabled: boolean }) => {
  const [visibleChars, setVisibleChars] = useState(enabled ? 0 : text.length);

  useEffect(() => {
    if (!enabled) {
      setVisibleChars(text.length);
      return;
    }
    setVisibleChars((prev) => Math.min(prev, text.length));
    if (!text) return;

    const step = Math.max(1, Math.ceil(text.length / 90));
    const timer = window.setInterval(() => {
      setVisibleChars((prev) => {
        if (prev >= text.length) {
          window.clearInterval(timer);
          return prev;
        }
        return Math.min(text.length, prev + step);
      });
    }, 16);

    return () => window.clearInterval(timer);
  }, [enabled, text]);

  const shown = useMemo(() => text.slice(0, visibleChars), [text, visibleChars]);
  const opacity = text.length > 0 ? Math.min(1, 0.35 + (visibleChars / text.length) * 0.65) : 1;

  return (
    <span className="transition-opacity duration-150" style={{ opacity }}>
      {shown}
    </span>
  );
};

export const ChatTranscript = ({
  messages,
  isLive = false,
  autoScroll = false,
  scrollMarginTop = 0,
  emptyLabel = "Experience loading...",
  className = "",
  progressiveAi = false,
}: ChatTranscriptProps) => {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAiRef = useRef<HTMLDivElement | null>(null);

  const lastAiId = [...messages].reverse().find((m) => m.role === "ai")?.id;

  useEffect(() => {
    if (!autoScroll) return;
    if (lastAiRef.current) {
      lastAiRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [autoScroll, messages.length, lastAiId]);

  return (
    <div className={`bg-transparent border-0 shadow-none rounded-none ${className}`}>
      {messages.length === 0 ? (
        <div className="p-8 text-center label-mono">{emptyLabel}</div>
      ) : (
        <div className="p-4 space-y-2.5">
          {messages.map((entry) => {
            const isAi = entry.role === "ai";
            const isLastAi = isAi && entry.id === lastAiId;
            return (
              <div
                key={entry.id}
                ref={isLastAi ? lastAiRef : undefined}
                style={isLastAi && scrollMarginTop ? { scrollMarginTop } : undefined}
                className={`flex ${isAi ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`chat-bubble ${isAi ? "chat-bubble-ai" : "chat-bubble-user"}`}
                  style={
                    isAi && isLive
                      ? {
                          animation: "aiFadeIn 220ms ease-out",
                          animationFillMode: "both",
                        }
                      : undefined
                  }
                >
                  <div className={`chat-role mb-1 ${isAi ? "text-[var(--color-retro-accent)]" : "text-white/50"}`}>
                    {isAi ? "ai" : "you"}
                  </div>
                  <div className="whitespace-pre-wrap">
                    {isAi && progressiveAi ? (
                      <ProgressiveAiText text={entry.text} enabled />
                    ) : (
                      entry.text
                    )}
                  </div>
                  <div className={`chat-time mt-1.5 text-right ${isAi ? "text-gray-400" : "text-white/40"}`}>
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} style={scrollMarginTop ? { scrollMarginTop } : undefined} />
        </div>
      )}

      <style>{`
        @keyframes aiFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
