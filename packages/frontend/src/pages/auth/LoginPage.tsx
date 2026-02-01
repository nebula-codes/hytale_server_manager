/**
 * Login Page Component
 *
 * Handles user authentication with JWT authentication. Features include
 * remember me functionality and comprehensive error handling.
 *
 * @module pages/auth/LoginPage
 */

import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { Button, Input, Card } from '../../components/ui';
import { LogIn, User, Lock, Gamepad2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { env } from '../../config';
import { authService, AuthError } from '../../services/auth';

/**
 * LoginPage Component
 *
 * Provides a complete authentication interface with:
 * - Username/email and password login form
 * - Remember me functionality
 * - Error display
 */
export const LoginPage = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [setupEmail, setSetupEmail] = useState('');
  const [setupUsername, setSetupUsername] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [forceSetup, setForceSetup] = useState(false);

  const { login, isLoading, error, clearError, isAuthenticated, setupRequired, isSetupLoading } = useAuthStore();
  const navigate = useNavigate();
  const isSetupMode = setupRequired === true || forceSetup;
  const subtitle = isSetupMode
    ? 'Create your first admin account to continue'
    : 'Server Management Dashboard';

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Check for setup requirement from error message
  useEffect(() => {
    if (error && error.toLowerCase().includes('initial setup')) {
      setForceSetup(true);
    }
  }, [error]);

  /**
   * Handles form submission
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const result = await login({ identifier, password, rememberMe });

    if (result.success) {
      navigate('/dashboard', { replace: true });
    }
  };

  const handleSetupSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSetupError(null);

    if (setupPassword !== setupConfirm) {
      setSetupError('Passwords do not match');
      return;
    }

    setIsSettingUp(true);

    try {
      await authService.createInitialAdmin({
        email: setupEmail,
        username: setupUsername,
        password: setupPassword,
      });

      const result = await login({
        identifier: setupEmail,
        password: setupPassword,
        rememberMe: true,
      });

      if (result.success) {
        setForceSetup(false);
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      const message = err instanceof AuthError
        ? err.message
        : 'Failed to create admin account';
      setSetupError(message);
    } finally {
      setIsSettingUp(false);
    }
  };

  if (isSetupLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary-light-bg dark:bg-primary-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary" />
          <p className="text-text-light-muted dark:text-text-muted">Checking setup...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary-bg via-primary-bg-secondary to-primary-bg">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card variant="glass">
          {/* Logo & Title */}
          <div className="text-center mb-8">
            <motion.div
              className="flex justify-center mb-4"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <div className="w-16 h-16 bg-accent-primary rounded-lg flex items-center justify-center shadow-lg shadow-accent-primary/30">
                <Gamepad2 size={32} className="text-black" />
              </div>
            </motion.div>
            <h1 className="text-3xl font-heading font-bold text-gradient">HytalePanel</h1>
            <p className="text-text-light-muted dark:text-text-muted mt-2">{subtitle}</p>
          </div>

          {isSetupMode ? (
            <form onSubmit={handleSetupSubmit} className="space-y-4">
              <Input
                type="email"
                label="Admin Email"
                placeholder="Enter your email address"
                value={setupEmail}
                onChange={(e) => {
                  setSetupEmail(e.target.value);
                  if (setupError) setSetupError(null);
                }}
                icon={<User size={18} />}
                required
                autoComplete="email"
                disabled={isSettingUp}
              />

              <Input
                type="text"
                label="Admin Username"
                placeholder="Choose a username"
                value={setupUsername}
                onChange={(e) => {
                  setSetupUsername(e.target.value);
                  if (setupError) setSetupError(null);
                }}
                icon={<User size={18} />}
                required
                autoComplete="username"
                disabled={isSettingUp}
              />

              <Input
                type="password"
                label="Admin Password"
                placeholder="Create a strong password"
                value={setupPassword}
                onChange={(e) => {
                  setSetupPassword(e.target.value);
                  if (setupError) setSetupError(null);
                }}
                icon={<Lock size={18} />}
                required
                autoComplete="new-password"
                disabled={isSettingUp}
              />

              <Input
                type="password"
                label="Confirm Password"
                placeholder="Re-enter your password"
                value={setupConfirm}
                onChange={(e) => {
                  setSetupConfirm(e.target.value);
                  if (setupError) setSetupError(null);
                }}
                icon={<Lock size={18} />}
                required
                autoComplete="new-password"
                disabled={isSettingUp}
              />

              <div className="text-xs text-text-light-muted dark:text-text-muted">
                Password must be 12+ characters with uppercase, lowercase, number, and special character.
              </div>

              <AnimatePresence mode="wait">
                {setupError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      transition: {
                        type: "spring",
                        stiffness: 500,
                        damping: 25
                      }
                    }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    className="p-4 bg-red-500/10 border-2 border-red-500/50 rounded-lg flex items-start gap-3 shadow-lg shadow-red-500/20"
                  >
                    <div className="p-1.5 bg-red-500/20 rounded-full flex-shrink-0">
                      <AlertCircle size={20} className="text-red-500" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-red-500 font-semibold text-sm mb-1">Setup Failed</h4>
                      <p className="text-red-400 text-sm leading-relaxed">{setupError}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={isSettingUp}
                icon={<LogIn size={20} />}
              >
                {isSettingUp ? 'Creating admin...' : 'Create Admin Account'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="text"
                label="Username or Email"
                placeholder="Enter your username or email"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  if (error) clearError();
                }}
                icon={<User size={18} />}
                required
                autoComplete="username"
                disabled={isLoading}
                className={error ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20' : ''}
              />

              <Input
                type="password"
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) clearError();
                }}
                icon={<Lock size={18} />}
                required
                autoComplete="current-password"
                disabled={isLoading}
                className={error ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/20' : ''}
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="remember"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={isLoading}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 bg-white dark:bg-primary-bg text-accent-primary focus:ring-accent-primary focus:ring-2"
                  />
                  <label
                    htmlFor="remember"
                    className="ml-2 text-sm text-text-light-muted dark:text-text-muted cursor-pointer"
                  >
                    Remember me
                  </label>
                </div>

                <button
                  type="button"
                  className="text-sm text-accent-primary hover:text-accent-primary/80 transition-colors"
                  onClick={() => {/* TODO: Implement forgot password */}}
                >
                  Forgot password?
                </button>
              </div>

              {/* Error Display */}
              <AnimatePresence mode="wait">
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      transition: {
                        type: "spring",
                        stiffness: 500,
                        damping: 25
                      }
                    }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    className="p-4 bg-red-500/10 border-2 border-red-500/50 rounded-lg flex items-start gap-3 shadow-lg shadow-red-500/20"
                  >
                    <div className="p-1.5 bg-red-500/20 rounded-full flex-shrink-0">
                      <AlertCircle size={20} className="text-red-500" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-red-500 font-semibold text-sm mb-1">Login Failed</h4>
                      <p className="text-red-400 text-sm leading-relaxed">{error}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={isLoading}
                icon={<LogIn size={20} />}
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          )}
        </Card>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-text-light-muted dark:text-text-muted">
          <p>{env.app.name} &copy; {new Date().getFullYear()}</p>
         
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
