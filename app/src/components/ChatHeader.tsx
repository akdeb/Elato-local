import { ChatSplitAvatar } from "./ChatSplitAvatar";

type ChatHeaderProps = {
  userName: string;
  characterName: string;
  userEmoji?: string | null;
  characterImageSrc?: string | null;
  onCharacterClick?: () => void;
  className?: string;
};

export const ChatHeader = ({
  userName,
  characterName,
  userEmoji,
  characterImageSrc,
  onCharacterClick,
  className = "",
}: ChatHeaderProps) => {
  return (
    <div className={`bg-transparent border-0 shadow-none rounded-none px-4 py-3 ${className}`}>
      <div className="flex items-center gap-3">
        <ChatSplitAvatar
          size={48}
          userEmoji={userEmoji}
          characterImageSrc={characterImageSrc}
          onCharacterClick={onCharacterClick}
        />

        <div>
          <div className="label-mono">Session</div>
          <div className="font-mono text-[13px] text-gray-900 wrap-break-word">
            {userName} <span className="text-gray-400">{"<>"}</span> {characterName}
          </div>
        </div>
      </div>
    </div>
  );
};
