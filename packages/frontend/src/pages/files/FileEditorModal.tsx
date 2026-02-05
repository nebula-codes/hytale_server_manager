import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalFooter, Button } from '../../components/ui';
import { Save } from 'lucide-react';
import { api } from '../../services/api';

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: Date;
  extension?: string;
  isEditable: boolean;
}

interface FileEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  serverId: string;
  file: FileItem;
}

export const FileEditorModal = ({ isOpen, onClose, onSave, serverId, file }: FileEditorModalProps) => {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen && file) {
      loadFileContent();
    }
  }, [isOpen, file]);

  useEffect(() => {
    setHasChanges(content !== originalContent);
  }, [content, originalContent]);

  const loadFileContent = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await api.readFile(serverId, file.path);
      setContent(response.content);
      setOriginalContent(response.content);
    } catch (err: any) {
      console.error('Error reading file:', err);
      setError(err.message || t('files.editor.load_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      await api.writeFile(serverId, file.path, content);
      setOriginalContent(content);
      onSave();
      handleClose();
    } catch (err: any) {
      console.error('Error saving file:', err);
      setError(err.message || t('files.editor.save_error'));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      if (!confirm('You have unsaved changes. Are you sure you want to close?')) {
        return;
      }
    }

    setContent('');
    setOriginalContent('');
    setError('');
    setHasChanges(false);
    onClose();
  };

  const getFileLanguage = (): string => {
    const ext = file.extension?.toLowerCase();
    switch (ext) {
      case '.js': return 'JavaScript';
      case '.ts': return 'TypeScript';
      case '.json': return 'JSON';
      case '.yml':
      case '.yaml': return 'YAML';
      case '.xml': return 'XML';
      case '.html': return 'HTML';
      case '.css': return 'CSS';
      case '.properties': return 'Properties';
      case '.conf':
      case '.cfg': return 'Configuration';
      case '.sh': return 'Shell Script';
      case '.md': return 'Markdown';
      default: return 'Plain Text';
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('files.editor.title', { name: file.name })} size="xl">
      <div className="space-y-4">
        {/* File Info */}
        <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-900 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-light-primary dark:text-text-primary">
              {file.name}
            </p>
            <p className="text-xs text-text-light-muted dark:text-text-muted">
              {t('files.editor.meta', { lang: getFileLanguage(), size: (file.size / 1024).toFixed(2) })}
            </p>
          </div>
          {hasChanges && (
            <span className="text-xs text-warning font-medium">● {t('files.editor.unsaved')}</span>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-danger/10 border border-danger rounded-lg p-3">
            <p className="text-danger text-sm">{error}</p>
          </div>
        )}

        {/* Editor */}
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <p className="text-text-light-muted dark:text-text-muted">{t('files.editor.loading')}</p>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-[500px] bg-white dark:bg-primary-bg-secondary text-text-light-primary dark:text-text-primary font-mono text-sm p-4 rounded-lg border border-gray-300 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-accent-primary resize-none"
            spellCheck={false}
            placeholder={t('files.editor.placeholder')}
          />
        )}

        {/* Line Count */}
        <div className="flex justify-between text-xs text-text-light-muted dark:text-text-muted">
          <span>{t('files.editor.lines', { count: content.split('\n').length })}</span>
          <span>{t('files.editor.characters', { count: content.length })}</span>
        </div>
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose} disabled={saving}>
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          variant="primary"
          icon={<Save size={16} />}
          onClick={handleSave}
          loading={saving}
          disabled={saving || !hasChanges || loading}
        >
          {saving ? t('common.saving', { defaultValue: 'Saving...' }) : t('files.editor.save')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
