// Types
export {
  ArtifactSchema,
  SchemaYamlSchema,
  hasTemplate,
  type Artifact,
  type SchemaYaml,
  type CompletedSet,
  type StaleSet,
  type BlockedArtifacts,
} from './types.js';

// Schema loading and validation
export { loadSchema, parseSchema, SchemaValidationError } from './schema.js';

// Graph operations
export { ArtifactGraph } from './graph.js';

// State detection
export { detectCompleted, detectStale, getArtifactMtime } from './state.js';

// Schema resolution
export {
  resolveSchema,
  listSchemas,
  listBlueprintSchemas,
  listAllSchemas,
  listSchemasWithInfo,
  getSchemaDir,
  getPackageSchemasDir,
  getPackageBlueprintsSchemasDir,
  getUserSchemasDir,
  getUserBlueprintsSchemasDir,
  getProjectSchemasDir,
  getProjectBlueprintsSchemasDir,
  SchemaLoadError,
  type SchemaInfo,
  type SchemaSource,
} from './resolver.js';

// Instruction loading
export {
  loadTemplate,
  loadChangeContext,
  generateInstructions,
  formatChangeStatus,
  TemplateLoadError,
  type ChangeContext,
  type ArtifactInstructions,
  type DependencyInfo,
  type ArtifactStatus,
  type ChangeStatus,
} from './instruction-loader.js';
