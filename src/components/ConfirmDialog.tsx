import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  /** Marks irreversible actions: red confirm button and warning icon. */
  danger?: boolean
  action: () => void
}

interface ConfirmDialogProps {
  request: ConfirmRequest
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ request, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-label={request.title} onClick={(event) => event.stopPropagation()}>
        {request.danger && <div className="confirm-icon"><TriangleAlert size={18} /></div>}
        <h2>{request.title}</h2>
        <p>{request.message}</p>
        <div className="modal-footer">
          {/* Cancel takes initial focus so Enter never destroys anything by accident. */}
          <button className="modal-cancel" autoFocus onClick={onCancel}>Cancel</button>
          <button className={request.danger ? 'confirm-danger' : 'modal-create'} onClick={onConfirm}>{request.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
