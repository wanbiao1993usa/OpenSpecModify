/**
 * Tests for micro instruction loader.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { getMicroDir } from '../../../src/core/micro/resolver.js';
import {
  loadMicroContext,
  generateMicroInstructions,
  getNextArtifacts,
  formatMicroStatus,
  type MicroContext,
} from '../../../src/core/micro/instruction-loader.js';
import type { MicroSchema } from '../../../src/core/micro/types.js';
import type { MicroMetaFile } from '../../../src/core/micro/state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function setupTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'micro-loader-test-'));
  const microDir = getMicroDir(tmpDir);
  fs.mkdirSync(microDir, { recursive: true });
  return tmpDir;
}

function writeMicroSchema(name: string, schema: object): void {
  const microDir = getMicroDir(tmpDir);
  fs.writeFileSync(path.join(microDir, `${name}.yaml`), stringifyYaml(schema), 'utf-8');
}

function writeMetaFile(name: string, meta: MicroMetaFile): void {
  const metaPath = path.join(getMicroDir(tmpDir), `.${name}.meta.yaml`);
  fs.writeFileSync(metaPath, stringifyYaml(meta), 'utf-8');
}

/** Build a MicroContext directly without file I/O */
function buildContext(
  schema: MicroSchema,
  completed: string[] = [],
  stale: string[] = [],
  meta?: MicroMetaFile
): MicroContext {
  return {
    schema,
    meta: meta ?? { artifacts: {} },
    completed: new Set(completed),
    stale: new Set(stale),
    name: schema.name,
    projectRoot: tmpDir,
  };
}

const linearSchema: MicroSchema = {
  name: 'linear',
  version: 1,
  artifacts: [
    { id: 'a', instruction: 'Do A', requires: [] },
    { id: 'b', instruction: 'Do B', description: 'Step B', requires: ['a'] },
    { id: 'c', instruction: 'Do C', requires: ['b'] },
  ],
};

const diamondSchema: MicroSchema = {
  name: 'diamond',
  version: 1,
  description: 'Diamond DAG',
  artifacts: [
    { id: 'root', instruction: 'Do root', requires: [] },
    { id: 'left', instruction: 'Do left', requires: ['root'] },
    { id: 'right', instruction: 'Do right', requires: ['root'] },
    { id: 'merge', instruction: 'Do merge', requires: ['left', 'right'] },
  ],
};

