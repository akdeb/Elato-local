import { UserModal } from "./UserModal";

type AddUserModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
};

export function AddUserModal({ open, onClose, onCreated }: AddUserModalProps) {
  return <UserModal open={open} mode="create" onClose={onClose} onSuccess={onCreated} />;
}
