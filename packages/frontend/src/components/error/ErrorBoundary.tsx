/**
 * Error Boundary Components
 *
 * React Error Boundaries for catching and handling runtime errors gracefully.
 * Prevents full application crashes and provides user-friendly error recovery options.
 *
 * @module components/error/ErrorBoundary
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug, Copy, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { logger, env } from '../../config';

/**
 * Error information for display and reporting
 */
export interface ErrorDetails {
  /** Error message */
  message: string;
  /** Error stack trace */
  stack?: string;
  /** Component stack trace */
  componentStack?: string;
  /** Timestamp when error occurred */
  timestamp: Date;
  /** Browser/environment info */
  userAgent: string;
  /** Current URL */
  url: string;
}

/**
 * Props for ErrorBoundary component
 */
interface ErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Custom fallback component */
  fallback?: ReactNode | ((error: ErrorDetails, reset: () => void) => ReactNode);
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Error boundary name for logging */
  name?: string;
  /** Whether to show detailed error info (default: only in development) */
  showDetails?: boolean;
}

/**
 * State for ErrorBoundary component
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing
 * the entire application.
 *
 * @example
 * ```tsx
 * <ErrorBoundary name="Dashboard" onError={logToService}>
 *   <DashboardContent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * Update state when an error is caught
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  /**
   * Log error information when caught
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    const { onError, name } = this.props;

    // Log the error
    logger.error(`Error in ${name || 'component'}:`, error, errorInfo.componentStack);

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }

    // In production, you might want to send to an error reporting service
    if (env.isProduction) {
      this.reportError(error, errorInfo);
    }
  }

  /**
   * Reports error to external service (placeholder for implementation)
   */
  private reportError(_error: Error, _errorInfo: ErrorInfo): void {
    // TODO: Implement error reporting to service like Sentry
    logger.info('Error would be reported to external service in production');
  }

  /**
   * Resets the error state to attempt recovery
   */
  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  /**
   * Gets formatted error details for display
   */
  getErrorDetails(): ErrorDetails {
    const { error, errorInfo } = this.state;

    return {
      message: error?.message || 'An unknown error occurred',
      stack: error?.stack,
      componentStack: errorInfo?.componentStack || undefined,
      timestamp: new Date(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };
  }

  render(): ReactNode {
    const { hasError } = this.state;
    const { children, fallback, showDetails = env.isDevelopment } = this.props;

    if (hasError) {
      const errorDetails = this.getErrorDetails();

      // Use custom fallback if provided
      if (fallback) {
        if (typeof fallback === 'function') {
          return fallback(errorDetails, this.handleReset);
        }
        return fallback;
      }

      // Default fallback UI
      return (
        <DefaultErrorFallback
          error={errorDetails}
          onReset={this.handleReset}
          showDetails={showDetails}
        />
      );
    }

    return children;
  }
}

/**
 * Props for DefaultErrorFallback component
 */
interface DefaultErrorFallbackProps {
  error: ErrorDetails;
  onReset: () => void;
  showDetails: boolean;
}

/**
 * Default Error Fallback Component
 *
 * Displays a user-friendly error message with recovery options.
 */
