#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
for script in tools/release/*.sh; do bash -n "$script"; done
node --input-type=commonjs - <<'JS'
const fs = require('fs');
const yaml = require('js-yaml');
for (const name of ['release-rc.yml', 'release-status.yml']) {
  const workflow = yaml.load(fs.readFileSync(`.github/workflows/${name}`, 'utf8'));
  if (!workflow.on.workflow_dispatch || !workflow.jobs) throw new Error(`Invalid workflow: ${name}`);
  console.log(`${name}: YAML parsed`);
}
JS
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/release/tests -v
