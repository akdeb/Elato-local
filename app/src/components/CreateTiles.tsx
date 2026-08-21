import React from "react";
import { MessageCircle, Mic } from "lucide-react";

export type CreateTileKind = "game" | "story" | "character" | "voice";

type CreateTilesProps = {
  includeVoice?: boolean;
  iconSize?: number;
  onSelect: (kind: CreateTileKind) => void;
};

const TILE_CONFIG: Array<{
  kind: CreateTileKind;
  label: string;
  helper: string;
  accent: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    kind: "character",
    label: "Character",
    helper: "Create a storytelling experience",
    accent: "var(--color-retro-accent)",
    Icon: MessageCircle,
  },
  {
    kind: "voice",
    label: "Voice",
    helper: "Clone a voice",
    accent: "var(--color-retro-orange)",
    Icon: Mic,
  },
];

export const CreateTiles = ({
  includeVoice = true,
  iconSize = 24,
  onSelect,
}: CreateTilesProps) => {
  const tiles = includeVoice ? TILE_CONFIG : TILE_CONFIG.filter((t) => t.kind !== "voice");

  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map(({ kind, label, helper, accent, Icon }) => (
        <button
          key={kind}
          type="button"
          className="retro-card w-full text-left flex flex-col gap-2 p-4 hover:border-gray-300 transition-colors cursor-pointer"
          onClick={() => onSelect(kind)}
        >
          <span className="shrink-0" style={{ color: accent }}>
            <Icon size={iconSize} />
          </span>
          <span className="label-mono" style={{ color: "var(--ink)" }}>
            {label}
          </span>
          <span className="text-xs text-gray-500">{helper}</span>
        </button>
      ))}
    </div>
  );
};
