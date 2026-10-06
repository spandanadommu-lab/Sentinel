import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useSentinelAuth } from './auth';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Check,
  ChevronDown, CircleHelp, ClipboardList, CloudRain, Compass, Crosshair, Database,
  Flame, HeartPulse, Layers, Map, Menu, MessageSquareText, Minus, Plus, Radio,
  RefreshCw, Search, Settings, Shield, Siren, Truck, Users, X,
} from 'lucide-react';
import {
  useHealthCheck, getHealthCheckQueryKey, useGetApiHealth, getGetApiHealthQueryKey,
  useGetDashboardSummary, getGetDashboardSummaryQueryKey, useListIncidents, getListIncidentsQueryKey,
  useCreateIncident, useGetIncident, getGetIncidentQueryKey, useUpdateIncident,
  useListZones, getListZonesQueryKey, useListShelters, getListSheltersQueryKey,
  useUpdateShelter, useListResources, getListResourcesQueryKey, useUpdateResource,
  useListRescueTeams, getListRescueTeamsQueryKey, useListRescueOperations,
  getListRescueOperationsQueryKey, useCreateRescueOperation, useUpdateRescueOperation,
  useListAlerts, getListAlertsQueryKey, useUpdateAlert, useGetWeather, getGetWeatherQueryKey,
  useGetFlood, getGetFloodQueryKey, useGetZoneRisk, getGetZoneRiskQueryKey, useAskCopilot,
  useListDataSources, getListDataSourcesQueryKey, useListSystemEvents, getListSystemEventsQueryKey,
  useSearchGlobal, getSearchGlobalQueryKey, useSearchLocations, getSearchLocationsQueryKey,
  useAnalyzeArea, getAnalyzeAreaQueryKey,
} from '@workspace/api-client-react';
import type { Incident, Shelter, Resource, Alert, RescueOperation, AffectedZone } from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const navGroups = [
  { label: 'OPERATIONS', links: [
    { href: '/', label: 'Overview', icon: Activity },
    { href: '/map', label: 'Live map', icon: Map },
    { href: '/incidents', label: 'Incidents', icon: Siren },
    { href: '/shelters', label: 'Shelters', icon: Shield },
    { href: '/resources', label: 'Resources', icon: ClipboardList },
    { href: '/rescue-operations', label: 'Rescue operations', icon: Truck },
    { href: '/alerts', label: 'Alerts', icon: Bell },
  ]},
  { label: 'INTELLIGENCE', links: [
    { href: '/copilot', label: 'Response copilot', icon: MessageSquareText },
    { href: '/data-sources', label: 'Data sources', icon: Database },
  ]},
  { label: 'SYSTEM', links: [{ href: '/settings', label: 'Settings', icon: Settings }] },
];
const titles: Record<string, string> = {
  '/': 'Overview', '/map': 'Live map', '/incidents': 'Incidents', '/shelters': 'Shelters',
  '/resources': 'Resources', '/rescue-operations': 'Rescue operations', '/alerts': 'Alerts',
  '/copilot': 'Response copilot', '/data-sources': 'Data sources', '/settings': 'Settings',
};
const fmt = (n?: number | null) => n == null ? '—' : new Intl.NumberFormat('en-US').format(n);
const time = (v?: string | null) => v ? new Date(v).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const cap = (v?: string | null) => v ? v.replaceAll('_', ' ') : '—';
const shortId = (v?: string | null) => v ? v.toUpperCase() : '—';

function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'red' | 'amber' | 'green' | 'blue' }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
function Panel({ title, right, children, className = '' }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{(title || right) && <header className="panel-head">{title && <h2>{title}</h2>}{right}</header>}{children}</section>;
}
function Empty({ label, detail = 'Nothing to display for the current selection.' }: { label: string; detail?: string }) {
  return <div className="empty"><span className="empty-mark"><Minus size={16}/></span><strong>{label}</strong><p>{detail}</p></div>;
}
function Failure({ label, retry }: { label: string; retry: () => void }) {
  return <div className="inline-error" role="alert"><AlertTriangle size={17}/><span>{label}</span><button className="text-button" onClick={retry} data-testid="button-retry">Retry</button></div>;
}
function LoadingRows() {
  return <div className="skeleton-stack" aria-label="Loading"><i/><i/><i/><i/></div>;
}
function State({ loading, error, retry, empty, children }: { loading: boolean; error: boolean; retry: () => void; empty: boolean; children: React.ReactNode }) {
  if (loading) return <LoadingRows/>;
  if (error) return <Failure label="Could not load operational data." retry={retry}/>;
  if (empty) return <Empty label="No records available"/>;
  return <>{children}</>;
}

function AuthForm({ compact = false, auth }: { compact?: boolean; auth: any }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formMode, setFormMode] = useState<'signin' | 'signup'>('signin');
  const [pending, setPending] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    auth.clearMessages();
    try {
      if (formMode === 'signin') await auth.signIn(email, password);
      else await auth.signUp(email, password);
      setPassword('');
    } catch {
      // The auth provider exposes a safe, user-facing error.
    } finally {
      setPending(false);
    }
  };
  return <form className={`auth-form ${compact ? 'auth-form-compact' : ''}`} onSubmit={submit}>
    <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.org" data-testid="input-auth-email"/></label>
    <label>Password<input type="password" autoComplete={formMode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} data-testid="input-auth-password"/></label>
    {auth.error && <p className="auth-message auth-error" role="alert">{auth.error}</p>}
    {auth.notice && <p className="auth-message auth-notice" role="status">{auth.notice}</p>}
    <div className="auth-form-actions"><button className="button button-primary" type="submit" disabled={pending || !auth.configured} data-testid="button-auth-submit">{pending ? 'Working…' : formMode === 'signin' ? 'Sign in securely' : 'Create account'}</button><button className="text-button" type="button" onClick={() => { auth.clearMessages(); setFormMode(formMode === 'signin' ? 'signup' : 'signin'); }} data-testid="button-auth-toggle">{formMode === 'signin' ? 'Create an account' : 'I already have an account'}</button></div>
    {formMode === 'signup' && <small className="auth-footnote">New accounts start as read-only VIEWER. An administrator must grant an operational role before edits are enabled.</small>}
  </form>;
}

function AuthScreen() {
  const auth = useSentinelAuth();
  return <main className="auth-screen">
    <section className="auth-card">
      <div className="auth-brand"><span className="brand-mark"><Crosshair size={20}/></span><span><b>SENTINEL</b><small>DISASTER RESPONSE CONSOLE</small></span></div>
      <div className="eyebrow">REGIONAL COORDINATION</div>
      <h1>See the situation.<br/>Coordinate the response.</h1>
      <p>Sign in to your SENTINEL workspace, or enter the clearly labeled demo with simulated operational records.</p>
      {auth.configured ? <AuthForm auth={auth}/> : <div className="auth-notice">Supabase authentication is not configured. The demo remains available.</div>}
      <div className="auth-divider"><span>OR</span></div>
      <button className="button button-outline full-width" onClick={auth.continueDemo} data-testid="button-continue-demo"><Activity size={16}/> Continue in simulated demo</button>
      <div className="auth-safety"><Shield size={16}/><span>Demo edits stay in memory and are discarded when the API server restarts. They never write to Supabase.</span></div>
    </section>
  </main>;
}

