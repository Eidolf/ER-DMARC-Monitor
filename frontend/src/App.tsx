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
      .then(json => setData(json || []))
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

  const handleInspect = (domainName: string) => {
    setInspectDomain(domainName);
    fetch(`/api/domains/${domainName}/records`)
      .then(res => res.json())
      .then(json => setDetailedRecords(json))
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
          loadData(); // Refresh stats
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
          <button className="nav-item active">Overview</button>
          <button className="nav-item" onClick={() => setUploadOpen(true)}>Upload Report</button>
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>Admin Settings</button>
        </nav>
        <div className="user-profile">AE</div>
      </header>

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
              <div className="add-domain-group">
                <input 
                  type="text" 
                  placeholder="e.g. yourdomain.com" 
                  className="text-input" 
                  style={{ marginRight: '10px' }}
                  value={newDomainName} 
                  onChange={(e) => setNewDomainName(e.target.value)} 
                />
                <button className="action-btn" onClick={handleAddDomain}>Add Domain</button>
              </div>
            </div>
            
            {loading ? (
               <div className="empty-state">Loading infrastructure...</div>
            ) : data.length === 0 ? (
               <div className="empty-state">
                  <h4>No domains monitored yet.</h4>
                  <p>Register a domain above to start gathering metrics.</p>
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
                      <td><button className="view-btn" onClick={() => handleInspect(domain.name)}>Inspect</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      {uploadOpen && (
        <div className="modal-overlay">
          <div className="glass-card modal-content" style={{ padding: '2rem' }}>
             <div className="modal-header">
               <h2>Upload DMARC Report File</h2>
               <button onClick={() => setUploadOpen(false)} className="close-btn">&times;</button>
             </div>
             <p style={{marginBottom: '1rem', color: 'var(--text-secondary)'}}>
               Upload a raw .xml or compressed .xml.gz / .zip Aggregate Report manually for immediate evaluation.
             </p>
             <input type="file" className="file-input" accept=".xml,.gz,.zip" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
             <button className="action-btn" style={{marginTop: '1.5rem', width: '100%'}} onClick={handleFileUpload}>Process File</button>
          </div>
        </div>
      )}

      {inspectDomain && (
        <div className="modal-overlay">
          <div className="glass-card modal-content wide-modal" style={{ padding: '2rem' }}>
             <div className="modal-header">
               <h2>Details: {inspectDomain}</h2>
               <button onClick={() => setInspectDomain(null)} className="close-btn">&times;</button>
             </div>
             <div className="scroll-box">
               <table className="modern-table">
                  <thead>
                    <tr>
                      <th>Source IP</th>
                      <th>Count</th>
                      <th>Disposition</th>
                      <th>SPF</th>
                      <th>DKIM</th>
                      <th>Report Org</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedRecords.length === 0 ? (
                       <tr><td colSpan={7} style={{textAlign: 'center', padding: '2rem'}}>No records found for this domain.</td></tr>
                    ) : detailedRecords.map(r => (
                      <tr key={r.id}>
                        <td>{r.source_ip}</td>
                        <td>{r.count}</td>
                        <td><span className={`badge policy-${r.disposition}`}>{r.disposition}</span></td>
                        <td><span className={`status-tag ${r.spf_pass ? 'status-pass' : 'status-fail'}`}>{r.spf_pass ? 'PASS' : 'FAIL'}</span></td>
                        <td><span className={`status-tag ${r.dkim_pass ? 'status-pass' : 'status-fail'}`}>{r.dkim_pass ? 'PASS' : 'FAIL'}</span></td>
                        <td style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>{r.org_name}</td>
                        <td style={{fontSize: '0.8rem'}}>{new Date(r.date).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
               </table>
             </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-overlay">
          <div className="glass-card modal-content" style={{ padding: '2rem' }}>
             <div className="modal-header">
               <h2>Admin Settings</h2>
               <button onClick={() => setSettingsOpen(false)} className="close-btn">&times;</button>
             </div>
             <div className="settings-form">
               <div className="form-group">
                 <label>Project Title (Part 1)</label>
                 <div className="input-group">
                    <input type="text" className="text-input" value={settings.titlePart1} onChange={e => setSettings({...settings, titlePart1: e.target.value})} />
                    <input type="color" className="color-picker" value={settings.colorPart1} onChange={e => setSettings({...settings, colorPart1: e.target.value})} />
                 </div>
               </div>
               <div className="form-group">
                 <label>Project Title (Part 2)</label>
                 <div className="input-group">
                    <input type="text" className="text-input" value={settings.titlePart2} onChange={e => setSettings({...settings, titlePart2: e.target.value})} />
                    <input type="color" className="color-picker" value={settings.colorPart2} onChange={e => setSettings({...settings, colorPart2: e.target.value})} />
                 </div>
               </div>
               <div className="form-group">
                 <label>Custom Application Logo</label>
                 <input type="file" accept="image/*" onChange={handleLogoUpload} className="file-input" />
                 {settings.logoUrl && <div className="logo-preview-box"><img src={settings.logoUrl} alt="Preview" className="logo-preview" /></div>}
               </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
