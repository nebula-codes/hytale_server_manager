import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Card, CardContent, Badge } from '../../components/ui';
import { Upload, AlertCircle, CheckCircle, File, X, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '../../services/api';

// Constants
const MAX_FILE_SIZE = 52428800; // 50MB (from backend config)
const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);

interface UploadFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  serverId: string;
  currentPath: string;
}

interface UploadedFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'extracting' | 'success' | 'error' | 'cancelled';
  error?: string;
  extractedFiles?: string[];
  validationError?: string;
  abortController?: AbortController;
}

interface ValidationError {
  fileName: string;
  reason: string;
}

export const UploadFileModal = ({
  isOpen,
  onClose,
  onSuccess,
  serverId,
  currentPath,
}: UploadFileModalProps) => {
  const { t } = useTranslation();
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [autoExtractZip, setAutoExtractZip] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const uploadAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    const controllers = uploadAbortControllersRef.current;
    return () => {
      controllers.forEach((controller) => {
        controller.abort();
      });
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      uploads.forEach((upload) => {
        if (upload.status === 'pending' || upload.status === 'uploading') {
          const controller = uploadAbortControllersRef.current.get(upload.id);
          if (controller) {
            controller.abort();
          }
        }
      });
    }
  }, [isOpen, uploads]);

  /**
   * Validate file before upload
   */
  const validateFile = (file: File): string | null => {
    if (file.size === 0) {
      return t('files.upload.errors.empty');
    }

    if (file.size > MAX_FILE_SIZE) {
      return t('files.upload.errors.too_large', {
        max: MAX_FILE_SIZE_MB,
        size: (file.size / (1024 * 1024)).toFixed(2),
      });
    }

    return null;
  };

  /**
   * Check for duplicate filenames in queue
   */
  const checkDuplicateFilenames = (files: File[]): Map<string, number> => {
    const fileNameCounts = new Map<string, number>();

    uploads.forEach((upload) => {
      const count = fileNameCounts.get(upload.file.name) || 0;
      fileNameCounts.set(upload.file.name, count + 1);
    });

    files.forEach((file) => {
      const count = fileNameCounts.get(file.name) || 0;
      fileNameCounts.set(file.name, count + 1);
    });

    return fileNameCounts;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    handleFilesSelected(files);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    handleFilesSelected(files);
    // Reset input value to allow re-selecting the same file
    e.currentTarget.value = '';
  };

  const handleFilesSelected = (files: File[]) => {
    const errors: ValidationError[] = [];
    const validFiles: File[] = [];

    files.forEach((file) => {
      const validationError = validateFile(file);
      if (validationError) {
        errors.push({ fileName: file.name, reason: validationError });
      } else {
        validFiles.push(file);
      }
    });

    const duplicates = checkDuplicateFilenames(validFiles);
    duplicates.forEach((count, fileName) => {
      if (count > 1) {
        errors.push({
          fileName,
          reason: t('files.upload.errors.duplicate', { file: fileName, count }),
        });
      }
    });

    setValidationErrors(errors);

    const newUploads: UploadedFile[] = validFiles
      .filter((file) => !duplicates.has(file.name) || duplicates.get(file.name) === 1)
      .map((file) => {
        const abortController = new AbortController();
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        // Store controller in ref for later cancellation
        uploadAbortControllersRef.current.set(id, abortController);
        return {
          id,
          file,
          progress: 0,
          status: 'pending',
          abortController,
        };
      });

    setUploads((prev) => [...prev, ...newUploads]);

    // Start uploading immediately
    newUploads.forEach((upload) => {
      uploadFile(upload.id, upload.file);
    });
  };

  /**
   * Cancel an upload
   */
  const cancelUpload = (id: string) => {
    const controller = uploadAbortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      uploadAbortControllersRef.current.delete(id);
    }

    setUploads((prev) =>
      prev.map((u) =>
        u.id === id
          ? { ...u, status: 'cancelled' as const, error: 'Upload cancelled' }
          : u
      )
    );
  };

  /**
   * Get user-friendly error message from API error
   */
  const getErrorMessage = (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.statusCode === 413) {
      return t('files.upload.errors.too_large', { max: MAX_FILE_SIZE_MB, size: '' }).trim();
    }
    if (error.statusCode === 400) {
      return error.message || t('files.upload.errors.invalid');
    }
    if (error.statusCode === 401) {
      return t('files.upload.errors.session');
    }
    if (error.statusCode === 403) {
      return t('files.upload.errors.permission');
    }
    if (error.statusCode === 409) {
      return error.message || t('files.upload.errors.conflict');
    }
    if (error.statusCode === 0) {
      return t('files.upload.errors.network_generic');
    }
    return error.message || t('files.upload.errors.failed');
  }

    if (error instanceof Error) {
      if (error.message === 'Upload cancelled') {
        return t('files.upload.errors.cancelled');
      }
      if (error.message === 'Upload failed') {
        return t('files.upload.errors.network');
      }
      return error.message;
    }

    return t('files.alert.unexpected_error');
  };

  const uploadFile = async (id: string, file: File) => {
    try {
      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, status: 'uploading' as const } : u))
      );

      const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
      const controller = uploadAbortControllersRef.current.get(id);
      const signal = controller?.signal;

      const result = await api.uploadFile(serverId, filePath, file, autoExtractZip, (progress) => {
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, progress } : u))
        );
      }, signal);

      uploadAbortControllersRef.current.delete(id);

      setUploads((prev) => {
        const updated = prev.map((u) => {
          if (u.id === id) {
            const extractedFilesArray = result.extractedFiles ?? [];
            const newStatus: 'extracting' | 'success' = extractedFilesArray.length > 0 ? 'extracting' : 'success';
            return {
              ...u,
              status: newStatus,
              progress: 100,
              extractedFiles: extractedFilesArray,
            };
          }
          return u;
        });

        const allComplete = updated.every(
          (u) => u.status === 'success' || u.status === 'extracting' || u.status === 'error' || u.status === 'cancelled'
        );

        if (allComplete && updated.some((u) => u.status === 'success' || u.status === 'extracting')) {
          setTimeout(() => {
            onSuccess();
            setUploads([]);
            uploadAbortControllersRef.current.clear();
            onClose();
          }, 1500);
        }

        return updated;
      });
    } catch (error) {
      uploadAbortControllersRef.current.delete(id);

      if (error instanceof Error && error.message === 'Upload cancelled') {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === id
              ? {
                  ...u,
                  status: 'cancelled' as const,
                  error: t('files.upload.errors.cancelled'),
                }
              : u
          )
        );
        return;
      }

      const errorMessage = getErrorMessage(error);
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id
            ? {
                ...u,
                status: 'error' as const,
                error: errorMessage,
              }
            : u
        )
      );
    }
  };

  const removeUpload = (id: string) => {
    uploadAbortControllersRef.current.delete(id);
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  const clearCompleted = () => {
    setUploads((prev) =>
      prev.filter(
        (u) =>
          u.status === 'pending' ||
          u.status === 'uploading' ||
          u.status === 'error' ||
          u.status === 'cancelled'
      )
    );
  };

  const completedCount = uploads.filter((u) => u.status === 'success' || u.status === 'extracting').length;

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('files.upload.title')}>
      <div className="space-y-6">
        {/* Drag and Drop Area */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging
              ? 'border-accent-primary bg-accent-primary/5'
              : 'border-gray-300 dark:border-gray-700'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload size={32} className="mx-auto mb-3 text-text-light-muted dark:text-text-muted" />
          <p className="text-text-light-primary dark:text-text-primary font-medium mb-1">
            {t('files.upload.drag_drop')}
          </p>
          <p className="text-sm text-text-light-muted dark:text-text-muted mb-4">
            {t('files.upload.click_select')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('files.upload.select_files')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertTriangle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-red-900 dark:text-red-100 mb-2">
                    {t('files.upload.validation.failed', { count: validationErrors.length })}
                  </h4>
                  <ul className="space-y-1">
                    {validationErrors.map((error, idx) => (
                      <li key={idx} className="text-sm text-red-800 dark:text-red-200">
                        <span className="font-medium">{error.fileName}:</span> {error.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
          </div>
        )}

        {/* File Size Info */}
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <p className="text-xs text-blue-900 dark:text-blue-100">
            <span className="font-medium">{t('files.upload.max_size_label')}</span> {MAX_FILE_SIZE_MB}MB
          </p>
        </div>

        {/* Options */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoExtractZip}
              onChange={(e) => setAutoExtractZip(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-700"
            />
            <span className="text-sm text-text-light-primary dark:text-text-primary">
              {t('files.upload.auto_extract')}
            </span>
          </label>
        </div>

        {/* Upload List */}
        {uploads.length > 0 && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-medium text-text-light-primary dark:text-text-primary">
                {t('files.upload.list_title', { count: uploads.length })}
              </h3>
              {completedCount > 0 && (
                <button
                  onClick={clearCompleted}
                  className="text-xs text-accent-primary hover:underline"
                >
                  {t('files.upload.clear_completed')}
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto space-y-2">
              {uploads.map((upload) => (
                <Card key={upload.id} variant="glass">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <File size={16} className="text-gray-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-text-light-primary dark:text-text-primary truncate">
                            {upload.file.name}
                          </p>
                          {upload.status === 'success' && (
                            <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
                          )}
                          {upload.status === 'extracting' && (
                            <Badge variant="success" size="sm">
                              {t('files.upload.extracted')}
                            </Badge>
                          )}
                          {upload.status === 'error' && (
                            <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                          )}
                        </div>

                        {upload.status === 'pending' || upload.status === 'uploading' ? (
                          <>
                            <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-1.5">
                              <div
                                className="bg-accent-primary rounded-full h-1.5 transition-all"
                                style={{ width: `${upload.progress}%` }}
                              />
                            </div>
                            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                              {upload.status === 'uploading'
                                ? `${Math.round(upload.progress)}%`
                                : t('files.upload.waiting')}
                            </p>
                          </>
                        ) : null}

                        {upload.status === 'extracting' && upload.extractedFiles && (
                          <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                            {t('files.upload.extracted_count', { count: upload.extractedFiles.length })}
                          </p>
                        )}

                        {upload.status === 'error' && (
                          <p className="text-xs text-red-500 mt-1">{upload.error}</p>
                        )}

                        {upload.status === 'cancelled' && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('files.upload.cancelled')}</p>
                        )}
                      </div>

                      {(upload.status === 'pending' || upload.status === 'uploading') && (
                        <button
                          onClick={() => cancelUpload(upload.id)}
                          className="text-gray-500 hover:text-red-600 dark:hover:text-red-400 flex-shrink-0 transition-colors"
                          title={t('files.upload.cancel_title')}
                        >
                          <X size={16} />
                        </button>
                      )}

                      {(upload.status === 'error' || upload.status === 'success' || upload.status === 'extracting' || upload.status === 'cancelled') && (
                        <button
                          onClick={() => removeUpload(upload.id)}
                          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0"
                          title={t('files.upload.remove_title')}
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close', { defaultValue: 'Close' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
