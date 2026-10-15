"""Alpha-only edits with durable, conservative partial-state accounting."""
from pathlib import Path
import re
from common import APP_ID, require, write_json
from http_client import request

UNKNOWN = 'ANDROID_IDENTITY_UNKNOWN_OR_POTENTIALLY_CONSUMED'


def track_state(track, code):
    if track.get('track') != 'alpha':
        return 'MISMATCH'
    releases = track.get('releases', [])
    matches = [r for r in releases if str(code) in list(map(str, r.get('versionCodes', [])))]
    if len(matches) != 1:
        return 'MISMATCH'
    state = matches[0].get('status')
    if state == 'completed':
        return 'VALID'
    if state == 'draft':
        return 'PROCESSING'
    return 'MISMATCH'


def codes(response, field):
    require(isinstance(response.get(field, []), list), 'Malformed Play response')
    return {str(x['versionCode']) for x in response.get(field, [])}


class Play:
    def __init__(self, token, transport=request):
        self.token, self.transport = token, transport

    def call(self, method, suffix='', body=None, binary=None):
        require(re.fullmatch(r'(?:/[A-Za-z0-9-]+(?:/(?:bundles|apks|tracks(?:/alpha)?))?(?::(?:validate|commit))?)?', suffix), 'Play endpoint forbidden')
        require(method in ('GET', 'POST', 'PUT', 'DELETE'), 'Play method forbidden')
        allowed = {
            'GET': r'/[A-Za-z0-9-]+/(?:bundles|apks|tracks(?:/alpha)?)',
            'POST': r'(?:|/[A-Za-z0-9-]+(?:/bundles|:validate|:commit))',
            'PUT': r'/[A-Za-z0-9-]+/tracks/alpha',
            'DELETE': r'/[A-Za-z0-9-]+',
        }
        require(re.fullmatch(allowed[method], suffix), 'Play operation forbidden')
        if binary is not None:
            require(method == 'POST' and suffix.endswith('/bundles'), 'Binary endpoint forbidden')
        if method == 'PUT':
            require(suffix.endswith('/tracks/alpha') and body.get('track') == 'alpha', 'Only alpha is allowed')
        prefix = '/upload/androidpublisher/v3/applications/' if binary is not None else '/androidpublisher/v3/applications/'
        return self.transport(method, 'https://androidpublisher.googleapis.com' + prefix + APP_ID + '/edits' + suffix + ('?uploadType=media' if binary is not None else ''),
                              self.token, body, binary=binary)

    def insert(self):
        edit = self.call('POST', body={})['id']
        require(re.fullmatch('[A-Za-z0-9-]+', edit), 'Invalid Play edit id')
        return edit

    def snapshot(self):
        edit = self.insert()
        try:
            # Read all tracks for duplicate detection; writes remain alpha-only.
            return {'bundles': self.call('GET', '/' + edit + '/bundles').get('bundles', []),
                    'apks': self.call('GET', '/' + edit + '/apks').get('apks', []),
                    'tracks': self.call('GET', '/' + edit + '/tracks').get('tracks', [])}
        finally:
            self.call('DELETE', '/' + edit)

    def duplicate(self, code):
        state = self.snapshot()
        known = codes(state, 'bundles') | codes(state, 'apks')
        for track in state['tracks']:
            for release in track.get('releases', []):
                known.update(map(str, release.get('versionCodes', [])))
        return str(code) in known

    def alpha(self):
        snapshot = self.snapshot()
        matches = [t for t in snapshot['tracks'] if t.get('track') == 'alpha']
        require(len(matches) == 1, 'Alpha track missing or ambiguous')
        return matches[0]

    def upload(self, aab, code, evidence_path, verify_artifacts):
        # No retry, identity bump, or automatic resumption is possible here.
        state = {'state': 'PLAY_NOT_STARTED', 'versionCode': str(code),
                 'apple_number_consumed': True, 'owner_disposition_required': False}
        edit, attempted, uploaded = None, False, False
        def record():
            write_json(evidence_path, state)
        record()
        try:
            verify_artifacts()
            edit = self.insert()
            state.update(state='PLAY_EDIT_INSERTED', edit_id=edit)
            record()
            verify_artifacts()
            # Persist intent BEFORE the network call: timeout/runner loss is ambiguous too.
            attempted = True
            state.update(state=UNKNOWN, owner_disposition_required=True, upload_attempted=True)
            record()
            response = self.call('POST', '/' + edit + '/bundles', binary=Path(aab).read_bytes())
            uploaded = True
            state['bundles_upload_succeeded'] = True
            record()
            require(str(response['versionCode']) == str(code), 'Uploaded versionCode mismatch')
            verify_artifacts()
            self.call('PUT', '/' + edit + '/tracks/alpha', {'track': 'alpha', 'releases': [
                {'versionCodes': [str(code)], 'status': 'completed'}]})
            self.call('POST', '/' + edit + ':validate', {})
            verify_artifacts()
            self.call('POST', '/' + edit + ':commit', {})
            state.update(state='PLAY_COMMITTED', owner_disposition_required=False)
            record()
            return state
        except Exception:
            state.update(state=UNKNOWN if attempted or uploaded else 'PLAY_FAILED_BEFORE_BUNDLE_UPLOAD',
                         owner_disposition_required=True)
            # Read the existing edit BEFORE creating another (which can invalidate it).
            if edit:
                for name in ('bundles', 'tracks'):
                    try:
                        response = self.call('GET', '/' + edit + '/' + name)
                        state['edit_' + name] = sanitize({name: response.get(name, [])})[name]
                    except Exception:
                        state['edit_' + name + '_read_failed'] = True
            try:
                state['current_play_state'] = sanitize(self.snapshot())
            except Exception:
                state['current_play_state_unavailable'] = True
            record()
            raise RuntimeError(state['state']) from None


def sanitize(state):
    # Store release names/notes/error strings are untrusted; keep only numeric identities/status.
    result = {}
    for kind in ('bundles', 'apks'):
        result[kind] = [{'versionCode': str(x['versionCode'])} for x in state.get(kind, [])
                        if str(x.get('versionCode', '')).isdigit()]
    result['tracks'] = []
    for track in state.get('tracks', []):
        name = track.get('track')
        if name != 'alpha':
            continue
        result['tracks'].append({'track': name, 'releases': [
            {'versionCodes': [str(c) for c in r.get('versionCodes', []) if str(c).isdigit()],
             'status': r.get('status') if r.get('status') in ('draft', 'completed', 'halted', 'inProgress') else 'UNKNOWN'}
            for r in track.get('releases', [])]})
    return result
