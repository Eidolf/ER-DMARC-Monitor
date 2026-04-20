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

interface DetailedRecord {
  id: number;
  source_ip: string;
  count: number;
  disposition: string;
  dkim_pass: boolean;
  spf_pass: boolean;
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
  
  const [newDomainName, setNewDomainName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

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
    fetch(`/api/domains/${domainName}/records`)
      .then(res => res.json())
      .then(json => {
         if (Array.isArray(json)) setDetailedRecords(json);
         else setDetailedRecords([]);
      })
      .catch(err => console.error(err));
  };

  const handleFileUpload = () => {
    if (!uploadFile) return;
    const formData = new FormData();
    formData.append('file', uploadFile);

    fetch('/api/reports/upload', {
      method: 'POST',
      body: formData
    }).then(res => res.json())
      .then(res => {
        if (res.status === 'success' || res.status === 'skipped') {
          alert('Upload processed: ' + (res.message || 'Success'));
          setUploadOpen(false);
          setUploadFile(null);
          loadData();
        } else {
          alert('Error: ' + JSON.stringify(res));
        }
      }).catch(err => alert("Error uploading file: " + err));
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
          <button className="nav-item" onClick={() => setUploadOpen(true)}>Upload Report</button>
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
              <h4>🛡️ Overview & KPIs</h4>
              <p>The dashboard provides a high-level view of your DMARC health. 
              <strong>Total Analyzed</strong> shows the sum of all email counts in uploaded reports. 
              <strong>Failures</strong> indicate emails that failed SPF or DKIM checks. 
              <strong>Unauthorized Senders</strong> identifies unique source IPs that failed both SPF and DKIM.</p>
            </div>
            <div className="help-card">
              <h4>🔍 Deep Analysis (Inspect)</h4>
              <p>Click <strong>Inspect</strong> to open a domain-specific forensic view. 
              This view calculates a Security Score, identifies Top Senders, and flags suspicious unauthorized traffic. 
              Note: If "No records found" appears, ensure the uploaded XML report actually contains policy data for that specific domain name.</p>
            </div>
            <div className="help-card">
              <h4>⚙️ Admin & Management</h4>
              <p>In the <strong>Admin Settings</strong>, you can add or remove monitored domains. 
              You can also customize the system title and color theme, and upload your own company logo.</p>
            </div>
            <div className="help-card">
              <h4>📤 Report Upload</h4>
              <p>You can manually inject DMARC Aggregate Reports in <strong>.xml</strong>, <strong>.gz</strong>, or <strong>.zip</strong> format. 
              The system automatically parses metadata and record details, avoiding duplicates via Report ID tracking.</p>
            </div>
          </div>
          <button className="action-btn" style={{marginTop: '2rem'}} onClick={() => setView('overview')}>Back to Dashboard</button>
        </main>
      )}

      {uploadOpen && (
        <div className="modal-overlay">
          <div className="glass-card modal-content" style={{ padding: '2rem' }}>
             <div className="modal-header">
               <h2>Upload DMARC Report File</h2>
               <button onClick={() => setUploadOpen(false)} className="close-btn">&times;</button>
             </div>
             <p style={{marginBottom: '1rem', color: 'var(--text-secondary)'}}>
               Upload a raw .xml or compressed .xml.gz / .zip Aggregate Report manually.
             </p>
             <input type="file" accept=".xml,.gz,.zip" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
             <button className="action-btn" style={{marginTop: '1.5rem', width: '100%'}} onClick={handleFileUpload}>Process File</button>
          </div>
        </div>
      )}

      {inspectDomain && (
        <div className="modal-overlay">
          <div className="glass-card modal-content wide-modal" style={{ padding: '2rem' }}>
             <div className="modal-header">
                <div>
                    <h2>Deep Analysis: {inspectDomain}</h2>
                    <p style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>Identity forensic for {inspectDomain}</p>
                </div>
                <button onClick={() => setInspectDomain(null)} className="close-btn">&times;</button>
             </div>
             
             <div className="analysis-grid">
                <div className="analysis-col">
                    <div className="report-summary-strip" style={{margin: '0', width: '100%', justifyContent: 'space-around'}}>
                        <div className="summary-item">
                            <label>Total Volume</label>
                            <span>{totalInRecords.toLocaleString()}</span>
                        </div>
                        <div className="summary-item">
                            <label>Security Score</label>
                            <span className={totalInRecords === 0 ? "" : (spfPassCount + dkimPassCount) / (2 * totalInRecords) > 0.9 ? "text-green" : "text-orange"}>
                                {totalInRecords > 0 ? Math.round(((spfPassCount + dkimPassCount) / (2 * totalInRecords)) * 100) : 0}%
                            </span>
                        </div>
                    </div>
                    
                    <div className="scroll-box" style={{marginTop: '1rem', minHeight: '300px'}}>
                        <h4 style={{marginBottom: '1rem', color: 'var(--text-primary)'}}>Recent Transactions</h4>
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
                                <tr key={r.id}>
                                    <td style={{fontSize: '0.85rem'}}><code>{r.source_ip}</code></td>
                                    <td>{r.count}</td>
                                    <td><span className={`status-tag ${r.spf_pass ? 'status-pass' : 'status-fail'}`}>{r.spf_pass ? 'PASS' : 'FAIL'}</span></td>
                                    <td><span className={`status-tag ${r.dkim_pass ? 'status-pass' : 'status-fail'}`}>{r.dkim_pass ? 'PASS' : 'FAIL'}</span></td>
                                </tr>
                                ))}
                                {detailedRecords.length === 0 && (
                                  <tr>
                                    <td colSpan={4} style={{textAlign:'center', padding: '3rem'}}>
                                      <p style={{marginBottom: '0.5rem'}}>No records found for this domain.</p>
                                      <p style={{fontSize: '0.8rem', color: 'var(--alert-red)'}}>
                                        Notice: If reports were uploaded, check if the "policy_published domain" in the XML matches "{inspectDomain}".
                                      </p>
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
                            {totalInRecords === 0 ? "Upload or correct reports to generate insights." : 
                             spfPassCount === totalInRecords && dkimPassCount === totalInRecords ? 
                             "Healthy configuration. All traffic is authenticated." : 
                             "Unauthenticated traffic detected. Check Top Senders for spoofing or SPF/DKIM misconfigs."}
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
                    placeholder="Register new domain (e.g. domain.com)" 
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
