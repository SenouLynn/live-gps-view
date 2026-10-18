import { randomCrashMessage } from './crashMessages.ts';
export function showCrashOverlay(reset: () => void) {
  const dialog = document.getElementById('sandbox-crash') as HTMLDialogElement;
  if (dialog.open) return;
  document.getElementById('sandbox-crash-title')!.textContent = randomCrashMessage();
  document.getElementById('sandbox-crash-reset')!.onclick = () => { hideCrashOverlay(); reset(); };
  dialog.oncancel = event => event.preventDefault();
  dialog.showModal();
}
export function hideCrashOverlay() {
  const dialog = document.getElementById('sandbox-crash') as HTMLDialogElement;
  if (dialog.open) dialog.close();
}
