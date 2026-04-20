import React, { useState, useEffect } from 'react';
import './App.css';

interface AppSettings {
  titlePart1: string;
  titlePart2: string;
  colorPart1: string;
  colorPart2: string;
  logoUrl: string;
}

function App() {
  const [data, setData] = useState<{ id: number, name: string, dmarc_policy: string, status?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Settings State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('er-dmarc-settings');
    if (saved) return JSON.parse(saved);
    return {
      titlePart1: 'ER-DMARC',
      titlePart2: '-Monitor',
      colorPart1: '#e6edf3', // Primary text
      colorPart2: '#3b82f6', // Accent blue
      logoUrl: '/favicon.png'
    };
  });

  useEffect(() => {
    localStorage.setItem('er-dmarc-settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    // Productive Fetch - No Demo Data
    // We expect the API at /api/domains to return our domains
    fetch('/api/domains')
      .then(res => {
        if (!res.ok) throw new Error('API Error');
        return res.json();
      })
      .then(json => {
        setData(json || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setData([]); // Empty state on failure or init
        setLoading(false);
      });
  }, []);

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
          <button className="nav-item">Reports</button>
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>Admin Settings</button>
        </nav>
        <div className="user-profile">AE</div>
      </header>

      <main className="dashboard-content">
        <div className="hero-section">
          <h2>Security Posture</h2>
          <p>Real-time analytics across your monitored infrastructure</p>
        </div>

        <section className="domains-section">
          <div className="glass-card full-width">
            <div className="card-header">
              <h3>Monitored Domains</h3>
              <button className="action-btn">Add Domain</button>
            </div>
            
            {loading ? (
               <div className="empty-state">Loading infrastructure...</div>
            ) : data.length === 0 ? (
               <div className="empty-state">
                  <h4>No domains monitored yet.</h4>
                  <p>Configure your SMTP relay to forward DMARC reports or manually register a domain in the application above.</p>
               </div>
            ) : (
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Domain Name</th>
                    <th>Active Policy</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((domain, i) => (
                    <tr key={i}>
                      <td className="font-semibold">{domain.name}</td>
                      <td><span className={`badge policy-${domain.dmarc_policy || 'none'}`}>p={domain.dmarc_policy || 'none'}</span></td>
                      <td><button className="view-btn">Inspect</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      {/* Admin Settings Modal */}
      {settingsOpen && (
        <div className="modal-overlay">
          <div className="glass-card modal-content">
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
