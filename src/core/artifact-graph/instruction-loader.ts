import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSchemaDir, resolveSchema } from './resolver.js';
import { ArtifactGraph } from './graph.js';
import { detectCompleted, detectStale } from './state.js';
import { resolveSchemaForChange } from '../../utils/change-metadata.js';
import { readProjectConfig, validateConfigRules } from '../project-config.js';
import { readArtifactMetadata } from '../../utils/artifact-metadata.js';
import type { Artifact, CompletedSet, StaleSet } from './types.js';
import { isLightArtifact } from './types.js';

// Session-level cache for validation warnings (avoid repeating same warnings)
const shownWarnings = new Set<string>();

/**
 * Error thrown when loading a template fails.
 */
export class TemplateLoadError extends Error {
  constructor(
    message: string,
    public readonly templatePath: string
  ) {
    super(message);
    this.name = 'TemplateLoadError';
  }
}

/**
 * Change context containing graph, completion state, and metadata.
 */
export interface ChangeContext {
  /** The artifact dependency graph */
  graph: ArtifactGraph;
  /** Set of completed artifact IDs */
  completed: CompletedSet;
  /** Set of stale artifact IDs (completed but upstream has newer files) */
  stale: StaleSet;
  /** Schema name being used */
  schemaName: string;
  /** Change name */
  changeName: string;
  /** Path to the change directory */
  changeDir: string;
  /** Project root directory */
  projectRoot: string;
}

/**
 * Enriched instructions for creating an artifact.
 * For heavy-mode artifacts: includes instruction, template, outputPath, description.
 * For light-mode artifacts: includes task and dependencies with output paths.
 */
export interface ArtifactInstructions {
  /** Change name */
  changeName: string;
  /** Artifact ID */
  artifactId: string;
  /** Schema name */
  schemaName: string;
  /** Full path to change directory */
  changeDir: string;
  /** Output path pattern (e.g., "proposal.md") — heavy mode only */
  outputPath: string;
  /** Artifact description — heavy mode only */
  description: string;
  /** Guidance on how to create this artifact (from schema instruction field) — heavy mode only */
  instruction: string | undefined;
  /** Project context from config (constraints/background for AI, not to be included in output) */
  context: string | undefined;
  /** Artifact-specific rules from config (constraints for AI, not to be included in output) */
  rules: string[] | undefined;
  /** Template content (structure to follow) — heavy mode only */
  template: string;
  /** Dependencies with completion status and paths */
  dependencies: DependencyInfo[];
  /** Artifacts that become available after completing this one */
  unlocks: string[];
  /** Task description — light mode only */
  task?: string;
}

/**
 * Dependency information including path and description.
 */
export interface DependencyInfo {
  /** Artifact ID */
  id: string;
  /** Whether the dependency is completed */
  done: boolean;
  /** Relative output path of the dependency (e.g., "proposal.md") — heavy mode */
  path: string;
  /** Description of the dependency artifact — heavy mode */
  description: string;
  /** Output path for light-mode dependency (e.g., ".artifact-output/macro.txt") */
  outputPath?: string;
  /** Summary from .artifact-meta.yaml */
  summary?: string;
}

/**
 * Status of a single artifact in the workflow.
 */
export interface ArtifactStatus {
  /** Artifact ID */
  id: string;
  /** Output path pattern */
  outputPath: string;
  /** Status: done, unverified, stale, ready, or blocked */
  status: 'done' | 'unverified' | 'stale' | 'ready' | 'blocked';
  /** Missing dependencies (only for blocked) */
  missingDeps?: string[];
}

/**
 * Formatted change status.
 */
export interface ChangeStatus {
  /** Change name */
  changeName: string;
  /** Schema name */
  schemaName: string;
  /** Whether all artifacts are complete */
  isComplete: boolean;
  /** Artifact IDs required before apply phase (from schema's apply.requires) */
  applyRequires: string[];
  /** Status of each artifact */
  artifacts: ArtifactStatus[];
}

/**
 * Loads a template from a schema's templates directory.
 *
 * @param schemaName - Schema name (e.g., "spec-driven")
 * @param templatePath - Relative path within the templates directory (e.g., "proposal.md")
 * @param projectRoot - Optional project root for project-local schema resolution
 * @returns The template content
 * @throws TemplateLoadError if the template cannot be loaded
 */
