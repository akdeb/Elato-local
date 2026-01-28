import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useActiveUser } from '../state/ActiveUserContext';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useEffect, useState } from 'react';
import { Bot, ShieldCheck, Sparkles, X, RefreshCw } from 'lucide-react';
import { VoiceWsProvider, useVoiceWs } from '../state/VoiceWsContext';

const LayoutInner = () => {
  const { activeUser } = useActiveUser();
  const navigate = useNavigate();
  const voiceWs = useVoiceWs();
  const [activePersonalityName, setActivePersonalityName] = useState<string | null>(null);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [deviceConnected, setDeviceConnected] = useState<boolean>(false);
  const [deviceSessionId, setDeviceSessionId] = useState<string | null>(null);
  const [downloadedVoiceIds, setDownloadedVoiceIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Network monitoring
  const [initialIp, setInitialIp] = useState<string | null>(null);
  const [showNetworkBanner, setShowNetworkBanner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkIp = async () => {
      try {
        const info = await api.getNetworkInfo();
        if (cancelled) return;
        
        if (!initialIp) {
          setInitialIp(info.ip);
        } else if (info.ip !== initialIp) {
          setShowNetworkBanner(true);
        }
      } catch {
        // ignore errors
      }
    };

    checkIp();
    const interval = setInterval(checkIp, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [initialIp]);

  const sessionActive = deviceConnected || voiceWs.isActive;

  const statusLabel = sessionActive ? 'Chat in progress' : 'Ready to connect';
  const statusDotClass = sessionActive ? 'bg-emerald-500' : 'bg-green-400';
  const statusTextClass = sessionActive ? 'text-emerald-700' : 'text-gray-600';

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const ds = { connected: false, session_id: null };
        
        // await api.getDeviceStatus().catch(() => ({ connected: false, session_id: null }));
        if (!cancelled) {
          setDeviceConnected(!!ds?.connected);
          setDeviceSessionId(ds?.session_id || null);
        }

        const selectedId = activeUser?.current_personality_id;
        if (!selectedId) {
          if (!cancelled) setActivePersonalityName(null);
          return;
        }

        const ps = await api.getPersonalities(true).catch(() => []);
        const selected = ps.find((p: any) => p.id === selectedId);
        if (!cancelled) {
          setActivePersonalityName(selected?.name || null);
          setActiveVoiceId(selected?.voice_id ? String(selected.voice_id) : null);
        }
      } catch {
        // ignore
      }
    };

    load();
  }, [activeUser?.current_personality_id]);

  useEffect(() => {
    let cancelled = false;
    const loadDownloaded = async () => {
      try {
        const ids = await api.listDownloadedVoices();
        if (!cancelled) setDownloadedVoiceIds(new Set(Array.isArray(ids) ? ids : []));
      } catch {
        if (!cancelled) setDownloadedVoiceIds(new Set());
      }
    };
    loadDownloaded();
    return () => {
      cancelled = true;
    };
  }, [activeVoiceId]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const ids = await api.listDownloadedVoices();
        if (!cancelled) setDownloadedVoiceIds(new Set(Array.isArray(ids) ? ids : []));
      } catch {
        if (!cancelled) setDownloadedVoiceIds(new Set());
      }
    };

    const onDownloaded = () => {
      void refresh();
    };

    window.addEventListener('voice:downloaded', onDownloaded as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener('voice:downloaded', onDownloaded as EventListener);
    };
  }, []);

  const canStartChat =
    sessionActive || !activeVoiceId || downloadedVoiceIds.has(String(activeVoiceId));

  useEffect(() => {
    const onDeleted = () => {
      navigate('/');
    };
    window.addEventListener('voicews:empty-session-deleted', onDeleted as EventListener);
    return () => {
      window.removeEventListener('voicews:empty-session-deleted', onDeleted as EventListener);
    };
  }, [navigate]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-(--color-retro-bg)">
      {showNetworkBanner && (
        <div className="bg-(--color-retro-blue) text-white px-4 py-3 flex items-center justify-between shadow-md z-50 shrink-0 border-b-2 border-black">
          <div className="font-mono text-sm flex items-center gap-2">
            <RefreshCw className="animate-spin" size={16} />
            <span>
              <strong>WiFi Change Detected: Refresh your app so your toy can find you.</strong>
            </span>
          </div>
          <button   disabled={isRefreshing}
            onClick={async () => {
              try {
                setIsRefreshing(true);
                await api.restartMdns();
              } catch (e) {
                console.error("Failed to restart mDNS:", e);
              }
              setIsRefreshing(false);
              window.location.reload();
            }}
            className="flex items-center rounded-[12px] gap-2 bg-white text-black px-3 cursor-not-allowed py-1.5 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-px active:translate-y-px active:shadow-none font-bold text-xs uppercase hover:bg-gray-50 transition-all opacity-50"
          >
            Refresh
          </button>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-h-0 p-8 pb-36 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <Outlet />
        </div>

        {activeUser?.current_personality_id && (
          <div className="fixed bottom-0 z-20 left-64 right-0 pointer-events-none">
            <div className="max-w-4xl mx-auto px-8 pb-6 pointer-events-auto">
              <div className="bg-white border border-gray-200 rounded-full px-5 py-4 flex items-center justify-between shadow-[0_12px_24px_rgba(0,0,0,0.08)]">
                <div className="min-w-0">
                  <div className="flex items-center flex-row gap-3">
                    <div className="font-mono text-xs text-gray-500">Active</div>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 min-w-0">
                    <div className="font-black text-base text-black truncate">{activePersonalityName || '—'}</div>
                    <div className="inline-flex items-center gap-2 font-mono text-[11px] shrink-0">
                      <span className={`w-2 h-2 rounded-full border border-gray-300 ${statusDotClass} ${sessionActive ? 'retro-blink' : ''}`} />
                      <span className={statusTextClass}>{statusLabel}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-end">
                    <button
                      type="button"
                      className={`retro-btn no-lift ${sessionActive ? 'retro-btn-green' : '' } px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed`}
                      onClick={() => {
                        if (!canStartChat) return;
                        navigate('/test');
                        if (!sessionActive) {
                          voiceWs.connect();
                        }
                      }}
                      disabled={!canStartChat}
                    >
                    {sessionActive ? <Sparkles fill='currentColor' size={18} className="shrink-0" /> : <Bot size={18} className="shrink-0" />}
                    {sessionActive ? 'View' : 'Play'}
                    </button>
                    {!canStartChat && (
                      <div className="mt-1 font-mono text-xs text-gray-500">
                        Download voice to start chat
                      </div>
                    )}
                  </div>

                  {sessionActive && (
                    <button
                      // type="button"
                      className="retro-btn retro-btn-outline no-lift px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60"
                      onClick={() => {
                        voiceWs.disconnect();
                        const sid = voiceWs.latestSessionId;
                        if (sid) {
                          navigate(`/conversations?session=${encodeURIComponent(sid)}`);
                        } else {
                          navigate('/conversations');
                        }
                      }}
                      disabled={!sessionActive}
                    >
                      <X size={18} className="shrink-0" /> End
                    </button>
                  )}
                  {deviceConnected && deviceSessionId && (
                    <button
                      type="button"
                      className="retro-btn bg-white no-lift px-4 py-2 text-sm"
                      onClick={() => navigate(`/conversations?session=${encodeURIComponent(deviceSessionId)}`)}
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        </main>
      </div>
    </div>
  );
};

export const Layout = () => {
  return (
    <VoiceWsProvider>
      <LayoutInner />
    </VoiceWsProvider>
  );
};
