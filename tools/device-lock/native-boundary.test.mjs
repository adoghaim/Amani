import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const cases = JSON.parse(readFileSync(new URL('./native-release-cases.json', import.meta.url), 'utf8'));
const literal = value => value === null ? 'null' : JSON.stringify(value);

test('actual Android Java release helper executes the native boundary matrix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amani-native-java-'));
  try {
    const checks = cases.map(({ version, active }) => `if (DevicePrivacyRelease.isActive(${literal(version)}) != ${active}) throw new AssertionError(${literal(String(version))});`).join('\n');
    const harness = join(dir, 'NativeReleaseBoundary.java');
    writeFileSync(harness, `import com.amani.health.DevicePrivacyRelease; public class NativeReleaseBoundary { public static void main(String[] args) { ${checks} System.out.println("${cases.length} Java boundaries passed"); } }`);
    execFileSync('javac', ['-d', dir, resolve('android/app/src/main/java/com/amani/health/DevicePrivacyRelease.java'), harness], { stdio: 'pipe' });
    const output = execFileSync('java', ['-cp', dir, 'NativeReleaseBoundary'], { encoding: 'utf8' });
    assert.match(output, /boundaries passed/);
    console.log(output.trim());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('actual iOS Swift release helper executes the same native boundary matrix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amani-native-swift-'));
  try {
    const checks = cases.map(({ version, active }) => `precondition(DevicePrivacyRelease.isActive(${version === null ? 'nil' : literal(version)}) == ${active}, ${literal(String(version))})`).join('\n');
    const harness = join(dir, 'main.swift');
    writeFileSync(harness, `${checks}\nprint("${cases.length} Swift boundaries passed")`);
    const executable = join(dir, 'native-boundary');
    execFileSync('swiftc', [resolve('ios/App/App/DevicePrivacyRelease.swift'), harness, '-o', executable], { stdio: 'pipe' });
    const output = execFileSync(executable, [], { encoding: 'utf8' });
    assert.match(output, /boundaries passed/);
    console.log(output.trim());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
