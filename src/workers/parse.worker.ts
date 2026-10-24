// Parses telemetry files off the UI thread. Channel buffers are transferred back (zero-copy).
import { parseTelemetryCsv } from '../core/csvParser';
import { parseLd } from '../core/ldParser';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = (e: MessageEvent) => {
  const { id, buffer, fileName, kind, ldx } = e.data as { id: number; buffer: ArrayBuffer; fileName: string; kind: 'csv' | 'ld'; ldx?: string };
  try {
    const progress = (p: number) => ctx.postMessage({ id, progress: p });
    const result = kind === 'ld' ? parseLd(buffer, fileName, ldx, progress) : parseTelemetryCsv(buffer, fileName, progress);
    const transfers = result.channels.map((c) => c.data.buffer as ArrayBuffer);
    ctx.postMessage({ id, result }, transfers);
  } catch (err) {
    ctx.postMessage({ id, error: (err as Error).message || String(err) });
  }
};
