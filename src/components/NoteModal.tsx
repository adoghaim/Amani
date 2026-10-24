import { useId } from 'react';
import { Modal } from './Modal';

interface NoteModalProps {
  open: boolean;
  onClose: () => void;
  date: string;
  onDateChange: (date: string) => void;
  /** Latest selectable date (yyyy-mm-dd). */
  maxDate: string;
  text: string;
  onTextChange: (text: string) => void;
  saving: boolean;
  onSave: () => void;
}

/**
 * The "Add note" sheet shared by the Dashboard and the Tracker. It was a
 * hand-rolled copy in each: no dialog role, no focus trap or Escape, an unnamed
 * close button, labels tied to nothing, and z-50 so the bottom nav painted over
 * Save and Cancel (review F066). It now sits on the shared Modal.
 */
export function NoteModal({
  open, onClose, date, onDateChange, maxDate, text, onTextChange, saving, onSave,
}: NoteModalProps) {
  const dateId = useId();
  const noteId = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add note"
      footer={(
        <>
          <button
            onClick={onSave}
            disabled={saving || !text.trim()}
            className="flex-1 py-2.5 min-h-[44px] bg-theme-primary text-white text-sm font-medium rounded-xl hover:bg-theme-primary-dark transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 min-h-[44px] bg-theme-surface-2 text-theme-muted-text text-sm font-medium rounded-xl hover:bg-theme-surface-hover transition-colors"
          >
            Cancel
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={dateId} className="block text-xs font-medium text-theme-muted-text mb-1.5">Date</label>
          <input
            id={dateId}
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            max={maxDate}
            className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text"
          />
        </div>
        <div>
          <label htmlFor={noteId} className="block text-xs font-medium text-theme-muted-text mb-1.5">Note</label>
          <textarea
            id={noteId}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            rows={4}
            placeholder="Write a note..."
            className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text resize-none placeholder:text-theme-muted-text-3"
          />
        </div>
      </div>
    </Modal>
  );
}
