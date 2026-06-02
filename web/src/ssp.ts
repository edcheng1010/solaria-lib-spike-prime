// SSP v0.8 JSON command/event envelope. Ported from SSPMessage.java / SSPParser.java.

export interface SSPCommand {
  cmd: string;
  port?: string;
  request_id?: string;
  [k: string]: unknown;
}

// Build one newline-terminated JSON command line (goes inside a TunnelMessage 0x32).
export function buildCommand(cmd: SSPCommand): string {
  return JSON.stringify(cmd) + "\n";
}

export type SSPEvent =
  | { event: "sensor"; port: string; type: string; value: unknown; request_id?: string }
  | { event: "system"; metric: string; value: unknown }
  | { event: "error"; code: number; message: string; request_id?: string }
  | { event: "pong" }
  | { type: "capability"; [k: string]: unknown }
  | Record<string, unknown>;

// Parse a TunnelMessage payload (may contain multiple newline-delimited JSON objects).
export function parseEvents(payload: string): SSPEvent[] {
  const out: SSPEvent[] = [];
  for (const line of payload.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* ignore partial/garbage */ }
  }
  return out;
}
