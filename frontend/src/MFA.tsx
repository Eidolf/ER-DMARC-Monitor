import React, { useState } from 'react';
import { useAuth } from './AuthContext';

interface MFAProps {
  mfaToken: string;
  onBack: () => void;
}

const MFA: React.FC<MFAProps> = ({ mfaToken, onBack }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token: mfaToken, code }),
      });
      const data = await res.json();
      if (res.ok) {
        login(data.access_token, data.role);
      } else {
        setError(data.detail || 'Invalid MFA code');
      }
    } catch (err) {
      setError('Connection error');
    }
  };

  return (
    <div className="login-page">
      <div className="ambient-background"></div>
      <div className="login-card glass-card">
        <div className="logo-section" style={{ justifyContent: 'center', marginBottom: '2rem' }}>
          <div className="logo-orb"></div>
          <h1>ER-DMARC<span>-Monitor</span></h1>
        </div>
        
        <h2>MFA Verification</h2>
        <p className="subtitle">Enter the code from your authenticator app</p>

        <form onSubmit={handleVerify}>
          <div className="form-group">
            <label>Verification Code</label>
            <input 
              type="text" 
              className="text-input" 
              placeholder="000 000"
              value={code} 
              onChange={(e) => setCode(e.target.value)} 
              required 
              autoFocus
            />
          </div>
          {error && <p className="error-message">{error}</p>}
          <button type="submit" className="action-btn primary-btn" style={{ width: '100%', marginTop: '1rem' }}>
            Verify & Continue
          </button>
        </form>

        <button onClick={onBack} className="action-btn secondary-btn" style={{ width: '100%', marginTop: '1rem' }}>
          Back to Login
        </button>

        <p className="footer-note">Secure MFA Session active</p>
      </div>
    </div>
  );
};

export default MFA;
