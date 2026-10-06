import base64
import copy
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
ROOT = TOOLS.parents[1]
sys.path.insert(0, str(TOOLS))
import asc
import common
import play
import preflight
import release
import summary
import verify_build
from http_client import request

IDENT = {'FROZEN_SHA': 'a' * 40, 'MARKETING_VERSION': '1.0.7', 'IOS_BUILD_NUMBER': '12', 'ANDROID_VERSION_CODE': '12'}


def build(state='VALID', number='12', id='build-1'):
    return {'id': id, 'attributes': {'version': number, 'processingState': state}}


def track(status='completed', code='12'):
    return {'track': 'alpha', 'releases': [{'versionCodes': [code], 'status': status}]}


class Offline(unittest.TestCase):
    def setUp(self):
        self.block = patch.object(socket, 'create_connection', side_effect=AssertionError('Live network forbidden'))
        self.block.start()
        self.addCleanup(self.block.stop)


class IdentityTests(Offline):
    def test_valid(self):
        self.assertEqual(common.identity(IDENT), IDENT)

    def test_reject_old_versions(self):
        for version in ('1.0.6', '1.0.5', '0.9.9'):
            with self.subTest(version=version), self.assertRaises(ValueError):
                common.identity({**IDENT, 'MARKETING_VERSION': version})

    def test_reject_frozen_106(self):
        with self.assertRaises(ValueError):
            common.identity({**IDENT, 'FROZEN_SHA': common.FROZEN_106})

    def test_untrusted_inputs(self):
        for field, value in [('FROZEN_SHA', '--help'), ('FROZEN_SHA', 'main'), ('IOS_BUILD_NUMBER', '1; echo no'),
                             ('ANDROID_VERSION_CODE', '0'), ('MARKETING_VERSION', '1.0.7\nATTACK=x'),
                             ('ANDROID_VERSION_CODE', '2100000001'), ('TRACK', 'production'),
                             ('FREEMIUM_CLIENT_FLAG', 'false')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                common.identity({**IDENT, field: value})

    def fixture(self, directory):
        root = Path(directory)
        for path in ('package.json', 'ios/App/App.xcodeproj/project.pbxproj', 'android/app/build.gradle'):
            dest = root / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            value = (ROOT / path).read_text().replace('1.0.6', '1.0.7')
            value = value.replace('CURRENT_PROJECT_VERSION = 11;', 'CURRENT_PROJECT_VERSION = 12;').replace('versionCode 11', 'versionCode 12')
            dest.write_text(value)
        return root

    def test_version_triple_both_configurations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            before = {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            self.assertEqual(common.check_versions(root, IDENT)['CURRENT_PROJECT_VERSION'], ['12', '12'])
            self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()})

    def test_one_configuration_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            p = root / 'ios/App/App.xcodeproj/project.pbxproj'
            p.write_text(p.read_text().replace('CURRENT_PROJECT_VERSION = 12;', 'CURRENT_PROJECT_VERSION = 13;', 1))
            with self.assertRaises(ValueError):
                common.check_versions(root, IDENT)

    def test_two_debug_configurations_do_not_count_as_both(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            p = root / 'ios/App/App.xcodeproj/project.pbxproj'
            p.write_text(p.read_text().replace('name = Release;', 'name = Debug;'))
            with self.assertRaises(ValueError):
                common.check_versions(root, IDENT)

    def test_missing_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            p = root / 'ios/App/App.xcodeproj/project.pbxproj'
            p.write_text(p.read_text().replace('MARKETING_VERSION = 1.0.7;', '', 1))
            with self.assertRaises(ValueError):
                common.check_versions(root, IDENT)

    def test_wrong_application_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            p = root / 'android/app/build.gradle'
            p.write_text(p.read_text().replace('com.amani.health', 'com.other.app'))
            with self.assertRaises(ValueError):
                common.check_versions(root, IDENT)

    def test_sha_ancestry_and_checkout(self):
        calls = []
        def fake(*args, **kwargs):
            calls.append(args)
            return IDENT['FROZEN_SHA'] if args[1] == 'rev-parse' else ''
        with patch.object(preflight, 'run', side_effect=fake), patch.object(preflight, 'clean') as clean, patch.object(preflight, 'check_versions'):
            preflight.preflight(ROOT, IDENT)
        self.assertIn(('git', 'merge-base', '--is-ancestor', IDENT['FROZEN_SHA'], 'refs/remotes/origin/main'), calls)
        self.assertIn(('git', 'checkout', '--detach', IDENT['FROZEN_SHA']), calls)
        self.assertEqual(clean.call_count, 2)

    def test_not_ancestor_stops_before_checkout(self):
        calls = []
        def fake(*args, **kwargs):
            calls.append(args)
            if args[1] == 'merge-base':
                raise subprocess.CalledProcessError(1, args)
            return IDENT['FROZEN_SHA']
        with patch.object(preflight, 'run', side_effect=fake), patch.object(preflight, 'clean'), self.assertRaises(subprocess.CalledProcessError):
            preflight.preflight(ROOT, IDENT)
        self.assertFalse(any('checkout' in c for c in calls))

    def test_tracked_dirty_rejected(self):
        with patch.object(common, 'run', return_value=' M package.json'), self.assertRaises(ValueError):
            common.clean(ROOT)


class ASCTests(Offline):
    def test_jwt_construction_and_es256_padding(self):
        der = b'\x30\x06\x02\x01\x01\x02\x01\x02'
        token = asc.jwt('KEYID', 'issuer', 'unused', now=1000, signer=lambda data: der)
        header, payload, signature = token.split('.')
        decode = lambda s: base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))
        self.assertEqual(json.loads(decode(header)), {'alg':'ES256', 'kid':'KEYID', 'typ':'JWT'})
        self.assertEqual(json.loads(decode(payload)), {'iss':'issuer', 'iat':1000, 'exp':1600, 'aud':'appstoreconnect-v1'})
        self.assertEqual(decode(signature), b'\0' * 31 + b'\1' + b'\0' * 31 + b'\2')

    def test_jwt_der_invalid(self):
        for value in (b'', b'\x30\x02\x02\x00', b'\x30\x06\x02\x01\xff\x02\x01\x02'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                asc.raw_es256(value)

    def client(self):
        return asc.ASC('id', 'issuer', 'not-read')

    def test_apple_states(self):
        for source, expected in [('VALID','VALID'), ('PROCESSING','PROCESSING'), ('INVALID','PROCESSING_FAILED'), ('FAILED','PROCESSING_FAILED'), ('unknown','MISMATCH')]:
            self.assertEqual(asc.build_state(build(source)), expected)
        self.assertEqual(asc.build_state(None), 'PROCESSING')

    def test_duplicate_build_conservative_across_trains(self):
        client = self.client()
        with patch.object(client, 'builds', return_value=[build()]):
            self.assertTrue(client.duplicate('app', '12'))
            self.assertFalse(client.duplicate('app', '13'))

    def test_exact_marketing_and_build(self):
        client = self.client()
        with patch.object(client, 'builds', return_value=[build()]), patch.object(client, 'call', return_value={'data':{'attributes':{'version':'1.0.7', 'platform':'IOS'}}}):
            self.assertEqual(client.exact_build('app','1.0.7','12'), build())
            self.assertIsNone(client.exact_build('app','1.0.8','12'))
            self.assertIsNone(client.exact_build('app','1.0.7','13'))

    def test_internal_group_only(self):
        client = self.client()
        with patch.object(client, 'pages', return_value=[{'id':'g', 'attributes':{'name':'internal test','isInternalGroup':False}}]), self.assertRaises(ValueError):
            client.group('app', 'internal test')

    def test_pagination(self):
        client = self.client()
        with patch.object(client, 'call', side_effect=[{'data':[{'id':'1'}], 'links':{'next':'https://api.appstoreconnect.apple.com/v1/builds?cursor=2'}}, {'data':[{'id':'2'}]}]):
            self.assertEqual(client.pages('/v1/builds'), [{'id':'1'},{'id':'2'}])

    def test_pagination_untrusted_host(self):
        client = self.client()
        with patch.object(client, 'call', return_value={'data':[], 'links':{'next':'https://evil.test/v1/builds'}}), self.assertRaises(ValueError):
            client.pages('/v1/builds')

    def test_submission_endpoints_unreachable(self):
        client = self.client()
        for endpoint in ('/v1/appStoreVersionSubmissions', '/v1/reviewSubmissions', '/v1/builds/x', '/v1/apps/x'):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                client.call('POST', endpoint, {})

    def test_no_redirect_or_other_hosts(self):
        with self.assertRaises(ValueError):
            request('GET', 'https://evil.test', 'never-send')


class FakePlay(play.Play):
    def __init__(self, fail=None):
        super().__init__('fake')
        self.fail = fail
        self.calls = []
    def call(self, method, suffix='', body=None, binary=None):
        self.calls.append((method,suffix,copy.deepcopy(body)))
        if self.fail == (method, suffix):
            raise RuntimeError('simulated error, not exposed')
        if method == 'POST' and not suffix:
            return {'id':'edit'}
        if binary is not None:
            return {'versionCode':12}
        if method == 'GET':
            return {'bundles':[{'versionCode':12}], 'tracks':[track()]}
        return {}


class PlayTests(Offline):
    def test_response_parsing(self):
        self.assertEqual(play.codes({'bundles':[{'versionCode':12}]}, 'bundles'), {'12'})

    def test_duplicate_bundle(self):
        client = FakePlay()
        self.assertTrue(client.duplicate('12'))
        self.assertFalse(client.duplicate('13'))

    def test_duplicate_other_track(self):
        client = FakePlay()
        with patch.object(client, 'snapshot', return_value={'tracks':[{'track':'internal','releases':[{'versionCodes':['12']}]}]}):
            self.assertTrue(client.duplicate('12'))

    def test_track_interpretation(self):
        for t, expected in [(track(),'VALID'),(track('draft'),'PROCESSING'),(track('halted'),'MISMATCH'),(track(code='13'),'MISMATCH'),({'track':'production'},'MISMATCH')]:
            self.assertEqual(play.track_state(t, '12'), expected)

    def test_only_alpha_write(self):
        client = play.Play('fake', transport=lambda *args,**kwargs: {})
        for name in ('production', 'internal', 'beta', '../alpha'):
            with self.subTest(track=name), self.assertRaises(ValueError):
                client.call('PUT', '/edit/tracks/' + name, {'track':name})
        with self.assertRaises(ValueError):
            client.call('PUT', '/edit/tracks/alpha', {'track':'production'})

    def test_no_other_play_endpoint(self):
        client = play.Play('fake')
        for path in ('/edit/listings', '/edit/tracks/production', '/edit/../../applications', '/edit/apks'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                client.call('POST', path, {})

    def transaction(self, failure=None):
        client = FakePlay(failure)
        with tempfile.TemporaryDirectory() as directory:
            aab, evidence = Path(directory)/'app.aab', Path(directory)/'state.json'
            aab.write_bytes(b'bundle')
            verifies = []
            try:
                result = client.upload(aab, '12', evidence, lambda: verifies.append(True))
            except RuntimeError:
                result = json.loads(evidence.read_text())
        return client, result, verifies

    def test_exact_sequence_and_hash_checks(self):
        client, result, verifies = self.transaction()
        self.assertEqual([(m,s) for m,s,_ in client.calls], [('POST',''),('POST','/edit/bundles'),('PUT','/edit/tracks/alpha'),('POST','/edit:validate'),('POST','/edit:commit')])
        self.assertEqual(result['state'], 'PLAY_COMMITTED')
        self.assertEqual(len(verifies), 4)
        self.assertEqual(client.calls[2][2]['releases'][0]['versionCodes'], ['12'])

    def test_failure_before_upload(self):
        client, result, _ = self.transaction(('POST',''))
        self.assertEqual(result['state'], 'PLAY_FAILED_BEFORE_BUNDLE_UPLOAD')
        self.assertTrue(result['apple_number_consumed'])
        self.assertFalse(any(s.endswith('/bundles') for _,s,_ in client.calls))

    def test_all_post_upload_failures_stop_and_read_back(self):
        for point in [('PUT','/edit/tracks/alpha'),('POST','/edit:validate'),('POST','/edit:commit')]:
            with self.subTest(point=point):
                client, result, _ = self.transaction(point)
                self.assertEqual(result['state'], play.UNKNOWN)
                self.assertTrue(result['bundles_upload_succeeded'])
                self.assertTrue(result['owner_disposition_required'])
                self.assertIn('current_play_state', result)
                self.assertIn('edit_bundles', result)
                self.assertEqual(sum(s == '/edit/bundles' and m == 'POST' for m,s,_ in client.calls), 1)
                self.assertEqual(result['versionCode'], '12')

    def test_upload_timeout_is_also_ambiguous(self):
        _, result, _ = self.transaction(('POST','/edit/bundles'))
        self.assertEqual(result['state'], play.UNKNOWN)
        self.assertNotIn('bundles_upload_succeeded', result)

    def test_hash_failure_prevents_upload(self):
        client = FakePlay()
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(RuntimeError):
            client.upload('not-read','12',Path(directory)/'state.json',lambda: common.require(False,'tamper'))
        self.assertFalse(any(m == 'POST' and s.endswith('/bundles') for m,s,_ in client.calls))

    def test_sanitized_evidence(self):
        result = play.sanitize({'tracks':[{'track':'alpha','releases':[{'name':'DO_NOT_EMIT','releaseNotes':'DO_NOT_EMIT','versionCodes':['12'],'status':'completed'}]}]})
        self.assertNotIn('DO_NOT_EMIT', json.dumps(result))

    def test_later_failure_marks_committed_identity_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            common.write_json(Path(directory)/'play-state.json', {'state':'PLAY_COMMITTED','upload_attempted':True,'versionCode':'12'})
            with patch.dict(os.environ, {**IDENT,'RELEASE_OUT':directory,'JOB_OUTCOME':'failure'}, clear=True), patch.object(release, 'google', return_value=FakePlay()):
                release.main('summary')
            state = json.loads((Path(directory)/'play-state.json').read_text())
            self.assertEqual(state['state'], play.UNKNOWN)
            self.assertIn('current_play_state', state)


class ProofTests(Offline):
    def test_hash_handoff(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ('app.ipa','app.aab','app.apk','proof.json'):
                (Path(directory)/name).write_bytes(name.encode())
            digest = common.seal(directory, IDENT)
            self.assertEqual(common.verify(directory, IDENT, digest)['identity'], IDENT)
            (Path(directory)/'app.aab').write_bytes(b'tampered')
            with self.assertRaises(ValueError):
                common.verify(directory, IDENT, digest)

    def test_manifest_tamper_and_wrong_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ('app.ipa','app.aab','app.apk','proof.json'):
                (Path(directory)/name).write_bytes(b'data')
            digest = common.seal(directory, IDENT)
            with self.assertRaises(ValueError):
                common.verify(directory, {**IDENT,'IOS_BUILD_NUMBER':'13'}, digest)
            with self.assertRaises(ValueError):
                common.seal(directory, IDENT)
            handoff = Path(directory)/'handoff.json'
            handoff.chmod(0o600)
            handoff.write_text('{}')
            with self.assertRaises(ValueError):
                common.verify(directory, IDENT, digest)

    def test_tamper_between_signing_verification_and_seal(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            for name in ('app.ipa', 'app.apk', 'app.aab'):
                (output / name).write_bytes(b'original')
            proof = {'web_verified': True, 'ios_verified': True, 'android_verified': True,
                     'ios_artifact_sha256': common.sha256(output / 'app.ipa'),
                     'android_artifact_sha256': {name: common.sha256(output / name) for name in ('app.apk', 'app.aab')}}
            common.write_json(output / 'proof.json', proof)
            (output / 'app.ipa').write_bytes(b'tampered')
            with patch.dict(os.environ, {**IDENT, 'RELEASE_OUT': directory}, clear=True), self.assertRaises(ValueError):
                release.main('seal')
            self.assertFalse((output / 'handoff.json').exists())

    def test_flag_controls(self):
        self.assertTrue(verify_build.flag_proof({'a':'1'},{'a':'1'},{'a':'2'})['flag_on_identical'])
        for on,off in [({'a':'2'},{'a':'3'}),({'a':'1'},{'a':'1'})]:
            with self.assertRaises(ValueError):
                verify_build.flag_proof({'a':'1'},on,off)

    def test_package_only_declared_exclusions(self):
        source = {'index.html':'a','assets/a.js':'b','assets/a.js.map':'c','.well-known/a.json':'d'}
        verify_build.correspondence(source, source)
        verify_build.correspondence(source, {'index.html':'a','assets/a.js':'b'}, android=True)
        for target in ({'index.html':'a'}, {**source, 'evil.js':'e'}, {**source, 'index.html':'tamper'}):
            with self.assertRaises(ValueError):
                verify_build.correspondence(source, target)

    def test_android_manifest_exact(self):
        values = {'package':common.APP_ID,'versionName':'1.0.7','versionCode':'12'}
        verify_build.check_manifest(values, IDENT)
        for key in values:
            with self.assertRaises(ValueError):
                verify_build.check_manifest({**values,key:'wrong'},IDENT)

    def test_aab_protobuf_parsing(self):
        def field(n, text):
            raw = text.encode() if isinstance(text,str) else text
            self.assertLess(len(raw),128)
            return bytes([n*8+2,len(raw)])+raw
        def attr(name,value,android=False):
            return field(4,(field(1,'http://schemas.android.com/apk/res/android') if android else b'')+field(2,name)+field(3,value))
        # Outer element exceeds 127 bytes; encode that length as a varint.
        element = field(3,'manifest')+attr('package',common.APP_ID)+attr('versionName','1.0.7',True)+attr('versionCode','12',True)
        length = bytes([(len(element)&127)|128,len(element)>>7])
        values = verify_build.aab_manifest(b'\x0a'+length+element)
        verify_build.check_manifest(values,IDENT)

    def test_bad_protobuf(self):
        for value in (b'\x0a\xff',b'\x00',b'\x0a\x02\x01'):
            with self.assertRaises(ValueError):
                verify_build.aab_manifest(value)


class StatusTests(Offline):
    def test_both_readiness_assertions(self):
        self.assertEqual(summary.readiness(build(),True,track(),'12'),summary.READY)
        self.assertEqual(summary.readiness(build(),False,track(),'12'),'PROCESSING')
        self.assertEqual(summary.readiness(build('PROCESSING'),True,track(),'12'),'PROCESSING')
        self.assertEqual(summary.readiness(build('INVALID'),True,track(),'12'),'PROCESSING_FAILED')
        self.assertEqual(summary.readiness(build(),True,track(code='13'),'12'),'MISMATCH')

    def test_bounded_processing_is_success_state(self):
        ticks=[0]
        def sleep(seconds): ticks[0]+=seconds
        with tempfile.TemporaryDirectory() as directory:
            result=summary.poll(lambda:{'state':'PROCESSING'},Path(directory)/'status.json',IDENT,
                                seconds=1500,interval=30,clock=lambda:ticks[0],sleep=sleep)
            self.assertEqual(ticks[0],1500)
            self.assertEqual(result,'PROCESSING')
            self.assertIn('does not prove installability', (Path(directory)/'status.json').read_text())

    def test_ready_ends_poll_early(self):
        states=iter([{'state':'PROCESSING'},{'state':summary.READY}])
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(summary.poll(lambda:next(states),Path(directory)/'status.json',IDENT,
                                          clock=lambda:0,sleep=lambda s:None),summary.READY)


class WorkflowGuards(Offline):
    def workflows(self):
        # JSON is a strict YAML subset; js-yaml is also exercised by check.sh.
        return [json.loads((ROOT/'.github/workflows'/name).read_text()) for name in ('release-rc.yml','release-status.yml')]

    def test_dispatch_only_and_two_release_jobs(self):
        rc,status=self.workflows()
        self.assertEqual(set(rc['jobs']),{'preflight','release'})
        for workflow in (rc,status):
            self.assertEqual(set(workflow['on']),{'workflow_dispatch'})
            self.assertLessEqual(len(workflow['on']['workflow_dispatch']['inputs']),10)
            self.assertEqual(workflow['permissions'],{'contents':'read'})
            self.assertFalse(workflow['concurrency']['cancel-in-progress'])
        self.assertEqual(rc['concurrency'],status['concurrency'])

    def test_preflight_has_no_credentials_or_environment(self):
        job=self.workflows()[0]['jobs']['preflight']
        self.assertNotIn('environment',job)
        self.assertNotIn('secrets.',json.dumps(job))
        self.assertNotIn('id-token',json.dumps(job))
        self.assertEqual(job['runs-on'],'ubuntu-latest')

    def test_release_environment_and_permissions(self):
        for workflow in self.workflows():
            for name,job in workflow['jobs'].items():
                if name=='preflight': continue
                self.assertEqual(job['environment'],'rc-distribution')
                self.assertEqual(job['permissions'],{'contents':'read','id-token':'write'})
                self.assertTrue(job['runs-on'].startswith('macos'))

    def test_pinned_third_party_and_untrusted_shell_inputs(self):
        for workflow in self.workflows():
            for job in workflow['jobs'].values():
                for step in job['steps']:
                    if 'uses' in step and not step['uses'].startswith('actions/'):
                        self.assertRegex(step['uses'],r'^google-github-actions/auth@[0-9a-f]{40}$')
                    self.assertNotRegex(step.get('run',''),r'\$\{\{\s*inputs\.')
                    self.assertNotIn('set -x',step.get('run',''))

    def test_no_activation_credentials_or_endpoints(self):
        allowed={'APPLE_ASC_KEY_ID','APPLE_ASC_ISSUER_ID','APPLE_ASC_PRIVATE_KEY_B64','APPLE_TEAM_ID',
                 'ANDROID_UPLOAD_KEYSTORE_B64','ANDROID_KEYSTORE_PASSWORD','ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD',
                 'VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_APP_URL','VITE_STRIPE_PUBLISHABLE_KEY',
                 'VITE_REVENUECAT_IOS_KEY','VITE_REVENUECAT_ANDROID_KEY','VITE_ENABLE_APPLE_OAUTH'}
        for workflow in self.workflows():
            text=json.dumps(workflow)
            self.assertTrue(set(re.findall(r'secrets\.([A-Z0-9_]+)',text)) <= allowed)
            self.assertNotRegex(text.lower(),r'https?://[^" ]*(supabase|netlify)')
            self.assertNotRegex(text,r'(?<!VITE_)FREEMIUM_ACTIVE|SUPABASE_SERVICE_ROLE|NETLIFY_AUTH_TOKEN')

    def test_cleanup_always_and_no_private_artifacts(self):
        for workflow in self.workflows():
            for name,job in workflow['jobs'].items():
                if name=='preflight': continue
                cleanup=[s for s in job['steps'] if 'cleanup.py' in s.get('run','')]
                self.assertEqual(len(cleanup),1)
                self.assertEqual(cleanup[0]['if'],'${{ always() }}')
                for step in job['steps']:
                    if step.get('uses','').startswith('actions/upload-artifact'):
                        self.assertNotIn('RELEASE_PRIVATE',step['with']['path'])
                        self.assertNotIn('**',step['with']['path'])

    def test_apple_before_play_and_poll(self):
        steps=self.workflows()[0]['jobs']['release']['steps']
        commands=[s.get('run','') for s in steps]
        indices=[next(i for i,c in enumerate(commands) if 'release.py" '+mode in c) for mode in ('duplicates','seal','upload-apple','upload-play','poll')]
        self.assertEqual(indices,sorted(indices))
        for step in steps:
            if any('release.py" '+mode in step.get('run','') for mode in ('upload-apple','upload-play','poll')):
                self.assertEqual(step['if'],'${{ !inputs.dry_run }}')

    def test_no_identity_increment_commands(self):
        # Guard shell mutation tools and Python arithmetic on identity fields.
        import ast
        for path in TOOLS.iterdir():
            if path.suffix not in ('.sh','.py'): continue
            text=path.read_text()
            self.assertNotRegex(text,r'(?i)agvtool|increment_version|increment_build|npm version|versionCode\s*\+\+|CURRENT_PROJECT_VERSION\s*\+')
            if path.suffix=='.py':
                for node in ast.walk(ast.parse(text)):
                    if isinstance(node,(ast.AugAssign,ast.BinOp)):
                        fragment=ast.get_source_segment(text,node) or ''
                        if isinstance(node,ast.AugAssign) or isinstance(node.op,(ast.Add,ast.Sub)):
                            self.assertNotRegex(fragment,r"int\([^)]*(?:BUILD_NUMBER|VERSION_CODE|versionCode)")


if __name__ == '__main__':
    unittest.main()