function Shell({ auth }: { auth: any }) {
  const [path, setPath] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [incidentModal, setIncidentModal] = useState(false);
  const search = useSearchGlobal({ q: globalSearch }, { query: { enabled: globalSearch.trim().length > 0, queryKey: getSearchGlobalQueryKey({ q: globalSearch }) } });
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 60000 } });
  const incidents = useListIncidents(undefined, { query: { queryKey: getListIncidentsQueryKey() } });
  const zones = useListZones({ query: { queryKey: getListZonesQueryKey() } });
  const shelters = useListShelters({ query: { queryKey: getListSheltersQueryKey() } });
  const resources = useListResources({ query: { queryKey: getListResourcesQueryKey() } });
  const teams = useListRescueTeams({ query: { queryKey: getListRescueTeamsQueryKey() } });
  const ops = useListRescueOperations({ query: { queryKey: getListRescueOperationsQueryKey() } });
  const alerts = useListAlerts({ query: { queryKey: getListAlertsQueryKey() } });
  const weather = useGetWeather(undefined, { query: { queryKey: getGetWeatherQueryKey(undefined) } });
  const flood = useGetFlood(undefined, { query: { queryKey: getGetFloodQueryKey(undefined) } });
  const sources = useListDataSources({ query: { queryKey: getListDataSourcesQueryKey() } });
  const events = useListSystemEvents({ query: { queryKey: getListSystemEventsQueryKey() } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const apiHealth = useGetApiHealth({ query: { queryKey: getGetApiHealthQueryKey() } });
  const queryClient = useQueryClient();
  const pageName = titles[path] || 'SENTINEL';
  const readOnly = auth.mode === 'live' && auth.role === 'VIEWER';
  const unread = alerts.data?.filter(a => a.status === 'ACTIVE').length || 0;
  const refresh = () => queryClient.invalidateQueries();
  const searchResults = search.data || [];

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Crosshair size={19}/></div><div><b>SENTINEL</b><small>RESPONSE SYSTEM</small></div><button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close navigation" data-testid="button-close-nav"><X size={17}/></button></div>
      <div className="agency"><span className="agency-dot"/><div><strong>Regional Coordination</strong><small>Kadapa district · {auth.mode === 'demo' ? 'DEMO' : auth.role}</small></div><ChevronDown size={14}/></div>
      <nav aria-label="Primary navigation">{navGroups.map(group => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.links.map(item => { const Icon = item.icon; return <Link href={item.href} onClick={() => setMobileNav(false)} className={`nav-link ${path === item.href ? 'nav-active' : ''}`} key={item.href} data-testid={`link-nav-${item.href.replace('/', 'overview')}`}><Icon size={17}/><span>{item.label}</span>{item.href === '/alerts' && unread > 0 && <em>{unread}</em>}</Link>; })}</div>)}</nav>
      <div className="sidebar-bottom"><div className="system-state"><span className="state-led"/><div><b>{auth.mode === 'demo' ? 'DEMO ENVIRONMENT' : 'AUTHENTICATED SESSION'}</b><small>{auth.mode === 'demo' ? 'Simulated records · Not live' : `Supabase · ${auth.role}`}</small></div></div><div className="operator"><div className="operator-avatar">{auth.mode === 'demo' ? 'D' : (auth.email?.[0] || 'U').toUpperCase()}</div><span><b>{auth.email || 'Demo operator'}</b><small>{auth.mode === 'demo' ? 'Local demo session' : auth.role}</small></span><CircleHelp size={16}/></div></div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation overlay" onClick={() => setMobileNav(false)} data-testid="button-nav-scrim"/>}
    <main className="main-area">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation" data-testid="button-open-nav"><Menu size={19}/></button>
        <div className="breadcrumb"><span>COMMAND CENTER</span><span className="crumb-divider">/</span><strong>{pageName}</strong></div>
        <div className="top-actions">
          <label className="global-search"><Search size={16}/><input aria-label="Search operations" placeholder="Search incidents, places…" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} data-testid="input-global-search"/><kbd>⌘ K</kbd></label>
          {globalSearch && <div className="search-popover">{search.isLoading ? <small>Searching records…</small> : searchResults.length ? searchResults.slice(0, 6).map(r => <button key={`${r.type}-${r.id}`} onClick={() => { setPath(r.path); setGlobalSearch(''); }} data-testid={`search-result-${r.id}`}><Search size={14}/><span><b>{r.title}</b><small>{r.subtitle}</small></span><Tag>{r.type.replace('_', ' ')}</Tag></button>) : <small>No matching operational records.</small>}</div>}
          <span className="top-divider"/>
          <div className="connection"><span className="state-led"/><span>System status</span><b>{health.data?.status === 'ok' || apiHealth.data?.status === 'ok' ? 'Operational' : health.isError || apiHealth.isError ? 'Unavailable' : 'Checking'}</b></div>
          <button className="icon-button alert-top" onClick={() => setPath('/alerts')} aria-label={`Open alerts, ${unread} active`} data-testid="button-open-alerts"><Bell size={18}/>{unread > 0 && <i/>}</button>
        </div>
      </header>
      <div className={`page-scroll ${auth.mode === 'live' && auth.role === 'VIEWER' ? 'viewer-read-only' : ''}`}>
        <div className="page-heading"><div><div className="eyebrow">EMERGENCY OPERATIONS · KADAPA DISTRICT</div><h1>{pageName}</h1></div><div className="heading-actions"><Tag tone={auth.mode === 'demo' ? 'amber' : 'blue'}>{auth.mode === 'demo' ? 'SIMULATED / DEMO' : `AUTHENTICATED · ${auth.role}`}</Tag><span className="updated">Updated {time(summary.data?.updatedAt)}</span>{path === '/incidents' && !readOnly && <button className="button button-primary" onClick={() => setIncidentModal(true)} data-testid="button-create-incident"><Plus size={16}/> Report incident</button>}</div></div>
        {readOnly && <div className="info-banner read-only-banner"><Shield size={16}/><span>VIEWER role: records are read-only. Ask an administrator to grant an operational role before making changes.</span></div>}
        <Switch>
          <Route path="/" component={() => <Overview summary={summary} incidents={incidents} zones={zones} shelters={shelters} resources={resources} teams={teams} alerts={alerts} events={events} refresh={refresh} go={setPath}/>}/>
          <Route path="/map" component={() => <MapPage incidents={incidents} zones={zones} shelters={shelters} teams={teams} refresh={refresh}/>}/>
          <Route path="/incidents" component={() => <IncidentsPage query={incidents} teams={teams} refresh={refresh} readOnly={readOnly}/>}/>
          <Route path="/shelters" component={() => <SheltersPage query={shelters} refresh={refresh} readOnly={readOnly}/>}/>
          <Route path="/resources" component={() => <ResourcesPage query={resources} refresh={refresh} readOnly={readOnly}/>}/>
          <Route path="/rescue-operations" component={() => <OperationsPage ops={ops} teams={teams} incidents={incidents} refresh={refresh} readOnly={readOnly}/>}/>
          <Route path="/alerts" component={() => <AlertsPage query={alerts} refresh={refresh} readOnly={readOnly}/>}/>
          <Route path="/copilot" component={() => <CopilotPage incidents={incidents} zones={zones}/>}/>
          <Route path="/data-sources" component={() => <DataSourcesPage sources={sources} events={events} weather={weather} flood={flood} health={health} apiHealth={apiHealth} refresh={refresh}/>}/>
          <Route path="/settings" component={() => <SettingsPage health={health} apiHealth={apiHealth} sources={sources} auth={auth}/>}/>
          <Route component={NotFound}/>
        </Switch>
        <footer className="footnote"><span>SENTINEL · Regional emergency coordination</span><span>Operational data is not for public distribution</span></footer>
      </div>
    </main>
    {incidentModal && !readOnly && <IncidentDialog close={() => setIncidentModal(false)} teams={teams.data || []} refresh={refresh}/>}
  </div>;
}

