import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const formatDate = (dateInput: string | number | Date) => {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
};

const formatDateTime = (dateInput: string | number | Date) => {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
};

const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px', verticalAlign: 'middle'}}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
);

const CloudIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px', verticalAlign: 'middle'}}><path d="M17.5 19c3.037 0 5.5-2.463 5.5-5.5 0-2.715-1.962-4.966-4.59-5.41a7.5 7.5 0 1 0-14.41 2.91A5.508 5.508 0 0 0 1 13.5C1 16.537 3.463 19 6.5 19Z"/></svg>
);

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
  public_url: string;
  default_sso_role: string;
  smtp_test_mode_enabled: boolean;
  allowed_test_recipients: string;
  test_message_retention_days: number;
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
  const [activeTab, setActiveTab] = useState<'profile' | 'domains' | 'branding' | 'auth' | 'audit' | 'smtp' | 'smtp_inbound' | 'users'>('profile');
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [domains, setDomains] = useState<{id: number, name: string}[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Profile states
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mfaSetup, setMfaSetup] = useState<{ secret: string, uri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  
  // Domain states
  const [newDomainName, setNewDomainName] = useState('');

  // SMTP Test states
  const [testResults, setTestResults] = useState<any[]>([]);
  const [testDomain, setTestDomain] = useState('');
  const [testRecipient, setTestRecipient] = useState('');
  const [testType, setTestType] = useState('RUA');
  const [triggering, setTriggering] = useState(false);

  // User Management states
  const [users, setUsers] = useState<any[]>([]);
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', role: 'Analyst' });
  
  // SMTP Inbound states
  const [inboundConfig, setInboundConfig] = useState<any[]>([]);
  const [newInboundDomain, setNewInboundDomain] = useState('');
  const [newRecipient, setNewRecipient] = useState<{domainId: number, localPart: string}>({ domainId: 0, localPart: '' });

  const isAdmin = role === 'Admin';

  useEffect(() => {
    fetchProfile();
    if (isAdmin) {
      if (activeTab === 'auth' || activeTab === 'branding' || activeTab === 'smtp') fetchSettings();
      if (activeTab === 'audit') fetchAuditLogs();
      if (activeTab === 'domains') fetchDomains();
      if (activeTab === 'smtp') fetchTestResults();
      if (activeTab === 'smtp_inbound') fetchInboundConfig();
      if (activeTab === 'users') fetchUsers();
    }
  }, [activeTab]);

  const fetchProfile = async () => {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setCurrentUser(await res.json());
  };

  const fetchSettings = async () => {
    const res = await fetch('/api/settings/global', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setSettings(await res.json());
  };

  const fetchDomains = async () => {
    const res = await fetch('/api/domains', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setDomains(await res.json());
  };

  const fetchAuditLogs = async () => {
    const res = await fetch('/api/admin/audit', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setAuditLogs(await res.json());
  };

  const fetchUsers = async () => {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setUsers(await res.json());
  };

  const fetchInboundConfig = async () => {
    const res = await fetch('/api/admin/smtp/inbound', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setInboundConfig(await res.json());
  };

  const handleAddInboundDomain = async () => {
    if (!newInboundDomain) return;
    const res = await fetch('/api/admin/smtp/inbound/domains', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_name: newInboundDomain })
    });
    if (res.ok) {
      setNewInboundDomain('');
      fetchInboundConfig();
    }
  };

  const handleToggleInboundDomain = async (id: number, current: boolean) => {
    const res = await fetch(`/api/admin/smtp/inbound/domains/${id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !current })
    });
    if (res.ok) fetchInboundConfig();
  };

  const handleDeleteInboundDomain = async (id: number) => {
    if (!window.confirm('Delete this listening domain and all its recipients?')) return;
    const res = await fetch(`/api/admin/smtp/inbound/domains/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) fetchInboundConfig();
  };

  const handleAddRecipient = async (domainId: number) => {
    if (!newRecipient.localPart || newRecipient.domainId !== domainId) return;
    const res = await fetch(`/api/admin/smtp/inbound/domains/${domainId}/recipients`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ local_part: newRecipient.localPart })
    });
    if (res.ok) {
      setNewRecipient({ domainId: 0, localPart: '' });
      fetchInboundConfig();
    }
  };

  const handleDeleteRecipient = async (id: number) => {
    const res = await fetch(`/api/admin/smtp/inbound/recipients/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) fetchInboundConfig();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newUser)
    });
    if (res.ok) {
      setMessage({ type: 'success', text: 'User created successfully' });
      setNewUser({ email: '', username: '', password: '', role: 'Analyst' });
      fetchUsers();
    } else {
      const data = await res.json();
      setMessage({ type: 'error', text: data.detail || 'Failed to create user' });
    }
  };

  const handleToggleUserStatus = async (user_id: number, current_active: boolean) => {
    const res = await fetch(`/api/admin/users/${user_id}`, {
      method: 'PATCH',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ is_active: !current_active })
    });
    if (res.ok) fetchUsers();
  };

  const handleDeleteUser = async (user_id: number) => {
    if (!window.confirm('Delete this user?')) return;
    const res = await fetch(`/api/admin/users/${user_id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) fetchUsers();
  };

  const handleUpdateUserRole = async (user_id: number, newRole: string) => {
    const res = await fetch(`/api/admin/users/${user_id}`, {
      method: 'PATCH',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: newRole })
    });
    if (res.ok) fetchUsers();
  };

  const fetchTestResults = async () => {
    const res = await fetch('/api/admin/smtp/test-results', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setTestResults(await res.json());
  };

  const handleTriggerTest = async () => {
    if (!testDomain || !testRecipient) return;
    setTriggering(true);
    const res = await fetch(`/api/admin/smtp/test-trigger?domain=${testDomain}&recipient=${testRecipient}&type=${testType}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    setTriggering(false);
    const data = await res.json();
    if (res.ok) {
      setMessage({ type: 'success', text: 'Test message triggered successfully' });
      // Poll for results after a delay
      setTimeout(fetchTestResults, 3000);
    } else {
      setMessage({ type: 'error', text: data.detail || 'Failed to trigger test' });
    }
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

  const handleAddDomain = async () => {
    if (!newDomainName) return;
    const res = await fetch('/api/domains', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: newDomainName, dmarc_policy: 'none' })
    });
    if (res.ok) {
      setNewDomainName('');
      fetchDomains();
      setMessage({ type: 'success', text: 'Domain added' });
    } else {
      setMessage({ type: 'error', text: 'Failed to add domain' });
    }
  };

  const handleDeleteDomain = async (id: number) => {
    if (!window.confirm('Delete this domain?')) return;
    const res = await fetch(`/api/domains/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      fetchDomains();
      setMessage({ type: 'success', text: 'Domain deleted' });
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
            <button className={activeTab === 'domains' ? 'active' : ''} onClick={() => setActiveTab('domains')}>Domains</button>
            <button className={activeTab === 'users' ? 'active' : ''} onClick={() => setActiveTab('users')}>User Management</button>
            <button className={activeTab === 'auth' ? 'active' : ''} onClick={() => setActiveTab('auth')}>Authentication</button>
            <button onClick={() => setActiveTab('branding')} className={activeTab === 'branding' ? 'active' : ''}>Branding</button>
            <button onClick={() => setActiveTab('smtp')} className={activeTab === 'smtp' ? 'active' : ''}>SMTP Test</button>
            <button onClick={() => setActiveTab('smtp_inbound')} className={activeTab === 'smtp_inbound' ? 'active' : ''}>SMTP Inbound</button>
            <button onClick={() => setActiveTab('audit')} className={activeTab === 'audit' ? 'active' : ''}>Security Audit</button>
          </>
        )}
      </div>

      <div className="settings-main glass-card">
        {message && <div className={`alert-banner ${message.type}`}>{message.text}</div>}

        {activeTab === 'profile' && (
          <div className="settings-section">
            <h3>My Profile</h3>
            <div className="profile-info">
              <p><strong>Username:</strong> {currentUser?.username || '...'}</p>
              <p><strong>Email:</strong> {currentUser?.email || '...'}</p>
              <p><strong>Role:</strong> <span className="status-tag status-pass">{currentUser?.role || '...'}</span></p>
              <p><strong>Auth Source:</strong> {currentUser?.auth_source === 'LOCAL' ? <><HomeIcon/> Local Account</> : <><CloudIcon/> Microsoft Entra ID</>}</p>
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

        {activeTab === 'domains' && (
          <div className="settings-section">
            <h3>Managed Domains</h3>
            <div className="add-domain-group" style={{marginBottom: '2rem', display: 'flex', gap: '1rem'}}>
               <input 
                 type="text" 
                 placeholder="Domain name (e.g. example.com)" 
                 className="text-input" 
                 value={newDomainName} 
                 onChange={e => setNewDomainName(e.target.value)} 
               />
               <button className="action-btn primary-btn" onClick={handleAddDomain}>Add Domain</button>
            </div>
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {domains.map(d => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td><button className="delete-btn" onClick={() => handleDeleteDomain(d.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'auth' && settings && (
          <div className="settings-section">
            <h3>Global Application Settings</h3>
            <div className="settings-subsection">
              <h4>Base Configuration</h4>
              <div className="form-group">
                <label>Public Application URL</label>
                <input type="text" value={settings.public_url || ''} placeholder="https://dmarc.eidolf.de" onChange={e => setSettings({...settings, public_url: e.target.value})} className="text-input" />
                <p className="hint-text">Used for SSO Redirect URIs and internal links. No trailing slash.</p>
              </div>
            </div>
            
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
                  <option value="single">Single Tenant (Specific Organization)</option>
                  <option value="organizations">Multiple Entra ID Tenants (Work/School)</option>
                  <option value="common">Any Entra ID Tenant + Personal Accounts</option>
                  <option value="consumers">Personal Microsoft Accounts Only</option>
                </select>
              </div>
              <div className="form-group">
                <label>Default Role for New SSO Users</label>
                <select value={settings.default_sso_role} onChange={e => setSettings({...settings, default_sso_role: e.target.value})} className="text-input">
                  <option value="Admin">Admin</option>
                  <option value="Analyst">Analyst</option>
                  <option value="Read-only">Read-only</option>
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
            <div className="form-group">
              <label>Logo URL (optional)</label>
              <input type="text" className="text-input" placeholder="https://example.com/logo.png" value={settings.logo_url || ''} onChange={e => setSettings({...settings, logo_url: e.target.value})} />
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
                      <td>{formatDateTime(log.timestamp)}</td>
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

        {activeTab === 'users' && (
          <div className="settings-section">
            <h3>User Management</h3>
            
            <div className="settings-subsection">
              <h4>Create Local User</h4>
              <form onSubmit={handleCreateUser} className="glass-card" style={{padding: '1.5rem'}}>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Email (must end in @local)</label>
                    <input type="text" className="text-input" placeholder="user@local" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Username</label>
                    <input type="text" className="text-input" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} required />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Initial Password</label>
                    <input type="password" name="new-password" id="new-password"  autoComplete="new-password"  className="text-input" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Role</label>
                    <select className="text-input" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>
                      <option value="Admin">Admin</option>
                      <option value="Analyst">Analyst</option>
                      <option value="Read-only">Read-only</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className="action-btn primary-btn">Create Local Account</button>
              </form>
            </div>

            <div className="settings-subsection">
              <h4>Existing Users</h4>
              <div className="scroll-box">
                <table className="modern-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Email</th>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Last Login</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td>
                          {u.auth_source === 'LOCAL' ? 
                            <span title="Local Account" style={{color: 'var(--accent-blue)', display: 'flex', alignItems: 'center'}}><HomeIcon/> Local</span> : 
                            <span title="Entra ID" style={{color: '#0078d4', display: 'flex', alignItems: 'center'}}><CloudIcon/> Entra</span>
                          }
                        </td>
                        <td>{u.email}</td>
                        <td>{u.username}</td>
                        <td>
                          <select 
                            value={u.role} 
                            onChange={(e) => handleUpdateUserRole(u.id, e.target.value)}
                            className="text-input small-input"
                            style={{padding: '2px 5px', fontSize: '0.8rem'}}
                          >
                            <option value="Admin">Admin</option>
                            <option value="Analyst">Analyst</option>
                            <option value="Read-only">Read-only</option>
                          </select>
                        </td>
                        <td><span className={`status-tag ${u.is_active ? 'status-pass' : 'status-fail'}`}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                        <td>{u.last_login ? formatDateTime(u.last_login) : 'Never'}</td>
                        <td>
                          <div style={{display: 'flex', gap: '0.5rem'}}>
                            <button onClick={() => handleToggleUserStatus(u.id, u.is_active)} className="action-btn small-btn">
                              {u.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button onClick={() => handleDeleteUser(u.id)} className="action-btn small-btn danger-btn">Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'smtp' && settings && (
          <div className="settings-section">
            <h3>SMTP Ingestion Test Framework</h3>
            <p className="subtitle">Verify reachability and end-to-end processing without production traffic.</p>
            
            <div className="settings-subsection">
              <h4>Test Mode Configuration</h4>
              <div className="toggle-group">
                <label>
                  <input type="checkbox" checked={settings.smtp_test_mode_enabled} onChange={e => setSettings({...settings, smtp_test_mode_enabled: e.target.checked})} />
                  Enable SMTP Test Mode
                </label>
                <div className="form-group" style={{marginTop: '1rem'}}>
                  <label>Allowed Test Recipients (Comma separated)</label>
                  <input type="text" className="text-input" placeholder="report@dmarc.domain.com" value={settings.allowed_test_recipients || ''} onChange={e => setSettings({...settings, allowed_test_recipients: e.target.value})} />
                </div>
                <button onClick={handleSaveSettings} className="action-btn">Update Test Configuration</button>
              </div>
            </div>

            <div className="settings-subsection">
              <h4>Trigger Portal-Based Test</h4>
              <div className="glass-card" style={{padding: '1.5rem', background: 'rgba(255,255,255,0.02)'}}>
                <div className="form-group">
                  <label>Test Domain</label>
                  <input type="text" className="text-input" placeholder="test-domain.com" value={testDomain} onChange={e => setTestDomain(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Target Recipient</label>
                  <input type="text" className="text-input" placeholder="report@dmarc.domain.com" value={testRecipient} onChange={e => setTestRecipient(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Report Type</label>
                  <select className="text-input" value={testType} onChange={e => setTestType(e.target.value)}>
                    <option value="RUA">Aggregate (RUA)</option>
                    <option value="RUF">Forensic (RUF)</option>
                  </select>
                </div>
                <button onClick={handleTriggerTest} disabled={triggering} className="action-btn primary-btn" style={{width: '100%'}}>{triggering ? 'Sending...' : 'Trigger SMTP Test Message'}</button>
              </div>
            </div>

            <div className="settings-subsection">
              <h4>Recent Test Results</h4>
              <div className="scroll-box" style={{maxHeight: '300px'}}>
                <table className="modern-table">
                  <thead>
                    <tr>
                      <th>Time (End)</th>
                      <th>Org Name</th>
                      <th>Domain</th>
                      <th>Report ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testResults.map(res => (
                      <tr key={res.id}>
                        <td>{formatDateTime(res.date_end)}</td>
                        <td>{res.org_name}</td>
                        <td>{res.domain_name}</td>
                        <td><code>{res.report_id}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'smtp_inbound' && (
          <div className="settings-section">
            <h3>SMTP Inbound Configuration</h3>
            <p className="subtitle">Configure listening domains and accepted recipients for direct DMARC report delivery.</p>

            <div className="settings-subsection">
              <h4>Add Listening Domain</h4>
              <div className="input-group">
                <input type="text" className="text-input" placeholder="dmarc.example.com" value={newInboundDomain} onChange={e => setNewInboundDomain(e.target.value)} />
                <button onClick={handleAddInboundDomain} className="action-btn primary-btn">Add Domain</button>
              </div>
              <p className="hint-text">Ensure your MX records point to this system's IP/hostname.</p>
            </div>

            <div className="settings-subsection">
              <h4>Configured Endpoints</h4>
              {inboundConfig.map(domain => (
                <div key={domain.id} className="glass-card" style={{marginBottom: '1.5rem', padding: '1.5rem', border: domain.is_active ? '1px solid var(--border-glass)' : '1px solid rgba(239, 68, 68, 0.3)'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                    <div>
                      <h5 style={{fontSize: '1.1rem', margin: 0}}>{domain.domain_name}</h5>
                      <span className={`status-tag ${domain.is_active ? 'status-pass' : 'status-fail'}`} style={{fontSize: '0.7rem'}}>
                        {domain.is_active ? 'Accepting Traffic' : 'Disabled'}
                      </span>
                    </div>
                    <div style={{display: 'flex', gap: '0.5rem'}}>
                      <button onClick={() => handleToggleInboundDomain(domain.id, domain.is_active)} className="action-btn small-btn">
                        {domain.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => handleDeleteInboundDomain(domain.id)} className="action-btn small-btn danger-btn">Remove</button>
                    </div>
                  </div>

                  <div className="recipients-list" style={{background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '1rem'}}>
                    <h6 style={{marginBottom: '0.5rem', textTransform: 'uppercase', fontSize: '0.75rem', color: 'var(--text-secondary)'}}>Accepted Recipients</h6>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem'}}>
                      {domain.recipients.map((r: any) => (
                        <div key={r.id} className="badge" style={{display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)'}}>
                          {r.local_part}@{domain.domain_name}
                          <span onClick={() => handleDeleteRecipient(r.id)} style={{cursor: 'pointer', opacity: 0.6}}>&times;</span>
                        </div>
                      ))}
                    </div>
                    <div className="input-group small">
                      <input 
                        type="text" 
                        className="text-input" 
                        placeholder="e.g. report" 
                        style={{fontSize: '0.85rem'}}
                        value={newRecipient.domainId === domain.id ? newRecipient.localPart : ''} 
                        onChange={e => setNewRecipient({domainId: domain.id, localPart: e.target.value})} 
                      />
                      <button onClick={() => handleAddRecipient(domain.id)} className="action-btn small-btn">Add Address</button>
                    </div>
                  </div>
                </div>
              ))}
              {inboundConfig.length === 0 && <p style={{color: 'var(--text-secondary)', fontStyle: 'italic'}}>No listening domains configured.</p>}
            </div>

            <div className="settings-subsection">
              <h4>Server Information</h4>
              <div className="glass-card" style={{padding: '1rem', background: 'rgba(59, 130, 246, 0.05)', borderLeft: '3px solid var(--accent-blue)'}}>
                <p style={{fontSize: '0.9rem'}}><strong>SMTP Port:</strong> 25 (Standard) / 2525 (Internal)</p>
                <p style={{fontSize: '0.9rem', marginTop: '0.5rem'}}><strong>Security:</strong> STARTTLS supported. Incoming traffic is validated against the configured domains and recipients above.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
