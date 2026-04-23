import React, { useState, useEffect, useMemo } from 'react';
import './App.css';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './Login';
import SettingsView from './Settings';

interface AppSettings {
  title_part1: string;
  title_part2: string;
  color_part1: string;
  color_part2: string;
  logo_url: string | null;
}

interface Stats {
  total_analyzed: number;
  spf_failures: number;
  dkim_failures: number;
  unauthorized_senders: number;
}

// ... existing interfaces ...

function Dashboard() {
  const { token, role, logout } = useAuth();
  const [data, setData] = useState<{ id: number, name: string, dmarc_policy: string }[]>([]);
  const [stats, setStats] = useState<Stats>({ total_analyzed: 0, spf_failures: 0, dkim_failures: 0, unauthorized_senders: 0 });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'overview' | 'help' | 'settings'>('overview');
  
  const [uploadOpen, setUploadOpen] = useState(false);
  const [inspectDomain, setInspectDomain] = useState<string | null>(null);
  const [inspectTab, setInspectTab] = useState<'log' | 'reporters'>('log');
  const [detailedRecords, setDetailedRecords] = useState<DetailedRecord[]>([]);
  const [expandedRecordId, setExpandedRecordId] = useState<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' | null }>({ key: 'date', direction: 'desc' });
  
  const [newDomainName, setNewDomainName] = useState('');
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);

  const [settings, setSettings] = useState<AppSettings>({
    title_part1: 'ER-DMARC',
    title_part2: '-Monitor',
    color_part1: '#e6edf3',
    color_part2: '#3b82f6',
    logo_url: '/favicon.png'
  });

  const authFetch = (url: string, options: any = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`
      }
    }).then(res => {
      if (res.status === 401) {
        logout();
        throw new Error("Session expired");
      }
      return res;
    });
  };

  const loadData = () => {
    authFetch('/api/domains').then(res => res.json()).then(json => setData(Array.isArray(json) ? json : [])).catch(err => console.error(err));
    authFetch('/api/reports/stats').then(res => res.json()).then(json => setStats(json)).catch(err => console.error(err)).finally(() => setLoading(false));
    fetch('/api/settings/branding').then(res => res.json()).then(json => setSettings(json)).catch(err => console.error(err));
  };

  useEffect(() => { loadData(); }, []);

  // ... handleAddDomain, handleDeleteDomain, handleInspect, handleFileUpload ...

  const handleAddDomain = () => {
    if (!newDomainName) return;
    authFetch('/api/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newDomainName, dmarc_policy: "none" })
    }).then(res => { if (res.ok) { setNewDomainName(''); loadData(); } });
  };

  const handleDeleteDomain = (id: number) => {
    if (!window.confirm("Delete domain?")) return;
    authFetch(`/api/domains/${id}`, { method: 'DELETE' }).then(() => loadData());
  };

  const handleInspect = (domainName: string) => {
    setInspectDomain(domainName);
    setInspectTab('log');
    setDetailedRecords([]);
    setExpandedRecordId(null);
    setSearchQuery('');
    setSortConfig({ key: 'date', direction: 'desc' });
    authFetch(`/api/domains/${domainName}/records`)
      .then(res => res.json())
      .then(json => { if (Array.isArray(json)) setDetailedRecords(json); })
      .catch(err => console.error(err));
  };

  const handleFileUpload = () => {
    if (!uploadFiles) return;
    const formData = new FormData();
    for(let i=0; i<uploadFiles.length; i++) formData.append('files', uploadFiles[i]);
    authFetch('/api/reports/upload', { method: 'POST', body: formData }).then(() => { setUploadOpen(false); loadData(); });
  };

  const handleSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const processedRecords = useMemo(() => {
    let filtered = detailedRecords.filter(r => 
      r.source_ip.toLowerCase().includes(searchQuery.toLowerCase()) || 
      r.org_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (sortConfig.direction) {
      filtered.sort((a, b) => {
        const valA = a[sortConfig.key];
        const valB = b[sortConfig.key];
        if (typeof valA === 'string' && typeof valB === 'string') return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        if (typeof valA === 'number' && typeof valB === 'number') return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
        return 0;
      });
    }
    return filtered;
  }, [detailedRecords, searchQuery, sortConfig]);

  const totalInRecords = detailedRecords.reduce((acc, r) => acc + r.count, 0);
  const spfPassCount = detailedRecords.filter(r => r.spf_pass).reduce((acc, r) => acc + r.count, 0);
  const dkimPassCount = detailedRecords.filter(r => r.dkim_pass).reduce((acc, r) => acc + r.count, 0);
  const reporterMap = new Map<string, {count: number, spfFail: number, dkimFail: number, lastDate: string}>();
  detailedRecords.forEach(r => {
    const curr = reporterMap.get(r.org_name) || {count: 0, spfFail: 0, dkimFail: 0, lastDate: r.date};
    curr.count += r.count;
    if (!r.spf_pass) curr.spfFail += r.count;
    if (!r.dkim_pass) curr.dkimFail += r.count;
    if (new Date(r.date) > new Date(curr.lastDate)) curr.lastDate = r.date;
    reporterMap.set(r.org_name, curr);
  });
  const reporters = [...reporterMap.entries()].filter(([name]) => name.toLowerCase().includes(searchQuery.toLowerCase())).sort((a, b) => b[1].count - a[1].count);

  const isAdmin = role === 'Admin';
  const isAnalyst = role === 'Analyst' || isAdmin;

  return (
    <div className="dashboard-container">
      <div className="ambient-background"></div>
      <header className="glass-header">
        <div className="logo-section" onClick={() => setView('overview')} style={{cursor: 'pointer'}}>
          {settings.logo_url ? <img src={settings.logo_url} alt="Logo" className="custom-logo" /> : <div className="logo-orb"></div>}
          <h1>
            <span style={{ color: settings.color_part1 }}>{settings.title_part1}</span>
            <span style={{ color: settings.color_part2 }}>{settings.title_part2}</span>
          </h1>
        </div>
        <nav>
          <button className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Overview</button>
          {isAnalyst && <button className="nav-item" onClick={() => setUploadOpen(true)}>Upload Reports</button>}
          <button className={`nav-item ${view === 'help' ? 'active' : ''}`} onClick={() => setView('help')}>Help & Docs</button>
        </nav>
        <div className="user-section">
          <div className="profile-dropdown-wrapper">
            <div className="user-profile" onClick={() => setProfileOpen(!profileOpen)} title={`Role: ${role}`}>{role?.substring(0, 2).toUpperCase()}</div>
            {profileOpen && (
              <div className="profile-dropdown glass-card">
                <div className="dropdown-info">
                  <p className="role-badge">{role}</p>
                </div>
                <button onClick={() => { setView('settings'); setProfileOpen(false); }}>Settings & Profile</button>
                <div className="divider"></div>
                <button onClick={logout} className="logout-item">Sign Out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {view === 'overview' && (
        <main className="dashboard-content">
          <div className="hero-section"><h2>Security Posture</h2><p>DMARC monitoring console</p></div>
          <section className="kpi-grid">
            <div className="glass-card kpi"><h3>Total Analyzed</h3><span className="kpi-value text-gradient">{stats.total_analyzed.toLocaleString()}</span></div>
            <div className="glass-card kpi"><h3>SPF Failures</h3><span className={stats.spf_failures > 0 ? "kpi-value text-red" : "kpi-value text-gradient"}>{stats.spf_failures.toLocaleString()}</span></div>
            <div className="glass-card kpi"><h3>DKIM Failures</h3><span className={stats.dkim_failures > 0 ? "kpi-value text-orange" : "kpi-value text-gradient"}>{stats.dkim_failures.toLocaleString()}</span></div>
            <div className="glass-card kpi"><h3>Unauthorized Senders</h3><span className={stats.unauthorized_senders > 0 ? "kpi-value alert" : "kpi-value text-gradient"}>{stats.unauthorized_senders}</span></div>
          </section>
          <section className="domains-section">
            <div className="glass-card full-width">
              <div className="card-header"><h3>Monitored Domains</h3></div>
              <table className="modern-table">
                <thead><tr><th>Domain Name</th><th>Policy</th><th>Actions</th></tr></thead>
                <tbody>{data.map((domain) => (
                    <tr key={domain.id}><td>{domain.name}</td><td><span className={`badge policy-${domain.dmarc_policy || 'none'}`}>p={domain.dmarc_policy || 'none'}</span></td><td><button className="action-btn" onClick={() => handleInspect(domain.name)}>Inspect</button></td></tr>
                  ))}</tbody>
              </table>
            </div>
          </section>
        </main>
      )}

      {view === 'help' && (
        <main className="dashboard-content">
          <div className="hero-section"><h2>User Manual & Documentation</h2><p>Understanding the ER-DMARC-Monitor and its workflows</p></div>
          <div className="help-grid">
            <div className="help-card">
              <div className="help-icon-box">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <h4>Overview & KPIs</h4>
              </div>
              <p>The dashboard provides a high-level view of your DMARC health. Failures indicate emails that failed SPF or DKIM checks.</p>
            </div>
            {/* ... other help cards ... */}
          </div>
          <button className="action-btn" style={{marginTop: '2rem'}} onClick={() => setView('overview')}>Back to Dashboard</button>
        </main>
      )}

      {view === 'settings' && (
        <main className="dashboard-content">
          <div className="hero-section"><h2>System & Personal Settings</h2><p>Manage your identity and configuration</p></div>
          <SettingsView />
          <button className="action-btn" style={{marginTop: '2rem'}} onClick={() => setView('overview')}>Back to Dashboard</button>
        </main>
      )}

      {uploadOpen && (
        <div className="modal-overlay">
          <div className="glass-card modal-content" style={{ padding: '2rem' }}>
             <div className="modal-header"><h2>Bulk Upload</h2><button onClick={() => setUploadOpen(false)} className="close-btn">&times;</button></div>
             <input type="file" multiple onChange={(e) => setUploadFiles(e.target.files)} />
             <button className="action-btn" style={{marginTop: '1.5rem', width: '100%'}} onClick={handleFileUpload}>Process</button>
          </div>
        </div>
      )}

      {inspectDomain && (
        <div className="modal-overlay">
          <div className="glass-card modal-content wide-modal" style={{ padding: '2rem' }}>
             <div className="modal-header">
                <div><h2>Deep Analysis: {inspectDomain}</h2><p>Forensic overview</p></div>
                <div className="header-actions">
                    <input type="text" placeholder="Search..." className="text-input" style={{ width: '200px', marginRight: '1rem' }} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    <button onClick={() => setInspectDomain(null)} className="close-btn">&times;</button>
                </div>
             </div>
             <div className="modal-tabs">
                <button className={`tab-btn ${inspectTab === 'log' ? 'active' : ''}`} onClick={() => setInspectTab('log')}>Traffic Log</button>
                <button className={`tab-btn ${inspectTab === 'reporters' ? 'active' : ''}`} onClick={() => setInspectTab('reporters')}>Reporters</button>
             </div>
             <div className="analysis-grid">
                <div className="analysis-col">
                    <div className="report-summary-strip" style={{margin: '0', width: '100%', justifyContent: 'space-around'}}>
                        <div className="summary-item"><label>Volume</label><span>{totalInRecords.toLocaleString()}</span></div>
                        <div className="summary-item"><label>Health</label><span>{totalInRecords > 0 ? Math.round(((spfPassCount + dkimPassCount) / (2 * totalInRecords)) * 100) : 0}%</span></div>
                    </div>
                    <div className="scroll-box" style={{marginTop: '1rem', minHeight: '350px'}}>
                        {inspectTab === 'log' ? (
                            <table className="modern-table">
                                <thead>
                                    <tr>
                                    <th className="sortable-header" onClick={() => handleSort('source_ip')}><div className="th-content">Source IP <SortIcon active={sortConfig.key==='source_ip'} direction={sortConfig.direction} /></div></th>
                                    <th className="sortable-header" onClick={() => handleSort('count')}><div className="th-content">Volume <SortIcon active={sortConfig.key==='count'} direction={sortConfig.direction} /></div></th>
                                    <th className="sortable-header" onClick={() => handleSort('org_name')}><div className="th-content">Reporter <SortIcon active={sortConfig.key==='org_name'} direction={sortConfig.direction} /></div></th>
                                    <th className="sortable-header" onClick={() => handleSort('date')}><div className="th-content">Date <SortIcon active={sortConfig.key==='date'} direction={sortConfig.direction} /></div></th>
                                    <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {processedRecords.map(r => (
                                    <React.Fragment key={r.id}>
                                        <tr className={`clickable-row ${expandedRecordId === r.id ? 'expanded' : ''}`} onClick={() => setExpandedRecordId(expandedRecordId === r.id ? null : r.id)} >
                                            <td>{r.source_ip}</td><td>{r.count}</td><td>{r.org_name}</td><td>{new Date(r.date).toLocaleDateString()}</td>
                                            <td><span className={`status-tag ${r.spf_pass && r.dkim_pass ? 'status-pass' : 'status-fail'}`}>{r.spf_pass && r.dkim_pass ? 'PASS' : 'ALRT'}</span></td>
                                        </tr>
                                        {expandedRecordId === r.id && (
                                            <tr className="auth-detail-row"><td colSpan={5}><div className="auth-detail-box"><h5>Forensics</h5><div className="detail-cols"><div className="detail-col"><h6>SPF</h6>{r.spf_auth_details.map((s, i) => (<div key={i} className="auth-entry"><span>{s.domain}: {s.result}</span></div>))}</div><div className="detail-col"><h6>DKIM</h6>{r.dkim_auth_details.map((d, i) => (<div key={i} className="auth-entry"><span>{d.domain}: {d.result}</span></div>))}</div></div></div></td></tr>
                                        )}
                                    </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <table className="modern-table">
                                <thead><tr><th className="sortable-header" onClick={() => handleSort('org_name')}><div className="th-content">Reporting Org <SortIcon active={sortConfig.key==='org_name'} direction={sortConfig.direction} /></div></th><th>Volume</th><th>SPF Fail</th><th>DKIM Fail</th></tr></thead>
                                <tbody>{reporters.map(([name, meta]) => (<tr key={name}><td>{name}</td><td>{meta.count}</td><td>{meta.spfFail}</td><td>{meta.dkimFail}</td></tr>))}</tbody>
                            </table>
                        )}
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ... App and AppContent components ...
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Login />;
  return <Dashboard />;
}

export default App;

