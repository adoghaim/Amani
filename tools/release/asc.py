"""ASC build reads and internal-group assignment only. JWT via system OpenSSL."""
import base64
import json
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlencode, urlparse
from common import APP_ID, require
from http_client import request


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def raw_es256(der):
    # OpenSSL emits ASN.1 DER; JWT uses fixed-width IEEE P1363 r||s.
    require(len(der) >= 8 and der[0] == 0x30 and der[1] == len(der) - 2, 'Invalid ES256 DER')
    offset, values = 2, []
    for _ in range(2):
        require(offset + 2 <= len(der) and der[offset] == 2, 'Invalid ECDSA integer')
        size = der[offset + 1]
        value = der[offset + 2:offset + 2 + size]
        require(len(value) == size and 0 < size <= 33 and not value[0] & 0x80, 'Invalid ECDSA integer size')
        value = value.lstrip(b'\0')
        require(len(value) <= 32, 'Not P-256')
        values.append(value.rjust(32, b'\0'))
        offset += 2 + size
    require(offset == len(der), 'Trailing DER bytes')
    return b''.join(values)


def jwt(key_id, issuer, key_path, now=None, signer=None):
    now = int(time.time() if now is None else now)
    header = {'alg': 'ES256', 'kid': key_id, 'typ': 'JWT'}
    payload = {'iss': issuer, 'iat': now, 'exp': now + 600, 'aud': 'appstoreconnect-v1'}
    message = '.'.join(b64(json.dumps(v, separators=(',', ':')).encode()) for v in (header, payload))
    if signer is None:
        def signer(data):
            return subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(key_path)],
                                  input=data, capture_output=True, check=True).stdout
    return message + '.' + b64(raw_es256(signer(message.encode())))


def build_state(build):
    if build is None:
        return 'PROCESSING'
    state = build.get('attributes', {}).get('processingState')
    if state == 'VALID':
        return 'VALID'
    if state == 'PROCESSING':
        return 'PROCESSING'
    if state in ('INVALID', 'FAILED'):
        return 'PROCESSING_FAILED'
    return 'MISMATCH'


class ASC:
    def __init__(self, key_id, issuer, key_path, transport=request):
        self.key_id, self.issuer, self.key_path = key_id, issuer, key_path
        self.transport = transport

    def call(self, method, path, body=None):
        # No arbitrary endpoint escape hatch, even for pagination.
        require(re.fullmatch(r'/v1/(apps|builds|betaGroups)(?:/[A-Za-z0-9-]+(?:/(?:preReleaseVersion|betaGroups|builds|relationships/builds))?)?(?:\?[^\s]*)?', path), 'ASC endpoint forbidden')
        require(method == 'GET' or (method == 'POST' and re.fullmatch(r'/v1/betaGroups/[A-Za-z0-9-]+/relationships/builds', path)), 'ASC write forbidden')
        return self.transport(method, 'https://api.appstoreconnect.apple.com' + path,
                              jwt(self.key_id, self.issuer, self.key_path), body)

    def pages(self, path):
        seen, result = set(), []
        while path:
            require(path not in seen, 'Repeated pagination link')
            seen.add(path)
            response = self.call('GET', path)
            require(isinstance(response.get('data'), list), 'Malformed ASC response')
            result.extend(response['data'])
            link = response.get('links', {}).get('next')
            if link:
                parsed = urlparse(link)
                require(parsed.scheme == 'https' and parsed.netloc == 'api.appstoreconnect.apple.com', 'Unsafe ASC pagination')
                path = parsed.path + ('?' + parsed.query if parsed.query else '')
            else:
                path = None
        return result

    def app(self):
        apps = self.pages('/v1/apps?' + urlencode({'filter[bundleId]': APP_ID}))
        require(len(apps) == 1 and apps[0]['attributes']['bundleId'] == APP_ID, 'ASC app mismatch')
        return apps[0]['id']

    def builds(self, app, number):
        return self.pages('/v1/builds?' + urlencode({'filter[app]': app, 'filter[version]': number, 'limit': '200'}))

    def duplicate(self, app, number):
        # Conservatively refuse the number in ANY marketing-version train.
        return any(b['attributes']['version'] == number for b in self.builds(app, number))

    def exact_build(self, app, version, number):
        matches = []
        for build in self.builds(app, number):
            if build['attributes']['version'] != number:
                continue
            train = self.call('GET', '/v1/builds/' + build['id'] + '/preReleaseVersion')['data']
            if train['attributes']['version'] == version and train['attributes']['platform'] == 'IOS':
                matches.append(build)
        require(len(matches) <= 1, 'Ambiguous ASC build')
        return matches[0] if matches else None

    def group(self, app, name):
        groups = self.pages('/v1/betaGroups?' + urlencode({'filter[app]': app, 'limit': '200'}))
        matches = [g for g in groups if g['attributes'].get('name') == name and g['attributes'].get('isInternalGroup') is True]
        require(len(matches) == 1, 'Intended internal TestFlight group missing or ambiguous')
        return matches[0]['id']

    def assigned(self, build, group):
        return any(g['id'] == group for g in self.pages('/v1/builds/' + build['id'] + '/betaGroups'))

    def assign(self, build, group):
        if not self.assigned(build, group):
            self.call('POST', '/v1/betaGroups/' + group + '/relationships/builds',
                      {'data': [{'type': 'builds', 'id': build['id']}]})
