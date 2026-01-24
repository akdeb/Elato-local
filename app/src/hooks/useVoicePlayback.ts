import { useEffect, useRef, useState } from "react";

type GetSrc = (voiceId: string) => Promise<string | null>;

export const useVoicePlayback = (getSrc: GetSrc) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const stop = () => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {
        // ignore
      }
    }
    audioRef.current = null;
    setPlayingVoiceId(null);
    setIsPaused(false);
  };

  const toggle = async (voiceId: string) => {
    // Toggle pause/resume when clicking the same voice.
    if (playingVoiceId === voiceId && audioRef.current) {
      if (audioRef.current.paused) {
        await audioRef.current.play();
        setIsPaused(false);
      } else {
        audioRef.current.pause();
        setIsPaused(true);
      }
      return;
    }

    // Switching voices.
    stop();

    const src = await getSrc(voiceId);
    if (!src) return;

    const audio = new Audio(src);
    audioRef.current = audio;
    setPlayingVoiceId(voiceId);
    setIsPaused(false);

    audio.onended = () => {
      audioRef.current = null;
      setPlayingVoiceId(null);
      setIsPaused(false);
    };

    await audio.play();
  };

  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    playingVoiceId,
    isPaused,
    toggle,
    stop,
  };
};
