import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import MFA from './MFA';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [mfaData, setMfaData] = useState<{ required: boolean; token: string | null }>({ required: false, token: null });
  const { login } = useAuth();

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.mfa_required) {
          setMfaData({ required: true, token: data.mfa_token });
        } else {
          login(data.access_token, data.role);
        }
      } else {
        setError(data.detail || 'Login failed');
      }
    } catch (err) {
      setError('Connection error');
    }
  };

  const handleSSOLogin = () => {
    window.location.href = '/api/auth/sso/login';
  };

  if (mfaData.required && mfaData.token) {
    return <MFA mfaToken={mfaData.token} onBack={() => setMfaData({ required: false, token: null })} />;
  }

  return (
    <div className="login-page">
      <div className="ambient-background"></div>
      <div className="login-card glass-card">
        <div className="logo-section" style={{ justifyContent: 'center', marginBottom: '2rem' }}>
          <div className="logo-orb"></div>
          <h1>ER-DMARC<span>-Monitor</span></h1>
        </div>
        
        <h2>Identity Management</h2>
        <p className="subtitle">Secure access to corporate DMARC insights</p>

        <form onSubmit={handleLocalLogin}>
          <div className="form-group">
            <label>Username</label>
            <input 
              type="text" 
              className="text-input" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)} 
              required 
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input 
              type="password" 
              className="text-input" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
            />
          </div>
          {error && <p className="error-message">{error}</p>}
          <button type="submit" className="action-btn primary-btn" style={{ width: '100%', marginTop: '1rem' }}>
            Sign In
          </button>
        </form>

        <div className="divider"><span>OR</span></div>

        <button onClick={handleSSOLogin} className="action-btn sso-btn" style={{ width: '100%' }}>
          <svg width="20" height="20" viewBox="0 0 23 23" style={{ marginRight: '10px' }}>
            <path fill="#f3f3f3" d="M0 0h11v11H0zM12 0h11v11H12zM0 12h11v11H0zM12 12h11v11H12z"/>
          </svg>
          Sign in with Microsoft
        </button>

        <p className="footer-note">Enterprise Grade Security & MFA Enforced</p>
      </div>
    </div>
  );
};

export default Login;
