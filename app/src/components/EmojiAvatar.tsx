import twemoji from "twemoji";

type EmojiAvatarProps = {
  emoji?: string | null;
  size?: number | string;
  className?: string;
};

export function EmojiAvatar({ emoji = "🙂", size = 48, className = "" }: EmojiAvatarProps) {
  const safe = (emoji || "🙂").trim();
  const html = twemoji.parse(safe, { folder: "svg", ext: ".svg" });

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