function Overview({ summary, incidents, zones, shelters, resources, teams, alerts, events, refresh, go }: any) {
  const s = summary.data;
  return <div className="overview-layout">
    <div className="metric-row">
      <Metric label="Active incidents" value={s?.activeIncidents} hint={`${s?.criticalIncidents ?? '—'} critical`} tone="red" icon={<Siren size={18}/>}/>
      <Metric label="Population at risk" value={s?.estimatedPopulationAtRisk} hint="ESTIMATED · modelled exposure" tone="amber" icon={<Users size={18}/>}/>
      <Metric label="Rescue teams active" value={s?.activeRescueTeams} hint={`${teams.data?.length ?? '—'} teams registered`} tone="green" icon={<Truck size={18}/>}/>
      <Metric label="Shelter occupancy" value={s?.occupiedShelters} hint="People currently accommodated" tone="blue" icon={<Shield size={18}/>}/>
      <Metric label="Resource shortages" value={s?.criticalResourceShortages} hint="At or below minimum stock" tone="red" icon={<ClipboardList size={18}/>}/>
    </div>
    <div className="overview-main">
      <Panel title="Priority incidents" right={<button className="text-button" onClick={() => go('/incidents')} data-testid="button-view-incidents">All incidents <ArrowRight size={14}/></button>}>
        <State loading={incidents.isLoading} error={incidents.isError} retry={refresh} empty={!incidents.data?.length}>
          <div className="priority-list">{(s?.topPriorityIncidents?.length ? s.topPriorityIncidents : (incidents.data || []).filter((i: Incident) => i.status !== 'RESOLVED').slice(0, 5)).map((i: Incident) => <IncidentRow key={i.id} incident={i} onClick={() => go('/incidents')}/>)}</div>
        </State>
      </Panel>
      <Panel title="Weather & river conditions" right={<Tag tone={s?.classification === 'SIMULATED' ? 'amber' : 'blue'}>{s?.latestWeather?.sourceStatus || 'SOURCE STATUS'}</Tag>}>
        <div className="conditions-grid">
          <div className="condition"><div className="condition-label"><CloudRain size={15}/> WEATHER · {s?.latestWeather?.location || 'Regional'}</div><b>{s?.latestWeather ? `${s.latestWeather.temperatureC}°C` : '—'}</b><span>{s?.latestWeather ? `${s.latestWeather.precipitationMm} mm precipitation · wind ${s.latestWeather.windKph} km/h` : 'No weather reading available'}</span><small>{s?.latestWeather?.source || 'Source not reported'} · {time(s?.latestWeather?.updatedAt)}</small></div>
          <div className="condition"><div className="condition-label"><Activity size={15}/> RIVER · {s?.latestFlood?.location || 'Regional'}</div><b>{s?.latestFlood ? `${s.latestFlood.riverLevelM.toFixed(2)} m` : '—'} <em className={s?.latestFlood?.trend === 'RISING' ? 'rising' : ''}>{s?.latestFlood?.trend || ''}</em></b><span>{s?.latestFlood ? `24h rainfall ${s.latestFlood.rainfall24hMm} mm · ${cap(s.latestFlood.riskLevel)} risk` : 'No flood reading available'}</span><small>{s?.latestFlood?.source || 'Source not reported'} · {time(s?.latestFlood?.updatedAt)}</small></div>
        </div>
        {(s?.latestWeather?.classification === 'SIMULATED' || s?.latestFlood?.classification === 'SIMULATED') && <p className="data-note"><AlertTriangle size={14}/> Environmental readings are SIMULATED / DEMO, not a live feed.</p>}
      </Panel>
      <Panel title="Affected zones" right={<Tag tone="amber">CALCULATED RISK</Tag>}>
        <State loading={zones.isLoading} error={zones.isError} retry={refresh} empty={!zones.data?.length}>
          <div className="zone-list">{(zones.data || []).slice(0, 5).map((z: AffectedZone) => <div className="zone-line" key={z.id}><span className={`risk-dot risk-${z.riskLevel.toLowerCase()}`}/><div className="zone-name"><b>{z.name}</b><small>{z.location}</small></div><div className="risk-score"><strong>{z.riskScore}</strong><small>CALCULATED</small></div><Tag tone={z.riskLevel === 'CRITICAL' || z.riskLevel === 'HIGH' ? 'red' : 'amber'}>{z.riskLevel}</Tag></div>)}</div>
        </State>
        <button className="panel-link" onClick={() => go('/map')} data-testid="button-open-map">Open operational map <ArrowRight size={15}/></button>
      </Panel>
      <Panel title="Priority alerts" right={<button className="text-button" onClick={() => go('/alerts')} data-testid="button-view-alerts">View all <ArrowRight size={14}/></button>}>
        <State loading={alerts.isLoading} error={alerts.isError} retry={refresh} empty={!alerts.data?.filter((a: Alert) => a.status === 'ACTIVE').length}>
          <div className="alert-list">{alerts.data?.filter((a: Alert) => a.status === 'ACTIVE').slice(0, 4).map((a: Alert) => <div className="alert-line" key={a.id}><span className={`alert-sev sev-${a.severity.toLowerCase()}`}><AlertTriangle size={15}/></span><div><b>{a.title}</b><small>{a.message}</small></div><time>{time(a.createdAt)}</time></div>)}</div>
        </State>
      </Panel>
    </div>
    <aside className="overview-side">
      <Panel title="Response posture" right={<span className="posture-score">{s ? `${s.criticalIncidents} / ${s.activeIncidents}` : '—'}</span>}>
        <div className="posture-summary"><span className="posture-rule"/><strong>Incidents requiring immediate coordination</strong><p>Review assignments and exposed populations before dispatch.</p></div>
        <button className="button button-outline full-width" onClick={() => go('/rescue-operations')} data-testid="button-coordinate-response">Coordinate response <ArrowRight size={15}/></button>
      </Panel>
      <Panel title="Shelter capacity">
        <State loading={shelters.isLoading} error={shelters.isError} retry={refresh} empty={!shelters.data?.length}>
          <div className="capacity-list">{(shelters.data || []).slice(0, 4).map((sh: Shelter) => <div key={sh.id}><div className="capacity-meta"><b>{sh.name}</b><span>{sh.occupancy} / {sh.capacity}</span></div><div className="progress"><i style={{ width: `${Math.min(sh.occupancyPercent, 100)}%` }}/></div><small>{sh.occupancyPercent}% · {sh.classification}</small></div>)}</div>
        </State>
        <button className="panel-link" onClick={() => go('/shelters')} data-testid="button-view-shelters">Shelter directory <ArrowRight size={15}/></button>
      </Panel>
      <Panel title="Recent activity" right={<span className="muted-label">LATEST</span>}>
        <State loading={events.isLoading} error={events.isError} retry={refresh} empty={!events.data?.length}>
          <div className="activity-list">{events.data?.slice(0, 5).map((ev: any) => <div className="activity-item" key={ev.id}><span className="activity-mark"/><div><b>{ev.title}</b><small>{ev.message}</small><time>{time(ev.createdAt)} · {ev.classification}</time></div></div>)}</div>
        </State>
      </Panel>
    </aside>
  </div>;
}

function Metric({ label, value, hint, tone, icon }: any) {
  return <div className="metric-card" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className={`metric-icon icon-${tone}`}>{icon}</div><div className="metric-label">{label}</div><strong>{value == null ? '—' : fmt(value)}</strong><small>{hint}</small></div>;
}
function IncidentRow({ incident: i, onClick }: { incident: Incident; onClick?: () => void }) {
  const critical = i.severity === 'CRITICAL' || i.severity === 'HIGH';
  return <div className="priority-row" role="button" tabIndex={0} onClick={onClick} onKeyDown={e => e.key === 'Enter' && onClick?.()} data-testid={`incident-row-${i.id}`}><div className={`priority-stripe ${critical ? 'stripe-critical' : ''}`}/><div className="incident-main"><div className="incident-title"><b>{i.title}</b><Tag tone={critical ? 'red' : 'amber'}>{i.severity}</Tag></div><span>{i.location} <i>·</i> {i.type} <i>·</i> {i.priority}</span></div><div className="incident-exposure"><strong>{fmt(i.estimatedPopulation)}</strong><small>EST. EXPOSED</small></div><div className="incident-state"><Tag>{cap(i.status)}</Tag><small>{time(i.updatedAt)}</small></div><ArrowRight className="row-arrow" size={16}/></div>;
}

function DataTable({ headers, rows, loading, error, emptyLabel = 'No records found', retry, filter, children }: any) {
  return <div className="table-shell">
    {filter && <div className="table-toolbar">{filter}{children}</div>}
    <State loading={loading} error={error} retry={retry || (() => {})} empty={!rows?.length}>
      {!rows?.length ? <Empty label={emptyLabel}/> : <div className="table-scroll"><table><thead><tr>{headers.map((h: string) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row: any) => <tr key={row.id}>{row.cells.map((cell: React.ReactNode, idx: number) => <td key={`${row.id}-${idx}`}>{cell}</td>)}</tr>)}</tbody></table></div>}
    </State>
  </div>;
}

