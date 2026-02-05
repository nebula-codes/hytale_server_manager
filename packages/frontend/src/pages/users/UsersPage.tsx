import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input } from '../../components/ui';
import { Users, Plus, Pencil, Trash2, X, Check, Shield, Eye, UserCog } from 'lucide-react';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';

interface User {
  id: string;
  email: string;
  username: string;
  role: 'admin' | 'moderator' | 'viewer';
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserFormData {
  email: string;
  username: string;
  password: string;
  role: 'admin' | 'moderator' | 'viewer';
}

const ROLE_ICONS = {
  admin: Shield,
  moderator: UserCog,
  viewer: Eye,
};

const ROLE_COLORS = {
  admin: 'text-red-500 bg-red-500/10',
  moderator: 'text-yellow-500 bg-yellow-500/10',
  viewer: 'text-blue-500 bg-blue-500/10',
};

export const UsersPage = () => {
  const { t } = useTranslation();
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>({
    email: '',
    username: '',
    password: '',
    role: 'viewer',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getUsers<User>();
      setUsers(data);
    } catch (err: any) {
      setError(err.message || t('users.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({ email: '', username: '', password: '', role: 'viewer' });
    setFormError(null);
    setShowModal(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      username: user.username,
      password: '',
      role: user.role,
    });
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingUser(null);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      if (editingUser) {
        // Update user
        const updateData: Partial<UserFormData> = {
          email: formData.email,
          username: formData.username,
          role: formData.role,
        };
        if (formData.password) {
          updateData.password = formData.password;
        }
        await api.updateUser(editingUser.id, updateData);
        setSuccess(t('users.toast.updated'));
      } else {
        // Create user
        if (!formData.password) {
          setFormError(t('users.form.password_required'));
          setSaving(false);
          return;
        }
        await api.createUser(formData);
        setSuccess(t('users.toast.created'));
      }
      closeModal();
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || t('users.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string) => {
    setDeleting(true);
    try {
      await api.deleteUser(userId);
      setSuccess(t('users.toast.deleted'));
      setDeleteConfirm(null);
      fetchUsers();
    } catch (err: any) {
      setError(err.message || t('users.errors.delete'));
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('users.never');
    return new Date(dateString).toLocaleString();
  };

  // Check if current user is admin
  if (currentUser?.role !== 'admin') {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <Shield size={48} className="mx-auto text-text-secondary mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">{t('users.access_denied.title')}</h2>
            <p className="text-text-secondary">{t('users.access_denied.description')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">{t('users.title')}</h1>
          <p className="text-text-secondary mt-1">{t('users.subtitle')}</p>
        </div>
        <Button variant="primary" onClick={openCreateModal}>
          <Plus size={16} className="mr-2" />
          {t('users.actions.add')}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-3 rounded flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {success && (
        <div className="bg-green-500/10 text-green-500 p-3 rounded flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Check size={16} />
            {success}
          </span>
          <button onClick={() => setSuccess(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users size={20} />
            {t('users.list.title', { count: users.length })}
          </CardTitle>
          <CardDescription>{t('users.list.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-text-secondary">{t('users.list.loading')}</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-text-secondary">{t('users.list.empty')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 text-text-secondary font-medium">{t('users.table.user')}</th>
                    <th className="text-left py-3 px-4 text-text-secondary font-medium">{t('users.table.role')}</th>
                    <th className="text-left py-3 px-4 text-text-secondary font-medium">{t('users.table.created')}</th>
                    <th className="text-left py-3 px-4 text-text-secondary font-medium">{t('users.table.last_login')}</th>
                    <th className="text-right py-3 px-4 text-text-secondary font-medium">{t('users.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const RoleIcon = ROLE_ICONS[user.role];
                    return (
                      <tr key={user.id} className="border-b border-gray-800 hover:bg-primary-bg-secondary/50">
                        <td className="py-3 px-4">
                          <div>
                            <div className="font-medium text-text-primary">{user.username}</div>
                            <div className="text-sm text-text-secondary">{user.email}</div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm ${ROLE_COLORS[user.role]}`}>
                            <RoleIcon size={14} />
                            {t(`users.roles.${user.role}`)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-text-secondary text-sm">
                          {formatDate(user.createdAt)}
                        </td>
                        <td className="py-3 px-4 text-text-secondary text-sm">
                          {formatDate(user.lastLoginAt)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditModal(user)}
                            >
                              <Pencil size={14} />
                            </Button>
                            {user.id !== currentUser?.id && (
                              deleteConfirm === user.id ? (
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => handleDelete(user.id)}
                                    disabled={deleting}
                                  >
                                    {deleting ? '...' : <Check size={14} />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDeleteConfirm(null)}
                                  >
                                    <X size={14} />
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeleteConfirm(user.id)}
                                  className="text-red-500 hover:text-red-400"
                                >
                                  <Trash2 size={14} />
                                </Button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-primary-bg-secondary rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-text-primary mb-4">
              {editingUser ? t('users.modal.edit_title') : t('users.modal.create_title')}
            </h2>

            {formError && (
              <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('users.form.username')}</label>
                <Input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder={t('users.form.username_placeholder')}
                  required
                  minLength={3}
                  maxLength={32}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('users.form.email')}</label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder={t('users.form.email_placeholder')}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('users.form.password')}
                  {editingUser && <span className="text-text-secondary"> ({t('users.form.password_optional')})</span>}
                </label>
                <Input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={editingUser ? t('users.form.password_new_placeholder') : t('users.form.password_placeholder')}
                  required={!editingUser}
                  minLength={8}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('users.form.role')}</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'moderator' | 'viewer' })}
                  className="w-full px-3 py-2 bg-primary-bg border border-gray-700 rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="viewer">{t('users.roles.viewer_option')}</option>
                  <option value="moderator">{t('users.roles.moderator_option')}</option>
                  <option value="admin">{t('users.roles.admin_option')}</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving}
                  className="flex-1"
                >
                  {saving ? t('users.form.saving') : (editingUser ? t('users.form.update') : t('users.form.create'))}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeModal}
                  disabled={saving}
                >
                  {t('users.form.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersPage;
