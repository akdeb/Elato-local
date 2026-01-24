import { useEffect, useState } from 'react';
import { api } from '../api';
import { Pencil, User } from 'lucide-react';
import { AddUserModal } from '../components/AddUserModal';
import { EditUserModal } from '../components/EditUserModal';
import { useActiveUser } from '../state/ActiveUserContext';

export const UsersPage = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const { refreshUsers, setActiveUserId } = useActiveUser();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setError(null);
        const data = await api.getUsers();
        if (!cancelled) setUsers(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load users');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-black">MEMBERS</h2>
        <button className="retro-btn" onClick={() => setAddOpen(true)}>
          + Add
        </button>
      </div>

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          await refreshUsers();
          const next = await api.getUsers();
          setUsers(next); // Explicitly update local state
          if (next && next.length > 0) {
            const newest = next[next.length - 1];
            // Only set active if it's the first user ever
            if (next.length === 1 && newest?.id) {
              await setActiveUserId(newest.id);
            }
          }
        }}
      />

      <EditUserModal
        open={editOpen}
        user={editingUser}
        onClose={() => {
          setEditOpen(false);
          setEditingUser(null);
        }}
        onSaved={async () => {
          await refreshUsers();
          const data = await api.getUsers();
          setUsers(data);
        }}
      />

      {loading && (
        <div className="retro-card font-mono text-sm mb-4">Loading…</div>
      )}
      {error && (
        <div className="retro-card font-mono text-sm mb-4">{error}</div>
      )}
      {!loading && !error && users.length === 0 && (
        <div className="retro-card font-mono text-sm mb-4">No members found.</div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {users.map((u) => (
          <div key={u.id} className="retro-card relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <button
              type="button"
              className="retro-icon-btn absolute top-3 right-3"
              aria-label="Edit user"
              onClick={() => {
                setEditingUser(u);
                setEditOpen(true);
              }}
            >
              <Pencil size={16} />
            </button>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#CF79FF] border-2 border-black flex items-center justify-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <User className="text-white" size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  {u.name}
                  <span className="text-xs bg-black text-white px-2 py-0.5 uppercase">
                    {u.user_type || 'family'}
                  </span>
                </h3>
                <div className="flex gap-4 text-sm text-gray-600 mt-1">
                  <span>Age: {u.age || 'N/A'}</span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-end gap-2 pr-8 w-full sm:w-[320px] sm:max-w-[45%] overflow-hidden">
              <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
                About you
              </div>
              <div className="font-mono text-xs text-gray-700 text-right whitespace-pre-wrap break-all retro-clamp-3">
                {u.about_you ? String(u.about_you) : '—'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
