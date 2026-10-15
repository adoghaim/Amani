"""Explicit release stages. No endpoint, track or identity can be selected by CLI."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from asc import ASC, build_state
from common import identity, require, seal, sha256, verify, write_json
from play import Play, UNKNOWN, sanitize
from summary import READY, poll, readiness, summary


def apple():
    return ASC(os.environ['APPLE_ASC_KEY_ID'], os.environ['APPLE_ASC_ISSUER_ID'], os.environ['ASC_KEY_PATH'])


def google():
    return Play(os.environ['PLAY_ACCESS_TOKEN'])


def main(mode):
    ident = identity()
    output = Path(os.environ['RELEASE_OUT'])
    output.mkdir(parents=True, exist_ok=True)
    version, number, code = (ident[k] for k in ('MARKETING_VERSION', 'IOS_BUILD_NUMBER', 'ANDROID_VERSION_CODE'))
    def checked():
        return verify(output, ident, os.environ.get('HANDOFF_SHA256', ''))
    if mode == 'duplicates':
        asc, play = apple(), google()
        app = asc.app()
        require(not asc.duplicate(app, number), 'Duplicate Apple build number')
        asc.group(app, os.environ['TESTFLIGHT_GROUP'])
        require(not play.duplicate(code), 'Duplicate Play versionCode')
        print('REMOTE_DUPLICATE_CHECKS_PASSED')
    elif mode == 'seal':
        proof = json.loads((output / 'proof.json').read_text())
        require(all(proof.get(p) is True for p in ('web_verified', 'ios_verified', 'android_verified')), 'Build proof incomplete')
        require(sha256(output / 'app.ipa') == proof['ios_artifact_sha256'], 'IPA changed after signing verification')
        require(set(proof['android_artifact_sha256']) == {'app.apk', 'app.aab'}, 'Android proof incomplete')
        for name, digest in proof['android_artifact_sha256'].items():
            require(sha256(output / name) == digest, 'Android artifact changed after signing verification')
        digest = seal(output, ident)
        with open(os.environ['GITHUB_ENV'], 'a') as env:
            env.write('HANDOFF_SHA256=' + digest + '\n')
        print('ARTIFACTS_SEALED')
    elif mode == 'upload-apple':
        checked()
        require(not (output / 'apple-state.json').exists(), 'Apple upload already attempted; owner disposition required')
        state = {'state': 'APPLE_UPLOAD_ATTEMPTED_IDENTITY_POTENTIALLY_CONSUMED', 'build_number': number}
        write_json(output / 'apple-state.json', state)
        env = dict(os.environ, API_PRIVATE_KEYS_DIR=os.environ['RELEASE_PRIVATE'])
        # Upload the exact verified IPA, not a re-export of the archive.
        with open(Path(os.environ['RELEASE_PRIVATE']) / 'apple-upload.log', 'wb') as log:
            result = subprocess.run(['xcrun', 'altool', '--upload-app', '--type', 'ios', '--file', str(output / 'app.ipa'),
                                     '--apiKey', os.environ['APPLE_ASC_KEY_ID'], '--apiIssuer', os.environ['APPLE_ASC_ISSUER_ID']],
                                    env=env, stdout=log, stderr=subprocess.STDOUT)
        require(result.returncode == 0, 'Apple upload failed; inspect Apple state, no automatic retry')
        checked()
        asc = apple()
        app = asc.app()
        # Acceptance must be observable before any Play upload.
        for attempt in range(11):
            build = asc.exact_build(app, version, number)
            if build is not None:
                require(build_state(build) in ('VALID', 'PROCESSING'), 'Apple rejected build')
                state.update(state='APPLE_ACCEPTED', apple_build_id=build['id'], build_number_consumed=True)
                write_json(output / 'apple-state.json', state)
                print('APPLE_ACCEPTED')
                return
            if attempt < 10:
                time.sleep(30)
        raise RuntimeError('APPLE_ACCEPTANCE_UNCONFIRMED; STOP for owner disposition')
    elif mode == 'upload-play':
        checked()
        require(json.loads((output / 'apple-state.json').read_text())['state'] == 'APPLE_ACCEPTED', 'Apple acceptance required')
        require(not (output / 'play-state.json').exists(), 'Play upload already attempted; owner disposition required')
        google().upload(output / 'app.aab', code, output / 'play-state.json', checked)
    elif mode in ('poll', 'status'):
        if mode == 'poll':
            checked()
            require(json.loads((output / 'play-state.json').read_text())['state'] == 'PLAY_COMMITTED', 'Play commit required')
        asc, play = apple(), google()
        app, group = asc.app(), None
        group = asc.group(app, os.environ['TESTFLIGHT_GROUP'])
        def read():
            if mode == 'poll':
                checked()
            build = asc.exact_build(app, version, number)
            if mode == 'poll' and build_state(build) == 'VALID':
                asc.assign(build, group)
            assigned = bool(build and asc.assigned(build, group))
            track = play.alpha()
            return {'state': readiness(build, assigned, track, code),
                    'apple_processing_state': build_state(build), 'internal_group_assigned': assigned,
                    'google_version_code': code, 'google_track': 'alpha'}
        state = poll(read, output / 'release-status.json', ident, seconds=1500 if mode == 'poll' else 0)
        require(state in (READY, 'PROCESSING'), 'Store readiness failed: ' + state)
    elif mode == 'summary':
        play_file = output / 'play-state.json'
        if os.environ.get('JOB_OUTCOME') in ('failure', 'cancelled') and play_file.exists():
            state = json.loads(play_file.read_text())
            if state.get('upload_attempted'):
                state.update(state=UNKNOWN, owner_disposition_required=True)
                try:
                    state['current_play_state'] = sanitize(google().snapshot())
                except Exception:
                    state['current_play_state_unavailable'] = True
                write_json(play_file, state)
        text = summary(output, ident, os.environ.get('JOB_OUTCOME', 'unknown'))
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
                stream.write(text)
    else:
        raise ValueError('Unknown release stage')


if __name__ == '__main__':
    try:
        main(sys.argv[1])
    except Exception as error:
        # Tracebacks / HTTP bodies / subprocess output may contain credentials.
        # Only our constant errors are printed; unknown exceptions use their class name.
        if isinstance(error, (ValueError, RuntimeError)):
            print(str(error), file=sys.stderr)
        else:
            print(type(error).__name__ + ': release stage failed', file=sys.stderr)
        sys.exit(1)
