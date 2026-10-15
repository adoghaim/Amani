"""Small allowlisted transport; errors never include response bodies or credentials."""
import json
import urllib.error
import urllib.request
from urllib.parse import urlparse


class StoreError(RuntimeError):
    def __init__(self, status=0):
        self.status = status
        super().__init__('Store request failed (HTTP %d)' % status)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise StoreError(code)


def request(method, url, token, body=None, binary=None):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.netloc not in {
        'api.appstoreconnect.apple.com', 'androidpublisher.googleapis.com'}:
        raise ValueError('Store host not allowed')
    headers = {'Authorization': 'Bearer ' + token}
    data = None
    if binary is not None:
        headers['Content-Type'] = 'application/octet-stream'
        data = binary
    elif body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=120) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raise StoreError(error.code) from None
    except (urllib.error.URLError, TimeoutError):
        raise StoreError() from None
