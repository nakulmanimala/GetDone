import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Cloud,
  Menu,
  Plus,
  Repeat as RepeatIcon,
  RotateCcw,
  Search,
  Settings,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import './App.css'
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog'
import { RichNoteEditor, stripHtml } from './components/richText'
import { TaskCreateModal } from './components/TaskCreateModal'
import {
  addImage,
  completeTask,
  createTask,
  deleteList,
  deleteTask,
  emptyTrash,
  initialTasks,
  moveTask,
  purgeTask,
  removeImage,
  reopenTask,
  restoreTask,
  updateTask,
  type Task,
  type TaskDraft,
} from './domain/tasks'
import { compressImageFile, findImageFile } from './media/clipboardImage'
import { loadProjects, loadTasks, saveProjects, saveTasks } from './storage/taskStorage'
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

const defaultProjects = ['Inbox', 'Personal', 'DevOps', 'GetDone']
const baseProjectColors: Record<string, string> = { Personal: '#a78bfa', DevOps: '#38bdf8', GetDone: '#34d399', Inbox: '#8a8f98' }
const projectPalette = ['#7170ff', '#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#fb7185']

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
  const [projects, setProjects] = useState<string[]>(() => {
    const stored = loadProjects(defaultProjects)
    const fromTasks = loadTasks(initialTasks).map((task) => task.project)
    return [...new Set([...stored, ...fromTasks])]
  })
  const [boardView, setBoardView] = useState<'all' | 'starred' | 'trash'>('all')
  const [hiddenLists, setHiddenLists] = useState<string[]>([])
  const [completedOpen, setCompletedOpen] = useState<Record<string, boolean>>({})
  const [newListOpen, setNewListOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerProject, setComposerProject] = useState<string | undefined>(undefined)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: 'idle' })
  const [syncConfigured, setSyncConfigured] = useState(isConfigured())
  const [storageFull, setStorageFull] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    setStorageFull(!saveTasks(tasks))
  }, [tasks])

  useEffect(() => {
    saveProjects(projects)
  }, [projects])

  const applyLocalChange = useCallback((next: Task[]) => {
    setTasks(next)
    touchUpdatedAt()
  }, [])

  const applyRemoteSnapshot = useCallback((next: Task[], remoteUpdatedAt: string) => {
    setTasks(next)
    setProjects((current) => [...new Set([...current, ...next.map((task) => task.project)])])
    setSyncUpdatedAt(remoteUpdatedAt)
    setLastSyncedAt(remoteUpdatedAt)
  }, [])

  // Auto backup: once configured, keeps running in the background even while
  // the sync panel is closed — syncConfigured lives here, not inside
  // SyncPanel, specifically so it survives the panel unmounting.
  const tasksRef = useRef(tasks)
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  // Paste an image straight onto the selected task. A window-level listener
  // (rather than onPaste on the panel) so it fires even when nothing inside
  // the panel is focused yet — the common "select task, then paste" flow.
  useEffect(() => {
    if (!selectedId) return
    const targetId = selectedId

    function handlePaste(event: ClipboardEvent) {
      const file = findImageFile(event.clipboardData?.items)
      if (!file) return
      event.preventDefault()
      compressImageFile(file)
        .then((dataUrl) => applyLocalChange(addImage(tasksRef.current, targetId, dataUrl)))
        .catch(() => {})
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [selectedId, applyLocalChange])

  const runAutoSync = useCallback(async () => {
    if (!syncConfigured) return
    setSyncStatus({ kind: 'working', label: 'Syncing…' })
    try {
      const outcome = await checkSync({ api: createApiClient() }, tasksRef.current)
      setSyncStatus(applySyncOutcome(outcome, { onApplyRemoteSnapshot: applyRemoteSnapshot }))
    } catch (error) {
      setSyncStatus({ kind: 'error', message: describeSyncError(error) })
    }
  }, [syncConfigured, applyRemoteSnapshot])

  useEffect(() => {
    if (!syncConfigured) return
    const timer = setTimeout(runAutoSync, AUTO_SYNC_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // Debounced on every task change so rapid edits collapse into one sync.
  }, [syncConfigured, tasks, runAutoSync])

  useEffect(() => {
    if (!syncConfigured) return
    const interval = setInterval(runAutoSync, AUTO_SYNC_INTERVAL_MS)
    return () => clearInterval(interval)
    // Periodic re-check catches remote-only changes (e.g. another device),
    // deliberately not re-armed on every task edit — see tasksRef above.
  }, [syncConfigured, runAutoSync])

  const matchesQuery = useCallback(
    (task: Task) => {
      const normalized = query.trim().toLowerCase()
      if (!normalized) return true
      return `${task.title} ${task.project} ${stripHtml(task.note ?? '')}`.toLowerCase().includes(normalized)
    },
    [query],
  )

  const boardColumns = useMemo(() => {
    const live = tasks.filter((task) => !task.deletedAt && matchesQuery(task))
    if (boardView === 'starred') {
      const starred = live.filter((task) => task.flagged)
      return [{
        name: 'Starred',
        open: starred.filter((task) => task.status === 'open'),
        completed: starred.filter((task) => task.status === 'completed'),
      }]
    }
    return projects
      .filter((project) => !hiddenLists.includes(project))
      .map((project) => {
        const inProject = live.filter((task) => task.project === project)
        return {
          name: project,
          open: inProject.filter((task) => task.status === 'open'),
          completed: inProject.filter((task) => task.status === 'completed'),
        }
      })
  }, [boardView, hiddenLists, matchesQuery, projects, tasks])

  const trashedTasks = useMemo(
    () => tasks.filter((task) => Boolean(task.deletedAt) && matchesQuery(task)),
    [matchesQuery, tasks],
  )

  const selected = tasks.find((task) => task.id === selectedId && !task.deletedAt) ?? null
  const liveTasks = tasks.filter((task) => !task.deletedAt)
  const openCount = liveTasks.filter((task) => task.status === 'open').length
  const completedCount = liveTasks.filter((task) => task.status === 'completed').length
  const starredCount = liveTasks.filter((task) => task.flagged && task.status === 'open').length
  const trashCount = tasks.length - liveTasks.length
  const completion = liveTasks.length ? Math.round((completedCount / liveTasks.length) * 100) : 0

  const projectColor = useCallback(
    (project: string) => baseProjectColors[project] ?? projectPalette[Math.max(0, projects.indexOf(project)) % projectPalette.length],
    [projects],
  )

  function openComposer(project?: string) {
    setComposerProject(project)
    setComposerOpen(true)
    setSidebarOpen(false)
  }

  function handleCreateTask(taskDraft: TaskDraft) {
    applyLocalChange(createTask(tasks, taskDraft))
    setComposerOpen(false)
    if (taskDraft.project) {
      // Surface the task right away even if its list was unchecked.
      setHiddenLists((hidden) => hidden.filter((name) => name !== taskDraft.project))
    }
  }

  function toggleList(project: string) {
    setHiddenLists((hidden) => (hidden.includes(project) ? hidden.filter((name) => name !== project) : [...hidden, project]))
  }

  function submitNewList(event: FormEvent) {
    event.preventDefault()
    const name = newListName.trim()
    if (name && !projects.includes(name)) setProjects([...projects, name])
    setNewListName('')
    setNewListOpen(false)
  }

  function toggleStar(task: Task) {
    applyLocalChange(updateTask(tasks, { ...task, flagged: !task.flagged || undefined }))
  }

  function trashTask(task: Task) {
    applyLocalChange(deleteTask(tasks, task.id))
    if (selectedId === task.id) setSelectedId(null)
  }

  // Confirmed actions run against tasksRef.current, not the tasks closure:
  // unlike window.confirm, the dialog doesn't block, so a background sync can
  // land while it is open.
  function handleDeleteList(project: string) {
    setConfirmRequest({
      title: `Delete "${project}"?`,
      message: 'Tasks in this list, including any in the bin, will move to Inbox.',
      confirmLabel: 'Delete list',
      action: () => {
        applyLocalChange(deleteList(tasksRef.current, project))
        setProjects((current) => current.filter((name) => name !== project))
        setHiddenLists((hidden) => hidden.filter((name) => name !== project))
      },
    })
  }

  function handleEmptyTrash() {
    setConfirmRequest({
      title: 'Empty the bin?',
      message: `${trashCount === 1 ? 'The task' : `All ${trashCount} tasks`} in the bin will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true,
      action: () => applyLocalChange(emptyTrash(tasksRef.current)),
    })
  }

  function handlePurgeTask(task: Task) {
    setConfirmRequest({
      title: 'Delete forever?',
      message: `"${task.title}" will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true,
      action: () => applyLocalChange(purgeTask(tasksRef.current, task.id)),
    })
  }

  function toggleComplete(task: Task) {
    applyLocalChange(task.status === 'completed' ? reopenTask(tasks, task.id) : completeTask(tasks, task.id))
  }

  function handleColumnDragOver(event: DragEvent, project: string) {
    // draggingId can lag one render behind the dragstart, so also accept the
    // payload type our rows set; external drags (files, images) carry neither.
    if (!draggingId && !event.dataTransfer.types.includes('text/plain')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(project)
  }

  function handleColumnDragLeave(event: DragEvent, project: string) {
    // dragleave also fires when entering a child of the column; only clear
    // the highlight when the pointer truly left the column.
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setDropTarget((current) => (current === project ? null : current))
  }

  function handleColumnDrop(event: DragEvent, project: string) {
    event.preventDefault()
    const id = event.dataTransfer.getData('text/plain') || draggingId
    if (id) applyLocalChange(moveTask(tasks, id, project))
    setDraggingId(null)
    setDropTarget(null)
  }

  function chooseBoardView(next: 'all' | 'starred' | 'trash') {
    setBoardView(next)
    setSelectedId(null)
    setSidebarOpen(false)
  }

  function openSyncPanel() {
    setSelectedId(null)
    setSyncPanelOpen(true)
    setSidebarOpen(false)
  }

  const syncStatusView = describeSyncStatus(syncStatus, syncConfigured)

  const renderRow = (task: Task) => (
    <article
      key={task.id}
      className={`board-row ${selectedId === task.id ? 'selected' : ''} ${draggingId === task.id ? 'dragging' : ''}`}
      draggable={boardView === 'all'}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        setDraggingId(task.id)
      }}
      onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
      onClick={() => { setSelectedId(task.id); setSyncPanelOpen(false) }}>
      <button className={`complete-button priority-${task.priority}`} onClick={(event) => { event.stopPropagation(); toggleComplete(task) }} aria-label={task.status === 'completed' ? `Reopen ${task.title}` : `Complete ${task.title}`}>
        {task.status === 'completed' ? <Check size={14} /> : <Circle size={16} />}
      </button>
      <div className="board-copy">
        <h4 className={task.status === 'completed' ? 'done' : ''}>{task.title}</h4>
        {task.note && <p>{stripHtml(task.note)}</p>}
        {(task.dueDate || task.repeat || task.reminderAt || task.priority !== 'none') && (
          <div className="board-chips">
            {task.dueDate && <span className="due-chip">{formatDueDate(task.dueDate)}</span>}
            {task.repeat && <span className="due-chip"><RepeatIcon size={11} /></span>}
            {task.reminderAt && <span className="due-chip"><Bell size={11} /></span>}
            {task.priority !== 'none' && <span className={`priority-label ${task.priority}`}>{task.priority}</span>}
          </div>
        )}
      </div>
      <button
        className="row-delete"
        onClick={(event) => { event.stopPropagation(); trashTask(task) }}
        aria-label={`Move ${task.title} to the bin`}
      >
        <Trash2 size={14} />
      </button>
      <button
        className={`star-button ${task.flagged ? 'starred' : ''}`}
        onClick={(event) => { event.stopPropagation(); toggleStar(task) }}
        aria-label={task.flagged ? `Unstar ${task.title}` : `Star ${task.title}`}
      >
        <Star size={15} />
      </button>
    </article>
  )

  const renderTrashRow = (task: Task) => (
    <article key={task.id} className="board-row trash-row">
      <div className="board-copy">
        <h4>{task.title}</h4>
        <p>{task.project} · deleted {formatDueDate(task.deletedAt?.slice(0, 10)).toLowerCase()}</p>
      </div>
      <button className="row-restore" onClick={() => applyLocalChange(restoreTask(tasks, task.id))} aria-label={`Restore ${task.title}`}>
        <RotateCcw size={14} />
      </button>
      <button
        className="row-delete row-purge"
        onClick={() => handlePurgeTask(task)}
        aria-label={`Permanently delete ${task.title}`}
      >
        <Trash2 size={14} />
      </button>
    </article>
  )

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Check size={17} strokeWidth={3} /></div>
          <div><strong>GetDone</strong><span>Your local workspace</span></div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={18} /></button>
        </div>

        <button className="create-button" onClick={() => openComposer()}><Plus size={17} /> Create</button>

        <nav className="nav-list" aria-label="Task views">
          <button className={boardView === 'all' ? 'active' : ''} onClick={() => chooseBoardView('all')}><CheckCircle2 size={17} /><span>All tasks</span><em>{openCount}</em></button>
          <button className={boardView === 'starred' ? 'active' : ''} onClick={() => chooseBoardView('starred')}><Star size={17} /><span>Starred</span><em>{starredCount}</em></button>
          <button className={boardView === 'trash' ? 'active' : ''} onClick={() => chooseBoardView('trash')}><Trash2 size={17} /><span>Bin</span><em>{trashCount}</em></button>
        </nav>

        <div className="section-label">Lists</div>
        <div className="project-list">
          {projects.map((project) => (
            <label key={project} className="list-row">
              <input type="checkbox" checked={!hiddenLists.includes(project)} onChange={() => toggleList(project)} aria-label={`Show ${project}`} />
              <i style={{ background: projectColor(project) }} />
              <span>{project}</span>
              {project !== 'Inbox' && (
                <button
                  className="list-delete"
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleDeleteList(project) }}
                  aria-label={`Delete list ${project}`}
                >
                  <Trash2 size={13} />
                </button>
              )}
              <em>{liveTasks.filter((task) => task.project === project && task.status === 'open').length}</em>
            </label>
          ))}
          {newListOpen ? (
            <form className="new-list-form" onSubmit={submitNewList}>
              <input
                autoFocus
                value={newListName}
                onChange={(event) => setNewListName(event.target.value)}
                onBlur={submitNewList}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitNewList(event)
                  if (event.key === 'Escape') { setNewListName(''); setNewListOpen(false) }
                }}
                placeholder="List name"
                aria-label="New list name"
              />
            </form>
          ) : (
            <button className="new-list" onClick={() => setNewListOpen(true)}><Plus size={15} /> Create new list</button>
          )}
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
          {storageFull && (
            <div className="storage-warning">
              Local storage is full — new changes (including images) may not be saved. Remove some images to free up space.
            </div>
          )}

          <div className="board">
            {boardView === 'trash' && (
              <div className="board-column">
                <div className="column-head">
                  <h2>Recycle bin</h2>
                  {trashedTasks.length > 0 && <button className="empty-trash" onClick={handleEmptyTrash}>Empty bin</button>}
                </div>
                <div className="column-tasks">
                  {trashedTasks.map(renderTrashRow)}
                  {!trashedTasks.length && (
                    <div className="board-empty">
                      <Trash2 size={22} />
                      <strong>Bin is empty</strong>
                      <p>Deleted tasks land here and can be restored.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            {boardView !== 'trash' && boardColumns.map((column) => (
              <div
                className={`board-column ${dropTarget === column.name && boardView === 'all' ? 'drop-target' : ''}`}
                key={column.name}
                onDragOver={boardView === 'all' ? (event) => handleColumnDragOver(event, column.name) : undefined}
                onDragLeave={boardView === 'all' ? (event) => handleColumnDragLeave(event, column.name) : undefined}
                onDrop={boardView === 'all' ? (event) => handleColumnDrop(event, column.name) : undefined}
              >
                <div className="column-head">
                  <h2>{column.name}</h2>
                  {boardView === 'all' && column.name !== 'Inbox' && (
                    <button className="column-delete" onClick={() => handleDeleteList(column.name)} aria-label={`Delete list ${column.name}`}>
                      <Trash2 size={14} />
                    </button>
                  )}
                  {boardView === 'all' && <span className="column-dot" style={{ background: projectColor(column.name) }} />}
                  {boardView === 'starred' && <Star size={14} className="column-star" />}
                </div>

                {boardView === 'all' && (
                  <button className="column-add" onClick={() => openComposer(column.name)}><Plus size={16} /> Add a task</button>
                )}

                <div className="column-tasks">
                  {column.open.map(renderRow)}
                  {!column.open.length && !column.completed.length && (
                    <div className="board-empty">
                      <CheckCircle2 size={22} />
                      <strong>No tasks yet</strong>
                      <p>{boardView === 'starred' ? 'Star a task to pin it here.' : 'Add your to-dos and keep track of them here.'}</p>
                    </div>
                  )}
                </div>

                {column.completed.length > 0 && (
                  <div className="board-completed">
                    <button
                      className="completed-toggle"
                      aria-expanded={completedOpen[column.name] ?? false}
                      onClick={() => setCompletedOpen((open) => ({ ...open, [column.name]: !open[column.name] }))}
                    >
                      <ChevronRight size={14} className={completedOpen[column.name] ? 'rotated' : ''} />
                      Completed ({column.completed.length})
                    </button>
                    {(completedOpen[column.name] ?? false) && column.completed.map(renderRow)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>

      {selected && <aside className="detail-panel">
        <div className="detail-header"><span>Task details</span><button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Close task details"><X size={18} /></button></div>
        <div className="detail-body">
          <button className={`large-check priority-${selected.priority}`} onClick={() => toggleComplete(selected)}>{selected.status === 'completed' && <Check size={16} />}</button>
          <textarea className="title-editor" value={selected.title} onChange={(event) => applyLocalChange(updateTask(tasks, { ...selected, title: event.target.value }))} aria-label="Task title" />
          <label>Project<select value={selected.project} onChange={(event) => applyLocalChange(updateTask(tasks, { ...selected, project: event.target.value }))}>{projects.map((project) => <option key={project}>{project}</option>)}</select></label>
          <label>Due date<input type="date" value={selected.dueDate ?? ''} onChange={(event) => applyLocalChange(updateTask(tasks, { ...selected, dueDate: event.target.value || undefined }))} /></label>
          <label>Priority<select value={selected.priority} onChange={(event) => applyLocalChange(updateTask(tasks, { ...selected, priority: event.target.value as Task['priority'] }))}><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label>Notes<RichNoteEditor key={selected.id} initialHtml={selected.note ?? ''} placeholder="Add notes…" ariaLabel="Task notes" onChange={(html) => applyLocalChange(updateTask(tasks, { ...selected, note: html || undefined }))} /></label>

          <div className="image-section">
            <div className="image-section-label">Images{selected.images?.length ? <span>{selected.images.length}</span> : null}</div>
            {selected.images?.length ? (
              <div className="image-grid">
                {selected.images.map((image) => (
                  <div key={image.id} className="image-thumb">
                    <img src={image.dataUrl} alt="" onClick={() => setLightboxImage(image.dataUrl)} />
                    <button className="image-remove" onClick={() => applyLocalChange(removeImage(tasks, selected.id, image.id))} aria-label="Remove image"><X size={12} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="sync-hint">Paste an image (⌘V) to attach it here.</p>
            )}
          </div>
        </div>
        <div className="detail-footer"><button className="delete-button" onClick={() => trashTask(selected)}><Trash2 size={15} /> Move to bin</button></div>
      </aside>}

      {composerOpen && (
        <TaskCreateModal
          initialTitle=""
          initialProject={composerProject}
          projects={projects}
          onCancel={() => setComposerOpen(false)}
          onCreate={handleCreateTask}
        />
      )}

      {confirmRequest && (
        <ConfirmDialog
          request={confirmRequest}
          onConfirm={() => { confirmRequest.action(); setConfirmRequest(null) }}
          onCancel={() => setConfirmRequest(null)}
        />
      )}

      {syncPanelOpen && (
        <SyncPanel
          tasks={tasks}
          status={syncStatus}
          onStatusChange={setSyncStatus}
          onApplyRemoteSnapshot={applyRemoteSnapshot}
          onConfigured={() => setSyncConfigured(true)}
          onClose={() => setSyncPanelOpen(false)}
        />
      )}

      {lightboxImage && (
        <button className="lightbox" aria-label="Close image preview" onClick={() => setLightboxImage(null)}>
          <img src={lightboxImage} alt="" />
        </button>
      )}
    </div>
  )
}

export default App