function DefaultErrorFallback({ error, onReset, showDetails }: DefaultErrorFallbackProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);

  const copyErrorDetails = async () => {
    const details = `
${t('error.error')}: ${error.message}
${t('error.time')}: ${error.timestamp.toISOString()}
URL: ${error.url}
${t('error.user_agent')}: ${error.userAgent}

${t('error.stack_trace')}:
${error.stack || t('error.not_available')}

${t('error.component_stack')}:
${error.componentStack || t('error.not_available')}
    `.trim();

    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy error details:', err);
    }
  };

  const handleGoHome = () => {
    window.location.href = env.app.basePath + '/dashboard';
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-[400px] flex items-center justify-center p-6"
    >
      <div className="max-w-lg w-full">
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="inline-flex items-center justify-center w-16 h-16 bg-danger/20 rounded-full mb-4"
          >
            <AlertTriangle size={32} className="text-danger" />
          </motion.div>

          <h2 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary mb-2">
            {t('error.title')}
          </h2>
          <p className="text-text-light-muted dark:text-text-muted">
            {error.message}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
          <button
            onClick={onReset}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-accent-primary text-black font-medium rounded-lg hover:bg-accent-primary/90 transition-colors"
          >
            <RefreshCw size={18} />
            {t('error.actions.try_again')}
          </button>

          <button
            onClick={handleRefresh}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-primary-bg-secondary text-text-light-primary dark:text-text-primary font-medium rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw size={18} />
            {t('error.actions.refresh')}
          </button>

          <button
            onClick={handleGoHome}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-primary-bg-secondary text-text-light-primary dark:text-text-primary font-medium rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Home size={18} />
            {t('error.actions.home')}
          </button>
        </div>

        {/* Error Details (Development Only) */}
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="mt-6"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm text-text-light-muted dark:text-text-muted">
                <Bug size={16} />
                <span>{t('error.details_title')}</span>
              </div>
              <button
                onClick={copyErrorDetails}
                className="inline-flex items-center gap-1 text-sm text-accent-primary hover:text-accent-primary/80 transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('error.copied') : t('error.copy')}
              </button>
            </div>

            <div className="bg-primary-bg dark:bg-primary-bg-secondary rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="p-3 border-b border-gray-200 dark:border-gray-800">
                <p className="text-xs text-text-light-muted dark:text-text-muted">
                  {error.timestamp.toLocaleString()}
                </p>
              </div>

              {error.stack && (
                <pre className="p-3 text-xs text-danger overflow-x-auto max-h-48 font-mono">
                  {error.stack}
                </pre>
              )}

              {error.componentStack && (
                <div className="border-t border-gray-200 dark:border-gray-800">
                  <pre className="p-3 text-xs text-text-light-muted dark:text-text-muted overflow-x-auto max-h-32 font-mono">
                    {error.componentStack}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// React import for useState in DefaultErrorFallback
import React from 'react';

/**
 * Page-level Error Boundary
 *
 * Specialized error boundary for page components with full-page error display.
 */
export function PageErrorBoundary({ children, name }: { children: ReactNode; name: string }) {
  return (
    <ErrorBoundary
      name={`Page:${name}`}
      fallback={(error, reset) => (
        <div className="min-h-screen flex items-center justify-center bg-primary-light-bg dark:bg-primary-bg p-4">
          <DefaultErrorFallback
            error={error}
            onReset={reset}
            showDetails={env.isDevelopment}
          />
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Widget-level Error Boundary
 *
 * Compact error boundary for smaller components/widgets.
 */
export function WidgetErrorBoundary({
  children,
  name,
  className = '',
}: {
  children: ReactNode;
  name: string;
  className?: string;
}) {
  return (
    <ErrorBoundary
      name={`Widget:${name}`}
      fallback={(error, reset) => (
        <div className={`p-4 bg-danger/10 border border-danger/30 rounded-lg ${className}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-danger flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-danger">
                Failed to load {name}
              </p>
              <p className="text-xs text-text-light-muted dark:text-text-muted mt-1 truncate">
                {error.message}
              </p>
            </div>
            <button
              onClick={reset}
              className="flex-shrink-0 p-1 hover:bg-danger/20 rounded transition-colors"
              title="Retry"
            >
              <RefreshCw size={16} className="text-danger" />
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Async Error Boundary
 *
 * Error boundary that integrates with React Suspense for async components.
 */
export function AsyncBoundary({
  children,
  name,
  loadingFallback,
}: {
  children: ReactNode;
  name: string;
  loadingFallback?: ReactNode;
}) {
  return (
    <ErrorBoundary name={`Async:${name}`}>
      <React.Suspense
        fallback={
          loadingFallback || (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary" />
            </div>
          )
        }
      >
        {children}
      </React.Suspense>
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