export function loadTemplate(
  schemaName: string,
  templatePath: string,
  projectRoot?: string
): string {
  const schemaDir = getSchemaDir(schemaName, projectRoot);
  if (!schemaDir) {
    throw new TemplateLoadError(
      `Schema '${schemaName}' not found`,
      templatePath
    );
  }

  const fullPath = path.join(schemaDir, 'templates', templatePath);

  if (!fs.existsSync(fullPath)) {
    throw new TemplateLoadError(
      `Template not found: ${fullPath}`,
      fullPath
    );
  }

  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (err) {
    const ioError = err instanceof Error ? err : new Error(String(err));
    throw new TemplateLoadError(
      `Failed to read template: ${ioError.message}`,
      fullPath
    );
  }
}

/**
 * Loads change context combining graph and completion state.
 *
 * Schema resolution order:
 * 1. Explicit schemaName parameter (if provided)
 * 2. Schema from .openspec.yaml metadata (if exists in change directory)
 * 3. Default 'spec-driven'
 *
 * @param projectRoot - Project root directory
 * @param changeName - Change name
 * @param schemaName - Optional schema name override. If not provided, auto-detected from metadata.
 * @returns Change context with graph, completed set, and metadata
 */
export function loadChangeContext(
  projectRoot: string,
  changeName: string,
  schemaName?: string
): ChangeContext {
  const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);

  // Resolve schema: explicit > metadata > default
  const resolvedSchemaName = resolveSchemaForChange(changeDir, schemaName);

  const schema = resolveSchema(resolvedSchemaName, projectRoot);
  const graph = ArtifactGraph.fromSchema(schema);
  const completed = detectCompleted(graph, changeDir);
  const stale = detectStale(graph, completed, changeDir);

  return {
    graph,
    completed,
    stale,
    schemaName: resolvedSchemaName,
    changeName,
    changeDir,
    projectRoot,
  };
}

/**
 * Generates enriched instructions for creating an artifact.
 *
 * Instruction injection order:
 * 1. <context> - Project context from config (if present)
 * 2. <rules> - Artifact-specific rules from config (if present)
 * 3. <template> - Schema's template content
 *
 * @param context - Change context
 * @param artifactId - Artifact ID to generate instructions for
 * @param projectRoot - Project root directory (for reading config)
 * @returns Enriched artifact instructions
 * @throws Error if artifact not found
 */
export function generateInstructions(
  context: ChangeContext,
  artifactId: string,
  projectRoot?: string
): ArtifactInstructions {
  const artifact = context.graph.getArtifact(artifactId);
  if (!artifact) {
    throw new Error(`Artifact '${artifactId}' not found in schema '${context.schemaName}'`);
  }

  const unlocks = getUnlockedArtifacts(context.graph, artifactId);

  // Use projectRoot from context if not explicitly provided
  const effectiveProjectRoot = projectRoot ?? context.projectRoot;

  // Try to read project config for context and rules
  let projectConfig = null;
  if (effectiveProjectRoot) {
    try {
      projectConfig = readProjectConfig(effectiveProjectRoot);
    } catch {
      // If config read fails, continue without config
    }
  }

  // Validate rules artifact IDs if config has rules (only once per session)
  if (projectConfig?.rules) {
    const validArtifactIds = new Set(context.graph.getAllArtifacts().map((a) => a.id));
    const warnings = validateConfigRules(
      projectConfig.rules,
      validArtifactIds,
      context.schemaName
    );

    // Show each unique warning only once per session
    for (const warning of warnings) {
      if (!shownWarnings.has(warning)) {
        console.warn(warning);
        shownWarnings.add(warning);
      }
    }
  }

  // Extract context and rules as separate fields (not prepended to template)
  const configContext = projectConfig?.context?.trim() || undefined;
  const rulesForArtifact = projectConfig?.rules?.[artifactId];
  const configRules = rulesForArtifact && rulesForArtifact.length > 0 ? rulesForArtifact : undefined;

  // Light-mode artifact: return task + dependencies with output paths
  if (isLightArtifact(artifact)) {
    const dependencies = getLightDependencyInfo(artifact, context.graph, context.completed, context.changeDir);
    return {
      changeName: context.changeName,
      artifactId: artifact.id,
      schemaName: context.schemaName,
      changeDir: context.changeDir,
      outputPath: `.artifact-output/${artifact.id}.txt`,
      description: '',
      instruction: undefined,
      context: configContext,
      rules: configRules,
      template: '',
      dependencies,
      unlocks,
      task: artifact.task,
    };
  }

  // Heavy-mode artifact: existing behavior
  const templateContent = loadTemplate(context.schemaName, artifact.template!, context.projectRoot);
  const dependencies = getDependencyInfo(artifact, context.graph, context.completed);

  return {
    changeName: context.changeName,
    artifactId: artifact.id,
    schemaName: context.schemaName,
    changeDir: context.changeDir,
    outputPath: artifact.generates!,
    description: artifact.description || '',
    instruction: artifact.instruction,
    context: configContext,
    rules: configRules,
    template: templateContent,
    dependencies,
    unlocks,
  };
}

