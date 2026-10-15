"""Materialize secrets only under RUNNER_TEMP; called after environment approval."""
import base64
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import subprocess
import sys
from common import TEAM_ID, require


def private_dir():
    root = Path(os.environ['RELEASE_PRIVATE']).resolve()
    require(root.is_relative_to(Path(os.environ['RUNNER_TEMP']).resolve()), 'Secrets must be under RUNNER_TEMP')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    return root


def decode(name, path):
    require(bool(os.environ.get(name)), 'Missing secret: ' + name)
    path.write_bytes(base64.b64decode(os.environ[name], validate=True))
    path.chmod(0o600)


def setup(mode):
    os.umask(0o077)
    root = private_dir()
    if mode == 'asc':
        require(re.fullmatch('[A-Za-z0-9]{10}', os.environ.get('APPLE_ASC_KEY_ID', '')), 'Invalid APPLE_ASC_KEY_ID')
        require(re.fullmatch('[A-Fa-f0-9-]{36}', os.environ.get('APPLE_ASC_ISSUER_ID', '')), 'Invalid APPLE_ASC_ISSUER_ID')
        path = root / ('AuthKey_' + os.environ['APPLE_ASC_KEY_ID'] + '.p8')
        decode('APPLE_ASC_PRIVATE_KEY_B64', path)
        with open(os.environ['GITHUB_ENV'], 'a') as env:
            env.write('ASC_KEY_PATH=' + str(path) + '\n')
    elif mode == 'keychain':
        require(os.environ['APPLE_TEAM_ID'] == TEAM_ID, 'Apple team mismatch')
        original = subprocess.check_output(['security', 'list-keychains', '-d', 'user'], text=True)
        (root / 'keychains.json').write_text(json.dumps(re.findall(r'"([^"]+)"', original)))
        keychain = str(root / 'release.keychain-db')
        subprocess.run(['security', 'create-keychain', '-p', secrets.token_hex(32), keychain], check=True, capture_output=True)
        # Cloud signing does not require a private-key import or unlocked local identity.
        subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', keychain,
                        *json.loads((root / 'keychains.json').read_text())], check=True, capture_output=True)
        with (root / 'ExportOptions.plist').open('wb') as output:
            plistlib.dump({'method': 'app-store-connect', 'destination': 'export', 'teamID': TEAM_ID,
                          'signingStyle': 'automatic', 'manageAppVersionAndBuildNumber': False,
                          'uploadSymbols': False}, output)
    elif mode == 'android':
        for name in ('ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'):
            require(bool(os.environ.get(name)), 'Missing secret: ' + name)
        decode('ANDROID_UPLOAD_KEYSTORE_B64', root / 'upload.jks')
        (root / 'signing.gradle').write_text('''gradle.projectsEvaluated {
    def app = gradle.rootProject.project(':app')
    def signing = app.android.signingConfigs.getByName('release')
    signing.storeFile = new File(System.getenv('RELEASE_PRIVATE'), 'upload.jks')
    signing.storePassword = System.getenv('ANDROID_KEYSTORE_PASSWORD')
    signing.keyAlias = System.getenv('ANDROID_KEY_ALIAS')
    signing.keyPassword = System.getenv('ANDROID_KEY_PASSWORD')
    app.android.buildTypes.getByName('release').signingConfig = signing
}
''')
    else:
        raise ValueError('Unknown setup mode')


if __name__ == '__main__':
    setup(sys.argv[1])
