export function notificationHref(value: string | null): string | null {
  if (!value || !/^\/dashboard(?:\/[a-zA-Z0-9_-]+)*$/.test(value)) return null;
  return value;
}
