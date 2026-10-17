import { expect, it } from "vitest";
import { validateDocument } from "./files";
it("rejects HTML disguised as PDF and mismatched file extensions", () => {
  expect(() => validateDocument(Buffer.from("<script>"),"resume.pdf","application/pdf")).toThrow();
  expect(() => validateDocument(Buffer.from("%PDF-1.7"),"resume.png","application/pdf")).toThrow();
  expect(() => validateDocument(Buffer.from("%PDF-1.7"),"resume.pdf","application/pdf")).not.toThrow();
});
it("enforces bounded size, safe names and supported signatures", () => {
  expect(() => validateDocument(new Uint8Array(10485761),"x.pdf","application/pdf")).toThrow();
  expect(() => validateDocument(Buffer.from("%PDF-"),"../x.pdf","application/pdf")).toThrow();
  expect(() => validateDocument(new Uint8Array(),"x.pdf","application/pdf")).toThrow();
  expect(() => validateDocument(Uint8Array.from([137,80,78,71,13,10,26,10]),"x.png","image/png")).not.toThrow();
});
