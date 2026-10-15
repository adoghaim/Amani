"""Best-effort keychain restoration and unconditional removal of private files."""
import json
import os
from pathlib import Path
import shutil
import subprocess
from common import require

root = Path(os.environ['RELEASE_PRIVATE']).resolve()
require(root.is_relative_to(Path(os.environ['RUNNER_TEMP']).resolve()) and root.name.startswith('amani-private-'), 'Unsafe cleanup path')
try:
    if (root / 'keychains.json').exists():
        subprocess.run(['security', 'list-keychains', '-d', 'user', '-s',
                        *json.loads((root / 'keychains.json').read_text())], check=True, capture_output=True)
finally:
    try:
        if (root / 'release.keychain-db').exists():
            subprocess.run(['security', 'delete-keychain', str(root / 'release.keychain-db')], check=True, capture_output=True)
    finally:
        shutil.rmtree(root, ignore_errors=False) if root.exists() else None
