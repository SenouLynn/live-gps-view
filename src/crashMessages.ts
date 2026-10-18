export const crashMessages = [
  'Git gud kid', 'Did you even try?', 'Hit your shot kid', 'How now brown cow',
  'Impressive...', 'Try again loser', 'Welcome aboard, sailor', 'Critical fumble',
] as const;
export function randomCrashMessage(random = Math.random): string {
  return crashMessages[Math.min(crashMessages.length - 1, Math.max(0, Math.floor(random() * crashMessages.length)))];
}
