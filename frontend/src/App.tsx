import React, { useState, useEffect, useMemo } from 'react';
import './App.css';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './Login';
import SettingsView from './Settings';

const formatDate = (dateInput: string | number | Date) => {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  
  // Use UTC to avoid timezone shifts for date-only strings from the backend
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
};

interface UploadReportDetails {
  org_name?: string;
  report_id?: string;
  domain_name?: string;
  date_begin?: string;
  date_end?: string;
  source_ips?: { ip: string; count: number }[];
  existing_in_db?: boolean;
}

interface UploadResult {
  filename: string;
  status: string;
  detail?: string;
  report_details?: UploadReportDetails;
}

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

interface DetailedRecord {
  id: number;
  source_ip: string;
  count: number;
  disposition: string;
  dkim_pass: boolean;
  spf_pass: boolean;
  dkim_auth_details: any[];
  spf_auth_details: any[];
  report_id: string;
  org_name: string;
  date: string;
}

type SortKey = 'source_ip' | 'count' | 'org_name' | 'date';

const SortIcon = ({ active, direction }: { active: boolean; direction: 'asc' | 'desc' | null }) => {
  if (!active) return <span className="sort-icon inactive" style={{marginLeft: '8px', opacity: 0.3}}>↕</span>;
  return <span className="sort-icon active" style={{marginLeft: '8px', color: '#3b82f6'}}>{direction === 'asc' ? '↑' : '↓'}</span>;
};

const StatusIcon = ({ pass, size = 16 }: { pass: boolean; size?: number }) => {
  if (pass) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#10b981' }}>
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444' }}>
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  );
};

interface Domain {
  id: number;
  name: string;
  is_active: boolean;
  dmarc_policy: string | null;
  spf_status: string;
  dkim_status: string;
  dmarc_status: string;
  spf_fails: number;
  dkim_fails: number;
  spf_fail_count: number;
  dkim_fail_count: number;
  dns_summary?: {
    spf: string;
    dkim: string;
    dmarc: string;
  };
}

