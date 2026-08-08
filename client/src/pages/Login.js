import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { checkServerHealth, changePassword } from '../api/api';
import './Login.css';

const showDefaultCredsHint = process.env.NODE_ENV !== 'production';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverReachable, setServerReachable] = useState(null);
  const [dbUnreachable, setDbUnreachable] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { login, isAuthenticated, user, clearMustChangePassword } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated && user?.mustChangePassword) {
      setMustChange(true);
      return;
    }
    if (isAuthenticated && !user?.mustChangePassword) {
      const timer = setTimeout(() => navigate('/dashboard'), 100);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    let cancelled = false;
    checkServerHealth()
      .then(() => { if (!cancelled) setServerReachable(true); })
      .catch(() => { if (!cancelled) setServerReachable(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setDbUnreachable(false);
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.success) {
        if (result.mustChangePassword) {
          setMustChange(true);
          setCurrentPassword(password);
        } else {
          navigate('/dashboard');
        }
      } else {
        setError(result.error || 'Login failed. Please check your credentials.');
        setDbUnreachable(!!result.isDatabaseUnreachable);
      }
    } catch (err) {
      setError(err?.message || 'Login failed. Please try again.');
      setDbUnreachable(!!err?.isDatabaseUnreachable);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setLoading(true);
    try {
      await changePassword(currentPassword || password, newPassword);
      clearMustChangePassword?.();
      setMustChange(false);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not update password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>SUPACLEAN POS</h1>
          <p>Laundry & Dry Cleaning Management</p>
        </div>

        {serverReachable === false && (
          <div className="login-error" role="alert">
            Server unreachable. Check your connection or try again shortly.
          </div>
        )}
        {dbUnreachable && (
          <div className="login-error" role="alert">
            Database unreachable. Contact your administrator.
          </div>
        )}
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        {mustChange ? (
          <form onSubmit={handleChangePassword} className="login-form">
            <p className="login-warning">
              For security, you must set a new password before continuing.
            </p>
            <div className="form-group">
              <label htmlFor="currentPassword">Current password</label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="form-group">
              <label htmlFor="newPassword">New password (min 8 characters)</label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm new password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <button type="submit" className="login-button" disabled={loading}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                disabled={loading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              className="login-button"
              disabled={loading || !username || !password}
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        )}

        {showDefaultCredsHint && !mustChange && (
          <div className="login-footer">
            <p className="login-hint">
              Dev only — default bootstrap: <strong>admin</strong> / <strong>admin123</strong>
            </p>
            <p className="login-warning">Change this password immediately on any shared or production server.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
