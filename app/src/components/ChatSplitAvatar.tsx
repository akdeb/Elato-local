import React, { useEffect, useState } from "react";
import { EmojiAvatar } from "./EmojiAvatar";

type ChatSplitAvatarProps = {
  size?: number;
  width?: number | string;
  height?: number | string;
  ratio?: number;
  userEmoji?: string | null;
  characterImageSrc?: string | null;
  onCharacterClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
};

export const ChatSplitAvatar = ({
  size = 48,
  width,
  height,
  ratio = 1.9,
  userEmoji,
  characterImageSrc,
  onCharacterClick,
  className = "",
}: ChatSplitAvatarProps) => {
  const hasExplicitWidth = width != null;
  const hasExplicitHeight = height != null;
  const computedWidth = hasExplicitWidth ? width : hasExplicitHeight ? "auto" : Math.round(size * ratio);
  const computedHeight = hasExplicitHeight ? height : size;
  const emoji = userEmoji?.trim() || "🙂";
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [characterImageSrc]);

  return (
    <div
      className={`relative rounded-[14px] overflow-hidden bg-white shadow-[0_6px_16px_rgba(0,0,0,0.12)] ${className}`}
      style={{
        width: computedWidth,
        height: computedHeight,
        aspectRatio: hasExplicitWidth ? undefined : hasExplicitHeight ? `${ratio} / 1` : undefined,
      }}
    >
      {/* <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(135deg, transparent 48%, rgba(0,0,0,0.35) 50%, transparent 52%)",
        }}
      /> */}

      <div
        className="absolute inset-0 flex items-start justify-start"
        style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
      >
        {characterImageSrc && !imgError ? (
          <img
            src={characterImageSrc}
            alt=""
            className="w-full h-full object-cover object-left"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-[#9b5cff]" />
        )}
        {onCharacterClick && (
          <button
            type="button"
            onClick={onCharacterClick}
            className="absolute inset-0"
            style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
            aria-label="Open character"
          />
        )}
      </div>

      <div
        className="absolute inset-0 flex items-end justify-end text-lg pr-1 pb-1"
        style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
      >
        <EmojiAvatar
          emoji={emoji}
          size={computedHeight}
          className=""
        />
      </div>
    </div>
  );
};