function Dashboard() {
  const { token, role, logout } = useAuth();
  const [data, setData] = useState<Domain[]>([]);
  const [stats, setStats] = useState<Stats>({ total_analyzed: 0, spf_failures: 0, dkim_failures: 0, unauthorized_senders: 0 });
  const [view, setView] = useState<'overview' | 'help' | 'settings'>('overview');
  
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);
  const [selectedConflict, setSelectedConflict] = useState<UploadResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [inspectDomain, setInspectDomain] = useState<string | null>(null);
  const [inspectTab, setInspectTab] = useState<'log' | 'reporters'>('log');
  const [detailedRecords, setDetailedRecords] = useState<DetailedRecord[]>([]);
  const [expandedRecordId, setExpandedRecordId] = useState<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' | null }>({ key: 'date', direction: 'desc' });
  
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);

  const [settings, setSettings] = useState<AppSettings>({
    title_part1: 'ER-DMARC',
    title_part2: '-Monitor',
    color_part1: '#e6edf3',
    color_part2: '#3b82f6',
    logo_url: '/favicon.png'
  });

  const [dateFilter, setDateFilter] = useState<{ start: string, end: string }>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    };
  });

  const [dnsModal, setDnsModal] = useState<{ domainId: number, domainName: string, type: 'spf' | 'dkim' | 'dmarc' } | null>(null);
  const [dnsDetails, setDnsDetails] = useState<any>(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'spf' | 'dkim' | 'unauthorized'>('all');
  const [ipModal, setIpModal] = useState<string | null>(null);
  const [ipDetails, setIpDetails] = useState<any>(null);
  const [ipLoading, setIpLoading] = useState(false);
  const [dkimHelpModal, setDkimHelpModal] = useState<{ ip: string; domain: string } | null>(null);

  const downloadScript = async (type: string) => {
    try {
      const res = await authFetch(`/api/admin/smtp/scripts/${type}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `test_dmarc.${type === 'powershell' ? 'ps1' : type === 'python' ? 'py' : 'sh'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      alert('Error downloading script');
    }
  };

  const handleOpenIpModal = (ip: string) => {
    setIpModal(ip);
    setIpLoading(true);
    authFetch(`/api/ips/${ip}`)
      .then(res => res.json())
      .then(json => {
        setIpDetails(json);
        setIpLoading(false);
      })
      .catch(err => {
        console.error(err);
        setIpLoading(false);
      });
  };

  const handleOpenDnsModal = (domainId: number, domainName: string, type: 'spf' | 'dkim' | 'dmarc') => {
    setDnsModal({ domainId, domainName, type });
    setDnsLoading(true);
    authFetch(`/api/domains/${domainId}/dns`)
      .then(res => res.json())
      .then(json => {
        setDnsDetails(json);
        setDnsLoading(false);
      })
      .catch(err => {
        console.error(err);
        setDnsLoading(false);
      });
  };

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
    authFetch(`/api/domains?start_date=${dateFilter.start}&end_date=${dateFilter.end}`).then(res => res.json()).then(json => setData(Array.isArray(json) ? json : [])).catch(err => console.error(err));
    authFetch(`/api/reports/stats?start_date=${dateFilter.start}&end_date=${dateFilter.end}`)
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (json) setStats(json); })
      .catch(err => console.error(err));
    fetch('/api/settings/branding').then(res => res.json()).then(json => setSettings(json)).catch(err => console.error(err));
    authFetch('/api/auth/me').then(res => res.json()).then(json => setCurrentUser(json)).catch(err => console.error(err));
  };

  const handleResetFilter = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    setDateFilter({
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    });
    setSearchQuery('');
  };

  useEffect(() => { loadData(); }, [dateFilter]);

  const handleInspect = (
    domainName: string | null, 
    initialFilter: 'all' | 'spf' | 'dkim' | 'unauthorized' = 'all',
    initialSearchQuery: string = '',
    customDateFilter?: { start: string, end: string }
  ) => {
    // We use a special string "system_global" to represent the global view while still being "truthy"
    const activeTarget = domainName || "__global__";
    setInspectDomain(activeTarget);
    setInspectTab('log');
    setDetailedRecords([]);
    setExpandedRecordId(null);
    setSearchQuery(initialSearchQuery);
    setFilterType(initialFilter);
    setSortConfig({ key: 'date', direction: 'desc' });
    
    if (customDateFilter) {
      setDateFilter(customDateFilter);
    }
    const currentDates = customDateFilter || dateFilter;

    const url = domainName 
      ? `/api/domains/${domainName}/records?start_date=${currentDates.start}&end_date=${currentDates.end}` 
      : `/api/reports/records?start_date=${currentDates.start}&end_date=${currentDates.end}`;
    authFetch(url)
      .then(res => res.json())
      .then(json => { if (Array.isArray(json)) setDetailedRecords(json); })
      .catch(err => console.error(err));
  };

  useEffect(() => {
    if (!inspectDomain) return;
    const domainName = inspectDomain === "__global__" ? null : inspectDomain;
    const url = domainName 
      ? `/api/domains/${domainName}/records?start_date=${dateFilter.start}&end_date=${dateFilter.end}` 
      : `/api/reports/records?start_date=${dateFilter.start}&end_date=${dateFilter.end}`;
    authFetch(url)
      .then(res => res.json())
      .then(json => { if (Array.isArray(json)) setDetailedRecords(json); })
      .catch(err => console.error(err));
  }, [inspectDomain, dateFilter]);

  const handleFileUpload = async () => {
    if (!uploadFiles) return;
    setIsUploading(true);
    setUploadResults(null);
    const formData = new FormData();
    for(let i=0; i<uploadFiles.length; i++) formData.append('files', uploadFiles[i]);
    try {
      const res = await authFetch('/api/reports/upload', { method: 'POST', body: formData });
      const data = await res.json();
      setUploadResults(data.results);
      loadData();
    } catch (err) {
      console.error(err);
      alert("Upload failed. See console for details.");
    } finally {
      setIsUploading(false);
    }
  };

  const closeUpload = () => {
    setUploadOpen(false);
    setUploadResults(null);
    setUploadFiles(null);
    setSelectedConflict(null);
  };

  const topSenders = useMemo(() => {
    const counts = new Map<string, {count: number, pass: boolean}>();
    detailedRecords.forEach(r => {
      const curr = counts.get(r.source_ip) || {count: 0, pass: r.spf_pass && r.dkim_pass};
      curr.count += r.count;
      counts.set(r.source_ip, curr);
    });
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  }, [detailedRecords]);

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
    
    if (filterType === 'spf') filtered = filtered.filter(r => !r.spf_pass);
    if (filterType === 'dkim') filtered = filtered.filter(r => !r.dkim_pass);
    if (filterType === 'unauthorized') filtered = filtered.filter(r => !r.spf_pass && !r.dkim_pass);

    if (sortConfig.direction) {
      filtered.sort((a, b) => {
        const valA = (a as any)[sortConfig.key];
        const valB = (b as any)[sortConfig.key];
        if (typeof valA === 'string' && typeof valB === 'string') return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        if (typeof valA === 'number' && typeof valB === 'number') return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
        return 0;
      });
    }
    return filtered;
  }, [detailedRecords, searchQuery, sortConfig, filterType]);

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
          <img 
            src={settings.logo_url || '/favicon.png'} 
            alt="Logo" 
            className="custom-logo" 
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const sibling = (e.target as HTMLImageElement).nextElementSibling;
              if (sibling) (sibling as HTMLElement).style.display = 'block';
            }}
          />
          <div className="logo-orb" style={{display: 'none'}}></div>
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
            <div className="user-profile" onClick={() => setProfileOpen(!profileOpen)} title={`Role: ${role}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </div>
            {profileOpen && (
              <div className="profile-dropdown glass-card">
                <div className="dropdown-info">
                  {currentUser && <p className="user-name" style={{fontWeight: 'bold', marginBottom: '5px'}}>{currentUser.username}</p>}
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
          
          <div className="filter-bar">
            <div className="date-input-group">
              <label>From</label>
              <div className="date-input-wrapper">
                <input 
                  type="date" 
                  className="date-picker" 
                  value={dateFilter.start} 
                  onChange={(e) => setDateFilter({ ...dateFilter, start: e.target.value })} 
                />
              </div>
            </div>
            <div className="date-input-group">
              <label>To</label>
              <div className="date-input-wrapper">
                <input 
                  type="date" 
                  className="date-picker" 
                  value={dateFilter.end} 
                  onChange={(e) => setDateFilter({ ...dateFilter, end: e.target.value })} 
                />
              </div>
            </div>
            <button className="action-btn" onClick={handleResetFilter} style={{background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)'}}>Reset Filter</button>
          </div>

          <section className="kpi-grid">
            <div className="glass-card kpi"><h3>Total Analyzed</h3><span className="kpi-value text-gradient">{(stats?.total_analyzed || 0).toLocaleString()}</span></div>
            <div className="glass-card kpi clickable" onClick={() => handleInspect(null, 'spf')} style={{cursor: 'pointer'}}>
              <h3>SPF Failures</h3>
              <span className={(stats?.spf_failures || 0) > 0 ? "kpi-value text-red" : "kpi-value text-gradient"}>{(stats?.spf_failures || 0).toLocaleString()}</span>
            </div>
            <div className="glass-card kpi clickable" onClick={() => handleInspect(null, 'dkim')} style={{cursor: 'pointer'}}>
              <h3>DKIM Failures</h3>
              <span className={(stats?.dkim_failures || 0) > 0 ? "kpi-value text-orange" : "kpi-value text-gradient"}>{(stats?.dkim_failures || 0).toLocaleString()}</span>
            </div>
            <div className="glass-card kpi clickable" onClick={() => handleInspect(null, 'unauthorized')} style={{cursor: 'pointer'}}>
              <h3>Unauthorized Senders</h3>
              <span className={(stats?.unauthorized_senders || 0) > 0 ? "kpi-value alert" : "kpi-value text-gradient"}>{stats?.unauthorized_senders || 0}</span>
            </div>
          </section>
          <section className="domains-section">
            <div className="glass-card full-width">
              <div className="card-header"><h3>Monitored Domains</h3></div>
              <table className="modern-table">
                <thead><tr><th>Domain Name</th><th>Failures (Filtered)</th><th>SPF Record</th><th>DMARC Policy</th><th>DKIM Status</th><th>Actions</th></tr></thead>
                <tbody>{data.map((domain) => (
                    <tr key={domain.id}>
                      <td>{domain.name}</td>
                      <td>
                        <div style={{display: 'flex', gap: '0.4rem'}}>
                          <span className={`badge ${domain.spf_fail_count > 0 ? 'status-fail' : 'status-pass'}`} style={{cursor: 'pointer', fontSize: '0.7rem', padding: '2px 6px'}} onClick={() => handleInspect(domain.name, 'spf')}>SPF: {domain.spf_fail_count}</span>
                          <span className={`badge ${domain.dkim_fail_count > 0 ? 'status-fail' : 'status-pass'}`} style={{cursor: 'pointer', fontSize: '0.7rem', padding: '2px 6px'}} onClick={() => handleInspect(domain.name, 'dkim')}>DKIM: {domain.dkim_fail_count}</span>
                        </div>
                      </td>
                      <td>
                        <span 
                          className={`badge status-${domain.dns_summary?.spf?.toLowerCase().replace(' ', '-') || 'unknown'}`}
                          onClick={() => handleOpenDnsModal(domain.id, domain.name, 'spf')}
                          style={{cursor: 'pointer'}}
                        >
                          {domain.dns_summary?.spf || 'Unknown'}
                        </span>
                      </td>
                      <td>
                        <span 
                          className={`badge policy-${domain.dmarc_policy || 'none'}`}
                          onClick={() => handleOpenDnsModal(domain.id, domain.name, 'dmarc')}
                          style={{cursor: 'pointer'}}
                        >
                          p={domain.dmarc_policy || 'none'}
                        </span>
                      </td>
                      <td>
                        <span 
                          className={`badge status-${domain.dns_summary?.dkim?.toLowerCase().replace(' ', '-') || 'unknown'}`}
                          onClick={() => handleOpenDnsModal(domain.id, domain.name, 'dkim')}
                          style={{cursor: 'pointer'}}
                        >
                          {domain.dns_summary?.dkim || 'Unknown'}
                        </span>
                      </td>
                      <td><button className="action-btn" onClick={() => handleInspect(domain.name)}>Inspect</button></td>
                    </tr>
                  ))}</tbody>
              </table>
              
              {dnsModal && (
                <div className="modal-overlay" onClick={() => setDnsModal(null)}>
                  <div className="modal-content glass-card" style={{maxWidth: '600px'}} onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                      <h3>DNS Inspection: {dnsModal.domainName}</h3>
                      <button className="close-btn" onClick={() => setDnsModal(null)}>×</button>
                    </div>
                    <div className="modal-body">
                      <div className="modal-section-title">
                        {dnsModal.type.toUpperCase()} Records
                      </div>
                      {dnsLoading ? (
                        <div style={{padding: '2rem', textAlign: 'center'}}>
                          <div className="loading-spinner"></div>
                          <p style={{marginTop: '1rem', color: 'var(--text-secondary)'}}>Querying DNS records...</p>
                        </div>
                      ) : dnsDetails ? (
                        <div className="dns-details">
                          {dnsModal.type === 'spf' && (
                            <>
                              <p><strong>SPF Status:</strong> {dnsDetails.spf.status}</p>
                              {dnsDetails.spf.records.length > 0 ? (
                                <div className="dns-record-box">
                                  {dnsDetails.spf.records.map((r: string, i: number) => (
                                    <code key={i} className="dns-record">{r}</code>
                                  ))}
                                  {dnsDetails.spf.records.length > 1 && <p className="warning-text">⚠️ Multiple SPF records found! This is invalid.</p>}
                                </div>
                              ) : <p>No SPF record found.</p>}
                            </>
                          )}
                          {dnsModal.type === 'dmarc' && (
                            <>
                              <p><strong>DMARC Status:</strong> {dnsDetails.dmarc.status}</p>
                              {dnsDetails.dmarc.records.length > 0 ? (
                                <div className="dns-record-box">
                                  {dnsDetails.dmarc.records.map((r: string, i: number) => (
                                    <code key={i} className="dns-record">{r}</code>
                                  ))}
                                </div>
                              ) : <p>No DMARC record found at _dmarc.{dnsModal.domainName}</p>}

                              {dnsDetails.dmarc.external_destinations && dnsDetails.dmarc.external_destinations.length > 0 && (
                                <div style={{marginTop: '1.5rem'}}>
                                  <h4 style={{fontSize: '1rem', fontWeight: 600}}>External Report Destinations Authorization</h4>
                                  <div style={{display: 'flex', flexDirection: 'column', gap: '0.8rem', marginTop: '0.5rem'}}>
                                    {dnsDetails.dmarc.external_destinations.map((d: any, idx: number) => (
                                      <div key={idx} className={`guidance-box ${d.is_authorized ? 'legit' : 'suspicious'}`} style={{padding: '1rem', borderLeft: d.is_authorized ? '4px solid #10b981' : '4px solid #ef4444'}}>
                                        <p style={{fontWeight: 600, color: d.is_authorized ? '#10b981' : '#ef4444'}}>
                                          {d.is_authorized ? "✓ Authorized" : "✗ Verification Required"}
                                        </p>
                                        <p style={{fontSize: '0.9rem', marginTop: '0.2rem', color: 'var(--text-primary)'}}>{d.message}</p>
                                        {!d.is_authorized && (
                                          <div style={{marginTop: '0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px'}}>
                                            <p><strong>Required Action:</strong> Publish a TXT record at <code>{d.required_record}</code> with the value <code>v=DMARC1</code> to authorize report collection.</p>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                          {dnsModal.type === 'dkim' && (
                            <>
                              <p><strong>DKIM Status (Heuristic):</strong> {dnsDetails.dkim.status}</p>
                              <p className="hint-text">Note: This is based on a check of common selectors ({dnsDetails.dkim.checked_selectors.join(', ')}).</p>
                              {dnsDetails.dkim.found_selectors.length > 0 ? (
                                <div className="dkim-results" style={{marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                                  {dnsDetails.dkim.found_selectors.map((s: any, i: number) => (
                                    <div key={i} className="dkim-entry" style={{border: s.is_revoked ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--border-glass)', borderRadius: '8px', padding: '1rem', background: 'rgba(255,255,255,0.01)'}}>
                                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                        <p><strong>Selector:</strong> <code>{s.selector}</code></p>
                                        {s.is_revoked && <span className="status-tag status-fail" style={{fontSize: '0.75rem'}}>REVOKED</span>}
                                      </div>
                                      <code className="dns-record" style={{display: 'block', marginTop: '0.5rem', overflowX: 'auto', background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '4px'}}>{s.record}</code>
                                      {s.is_revoked && (
                                        <div className="guidance-box suspicious" style={{marginTop: '0.8rem', padding: '0.8rem', borderLeft: '4px solid #ef4444', background: 'rgba(239, 68, 68, 0.05)'}}>
                                          <p style={{fontWeight: 600, color: '#ef4444', fontSize: '0.85rem'}}>Warning</p>
                                          <p style={{fontSize: '0.85rem', color: 'var(--text-primary)'}}>DKIM record at "{s.selector}" appears to be revoked (empty public key). Messages signed with this selector will fail DKIM verification.</p>
                                          <p style={{fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.5rem'}}>Recommendation</p>
                                          <p style={{fontSize: '0.85rem', color: 'var(--text-primary)'}}>Re-publish the DKIM public key if this selector is still in use, or remove the DNS record if it has been retired.</p>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="no-dkim">
                                  <p>No DKIM records found for common selectors.</p>
                                  <p className="hint-text">Check your mail provider documentation for the specific selector used.</p>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : <p>Error loading DNS details.</p>}
                    </div>
                    <div className="modal-footer" style={{marginTop: '1.5rem', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem', textAlign: 'right'}}>
                      <button className="action-btn" onClick={() => setDnsModal(null)}>Close</button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </section>
        </main>
      )}

      {view === 'help' && (
        <main className="dashboard-content docs-page">
          <div className="hero-section">
            <h2>System Documentation & Guides</h2>
            <p>Comprehensive instructions for administrators and analysts</p>
          </div>
          
          <div className="docs-grid">
            <section className="docs-section glass-card">
              <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '10px'}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> 1. Authentication & Security</h3>
              <div className="docs-item">
                <h4>Microsoft Entra ID (SSO)</h4>
                <p>To enable Single Sign-On, navigate to <strong>Settings &gt; Authentication</strong>. You will need:</p>
                <ul>
                  <li><strong>Tenant ID:</strong> Your Azure Directory ID.</li>
                  <li><strong>Client ID:</strong> The Application ID from your Azure App Registration.</li>
                  <li><strong>Client Secret:</strong> A valid client secret (stored securely).</li>
                </ul>
                <p className="note">Note: Ensure the Redirect URI in Azure is set to <code>https://your-domain/api/auth/sso/callback</code></p>
              </div>
              <div className="docs-item">
                <h4>Multi-Factor Authentication (MFA)</h4>
                <p>Users can activate MFA in their <strong>Profile</strong>. Admins can enforce MFA for specific roles in the Global Settings.</p>
                <ul>
                  <li>Use any TOTP app (Microsoft Authenticator, Google Authenticator).</li>
                  <li><strong>Recovery Codes:</strong> Always save the 8-digit codes generated during setup. They are the only way to regain access if the device is lost.</li>
                </ul>
              </div>
            </section>

            <section className="docs-section glass-card">
              <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '10px'}}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> 2. Admin Configuration</h3>
              <div className="docs-item">
                <h4>Branding & Identity</h4>
                <p>Customize the look of your ER-DMARC-Monitor in <strong>Settings &gt; Branding</strong>:</p>
                <ul>
                  <li><strong>Title Segments:</strong> Split the main title into two parts with independent colors for a premium look.</li>
                  <li><strong>Custom Logo:</strong> Provide a URL to your corporate logo to replace the default orb.</li>
                </ul>
              </div>
              <div className="docs-item">
                <h4>Domain Management</h4>
                <p>Add the domains you wish to monitor in <strong>Settings &gt; Domains</strong>. This will enable the system to filter and categorize incoming DMARC reports correctly.</p>
              </div>
            </section>

            <section className="docs-section glass-card">
              <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '10px'}}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> 3. DNS Monitoring</h3>
              <div className="docs-item">
                <h4>Authentication Readiness</h4>
                <p>The <strong>Monitored Domains</strong> table provides a real-time (cached) view of your authentication posture:</p>
                <ul>
                  <li><strong>SPF:</strong> Indicates if a valid <code>v=spf1</code> record exists. Multiple records will trigger a warning.</li>
                  <li><strong>DKIM (Heuristic):</strong> Since DKIM selectors are not public, the system checks for common selectors (e.g., <em>default, google, dkim</em>). A "Not Set" status means no common selectors were found, not necessarily that DKIM is missing.</li>
                  <li><strong>DMARC:</strong> Displays the published policy (p=none, quarantine, or reject).</li>
                </ul>
                <p className="note">Click on any status badge to inspect the full DNS records in a read-only modal.</p>
              </div>
            </section>
          </div>

          <div className="docs-grid" style={{marginTop: '2rem'}}>

            <section className="docs-section glass-card">
              <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '10px'}}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg> 4. Data & Analysis</h3>
              <div className="docs-item">
                <h4>Manual Report Upload</h4>
                <p>Use the <strong>Upload Reports</strong> button in the main navigation. You can drag and drop multiple XML, .gz, or .zip files. The system automatically detects and skips duplicate reports based on the unique Report ID.</p>
              </div>
              <div className="docs-item">
                <h4>Forensic Inspection</h4>
                <p>Click <strong>Inspect</strong> on any domain to open the deep analysis view:</p>
                <ul>
                  <li><strong>Traffic Log:</strong> View every sending IP, its volume, and authentication status. Expand a row to see detailed SPF/DKIM results.</li>
                  <li><strong>Reporters:</strong> See which organizations (Google, Microsoft, etc.) are sending reports about your domain.</li>
                </ul>
              </div>
            </section>

            <section className="docs-section glass-card">
              <h3><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '10px'}}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> 5. System Validation</h3>
              <div className="docs-item">
                <h4>SMTP Ingestion Test</h4>
                <p>Verify that your DMARC endpoints are reachable in <strong>Settings &gt; SMTP Test</strong>:</p>
                <ul>
                  <li><strong>Portal Test:</strong> Trigger a real DMARC report processing flow directly from the UI.</li>
                  <li><strong>Allowed Recipients:</strong> Enter the email address that is configured in your DNS (e.g., <code>dmarc-reports@domain.com</code>).</li>
                  <li><strong>Isolation:</strong> All test data is automatically filtered out from your production metrics and dashboards.</li>
                </ul>
              </div>
              <div className="docs-item">
                <h4>External Validation</h4>
                <p>Use the provided scripts to test from external environments. These scripts are dynamically generated and pre-configured with your managed domains:</p>
                <div style={{display: 'flex', gap: '0.8rem', marginTop: '1rem', flexWrap: 'wrap'}}>
                  <button className="action-btn small-btn" onClick={() => downloadScript('powershell')}>
                    Download PowerShell (.ps1)
                  </button>
                  <button className="action-btn small-btn" onClick={() => downloadScript('python')}>
                    Download Python (.py)
                  </button>
                  <button className="action-btn small-btn" onClick={() => downloadScript('bash')}>
                    Download Bash (.sh)
                  </button>
                </div>
              </div>
            </section>
          </div>
          <div style={{display: 'flex', justifyContent: 'center', marginTop: '3rem'}}>
            <button className="action-btn primary-btn" onClick={() => setView('overview')}>Return to Dashboard</button>
          </div>
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
          <div className="glass-card modal-content" style={{ padding: '2rem', maxWidth: '600px', width: '90%' }}>
             <div className="modal-header">
                <h2>Bulk Report Processing</h2>
                <button onClick={closeUpload} className="close-btn">&times;</button>
             </div>
             
             {!uploadResults ? (
               <div className="upload-form">
                 <p className="subtitle">Select XML, GZ, or ZIP DMARC reports for ingestion</p>
                 <div className="file-drop-zone">
                    <input type="file" multiple onChange={(e) => setUploadFiles(e.target.files)} className="file-input" />
                    <div className="drop-zone-content">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      <p>{uploadFiles ? `${uploadFiles.length} files selected` : "Click or drag files to upload"}</p>
                    </div>
                 </div>
                 <button 
                   className="action-btn primary-btn" 
                   style={{marginTop: '1.5rem', width: '100%'}} 
                   onClick={handleFileUpload}
                   disabled={!uploadFiles || isUploading}
                 >
                   {isUploading ? "Ingesting Data..." : "Start Ingestion"}
                 </button>
               </div>
             ) : (
               <div className="upload-results">
                 <div className="results-summary-strip">
                    <div className="summary-item success">
                      <label>Success</label>
                      <span>{uploadResults.filter(r => r.status === 'success').length}</span>
                    </div>
                    <div 
                      className="summary-item skipped" 
                      style={{ cursor: 'pointer' }}
                      title="Click to view skipped conflict details"
                      onClick={() => {
                        const firstSkipped = uploadResults.find(r => r.status === 'skipped');
                        if (firstSkipped) setSelectedConflict(firstSkipped);
                      }}
                    >
                      <label>Skipped (Conflicts)</label>
                      <span>{uploadResults.filter(r => r.status === 'skipped').length}</span>
                    </div>
                    <div className="summary-item error">
                      <label>Errors</label>
                      <span>{uploadResults.filter(r => r.status === 'error').length}</span>
                    </div>
                 </div>
                 <div className="scroll-box" style={{maxHeight: '300px', marginTop: '1rem'}}>
                    <table className="modern-table mini">
                      <thead><tr><th>Filename</th><th>Status</th><th>Details</th></tr></thead>
                      <tbody>
                        {uploadResults.map((res, i) => (
                          <tr 
                            key={i} 
                            style={{ cursor: res.report_details ? 'pointer' : 'default' }}
                            onClick={() => { if (res.report_details) setSelectedConflict(res); }}
                          >
                            <td style={{fontSize: '0.8rem'}}>{res.filename}</td>
                            <td>
                              <span className={`status-tag status-${res.status}`}>
                                {res.status.toUpperCase()}
                              </span>
                            </td>
                            <td style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>
                              {res.status === 'skipped' ? (
                                <span style={{ color: '#3b82f6', textDecoration: 'underline' }}>View Conflict Info</span>
                              ) : res.detail || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                 </div>
                 <button className="action-btn" style={{marginTop: '1.5rem', width: '100%'}} onClick={closeUpload}>Close Summary</button>
               </div>
             )}
          </div>
        </div>
      )}

      {selectedConflict && (
        <div className="modal-overlay secondary-modal" onClick={() => setSelectedConflict(null)}>
          <div className="modal-content glass-card" style={{maxWidth: '650px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Upload Conflict Details</h3>
              <button className="close-btn" onClick={() => setSelectedConflict(null)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div className="insight-card" style={{ margin: 0, borderLeft: '4px solid #f59e0b' }}>
                <p><strong>Conflict Status:</strong> Skipped (Already in Database)</p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                  File <code>{selectedConflict.filename}</code> contains a DMARC report ID that is already registered in your database.
                </p>
              </div>

              {selectedConflict.report_details ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="enrichment-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div className="enrich-item">
                      <label>Reporter / Organization</label>
                      <span>{selectedConflict.report_details.org_name || 'N/A'}</span>
                    </div>
                    <div className="enrich-item">
                      <label>Report ID</label>
                      <span style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>{selectedConflict.report_details.report_id || 'N/A'}</span>
                    </div>
                    <div className="enrich-item">
                      <label>Target Domain</label>
                      <span>{selectedConflict.report_details.domain_name || 'N/A'}</span>
                    </div>
                    <div className="enrich-item">
                      <label>Report Period</label>
                      <span>
                        {selectedConflict.report_details.date_begin ? formatDate(selectedConflict.report_details.date_begin) : 'N/A'} - {selectedConflict.report_details.date_end ? formatDate(selectedConflict.report_details.date_end) : 'N/A'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 style={{ marginBottom: '0.5rem' }}>Reported Source IPs</h4>
                    {selectedConflict.report_details.source_ips && selectedConflict.report_details.source_ips.length > 0 ? (
                      <div className="scroll-box" style={{ maxHeight: '180px' }}>
                        <table className="modern-table mini">
                          <thead>
                            <tr>
                              <th>Source IP</th>
                              <th>Message Count</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedConflict.report_details.source_ips.map((ipInfo, idx) => (
                              <tr 
                                key={idx} 
                                style={{ cursor: 'pointer' }}
                                title="Click to inspect this specific IP"
                                onClick={() => {
                                  const domain = selectedConflict.report_details?.domain_name;
                                  const dateBegin = selectedConflict.report_details?.date_begin?.split('T')[0];
                                  const dateEnd = selectedConflict.report_details?.date_end?.split('T')[0];
                                  const dateRange = (dateBegin && dateEnd) ? { start: dateBegin, end: dateEnd } : undefined;
                                  
                                  setSelectedConflict(null);
                                  setUploadOpen(false);
                                  if (domain) handleInspect(domain, 'all', ipInfo.ip, dateRange);
                                }}
                              >
                                <td><code>{ipInfo.ip}</code></td>
                                <td>{ipInfo.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="hint-text">No individual IP records found in file.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p>No additional details available for this report.</p>
              )}
            </div>
            <div className="modal-footer" style={{marginTop: '1.5rem', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              {selectedConflict.report_details?.domain_name && (
                <button 
                  className="action-btn primary-btn"
                  onClick={() => {
                    const domain = selectedConflict.report_details?.domain_name;
                    const org = selectedConflict.report_details?.org_name || '';
                    const dateBegin = selectedConflict.report_details?.date_begin?.split('T')[0];
                    const dateEnd = selectedConflict.report_details?.date_end?.split('T')[0];
                    const dateRange = (dateBegin && dateEnd) ? { start: dateBegin, end: dateEnd } : undefined;
                    
                    setSelectedConflict(null);
                    setUploadOpen(false);
                    if (domain) handleInspect(domain, 'all', org, dateRange);
                  }}
                >
                  Inspect Filtered Conflict Records
                </button>
              )}
              <button className="action-btn" onClick={() => setSelectedConflict(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {inspectDomain && (
        <div className="modal-overlay">
          <div className="glass-card modal-content wide-modal" style={{ padding: '2rem' }}>
             <div className="modal-header">
                <div><h2>{inspectDomain === '__global__' ? 'Global Forensic Analysis' : `Deep Analysis: ${inspectDomain}`}</h2><p>Forensic overview</p></div>
                <div className="header-actions" style={{ display: 'flex', alignItems: 'center' }}>
                     <div style={{ position: 'relative', display: 'inline-block' }}>
                       <input type="text" placeholder="Search..." className="text-input" style={{ width: '200px', marginRight: '1rem', paddingRight: searchQuery ? '30px' : '10px' }} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                       {searchQuery && (
                         <button 
                           onClick={() => setSearchQuery('')} 
                           style={{ position: 'absolute', right: '25px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}
                           title="Clear search"
                         >
                           &times;
                         </button>
                       )}
                     </div>
                     <button onClick={() => setInspectDomain(null)} className="close-btn">&times;</button>
                </div>
             </div>
             <div className="modal-tabs">
                <button className={`tab-btn ${inspectTab === 'log' ? 'active' : ''}`} onClick={() => setInspectTab('log')}>Traffic Log</button>
                <button className={`tab-btn ${inspectTab === 'reporters' ? 'active' : ''}`} onClick={() => setInspectTab('reporters')}>Reporters</button>
             </div>
             <div className="analysis-grid">
                <div className="analysis-col">
                    <div className="report-summary-strip" style={{margin: '0', width: '100%', justifyContent: 'space-around', alignItems: 'flex-start'}}>
                        <div className={`summary-item ${filterType === 'all' ? 'active' : ''}`} onClick={() => setFilterType('all')} style={{cursor: 'pointer'}}>
                          <label>Volume</label><span>{totalInRecords.toLocaleString()}</span>
                        </div>
                        <div className={`summary-item ${filterType === 'spf' ? 'active' : ''}`} onClick={() => setFilterType('spf')} style={{cursor: 'pointer'}}>
                          <label>SPF Fail</label><span className={spfPassCount < totalInRecords ? 'text-red' : ''}>{totalInRecords - spfPassCount}</span>
                        </div>
                        <div className={`summary-item ${filterType === 'dkim' ? 'active' : ''}`} onClick={() => setFilterType('dkim')} style={{cursor: 'pointer'}}>
                          <label>DKIM Fail</label><span className={dkimPassCount < totalInRecords ? 'text-orange' : ''}>{totalInRecords - dkimPassCount}</span>
                        </div>
                        <div className={`summary-item ${filterType === 'unauthorized' ? 'active' : ''}`} onClick={() => setFilterType('unauthorized')} style={{cursor: 'pointer'}}>
                          <label>Unauthorized</label><span className="text-red">{detailedRecords.filter(r => !r.spf_pass && !r.dkim_pass).length}</span>
                        </div>
                        <div className="summary-item date-picker-item" style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '240px' }}>
                          <label>Period</label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: '40px' }}>From:</span>
                              <div className="date-input-wrapper" style={{ margin: 0 }}>
                                <input 
                                  type="date" 
                                  className="date-picker" 
                                  value={dateFilter.start} 
                                  onChange={(e) => setDateFilter({ ...dateFilter, start: e.target.value })} 
                                />
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: '40px' }}>To:</span>
                              <div className="date-input-wrapper" style={{ margin: 0 }}>
                                <input 
                                  type="date" 
                                  className="date-picker" 
                                  value={dateFilter.end} 
                                  onChange={(e) => setDateFilter({ ...dateFilter, end: e.target.value })} 
                                />
                              </div>
                            </div>
                            <button className="action-btn small-btn" onClick={handleResetFilter} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)', padding: '0.25rem 0.6rem', fontSize: '0.75rem', width: '100%', marginTop: '2px' }}>Reset Period</button>
                          </div>
                        </div>
                        <div className="summary-item">
                          <label>Health</label><span>{totalInRecords > 0 ? Math.round(((spfPassCount + dkimPassCount) / (2 * totalInRecords)) * 100) : 0}%</span>
                        </div>
                      </div>
                    <div className="scroll-box" style={{marginTop: '1rem', minHeight: '450px'}}>
                        {inspectTab === 'log' ? (
                            <table className="modern-table">
                                <thead>
                                    <tr>
                                    <th className="sortable-header" onClick={() => handleSort('source_ip')}><div className="th-content">Source IP <SortIcon active={sortConfig.key==='source_ip'} direction={sortConfig.direction} /></div></th>
                                    {inspectDomain === '__global__' && <th>Domain</th>}
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
                                            <td>
                                              <span 
                                                className={`ip-badge ${r.spf_pass ? 'ip-legit' : 'ip-suspicious'}`}
                                                onClick={(e) => { e.stopPropagation(); handleOpenIpModal(r.source_ip); }}
                                                title={r.spf_pass ? "SPF-authorized sender" : "Sender not covered by SPF"}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                              >
                                                <StatusIcon pass={r.spf_pass} size={14} /> {r.source_ip}
                                              </span>
                                            </td>
                                            {inspectDomain === '__global__' && <td style={{fontSize: '0.8rem', opacity: 0.8}}>{(r as any).domain_name}</td>}
                                            <td>{r.count}</td><td>{r.org_name}</td><td>{formatDate(r.date)}</td>
                                            <td>
                                              {r.spf_pass && !r.dkim_pass ? (
                                                <span 
                                                  className="status-tag status-fail clickable-alert" 
                                                  onClick={(e) => { 
                                                    e.stopPropagation(); 
                                                    setDkimHelpModal({ ip: r.source_ip, domain: inspectDomain === '__global__' ? ((r as any).domain_name || 'your domain') : inspectDomain }); 
                                                  }}
                                                  title="SPF Passed, DKIM Failed. Click for troubleshooting."
                                                  style={{ cursor: 'pointer', borderBottom: '1px dotted var(--text-red)' }}
                                                >
                                                  ALRT 💡
                                                </span>
                                              ) : (
                                                <span className={`status-tag ${r.spf_pass && r.dkim_pass ? 'status-pass' : 'status-fail'}`}>
                                                  {r.spf_pass && r.dkim_pass ? 'PASS' : 'ALRT'}
                                                </span>
                                              )}
                                            </td>
                                        </tr>
                                        {expandedRecordId === r.id && (
                                            <tr className="auth-detail-row"><td colSpan={5}><div className="auth-detail-box"><h5>Forensics</h5><div className="detail-cols"><div className="detail-col"><h6>SPF</h6>{r.spf_auth_details.map((s: any, i: number) => (<div key={i} className="auth-entry"><span>{s.domain}: {s.result}</span></div>))}</div><div className="detail-col"><h6>DKIM</h6>{r.dkim_auth_details.map((d: any, i: number) => (<div key={i} className="auth-entry"><span>{d.domain}: {d.result}</span></div>))}</div></div></div></td></tr>
                                        )}
                                    </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <table className="modern-table">
                                <thead><tr><th className="sortable-header" onClick={() => handleSort('org_name')}><div className="th-content">Reporting Org <SortIcon active={sortConfig.key==='org_name'} direction={sortConfig.direction} /></div></th><th>Volume</th><th>SPF Fail</th><th>DKIM Fail</th></tr></thead>
                                <tbody>
                                  {reporters.map(([name, meta]) => (
                                    <tr key={name}>
                                      <td>
                                        <span 
                                          className="clickable-reporter" 
                                          style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--text-primary)' }}
                                          onClick={() => {
                                            setSearchQuery(name);
                                            setInspectTab('log');
                                          }}
                                          title={`Filter traffic log by ${name}`}
                                        >
                                          {name}
                                        </span>
                                      </td>
                                      <td>{meta.count}</td>
                                      <td>{meta.spfFail}</td>
                                      <td>{meta.dkimFail}</td>
                                    </tr>
                                  ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
                <aside className="side-panel">
                    <h3>Top Senders</h3>
                    <div className="sender-list">
                        {topSenders.map(([ip, meta]) => (
                            <div className="sender-item" key={ip}>
                                <div className="sender-info">
                                    <span className="sender-ip">{ip}</span>
                                    <span className="sender-count">{meta.count} msg</span>
                                </div>
                                <div className="sender-bar-bg">
                                    <div className={`sender-bar ${meta.pass ? 'pass' : 'fail'}`} style={{ width: `${Math.min(100, (meta.count / totalInRecords) * 100 * 5)}%` }}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="insight-card" style={{marginTop: '2rem'}}>
                        <p><strong>DMARC Insight:</strong> {spfPassCount < dkimPassCount ? "SPF alignment issues detected. Verify your include: mechanisms." : "Check for DKIM signing consistency across all sending mailservers."}</p>
                    </div>
                </aside>
             </div>
          </div>
        </div>
      )}
      {ipModal && (
        <div className="modal-overlay secondary-modal" onClick={() => setIpModal(null)}>
          <div className="modal-content glass-card" style={{maxWidth: '650px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Source IP Detail: {ipModal}</h3>
              <button className="close-btn" onClick={() => setIpModal(null)}>×</button>
            </div>
            <div className="modal-body">
              {ipLoading ? (
                <div style={{padding: '2rem', textAlign: 'center'}}>
                  <div className="loading-spinner"></div>
                  <p style={{marginTop: '1rem', color: 'var(--text-secondary)'}}>Fetching IP enrichment data...</p>
                </div>
              ) : ipDetails ? (
                <div className="ip-details">
                  <div className="enrichment-grid">
                    <div className="enrich-item">
                      <label>Organization / Owner</label>
                      <span>{ipDetails.org_name}</span>
                    </div>
                    <div className="enrich-item">
                      <label>ASN</label>
                      <span>AS{ipDetails.asn} ({ipDetails.asn_org})</span>
                    </div>
                    <div className="enrich-item">
                      <label>Network Range</label>
                      <span>{ipDetails.network}</span>
                    </div>
                    <div className="enrich-item">
                      <label>Country</label>
                      <span>{ipDetails.country}</span>
                    </div>
                  </div>

                  <div className={`guidance-box ${ipDetails.error ? '' : (detailedRecords.find(r => r.source_ip === ipModal)?.spf_pass ? 'legit' : 'suspicious')}`}>
                    <div className="guidance-header">
                      {detailedRecords.find(r => r.source_ip === ipModal)?.spf_pass ? (
                        <><span style={{color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px'}}><StatusIcon pass={true} size={18} /> SPF Authorized</span></>
                      ) : (
                        <><span style={{color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px'}}><StatusIcon pass={false} size={18} /> SPF Unauthorized</span></>
                      )}
                    </div>
                    <div className="guidance-text">
                      {detailedRecords.find(r => r.source_ip === ipModal)?.spf_pass ? (
                        "This sender appears to be explicitly authorized via your SPF policy. It matches one of your allowed IP ranges or includes."
                      ) : (
                        "This IP address is not covered by your current SPF record. This could indicate a missing 'include' for a mail service, a legacy system that was forgotten, or a potential spoofing attempt."
                      )}
                    </div>
                    <p className="disclaimer">Note: This is an automated indicator based on the reported DMARC results. Use this context to verify if the sender organization is a known partner or service.</p>
                  </div>
                </div>
              ) : <p>Error loading IP details.</p>}
            </div>
            <div className="modal-footer" style={{marginTop: '1.5rem', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem', textAlign: 'right'}}>
              <button className="action-btn" onClick={() => setIpModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {dkimHelpModal && (
        <div className="modal-overlay secondary-modal" onClick={() => setDkimHelpModal(null)}>
          <div className="modal-content glass-card" style={{maxWidth: '650px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>DMARC Troubleshooting: SPF Pass / DKIM Fail</h3>
              <button className="close-btn" onClick={() => setDkimHelpModal(null)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div className="insight-card" style={{ margin: 0, borderLeft: '4px solid #ef4444' }}>
                <p><strong>Report Context:</strong></p>
                <ul style={{ margin: '0.5rem 0 0 1.2rem', padding: 0 }}>
                  <li><strong>Domain:</strong> <code>{dkimHelpModal.domain}</code></li>
                  <li><strong>Sender IP:</strong> <code>{dkimHelpModal.ip}</code></li>
                  <li><strong>Status:</strong> SPF is valid (IP authorized), but DKIM signature is missing, invalid, or misaligned.</li>
                </ul>
              </div>

              <div>
                <h4>Why is this happening? (Hybrid & On-Premise Relays)</h4>
                <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
                  If your primary email flows through Exchange Online (Microsoft 365 / O365), but you use an on-premises mailhub or external smart relay for legacy systems, emails sent from on-premises will carry your domain in the <code>From:</code> header. 
                  Although the smart relay IP is listed in your SPF record (which validates the IP), the email likely lacks a valid DKIM signature signed by that relay, or it uses the relay's default envelope-from domain causing DMARC alignment failures.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <h4>How to Resolve DMARC Alignment:</h4>
                
                <div style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '6px', border: '1px solid var(--border-glass)' }}>
                  <h5>Option 1: Enable DKIM Signing on your On-Premise Smart Relay (Recommended)</h5>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                    Configure the on-premises smart relay/mailhub (e.g. Postfix, Exchange On-Premises, Cisco ESA) to sign outbound messages with a DKIM key for <code>{dkimHelpModal.domain}</code>. Publish the selector TXT record in your public DNS (e.g., <code>selector._domainkey.{dkimHelpModal.domain}</code>).
                  </p>
                </div>

                <div style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '6px', border: '1px solid var(--border-glass)' }}>
                  <h5>Option 2: Route On-Premise outbound via Exchange Online Connector</h5>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                    Instead of relaying directly to the internet, route mail from on-premises systems through Exchange Online via an Inbound Connector. Exchange Online will then automatically sign the outgoing messages using your domain's M365 DKIM configuration.
                  </p>
                </div>

                <div style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '6px', border: '1px solid var(--border-glass)' }}>
                  <h5>Option 3: Segregate Traffic using a Dedicated Subdomain</h5>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                    Route legacy or automated system alerts from a dedicated subdomain (e.g., <code>noreply@system.{dkimHelpModal.domain}</code>). You can configure a separate SPF and relaxed DMARC policy for this subdomain, preventing DKIM failures from impacting your root domain's DMARC reputation.
                  </p>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{marginTop: '1.5rem', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem', textAlign: 'right'}}>
              <button className="action-btn" onClick={() => setDkimHelpModal(null)}>Close Helper</button>
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

