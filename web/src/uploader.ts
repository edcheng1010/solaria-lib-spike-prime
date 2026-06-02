// Hub program upload sequence. Ported from ProgramUploader.java.
// Sequence: ClearSlot -> StartFileUpload -> N x TransferChunk (running CRC) -> ProgramFlow(start).
import { pack } from "./framing.js";
import { clearSlot, startFileUpload, transferChunk, programFlow } from "./messages.js";
import { calculate } from "./crc32.js";

const enc = new TextEncoder();

export interface UploadFrames {
  clear: Uint8Array;
  start: Uint8Array;
  chunks: Uint8Array[];
  execute: Uint8Array;
}

// Produce all framed messages for uploading `programText` to `slot`.
// maxChunkSize comes from InfoResponse (default 960).
export function buildUpload(programText: string, slot: number, maxChunkSize: number): UploadFrames {
  const bytes = enc.encode(programText);
  const chunks: Uint8Array[] = [];
  let running = 0;
  for (let off = 0; off < bytes.length; off += maxChunkSize) {
    const chunk = bytes.subarray(off, Math.min(off + maxChunkSize, bytes.length));
    running = calculate(chunk, running); // resumable running CRC
    chunks.push(pack(transferChunk(chunk, running)));
  }
  return {
    clear: pack(clearSlot(slot)),
    start: pack(startFileUpload("program.py", slot, bytes)),
    chunks,
    execute: pack(programFlow(false, slot)),
  };
}
