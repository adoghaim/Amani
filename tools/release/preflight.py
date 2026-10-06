import os
from pathlib import Path
import sys
from common import check_versions, clean, identity, require, run, write_json


def preflight(root, ident):
    root = Path(root).resolve()
    clean(root)
    sha = ident['FROZEN_SHA']
    require(run('git', 'rev-parse', '--verify', sha + '^{commit}', cwd=root) == sha, 'SHA is not a commit')
    run('git', 'merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main', cwd=root)
    run('git', 'checkout', '--detach', sha, cwd=root)
    require(run('git', 'rev-parse', 'HEAD', cwd=root) == sha, 'Wrong checkout')
    clean(root)
    return check_versions(root, ident)


if __name__ == '__main__':
    ident = identity()
    observed = preflight(sys.argv[1], ident)
    if os.environ.get('PREFLIGHT_OUTPUT'):
        write_json(os.environ['PREFLIGHT_OUTPUT'], {'identity': ident, 'observed': observed})
    print('PREFLIGHT_OK')
