import { UserModal, type UserForModal } from "./UserModal";

type EditUserModalProps = {
  open: boolean;
  user: UserForModal | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

export function EditUserModal({ open, user, onClose, onSaved }: EditUserModalProps) {
  return <UserModal open={open} mode="edit" user={user} onClose={onClose} onSuccess={onSaved} />;
}
