import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import {
  AlignLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronUp,
  Circle,
  Cloud,
  LogOut,
  Menu,
  Plus,
  Repeat as RepeatIcon,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import './App.css'
import { SignInScreen } from './auth/SignInScreen'
import {
  fetchSession,
  signOut,
  takeAuthError,
  type SessionInfo,
  type SessionUser,
} from './auth/session'
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog'
import { DetailsField } from './components/DetailsField'
import { DueControls } from './components/DueControls'
import { TaskComposer } from './components/TaskComposer'
import { formatDue, isOverdue } from './domain/dueDate'
import { htmlToText, notePreview } from './domain/notes'
import {
  addImage,
  completeTask,
  createTask,
  deleteList,
  deleteTask,
  emptyTrash,
  initialTasks,
  migrateLegacyNotes,
  moveTask,
  purgeTask,
  removeImage,
  reopenTask,
  reorderTask,
  restoreTask,
  updateTask,
  type Task,
  type TaskDraft,
} from './domain/tasks'
import { compressImageFile, findImageFile } from './media/clipboardImage'
import { claimPreAccountTasks, loadProjects, loadTasks, saveProjects, saveTasks } from './storage/taskStorage'
import { createApiClient } from './sync/apiClient'
import { SyncPanel } from './sync/SyncPanel'
import { applySyncOutcome, checkSync, describeSyncError } from './sync/syncActions'
import {
  isConfigured,
  setLastSyncedAt,
  setSyncScope,
  setUpdatedAt as setSyncUpdatedAt,
  touchUpdatedAt,
} from './sync/syncMeta'
import { describeSyncStatus, type SyncStatus } from './sync/syncStatus'

const AUTO_SYNC_DEBOUNCE_MS = 3_000
const AUTO_SYNC_INTERVAL_MS = 5 * 60_000

const defaultProjects = ['Inbox', 'Personal', 'DevOps', 'GetDone']
const baseProjectColors: Record<string, string> = { Personal: '#a78bfa', DevOps: '#38bdf8', GetDone: '#34d399', Inbox: '#8a8f98' }
const projectPalette = ['#7170ff', '#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#fb7185']

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Details are seeded from the stored note once per task (legacy notes may be
// HTML) and then owned locally, so typing never fights the round-trip through
// the task list.
function TaskDetails({ note, onChange }: { note?: string; onChange: (text: string) => void }) {
  const [text, setText] = useState(() => htmlToText(note ?? ''))
  return (
    <DetailsField
      value={text}
      ariaLabel="Task details"
      onChange={(next) => {
        setText(next)
        onChange(next)
      }}
    />
  )
}

// The signed-in workspace. Mounted with key={user.sub} so switching accounts
// tears down every piece of in-memory state rather than leaking one person's
// tasks, selection, or sync status into the next person's session.
function Workspace({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const [tasks, setTasks] = useState<Task[]>(() => migrateLegacyNotes(loadTasks(user.sub, initialTasks)))
  const [projects, setProjects] = useState<string[]>(() => {
    const stored = loadProjects(user.sub, defaultProjects)
    const fromTasks = loadTasks(user.sub, initialTasks).map((task) => task.project)
    return [...new Set([...stored, ...fromTasks])]
  })
  const [boardView, setBoardView] = useState<'all' | 'starred' | 'trash'>('all')
  const [hiddenLists, setHiddenLists] = useState<string[]>([])
  const [completedOpen, setCompletedOpen] = useState<Record<string, boolean>>({})
  const [newListOpen, setNewListOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Which column is currently showing the inline composer, if any.
  const [composerProject, setComposerProject] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [rowDrop, setRowDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  // openId lags selectedId by one frame so the reveal transitions from 0fr;
  // closingId keeps a collapsing card's body mounted while it shrinks.
  const [openId, setOpenId] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const expandedCardRef = useRef<HTMLElement | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: 'idle' })
  // Backup no longer needs per-browser setup: being signed in is the whole
  // configuration, since the server holds the credentials and the object key.
  const syncConfigured = isConfigured()
  const [storageFull, setStorageFull] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    setStorageFull(!saveTasks(user.sub, tasks))
  }, [user.sub, tasks])

  useEffect(() => {
    saveProjects(user.sub, projects)
  }, [user.sub, projects])

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
    // The composer captures its own pastes into the task being drafted.
    if (!selectedId || composerProject) return
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
  }, [selectedId, composerProject, applyLocalChange])

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

  // Change selection only through this helper: marking the outgoing card as
  // "closing" in the same batched update keeps its reveal mounted at full
  // height, so the shrink transition has a starting point.
  const selectTask = useCallback((next: string | null) => {
    setSelectedId((previous) => {
      if (previous && previous !== next) setClosingId(previous)
      return next
    })
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setOpenId(null)
      return
    }
    const frame = requestAnimationFrame(() => setOpenId(selectedId))
    return () => cancelAnimationFrame(frame)
  }, [selectedId])

  // Safety net: unmount the closing body even if transitionend never fires.
  useEffect(() => {
    if (!closingId) return
    const timer = setTimeout(() => setClosingId(null), 450)
    return () => clearTimeout(timer)
  }, [closingId])

  // Google Tasks behavior: clicking anywhere outside the expanded card
  // collapses it. Overlays (confirm dialog, lightbox, sync panel) don't count
  // as "outside".
  useEffect(() => {
    if (!selectedId) return
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element | null
      if (!target) return
      if (expandedCardRef.current?.contains(target)) return
      // .due-popover is portalled to the body, so it is "outside" by DOM
      // position while belonging to the card being edited.
      if (target.closest('.modal-overlay, .detail-panel, .lightbox, .due-popover')) return
      // Another task row handles its own click (switching the expansion to
      // itself); collapsing here would shift the layout before that click
      // lands and swallow it.
      if (target.closest('.board-row')) return
      selectTask(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [selectedId])

  const matchesQuery = useCallback(
    (task: Task) => {
      const normalized = query.trim().toLowerCase()
      if (!normalized) return true
      return `${task.title} ${task.project} ${notePreview(task.note)}`.toLowerCase().includes(normalized)
    },
    [query],
  )

  const visibleProjects = useMemo(
    () => projects.filter((project) => !hiddenLists.includes(project)),
    [hiddenLists, projects],
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
    return visibleProjects.map((project) => {
      const inProject = live.filter((task) => task.project === project)
      return {
        name: project,
        open: inProject.filter((task) => task.status === 'open'),
        completed: inProject.filter((task) => task.status === 'completed'),
      }
    })
  }, [boardView, matchesQuery, tasks, visibleProjects])

  const trashedTasks = useMemo(
    () => tasks.filter((task) => Boolean(task.deletedAt) && matchesQuery(task)),
    [matchesQuery, tasks],
  )

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

  function openComposer(project: string) {
    selectTask(null) // only one card is ever in edit mode
    setBoardView('all') // the composer lives in a list column
    setComposerProject(project)
    setHiddenLists((hidden) => hidden.filter((name) => name !== project))
    setSidebarOpen(false)
  }

  // The composer stays open after Enter, so this can fire repeatedly; it reads
  // tasksRef rather than the render-time list to keep rapid entries in order.
  function handleCreateTask(taskDraft: TaskDraft) {
    applyLocalChange(createTask(tasksRef.current, taskDraft))
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
        setComposerProject((current) => (current === project ? null : current))
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
    setRowDrop(null)
  }

  function handleRowDragOver(event: DragEvent, task: Task) {
    if (!draggingId && !event.dataTransfer.types.includes('text/plain')) return
    if (draggingId === task.id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const edge: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setRowDrop((current) => (current?.id === task.id && current.edge === edge ? current : { id: task.id, edge }))
  }

  function handleRowDrop(event: DragEvent, task: Task) {
    event.preventDefault()
    event.stopPropagation() // the column's own drop handler must not also fire
    const id = event.dataTransfer.getData('text/plain') || draggingId
    const edge = rowDrop?.id === task.id ? rowDrop.edge : 'before'
    if (id && id !== task.id) applyLocalChange(reorderTask(tasks, id, task.id, edge))
    setDraggingId(null)
    setDropTarget(null)
    setRowDrop(null)
  }

  function chooseBoardView(next: 'all' | 'starred' | 'trash') {
    setBoardView(next)
    selectTask(null)
    setComposerProject(null)
    setSidebarOpen(false)
  }

  function openSyncPanel() {
    selectTask(null)
    setComposerProject(null)
    setSyncPanelOpen(true)
    setSidebarOpen(false)
  }

  const syncStatusView = describeSyncStatus(syncStatus, syncConfigured)

  // Google Tasks-style in-place editing: the expanded row grows into a full
  // inline editor inside the column; every field saves as it changes. The
  // editor body sits in a grid-rows reveal so expand/collapse animates
  // smoothly — a collapsing card stays mounted (closingId) until its
  // shrink transition finishes.
  const renderRow = (task: Task) => {
    const isExpanded = selectedId === task.id && boardView !== 'trash'
    const showBody = isExpanded || closingId === task.id
    const patch = (changes: Partial<Task>) => applyLocalChange(updateTask(tasks, { ...task, ...changes }))
    return (
      <article
        key={task.id}
        ref={isExpanded ? (element) => { expandedCardRef.current = element } : undefined}
        className={`board-row ${isExpanded ? 'board-editor' : ''} ${isExpanded && openId === task.id ? 'open' : ''} ${draggingId === task.id ? 'dragging' : ''} ${rowDrop?.id === task.id ? (rowDrop.edge === 'before' ? 'drop-above' : 'drop-below') : ''}`}
        draggable={boardView === 'all' && !isExpanded}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', task.id)
          event.dataTransfer.effectAllowed = 'move'
          setDraggingId(task.id)
        }}
        onDragEnd={() => { setDraggingId(null); setDropTarget(null); setRowDrop(null) }}
        onDragOver={boardView === 'all' && !isExpanded ? (event) => handleRowDragOver(event, task) : undefined}
        onDragLeave={() => setRowDrop((current) => (current?.id === task.id ? null : current))}
        onDrop={boardView === 'all' && !isExpanded ? (event) => handleRowDrop(event, task) : undefined}
      >
        {isExpanded ? (
          <div className="editor-head">
            <button className="complete-button" onClick={() => toggleComplete(task)} aria-label={task.status === 'completed' ? `Reopen ${task.title}` : `Complete ${task.title}`}>
              {task.status === 'completed' ? <Check size={14} /> : <Circle size={16} />}
            </button>
            <input
              className="editor-title"
              value={task.title}
              onChange={(event) => patch({ title: event.target.value })}
              aria-label="Task title"
            />
            <button className="row-delete" onClick={() => trashTask(task)} aria-label={`Move ${task.title} to the bin`}><Trash2 size={14} /></button>
            <button
              className={`star-button ${task.flagged ? 'starred' : ''}`}
              onClick={() => toggleStar(task)}
              aria-label={task.flagged ? `Unstar ${task.title}` : `Star ${task.title}`}
            >
              <Star size={15} />
            </button>
            <button className="star-button" onClick={() => selectTask(null)} aria-label="Collapse task"><ChevronUp size={16} /></button>
          </div>
        ) : (
          <div className="row-main" onClick={() => { selectTask(task.id); setSyncPanelOpen(false) }}>
            <button className="complete-button" onClick={(event) => { event.stopPropagation(); toggleComplete(task) }} aria-label={task.status === 'completed' ? `Reopen ${task.title}` : `Complete ${task.title}`}>
              {task.status === 'completed' ? <Check size={14} /> : <Circle size={16} />}
            </button>
            <div className="board-copy">
              <h4 className={task.status === 'completed' ? 'done' : ''}>{task.title}</h4>
              {task.note && <p>{notePreview(task.note)}</p>}
              {(task.dueDate || task.repeat) && (
                <div className="board-chips">
                  {task.dueDate && (
                    <span className={`due-chip ${isOverdue(task.dueDate, task.dueTime) ? 'overdue' : ''}`}>
                      {formatDue(task.dueDate, task.dueTime)}
                    </span>
                  )}
                  {/* aria-label, not title: a title would raise the browser's
                      own unthemed tooltip on hover. */}
                  {task.repeat && <span className="due-chip" aria-label={`Repeats ${task.repeat}`}><RepeatIcon size={11} /></span>}
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
          </div>
        )}

        {showBody && (
          <div
            className="editor-reveal"
            onTransitionEnd={(event) => {
              // Child transitions bubble here too; only the reveal's own
              // grid-rows transition should unmount the closing body.
              if (event.target === event.currentTarget) setClosingId((current) => (current === task.id ? null : current))
            }}
          >
            <div className="editor-reveal-inner">
              <div className="editor-body">
                <div className="editor-details-row">
                  <AlignLeft size={15} className="composer-icon" aria-hidden="true" />
                  <TaskDetails key={task.id} note={task.note} onChange={(text) => patch({ note: text || undefined })} />
                </div>

                {task.images?.length ? (
                  <div className="image-grid">
                    {task.images.map((image) => (
                      <div key={image.id} className="image-thumb">
                        <img src={image.dataUrl} alt="" onClick={() => setLightboxImage(image.dataUrl)} />
                        <button className="image-remove" onClick={() => applyLocalChange(removeImage(tasks, task.id, image.id))} aria-label="Remove image"><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="paste-hint">Paste an image (⌘V) to attach it.</p>
                )}

                <DueControls
                  value={{ dueDate: task.dueDate, dueTime: task.dueTime, repeat: task.repeat }}
                  onChange={(next) => patch(next)}
                />
              </div>
            </div>
          </div>
        )}
      </article>
    )
  }

  const renderTrashRow = (task: Task) => (
    <article key={task.id} className="board-row trash-row">
      <div className="board-copy">
        <h4>{task.title}</h4>
        <p>{task.project} · deleted {formatDue(task.deletedAt?.slice(0, 10)).toLowerCase()}</p>
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

        <button className="create-button" onClick={() => openComposer(visibleProjects[0] ?? 'Inbox')}><Plus size={17} /> Create</button>

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
          <button onClick={openSyncPanel}><Cloud size={16} /><span>S3 Backup</span><em>{syncConfigured ? 'On' : 'Off'}</em></button>
          <div className="account-row">
            <span className="account-avatar" aria-hidden="true">{initialsOf(user.name)}</span>
            <div className="account-identity">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
            {user.role === 'superuser' && <em className="owner-badge" title="Workspace owner">Owner</em>}
          </div>
          <button onClick={onSignOut}><LogOut size={16} /><span>Sign out</span></button>
        </div>
      </aside>

      {sidebarOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="search-wrap"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks…" aria-label="Search tasks" /><kbd>⌘ K</kbd></div>
          <div className={`sync-status ${syncStatusView.className}`}><i />{syncStatusView.label}</div>
          <button className="avatar" aria-label={`Signed in as ${user.email}`} onClick={openSyncPanel}>{initialsOf(user.name)}</button>
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
                  composerProject === column.name ? (
                    <TaskComposer
                      project={column.name}
                      onCreate={handleCreateTask}
                      onClose={() => setComposerProject(null)}
                    />
                  ) : (
                    <button className="column-add" onClick={() => openComposer(column.name)}><Plus size={16} /> Add a task</button>
                  )
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
          onClose={() => setSyncPanelOpen(false)}
          requestConfirm={setConfirmRequest}
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

// Session gate. Nothing task-shaped renders until the backend has told us who
// is signed in, so a signed-out browser never paints another user's data.
function App() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [authError, setAuthError] = useState<string | null>(() => takeAuthError())

  const load = useCallback(async () => {
    setUnreachable(false)
    try {
      const info = await fetchSession()
      setSyncScope(info.user?.sub ?? null)
      if (info.user) {
        claimPreAccountTasks(info.user.sub)
        setAuthError(null) // a previous failure is moot once someone is in
      }
      setSession(info)
    } catch {
      setUnreachable(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSignOut() {
    await signOut()
    setSyncScope(null)
    setSession((current) => (current ? { ...current, user: null } : current))
  }

  if (unreachable) {
    return <SignInScreen allowedDomain="entri.me" offline onRetry={() => void load()} error={authError} />
  }

  if (!session) {
    return <div className="signin-shell"><div className="signin-loading" role="status">Loading…</div></div>
  }

  if (!session.user) {
    return <SignInScreen allowedDomain={session.allowedDomain} error={authError} />
  }

  return <Workspace key={session.user.sub} user={session.user} onSignOut={() => void handleSignOut()} />
}

export default App
