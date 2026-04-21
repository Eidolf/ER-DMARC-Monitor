import React, { useState, useEffect, useMemo } from 'react';
import './App.css';

interface AppSettings {
  titlePart1: string;
  titlePart2: string;
  colorPart1: string;
  colorPart2: string;
  logoUrl: string;
}

interface Stats {
  total_analyzed: number;
  spf_failures: number;
  dkim_failures: number;
  unauthorized_senders: number;
}

interface AuthDetail {
  domain: string;
  selector?: string;
  result: string;
  human_result?: string;
  scope?: string;
}

interface DetailedRecord {
  id: number;
  source_ip: string;
  count: number;
  disposition: string;
  dkim_pass: boolean;
  spf_pass: boolean;
  dkim_auth_details: AuthDetail[];
  spf_auth_details: AuthDetail[];
  report_id: string;
  org_name: string;
  date: string;
}

type SortKey = 'date' | 'source_ip' | 'count' | 'org_name';

const SortIcon = ({ active, direction }: { active: boolean; direction: 'asc' | 'desc' | null }) => {
  if (!active) return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sort-icon inactive">
      <path d="M7 15l5 5 5-5M7 9l5-5 5 5"/>
    </svg>
  );
  if (direction === 'asc') return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sort-icon active">
      <path d="M18 15l-6-6-6 6"/>
    </svg>
  );
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sort-icon active">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  );
};

