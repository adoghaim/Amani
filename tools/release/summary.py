"""Shared readiness contract and allowlisted public output."""
import json
from pathlib import Path
import time
from common import write_json
from asc import build_state
from play import track_state

READY = 'READY_FOR_PHASE_A_DEVICE_QA'
DISCLAIMER = 'Store API readiness does not prove installability. Real installation is Phase A A1/A2.'


def readiness(apple, assigned, google, code):
    a, g = build_state(apple), track_state(google, code)
    if 'PROCESSING_FAILED' in (a, g):
        return 'PROCESSING_FAILED'
    if 'MISMATCH' in (a, g):
        return 'MISMATCH'
    if a == g == 'VALID' and assigned:
        return READY
    return 'PROCESSING'


def poll(read, output, ident, seconds=1500, interval=30, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + seconds
    while True:
        state = read()
        write_json(output, {'identity': ident, **state, 'installability': DISCLAIMER})
        status = state['state']
        if status != 'PROCESSING' or clock() >= deadline:
            print(status)
            print(DISCLAIMER)
            return status
        sleep(min(interval, max(0, deadline - clock())))


def summary(directory, ident, outcome):
    directory = Path(directory)
    result = {'identity': ident, 'job_outcome': outcome, 'installability': DISCLAIMER,
              'two_store_distribution': 'NON_TRANSACTIONAL'}
    for filename in ('release-status.json', 'play-state.json', 'apple-state.json', 'handoff.json'):
        path = directory / filename
        if path.exists():
            # These files are written exclusively by the structured script layer.
            result[filename] = json.loads(path.read_text())
    write_json(directory / 'release-summary.json', result)
    status = result.get('release-status.json', {}).get('state', 'NOT_READY')
    if outcome in ('failure', 'cancelled'):
        status = result.get('play-state.json', {}).get('state', 'FAILED')
    result['state'] = status
    write_json(directory / 'release-summary.json', result)
    text = ('# RC distribution\n\nState: ' + status + '\n\n' + DISCLAIMER
            + '\n\nTwo-store distribution is non-transactional.\n\n'
            + '```json\n' + json.dumps(result, indent=2, sort_keys=True) + '\n```\n')
    (directory / 'release-summary.md').write_text(text)
    return text
