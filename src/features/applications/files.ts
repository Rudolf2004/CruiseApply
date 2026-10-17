export const maxDocumentBytes = 10 * 1024 * 1024;
export function validateDocument(bytes: Uint8Array, name: string, mime: string) {
  if (!bytes.length || bytes.length > maxDocumentBytes) throw new Error("Choose a file up to 10 MB.");
  if (!name || name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(name)) throw new Error("Choose a file with a valid name.");
  const ext = name.split(".").pop()?.toLowerCase();
  const starts = (signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  const matches = mime === "application/pdf" && ext === "pdf" && starts([37,80,68,70,45])
    || mime === "image/png" && ext === "png" && starts([137,80,78,71,13,10,26,10])
    || mime === "image/jpeg" && ["jpg", "jpeg"].includes(ext ?? "") && starts([255,216,255]);
  if (!matches) throw new Error("File contents, extension and type must match: PDF, JPEG or PNG.");
}
