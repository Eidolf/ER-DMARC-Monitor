import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [data, setData] = useState<{ id: number, name: string, policy: string, status: string }[]>([]);

  useEffect(() => {
    // Stub data to simulate what the API will eventually return
    setData([
      { id: 1, name: 'eidolf.de', policy: 'reject', status: 'Optimal' },
      { id: 2, name: 'marketing.eidolf.de', policy: 'quarantine', status: 'Warning' },
      { id: 3, name: 'legacy.eidolf.de', policy: 'none', status: 'Critical' },
    ]);
  }, []);

  return (
    <div className="dashboard-container">
      <div className="ambient-background"></div>
      
      <header className="glass-header">
        <div className="logo-section">
          <div className="logo-orb"></div>
          <h1>DMARC<span>Nexus</span></h1>
        </div>
        <nav>
          <button className="nav-item active">Overview</button>
          <button className="nav-item">Reports</button>
          <button className="nav-item">Threat Intel</button>
          <button className="nav-item">Settings</button>
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
            <h3>Total Analyzed (24h)</h3>
            <span className="kpi-value text-gradient">1.2M</span>
          </div>
          <div className="glass-card kpi">
            <h3>SPF Failures</h3>
            <span className="kpi-value text-red">4,812</span>
          </div>
          <div className="glass-card kpi">
            <h3>DKIM Failures</h3>
            <span className="kpi-value text-orange">2,109</span>
          </div>
          <div className="glass-card kpi">
            <h3>Unauthorized Senders</h3>
            <span className="kpi-value alert">342 IPs</span>
          </div>
        </section>

        <section className="domains-section">
          <div className="glass-card full-width">
            <div className="card-header">
              <h3>Monitored Domains</h3>
              <button className="action-btn">Add Domain</button>
            </div>
            
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Domain Name</th>
                  <th>Active Policy</th>
                  <th>Health Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map(domain => (
                  <tr key={domain.id}>
                    <td className="font-semibold">{domain.name}</td>
                    <td>
                      <span className={`badge policy-${domain.policy}`}>
                        p={domain.policy}
                      </span>
                    </td>
                    <td>
                      <span className={`status-indicator ${domain.status.toLowerCase()}`}>
                        {domain.status}
                      </span>
                    </td>
                    <td>
                      <button className="view-btn">Inspect</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
