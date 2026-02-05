import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
}: ModalProps) => {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const sizes = {
    sm: 'sm:max-w-md',
    md: 'sm:max-w-2xl',
    lg: 'sm:max-w-4xl',
    xl: 'sm:max-w-6xl',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`relative w-full h-full sm:h-auto ${sizes[size]} glass-card sm:max-h-[90vh] overflow-auto custom-scrollbar sm:rounded-lg p-4 sm:p-6`}
          >
            {/* Header */}
            {(title || showCloseButton) && (
              <div className="flex items-center justify-between mb-3 sm:mb-4 pb-3 sm:pb-4 border-b border-gray-300 dark:border-gray-800">
                {title && <h2 className="text-xl sm:text-2xl font-heading font-semibold text-text-light-primary dark:text-text-primary">{title}</h2>}
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="ml-auto p-2 sm:p-1 -mr-2 sm:mr-0 text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:text-text-primary transition-colors"
                    aria-label={t('common.close')}
                  >
                    <X size={28} className="sm:w-6 sm:h-6" />
                  </button>
                )}
              </div>
            )}

            {/* Content */}
            <div>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export const ModalFooter = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-300 dark:border-gray-800 flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 ${className}`}>
    {children}
  </div>
);
