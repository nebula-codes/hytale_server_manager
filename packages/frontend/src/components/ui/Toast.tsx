import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore, type Toast as ToastType } from '../../stores/toastStore';
import { useTranslation } from 'react-i18next';

const Toast = ({ toast }: { toast: ToastType }) => {
  const { t } = useTranslation();
  const removeToast = useToastStore((state) => state.removeToast);
  const [progress, setProgress] = useState(100);

  const duration = toast.duration ?? 5000;

  useEffect(() => {
    if (duration <= 0) return;

    const interval = 50; // Update every 50ms
    const decrement = (interval / duration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        const next = prev - decrement;
        return next <= 0 ? 0 : next;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [duration]);

  const icons = {
    success: <CheckCircle size={20} />,
    error: <XCircle size={20} />,
    warning: <AlertTriangle size={20} />,
    info: <Info size={20} />,
  };

  const styles = {
    success: 'bg-success/10 border-success text-success',
    error: 'bg-danger/10 border-danger text-danger',
    warning: 'bg-warning/10 border-warning text-warning',
    info: 'bg-accent-primary/10 border-accent-primary text-accent-primary',
  };

  const progressStyles = {
    success: 'bg-success',
    error: 'bg-danger',
    warning: 'bg-warning',
    info: 'bg-accent-primary',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      className={`relative flex items-start gap-3 p-4 rounded-lg border-2 ${styles[toast.type]} backdrop-blur-sm shadow-lg min-w-[320px] max-w-[420px]`}
    >
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">{icons[toast.type]}</div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-heading font-semibold text-text-primary">
          {toast.title}
        </p>
        {toast.message && (
          <p className="text-xs text-text-muted mt-1">{toast.message}</p>
        )}
      </div>

      {/* Close Button */}
      <button
        onClick={() => removeToast(toast.id)}
        className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors"
        aria-label={t('ui.toast.close_aria')}
      >
        <X size={16} />
      </button>

      {/* Progress Bar */}
      {duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800/30 rounded-b-lg overflow-hidden">
          <motion.div
            className={`h-full ${progressStyles[toast.type]}`}
            style={{ width: `${progress}%` }}
            transition={{ duration: 0.05, ease: 'linear' }}
          />
        </div>
      )}
    </motion.div>
  );
};

export const ToastContainer = () => {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast toast={toast} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
};
