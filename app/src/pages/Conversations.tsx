import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ChatHeader } from '../components/ChatHeader';
import { ChatSplitAvatar } from '../components/ChatSplitAvatar';
import { ChatTranscript, type ChatMessage } from '../components/ChatTranscript';
import { useActiveUser } from '../state/ActiveUserContext';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://127.0.0.1:8000';

export const Conversations = () => {
  const navigate = useNavigate();
  const { activeUser } = useActiveUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [thread, setThread] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});
  const [userEmojiById, setUserEmojiById] = useState<Record<string, string>>({});
  const [personalityNameById, setPersonalityNameById] = useState<Record<string, string>>({});
  const [personalityImageById, setPersonalityImageById] = useState<Record<string, string | null>>({});

  const GLOBAL_PERSONALITY_IMAGE_BASE_URL = 'https://pub-a64cd21521e44c81a85db631f1cdaacc.r2.dev';

  const imageSrcForPersonality = (p: any) => {
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

  const loadSessions = async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await api.getSessions(100, 0, activeUser?.id || null);
      setSessions(data);
    } catch (e: any) {
      if (e?.status === 404) {
        setSessions([]);
        setError(`API does not provide /sessions at ${API_BASE} (likely running an old sidecar binary, or you are pointing at the wrong server). Rebuild/copy the latest sidecar and try again.`);
      } else {
        setError(e?.message || 'Failed to load conversations');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setError(null);
        const data = await api.getSessions(100, 0, activeUser?.id || null);
        if (!cancelled) setSessions(data);
      } catch (e: any) {
        if (!cancelled) {
          if (e?.status === 404) {
            setSessions([]);
            setError(`API does not provide /sessions at ${API_BASE} (likely running an old sidecar binary, or you are pointing at the wrong server). Rebuild/copy the latest sidecar and try again.`);
          } else {
            setError(e?.message || 'Failed to load conversations');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [activeUser?.id]);

  useEffect(() => {
    const id = searchParams.get('session');
    if (!id) return;
    if (selectedSessionId === id) return;
    // Deep-link: open session thread and keep URL stable
    openSession(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openSession = async (sessionId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('session', sessionId);
      return next;
    });
    setSelectedSessionId(sessionId);
    setLoadingThread(true);
    setError(null);
    try {
      const data = await api.getConversationsBySession(sessionId);
      setThread(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load session thread');
      setThread([]);
    } finally {
      setLoadingThread(false);
    }
  };

  const formatDuration = (durationSec: number) => {
    const total = Math.max(0, Math.round(durationSec));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  useEffect(() => {
    let cancelled = false;

    const loadNames = async () => {
      try {
        const [users, personalities] = await Promise.all([
          api.getUsers().catch(() => []),
          api.getPersonalities(true).catch(() => []),
        ]);

        if (cancelled) return;

        const uMap: Record<string, string> = {};
        const uEmojiMap: Record<string, string> = {};
        for (const u of users || []) {
          if (u?.id && u?.name) uMap[u.id] = u.name;
          if (u?.id && u?.avatar_emoji) uEmojiMap[u.id] = u.avatar_emoji;
        }

        const pMap: Record<string, string> = {};
        const pImgMap: Record<string, string | null> = {};
        for (const p of personalities || []) {
          if (p?.id && p?.name) pMap[p.id] = p.name;
          if (p?.id) pImgMap[p.id] = imageSrcForPersonality(p);
        }

        setUserNameById(uMap);
        setUserEmojiById(uEmojiMap);
        setPersonalityNameById(pMap);
        setPersonalityImageById(pImgMap);
      } catch {
        if (!cancelled) {
          setUserNameById({});
          setUserEmojiById({});
          setPersonalityNameById({});
          setPersonalityImageById({});
        }
      }
    };

    loadNames();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSession = sessions.find((s: any) => s?.id === selectedSessionId);
  const selectedUserName = selectedSession?.user_id ? (userNameById[selectedSession.user_id] || null) : null;
  const selectedPersonalityName = selectedSession?.personality_id
    ? (personalityNameById[selectedSession.personality_id] || null)
    : null;
  const selectedPersonalityImage = selectedSession?.personality_id
    ? (personalityImageById[selectedSession.personality_id] || null)
    : null;
  const selectedUserEmoji = selectedSession?.user_id ? (userEmojiById[selectedSession.user_id] || null) : null;

  const threadMessages = useMemo<ChatMessage[]>(
    () =>
      thread.map((c: any) => ({
        id: String(c.id),
        role: c.role === 'ai' ? 'ai' : 'user',
        text: c.transcript || '',
        timestamp: (c.timestamp || 0) * 1000,
      })),
    [thread]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl font-black">CONVERSATIONS</h2>
        {selectedSessionId && (
          <button
            type="button"
            className="retro-btn retro-btn-outline bg-white"
            onClick={() => {
              setSelectedSessionId(null);
              setThread([]);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('session');
                return next;
              });
            }}
          >
            <span className="inline-flex items-center gap-2">
              <ArrowLeft size={16} />
              Back
            </span>
          </button>
        )}
      </div>

      {loading && (
        <div className="retro-card font-mono text-sm mb-4">Loading…</div>
      )}
      {error && !loading && (
        <div className="bg-white border-2 border-black rounded-[18px] px-4 py-4 mb-4 retro-shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-red-700">Error</div>
          <div className="font-mono text-sm text-gray-800 mt-2 wrap-break-word">{error}</div>
          <div className="font-mono text-[11px] text-gray-500 mt-2">
            Check that the API server is running and that your UI is pointing at the correct base URL.
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" className="retro-btn" onClick={loadSessions}>
              Retry
            </button>
          </div>
        </div>
      )}

      {!selectedSessionId && !loading && !error && (
        <div className="space-y-4">
          {sessions.map((s: any) => (
            <button
              key={s.id}
              type="button"
              className="retro-card border-0 w-full text-left bg-white rounded-[18px] px-4 py-4 hover:bg-[#fff3b0] transition-colors"
              onClick={() => openSession(s.id)}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 text-left">
                  <ChatSplitAvatar
                    size={56}
                    ratio={1.8}
                    userEmoji={s?.user_id ? userEmojiById[s.user_id] : null}
                    characterImageSrc={s?.personality_id ? personalityImageById[s.personality_id] : null}
                    onCharacterClick={
                      s?.personality_id
                        ? (e) => {
                            e?.stopPropagation();
                            navigate(`/?tab=personality&focus=${encodeURIComponent(String(s.personality_id))}`);
                          }
                        : undefined
                    }
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold uppercase tracking-wider">Chat</div>
                    <div className="font-mono text-sm text-gray-900 truncate">
                      {(s?.user_id ? (userNameById[s.user_id] || 'User') : 'User') + ' <> ' + (s?.personality_id ? (personalityNameById[s.personality_id] || 'Personality') : 'Personality')}
                    </div>
                    <div className="mt-1 font-mono text-xs text-gray-500">
                      {s.started_at ? new Date(s.started_at * 1000).toLocaleString() : '—'}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold uppercase tracking-wider">Mode</div>
                  <div className="font-mono text-xs text-gray-700">{s.client_type}</div>
                  <div className="mt-2 font-mono text-md text-gray-500">
                    {typeof s.duration_sec === 'number' ? formatDuration(s.duration_sec) : ''}
                  </div>
                </div>
              </div>
            </button>
          ))}

          {sessions.length === 0 && (
            <div className="retro-card p-10 text-center">
              <div className="text-xl font-black uppercase">No conversations yet</div>
              <div className="font-mono text-sm text-gray-600 mt-3">
                Chat with the models to create a conversation, then come back here to view it.
              </div>
              <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
                <button type="button" className="retro-btn" onClick={() => navigate('/')}>
                  Choose 
                </button>
                <button type="button" className="retro-btn retro-btn-outline bg-white" onClick={loadSessions}>
                  Refresh
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedSessionId && (
        <div className="space-y-4">
          <ChatHeader
            userName={selectedUserName || 'User'}
            characterName={selectedPersonalityName || 'Personality'}
            userEmoji={selectedUserEmoji}
            characterImageSrc={selectedPersonalityImage}
            onCharacterClick={
              selectedSession?.personality_id
                ? () => navigate(`/?tab=personality&focus=${encodeURIComponent(String(selectedSession.personality_id))}`)
                : undefined
            }
          />

          {loadingThread && (
            <div className="retro-card font-mono text-sm">Loading session…</div>
          )}

          {!loadingThread && <ChatTranscript messages={threadMessages} emptyLabel="EMPTY SESSION" />}
        </div>
      )}
    </div>
  );
};
