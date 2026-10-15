"""Read back signed package identities and same-run web assets. Never builds versions."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import zipfile
from common import APP_ID, TEAM_ID, UPLOAD_SHA256, check_versions, clean, identity, require, run, sha256, write_json


def digest(data):
    return hashlib.sha256(data).hexdigest()


def tree(root):
    return {p.relative_to(root).as_posix(): digest(p.read_bytes()) for p in Path(root).rglob('*') if p.is_file()}


def zipped(path, prefix):
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.startswith(prefix) and not n.endswith('/')]
        require(len(names) == len(set(names)), 'Duplicate ZIP entries')
        return {n[len(prefix):]: digest(archive.read(n)) for n in names}


def correspondence(expected, actual, android=False, shims=None):
    # Capacitor's generated cordova shims are checked against the synced copy.
    shims = shims or {}
    retained = {k: v for k, v in expected.items() if not android or not (k.endswith('.map') or k.startswith('.well-known/'))}
    require(bool(retained), 'Empty asset tree')
    require(actual == {**retained, **shims}, 'Packaged web assets do not correspond')


def flag_proof(original, on, off):
    require(original == on, 'Flag-on control differs from built dist')
    require(original != off, 'Flag-unset control is identical')
    return {'flag_on_identical': True, 'flag_unset_differs': True}


def protobuf_fields(data):
    # Minimal wire reader for AAPT2 Resources.proto XmlNode/XmlElement/XmlAttribute.
    def varint(offset):
        value, shift = 0, 0
        while offset < len(data) and shift < 70:
            byte = data[offset]
            offset += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value, offset
            shift += 7
        raise ValueError('Invalid protobuf varint')
    offset, fields = 0, []
    while offset < len(data):
        tag, offset = varint(offset)
        field, wire = tag >> 3, tag & 7
        require(field > 0, 'Invalid protobuf field')
        if wire == 0:
            value, offset = varint(offset)
        elif wire == 2:
            length, offset = varint(offset)
            require(offset + length <= len(data), 'Truncated protobuf')
            value, offset = data[offset:offset + length], offset + length
        elif wire in (1, 5):
            length = 8 if wire == 1 else 4
            require(offset + length <= len(data), 'Truncated protobuf')
            value, offset = data[offset:offset + length], offset + length
        else:
            raise ValueError('Unsupported protobuf wire type')
        fields.append((field, value))
    return fields


def one(fields, number):
    values = [v for f, v in fields if f == number]
    require(len(values) == 1, 'Missing or ambiguous protobuf field')
    return values[0]


def aab_manifest(data):
    element = protobuf_fields(one(protobuf_fields(data), 1))
    require(one(element, 3) == b'manifest', 'AAB root is not manifest')
    attributes = {}
    for number, value in element:
        if number != 4:
            continue
        attr = protobuf_fields(value)
        name = one(attr, 2).decode()
        if name not in ('package', 'versionName', 'versionCode'):
            continue
        namespaces = [v.decode() for n, v in attr if n == 1]
        require(namespaces in ([""], []) if name == 'package' else namespaces == ['http://schemas.android.com/apk/res/android'], 'Manifest namespace mismatch')
        require(name not in attributes, 'Duplicate manifest attribute')
        raw = [v for n, v in attr if n == 3]
        if raw:
            attributes[name] = one(attr, 3).decode()
        compiled = [v for n, v in attr if n == 6]
        if name == 'versionCode' and compiled:
            # XmlAttribute.compiled_item=6, Item.prim=7, Primitive.int_decimal_value=6.
            primitive = protobuf_fields(one(protobuf_fields(one(attr, 6)), 7))
            numeric = str(one(primitive, 6))
            require(not raw or attributes[name] == numeric, 'Raw/compiled versionCode mismatch')
            attributes[name] = numeric
        require(name in attributes, 'Missing manifest value')
    return attributes


def check_manifest(values, ident):
    require(values == {'package': APP_ID, 'versionName': ident['MARKETING_VERSION'],
                       'versionCode': ident['ANDROID_VERSION_CODE']}, 'Android manifest mismatch')


def verify_ios_app(app, ident, source):
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)
    result = subprocess.run(['codesign', '-d', '-v', str(app)], check=True, capture_output=True, text=True)
    text = result.stdout + result.stderr
    require('Authority=Apple Distribution:' in text and 'TeamIdentifier=' + TEAM_ID in text, 'iOS distribution signer mismatch')
    ent = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)], check=True, capture_output=True).stdout
    entitlements = plistlib.loads(ent)
    require(entitlements.get('application-identifier') == TEAM_ID + '.' + APP_ID, 'Application entitlement mismatch')
    require(entitlements.get('com.apple.developer.team-identifier') == TEAM_ID, 'Team entitlement mismatch')
    require(entitlements.get('get-task-allow', False) is False, 'Debug entitlement forbidden')
    expected = plistlib.loads((source / 'ios/App/App/App.entitlements').read_bytes())
    require(entitlements.get('com.apple.developer.associated-domains') == expected['com.apple.developer.associated-domains'], 'Associated domains mismatch')
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    require(info['CFBundleIdentifier'] == APP_ID and info['CFBundleShortVersionString'] == ident['MARKETING_VERSION']
            and str(info['CFBundleVersion']) == ident['IOS_BUILD_NUMBER'], 'IPA manifest mismatch')


def main(mode):
    ident = identity()
    source = Path(os.environ['SOURCE_DIR'])
    private = Path(os.environ['RELEASE_PRIVATE'])
    output = Path(os.environ['RELEASE_OUT'])
    output.mkdir(parents=True, exist_ok=True)
    proof_file = output / 'proof.json'
    proof = json.loads(proof_file.read_text()) if proof_file.exists() else {}
    check_versions(source, ident)
    clean(source)
    expected = tree(source / 'dist')
    require(expected == tree(private / 'dist-original'), 'Dist changed after native flag build')
    if mode == 'web':
        proof.update(flag_proof(tree(private / 'dist-original'), tree(private / 'dist-on'), tree(private / 'dist-off')))
        require(not any(b'VITE_FREEMIUM_ACTIVE' in p.read_bytes() for p in (source / 'dist').rglob('*.js')), 'Raw native flag remains')
        for platform, path in (('ios', 'ios/App/App/public'), ('android', 'android/app/src/main/assets/public')):
            actual = tree(source / path)
            shims = {k: v for k, v in actual.items() if k not in expected}
            require(set(shims) <= {'cordova.js', 'cordova_plugins.js'}, 'Unexpected sync additions')
            correspondence(expected, actual, shims=shims)
            proof[platform + '_shims'] = shims
        proof['web_verified'] = True
    elif mode == 'ios':
        require(proof.get('web_verified'), 'Web proof missing')
        candidates = list((private / 'export').glob('*.ipa'))
        require(len(candidates) == 1, 'Expected one IPA')
        shutil.copyfile(candidates[0], output / 'app.ipa')
        extracted = private / 'ipa'
        # ditto preserves signed bundle symlinks.
        subprocess.run(['ditto', '-x', '-k', str(output / 'app.ipa'), str(extracted)], check=True, capture_output=True)
        apps = list((extracted / 'Payload').glob('*.app'))
        require(len(apps) == 1, 'Expected one IPA app')
        verify_ios_app(apps[0], ident, source)
        archived = private / 'App.xcarchive/Products/Applications/App.app'
        correspondence(expected, tree(archived / 'public'), shims=proof['ios_shims'])
        correspondence(expected, tree(apps[0] / 'public'), shims=proof['ios_shims'])
        proof['ios_artifact_sha256'] = sha256(output / 'app.ipa')
        proof['ios_verified'] = True
    elif mode == 'android':
        require(proof.get('ios_verified'), 'iOS proof missing')
        sdk = Path(os.environ['ANDROID_HOME'])
        build_tools = sorted((sdk / 'build-tools').iterdir(), key=lambda p: tuple(map(int, p.name.split('.'))))[-1]
        apk, aab = output / 'app.apk', output / 'app.aab'
        cert = run(str(build_tools / 'apksigner'), 'verify', '--print-certs', str(apk))
        fingerprints = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)', cert)
        require([f.upper() for f in fingerprints] == [UPLOAD_SHA256], 'APK signer mismatch')
        result = run('jarsigner', '-verify', str(aab))
        require('jar verified.' in result and 'unsigned entries' not in result.lower(), 'AAB signature verification failed')
        cert = run('keytool', '-J-Duser.language=en', '-printcert', '-jarfile', str(aab))
        fingerprints = re.findall(r'SHA256:\s*([A-Fa-f0-9:]+)', cert)
        require(len(fingerprints) == 1 and fingerprints[0].replace(':', '').upper() == UPLOAD_SHA256, 'AAB signer mismatch')
        badging = run(str(build_tools / 'aapt2'), 'dump', 'badging', str(apk))
        match = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
        require(match is not None, 'APK manifest unreadable')
        check_manifest(dict(zip(('package', 'versionCode', 'versionName'), match.groups())), ident)
        with zipfile.ZipFile(aab) as bundle:
            check_manifest(aab_manifest(bundle.read('base/manifest/AndroidManifest.xml')), ident)
        correspondence(expected, zipped(apk, 'assets/public/'), android=True, shims=proof['android_shims'])
        correspondence(expected, zipped(aab, 'base/assets/public/'), android=True, shims=proof['android_shims'])
        proof['android_artifact_sha256'] = {name: sha256(output / name) for name in ('app.apk', 'app.aab')}
        proof['android_verified'] = True
    else:
        raise ValueError('Unknown proof stage')
    write_json(proof_file, proof)
    print(mode.upper() + '_VERIFIED')


if __name__ == '__main__':
    main(sys.argv[1])
