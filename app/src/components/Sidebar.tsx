import { Link, useLocation } from 'react-router-dom';
import { Users, Cpu, LockKeyhole, MessagesSquare, Volume2, LayoutGrid } from 'lucide-react';
import clsx from 'clsx';
import { useActiveUser } from '../state/ActiveUserContext';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { User } from 'lucide-react';
import logoPng from '../assets/logo.png';

const NavItem = ({
  to,
  icon: Icon,
  label,
  trailingIcon: TrailingIcon,
  trailingTooltip,
}: {
  to: string;
  icon: any;
  label: string;
  trailingIcon?: any;
  trailingTooltip?: string;
}) => {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      className={clsx(
        "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#fff3b0]",
        isActive 
          ? "bg-[#ffd400] text-black" 
          : "bg-white"
      )}
      title={trailingTooltip}
    >
      <Icon size={20} />
      <span className="font-bold flex-1">{label}</span>
      {TrailingIcon && <TrailingIcon size={16} className="opacity-70 flex-shrink-0" />}
    </Link>
  );
};

export const Sidebar = () => {
  const { users, activeUserId, activeUser, setActiveUserId } = useActiveUser();
  const [_activePersonalityName, setActivePersonalityName] = useState<string | null>(null);
  const [_deviceConnected, setDeviceConnected] = useState<boolean>(false);
  const [_deviceSessionId, setDeviceSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const ds = { connected: false, session_id: null };
        // const ds = await api.getDeviceStatus().catch(() => ({ connected: false, session_id: null }));
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
        if (!cancelled) setActivePersonalityName(selected?.name || null);
      } catch {
        // ignore
      }
    };

    load();
  }, [activeUser?.current_personality_id]);

  return (
    <div className="w-64 shrink-0 bg-transparent p-6 flex flex-col gap-6 h-full overflow-y-auto overscroll-contain">
      <div className="border-2 border-black rounded-[24px] overflow-hidden">
        <div className="p-4 bg-[#CF79FF] text-white">
          <div className="flex items-center gap-2">
            <img src={logoPng} alt="" className="w-12 h-12" />
            <h1 className="text-2xl tracking-wider brand-font mt-1 text-white">ELATO</h1>
          </div>
          <p className="text-xs font-mono opacity-90">Epic Local AI Toys</p>
        </div>
        <div className="bg-transparent border-t-2 border-black">
          <nav className="flex flex-col">
            <NavItem to="/" icon={LayoutGrid} label="Personalities" />
            <NavItem to="/voices" icon={Volume2} label="Voices" />
            <NavItem to="/conversations" icon={MessagesSquare} label="Sessions" trailingIcon={LockKeyhole} trailingTooltip="Private & secure" />
            <NavItem to="/users" icon={Users} label="Members" />
            <NavItem to="/settings" icon={Cpu} label="AI Settings" />
          </nav>
        </div>
                <div className="p-4 bg-transparent border-t-2 border-black">
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">
              Active
            </div>
            <div className="flex items-center gap-2">
              <User />
              <select
                className="w-full px-3 py-2 bg-white text-black border-2 border-black rounded-[18px]"
                value={activeUserId || ''}
                onChange={(e) => setActiveUserId(e.target.value || null)}
              >
                {users.length === 0 && <option value="">No members</option>}
                {users.length > 0 && !activeUserId && <option value="">Select User...</option>}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

      </div>
      
    </div>
  );
};
