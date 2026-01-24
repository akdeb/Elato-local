import { useEffect, useState } from 'react';
import { api } from '../api';
import { Bot, User, ArrowLeft } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [personalityNameById, setPersonalityNameById] = useState<Record<string, string>>({});

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
        for (const u of users || []) {
          if (u?.id && u?.name) uMap[u.id] = u.name;
        }

        const pMap: Record<string, string> = {};
        for (const p of personalities || []) {
          if (p?.id && p?.name) pMap[p.id] = p.name;
        }

        setUserNameById(uMap);
        setPersonalityNameById(pMap);
      } catch {
        if (!cancelled) {
          setUserNameById({});
          setPersonalityNameById({});
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

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl font-black">CONVERSATIONS</h2>
        {selectedSessionId && (
          <button
            type="button"
            className="retro-btn bg-white"
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
          <div className="font-mono text-sm text-gray-800 mt-2 break-words">{error}</div>
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
              className="retro-card w-full text-left bg-white rounded-[18px] px-4 py-4 hover:bg-[#fff3b0] transition-colors"
              onClick={() => openSession(s.id)}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">Chat</div>
                  <div className="font-mono text-sm text-gray-900 break-words">
                    {(s?.user_id ? (userNameById[s.user_id] || 'User') : 'User') + ' <> ' + (s?.personality_id ? (personalityNameById[s.personality_id] || 'Personality') : 'Personality')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold uppercase tracking-wider">Mode</div>
                  <div className="font-mono text-xs text-gray-700">{s.client_type}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="font-mono text-xs text-gray-500">
                  {s.started_at ? new Date(s.started_at * 1000).toLocaleString() : '—'}
                </div>
                <div className="font-mono text-md text-gray-500">
                  {typeof s.duration_sec === 'number' ? formatDuration(s.duration_sec) : ''}
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
                <button type="button" className="retro-btn" onClick={() => navigate('/test')}>
                  Open Test
                </button>
                <button type="button" className="retro-btn bg-white" onClick={loadSessions}>
                  Refresh
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedSessionId && (
        <div className="space-y-4">
          <div className="bg-white border border-black rounded-[18px] px-4 py-3 retro-shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider">Chat</div>
            <div className="font-mono text-sm text-gray-900 break-words">
              {(selectedUserName || 'User') + ' <> ' + (selectedPersonalityName || 'Personality')}
            </div>
          </div>

          {loadingThread && (
            <div className="retro-card font-mono text-sm">Loading session…</div>
          )}

          {!loadingThread && (
            <div className="bg-white border border-black rounded-[18px] overflow-hidden retro-shadow-sm">
              {thread.map((c: any, i: number) => (
                <div
                  key={c.id}
                  className={`p-4 flex gap-4 ${i !== thread.length - 1 ? 'border-b border-black' : ''} ${c.role === 'ai' ? 'bg-[#f3efff]' : 'bg-white'}`}
                >
                  <div className={`w-8 h-8 shrink-0 border border-black rounded-full flex items-center justify-center ${c.role === 'ai' ? 'bg-[#9b5cff]' : 'bg-[#00c853]'}`}>
                    {c.role === 'ai' ? <Bot size={16} className="text-white" /> : <User size={16} className="text-white" />}
                  </div>

                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold uppercase text-xs tracking-wider">
                        {c.role === 'ai' ? 'SYSTEM' : 'OPERATOR'}
                      </span>
                      <span className="font-mono text-xs text-gray-500">
                        {new Date(c.timestamp * 1000).toLocaleString()}
                      </span>
                    </div>
                    <p className="font-medium leading-relaxed">{c.transcript}</p>
                  </div>
                </div>
              ))}

              {thread.length === 0 && (
                <div className="p-8 text-center font-mono text-gray-500">
                  EMPTY SESSION
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
