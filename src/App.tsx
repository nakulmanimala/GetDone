import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Archive,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Cloud,
  Inbox,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import './App.css'
import {
  addTask,
  completeTask,
  deleteTask,
  filterTasks,
  initialTasks,
  reopenTask,
  updateTask,
  type Task,
  type View,
} from './domain/tasks'
import { loadTasks, saveTasks } from './storage/taskStorage'
import { createApiClient } from './sync/apiClient'
import { SyncPanel } from './sync/SyncPanel'
import { applySyncOutcome, checkSync, describeSyncError } from './sync/syncActions'
import {
  isConfigured,
  setLastSyncedAt,
  setUpdatedAt as setSyncUpdatedAt,
  touchUpdatedAt,
} from './sync/syncMeta'
import { describeSyncStatus, type SyncStatus } from './sync/syncStatus'

const AUTO_SYNC_DEBOUNCE_MS = 3_000
const AUTO_SYNC_INTERVAL_MS = 5 * 60_000

const viewLabels: Record<View, string> = {
  inbox: 'Inbox',
  today: 'Today',
  upcoming: 'Upcoming',
  completed: 'Completed',
}

const viewIcons = { inbox: Inbox, today: CalendarDays, upcoming: Archive, completed: CheckCircle2 }
const projectColors: Record<string, string> = { Personal: '#a78bfa', DevOps: '#38bdf8', GetDone: '#34d399', Inbox: '#8a8f98' }

