import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('servidor Java transfere o arquivo pela rede e encerra ao fechar', t => {
  const bin = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name) : name;
  const compiler = spawnSync(bin('javac'), ['-version'], { encoding: 'utf8' });
  if (compiler.error?.code === 'ENOENT') { t.skip('JDK não disponível'); return; }
  const temp = mkdtempSync(join(tmpdir(), 'estante-wifi-test-'));
  try {
    const built = spawnSync(bin('javac'), ['-encoding', 'UTF-8', '-d', temp, 'android/app/src/main/java/com/estantelivre/app/BookShareServer.java', 'tests/java/BookShareServerTest.java'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const run = spawnSync(bin('java'), ['-cp', temp, 'com.estantelivre.app.BookShareServerTest'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
