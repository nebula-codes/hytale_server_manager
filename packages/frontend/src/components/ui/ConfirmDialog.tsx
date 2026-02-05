import { Modal, ModalFooter } from './Modal';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
}

export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  loading = false,
}: ConfirmDialogProps) => {
  const { t } = useTranslation();
  const variantStyles = {
    danger: {
      icon: 'text-danger',
      bg: 'bg-danger/20',
    },
    warning: {
      icon: 'text-warning',
      bg: 'bg-warning/20',
    },
    info: {
      icon: 'text-accent-primary',
      bg: 'bg-accent-primary/20',
    },
  };

  const style = variantStyles[variant];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="flex flex-col items-center text-center">
        <div className={`p-4 rounded-full ${style.bg} mb-4`}>
          <AlertTriangle size={32} className={style.icon} />
        </div>
        <p className="text-text-light-primary dark:text-text-primary mb-2">
          {message}
        </p>
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel ?? t('common.confirm')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