function formatDueDate(date?: string) {
  if (!date) return 'No due date'
  const today = new Date().toISOString().slice(0, 10)
  if (date === today) return 'Today'
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  if (date === tomorrow) return 'Tomorrow'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

function App() {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks(initialTasks))
  const [view, setView] = useState<View>('today')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: 'idle' })
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null)

  useEffect(() => saveTasks(tasks), [tasks])

  function applyLocalChange(next: Task[]) {
    setTasks(next)
    touchUpdatedAt()
  }

  const applyRemoteSnapshot = useCallback((next: Task[], remoteUpdatedAt: string) => {
    setTasks(next)
    setSyncUpdatedAt(remoteUpdatedAt)
    setLastSyncedAt(remoteUpdatedAt)
  }, [])

  // Auto backup: once unlocked, keeps running in the background even while
  // the sync panel is closed — cryptoKey lives here, not inside SyncPanel,
  // specifically so it survives the panel unmounting.
  const tasksRef = useRef(tasks)
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  const runAutoSync = useCallback(async () => {
    if (!cryptoKey) return
    setSyncStatus({ kind: 'working', label: 'Syncing…' })
    try {
      const outcome = await checkSync({ cryptoKey, api: createApiClient() }, tasksRef.current)
      setSyncStatus(applySyncOutcome(outcome, { onApplyRemoteSnapshot: applyRemoteSnapshot }))
    } catch (error) {
      setSyncStatus({ kind: 'error', message: describeSyncError(error) })
    }
  }, [cryptoKey, applyRemoteSnapshot])

  useEffect(() => {
    if (!cryptoKey) return
    const timer = setTimeout(runAutoSync, AUTO_SYNC_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // Debounced on every task change so rapid edits collapse into one sync.
  }, [cryptoKey, tasks, runAutoSync])

  useEffect(() => {
    if (!cryptoKey) return
    const interval = setInterval(runAutoSync, AUTO_SYNC_INTERVAL_MS)
    return () => clearInterval(interval)
    // Periodic re-check catches remote-only changes (e.g. another device),
    // deliberately not re-armed on every task edit — see tasksRef above.
  }, [cryptoKey, runAutoSync])

  const visibleTasks = useMemo(() => {
    const filtered = filterTasks(tasks, view)
    const normalizedQuery = query.trim().toLowerCase()
    return normalizedQuery
      ? filtered.filter((task) => `${task.title} ${task.project} ${task.note ?? ''}`.toLowerCase().includes(normalizedQuery))
      : filtered
  }, [query, tasks, view])

  const selected = tasks.find((task) => task.id === selectedId) ?? null
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const openCount = tasks.filter((task) => task.status === 'open').length
  const completedCount = tasks.filter((task) => task.status === 'completed').length
  const completion = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0

  function submitTask(event: FormEvent) {
    event.preventDefault()
    const next = addTask(tasks, draft)
    if (next !== tasks) {
      applyLocalChange(next)
      setDraft('')
      setView('inbox')
    }
  }

  function chooseView(nextView: View) {
    setView(nextView)
    setSelectedId(null)
    setSidebarOpen(false)
  }

  function openSyncPanel() {
    setSelectedId(null)
    setSyncPanelOpen(true)
    setSidebarOpen(false)
  }

  const syncConfigured = isConfigured()
  const syncStatusView = describeSyncStatus(syncStatus, syncConfigured)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Check size={17} strokeWidth={3} /></div>
          <div><strong>GetDone</strong><span>Your local workspace</span></div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={18} /></button>
        </div>

        <button className="quick-add" onClick={() => document.getElementById('quick-task')?.focus()}><Plus size={17} /> Add task <kbd>⌘ N</kbd></button>

        <nav className="nav-list" aria-label="Task views">
          {(Object.keys(viewLabels) as View[]).map((item) => {
            const Icon = viewIcons[item]
            const count = item === 'completed' ? completedCount : item === 'inbox' ? openCount : filterTasks(tasks, item).length
            return <button key={item} className={view === item ? 'active' : ''} onClick={() => chooseView(item)}><Icon size={17} /><span>{viewLabels[item]}</span><em>{count}</em></button>
          })}
        </nav>

        <div className="section-label">Projects <Plus size={14} /></div>
        <div className="project-list">
          {['Personal', 'DevOps', 'GetDone'].map((project) => <button key={project}><i style={{ background: projectColors[project] }} />{project}<span>{tasks.filter((task) => task.project === project && task.status === 'open').length}</span></button>)}
        </div>

        <div className="sidebar-footer">
          <div className="progress-card"><div><span>Weekly progress</span><strong>{completion}%</strong></div><div className="progress-track"><i style={{ width: `${completion}%` }} /></div><small>{completedCount} completed · {openCount} remaining</small></div>
          <button onClick={openSyncPanel}><Cloud size={16} /><span>S3 Backup</span><em>{syncConfigured ? 'Configured' : 'Not configured'}</em></button>
          <button><Settings size={16} /><span>Settings</span><ChevronRight size={14} /></button>
        </div>
      </aside>

      {sidebarOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="search-wrap"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks…" aria-label="Search tasks" /><kbd>⌘ K</kbd></div>
          <div className={`sync-status ${syncStatusView.className}`}><i />{syncStatusView.label}</div>
          <button className="avatar" aria-label="Account">NP</button>
        </header>

        <section className="content">
          <div className="page-heading">
            <div><p>{today}</p><h1>{viewLabels[view]}</h1><span>{visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'} in this view</span></div>
            <button className="focus-button"><Sparkles size={16} /> Focus mode</button>
          </div>

          <form className="task-composer" onSubmit={submitTask}>
            <div className="composer-plus"><Plus size={18} /></div>
            <input id="quick-task" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What needs to be done?" aria-label="New task title" />
            <button type="submit" disabled={!draft.trim()}>Add task</button>
          </form>

          <div className="task-list">
            {visibleTasks.map((task) => (
              <article key={task.id} className={`task-row ${selectedId === task.id ? 'selected' : ''}`} onClick={() => { setSelectedId(task.id); setSyncPanelOpen(false) }}>
                <button className={`complete-button priority-${task.priority}`} onClick={(event) => { event.stopPropagation(); applyLocalChange(task.status === 'completed' ? reopenTask(tasks, task.id) : completeTask(tasks, task.id)) }} aria-label={task.status === 'completed' ? `Reopen ${task.title}` : `Complete ${task.title}`}>
                  {task.status === 'completed' ? <Check size={14} /> : <Circle size={17} />}
                </button>
                <div className="task-copy"><h3 className={task.status === 'completed' ? 'done' : ''}>{task.title}</h3><div><span><i style={{ background: projectColors[task.project] ?? '#8a8f98' }} />{task.project}</span>{task.dueDate && <span className="due"><CalendarDays size={13} />{formatDueDate(task.dueDate)}</span>}{task.priority !== 'none' && <span className={`priority-label ${task.priority}`}>{task.priority}</span>}</div></div>
                <ChevronRight className="row-chevron" size={17} />
              </article>
            ))}
            {!visibleTasks.length && <div className="empty-state"><div><CheckCircle2 size={28} /></div><h2>You're all clear</h2><p>{query ? 'No tasks match your search.' : `There are no tasks in ${viewLabels[view].toLowerCase()}.`}</p></div>}
          </div>
        </section>
      </main>

      {selected && <aside className="detail-panel">
        <div className="detail-header"><span>Task details</span><button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Close task details"><X size={18} /></button></div>
        <div className="detail-body">
          <button className={`large-check priority-${selected.priority}`} onClick={() => applyLocalChange(selected.status === 'completed' ? reopenTask(tasks, selected.id) : completeTask(tasks, selected.id))}>{selected.status === 'completed' && <Check size={16} />}</button>
          <textarea className="title-editor" value={selected.title} onChange={(event) => applyLocalChange(updateTask(tasks, { ...selected, title: event.target.value }))} aria-label="Task title" />
          <label>Project<select value={selected.project} onChange={(event) => applyLocalChange(updateTask(tasks, { ...selected, project: event.target.value }))}>{['Inbox', 'Personal', 'DevOps', 'GetDone'].map((project) => <option key={project}>{project}</option>)}</select></label>
          <label>Due date<input type="date" value={selected.dueDate ?? ''} onChange={(event) => applyLocalChange(updateTask(tasks, { ...selected, dueDate: event.target.value || undefined }))} /></label>
          <label>Priority<select value={selected.priority} onChange={(event) => applyLocalChange(updateTask(tasks, { ...selected, priority: event.target.value as Task['priority'] }))}><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label>Notes<textarea className="note-editor" value={selected.note ?? ''} placeholder="Add notes…" onChange={(event) => applyLocalChange(updateTask(tasks, { ...selected, note: event.target.value }))} /></label>
        </div>
        <div className="detail-footer"><button className="delete-button" onClick={() => { applyLocalChange(deleteTask(tasks, selected.id)); setSelectedId(null) }}><Trash2 size={15} /> Delete task</button></div>
      </aside>}

      {syncPanelOpen && (
        <SyncPanel
          tasks={tasks}
          status={syncStatus}
          onStatusChange={setSyncStatus}
          onApplyRemoteSnapshot={applyRemoteSnapshot}
          cryptoKey={cryptoKey}
          onUnlock={setCryptoKey}
          onClose={() => setSyncPanelOpen(false)}
        />
      )}
    </div>
  )
}

export default App