function IncidentsPage({ query, teams, refresh, readOnly }: any) {
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [selectedId, setSelectedId] = useState('');
  const [path] = useLocation();
  const data = query.data || [];
  const filtered = data.filter((i: Incident) => (!search || `${i.title} ${i.location} ${i.type}`.toLowerCase().includes(search.toLowerCase())) && (severity === 'ALL' || i.severity === severity) && (status === 'ALL' || i.status === status));
  const selectedQuery = useGetIncident(selectedId, { query: { enabled: !!selectedId, queryKey: getGetIncidentQueryKey(selectedId) } });
  const update = useUpdateIncident();
  const qc = useQueryClient();
  const assign = (incident: Incident, id: string) => update.mutate({ id: incident.id, data: { assignedTeamId: id || null } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListIncidentsQueryKey() }); qc.invalidateQueries({ queryKey: getGetIncidentQueryKey(incident.id) }); } });
  const rows = filtered.map((i: Incident) => ({ id: i.id, cells: [
    <button className="table-primary" onClick={() => setSelectedId(i.id)} data-testid={`button-incident-details-${i.id}`}>{i.title}<small>{shortId(i.id)} · {i.type}</small></button>,
    <span>{i.location}</span>,
    <Tag tone={i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'red' : 'amber'}>{i.severity}</Tag>,
    <Tag>{cap(i.status)}</Tag>,
    <span className="mono">{i.priority}</span>,
    <span className="exposed">{fmt(i.estimatedPopulation)}<small>ESTIMATED</small></span>,
     <label className="inline-select"><span className="sr-only">Assign team to {i.title}</span><select value={i.assignedTeamId || ''} disabled={readOnly} onChange={e => assign(i, e.target.value)} data-testid={`select-assign-${i.id}`}><option value="">Unassigned</option>{teams.data?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>,
  ]}));
  return <><div className="filter-summary"><span><b>{filtered.length}</b> incidents shown</span><span><i className="risk-dot risk-high"/> CALCULATED risk · <i className="amber-dot"/> ESTIMATED exposed population</span></div>
    <DataTable headers={['Incident', 'Location', 'Severity', 'Status', 'Priority', 'Exposed population', 'Assigned team']} rows={rows} loading={query.isLoading} error={query.isError} retry={refresh} filter={<><label className="search-filter"><Search size={15}/><input placeholder="Filter incidents…" aria-label="Filter incidents" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-filter-incidents"/></label><label className="select-filter"><span className="sr-only">Filter by severity</span><select value={severity} onChange={e => setSeverity(e.target.value)} data-testid="select-filter-severity"><option value="ALL">All severity</option>{['CRITICAL','HIGH','MODERATE','LOW'].map(v => <option key={v}>{v}</option>)}</select></label><label className="select-filter"><span className="sr-only">Filter by status</span><select value={status} onChange={e => setStatus(e.target.value)} data-testid="select-filter-status"><option value="ALL">All status</option>{['ACTIVE','MONITORING','CONTAINED','RESOLVED'].map(v => <option key={v}>{v}</option>)}</select></label></>} />
    {selectedId && <div className="modal-backdrop" role="presentation" onClick={() => setSelectedId('')}><section className="dialog detail-dialog" role="dialog" aria-modal="true" aria-labelledby="incident-detail-title" onClick={e => e.stopPropagation()}><div className="dialog-head"><div><span className="eyebrow">INCIDENT RECORD · {shortId(selectedId)}</span><h2 id="incident-detail-title">{selectedQuery.data?.title || 'Incident details'}</h2></div><button className="icon-button" onClick={() => setSelectedId('')} aria-label="Close incident details" data-testid="button-close-incident"><X size={17}/></button></div>{selectedQuery.isLoading ? <LoadingRows/> : selectedQuery.isError ? <Failure label="Incident detail unavailable." retry={refresh}/> : selectedQuery.data && <><p className="detail-description">{selectedQuery.data.description}</p><div className="detail-facts"><div><small>LOCATION</small><b>{selectedQuery.data.location}</b></div><div><small>SEVERITY</small><b>{selectedQuery.data.severity}</b></div><div><small>STATUS</small><b>{selectedQuery.data.status}</b></div><div><small>RISK SCORE</small><b>{selectedQuery.data.riskScore} · CALCULATED</b></div><div><small>POPULATION</small><b>{fmt(selectedQuery.data.estimatedPopulation)} · ESTIMATED</b></div><div><small>CLASSIFICATION</small><b>{selectedQuery.data.classification}</b></div></div><h3 className="subheading">Risk factors</h3><div className="chip-wrap">{selectedQuery.data.riskFactors?.map((factor: string) => <Tag key={factor}>{factor}</Tag>)}</div></>}</section></div>}
  </>;
}

function SheltersPage({ query, refresh, readOnly }: any) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const update = useUpdateShelter();
  const qc = useQueryClient();
  const rows = (query.data || []).filter((s: Shelter) => (!search || `${s.name} ${s.location}`.toLowerCase().includes(search.toLowerCase())) && (status === 'ALL' || s.status === status)).map((s: Shelter) => ({ id: s.id, cells: [
    <div className="table-primary">{s.name}<small>{s.location}</small></div>, <span>{fmt(s.occupancy)} / {fmt(s.capacity)} people</span>,
    <div className="capacity-cell"><div className="progress"><i style={{ width: `${Math.min(s.occupancyPercent, 100)}%` }}/></div><small>{s.occupancyPercent}% occupied</small></div>,
    <Tag tone={s.status === 'FULL' || s.status === 'CLOSED' ? 'red' : s.status === 'NEAR_CAPACITY' ? 'amber' : 'green'}>{cap(s.status)}</Tag>,
    <span>{s.contact}</span>, <span>{s.resources?.map((r: any) => r.name).join(', ') || '—'}</span>,
    <button className="small-button" onClick={() => { const next = Math.min(s.capacity, s.occupancy + 10); update.mutate({ id: s.id, data: { occupancy: next } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListSheltersQueryKey() }) }); }} disabled={readOnly || update.isPending || s.occupancy >= s.capacity} data-testid={`button-update-occupancy-${s.id}`}>+10 occupants</button>,
  ]}));
  return <><div className="info-banner"><Shield size={17}/><span>Occupancy is a reported operational count. All seeded records are marked SIMULATED / DEMO.</span></div><DataTable headers={['Shelter / location', 'Occupancy', 'Utilization', 'Status', 'Contact', 'Available resources', 'Update']} rows={rows} loading={query.isLoading} error={query.isError} retry={refresh} filter={<><label className="search-filter"><Search size={15}/><input aria-label="Filter shelters" placeholder="Search shelters…" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-filter-shelters"/></label><label className="select-filter"><span className="sr-only">Filter shelter status</span><select value={status} onChange={e => setStatus(e.target.value)} data-testid="select-filter-shelter-status"><option value="ALL">All status</option>{['AVAILABLE','NEAR_CAPACITY','FULL','CLOSED'].map(v => <option key={v}>{v}</option>)}</select></label></>}/></>;
}

function ResourcesPage({ query, refresh, readOnly }: any) {
  const [search, setSearch] = useState('');
  const update = useUpdateResource();
  const qc = useQueryClient();
  const rows = (query.data || []).filter((r: Resource) => !search || r.name.toLowerCase().includes(search.toLowerCase())).map((r: Resource) => ({ id: r.id, cells: [
    <div className="table-primary">{r.name}<small>Last updated {time(r.updatedAt)}</small></div>, <b className="quantity">{fmt(r.quantity)} <small>{r.unit}</small></b>,
    <span>{r.consumptionPerHour == null ? 'Not reported' : `${r.consumptionPerHour} ${r.unit}/hr`}</span>, <span>{r.hoursRemaining == null ? '—' : `${r.hoursRemaining} hr`}</span>,
    <span>{fmt(r.minimumThreshold)} {r.unit}</span>, <Tag tone={r.status === 'CRITICAL' || r.status === 'OUT' ? 'red' : r.status === 'LOW' ? 'amber' : 'green'}>{r.status}</Tag>,
    <button className="small-button" onClick={() => { const val = window.prompt(`Set quantity for ${r.name}`, String(r.quantity)); if (val !== null && Number.isFinite(Number(val)) && Number(val) >= 0) update.mutate({ id: r.id, data: { quantity: Number(val) } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListResourcesQueryKey() }) }); }} disabled={readOnly} data-testid={`button-edit-resource-${r.id}`}>Adjust stock</button>,
  ]}));
  return <><div className="resource-summary"><div><span className="eyebrow">INVENTORY POSTURE</span><strong>{query.data?.filter((r: Resource) => r.status === 'CRITICAL' || r.status === 'OUT').length ?? '—'}</strong><small>critical / depleted categories</small></div><p>Operational quantities and consumption rates are reported values. Check source freshness before committing dispatch decisions.</p></div><DataTable headers={['Resource', 'On hand', 'Consumption', 'Est. endurance', 'Minimum threshold', 'Status', 'Action']} rows={rows} loading={query.isLoading} error={query.isError} retry={refresh} filter={<label className="search-filter"><Search size={15}/><input aria-label="Filter resources" placeholder="Search inventory…" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-filter-resources"/></label>}/></>;
}

function OperationsPage({ ops, teams, incidents, refresh, readOnly }: any) {
  const [showForm, setShowForm] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [priority, setPriority] = useState('P2');
  const [notes, setNotes] = useState('');
  const create = useCreateRescueOperation();
  const update = useUpdateRescueOperation();
  const qc = useQueryClient();
  const activeTeams = teams.data?.filter((t: any) => t.status !== 'OFFLINE') || [];
  const rows = (ops.data || []).map((o: RescueOperation) => ({ id: o.id, cells: [
    <div className="table-primary">{o.teamName}<small>{shortId(o.teamId)} · {o.incidentTitle}</small></div>,
    <Tag tone={o.priority === 'P1' ? 'red' : 'amber'}>{o.priority}</Tag>,
    <Tag>{cap(o.status)}</Tag>, <span>{o.notes || '—'}</span>, <span>{time(o.startedAt)}</span>,
    <label className="inline-select"><span className="sr-only">Update operation status for {o.teamName}</span><select value={o.status} disabled={readOnly} onChange={e => update.mutate({ id: o.id, data: { status: e.target.value as any } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListRescueOperationsQueryKey() }) })} data-testid={`select-operation-status-${o.id}`}>{['EN_ROUTE','DEPLOYED','ON_SCENE','COMPLETED'].map(v => <option key={v} value={v}>{cap(v)}</option>)}</select></label>,
  ]}));
  return <><div className="operation-banner"><div className="operation-banner-icon"><Truck size={20}/></div><div><b>Team assignment is a dispatch decision.</b><span>Verify reported team status and incident location before deploying. Seeded team coordinates are not live GPS.</span></div><button className="button button-primary" disabled={readOnly} onClick={() => setShowForm(v => !v)} data-testid="button-new-operation"><Plus size={16}/> Assign team</button></div>
    {showForm && <Panel title="Create rescue assignment" className="form-panel"><div className="form-grid"><label>Rescue team<select value={teamId} onChange={e => setTeamId(e.target.value)} data-testid="select-operation-team"><option value="">Select team</option>{activeTeams.map((t: any) => <option key={t.id} value={t.id}>{t.name} · {t.status}</option>)}</select></label><label>Incident<select value={incidentId} onChange={e => setIncidentId(e.target.value)} data-testid="select-operation-incident"><option value="">Select incident</option>{incidents.data?.filter((i: Incident) => i.status !== 'RESOLVED').map((i: Incident) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label><label>Priority<select value={priority} onChange={e => setPriority(e.target.value)} data-testid="select-operation-priority">{['P1','P2','P3'].map(v => <option key={v}>{v}</option>)}</select></label><label className="span-two">Dispatch notes<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional operational context" data-testid="input-operation-notes"/></label></div><div className="form-actions"><button className="button button-outline" onClick={() => setShowForm(false)} data-testid="button-cancel-operation">Cancel</button><button className="button button-primary" disabled={!teamId || !incidentId || create.isPending} onClick={() => create.mutate({ data: { teamId, incidentId, priority: priority as any, notes } }, { onSuccess: () => { setShowForm(false); setTeamId(''); setIncidentId(''); setNotes(''); qc.invalidateQueries({ queryKey: getListRescueOperationsQueryKey() }); qc.invalidateQueries({ queryKey: getListRescueTeamsQueryKey() }); } })} data-testid="button-submit-operation">{create.isPending ? 'Assigning…' : 'Confirm assignment'}</button></div></Panel>}
    <div className="team-strip"><span className="eyebrow">TEAM AVAILABILITY</span>{teams.data?.map((t: any) => <div key={t.id}><span className={`team-status-dot status-${t.status.toLowerCase()}`}/><b>{t.name}</b><small>{t.type} · {t.status} · {t.vehicle}</small></div>)}</div>
    <DataTable headers={['Team / incident', 'Priority', 'Operation status', 'Dispatch notes', 'Started', 'Update status']} rows={rows} loading={ops.isLoading} error={ops.isError} retry={refresh}/>
  </>;
}

function AlertsPage({ query, refresh, readOnly }: any) {
  const [filter, setFilter] = useState('ACTIVE');
  const update = useUpdateAlert();
  const qc = useQueryClient();
  const rows = (query.data || []).filter((a: Alert) => filter === 'ALL' || a.status === filter).map((a: Alert) => ({ id: a.id, cells: [
    <div className="table-primary">{a.title}<small>{a.message}</small></div>,
    <Tag tone={a.severity === 'CRITICAL' ? 'red' : a.severity === 'WARNING' ? 'amber' : 'blue'}>{a.severity}</Tag>,
    <Tag>{cap(a.status)}</Tag>, <span>{a.source}</span>, <span>{a.incidentId || a.zoneId ? shortId(a.incidentId || a.zoneId) : '—'}</span>,
    <><Tag tone={a.classification === 'SIMULATED' ? 'amber' : 'neutral'}>{a.classification}</Tag><small className="table-subline">{time(a.createdAt)}</small></>,
    a.status === 'ACTIVE' ? <button className="small-button" disabled={readOnly || update.isPending} onClick={() => update.mutate({ id: a.id, data: { status: 'ACKNOWLEDGED' } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListAlertsQueryKey() }) })} data-testid={`button-acknowledge-${a.id}`}><Check size={13}/> Acknowledge</button> : <span className="muted-label">No action</span>,
  ]}));
  return <><div className="alert-intro"><div><div className="eyebrow">TRIAGE QUEUE</div><b>Confirm receipt before closing the loop.</b><p>Alerts retain source classification so operators can distinguish observed signals from calculated and simulated records.</p></div><div className="alert-count"><strong>{query.data?.filter((a: Alert) => a.status === 'ACTIVE').length ?? '—'}</strong><small>ACTIVE</small></div></div><DataTable headers={['Alert', 'Severity', 'Status', 'Source', 'Related record', 'Classification / time', 'Action']} rows={rows} loading={query.isLoading} error={query.isError} retry={refresh} filter={<label className="select-filter"><span className="sr-only">Filter alerts by status</span><select value={filter} onChange={e => setFilter(e.target.value)} data-testid="select-alert-filter">{['ACTIVE','ACKNOWLEDGED','RESOLVED','EXPIRED','ALL'].map(v => <option key={v}>{v}</option>)}</select></label>}/></>;
}

