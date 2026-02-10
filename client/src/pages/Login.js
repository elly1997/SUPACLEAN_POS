import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { checkServerHealth } from '../api/api';
import './Login.css';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverReachable, setServerReachable] = useState(null);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      const timer = setTimeout(() => navigate('/dashboard'), 100);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    let cancelled = false;
    checkServerHealth()
      .then(() => { if (!cancelled) setServerReachable(true); })
      .catch(() => { if (!cancelled) setServerReachable(false); });
    return () => { cancelled = true; };
  }, []);

  const [dbUnreachable, setDbUnreachable] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setDbUnreachable(false);
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.success) {
        navigate('/dashboard');
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

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo-container">
            <img src="/supaclean-logo.svg" alt="SUPACLEAN Logo" className="login-logo" />
          </div>
          <h1>SUPACLEAN</h1>
          <p className="login-subtitle">Laundry & Dry Cleaning POS</p>
          <p className="login-location">Arusha, Tanzania</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {serverReachable === false && (
            <div className="login-server-unreachable" role="alert">
              Server is unreachable. Run the backend with <code>npm run dev</code> and ensure it is running on port 5000. See SETUP_GUIDE.md.
            </div>
          )}
          {error && (
            <>
              <div className="login-error" role="alert">
                {error}
              </div>
              {dbUnreachable && (
                <div className="login-db-unreachable" role="alert">
                  <strong>Database unreachable</strong>
                  <ul>
                    <li>Check your <strong>internet connection</strong>.</li>
                    <li>Confirm <code>DATABASE_URL</code> in <code>.env</code> (Supabase connection string).</li>
                    <li>Try different DNS (e.g. 8.8.8.8) or disable VPN if used.</li>
                    <li>See <strong>SETUP_GUIDE.md</strong> → Troubleshooting → &quot;getaddrinfo ENOTFOUND&quot;.</li>
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
              autoFocus
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
              placeholder="Enter your password"
              required
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

        <div className="login-footer">
          <p className="login-hint">
            Default credentials: <strong>admin</strong> / <strong>admin123</strong>
          </p>
          <p className="login-warning">⚠️ Please change default password after first login</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
