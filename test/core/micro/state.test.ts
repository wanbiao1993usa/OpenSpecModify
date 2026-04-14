/**
 * Tests for micro state management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { getMicroDir } from '../../../src/core/micro/resolver.js';
import {
  readMicroMeta,
  writeMicroComplete,
  resetMicroMeta,
  resetMicroArtifact,
  detectMicroCompleted,
  detectMicroStale,
  type MicroMetaFile,
} from '../../../src/core/micro/state.js';
import type { MicroSchema } from '../../../src/core/micro/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function setupTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'micro-state-test-'));
  const microDir = getMicroDir(tmpDir);
  fs.mkdirSync(microDir, { recursive: true });
  return tmpDir;
}

function writeMetaFile(name: string, meta: MicroMetaFile): void {
  const metaPath = path.join(getMicroDir(tmpDir), `.${name}.meta.yaml`);
  fs.writeFileSync(metaPath, stringifyYaml(meta), 'utf-8');
}

function readMetaFile(name: string): MicroMetaFile {
  const metaPath = path.join(getMicroDir(tmpDir), `.${name}.meta.yaml`);
  return parseYaml(fs.readFileSync(metaPath, 'utf-8')) as MicroMetaFile;
}

const makeSchema = (artifacts: Array<{ id: string; requires?: string[] }>): MicroSchema => ({
  name: 'test',
  version: 1,
  artifacts: artifacts.map(a => ({
    id: a.id,
    instruction: `Do ${a.id}`,
    requires: a.requires ?? [],
  })),
});

beforeEach(() => {
  setupTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readMicroMeta
// ---------------------------------------------------------------------------

describe('readMicroMeta', () => {
  it('returns empty structure when meta file does not exist', () => {
    const meta = readMicroMeta('nonexistent', tmpDir);
    expect(meta).toEqual({ artifacts: {} });
  });

  it('reads existing meta file', () => {
    writeMetaFile('test', {
      artifacts: {
        'step-1': { completed_at: '2025-01-01T00:00:00' },
      },
    });

    const meta = readMicroMeta('test', tmpDir);
    expect(meta.artifacts['step-1']).toBeDefined();
    expect(meta.artifacts['step-1'].completed_at).toBe('2025-01-01T00:00:00');
  });

  it('returns empty structure for malformed meta file', () => {
    const metaPath = path.join(getMicroDir(tmpDir), '.bad.meta.yaml');
    fs.writeFileSync(metaPath, 'not: valid: yaml: [', 'utf-8');

    const meta = readMicroMeta('bad', tmpDir);
    expect(meta).toEqual({ artifacts: {} });
  });
});

// ---------------------------------------------------------------------------
// writeMicroComplete
// ---------------------------------------------------------------------------

describe('writeMicroComplete', () => {
  it('creates meta file and marks artifact complete', () => {
    writeMicroComplete('test', 'step-1', tmpDir);

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1']).toBeDefined();
    expect(meta.artifacts['step-1'].completed_at).toBeTruthy();
  });

  it('appends to existing meta file', () => {
    writeMetaFile('test', {
      artifacts: {
        'step-1': { completed_at: '2025-01-01T00:00:00' },
      },
    });

    writeMicroComplete('test', 'step-2', tmpDir);

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1']).toBeDefined();
    expect(meta.artifacts['step-2']).toBeDefined();
  });

  it('overwrites existing artifact completion', () => {
    writeMetaFile('test', {
      artifacts: {
        'step-1': { completed_at: '2025-01-01T00:00:00' },
      },
    });

    writeMicroComplete('test', 'step-1', tmpDir);

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1'].completed_at).not.toBe('2025-01-01T00:00:00');
  });

  it('writes dialog_log when provided', () => {
    writeMicroComplete('test', 'step-1', tmpDir, {
      dialogLog: './logs/step-1-dialog.json',
    });

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1'].dialog_log).toBe('./logs/step-1-dialog.json');
    expect(meta.artifacts['step-1'].completed_at).toBeTruthy();
  });

  it('omits dialog_log when not provided', () => {
    writeMicroComplete('test', 'step-1', tmpDir);

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1'].dialog_log).toBeUndefined();
  });

  it('preserves existing dialog_log of other artifacts', () => {
    writeMicroComplete('test', 'step-1', tmpDir, {
      dialogLog: './logs/step-1.json',
    });
    writeMicroComplete('test', 'step-2', tmpDir);

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1'].dialog_log).toBe('./logs/step-1.json');
    expect(meta.artifacts['step-2'].dialog_log).toBeUndefined();
  });

  it('reads back dialog_log via readMicroMeta', () => {
    writeMetaFile('test', {
      artifacts: {
        'step-1': {
          completed_at: '2025-01-01T00:00:00',
          dialog_log: './logs/existing.json',
        },
      },
    });

    const meta = readMicroMeta('test', tmpDir);
    expect(meta.artifacts['step-1'].dialog_log).toBe('./logs/existing.json');
  });

  it('writes line_start and line_end when provided', () => {
    writeMicroComplete('test', 'step-1', tmpDir, {
      dialogLog: './logs/dialog.json',
      lineStart: 100,
      lineEnd: 250,
    });

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1'].line_start).toBe(100);
    expect(meta.artifacts['step-1'].line_end).toBe(250);
    expect(meta.artifacts['step-1'].dialog_log).toBe('./logs/dialog.json');
  });

  it('omits line_start/line_end when not provided', () => {
    writeMicroComplete('test', 'step-1', tmpDir, {
      dialogLog: './logs/dialog.json',
    });

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1'].line_start).toBeUndefined();
    expect(meta.artifacts['step-1'].line_end).toBeUndefined();
  });

  it('allows line_start without line_end', () => {
    writeMicroComplete('test', 'step-1', tmpDir, {
      dialogLog: './logs/dialog.json',
      lineStart: 50,
    });

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1'].line_start).toBe(50);
    expect(meta.artifacts['step-1'].line_end).toBeUndefined();
  });

  it('reads back line_start/line_end via readMicroMeta', () => {
    writeMetaFile('test', {
      artifacts: {
        'step-1': {
          completed_at: '2025-01-01T00:00:00',
          dialog_log: './logs/existing.json',
          line_start: 10,
          line_end: 200,
        },
      },
    });

    const meta = readMicroMeta('test', tmpDir);
    expect(meta.artifacts['step-1'].line_start).toBe(10);
    expect(meta.artifacts['step-1'].line_end).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// resetMicroMeta
// ---------------------------------------------------------------------------

describe('resetMicroMeta', () => {
  it('deletes the meta file', () => {
    writeMetaFile('test', { artifacts: { 'step-1': { completed_at: '2025-01-01T00:00:00' } } });
    const metaPath = path.join(getMicroDir(tmpDir), '.test.meta.yaml');
    expect(fs.existsSync(metaPath)).toBe(true);

    resetMicroMeta('test', tmpDir);
    expect(fs.existsSync(metaPath)).toBe(false);
  });

  it('does not throw when meta file does not exist', () => {
    expect(() => resetMicroMeta('nonexistent', tmpDir)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resetMicroArtifact
// ---------------------------------------------------------------------------

describe('resetMicroArtifact', () => {
  it('removes a single artifact from meta', () => {
    writeMetaFile('test', {
      artifacts: {
        'step-1': { completed_at: '2025-01-01T00:00:00' },
        'step-2': { completed_at: '2025-01-02T00:00:00' },
      },
    });

    const removed = resetMicroArtifact('test', 'step-1', tmpDir);
    expect(removed).toBe(true);

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-1']).toBeUndefined();
    expect(meta.artifacts['step-2']).toBeDefined();
  });

  it('returns false when artifact not in meta', () => {
    writeMetaFile('test', {
      artifacts: {
        'step-1': { completed_at: '2025-01-01T00:00:00' },
      },
    });

    const removed = resetMicroArtifact('test', 'nonexistent', tmpDir);
    expect(removed).toBe(false);
  });

  it('deletes meta file when last artifact removed', () => {
    writeMetaFile('test', {
      artifacts: {
        'step-1': { completed_at: '2025-01-01T00:00:00' },
      },
    });

    const metaPath = path.join(getMicroDir(tmpDir), '.test.meta.yaml');
    expect(fs.existsSync(metaPath)).toBe(true);

    resetMicroArtifact('test', 'step-1', tmpDir);
    expect(fs.existsSync(metaPath)).toBe(false);
  });

  it('returns false when meta file does not exist', () => {
    const removed = resetMicroArtifact('nonexistent', 'step-1', tmpDir);
    expect(removed).toBe(false);
  });

  it('preserves dialog_log of remaining artifacts', () => {
    writeMetaFile('test', {
      artifacts: {
        'step-1': { completed_at: '2025-01-01T00:00:00', dialog_log: './logs/1.json' },
        'step-2': { completed_at: '2025-01-02T00:00:00', dialog_log: './logs/2.json' },
      },
    });

    resetMicroArtifact('test', 'step-1', tmpDir);

    const meta = readMetaFile('test');
    expect(meta.artifacts['step-2'].dialog_log).toBe('./logs/2.json');
  });
});

// ---------------------------------------------------------------------------
// detectMicroCompleted
// ---------------------------------------------------------------------------

describe('detectMicroCompleted', () => {
  it('returns empty set when no artifacts completed', () => {
    const schema = makeSchema([{ id: 'a' }, { id: 'b' }]);
    const meta: MicroMetaFile = { artifacts: {} };

    const completed = detectMicroCompleted(schema, meta);
    expect(completed.size).toBe(0);
  });

  it('detects completed artifacts from meta', () => {
    const schema = makeSchema([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const meta: MicroMetaFile = {
      artifacts: {
        a: { completed_at: '2025-01-01T00:00:00' },
        c: { completed_at: '2025-01-01T00:00:00' },
      },
    };

    const completed = detectMicroCompleted(schema, meta);
    expect(completed.size).toBe(2);
    expect(completed.has('a')).toBe(true);
    expect(completed.has('c')).toBe(true);
    expect(completed.has('b')).toBe(false);
  });

  it('ignores meta entries not in schema', () => {
    const schema = makeSchema([{ id: 'a' }]);
    const meta: MicroMetaFile = {
      artifacts: {
        a: { completed_at: '2025-01-01T00:00:00' },
        removed: { completed_at: '2025-01-01T00:00:00' },
      },
    };

    const completed = detectMicroCompleted(schema, meta);
    expect(completed.size).toBe(1);
    expect(completed.has('removed')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectMicroStale
// ---------------------------------------------------------------------------

describe('detectMicroStale', () => {
  it('returns empty set when no completed artifacts', () => {
    const schema = makeSchema([{ id: 'a' }, { id: 'b', requires: ['a'] }]);
    const meta: MicroMetaFile = { artifacts: {} };
    const completed = new Set<string>();

    const stale = detectMicroStale(schema, meta, completed);
    expect(stale.size).toBe(0);
  });

  it('returns empty set when no upstream is newer', () => {
    const schema = makeSchema([{ id: 'a' }, { id: 'b', requires: ['a'] }]);
    const meta: MicroMetaFile = {
      artifacts: {
        a: { completed_at: '2025-01-01T00:00:00' },
        b: { completed_at: '2025-01-02T00:00:00' },
      },
    };
    const completed = new Set(['a', 'b']);

    const stale = detectMicroStale(schema, meta, completed);
    expect(stale.size).toBe(0);
  });

  it('detects stale artifact when upstream is newer', () => {
    const schema = makeSchema([{ id: 'a' }, { id: 'b', requires: ['a'] }]);
    const meta: MicroMetaFile = {
      artifacts: {
        a: { completed_at: '2025-01-02T00:00:00' },
        b: { completed_at: '2025-01-01T00:00:00' },
      },
    };
    const completed = new Set(['a', 'b']);

    const stale = detectMicroStale(schema, meta, completed);
    expect(stale.size).toBe(1);
    expect(stale.has('b')).toBe(true);
  });

  it('propagates staleness downstream', () => {
    const schema = makeSchema([
      { id: 'a' },
      { id: 'b', requires: ['a'] },
      { id: 'c', requires: ['b'] },
    ]);
    const meta: MicroMetaFile = {
      artifacts: {
        a: { completed_at: '2025-01-03T00:00:00' },
        b: { completed_at: '2025-01-01T00:00:00' },
        c: { completed_at: '2025-01-02T00:00:00' },
      },
    };
    const completed = new Set(['a', 'b', 'c']);

    const stale = detectMicroStale(schema, meta, completed);
    expect(stale.has('b')).toBe(true);
    expect(stale.has('c')).toBe(true);
  });

  it('does not mark root artifacts as stale', () => {
    const schema = makeSchema([{ id: 'a' }]);
    const meta: MicroMetaFile = {
      artifacts: { a: { completed_at: '2025-01-01T00:00:00' } },
    };
    const completed = new Set(['a']);

    const stale = detectMicroStale(schema, meta, completed);
    expect(stale.size).toBe(0);
  });
});
