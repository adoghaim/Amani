import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rawAccessFindings } from '../../migrations/__verification__/legacy-raw-access-guard';

describe('M8c: application code cannot acquire raw storage access', () => {
  it('has no raw-table reference in either application tree', () => {
    expect(rawAccessFindings(process.cwd())).toEqual([]);
  });
  it('negative control: planted references fail at their exact file and line', () => {
    const root = mkdtempSync(join(tmpdir(), 'amani-raw-guard-'));
    const raw = ['interpretations', 'private'].join('_');
    try {
      for (const directory of ['src/types', 'supabase/functions/probe', 'supabase/functions/__verification__']) {
        mkdirSync(join(root, directory), { recursive: true });
      }
      writeFileSync(join(root, 'src/types/supabase.generated.ts'), raw);
      writeFileSync(join(root, 'supabase/functions/__verification__/fixture.ts'), raw);
      expect(rawAccessFindings(root)).toEqual([]);
      writeFileSync(join(root, 'src/probe.ts'), `// planted mutant\nclient.from('${raw}');\n`);
      writeFileSync(join(root, 'supabase/functions/probe/index.ts'), `\n\nclient.from('${raw}');`);
      expect(rawAccessFindings(root)).toEqual([
        { file: 'src/probe.ts', line: 2 },
        { file: 'supabase/functions/probe/index.ts', line: 3 },
      ]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
