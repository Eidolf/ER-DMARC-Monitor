import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

interface GlobalSettings {
  allow_local_login: boolean;
  allow_sso_login: boolean;
  enforce_mfa_admins: boolean;
  enforce_mfa_analysts: boolean;
  entra_tenant_id: string;
  entra_client_id: string;
  entra_client_secret: string;
  entra_tenant_type: string;
  title_part1: string;
  title_part2: string;
  color_part1: string;
  color_part2: string;
  logo_url: string | null;
}

interface AuditLog {
  id: number;
  email: string;
  timestamp: string;
  ip: string;
  method: string;
  status: string;
  detail: string | null;
}

const Settings: React.FC = () => {
  const { token, role } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'domains' | 'branding' | 'auth' | 'audit'>('profile');
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Profile states
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mfaSetup, setMfaSetup] = useState<{ secret: string, uri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const isAdmin = role === 'Admin';

  useEffect(() => {
    if (isAdmin && (activeTab === 'auth' || activeTab === 'branding')) {
      fetchSettings();
    }
    if (isAdmin && activeTab === 'audit') {
      fetchAuditLogs();
    }
  }, [activeTab]);

  const fetchSettings = async () => {
    const res = await fetch('/api/settings/global', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setSettings(await res.json());
  };

  const fetchAuditLogs = async () => {
    const res = await fetch('/api/admin/audit', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setAuditLogs(await res.json());
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    setLoading(true);
    const res = await fetch('/api/settings/global', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    });
    setLoading(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Settings saved successfully' });
      fetchSettings();
    } else {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth/profile/password', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    });
    if (res.ok) {
      setMessage({ type: 'success', text: 'Password changed successfully' });
      setOldPassword('');
      setNewPassword('');
    } else {
      const data = await res.json();
      setMessage({ type: 'error', text: data.detail || 'Failed to change password' });
    }
  };

  const handleMFASetup = async () => {
    const res = await fetch('/api/auth/profile/mfa/setup', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setMfaSetup(await res.json());
  };

  const handleMFAVerify = async () => {
    const res = await fetch(`/api/auth/profile/mfa/enable?code=${mfaCode}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setRecoveryCodes(data.recovery_codes);
      setMfaSetup(null);
      setMessage({ type: 'success', text: 'MFA enabled successfully' });
    } else {
      setMessage({ type: 'error', text: 'Invalid code' });
    }
  };

  return (
    <div className="settings-container">
      <div className="settings-sidebar">
        <button className={activeTab === 'profile' ? 'active' : ''} onClick={() => setActiveTab('profile')}>User Profile</button>
        {isAdmin && (
          <>
            <button className={activeTab === 'auth' ? 'active' : ''} onClick={() => setActiveTab('auth')}>Authentication</button>
            <button className={activeTab === 'branding' ? 'active' : ''} onClick={() => setActiveTab('branding')}>Branding</button>
            <button className={activeTab === 'audit' ? 'active' : ''} onClick={() => setActiveTab('audit')}>Security Audit</button>
          </>
        )}
      </div>

      <div className="settings-main glass-card">
        {message && <div className={`alert-banner ${message.type}`}>{message.text}</div>}

        {activeTab === 'profile' && (
          <div className="settings-section">
            <h3>My Profile</h3>
            <div className="profile-info">
              <p><strong>Role:</strong> {role}</p>
            </div>

            <div className="settings-subsection">
              <h4>Security</h4>
              <form onSubmit={handleChangePassword}>
                <div className="form-group">
                  <label>Old Password</label>
                  <input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} className="text-input" />
                </div>
                <div className="form-group">
                  <label>New Password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="text-input" />
                </div>
                <button type="submit" className="action-btn">Update Password</button>
              </form>
            </div>

            <div className="settings-subsection">
              <h4>Multi-Factor Authentication</h4>
              {!recoveryCodes.length && (
                <button onClick={handleMFASetup} className="action-btn">Set Up MFA</button>
              )}
              {mfaSetup && (
                <div className="mfa-setup-modal">
                  <p>Scan this QR code with your authenticator app:</p>
                  <div className="qr-placeholder">
                    {/* In a real app, use a QR code library or show the URI */}
                    <code style={{wordBreak: 'break-all'}}>{mfaSetup.uri}</code>
                  </div>
                  <div className="form-group">
                    <label>Enter Verification Code</label>
                    <input type="text" value={mfaCode} onChange={e => setMfaCode(e.target.value)} className="text-input" />
                  </div>
                  <button onClick={handleMFAVerify} className="action-btn">Verify & Enable</button>
                </div>
              )}
              {recoveryCodes.length > 0 && (
                <div className="recovery-codes-box">
                  <p>MFA is active. Save these recovery codes:</p>
                  <div className="codes-grid">
                    {recoveryCodes.map(c => <code key={c}>{c}</code>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'auth' && settings && (
          <div className="settings-section">
            <h3>Authentication Settings</h3>
            <div className="settings-grid">
              <div className="settings-subsection">
                <h4>Login Methods</h4>
                <div className="toggle-group">
                  <label><input type="checkbox" checked={settings.allow_local_login} onChange={e => setSettings({...settings, allow_local_login: e.target.checked})} /> Allow Local Login</label>
                  <label><input type="checkbox" checked={settings.allow_sso_login} onChange={e => setSettings({...settings, allow_sso_login: e.target.checked})} /> Allow Microsoft SSO</label>
                </div>
              </div>
              <div className="settings-subsection">
                <h4>MFA Policy</h4>
                <div className="toggle-group">
                  <label><input type="checkbox" checked={settings.enforce_mfa_admins} onChange={e => setSettings({...settings, enforce_mfa_admins: e.target.checked})} /> Enforce MFA for Admins</label>
                  <label><input type="checkbox" checked={settings.enforce_mfa_analysts} onChange={e => setSettings({...settings, enforce_mfa_analysts: e.target.checked})} /> Enforce MFA for Analysts</label>
                </div>
              </div>
            </div>

            <div className="settings-subsection">
              <h4>Microsoft Entra ID (Azure AD) SSO Configuration</h4>
              <div className="form-group">
                <label>Tenant ID</label>
                <input type="text" value={settings.entra_tenant_id || ''} onChange={e => setSettings({...settings, entra_tenant_id: e.target.value})} className="text-input" />
              </div>
              <div className="form-group">
                <label>Client ID</label>
                <input type="text" value={settings.entra_client_id || ''} onChange={e => setSettings({...settings, entra_client_id: e.target.value})} className="text-input" />
              </div>
              <div className="form-group">
                <label>Client Secret</label>
                <input type="password" value={settings.entra_client_secret || ''} onChange={e => setSettings({...settings, entra_client_secret: e.target.value})} className="text-input" />
              </div>
              <div className="form-group">
                <label>Tenant Type</label>
                <select value={settings.entra_tenant_type} onChange={e => setSettings({...settings, entra_tenant_type: e.target.value})} className="text-input">
                  <option value="common">Multi-tenant (Common)</option>
                  <option value="organizations">All Organizations</option>
                  <option value="consumers">Personal Accounts Only</option>
                </select>
              </div>
            </div>
            <button onClick={handleSaveSettings} disabled={loading} className="action-btn primary-btn">{loading ? 'Saving...' : 'Save All Settings'}</button>
          </div>
        )}

        {activeTab === 'branding' && settings && (
          <div className="settings-section">
            <h3>Branding & UI</h3>
            <div className="form-group">
              <label>Title Part 1</label>
              <div className="input-group">
                 <input type="text" className="text-input" value={settings.title_part1} onChange={e => setSettings({...settings, title_part1: e.target.value})} />
                 <input type="color" className="color-picker" value={settings.color_part1} onChange={e => setSettings({...settings, color_part1: e.target.value})} />
              </div>
            </div>
            <div className="form-group">
              <label>Title Part 2</label>
              <div className="input-group">
                 <input type="text" className="text-input" value={settings.title_part2} onChange={e => setSettings({...settings, title_part2: e.target.value})} />
                 <input type="color" className="color-picker" value={settings.color_part2} onChange={e => setSettings({...settings, color_part2: e.target.value})} />
              </div>
            </div>
            <button onClick={handleSaveSettings} disabled={loading} className="action-btn primary-btn">Save Branding</button>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="settings-section">
            <h3>Security Audit Log</h3>
            <div className="scroll-box">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(log => (
                    <tr key={log.id}>
                      <td>{new Date(log.timestamp).toLocaleString()}</td>
                      <td>{log.email}</td>
                      <td>{log.method}</td>
                      <td><span className={`status-tag ${log.status === 'success' ? 'status-pass' : 'status-fail'}`}>{log.status}</span></td>
                      <td>{log.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
