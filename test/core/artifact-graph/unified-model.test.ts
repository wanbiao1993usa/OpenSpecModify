/**
 * Tests for the unified artifact model.
 *
 * Covers:
 * - hasTemplate() utility function
 * - Artifacts without template (lightweight behavior)
 * - Metadata-first completion detection
 * - getArtifactTimestamp() (via detectStale)
 * - getDependencyInfo outputPath/summary (via generateInstructions)
 * - printStatusText done+unverified counting (via formatChangeStatus + status command)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as yaml from 'yaml';
import { hasTemplate, type Artifact, type SchemaYaml } from '../../../src/core/artifact-graph/types.js';
import { ArtifactGraph } from '../../../src/core/artifact-graph/graph.js';
import { detectCompleted, detectStale, getArtifactMtime } from '../../../src/core/artifact-graph/state.js';
import {
  loadChangeContext,
  generateInstructions,
  formatChangeStatus,
} from '../../../src/core/artifact-graph/instruction-loader.js';
import { printStatusText } from '../../../src/commands/workflow/status.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createSchema = (artifacts: SchemaYaml['artifacts']): SchemaYaml => ({
  name: 'test',
  version: 1,
  artifacts,
});

function writeArtifactMeta(
  changeDir: string,
  artifacts: Record<string, { completed_at: string; summary?: string; duration_seconds?: number }>
): void {
  const metaPath = path.join(changeDir, '.artifact-meta.yaml');
  fs.writeFileSync(metaPath, yaml.stringify({ artifacts }), 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests: hasTemplate()
// ---------------------------------------------------------------------------

describe('hasTemplate()', () => {
  it('should return true when artifact has a non-empty template', () => {
    const artifact: Artifact = {
      id: 'proposal',
      generates: 'proposal.md',
      instruction: 'Create the proposal',
      template: 'proposal.md',
      requires: [],
    };
    expect(hasTemplate(artifact)).toBe(true);
  });

  it('should return false when artifact has no template', () => {
    const artifact: Artifact = {
      id: 'task',
      generates: 'tasks.md',
      instruction: 'Create the tasks list',
      requires: [],
    };
    expect(hasTemplate(artifact)).toBe(false);
  });

  it('should return false when template is undefined', () => {
    const artifact: Artifact = {
      id: 'task',
      generates: 'tasks.md',
      instruction: 'Create it',
      template: undefined,
      requires: [],
    };
    expect(hasTemplate(artifact)).toBe(false);
  });

  it('should return false when template is empty string', () => {
    const artifact: Artifact = {
      id: 'task',
      generates: 'tasks.md',
      instruction: 'Create it',
      template: '',
      requires: [],
    };
    expect(hasTemplate(artifact)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Artifact without template (lightweight behavior)
// ---------------------------------------------------------------------------

describe('artifact without template', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-unified-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should generate instructions with empty template for artifact without template', () => {
    // Create a project-local schema with a no-template artifact
    const schemaDir = path.join(tempDir, 'openspec', 'schemas', 'light-test');
    fs.mkdirSync(schemaDir, { recursive: true });

    const schemaContent = yaml.stringify({
      name: 'light-test',
      version: 1,
      artifacts: [
        { id: 'readme', generates: 'README.md', instruction: 'Write a project README', requires: [] },
      ],
    });
    fs.writeFileSync(path.join(schemaDir, 'schema.yaml'), schemaContent);

    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });

    const context = loadChangeContext(tempDir, 'test-change', 'light-test');
    const instructions = generateInstructions(context, 'readme', tempDir);

    expect(instructions.template).toBe('');
    expect(instructions.instruction).toBe('Write a project README');
    expect(instructions.artifactId).toBe('readme');
  });

  it('should generate instructions with template content for artifact with template', () => {
    // spec-driven schema has templates for all artifacts
    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const instructions = generateInstructions(context, 'proposal', tempDir);

    expect(instructions.template).toContain('## Why');
    expect(instructions.instruction).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: Metadata-first completion detection
// ---------------------------------------------------------------------------

describe('metadata-first completion detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-meta-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should mark artifact complete when metadata exists (even without generated file)', () => {
    const schema = createSchema([
      { id: 'proposal', generates: 'proposal.md', instruction: 'Create proposal', requires: [] },
    ]);
    const graph = ArtifactGraph.fromSchema(schema);

    // Write metadata but NOT the actual file
    writeArtifactMeta(tempDir, {
      proposal: { completed_at: '2025-06-01T12:00:00Z', summary: 'A good proposal' },
    });

    const completed = detectCompleted(graph, tempDir);
    expect(completed.has('proposal')).toBe(true);
  });

  it('should mark artifact complete when only file exists (no metadata)', () => {
    const schema = createSchema([
      { id: 'proposal', generates: 'proposal.md', instruction: 'Create proposal', requires: [] },
    ]);
    const graph = ArtifactGraph.fromSchema(schema);

    // Create file but no metadata
    fs.writeFileSync(path.join(tempDir, 'proposal.md'), '# Proposal');

    const completed = detectCompleted(graph, tempDir);
    expect(completed.has('proposal')).toBe(true);
  });

  it('should mark artifact complete when both metadata and file exist', () => {
    const schema = createSchema([
      { id: 'proposal', generates: 'proposal.md', instruction: 'Create proposal', requires: [] },
    ]);
    const graph = ArtifactGraph.fromSchema(schema);

    fs.writeFileSync(path.join(tempDir, 'proposal.md'), '# Proposal');
    writeArtifactMeta(tempDir, {
      proposal: { completed_at: '2025-06-01T12:00:00Z' },
    });

    const completed = detectCompleted(graph, tempDir);
    expect(completed.has('proposal')).toBe(true);
  });

  it('should not mark artifact complete when neither metadata nor file exists', () => {
    const schema = createSchema([
      { id: 'proposal', generates: 'proposal.md', instruction: 'Create proposal', requires: [] },
    ]);
    const graph = ArtifactGraph.fromSchema(schema);

    const completed = detectCompleted(graph, tempDir);
    expect(completed.has('proposal')).toBe(false);
  });

  it('should distinguish done vs unverified in formatChangeStatus', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });

    // proposal: has metadata → should be 'done'
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal');
    writeArtifactMeta(changeDir, {
      proposal: { completed_at: '2025-06-01T12:00:00Z', summary: 'Good proposal' },
    });

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const status = formatChangeStatus(context);

    const proposal = status.artifacts.find(a => a.id === 'proposal');
    expect(proposal?.status).toBe('done');
  });

  it('should show unverified when file exists but no metadata', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });

    // proposal: file only, no metadata
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal');

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const status = formatChangeStatus(context);

    const proposal = status.artifacts.find(a => a.id === 'proposal');
    expect(proposal?.status).toBe('unverified');
  });
});

// ---------------------------------------------------------------------------
// Tests: getArtifactTimestamp (via detectStale)
// ---------------------------------------------------------------------------

describe('getArtifactTimestamp / staleness detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-ts-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should use metadata completed_at timestamp for staleness (not file mtime)', () => {
    const schema = createSchema([
      { id: 'A', generates: 'a.md', instruction: 'Create A', requires: [] },
      { id: 'B', generates: 'b.md', instruction: 'Create B', requires: ['A'] },
    ]);
    const graph = ArtifactGraph.fromSchema(schema);

    // Create files — both exist
    fs.writeFileSync(path.join(tempDir, 'a.md'), 'content A');
    fs.writeFileSync(path.join(tempDir, 'b.md'), 'content B');

    // Metadata says A was completed AFTER B → B should be stale
    writeArtifactMeta(tempDir, {
      A: { completed_at: '2025-06-02T12:00:00Z' },
      B: { completed_at: '2025-06-01T12:00:00Z' },
    });

    const completed = detectCompleted(graph, tempDir);
    expect(completed.has('A')).toBe(true);
    expect(completed.has('B')).toBe(true);

    const stale = detectStale(graph, completed, tempDir);
    expect(stale.has('B')).toBe(true);
    expect(stale.has('A')).toBe(false);
  });

  it('should not mark downstream stale when upstream is older', () => {
    const schema = createSchema([
      { id: 'A', generates: 'a.md', instruction: 'Create A', requires: [] },
      { id: 'B', generates: 'b.md', instruction: 'Create B', requires: ['A'] },
    ]);
    const graph = ArtifactGraph.fromSchema(schema);

    fs.writeFileSync(path.join(tempDir, 'a.md'), 'content A');
    fs.writeFileSync(path.join(tempDir, 'b.md'), 'content B');

    // Metadata says A was completed BEFORE B → B should NOT be stale
    writeArtifactMeta(tempDir, {
      A: { completed_at: '2025-06-01T12:00:00Z' },
      B: { completed_at: '2025-06-02T12:00:00Z' },
    });

    const completed = detectCompleted(graph, tempDir);
    const stale = detectStale(graph, completed, tempDir);

    expect(stale.has('B')).toBe(false);
    expect(stale.has('A')).toBe(false);
  });

  it('should fall back to file mtime when no metadata timestamp', () => {
    const schema = createSchema([
      { id: 'A', generates: 'a.md', instruction: 'Create A', requires: [] },
      { id: 'B', generates: 'b.md', instruction: 'Create B', requires: ['A'] },
    ]);
    const graph = ArtifactGraph.fromSchema(schema);

    // Create B first, then A — A has newer mtime
    fs.writeFileSync(path.join(tempDir, 'b.md'), 'content B');

    // Set B's mtime to the past
    const pastTime = new Date('2025-01-01T00:00:00Z');
    fs.utimesSync(path.join(tempDir, 'b.md'), pastTime, pastTime);

    // Create A now (will have current mtime, newer than B)
    fs.writeFileSync(path.join(tempDir, 'a.md'), 'content A');

    const completed = detectCompleted(graph, tempDir);
    const stale = detectStale(graph, completed, tempDir);

    // A is newer than B → B should be stale
    expect(stale.has('B')).toBe(true);
  });

  it('should propagate staleness to transitive dependents', () => {
    const schema = createSchema([
      { id: 'A', generates: 'a.md', instruction: 'Create A', requires: [] },
      { id: 'B', generates: 'b.md', instruction: 'Create B', requires: ['A'] },
      { id: 'C', generates: 'c.md', instruction: 'Create C', requires: ['B'] },
    ]);
    const graph = ArtifactGraph.fromSchema(schema);

    fs.writeFileSync(path.join(tempDir, 'a.md'), 'A');
    fs.writeFileSync(path.join(tempDir, 'b.md'), 'B');
    fs.writeFileSync(path.join(tempDir, 'c.md'), 'C');

    // A is newest → B stale → C stale (transitively)
    writeArtifactMeta(tempDir, {
      A: { completed_at: '2025-06-03T12:00:00Z' },
      B: { completed_at: '2025-06-02T12:00:00Z' },
      C: { completed_at: '2025-06-01T12:00:00Z' },
    });

    const completed = detectCompleted(graph, tempDir);
    const stale = detectStale(graph, completed, tempDir);

    expect(stale.has('A')).toBe(false);
    expect(stale.has('B')).toBe(true);
    expect(stale.has('C')).toBe(true);
  });

  it('should show stale status in formatChangeStatus', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true });

    // Create all files for spec-driven
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal');
    fs.writeFileSync(path.join(changeDir, 'design.md'), '# Design');
    fs.writeFileSync(path.join(changeDir, 'specs', 'test.md'), '# Spec');
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Tasks');

    // proposal is newest → design (depends on proposal) is stale
    writeArtifactMeta(changeDir, {
      proposal: { completed_at: '2025-06-05T12:00:00Z' },
      design: { completed_at: '2025-06-01T12:00:00Z' },
      specs: { completed_at: '2025-06-01T12:00:00Z' },
      tasks: { completed_at: '2025-06-01T12:00:00Z' },
    });

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const status = formatChangeStatus(context);

    const design = status.artifacts.find(a => a.id === 'design');
    expect(design?.status).toBe('stale');

    // proposal itself should be done (not stale)
    const proposal = status.artifacts.find(a => a.id === 'proposal');
    expect(proposal?.status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// Tests: getDependencyInfo outputPath and summary (via generateInstructions)
// ---------------------------------------------------------------------------

describe('getDependencyInfo outputPath and summary', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-dep-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should include outputPath in dependency info', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    // specs depends on proposal
    const instructions = generateInstructions(context, 'specs', tempDir);

    expect(instructions.dependencies).toHaveLength(1);
    expect(instructions.dependencies[0].id).toBe('proposal');
    expect(instructions.dependencies[0].outputPath).toBeDefined();
    expect(instructions.dependencies[0].outputPath).toContain('proposal.md');
  });

  it('should include summary from artifact metadata', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal');

    writeArtifactMeta(changeDir, {
      proposal: {
        completed_at: '2025-06-01T12:00:00Z',
        summary: 'Refactor authentication module for better security',
      },
    });

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const instructions = generateInstructions(context, 'specs', tempDir);

    expect(instructions.dependencies[0].summary).toBe(
      'Refactor authentication module for better security'
    );
  });

  it('should have undefined summary when no metadata exists', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const instructions = generateInstructions(context, 'specs', tempDir);

    expect(instructions.dependencies[0].summary).toBeUndefined();
  });

  it('should include description from schema in dependency info', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const instructions = generateInstructions(context, 'specs', tempDir);

    // spec-driven schema has descriptions for all artifacts
    expect(instructions.dependencies[0].description).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: printStatusText done+unverified counting
// ---------------------------------------------------------------------------

describe('printStatusText done+unverified counting', () => {
  let tempDir: string;
  let logOutput: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-status-'));
    logOutput = [];
    originalLog = console.log;
    console.log = (...args: any[]) => {
      logOutput.push(args.join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should count unverified artifacts in progress total', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });

    // Only file exists, no metadata → 'unverified'
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal');

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const status = formatChangeStatus(context);
    printStatusText(status);

    const progressLine = logOutput.find(l => l.includes('artifacts complete'));
    expect(progressLine).toContain('1/4 artifacts complete');
  });

  it('should count done artifacts in progress total', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });

    // File + metadata → 'done'
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal');
    writeArtifactMeta(changeDir, {
      proposal: { completed_at: '2025-06-01T12:00:00Z' },
    });

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const status = formatChangeStatus(context);
    printStatusText(status);

    const progressLine = logOutput.find(l => l.includes('artifacts complete'));
    expect(progressLine).toContain('1/4 artifacts complete');
  });

  it('should count mixed done+unverified correctly', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });

    // proposal: done (has metadata)
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal');
    // design: unverified (file only)
    fs.writeFileSync(path.join(changeDir, 'design.md'), '# Design');

    writeArtifactMeta(changeDir, {
      proposal: { completed_at: '2025-06-01T12:00:00Z' },
    });

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const status = formatChangeStatus(context);
    printStatusText(status);

    const progressLine = logOutput.find(l => l.includes('artifacts complete'));
    expect(progressLine).toContain('2/4 artifacts complete');
  });

  it('should show 0/N when nothing is complete', () => {
    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const status = formatChangeStatus(context);
    printStatusText(status);

    const progressLine = logOutput.find(l => l.includes('artifacts complete'));
    expect(progressLine).toContain('0/4 artifacts complete');
  });

  it('should show All artifacts complete when everything is done or unverified', () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'test-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true });

    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal');
    fs.writeFileSync(path.join(changeDir, 'design.md'), '# Design');
    fs.writeFileSync(path.join(changeDir, 'specs', 'test.md'), '# Spec');
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Tasks');

    const context = loadChangeContext(tempDir, 'test-change', 'spec-driven');
    const status = formatChangeStatus(context);
    printStatusText(status);

    const progressLine = logOutput.find(l => l.includes('artifacts complete'));
    expect(progressLine).toContain('4/4 artifacts complete');
    expect(logOutput.some(l => l.includes('All artifacts complete!'))).toBe(true);
  });
});
