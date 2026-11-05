// Real telemetry for the tests. Logs aren't in the repo: tests that need one skip when it can't be found.
//   PT_TEST_LOGS="<folder>;<folder>" npm test     (any folders of .ld + .ldx pairs)
import * as fs from 'node:fs';
import * as path from 'node:path';

const folders = () => (process.env.PT_TEST_LOGS ?? '').split(';').filter(Boolean);

/** A log by name: in PT_TEST_LOGS if it's there, otherwise in `home` (absolute, or a folder of myTelemData/). */
export function realLog(name: string, home: string): string {
  for (const dir of folders()) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return path.isAbsolute(home) ? path.join(home, name) : path.join(__dirname, '..', 'myTelemData', home, name);
}

/** Every .ld (with its .ldx) in the PT_TEST_LOGS folders. */
export const allRealLogs = (): string[] =>
  folders().flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ld') && fs.existsSync(path.join(dir, f + 'x')))
      .map((f) => path.join(dir, f)),
  );
