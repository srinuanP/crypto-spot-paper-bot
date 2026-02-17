import type { UiToast } from '../state/store';

type ToastsProps = {
  toasts: UiToast[];
  onDismiss: (id: number) => void;
};

export function Toasts({ toasts, onDismiss }: ToastsProps) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <button
          type="button"
          key={toast.id}
          className={`toast ${toast.tone}`}
          onClick={() => onDismiss(toast.id)}
          aria-label="ปิดการแจ้งเตือน"
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
