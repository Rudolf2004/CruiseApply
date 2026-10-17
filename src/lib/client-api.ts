export async function sendJson<T>(path: string, data: unknown, method = "POST"): Promise<T> {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The request could not be completed.");
  return result as T;
}