function CopilotPage({ incidents, zones }: any) {
  const [question, setQuestion] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [answer, setAnswer] = useState<any>(null);
  const ask = useAskCopilot();
  const prompts = ['Which incidents have the highest exposed population?', 'What shelter capacity is available near active incidents?', 'Summarize immediate response priorities.'];
  const submit = (text = question) => { if (text.trim()) ask.mutate({ data: { question: text.trim(), ...(incidentId ? { incidentId } : {}), ...(zoneId ? { zoneId } : {}) } }, { onSuccess: (v: any) => setAnswer(v) }); };
  return <div className="copilot-layout"><section className="copilot-main"><div className="copilot-intro"><div className="copilot-emblem"><MessageSquareText size={22}/></div><div><div className="eyebrow">OPERATIONAL DECISION SUPPORT</div><h2>Ask about the response picture.</h2><p>Answers are grounded in current SENTINEL records. Verify recommendations against official protocols and source freshness.</p></div></div>
      <div className="prompt-list">{prompts.map((p, i) => <button key={p} onClick={() => { setQuestion(p); submit(p); }} data-testid={`button-prompt-${i}`}>{p}<ArrowRight size={15}/></button>)}</div>
      {answer && <div className="copilot-answer"><div className="answer-meta"><span><MessageSquareText size={15}/> RESPONSE</span><Tag tone={answer.source === 'rules' ? 'blue' : 'neutral'}>{answer.source}</Tag></div><p>{answer.answer}</p>{answer.recommendations?.length > 0 && <><h3>Recommended checks</h3><ul>{answer.recommendations.map((r: string) => <li key={r}>{r}</li>)}</ul></>}<small>{answer.disclaimer} · Generated {time(answer.generatedAt)}</small></div>}
      {ask.isError && <Failure label="Response assistant is unavailable. Your question has not been sent." retry={() => submit()}/>}
      <div className="question-box"><textarea aria-label="Ask response copilot" maxLength={1000} placeholder="Ask about incidents, exposed communities, shelter capacity or response priorities…" value={question} onChange={e => setQuestion(e.target.value)} data-testid="input-copilot-question"/><div><small>{question.length}/1000 · Operational context only</small><button className="button button-primary" disabled={!question.trim() || ask.isPending} onClick={() => submit()} data-testid="button-ask-copilot">{ask.isPending ? 'Reviewing…' : 'Ask SENTINEL'} <ArrowRight size={15}/></button></div></div>
      <div className="disclaimer"><AlertTriangle size={15}/> Decision support only. Copilot output is not an official instruction or substitute for incident command.</div>
    </section><aside className="copilot-side"><Panel title="Scope the query"><label className="field-label">Incident context<select value={incidentId} onChange={e => setIncidentId(e.target.value)} data-testid="select-copilot-incident"><option value="">All active incidents</option>{incidents.data?.map((i: Incident) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label><label className="field-label">Affected zone<select value={zoneId} onChange={e => setZoneId(e.target.value)} data-testid="select-copilot-zone"><option value="">Any zone</option>{zones.data?.map((z: AffectedZone) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label><div className="scope-note"><Shield size={16}/><span>Only records available to this SENTINEL instance are included. Data may be SIMULATED / DEMO.</span></div></Panel><Panel title="How to use response support"><div className="guidance-list"><div><b>01</b><span>Ask one clear operational question.</span></div><div><b>02</b><span>Check source and classification details.</span></div><div><b>03</b><span>Confirm actions with incident command.</span></div></div></Panel></aside></div>;
}

function DataSourcesPage({ sources, events, weather, flood, health, apiHealth, refresh }: any) {
  const rows = (sources.data || []).map((s: any) => ({ id: s.id, cells: [<div className="table-primary">{s.name}<small>{s.type}</small></div>, <Tag tone={s.status === 'LIVE' ? 'green' : s.status === 'ERROR' ? 'red' : s.status === 'SIMULATED' ? 'amber' : 'neutral'}>{s.status}</Tag>, <span>{time(s.lastSuccessAt)}</span>, <span>{s.lastError || s.message}</span>] }));
  return <><div className="source-health-row"><div className="source-health-card"><div className="source-health-title"><HeartPulse size={17}/> Service health</div><b>{health.data?.status || apiHealth.data?.status || (health.isError && apiHealth.isError ? 'Unavailable' : 'Checking')}</b><small>Health endpoints are independently checked.</small></div><div className="source-health-card"><div className="source-health-title"><CloudRain size={17}/> Weather freshness</div><b>{weather.data?.sourceStatus || 'Unknown'}</b><small>{weather.data?.source || 'No source reported'} · {time(weather.data?.updatedAt)}</small></div><div className="source-health-card"><div className="source-health-title"><Activity size={17}/> Flood observations</div><b>{flood.data?.sourceStatus || 'Unknown'}</b><small>{flood.data?.source || 'No source reported'} · {time(flood.data?.updatedAt)}</small></div></div><div className="info-banner"><Radio size={16}/><span>LIVE indicates source-reported live status only. SIMULATED records and seeded map coordinates must never be treated as live telemetry.</span></div><DataTable headers={['Data source', 'Connection status', 'Last successful update', 'Details']} rows={rows} loading={sources.isLoading} error={sources.isError} retry={refresh}/><Panel title="System activity" className="activity-panel"><State loading={events.isLoading} error={events.isError} retry={refresh} empty={!events.data?.length}><div className="event-table">{events.data?.map((ev: any) => <div key={ev.id}><time>{time(ev.createdAt)}</time><b>{ev.title}</b><span>{ev.message}</span><Tag tone={ev.classification === 'SIMULATED' ? 'amber' : 'neutral'}>{ev.classification}</Tag></div>)}</div></State></Panel></>;
}

function SettingsPage({ health, apiHealth, sources, auth }: any) {
  return <div className="settings-layout"><div><Panel title="Environment"><div className="settings-item"><div><b>Data mode</b><small>{auth.mode === 'demo' ? 'Edits affect the in-memory demonstration scenario only.' : 'You are authenticated against the configured Supabase project. Each record retains its source classification.'}</small></div><Tag tone={auth.mode === 'demo' ? 'amber' : 'blue'}>{auth.mode === 'demo' ? 'SIMULATED / DEMO' : 'AUTHENTICATED'}</Tag></div><div className="settings-item"><div><b>Access role</b><small>{auth.email || 'Local simulated operator session'}</small></div><Tag>{auth.role}</Tag></div><div className="settings-item"><div><b>Location freshness</b><small>Operational coordinates are record locations, not live GPS telemetry.</small></div><Tag tone="blue">NOT LIVE GPS</Tag></div></Panel>
    <Panel title={auth.mode === 'demo' ? 'Connect a user account' : 'Account access'}>{auth.mode === 'demo' ? <><p className="settings-copy">Sign in to use authenticated Supabase data. Demo edits are separate and are not copied into the database.</p>{auth.configured ? <AuthForm compact auth={auth}/> : <div className="auth-notice">Supabase URL and publishable key are not configured in this deployment.</div>}</> : <><div className="settings-item"><div><b>{auth.email}</b><small>Role-based permissions are enforced by SENTINEL and Supabase row-level security.</small></div><Tag tone={auth.role === 'VIEWER' ? 'amber' : 'green'}>{auth.role}</Tag></div><div className="auth-form-actions"><button className="button button-outline" onClick={() => void auth.signOut()} data-testid="button-sign-out">Sign out</button><button className="button button-outline" onClick={() => void auth.switchToDemo()} data-testid="button-switch-demo">Switch to simulated demo</button></div></>}</Panel>
    <Panel title="Data handling"><p className="settings-copy">Risk scores are <b>CALCULATED</b>. Population exposure is <b>ESTIMATED</b>. Demo incidents, shelters, teams and alerts are explicitly marked <b>SIMULATED / DEMO</b>. Public feed records identify their source and are not assumed to be local warnings.</p><div className="settings-item"><div><b>Operational decisions</b><small>Confirm source freshness and follow official command procedures before acting.</small></div><CircleHelp size={19}/></div></Panel></div><aside><Panel title="Connection checks"><div className="connection-check"><span className={`health-light ${health.isError ? 'health-bad' : ''}`}/><span>Health check</span><b>{health.data?.status || (health.isError ? 'Unavailable' : 'Checking')}</b></div><div className="connection-check"><span className={`health-light ${apiHealth.isError ? 'health-bad' : ''}`}/><span>API health</span><b>{apiHealth.data?.status || (apiHealth.isError ? 'Unavailable' : 'Checking')}</b></div><div className="connection-check"><Database size={15}/><span>Configured sources</span><b>{sources.data?.length ?? '—'}</b></div></Panel><Panel title="Display"><div className="settings-item"><div><b>High-contrast light theme</b><small>Operational display preset</small></div><Tag tone="green">ACTIVE</Tag></div><p className="settings-copy">This console is designed for quick scanning in command environments. No theme or notification preferences are saved by this demo.</p></Panel></aside></div>;
}

function LegacySchematicMapPage({ incidents, zones, shelters, teams, refresh }: any) {
  const [layers, setLayers] = useState({ incidents: true, zones: true, shelters: true, teams: true });
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<any>(null);
  const [selectedMarker, setSelectedMarker] = useState<any>(null);
  const [selectedZoneId, setSelectedZoneId] = useState('');
  const [area, setArea] = useState<any>(null);
  const [radius, setRadius] = useState('5');
  const locQuery = useSearchLocations({ q: locationQuery }, { query: { enabled: locationQuery.trim().length >= 2, queryKey: getSearchLocationsQueryKey({ q: locationQuery }) } });
  const analysisParams = { lat: selectedLocation?.lat ?? 40.7128, lng: selectedLocation?.lng ?? -74.006, radiusKm: Number(radius) || 5 };
  const analysis = useAnalyzeArea(analysisParams, { query: { enabled: !!area, queryKey: getAnalyzeAreaQueryKey(analysisParams) } });
  const selectedRisk = useGetZoneRisk(selectedZoneId, { query: { enabled: !!selectedZoneId, queryKey: getGetZoneRiskQueryKey(selectedZoneId) } });
  const toggle = (key: keyof typeof layers) => setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  const allPoints = [
    ...(layers.incidents ? (incidents.data || []).map((v: Incident, i: number) => ({ id: v.id, title: v.title, kind: 'incident', lat: v.lat, lng: v.lng, tone: v.severity === 'CRITICAL' ? 'pin-red' : 'pin-amber', index: i })) : []),
    ...(layers.zones ? (zones.data || []).map((v: AffectedZone, i: number) => ({ id: v.id, title: v.name, kind: 'zone', lat: v.lat, lng: v.lng, tone: 'pin-zone', index: i })) : []),
    ...(layers.shelters ? (shelters.data || []).map((v: Shelter, i: number) => ({ id: v.id, title: v.name, kind: 'shelter', lat: v.lat, lng: v.lng, tone: 'pin-green', index: i })) : []),
    ...(layers.teams ? (teams.data || []).map((v: any, i: number) => ({ id: v.id, title: v.name, kind: 'team', lat: v.lat, lng: v.lng, tone: 'pin-blue', index: i })) : []),
  ];
  return <div className="map-layout"><section className="map-workspace"><div className="map-toolbar"><label className="map-search"><Search size={16}/><input aria-label="Search map location" placeholder="Search location or address…" value={locationQuery} onChange={e => setLocationQuery(e.target.value)} data-testid="input-map-location"/></label>{(locQuery.data || []).length > 0 && <div className="location-results">{(locQuery.data || []).map((l: any, i: number) => <button key={`${l.name}-${i}`} onClick={() => { setSelectedLocation(l); setLocationQuery(l.name); setArea(true); }} data-testid={`button-location-result-${i}`}><Map size={14}/><span><b>{l.name}</b><small>{l.displayName}</small></span></button>)}</div>}<div className="map-controls"><button aria-label="Zoom in" onClick={e => (e.currentTarget.closest('.map-frame') as HTMLElement)?.classList.add('zoomed')} data-testid="button-map-zoom-in"><Plus size={16}/></button><button aria-label="Zoom out" onClick={e => (e.currentTarget.closest('.map-frame') as HTMLElement)?.classList.remove('zoomed')} data-testid="button-map-zoom-out"><Minus size={16}/></button><button aria-label="Reset map view" onClick={() => { setSelectedLocation(null); setLocationQuery(''); }} data-testid="button-map-reset"><Crosshair size={16}/></button></div></div>
      <div className="map-frame"><div className="map-grid"/><svg className="map-lines" viewBox="0 0 900 600" preserveAspectRatio="none" aria-hidden="true"><path d="M-10 120 C110 145 170 60 280 92S420 210 540 165 720 65 930 110"/><path d="M-15 340 C130 295 195 388 300 343S450 247 575 310 730 425 920 365"/><path d="M120 -20 C170 95 115 175 188 269S305 400 275 620"/><path d="M520 -20 C470 75 550 155 490 250S410 438 520 620"/><path d="M770 -10 C675 90 750 175 690 260S655 445 780 620"/></svg><div className="map-water"/><div className="map-road road-one"/><div className="map-road road-two"/><div className="map-label map-label-a">NORTH DISTRICT</div><div className="map-label map-label-b">RIVER CORRIDOR</div><div className="map-label map-label-c">EAST WARD</div><div className="map-city city-a">Riverside</div><div className="map-city city-b">Northfield</div><div className="map-city city-c">Eastbank</div>
        {allPoints.map((p, idx) => { const lat = Number(p.lat) || 0, lng = Number(p.lng) || 0; const left = 12 + ((Math.abs(lng * 31 + idx * 17) % 76)); const top = 16 + ((Math.abs(lat * 19 + idx * 23) % 66)); return <button key={`${p.kind}-${p.id}`} onClick={() => { setSelectedMarker(p); setSelectedZoneId(p.kind === 'zone' ? p.id : ''); }} className={`map-pin ${p.tone}`} style={{ left: `${left}%`, top: `${top}%` }} title={`${p.kind}: ${p.title}`} aria-label={`${p.kind}: ${p.title}`} data-testid={`map-marker-${p.kind}-${p.id}`}><span/>{p.kind === 'incident' ? <Siren size={13}/> : p.kind === 'shelter' ? <Shield size={13}/> : p.kind === 'team' ? <Truck size={13}/> : <span className="zone-pin-core"/>}</button>; })}
        {selectedMarker && <div className="map-selection"><button className="icon-button" aria-label="Close map selection" onClick={() => { setSelectedMarker(null); setSelectedZoneId(''); }} data-testid="button-close-map-selection"><X size={14}/></button><span className="eyebrow">{selectedMarker.kind.toUpperCase()} · SIMULATED</span><b>{selectedMarker.title}</b><small>{Number(selectedMarker.lat).toFixed(4)}, {Number(selectedMarker.lng).toFixed(4)} · seeded coordinates, not live GPS</small>{selectedMarker.kind === 'zone' && (selectedRisk.data ? <div className="selection-risk">Risk {selectedRisk.data.score} / 100 · {selectedRisk.data.level} · CALCULATED</div> : selectedRisk.isLoading ? <small>Calculating zone risk…</small> : selectedRisk.isError ? <small>Risk assessment unavailable.</small> : null)}</div>}
        <div className="map-caption"><b>SCHEMATIC OPERATIONS VIEW</b><span>Coordinates shown are not live GPS · basemap illustrative</span></div><div className="map-scale"><span/> 5 km</div></div>
      <div className="map-bottom"><div className="map-legend"><span><i className="legend-dot red-dot"/> Incident</span><span><i className="legend-dot gold-dot"/> Affected zone</span><span><i className="legend-dot green-dot"/> Shelter</span><span><i className="legend-dot blue-dot"/> Rescue team</span></div><span className="map-freshness">SIMULATED / DEMO DATA</span></div>
      <Panel title="Layer controls" className="map-layers"><div className="layer-toggles">{Object.entries(layers).map(([key, enabled]) => <button key={key} className={`layer-toggle ${enabled ? 'layer-on' : ''}`} onClick={() => toggle(key as keyof typeof layers)} aria-pressed={enabled} data-testid={`toggle-layer-${key}`}><Layers size={15}/>{key[0].toUpperCase()+key.slice(1)}<span className="layer-count">{key === 'incidents' ? incidents.data?.length ?? 0 : key === 'zones' ? zones.data?.length ?? 0 : key === 'shelters' ? shelters.data?.length ?? 0 : teams.data?.length ?? 0}</span></button>)}</div></Panel>
    </section><aside className="map-side"><Panel title="Area analysis"><p className="side-copy">Select a searched location to analyze nearby resources and risk. Analysis uses a calculated radius, not a forecast.</p><label className="field-label">Radius<select value={radius} onChange={e => setRadius(e.target.value)} data-testid="select-analysis-radius">{['2','5','10','20'].map(v => <option key={v} value={v}>{v} km</option>)}</select></label><button className="button button-primary full-width" onClick={() => setArea(true)} data-testid="button-analyze-area"><Crosshair size={15}/> Analyze selected area</button>{selectedLocation && <div className="selected-place"><b>{selectedLocation.name}</b><small>{selectedLocation.lat.toFixed(4)}, {selectedLocation.lng.toFixed(4)}</small></div>}{area && <div className="analysis-result"><State loading={analysis.isLoading} error={analysis.isError} retry={refresh} empty={!analysis.data}><AnalysisSummary data={analysis.data}/></State></div>}</Panel><Panel title="Operational picture"><div className="map-stat"><span>Active incidents</span><b>{incidents.data?.filter((i: Incident) => i.status === 'ACTIVE').length ?? '—'}</b></div><div className="map-stat"><span>Affected zones</span><b>{zones.data?.length ?? '—'}</b></div><div className="map-stat"><span>Shelters available</span><b>{shelters.data?.filter((s: Shelter) => s.status === 'AVAILABLE').length ?? '—'}</b></div><div className="map-stat"><span>Teams on scene</span><b>{teams.data?.filter((t: any) => t.status === 'ON_SCENE').length ?? '—'}</b></div><div className="data-note"><AlertTriangle size={14}/> Location records may be seeded or stale.</div></Panel></aside></div>;
}
function AnalysisSummary({ data }: any) { if (!data) return null; return <><div className="analysis-heading"><Tag tone="amber">{data.classification}</Tag><Tag tone={data.riskLevel === 'CRITICAL' || data.riskLevel === 'HIGH' ? 'red' : 'amber'}>{data.riskLevel} RISK</Tag></div><div className="analysis-score"><strong>{data.riskScore}</strong><span>CALCULATED RISK<br/>0–100</span></div><div className="analysis-stat"><span>Population exposed</span><b>{fmt(data.estimatedPopulation)} <small>ESTIMATED</small></b></div><div className="analysis-stat"><span>Incidents in area</span><b>{data.incidents?.length ?? 0}</b></div><div className="analysis-stat"><span>Available shelter capacity</span><b>{fmt(data.shelterCapacityAvailable)}</b></div><div className="analysis-stat"><span>Rescue teams</span><b>{data.rescueTeams?.length ?? 0}</b></div>{data.resourceShortages?.length > 0 && <p className="shortage-note">Shortages: {data.resourceShortages.join(', ')}</p>}</>; }

const KADAPA_CENTER: [number, number] = [14.4673, 78.8242];
const mapIconCache = new Map<string, L.DivIcon>();

function mapIcon(kind: string, tone: string): L.DivIcon {
  const key = `${kind}:${tone}`;
  const cached = mapIconCache.get(key);
  if (cached) return cached;
  const icon = L.divIcon({
    className: 'sentinel-marker-icon',
    html: `<span class="sentinel-point ${tone} ${kind === 'zone' ? 'point-zone' : ''}" aria-hidden="true"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
  mapIconCache.set(key, icon);
  return icon;
}

function MapCamera({ command, location }: { command: { action: string; nonce: number }; location: any }) {
  const map = useMap();
  useEffect(() => {
    if (command.action === 'in') map.zoomIn();
    else if (command.action === 'out') map.zoomOut();
    else if (command.action === 'reset') map.setView(KADAPA_CENTER, 8);
  }, [command, map]);
  useEffect(() => {
    if (location) map.flyTo([location.lat, location.lng], Math.max(11, map.getZoom()), { duration: 0.6 });
  }, [location?.lat, location?.lng, map]);
  return null;
}

function MapClickHandler({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onSelect(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function MapPage({ incidents, zones, shelters, teams, refresh }: any) {
  const [layers, setLayers] = useState({ incidents: true, zones: true, shelters: true, teams: true });
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<any>(null);
  const [selectedMarker, setSelectedMarker] = useState<any>(null);
  const [selectedZoneId, setSelectedZoneId] = useState('');
  const [area, setArea] = useState(false);
  const [radius, setRadius] = useState('5');
  const [mapCommand, setMapCommand] = useState({ action: 'reset', nonce: 0 });
  const locQuery = useSearchLocations({ q: locationQuery }, { query: { enabled: locationQuery.trim().length >= 2, queryKey: getSearchLocationsQueryKey({ q: locationQuery }) } });
  const analysisParams = { lat: selectedLocation?.lat ?? KADAPA_CENTER[0], lng: selectedLocation?.lng ?? KADAPA_CENTER[1], radiusKm: Number(radius) || 5 };
  const analysis = useAnalyzeArea(analysisParams, { query: { enabled: area, queryKey: getAnalyzeAreaQueryKey(analysisParams) } });
  const selectedRisk = useGetZoneRisk(selectedZoneId, { query: { enabled: !!selectedZoneId, queryKey: getGetZoneRiskQueryKey(selectedZoneId) } });
  const toggle = (key: keyof typeof layers) => setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  const allPoints = [
    ...(layers.incidents ? (incidents.data || []).map((v: Incident) => ({ id: v.id, title: v.title, kind: 'incident', lat: v.lat, lng: v.lng, tone: v.severity === 'CRITICAL' ? 'pin-red' : v.severity === 'HIGH' ? 'pin-amber' : 'pin-blue', classification: v.classification, detail: `${v.severity} · ${v.priority} · ${v.location}` })) : []),
    ...(layers.zones ? (zones.data || []).map((v: AffectedZone) => ({ id: v.id, title: v.name, kind: 'zone', lat: v.lat, lng: v.lng, tone: 'pin-zone', classification: v.classification, detail: `${v.riskLevel} risk · score ${v.riskScore}` })) : []),
    ...(layers.shelters ? (shelters.data || []).map((v: Shelter) => ({ id: v.id, title: v.name, kind: 'shelter', lat: v.lat, lng: v.lng, tone: 'pin-green', classification: v.classification, detail: `${v.occupancy}/${v.capacity} occupants · ${v.status}` })) : []),
    ...(layers.teams ? (teams.data || []).map((v: any) => ({ id: v.id, title: v.name, kind: 'team', lat: v.lat, lng: v.lng, tone: 'pin-blue', classification: v.classification, detail: `${v.type} · ${v.status}` })) : []),
  ].filter((point: any) => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)));
  const selectCoordinates = (lat: number, lng: number) => {
    const location = { name: 'Selected map point', displayName: 'Selected from map · verify exact location', lat, lng };
    setSelectedLocation(location);
    setLocationQuery('');
    setArea(true);
  };
  return <div className="map-layout"><section className="map-workspace">
    <div className="map-toolbar"><label className="map-search"><Search size={16}/><input aria-label="Search map location" placeholder="Search location or address…" value={locationQuery} onChange={e => setLocationQuery(e.target.value)} data-testid="input-map-location"/></label>
      {(locQuery.data || []).length > 0 && <div className="location-results">{(locQuery.data || []).map((location: any, i: number) => <button key={`${location.name}-${i}`} onClick={() => { setSelectedLocation(location); setLocationQuery(location.name); setArea(true); }} data-testid={`button-location-result-${i}`}><Map size={14}/><span><b>{location.name}</b><small>{location.displayName}</small></span></button>)}</div>}
      <div className="map-controls"><button aria-label="Zoom in" onClick={() => setMapCommand(v => ({ action: 'in', nonce: v.nonce + 1 }))} data-testid="button-map-zoom-in"><Plus size={16}/></button><button aria-label="Zoom out" onClick={() => setMapCommand(v => ({ action: 'out', nonce: v.nonce + 1 }))} data-testid="button-map-zoom-out"><Minus size={16}/></button><button aria-label="Reset map view" onClick={() => { setSelectedLocation(null); setSelectedMarker(null); setSelectedZoneId(''); setLocationQuery(''); setArea(false); setMapCommand(v => ({ action: 'reset', nonce: v.nonce + 1 })); }} data-testid="button-map-reset"><Crosshair size={16}/></button></div>
    </div>
    <MapContainer center={KADAPA_CENTER} zoom={8} scrollWheelZoom className="map-frame" aria-label="Interactive operational map of Kadapa district">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
      <MapCamera command={mapCommand} location={selectedLocation}/>
      <MapClickHandler onSelect={selectCoordinates}/>
      {area && <Circle center={selectedLocation ? [selectedLocation.lat, selectedLocation.lng] : KADAPA_CENTER} radius={(Number(radius) || 5) * 1000} pathOptions={{ color: '#b98521', fillColor: '#d9b762', fillOpacity: 0.12, weight: 2, dashArray: '5 6' }}/>}
      {allPoints.map((point: any) => <Marker key={`${point.kind}-${point.id}`} position={[Number(point.lat), Number(point.lng)]} icon={mapIcon(point.kind, point.tone)} eventHandlers={{ click: () => { setSelectedMarker(point); setSelectedZoneId(point.kind === 'zone' ? point.id : ''); } }} title={`${point.kind}: ${point.title}`} data-testid={`map-marker-${point.kind}-${point.id}`}>
        <Popup><div className="map-popup"><b>{point.title}</b><span>{point.detail}</span><small>{Number(point.lat).toFixed(4)}, {Number(point.lng).toFixed(4)}</small><Tag tone={point.classification === 'SIMULATED' ? 'amber' : 'blue'}>{point.classification || 'UNCLASSIFIED'}</Tag>{point.kind === 'zone' && selectedMarker?.id === point.id && (selectedRisk.data ? <span className="selection-risk">Risk {selectedRisk.data.score}/100 · {selectedRisk.data.level}</span> : selectedRisk.isLoading ? <small>Calculating zone risk…</small> : selectedRisk.isError ? <small>Risk assessment unavailable.</small> : null)}</div></Popup>
      </Marker>)}
    </MapContainer>
    <div className="map-bottom"><div className="map-legend"><span><i className="legend-dot red-dot"/> Incident</span><span><i className="legend-dot gold-dot"/> Affected zone</span><span><i className="legend-dot green-dot"/> Shelter</span><span><i className="legend-dot blue-dot"/> Rescue team</span></div><span className="map-freshness">OpenStreetMap · data labels shown per record</span></div>
    <Panel title="Layer controls" className="map-layers"><div className="layer-toggles">{Object.entries(layers).map(([key, enabled]) => <button key={key} className={`layer-toggle ${enabled ? 'layer-on' : ''}`} onClick={() => toggle(key as keyof typeof layers)} aria-pressed={enabled} data-testid={`toggle-layer-${key}`}><Layers size={15}/>{key[0].toUpperCase()+key.slice(1)}<span className="layer-count">{key === 'incidents' ? incidents.data?.length ?? 0 : key === 'zones' ? zones.data?.length ?? 0 : key === 'shelters' ? shelters.data?.length ?? 0 : teams.data?.length ?? 0}</span></button>)}</div></Panel>
  </section><aside className="map-side">
    <Panel title="Area analysis"><p className="side-copy">Search for a place or click anywhere on the map. Risk and the coverage radius are calculated from available records, not an official forecast.</p><label className="field-label">Radius<select value={radius} onChange={e => setRadius(e.target.value)} data-testid="select-analysis-radius">{['2','5','10','20'].map(v => <option key={v} value={v}>{v} km</option>)}</select></label><button className="button button-primary full-width" onClick={() => setArea(true)} data-testid="button-analyze-area"><Crosshair size={15}/> Analyze selected area</button>
      {selectedLocation && <div className="selected-place"><b>{selectedLocation.name}</b><small>{selectedLocation.lat.toFixed(4)}, {selectedLocation.lng.toFixed(4)}</small></div>}
      {area && <div className="analysis-result"><State loading={analysis.isLoading} error={analysis.isError} retry={refresh} empty={!analysis.data}><AnalysisSummary data={analysis.data}/></State></div>}
    </Panel>
    <Panel title="Operational picture"><div className="map-stat"><span>Active incidents</span><b>{incidents.data?.filter((i: Incident) => i.status === 'ACTIVE').length ?? '—'}</b></div><div className="map-stat"><span>Affected zones</span><b>{zones.data?.length ?? '—'}</b></div><div className="map-stat"><span>Shelters available</span><b>{shelters.data?.filter((s: Shelter) => s.status === 'AVAILABLE').length ?? '—'}</b></div><div className="map-stat"><span>Teams on scene</span><b>{teams.data?.filter((t: any) => t.status === 'ON_SCENE').length ?? '—'}</b></div><div className="data-note"><AlertTriangle size={14}/> Coordinates represent records, not real-time GPS.</div></Panel>
  </aside></div>;
}

function IncidentDialog({ close, teams, refresh }: any) {
  const create = useCreateIncident();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('FLOOD');
  const [severity, setSeverity] = useState('MODERATE');
  const [status, setStatus] = useState('ACTIVE');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [population, setPopulation] = useState('');
  const [teamId, setTeamId] = useState('');
  const qc = useQueryClient();
  return <div className="modal-backdrop" role="presentation" onClick={close}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-incident-title" onClick={e => e.stopPropagation()}><div className="dialog-head"><div><span className="eyebrow">NEW OPERATIONAL RECORD</span><h2 id="create-incident-title">Report incident</h2></div><button className="icon-button" onClick={close} aria-label="Close form" data-testid="button-close-create-incident"><X size={17}/></button></div><div className="form-grid"><label className="span-two">Incident title<input autoFocus value={title} onChange={e => setTitle(e.target.value)} required data-testid="input-incident-title"/></label><label>Type<select value={type} onChange={e => setType(e.target.value)} data-testid="select-incident-type">{['FLOOD','CYCLONE','EARTHQUAKE','LANDSLIDE','FIRE','STORM','HEATWAVE','DROUGHT','INDUSTRIAL','OTHER'].map(v => <option key={v}>{v}</option>)}</select></label><label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)} data-testid="select-incident-severity">{['LOW','MODERATE','HIGH','CRITICAL'].map(v => <option key={v}>{v}</option>)}</select></label><label>Status<select value={status} onChange={e => setStatus(e.target.value)} data-testid="select-incident-status">{['ACTIVE','MONITORING','CONTAINED','RESOLVED'].map(v => <option key={v}>{v}</option>)}</select></label><label>Location<input value={location} onChange={e => setLocation(e.target.value)} required data-testid="input-incident-location"/></label><label>Latitude<input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} required data-testid="input-incident-lat"/></label><label>Longitude<input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} required data-testid="input-incident-lng"/></label><label>Population exposed<input type="number" min="0" value={population} onChange={e => setPopulation(e.target.value)} required data-testid="input-incident-population"/></label><label>Assign team<select value={teamId} onChange={e => setTeamId(e.target.value)} data-testid="select-incident-team"><option value="">Unassigned</option>{teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="span-two">Description<textarea value={description} onChange={e => setDescription(e.target.value)} data-testid="input-incident-description"/></label></div><p className="form-warning">This record will be marked according to server classification. Coordinates must be verified; seeded GPS is not live.</p><div className="form-actions"><button className="button button-outline" onClick={close} data-testid="button-cancel-create-incident">Cancel</button><button className="button button-primary" disabled={!title || !location || !lat || !lng || population === '' || create.isPending} onClick={() => create.mutate({ data: { title, type: type as any, severity: severity as any, status: status as any, description, location, lat: Number(lat), lng: Number(lng), estimatedPopulation: Number(population), assignedTeamId: teamId || null } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListIncidentsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); close(); }, onError: () => {} })} data-testid="button-submit-create-incident">{create.isPending ? 'Saving…' : 'Create incident'}</button></div>{create.isError && <Failure label="Incident could not be created. Check required data and retry." retry={() => {}}/>}</section></div>;
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function AuthGate() {
  const auth = useSentinelAuth();
  const client = useQueryClient();
  const [clearedMode, setClearedMode] = useState<any>(undefined);
  useEffect(() => {
    if (auth.loading) return;
    client.clear();
    setClearedMode(auth.mode);
  }, [auth.mode, auth.loading, client]);
  if (auth.loading || clearedMode !== auth.mode) {
    return <main className="auth-loading"><div className="brand-mark"><Crosshair size={19}/></div><span>Checking secure session…</span></main>;
  }
  if (!auth.mode) return <AuthScreen/>;
  return <RoutedErrorBoundary><Shell auth={auth}/></RoutedErrorBoundary>;
}
function Router() {
  return <AuthGate/>;
}
function App() {
  return <QueryClientProvider client={queryClient}><AuthProvider><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router/></WouterRouter><Toaster/></TooltipProvider></AuthProvider></QueryClientProvider>;
}
export default App;