function App() {
  const [data, setData] = useState<{ id: number, name: string, dmarc_policy: string }[]>([]);
  const [stats, setStats] = useState<Stats>({ total_analyzed: 0, spf_failures: 0, dkim_failures: 0, unauthorized_senders: 0 });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'overview' | 'help'>('overview');
  
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [inspectDomain, setInspectDomain] = useState<string | null>(null);
  const [inspectTab, setInspectTab] = useState<'log' | 'reporters'>('log');
  const [detailedRecords, setDetailedRecords] = useState<DetailedRecord[]>([]);
  const [expandedRecordId, setExpandedRecordId] = useState<number | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' | null }>({ key: 'date', direction: 'desc' });
  
  const [newDomainName, setNewDomainName] = useState('');
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('er-dmarc-settings');
    if (saved) return JSON.parse(saved);
    return {
      titlePart1: 'ER-DMARC',
      titlePart2: '-Monitor',
      colorPart1: '#e6edf3',
      colorPart2: '#3b82f6',
      logoUrl: '/favicon.png'
    };
  });

  useEffect(() => { localStorage.setItem('er-dmarc-settings', JSON.stringify(settings)); }, [settings]);

  const loadData = () => {
    fetch('/api/domains').then(res => res.json()).then(json => setData(Array.isArray(json) ? json : [])).catch(err => console.error(err));
    fetch('/api/reports/stats').then(res => res.json()).then(json => setStats(json)).catch(err => console.error(err)).finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const handleAddDomain = () => {
    if (!newDomainName) return;
    fetch('/api/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newDomainName, dmarc_policy: "none" })
    }).then(res => { if (res.ok) { setNewDomainName(''); loadData(); } });
  };

  const handleDeleteDomain = (id: number) => {
    if (!window.confirm("Delete domain?")) return;
    fetch(`/api/domains/${id}`, { method: 'DELETE' }).then(() => loadData());
  };

  const handleInspect = (domainName: string) => {
    setInspectDomain(domainName);
    setInspectTab('log');
    setDetailedRecords([]);
    setExpandedRecordId(null);
    setSearchQuery('');
    setSortConfig({ key: 'date', direction: 'desc' });
    fetch(`/api/domains/${domainName}/records`)
      .then(res => res.json())
      .then(json => { if (Array.isArray(json)) setDetailedRecords(json); })
      .catch(err => console.error(err));
  };

  const handleFileUpload = () => {
    if (!uploadFiles) return;
    const formData = new FormData();
    for(let i=0; i<uploadFiles.length; i++) formData.append('files', uploadFiles[i]);
    fetch('/api/reports/upload', { method: 'POST', body: formData }).then(() => { setUploadOpen(false); loadData(); });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => { if (event.target?.result) setSettings({...settings, logoUrl: event.target.result as string}); };
      reader.readAsDataURL(file);
    }
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

  return (
    <div className="dashboard-container">
      <div className="ambient-background"></div>
      <header className="glass-header">
        <div className="logo-section">
          {settings.logoUrl ? <img src={settings.logoUrl} alt="Logo" className="custom-logo" /> : <div className="logo-orb"></div>}
          <h1>
            <span style={{ color: settings.colorPart1 }}>{settings.titlePart1}</span>
            <span style={{ color: settings.colorPart2 }}>{settings.titlePart2}</span>
          </h1>
        </div>
        <nav>
          <button className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Overview</button>
          <button className="nav-item" onClick={() => setUploadOpen(true)}>Upload Reports</button>
          <button className={`nav-item ${view === 'help' ? 'active' : ''}`} onClick={() => setView('help')}>Help & Docs</button>
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>Admin Settings</button>
        </nav>
        <div className="user-profile">AE</div>
      </header>

      {view === 'overview' ? (
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
      ) : (
        <main className="dashboard-content">
          <div className="hero-section">
            <h2>User Manual & Documentation</h2>
            <p>Understanding the ER-DMARC-Monitor and its workflows</p>
          </div>
          
          <div className="help-grid">
            <div className="help-card">
              <div className="help-icon-box">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <h4>Overview & KPIs</h4>
              </div>
              <p>The dashboard provides a high-level view of your DMARC health. 
              <strong> Total Analyzed</strong> shows the sum of all email counts in uploaded reports. 
              <strong> Failures</strong> indicate emails that failed SPF or DKIM checks. 
              <strong> Unauthorized Senders</strong> identifies unique source IPs that failed both SPF and DKIM.</p>
            </div>
            <div className="help-card">
              <div className="help-icon-box">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <h4>Deep Analysis (Inspect)</h4>
              </div>
              <p>Click <strong>Inspect</strong> to open a domain-specific forensic view. 
              This view calculates a Security Score, identifies Top Senders, and flags suspicious unauthorized traffic. 
              You can click on individual rows to see <strong>Forensic Auth Details</strong> (SPF/DKIM domains and results). 
              Use the <strong>Reporters</strong> tab to see which organizations are sending reports.</p>
            </div>
            <div className="help-card">
              <div className="help-icon-box">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <h4>Admin & Management</h4>
              </div>
              <p>In the <strong>Admin Settings</strong>, you can add or remove monitored domains. 
              You can also customize the system title and color theme, and upload your own company logo.</p>
            </div>
            <div className="help-card">
              <div className="help-icon-box">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <h4>Report Upload</h4>
              </div>
              <p>You can manually inject multiple DMARC Aggregate Reports at once. 
              The system supports <strong>.xml</strong>, <strong>.gz</strong>, or <strong>.zip</strong> formats and handles duplicates automatically.</p>
            </div>
          </div>
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
      {settingsOpen && (
        <div className="modal-overlay">
          <div className="glass-card modal-content wide-modal">
             <div className="modal-header"><h2>Settings</h2><button onClick={() => setSettingsOpen(false)} className="close-btn">&times;</button></div>
             <div className="analysis-grid"><div className="analysis-col"><h4>Domains</h4><div className="add-domain-group"><input type="text" placeholder="name..." className="text-input" value={newDomainName} onChange={(e) => setNewDomainName(e.target.value)} /><button className="action-btn" onClick={handleAddDomain}>Add</button></div><table className="modern-table"><tbody>{data.map(d => (<tr key={d.id}><td>{d.name}</td><td><button className="delete-btn" onClick={() => handleDeleteDomain(d.id)}>Del</button></td></tr>))}</tbody></table></div></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
