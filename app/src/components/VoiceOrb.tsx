import { useMemo } from 'react';
import { Orb, type OrbState } from 'orb-ui';
import { useVoiceWs } from '../state/VoiceWsContext';
import { useAudienceMode } from '../state/AudienceModeContext';

type Props = {
  /** ESP32 view: the toy holds the mic, so there are no local audio levels. */
  viewOnly?: boolean;
  /** Connection state for the ESP32 view, where voiceWs is not the source. */
  deviceConnected?: boolean;
  /** Diameter in px. Defaults to the header size; the centred view passes a larger one. */
  size?: number;
  className?: string;
};

/**
 * The live session orb. Driven from VoiceWsContext rather than an orb-ui
 * adapter, since the session already runs over our own websocket.
 */
export const VoiceOrb = ({ viewOnly = false, deviceConnected = false, size, className }: Props) => {
  const voiceWs = useVoiceWs();
  const { isKid } = useAudienceMode();

  const { state, volume } = useMemo((): { state: OrbState; volume: number } => {
    if (viewOnly) {
      // Only the connection is observable here; the device does its own capture.
      return { state: deviceConnected ? 'listening' : 'idle', volume: 0 };
    }
    if (voiceWs.status === 'error') return { state: 'error', volume: 0 };
    if (voiceWs.status === 'connecting') return { state: 'connecting', volume: 0 };
    if (voiceWs.status !== 'connected') return { state: 'idle', volume: 0 };

    if (voiceWs.isSpeaking) return { state: 'speaking', volume: voiceWs.ttsLevel };
    if (voiceWs.isRecording && !voiceWs.isPaused) {
      return { state: 'listening', volume: voiceWs.micLevel };
    }
    // Paused mid-turn, or connected with the mic not yet open: work in progress.
    return { state: 'thinking', volume: 0 };
  }, [
    viewOnly,
    deviceConnected,
    voiceWs.status,
    voiceWs.isSpeaking,
    voiceWs.isRecording,
    voiceWs.isPaused,
    voiceWs.micLevel,
    voiceWs.ttsLevel,
  ]);

  return (
    <Orb
      state={state}
      volume={volume}
      // "cloud" is the only theme that reads as an orb at this size and whose
      // blue-violet sits close to both accents; "bars" renders tiny and washed
      // out, "circle" is a flat grey disc, "radial" clashes with the palette.
      theme="cloud"
      size={size ?? (isKid ? 140 : 120)}
      // Session controls live in the dock and on this page, not on the orb.
      interactive={false}
      className={className}
      aria-label={`Voice status: ${state}`}
    />
  );
};
