import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Deliberately includes comments and strings: raw access needs explicit review. */
export function rawAccessFindings(root: string): Array<{ file: string; line: number }> {
  const findings: Array<{ file: string; line: number }> = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const file = relative(root, path).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (!['migrations', '__verification__', 'node_modules'].includes(entry.name)) walk(path);
      } else if (entry.isFile() && file !== 'src/types/supabase.generated.ts') {
        readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
          if (line.includes('interpretations_private')) findings.push({ file, line: index + 1 });
        });
      }
    }
  }
  for (const directory of ['src', 'supabase/functions']) walk(join(root, directory));
  return findings;
}
