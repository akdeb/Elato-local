import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PYTHON_URL =
  'https://github.com/astral-sh/python-build-standalone/releases/download/20251217/cpython-3.11.14%2B20251217-aarch64-apple-darwin-install_only.tar.gz';

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status})`);
}

function ensureSymlink(binDir, name, target) {
  const linkPath = path.join(binDir, name);
  if (exists(linkPath)) return;
  try {
    fs.symlinkSync(target, linkPath);
  } catch {
    // ignore
  }
}

function main() {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const runtimeRoot = path.join(repoRoot, 'resources', 'python_runtime');
  const binDir = path.join(runtimeRoot, 'python', 'bin');
  const python = path.join(binDir, 'python');
  const python3 = path.join(binDir, 'python3');
  const python311 = path.join(binDir, 'python3.11');

  // If runtime already usable, just ensure symlinks are present.
  if (exists(python311)) {
    ensureSymlink(binDir, 'python3', 'python3.11');
    ensureSymlink(binDir, 'python', 'python3.11');
  }
  if (exists(python) || exists(python3) || exists(python311)) {
    console.log('[python-runtime] OK (already present)');
    return;
  }

  console.log('[python-runtime] Downloading standalone Python runtime...');

  const tmpTar = path.join(os.tmpdir(), `elato-python-runtime-${Date.now()}.tar.gz`);
  try {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });

    sh('curl', ['-L', '-o', tmpTar, PYTHON_URL]);
    sh('tar', ['-xzf', tmpTar, '-C', runtimeRoot]);

    if (exists(python311)) {
      ensureSymlink(binDir, 'python3', 'python3.11');
      ensureSymlink(binDir, 'python', 'python3.11');
    }

    if (!exists(python) && !exists(python3) && !exists(python311)) {
      throw new Error(`python not found in ${binDir}`);
    }

    console.log('[python-runtime] Ready.');
  } finally {
    try {
      fs.rmSync(tmpTar, { force: true });
    } catch {
      // ignore
    }
  }
}

try {
  main();
} catch (err) {
  console.error('[python-runtime] ERROR:', err?.message || err);
  process.exit(1);
}
