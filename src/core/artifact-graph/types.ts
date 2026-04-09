import { z } from 'zod';

// Unified artifact definition schema
// - instruction (required): guidance on how to create this artifact
// - template (optional): structural template file to follow
// - generates (required): output file path or glob pattern
// Artifacts without a template automatically use lightweight behavior
// (metadata-first completion detection, richer dependency info).
export const ArtifactSchema = z.object({
  id: z.string().min(1, { error: 'Artifact ID is required' }),
  generates: z.string().min(1, { error: 'generates field is required' }),
  instruction: z.string().min(1, { error: 'instruction field is required' }),
  description: z.string().optional(),
  template: z.string().optional(),
  requires: z.array(z.string()).default([]),
});

// Apply phase configuration for schema-aware apply instructions
export const ApplyPhaseSchema = z.object({
  // Artifact IDs that must exist before apply is available
  requires: z.array(z.string()).min(1, { error: 'At least one required artifact' }),
  // Path to file with checkboxes for progress (relative to change dir), or null if no tracking
  tracks: z.string().nullable().optional(),
  // Custom guidance for the apply phase
  instruction: z.string().optional(),
});

// Full schema YAML structure
export const SchemaYamlSchema = z.object({
  name: z.string().min(1, { error: 'Schema name is required' }),
  version: z.number().int().positive({ error: 'Version must be a positive integer' }),
  description: z.string().optional(),
  artifacts: z.array(ArtifactSchema).min(1, { error: 'At least one artifact required' }),
  // Optional apply phase configuration (for schema-aware apply instructions)
  apply: ApplyPhaseSchema.optional(),
});

// Derived TypeScript types
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ApplyPhase = z.infer<typeof ApplyPhaseSchema>;
export type SchemaYaml = z.infer<typeof SchemaYamlSchema>;

/**
 * Determines if an artifact has no template (lightweight).
 * Lightweight artifacts use metadata-first completion detection
 * and richer dependency info (outputPath + summary).
 */
export function hasTemplate(artifact: Artifact): boolean {
  return !!artifact.template;
}

// Per-change metadata schema
// Note: schema field is validated at parse time against available schemas
// using a lazy import to avoid circular dependencies
export const ChangeMetadataSchema = z.object({
  // Required: which workflow schema this change uses
  schema: z.string().min(1, { message: 'schema is required' }),

  // Optional: creation timestamp (ISO date string or ISO datetime string)
  created: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, {
      message: 'created must be YYYY-MM-DD or ISO datetime format',
    })
    .optional(),

  // Optional: parent change name (for lineage tracking)
  parent: z.string().optional(),

  // Optional: source change name (for --from artifact reuse)
  from: z.string().optional(),
});

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>;

// Runtime state types (not Zod - internal only)

// Slice 1: Simple completion tracking via filesystem
export type CompletedSet = Set<string>;

// Set of stale artifact IDs
export type StaleSet = Set<string>;

// Return type for blocked query
export interface BlockedArtifacts {
  [artifactId: string]: string[];
}

