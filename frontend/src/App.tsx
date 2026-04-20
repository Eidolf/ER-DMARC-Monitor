import React, { useState, useEffect } from 'react';
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

function App() {
  const [data, setData] = useState<{ id: number, name: string, dmarc_policy: string }[]>([]);
  const [stats, setStats] = useState<Stats>({ total_analyzed: 0, spf_failures: 0, dkim_failures: 0, unauthorized_senders: 0 });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'overview' | 'help'>('overview');
  
  // Modals
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [inspectDomain, setInspectDomain] = useState<string | null>(null);
  const [detailedRecords, setDetailedRecords] = useState<DetailedRecord[]>([]);
  const [expandedRecordId, setExpandedRecordId] = useState<number | null>(null);
  
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

  useEffect(() => {
    localStorage.setItem('er-dmarc-settings', JSON.stringify(settings));
  }, [settings]);

  const loadData = () => {
    fetch('/api/domains')
      .then(res => res.json())
      .then(json => setData(Array.isArray(json) ? json : []))
      .catch(err => console.error(err));

    fetch('/api/reports/stats')
      .then(res => res.json())
      .then(json => setStats(json))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddDomain = () => {
    if (!newDomainName) return;
    fetch('/api/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newDomainName, dmarc_policy: "none" })
    }).then(res => {
      if (res.ok) {
        setNewDomainName('');
        loadData();
      } else {
        alert("Domain could not be added or already exists.");
      }
    });
  };

  const handleDeleteDomain = (id: number) => {
    if (!window.confirm("Are you sure you want to delete this monitored domain?")) return;
    fetch(`/api/domains/${id}`, { method: 'DELETE' })
      .then(() => loadData());
  };

  const handleInspect = (domainName: string) => {
    setInspectDomain(domainName);
    setDetailedRecords([]);
    setExpandedRecordId(null);
    fetch(`/api/domains/${domainName}/records`)
      .then(res => res.json())
      .then(json => {
         if (Array.isArray(json)) setDetailedRecords(json);
         else setDetailedRecords([]);
      })
      .catch(err => console.error(err));
  };

  const handleFileUpload = () => {
    if (!uploadFiles || uploadFiles.length === 0) return;
    const formData = new FormData();
    for(let i=0; i<uploadFiles.length; i++) {
       formData.append('files', uploadFiles[i]);
    }

    fetch('/api/reports/upload', {
      method: 'POST',
      body: formData
    }).then(res => res.json())
      .then(res => {
        const successes = (res.results || []).filter((r:any) => r.status === 'success').length;
        const skipped = (res.results || []).filter((r:any) => r.status === 'skipped').length;
        alert(`Process complete! ${successes} new reports processed, ${skipped} duplicates skiped.`);
        setUploadOpen(false);
        setUploadFiles(null);
        loadData();
      }).catch(err => alert("Error uploading files: " + err));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
         if (event.target?.result) {
            setSettings({...settings, logoUrl: event.target.result as string});
         }
      };
      reader.readAsDataURL(file);
    }
  };

  // Deep Analysis Logic
  const totalInRecords = detailedRecords.reduce((acc, r) => acc + r.count, 0);
  const spfPassCount = detailedRecords.filter(r => r.spf_pass).reduce((acc, r) => acc + r.count, 0);
  const dkimPassCount = detailedRecords.filter(r => r.dkim_pass).reduce((acc, r) => acc + r.count, 0);
  
  const ipMap = new Map<string, {count: number, fail: boolean}>();
  detailedRecords.forEach(r => {
     const curr = ipMap.get(r.source_ip) || {count: 0, fail: false};
     curr.count += r.count;
     if (!r.spf_pass || !r.dkim_pass) curr.fail = true;
     ipMap.set(r.source_ip, curr);
  });
  const topIps = [...ipMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  return (
    <div className="dashboard-container">
      <div className="ambient-background"></div>
      
      <header className="glass-header">
        <div className="logo-section">
          {settings.logoUrl ? (
             <img src={settings.logoUrl} alt="Logo" className="custom-logo" />
          ) : (
             <div className="logo-orb"></div>
          )}
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
          <div className="hero-section">
            <h2>Security Posture</h2>
            <p>Real-time analytics across your monitored infrastructure</p>
          </div>

          <section className="kpi-grid">
            <div className="glass-card kpi">
              <h3>Total Analyzed</h3>
              <span className="kpi-value text-gradient">{stats.total_analyzed.toLocaleString()}</span>
            </div>
            <div className="glass-card kpi">
              <h3>SPF Failures</h3>
              <span className={stats.spf_failures > 0 ? "kpi-value text-red" : "kpi-value text-gradient"}>{stats.spf_failures.toLocaleString()}</span>
            </div>
            <div className="glass-card kpi">
              <h3>DKIM Failures</h3>
              <span className={stats.dkim_failures > 0 ? "kpi-value text-orange" : "kpi-value text-gradient"}>{stats.dkim_failures.toLocaleString()}</span>
            </div>
            <div className="glass-card kpi">
              <h3>Unauthorized Senders</h3>
              <span className={stats.unauthorized_senders > 0 ? "kpi-value alert" : "kpi-value text-gradient"}>{stats.unauthorized_senders}</span>
            </div>
          </section>

          <section className="domains-section">
            <div className="glass-card full-width">
              <div className="card-header">
                <h3>Monitored Domains</h3>
              </div>
              
              {loading ? (
                <div className="empty-state">Loading infrastructure...</div>
              ) : data.length === 0 ? (
                <div className="empty-state">
                    <h4>No domains monitored yet.</h4>
                    <p>Go to Admin Settings to register your first domain.</p>
                </div>
              ) : (
                <table className="modern-table">
                  <thead>
                    <tr>
                      <th>Domain Name</th>
                      <th>Configured DMARC Policy</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((domain) => (
                      <tr key={domain.id}>
                        <td className="font-semibold">{domain.name}</td>
                        <td><span className={`badge policy-${domain.dmarc_policy || 'none'}`}>p={domain.dmarc_policy || 'none'}</span></td>
                        <td><button className="action-btn" onClick={() => handleInspect(domain.name)}>Inspect</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
              You can click on individual rows to see <strong>Forensic Auth Details</strong> (SPF/DKIM domains and results).</p>
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
              Supported formats are <strong>.xml</strong>, <strong>.gz</strong>, or <strong>.zip</strong>.</p>
            </div>
          </div>
          <button className="action-btn" style={{marginTop: '2rem'}} onClick={() => setView('overview')}>Back to Dashboard</button>
        </main>
      )}

      {uploadOpen && (
        <div className="modal-overlay">
          <div className="glass-card modal-content" style={{ padding: '2rem' }}>
             <div className="modal-header">
               <h2>Bulk Upload DMARC Reports</h2>
               <button onClick={() => setUploadOpen(false)} className="close-btn">&times;</button>
             </div>
             <p style={{marginBottom: '1rem', color: 'var(--text-secondary)'}}>
               Select one or more .xml, .xml.gz or .zip files.
             </p>
             <input type="file" accept=".xml,.gz,.zip" multiple onChange={(e) => setUploadFiles(e.target.files)} />
             <button className="action-btn" style={{marginTop: '1.5rem', width: '100%'}} onClick={handleFileUpload}>Start Bulk Processing</button>
          </div>
        </div>
      )}

      {inspectDomain && (
        <div className="modal-overlay">
          <div className="glass-card modal-content wide-modal" style={{ padding: '2rem' }}>
             <div className="modal-header">
                <div>
                    <h2>Deep Analysis: {inspectDomain}</h2>
                    <p style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Forensic deep-dive for {inspectDomain}</p>
                </div>
                <button onClick={() => setInspectDomain(null)} className="close-btn">&times;</button>
             </div>
             
             <div className="analysis-grid">
                <div className="analysis-col">
                    <div className="report-summary-strip" style={{margin: '0', width: '100%', justifyContent: 'space-around'}}>
                        <div className="summary-item">
                            <label>Email Volume</label>
                            <span>{totalInRecords.toLocaleString()}</span>
                        </div>
                        <div className="summary-item">
                            <label>Security Health</label>
                            <span className={totalInRecords === 0 ? "" : (spfPassCount + dkimPassCount) / (2 * totalInRecords) > 0.9 ? "text-green" : "text-orange"}>
                                {totalInRecords > 0 ? Math.round(((spfPassCount + dkimPassCount) / (2 * totalInRecords)) * 100) : 0}%
                            </span>
                        </div>
                    </div>
                    
                    <div className="scroll-box" style={{marginTop: '1rem', minHeight: '300px'}}>
                        <h4 style={{marginBottom: '1rem', color: 'var(--text-primary)'}}>Forensic Traffic Log</h4>
                        <table className="modern-table">
                            <thead>
                                <tr>
                                <th>Source IP</th>
                                <th>Volume</th>
                                <th>SPF</th>
                                <th>DKIM</th>
                                </tr>
                            </thead>
                            <tbody>
                                {detailedRecords.map(r => (
                                <React.Fragment key={r.id}>
                                    <tr 
                                      className={`clickable-row ${expandedRecordId === r.id ? 'expanded' : ''}`}
                                      onClick={() => setExpandedRecordId(expandedRecordId === r.id ? null : r.id)}
                                    >
                                        <td style={{fontSize: '0.85rem'}}><code>{r.source_ip}</code></td>
                                        <td>{r.count}</td>
                                        <td><span className={`status-tag ${r.spf_pass ? 'status-pass' : 'status-fail'}`}>{r.spf_pass ? 'PASS' : 'FAIL'}</span></td>
                                        <td><span className={`status-tag ${r.dkim_pass ? 'status-pass' : 'status-fail'}`}>{r.dkim_pass ? 'PASS' : 'FAIL'}</span></td>
                                    </tr>
                                    {expandedRecordId === r.id && (
                                        <tr className="auth-detail-row">
                                            <td colSpan={4}>
                                                <div className="auth-detail-box">
                                                    <h5>Authentication Forensic Details</h5>
                                                    <div className="detail-cols">
                                                        <div className="detail-col">
                                                            <h6>SPF Results</h6>
                                                            {r.spf_auth_details.length === 0 ? <p>No data</p> : r.spf_auth_details.map((s, idx) => (
                                                                <div key={idx} className="auth-entry">
                                                                    <span><strong>Domain:</strong> {s.domain}</span>
                                                                    <span><strong>Result:</strong> <span className={s.result === 'pass' ? 'text-green' : 'text-red'}>{s.result}</span></span>
                                                                    {s.scope && <span><strong>Scope:</strong> {s.scope}</span>}
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="detail-col">
                                                            <h6>DKIM Results</h6>
                                                            {r.dkim_auth_details.length === 0 ? <p>No data</p> : r.dkim_auth_details.map((d, idx) => (
                                                                <div key={idx} className="auth-entry">
                                                                    <span><strong>Domain:</strong> {d.domain}</span>
                                                                    <span><strong>Selector:</strong> {d.selector}</span>
                                                                    <span><strong>Result:</strong> <span className={d.result === 'pass' ? 'text-green' : 'text-red'}>{d.result}</span></span>
                                                                    {d.human_result && <p className="human-hint">{d.human_result}</p>}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                                ))}
                                {detailedRecords.length === 0 && (
                                  <tr>
                                    <td colSpan={4} style={{textAlign:'center', padding: '3rem'}}>
                                      <p style={{marginBottom: '0.5rem'}}>No records found for this domain.</p>
                                    </td>
                                  </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="analysis-col side-panel">
                    <h4 style={{marginBottom: '1rem'}}>Top Senders</h4>
                    <div className="top-senders-list">
                        {topIps.map(([ip, meta]) => (
                            <div key={ip} className="sender-item">
                                <div className="sender-info">
                                    <span className="sender-ip">{ip}</span>
                                    <span className="sender-count">{meta.count}</span>
                                </div>
                                <div className="sender-bar-bg">
                                    <div className={`sender-bar ${meta.fail ? 'fail' : 'pass'}`} style={{width: `${(meta.count / (totalInRecords || 1)) * 100}%`}}></div>
                                </div>
                            </div>
                        ))}
                        {topIps.length === 0 && <p style={{color: 'var(--text-secondary)'}}>No sender data.</p>}
                    </div>
                    
                    <div className="forensic-insight" style={{marginTop: '2rem'}}>
                        <h4>Forensic Insights</h4>
                        <div className="insight-card">
                            {totalInRecords === 0 ? "Upload reports to generate forensic insights." : 
                             spfPassCount === totalInRecords && dkimPassCount === totalInRecords ? 
                             "Domain configuration is solid. All observed traffic is fully authenticated." : 
                             "Forensic Alert: Unauthenticated traffic detected. Check detail view for DKIM selector/domain mismatches."}
                        </div>
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-overlay">
          <div className="glass-card modal-content wide-modal" style={{ padding: '2rem' }}>
             <div className="modal-header">
               <h2>Admin Control Panel</h2>
               <button onClick={() => setSettingsOpen(false)} className="close-btn">&times;</button>
             </div>
             
             <div className="analysis-grid">
               <div className="analysis-col">
                 <h4 style={{marginBottom: '1rem'}}>Managed Infrastructure</h4>
                 <div className="add-domain-group" style={{marginBottom: '1rem'}}>
                    <input 
                    type="text" 
                    placeholder="Domain name..." 
                    className="text-input" 
                    style={{ marginRight: '10px', width: '250px' }}
                    value={newDomainName} 
                    onChange={(e) => setNewDomainName(e.target.value)} 
                    />
                    <button className="action-btn" onClick={handleAddDomain}>Add Domain</button>
                 </div>
                 <table className="modern-table">
                   <thead>
                     <tr>
                       <th>Domain</th>
                       <th>Policy</th>
                       <th>Action</th>
                     </tr>
                   </thead>
                   <tbody>
                     {data.map(d => (
                       <tr key={d.id}>
                         <td>{d.name}</td>
                         <td>{d.dmarc_policy}</td>
                         <td><button className="delete-btn" onClick={() => handleDeleteDomain(d.id)}>Delete</button></td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>

               <div className="analysis-col side-panel">
                 <h4 style={{marginBottom: '1rem'}}>Appearance Settings</h4>
                 <div className="form-group">
                   <label>Title Part 1</label>
                   <div className="input-group">
                      <input type="text" className="text-input" value={settings.titlePart1} onChange={e => setSettings({...settings, titlePart1: e.target.value})} />
                      <input type="color" className="color-picker" value={settings.colorPart1} onChange={e => setSettings({...settings, colorPart1: e.target.value})} />
                   </div>
                 </div>
                 <div className="form-group">
                   <label>Title Part 2</label>
                   <div className="input-group">
                      <input type="text" className="text-input" value={settings.titlePart2} onChange={e => setSettings({...settings, titlePart2: e.target.value})} />
                      <input type="color" className="color-picker" value={settings.colorPart2} onChange={e => setSettings({...settings, colorPart2: e.target.value})} />
                   </div>
                 </div>
                 <div className="form-group">
                   <label>System Logo</label>
                   <input type="file" accept="image/*" onChange={handleLogoUpload} className="file-input" />
                   {settings.logoUrl && <div className="logo-preview-box"><img src={settings.logoUrl} alt="Preview" className="logo-preview" /></div>}
                 </div>
               </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