beforeEach(() => {
  setupTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadMicroContext
// ---------------------------------------------------------------------------

describe('loadMicroContext', () => {
  it('loads context from schema and meta files', () => {
    writeMicroSchema('test', {
      name: 'test',
      version: 1,
      artifacts: [
        { id: 'a', instruction: 'Do A' },
        { id: 'b', instruction: 'Do B', requires: ['a'] },
      ],
    });
    writeMetaFile('test', {
      artifacts: { a: { completed_at: '2025-01-01T00:00:00' } },
    });

    const ctx = loadMicroContext('test', tmpDir);
    expect(ctx.schema.name).toBe('test');
    expect(ctx.completed.has('a')).toBe(true);
    expect(ctx.completed.has('b')).toBe(false);
    expect(ctx.name).toBe('test');
    expect(ctx.meta.artifacts['a'].completed_at).toBe('2025-01-01T00:00:00');
  });

  it('returns empty completed set when no meta file', () => {
    writeMicroSchema('fresh', {
      name: 'fresh',
      version: 1,
      artifacts: [{ id: 'a', instruction: 'Do A' }],
    });

    const ctx = loadMicroContext('fresh', tmpDir);
    expect(ctx.completed.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateMicroInstructions
// ---------------------------------------------------------------------------

describe('generateMicroInstructions', () => {
  it('generates instructions for a specific artifact', () => {
    const ctx = buildContext(linearSchema, ['a']);
    const inst = generateMicroInstructions(ctx, 'b');

    expect(inst.schemaName).toBe('linear');
    expect(inst.artifactId).toBe('b');
    expect(inst.instruction).toBe('Do B');
    expect(inst.description).toBe('Step B');
    expect(inst.dependencies).toHaveLength(1);
    expect(inst.dependencies[0]).toEqual({
      id: 'a',
      done: true,
      description: '',
    });
  });

  it('reports unlocked artifacts', () => {
    const ctx = buildContext(linearSchema);
    const inst = generateMicroInstructions(ctx, 'a');

    expect(inst.unlocks).toEqual(['b']);
  });

  it('throws for unknown artifact', () => {
    const ctx = buildContext(linearSchema);
    expect(() => generateMicroInstructions(ctx, 'nonexistent')).toThrow(/not found/);
  });

  it('reports dependency completion status', () => {
    const ctx = buildContext(diamondSchema, ['root', 'left']);
    const inst = generateMicroInstructions(ctx, 'merge');

    expect(inst.dependencies).toHaveLength(2);
    const leftDep = inst.dependencies.find(d => d.id === 'left')!;
    const rightDep = inst.dependencies.find(d => d.id === 'right')!;
    expect(leftDep.done).toBe(true);
    expect(rightDep.done).toBe(false);
  });

  it('includes dependency dialog_log in instructions', () => {
    const meta: MicroMetaFile = {
      artifacts: {
        a: {
          completed_at: '2025-01-01T00:00:00',
          dialog_log: './logs/a-dialog.json',
          line_start: 1,
          line_end: 50,
        },
      },
    };
    const ctx = buildContext(linearSchema, ['a'], [], meta);
    const inst = generateMicroInstructions(ctx, 'b');

    expect(inst.dependencies[0].dialogLog).toEqual({
      dialogLog: './logs/a-dialog.json',
      lineStart: 1,
      lineEnd: 50,
    });
  });

  it('omits dependency dialogLog when not in meta', () => {
    const meta: MicroMetaFile = {
      artifacts: {
        a: { completed_at: '2025-01-01T00:00:00' },
      },
    };
    const ctx = buildContext(linearSchema, ['a'], [], meta);
    const inst = generateMicroInstructions(ctx, 'b');

    expect(inst.dependencies[0].dialogLog).toBeUndefined();
  });

  it('includes previousDialogLog when artifact was completed before', () => {
    const meta: MicroMetaFile = {
      artifacts: {
        a: {
          completed_at: '2025-01-01T00:00:00',
          dialog_log: './logs/a-dialog.json',
          line_start: 10,
          line_end: 100,
        },
      },
    };
    const ctx = buildContext(linearSchema, ['a'], ['a'], meta);
    const inst = generateMicroInstructions(ctx, 'a');

    expect(inst.previousDialogLog).toEqual({
      dialogLog: './logs/a-dialog.json',
      lineStart: 10,
      lineEnd: 100,
    });
  });

  it('omits previousDialogLog when artifact has no prior dialog', () => {
    const ctx = buildContext(linearSchema);
    const inst = generateMicroInstructions(ctx, 'a');

    expect(inst.previousDialogLog).toBeUndefined();
  });

  it('includes dependency dialogLog with partial line range', () => {
    const meta: MicroMetaFile = {
      artifacts: {
        a: {
          completed_at: '2025-01-01T00:00:00',
          dialog_log: './logs/a.json',
          line_start: 50,
        },
      },
    };
    const ctx = buildContext(linearSchema, ['a'], [], meta);
    const inst = generateMicroInstructions(ctx, 'b');

    expect(inst.dependencies[0].dialogLog).toEqual({
      dialogLog: './logs/a.json',
      lineStart: 50,
      lineEnd: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// getNextArtifacts
// ---------------------------------------------------------------------------

describe('getNextArtifacts', () => {
  it('returns root artifacts when nothing is completed', () => {
    const ctx = buildContext(linearSchema);
    expect(getNextArtifacts(ctx)).toEqual(['a']);
  });

  it('returns next layer when dependencies are completed', () => {
    const ctx = buildContext(linearSchema, ['a']);
    expect(getNextArtifacts(ctx)).toEqual(['b']);
  });

  it('returns multiple ready artifacts in diamond', () => {
    const ctx = buildContext(diamondSchema, ['root']);
    const next = getNextArtifacts(ctx);
    expect(next).toEqual(['left', 'right']);
  });

  it('returns empty when all completed', () => {
    const ctx = buildContext(linearSchema, ['a', 'b', 'c']);
    expect(getNextArtifacts(ctx)).toEqual([]);
  });

  it('returns empty when blocked', () => {
    // b requires a, c requires b — skip a → nothing ready except a
    const ctx = buildContext(linearSchema, []);
    // Only 'a' is ready since it has no deps
    expect(getNextArtifacts(ctx)).toEqual(['a']);
  });

  it('does not return blocked artifacts', () => {
    // In diamond, if only root is done, merge is still blocked
    const ctx = buildContext(diamondSchema, ['root']);
    const next = getNextArtifacts(ctx);
    expect(next).not.toContain('merge');
  });
});

// ---------------------------------------------------------------------------
// formatMicroStatus
// ---------------------------------------------------------------------------

describe('formatMicroStatus', () => {
  it('formats status for empty run', () => {
    const ctx = buildContext(linearSchema);
    const status = formatMicroStatus(ctx);

    expect(status.name).toBe('linear');
    expect(status.isComplete).toBe(false);
    expect(status.artifacts).toHaveLength(3);

    const a = status.artifacts.find(x => x.id === 'a')!;
    const b = status.artifacts.find(x => x.id === 'b')!;
    expect(a.status).toBe('ready');
    expect(b.status).toBe('blocked');
    expect(b.missingDeps).toEqual(['a']);
  });

  it('reports complete status', () => {
    const ctx = buildContext(linearSchema, ['a', 'b', 'c']);
    const status = formatMicroStatus(ctx);

    expect(status.isComplete).toBe(true);
    expect(status.artifacts.every(a => a.status === 'done')).toBe(true);
  });

  it('reports stale artifacts', () => {
    const ctx = buildContext(linearSchema, ['a', 'b'], ['b']);
    const status = formatMicroStatus(ctx);

    const b = status.artifacts.find(x => x.id === 'b')!;
    expect(b.status).toBe('stale');
  });

  it('includes description in status', () => {
    const ctx = buildContext(diamondSchema);
    const status = formatMicroStatus(ctx);
    expect(status.description).toBe('Diamond DAG');
  });

  it('sorts artifacts in topological order', () => {
    const ctx = buildContext(diamondSchema, ['root']);
    const status = formatMicroStatus(ctx);

    const ids = status.artifacts.map(a => a.id);
    const rootIdx = ids.indexOf('root');
    const mergeIdx = ids.indexOf('merge');
    expect(rootIdx).toBeLessThan(mergeIdx);
  });
});