/**
 * Gets dependency info including paths and descriptions (heavy mode).
 */
function getDependencyInfo(
  artifact: Artifact,
  graph: ArtifactGraph,
  completed: CompletedSet
): DependencyInfo[] {
  return artifact.requires.map(id => {
    const depArtifact = graph.getArtifact(id);
    return {
      id,
      done: completed.has(id),
      path: depArtifact?.generates ?? id,
      description: depArtifact?.description ?? '',
    };
  });
}

/**
 * Gets dependency info for light-mode artifacts.
 * Returns outputPath (relative to changeDir) and summary from metadata.
 */
function getLightDependencyInfo(
  artifact: Artifact,
  graph: ArtifactGraph,
  completed: CompletedSet,
  changeDir: string
): DependencyInfo[] {
  const artifactMeta = readArtifactMetadata(changeDir);

  return artifact.requires.map(id => {
    const depArtifact = graph.getArtifact(id);
    const meta = artifactMeta.artifacts[id];

    // Determine the output path based on whether dep is light or heavy
    let outputPath: string;
    if (depArtifact && isLightArtifact(depArtifact)) {
      outputPath = `.artifact-output/${id}.txt`;
    } else {
      outputPath = depArtifact?.generates ?? id;
    }

    return {
      id,
      done: completed.has(id),
      path: outputPath,
      description: depArtifact?.description ?? '',
      outputPath,
      summary: meta?.summary,
    };
  });
}

/**
 * Gets artifacts that become available after completing the given artifact.
 */
function getUnlockedArtifacts(graph: ArtifactGraph, artifactId: string): string[] {
  const unlocks: string[] = [];

  for (const artifact of graph.getAllArtifacts()) {
    if (artifact.requires.includes(artifactId)) {
      unlocks.push(artifact.id);
    }
  }

  return unlocks.sort();
}

/**
 * Formats the status of all artifacts in a change.
 *
 * @param context - Change context
 * @returns Formatted change status
 */
export function formatChangeStatus(context: ChangeContext): ChangeStatus {
  // Load schema to get apply phase configuration
  const schema = resolveSchema(context.schemaName, context.projectRoot);
  const applyRequires = schema.apply?.requires ?? schema.artifacts.map(a => a.id);

  const artifacts = context.graph.getAllArtifacts();
  const ready = new Set(context.graph.getNextArtifacts(context.completed));
  const blocked = context.graph.getBlocked(context.completed);

  // Read artifact metadata to distinguish done vs unverified
  const artifactMeta = readArtifactMetadata(context.changeDir);

  const artifactStatuses: ArtifactStatus[] = artifacts.map(artifact => {
    const outputPath = isLightArtifact(artifact)
      ? `.artifact-output/${artifact.id}.txt`
      : artifact.generates!;

    if (context.completed.has(artifact.id)) {
      // Check if it has artifact complete metadata
      const hasMeta = !!artifactMeta.artifacts[artifact.id];

      if (!hasMeta) {
        // File/output exists but no metadata → unverified
        return {
          id: artifact.id,
          outputPath,
          status: 'unverified' as const,
        };
      }

      // Has metadata — check if stale
      if (context.stale.has(artifact.id)) {
        return {
          id: artifact.id,
          outputPath,
          status: 'stale' as const,
        };
      }
      return {
        id: artifact.id,
        outputPath,
        status: 'done' as const,
      };
    }

    if (ready.has(artifact.id)) {
      return {
        id: artifact.id,
        outputPath,
        status: 'ready' as const,
      };
    }

    return {
      id: artifact.id,
      outputPath,
      status: 'blocked' as const,
      missingDeps: blocked[artifact.id] ?? [],
    };
  });

  // Sort by build order for consistent output
  const buildOrder = context.graph.getBuildOrder();
  const orderMap = new Map(buildOrder.map((id, idx) => [id, idx]));
  artifactStatuses.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

  return {
    changeName: context.changeName,
    schemaName: context.schemaName,
    isComplete: context.graph.isComplete(context.completed),
    applyRequires,
    artifacts: artifactStatuses,
  };
}
