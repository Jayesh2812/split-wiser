type ToastListener = (msg: string) => void;
const listeners = new Set<ToastListener>();

/** Fire a transient toast message from anywhere. */
export function toast(msg: string) {
  listeners.forEach((l) => l(msg));
}

export function onToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
