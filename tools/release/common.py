"""Release identities and immutable artifact handoffs. No store dependencies."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

APP_ID = 'com.amani.health'
TEAM_ID = '954V925LL8'
UPLOAD_SHA256 = 'AE4554E8D774C0B6E8C8BC311FC69C3E6DD2C9F5718A1E8D5105DAAEB7375730'
FROZEN_106 = '2fd9433bbcbed73a1e137505d2542ee58a16d9e0'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(env=os.environ):
    values = {k: env.get(k, '') for k in (
        'FROZEN_SHA', 'MARKETING_VERSION', 'IOS_BUILD_NUMBER', 'ANDROID_VERSION_CODE')}
    require(re.fullmatch(r'[0-9a-f]{40}', values['FROZEN_SHA']), 'Full lowercase SHA required')
    require(values['FROZEN_SHA'] != FROZEN_106, '1.0.6 is frozen; rebuilding forbidden')
    version = values['MARKETING_VERSION']
    require(re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version), 'Invalid version')
    require(tuple(map(int, version.split('.'))) >= (1, 0, 7), 'Only 1.0.7 onward')
    for key in ('IOS_BUILD_NUMBER', 'ANDROID_VERSION_CODE'):
        require(re.fullmatch(r'[1-9][0-9]{0,9}', values[key]), 'Invalid build identity')
    require(int(values['ANDROID_VERSION_CODE']) <= 2100000000, 'Invalid Android versionCode')
    require(env.get('TRACK', 'alpha') == 'alpha', 'Only alpha is allowed')
    require(env.get('FREEMIUM_CLIENT_FLAG', 'true') == 'true', 'Native flag must be true')
    return values


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True, stderr=subprocess.PIPE).strip()


def clean(root):
    require(not run('git', 'status', '--porcelain', '--untracked-files=no', cwd=root), 'Tracked tree dirty')


def versions(root):
    root = Path(root)
    pbx = (root / 'ios/App/App.xcodeproj/project.pbxproj').read_text()
    gradle = (root / 'android/app/build.gradle').read_text()
    result = {'package': json.loads((root / 'package.json').read_text())['version']}
    configurations = re.findall(
        r'isa = XCBuildConfiguration;(?:(?!isa = XCBuildConfiguration;).)*?buildSettings = \{(.*?)\};\s*name = (Debug|Release);',
        pbx, re.DOTALL)
    app_configs = [(name, settings) for settings, name in configurations if 'PRODUCT_BUNDLE_IDENTIFIER' in settings]
    require(sorted(name for name, _ in app_configs) == ['Debug', 'Release'], 'Expected Debug and Release app configurations')
    for key in ('MARKETING_VERSION', 'CURRENT_PROJECT_VERSION', 'PRODUCT_BUNDLE_IDENTIFIER', 'DEVELOPMENT_TEAM'):
        result[key] = []
        for _, settings in sorted(app_configs):
            matches = re.findall(r'\b' + key + r'\s*=\s*"?([^;"\s]+)"?\s*;', settings)
            require(len(matches) == 1, 'Missing or ambiguous iOS configuration field: ' + key)
            result[key].extend(matches)
    for key in ('versionName', 'versionCode', 'applicationId'):
        matches = re.findall(r'\b' + key + r'\s+"?([\w.]+)"?', gradle)
        require(len(matches) == 1, 'Ambiguous Android field: ' + key)
        result[key] = matches[0]
    return result


def check_versions(root, ident):
    v = versions(root)
    require(v['package'] == v['versionName'] == ident['MARKETING_VERSION'], 'Marketing version mismatch')
    require(v['MARKETING_VERSION'] == [ident['MARKETING_VERSION']] * 2, 'iOS marketing version mismatch')
    require(v['CURRENT_PROJECT_VERSION'] == [ident['IOS_BUILD_NUMBER']] * 2, 'iOS build mismatch')
    require(v['versionCode'] == ident['ANDROID_VERSION_CODE'], 'Android versionCode mismatch')
    require(v['applicationId'] == APP_ID and v['PRODUCT_BUNDLE_IDENTIFIER'] == [APP_ID] * 2, 'App identifier mismatch')
    require(v['DEVELOPMENT_TEAM'] == [TEAM_ID] * 2, 'Apple team mismatch')
    return v


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')
    temporary.replace(path)


def seal(directory, ident):
    directory = Path(directory)
    names = ['app.ipa', 'app.aab', 'app.apk', 'proof.json']
    hashes = {name: sha256(directory / name) for name in names}
    path = directory / 'handoff.json'
    require(not path.exists(), 'Handoff already sealed')
    write_json(path, {'identity': ident, 'sha256': hashes})
    path.chmod(0o444)
    return sha256(path)


def verify(directory, ident, expected):
    directory = Path(directory)
    require(re.fullmatch('[0-9a-f]{64}', expected or ''), 'Missing trusted handoff digest')
    require(sha256(directory / 'handoff.json') == expected, 'Handoff tampered')
    data = json.loads((directory / 'handoff.json').read_text())
    require(data['identity'] == ident, 'Handoff identity mismatch')
    require(set(data['sha256']) == {'app.ipa', 'app.aab', 'app.apk', 'proof.json'}, 'Unexpected artifacts')
    for name, digest in data['sha256'].items():
        require(sha256(directory / name) == digest, 'Artifact tampered: ' + name)
    return data
