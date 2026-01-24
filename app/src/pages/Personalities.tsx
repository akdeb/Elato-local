import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Image as ImageIcon, Pencil, Trash2 } from 'lucide-react';
import { useActiveUser } from '../state/ActiveUserContext';
import { PersonalityModal, PersonalityForModal } from '../components/PersonalityModal';
import { Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { VoiceActionButtons } from '../components/VoiceActionButtons';
import { useVoicePlayback } from '../hooks/useVoicePlayback';

export const Personalities = () => {
  const [personalities, setPersonalities] = useState<any[]>([]);
  const [voices, setVoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brokenImgByPersonalityId, setBrokenImgByPersonalityId] = useState<Record<string, boolean>>({});
  const [downloadedVoiceIds, setDownloadedVoiceIds] = useState<Set<string>>(new Set());
  const [downloadingVoiceId, setDownloadingVoiceId] = useState<string | null>(null);
  const [audioSrcByVoiceId, setAudioSrcByVoiceId] = useState<Record<string, string>>({});

  const { playingVoiceId, isPaused, toggle: toggleVoice } = useVoicePlayback(async (voiceId) => {
    let src = audioSrcByVoiceId[voiceId];
    if (!src) {
      const b64 = await invoke<string | null>('read_voice_base64', { voiceId });
      if (!b64) return null;
      src = `data:audio/wav;base64,${b64}`;
      setAudioSrcByVoiceId((prev) => ({ ...prev, [voiceId]: src! }));
    }
    return src;
  });
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedPersonality, setSelectedPersonality] = useState<PersonalityForModal | null>(null);

  const { activeUserId, activeUser, refreshUsers } = useActiveUser();

  const GLOBAL_PERSONALITY_IMAGE_BASE_URL = 'https://pub-a64cd21521e44c81a85db631f1cdaacc.r2.dev';

  const imgSrcForPersonality = (p: any) => {
    if (p?.is_global) {
      const personalityId = p?.id != null ? String(p.id) : '';
      if (!personalityId) return null;
      return `${GLOBAL_PERSONALITY_IMAGE_BASE_URL}/${encodeURIComponent(personalityId)}.png`;
    }
    const src = typeof p?.img_src === 'string' ? p.img_src.trim() : '';
    if (!src) return null;
    if (/^https?:\/\//i.test(src)) return src;
    return convertFileSrc(src);
  };

  const toTimestamp = (v: any) => {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const asNum = Number(v);
      if (Number.isFinite(asNum)) return asNum;
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return Math.floor(ms / 1000);
    }
    return 0;
  };

  const load = async () => {
    try {
      setError(null);
      const data = await api.getPersonalities(false);
      setPersonalities(data);
      setBrokenImgByPersonalityId({});
    } catch (e: any) {
      setError(e?.message || 'Failed to load personalities');
    } finally {
      setLoading(false);
    }
  };

  const sortedPersonalities = useMemo(() => {
    const arr = Array.isArray(personalities) ? personalities.slice() : [];
    arr.sort((a, b) => {
      const aG = Boolean(a?.is_global);
      const bG = Boolean(b?.is_global);
      if (aG !== bG) return aG ? 1 : -1;
      const aT = toTimestamp(a?.created_at);
      const bT = toTimestamp(b?.created_at);
      if (aT !== bT) return bT - aT;
      return 0;
    });
    return arr;
  }, [personalities]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadDownloaded = async () => {
      try {
        const ids = await invoke<string[]>('list_downloaded_voices');
        if (!cancelled) setDownloadedVoiceIds(new Set(Array.isArray(ids) ? ids : []));
      } catch {
        if (!cancelled) setDownloadedVoiceIds(new Set());
      }
    };
    loadDownloaded();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadVoices = async () => {
      try {
        const data = await api.getVoices();
        if (!cancelled) setVoices(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setVoices([]);
      }
    };
    loadVoices();
    return () => {
      cancelled = true;
    };
  }, []);

  const voiceById = useMemo(() => {
    const m = new Map<string, any>();
    for (const v of voices) {
      if (v?.voice_id) m.set(String(v.voice_id), v);
    }
    return m;
  }, [voices]);

  const downloadVoice = async (voiceId: string) => {
    setDownloadingVoiceId(voiceId);
    try {
      await invoke<string>('download_voice', { voiceId });
      setDownloadedVoiceIds((prev) => {
        const next = new Set(prev);
        next.add(voiceId);
        return next;
      });
      try {
        window.dispatchEvent(new CustomEvent('voice:downloaded', { detail: { voiceId } }));
      } catch {
        // ignore
      }
    } catch (e: any) {
      console.error('download_voice failed', e);
      const msg = typeof e === 'string' ? e : e?.message ? String(e.message) : String(e);
      setError(msg || 'Failed to download voice');
    } finally {
      setDownloadingVoiceId(null);
    }
  };

  const togglePlay = async (voiceId: string) => {
    if (!downloadedVoiceIds.has(voiceId)) return;
    try {
      await toggleVoice(voiceId);
    } catch (e) {
      console.error('toggleVoice failed', e);
    }
  };

  const assignToActiveUser = async (personalityId: string) => {
    if (!activeUserId) {
      setError('Select an active user first');
      return;
    }
    try {
      setError(null);
      await api.updateUser(activeUserId, { current_personality_id: personalityId });
      await refreshUsers();
      try {
        await api.setAppMode('chat');
      } catch {
        // non-blocking
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to assign personality');
    }
  };

  const deletePersonality = async (p: any) => {
    if (p?.is_global) return;
    try {
      setError(null);
      await api.deletePersonality(p.id);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete personality');
    }
  };

  const handleCreate = () => {
    setModalMode('create');
    setSelectedPersonality(null);
    setModalOpen(true);
  };

  const handleEdit = (p: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setModalMode('edit');
    setSelectedPersonality(p);
    setModalOpen(true);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-black">PERSONALITIES</h2>
        <button 
          className="retro-btn"
          onClick={handleCreate}
        >
          + Create
        </button>
      </div>

      <PersonalityModal 
        open={modalOpen}
        mode={modalMode}
        personality={selectedPersonality}
        onClose={() => setModalOpen(false)}
        onSuccess={async () => {
          await load();
        }}
      />

      {loading && (
        <div className="retro-card font-mono text-sm">Loading…</div>
      )}
      {error && (
        <div className="retro-card font-mono text-sm">{error}</div>
      )}
      {!loading && !error && personalities.length === 0 && (
        <div className="retro-card font-mono text-sm">No personalities found.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sortedPersonalities.map((p) => (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => assignToActiveUser(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') assignToActiveUser(p.id);
            }}
            className={`retro-card relative group text-left cursor-pointer transition-shadow flex flex-col ${activeUser?.current_personality_id === p.id ? 'retro-selected' : 'retro-not-selected'}`}
          >
            <div className="absolute top-2 right-2 flex flex-col items-center gap-2 z-10">
              {!p.is_global && (
                <button
                  type="button"
                  className="retro-icon-btn"
                  aria-label="Edit personality"
                  onClick={(e) => handleEdit(p, e)}
                  title="Edit"
                >
                  <Pencil size={16} />
                </button>
              )}

              {!p.is_global && (
                <button
                  type="button"
                  className="retro-icon-btn"
                  aria-label="Delete personality"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deletePersonality(p);
                  }}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            <div className={`flex flex-col items-start gap-4 ${p.is_global ? '' : 'pr-6'}`}>
              {!p.is_global ? (
                <label
                  className={`w-full h-[100px] rounded-[14px] ${imgSrcForPersonality(p) ? 'retro-dotted' : ''} bg-white flex items-center justify-center cursor-pointer overflow-hidden`}
                  title="Upload character image"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {imgSrcForPersonality(p) && !brokenImgByPersonalityId[String(p.id)] ? (
                    <img
                      src={imgSrcForPersonality(p) || ''}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={() => {
                        setBrokenImgByPersonalityId((prev) => ({ ...prev, [String(p.id)]: true }));
                      }}
                    />
                  ) : (
                    <ImageIcon size={18} className="text-gray-600" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onClick={(e) => e.stopPropagation()}
                    onChange={async (e) => {
                      const f = e.target.files?.[0] || null;
                      if (!f) return;
                      try {
                        const buf = await f.arrayBuffer();
                        let binary = '';
                        const bytes = new Uint8Array(buf);
                        const chunkSize = 0x8000;
                        for (let i = 0; i < bytes.length; i += chunkSize) {
                          const chunk = bytes.subarray(i, i + chunkSize);
                          binary += String.fromCharCode(...chunk);
                        }
                        const b64 = btoa(binary);
                        const ext = (f.name.split('.').pop() || '').toLowerCase();
                        const savedPath = await invoke<string>('save_personality_image_base64', {
                          personalityId: String(p.id),
                          base64Image: b64,
                          ext: ext || null,
                        });

                        await api.updatePersonality(String(p.id), { img_src: savedPath });
                        await load();
                      } catch (err: any) {
                        setError(err?.message || 'Failed to save image');
                      }
                    }}
                  />
                </label>
              ) : (
                <div className="w-full h-[100px] rounded-[14px] bg-white flex items-center justify-center overflow-hidden">
                  {imgSrcForPersonality(p) && !brokenImgByPersonalityId[String(p.id)] ? (
                    <img
                      src={imgSrcForPersonality(p) || ''}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={() => {
                        setBrokenImgByPersonalityId((prev) => ({ ...prev, [String(p.id)]: true }));
                      }}
                    />
                  ) : (
                    <ImageIcon size={18} className="text-gray-600" />
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1 mb-2">
                <h3 className="text-xl font-black leading-tight break-words retro-clamp-2">{p.name}</h3>
                <p className="text-gray-600 text-sm font-medium mt-2 retro-clamp-2">
                  {p.short_description ? String(p.short_description) : '—'}
                </p>
              </div>
            </div>

            <div className="mt-auto border-t-2 border-black pt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-500">Voice</div>
                  <Link
                    to={`/voices?voice_id=${encodeURIComponent(p.voice_id)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block text-xs font-bold truncate"
                    title="View voice"
                  >
                    {voiceById.get(p.voice_id)?.voice_name || p.voice_id}
                  </Link>
                </div>

                <div className="shrink-0">
                  <VoiceActionButtons
                    voiceId={String(p.voice_id)}
                    isDownloaded={downloadedVoiceIds.has(String(p.voice_id))}
                    downloadingVoiceId={downloadingVoiceId}
                    onDownload={(id) => downloadVoice(id)}
                    onTogglePlay={(id) => togglePlay(id)}
                    isPlaying={playingVoiceId === String(p.voice_id)}
                    isPaused={isPaused}
                    stopPropagation
                    size="small"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
