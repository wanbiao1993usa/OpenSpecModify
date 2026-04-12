import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveSchema,
  listSchemas,
  listBlueprintSchemas,
  listAllSchemas,
  listSchemasWithInfo,
  SchemaLoadError,
  getSchemaDir,
  getPackageSchemasDir,
  getPackageBlueprintsSchemasDir,
  getUserSchemasDir,
  getUserBlueprintsSchemasDir,
  getProjectSchemasDir,
  getProjectBlueprintsSchemasDir,
} from '../../../src/core/artifact-graph/resolver.js';

describe('artifact-graph/resolver', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `openspec-resolver-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getPackageSchemasDir', () => {
    it('should return a valid path', () => {
      const schemasDir = getPackageSchemasDir();
      expect(typeof schemasDir).toBe('string');
      expect(schemasDir.length).toBeGreaterThan(0);
    });
  });

  describe('getUserSchemasDir', () => {
    it('should use XDG_DATA_HOME when set', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userDir = getUserSchemasDir();
      expect(userDir).toBe(path.join(tempDir, 'openspec', 'schemas'));
    });
  });

  describe('getSchemaDir', () => {
    it('should return null for non-existent schema', () => {
      const dir = getSchemaDir('nonexistent-schema');
      expect(dir).toBeNull();
    });

    it('should return package dir for built-in schema', () => {
      const dir = getSchemaDir('spec-driven');
      expect(dir).not.toBeNull();
      expect(dir).toContain('schemas');
      expect(dir).toContain('spec-driven');
    });

    it('should prefer user override directory', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'spec-driven');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(userSchemaDir, 'schema.yaml'),
        'name: custom\nversion: 1\nartifacts: []'
      );

      const dir = getSchemaDir('spec-driven');
      expect(dir).toBe(userSchemaDir);
    });
  });

  describe('resolveSchema', () => {
    it('should return built-in spec-driven schema', () => {
      const schema = resolveSchema('spec-driven');

      expect(schema.name).toBe('spec-driven');
      expect(schema.version).toBe(1);
      expect(schema.artifacts.length).toBeGreaterThan(0);
    });

    it('should strip .yaml extension from name', () => {
      const schema1 = resolveSchema('spec-driven');
      const schema2 = resolveSchema('spec-driven.yaml');

      expect(schema1).toEqual(schema2);
    });

    it('should strip .yml extension from name', () => {
      const schema1 = resolveSchema('spec-driven');
      const schema2 = resolveSchema('spec-driven.yml');

      expect(schema1).toEqual(schema2);
    });

    it('should prefer user override over built-in', () => {
      // Set up global data dir
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'spec-driven');
      fs.mkdirSync(userSchemaDir, { recursive: true });

      // Create a custom schema with same name as built-in
      const customSchema = `
name: custom-override
version: 99
artifacts:
  - id: custom
    generates: custom.md
    instruction: Create the artifact
    description: Custom artifact
    template: custom.md
`;
      fs.writeFileSync(path.join(userSchemaDir, 'schema.yaml'), customSchema);

      const schema = resolveSchema('spec-driven');

      expect(schema.name).toBe('custom-override');
      expect(schema.version).toBe(99);
    });

    it('should validate user override and throw on invalid schema', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'spec-driven');
      fs.mkdirSync(userSchemaDir, { recursive: true });

      // Create an invalid schema (missing required fields)
      const invalidSchema = `
name: invalid
version: 1
artifacts:
  - id: broken
    # missing generates, description, template
`;
      fs.writeFileSync(path.join(userSchemaDir, 'schema.yaml'), invalidSchema);

      expect(() => resolveSchema('spec-driven')).toThrow(SchemaLoadError);
    });

    it('should include file path in validation error message', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'spec-driven');
      fs.mkdirSync(userSchemaDir, { recursive: true });

      const invalidSchema = `
name: invalid
version: 1
artifacts:
  - id: broken
`;
      const schemaPath = path.join(userSchemaDir, 'schema.yaml');
      fs.writeFileSync(schemaPath, invalidSchema);

      try {
        resolveSchema('spec-driven');
        expect.fail('Should have thrown');
      } catch (e) {
        const error = e as SchemaLoadError;
        expect(error.message).toContain(schemaPath);
        expect(error.schemaPath).toBe(schemaPath);
        expect(error.cause).toBeDefined();
      }
    });

    it('should detect cycles in user override schemas', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'spec-driven');
      fs.mkdirSync(userSchemaDir, { recursive: true });

      // Create a schema with cyclic dependencies
      const cyclicSchema = `
name: cyclic
version: 1
artifacts:
  - id: a
    generates: a.md
    instruction: Create the artifact
    description: A
    template: a.md
    requires: [b]
  - id: b
    generates: b.md
    instruction: Create the artifact
    description: B
    template: b.md
    requires: [a]
`;
      fs.writeFileSync(path.join(userSchemaDir, 'schema.yaml'), cyclicSchema);

      expect(() => resolveSchema('spec-driven')).toThrow(/Cyclic dependency/);
    });

    it('should detect invalid requires references in user override schemas', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'spec-driven');
      fs.mkdirSync(userSchemaDir, { recursive: true });

      // Create a schema with invalid requires reference
      const invalidRefSchema = `
name: invalid-ref
version: 1
artifacts:
  - id: a
    generates: a.md
    instruction: Create the artifact
    description: A
    template: a.md
    requires: [nonexistent]
`;
      fs.writeFileSync(path.join(userSchemaDir, 'schema.yaml'), invalidRefSchema);

      expect(() => resolveSchema('spec-driven')).toThrow(/does not exist/);
    });

    it('should throw SchemaLoadError on YAML syntax errors', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'spec-driven');
      fs.mkdirSync(userSchemaDir, { recursive: true });

      // Create malformed YAML
      const malformedYaml = `
name: bad
version: [[[invalid yaml
`;
      const schemaPath = path.join(userSchemaDir, 'schema.yaml');
      fs.writeFileSync(schemaPath, malformedYaml);

      try {
        resolveSchema('spec-driven');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(SchemaLoadError);
        const error = e as SchemaLoadError;
        expect(error.message).toContain('Failed to parse');
        expect(error.message).toContain(schemaPath);
      }
    });

    it('should fall back to built-in when user override not found', () => {
      process.env.XDG_DATA_HOME = tempDir;
      // Don't create any user schemas

      const schema = resolveSchema('spec-driven');

      expect(schema.name).toBe('spec-driven');
      expect(schema.version).toBe(1);
    });

    it('should throw when schema not found', () => {
      expect(() => resolveSchema('nonexistent-schema')).toThrow(/not found/);
    });

    it('should list available schemas in error message', () => {
      try {
        resolveSchema('nonexistent');
        expect.fail('Should have thrown');
      } catch (e) {
        const error = e as Error;
        expect(error.message).toContain('spec-driven');
      }
    });
  });

  describe('listSchemas', () => {
    it('should list built-in schemas', () => {
      const schemas = listSchemas();

      expect(schemas).toContain('spec-driven');
    });

    it('should include user override schemas', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'custom-workflow');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      fs.writeFileSync(path.join(userSchemaDir, 'schema.yaml'), 'name: custom\nversion: 1\nartifacts: []');

      const schemas = listSchemas();

      expect(schemas).toContain('custom-workflow');
      expect(schemas).toContain('spec-driven');
    });

    it('should deduplicate schemas with same name', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'spec-driven');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      // Override spec-driven
      fs.writeFileSync(path.join(userSchemaDir, 'schema.yaml'), 'name: custom\nversion: 1\nartifacts: []');

      const schemas = listSchemas();

      // Should only appear once
      const count = schemas.filter(s => s === 'spec-driven').length;
      expect(count).toBe(1);
    });

    it('should return sorted list', () => {
      const schemas = listSchemas();

      const sorted = [...schemas].sort();
      expect(schemas).toEqual(sorted);
    });

    it('should only include directories with schema.yaml', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemasBase = path.join(tempDir, 'openspec', 'schemas');

      // Create a directory without schema.yaml
      const emptyDir = path.join(userSchemasBase, 'empty-dir');
      fs.mkdirSync(emptyDir, { recursive: true });

      // Create a valid schema directory
      const validDir = path.join(userSchemasBase, 'valid-schema');
      fs.mkdirSync(validDir, { recursive: true });
      fs.writeFileSync(path.join(validDir, 'schema.yaml'), 'name: valid\nversion: 1\nartifacts: []');

      const schemas = listSchemas();

      expect(schemas).toContain('valid-schema');
      expect(schemas).not.toContain('empty-dir');
    });
  });

  // =========================================================================
  // Project-local schema tests
  // =========================================================================

  describe('getProjectSchemasDir', () => {
    it('should return correct path', () => {
      const projectRoot = '/path/to/project';
      const schemasDir = getProjectSchemasDir(projectRoot);
      expect(schemasDir).toBe(path.join('/path/to/project', 'openspec', 'schemas'));
    });

    it('should work with relative-looking paths', () => {
      const schemasDir = getProjectSchemasDir('./my-project');
      expect(schemasDir).toBe(path.join('my-project', 'openspec', 'schemas'));
    });
  });

  describe('getSchemaDir with projectRoot', () => {
    it('should return null for non-existent project schema', () => {
      const dir = getSchemaDir('nonexistent-schema', tempDir);
      expect(dir).toBeNull();
    });

    it('should prefer project-local schema over user override', () => {
      // Set up user override
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'my-schema');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(userSchemaDir, 'schema.yaml'),
        'name: user-version\nversion: 1\nartifacts: []'
      );

      // Set up project-local schema
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'my-schema');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        'name: project-version\nversion: 2\nartifacts: []'
      );

      const dir = getSchemaDir('my-schema', projectRoot);
      expect(dir).toBe(projectSchemaDir);
    });

    it('should prefer project-local schema over package built-in', () => {
      // Set up project-local schema that overrides built-in
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'spec-driven');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        'name: project-spec-driven\nversion: 99\nartifacts: []\n'
      );

      const dir = getSchemaDir('spec-driven', projectRoot);
      expect(dir).toBe(projectSchemaDir);
    });

    it('should fall back to user override when no project-local schema', () => {
      // Set up user override only
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'user-only-schema');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(userSchemaDir, 'schema.yaml'),
        'name: user-only\nversion: 1\nartifacts: []'
      );

      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      const dir = getSchemaDir('user-only-schema', projectRoot);
      expect(dir).toBe(userSchemaDir);
    });

    it('should fall back to package built-in when no project or user schema', () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      const dir = getSchemaDir('spec-driven', projectRoot);
      expect(dir).not.toBeNull();
      // Should be package path, not project or user
      expect(dir).not.toContain(projectRoot);
    });

    it('should maintain backward compatibility when projectRoot not provided', () => {
      // Set up user override
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'my-schema');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(userSchemaDir, 'schema.yaml'),
        'name: user-version\nversion: 1\nartifacts: []'
      );

      // Set up project-local schema (should be ignored when projectRoot not provided)
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'my-schema');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        'name: project-version\nversion: 2\nartifacts: []'
      );

      // Without projectRoot, should get user version
      const dir = getSchemaDir('my-schema');
      expect(dir).toBe(userSchemaDir);
    });
  });

  describe('resolveSchema with projectRoot', () => {
    it('should resolve project-local schema', () => {
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'team-workflow');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        `name: team-workflow
version: 1
description: Team workflow
artifacts:
  - id: spec
    generates: spec.md
    instruction: Create the artifact
    description: Specification
    template: spec.md
`
      );

      const schema = resolveSchema('team-workflow', projectRoot);
      expect(schema.name).toBe('team-workflow');
      expect(schema.version).toBe(1);
    });

    it('should prefer project-local over user override when resolving', () => {
      // Set up user override
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'shared-schema');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(userSchemaDir, 'schema.yaml'),
        `name: user-version
version: 1
artifacts:
  - id: user-artifact
    generates: user.md
    instruction: Create the artifact
    description: User artifact
    template: user.md
`
      );

      // Set up project-local schema
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'shared-schema');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        `name: project-version
version: 2
artifacts:
  - id: project-artifact
    generates: project.md
    instruction: Create the artifact
    description: Project artifact
    template: project.md
`
      );

      const schema = resolveSchema('shared-schema', projectRoot);
      expect(schema.name).toBe('project-version');
      expect(schema.version).toBe(2);
    });
  });

  describe('listSchemas with projectRoot', () => {
    it('should include project-local schemas', () => {
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'team-workflow');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        'name: team-workflow\nversion: 1\nartifacts: []'
      );

      const schemas = listSchemas(projectRoot);
      expect(schemas).toContain('team-workflow');
      expect(schemas).toContain('spec-driven'); // built-in still included
    });

    it('should deduplicate project-local schema that shadows user override', () => {
      // Set up user override
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'my-schema');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(userSchemaDir, 'schema.yaml'),
        'name: user\nversion: 1\nartifacts: []'
      );

      // Set up project-local schema with same name
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'my-schema');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        'name: project\nversion: 2\nartifacts: []'
      );

      const schemas = listSchemas(projectRoot);
      const count = schemas.filter(s => s === 'my-schema').length;
      expect(count).toBe(1);
    });

    it('should maintain backward compatibility when projectRoot not provided', () => {
      // Set up project-local schema
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'project-only');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        'name: project-only\nversion: 1\nartifacts: []'
      );

      // Without projectRoot, project-only schema should not appear
      const schemas = listSchemas();
      expect(schemas).not.toContain('project-only');
    });
  });

  describe('listSchemasWithInfo with projectRoot', () => {
    it('should return source: project for project-local schemas', () => {
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'team-workflow');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        `name: team-workflow
version: 1
description: Team workflow
artifacts:
  - id: spec
    generates: spec.md
    instruction: Create the artifact
    description: Specification
    template: spec.md
`
      );

      const schemas = listSchemasWithInfo(projectRoot);
      const teamSchema = schemas.find(s => s.name === 'team-workflow');
      expect(teamSchema).toBeDefined();
      expect(teamSchema!.source).toBe('project');
    });

    it('should return source: package for built-in schemas', () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      const schemas = listSchemasWithInfo(projectRoot);
      const specDriven = schemas.find(s => s.name === 'spec-driven');
      expect(specDriven).toBeDefined();
      expect(specDriven!.source).toBe('package');
    });

    it('should return source: user for user override schemas', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'user-custom');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(userSchemaDir, 'schema.yaml'),
        `name: user-custom
version: 1
description: User custom
artifacts:
  - id: artifact
    generates: artifact.md
    instruction: Create the artifact
    description: Artifact
    template: artifact.md
`
      );

      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      const schemas = listSchemasWithInfo(projectRoot);
      const userSchema = schemas.find(s => s.name === 'user-custom');
      expect(userSchema).toBeDefined();
      expect(userSchema!.source).toBe('user');
    });

    it('should show project source when project-local shadows user override', () => {
      // Set up user override
      process.env.XDG_DATA_HOME = tempDir;
      const userSchemaDir = path.join(tempDir, 'openspec', 'schemas', 'shared');
      fs.mkdirSync(userSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(userSchemaDir, 'schema.yaml'),
        `name: user-shared
version: 1
description: User shared
artifacts:
  - id: a
    generates: a.md
    instruction: Create the artifact
    description: A
    template: a.md
`
      );

      // Set up project-local with same name
      const projectRoot = path.join(tempDir, 'project');
      const projectSchemaDir = path.join(projectRoot, 'openspec', 'schemas', 'shared');
      fs.mkdirSync(projectSchemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectSchemaDir, 'schema.yaml'),
        `name: project-shared
version: 2
description: Project shared
artifacts:
  - id: b
    generates: b.md
    instruction: Create the artifact
    description: B
    template: b.md
`
      );

      const schemas = listSchemasWithInfo(projectRoot);
      const sharedSchema = schemas.find(s => s.name === 'shared');
      expect(sharedSchema).toBeDefined();
      expect(sharedSchema!.source).toBe('project');
      expect(sharedSchema!.description).toBe('Project shared'); // project version wins
    });
  });

  // =========================================================================
  // Blueprints tests
  // =========================================================================

  describe('blueprint directory helpers', () => {
    it('getProjectBlueprintsSchemasDir returns correct path', () => {
      const dir = getProjectBlueprintsSchemasDir('/my/project');
      expect(dir).toBe(path.join('/my/project', 'openspec', 'blueprints', 'schemas'));
    });

    it('getUserBlueprintsSchemasDir uses XDG_DATA_HOME', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const dir = getUserBlueprintsSchemasDir();
      expect(dir).toBe(path.join(tempDir, 'openspec', 'blueprints', 'schemas'));
    });

    it('getPackageBlueprintsSchemasDir returns a valid path', () => {
      const dir = getPackageBlueprintsSchemasDir();
      expect(typeof dir).toBe('string');
      expect(dir).toContain('blueprints');
    });
  });

  describe('getSchemaDir with blueprints', () => {
    it('should resolve project blueprint when no project schema exists', () => {
      const projectRoot = path.join(tempDir, 'project');
      const bpDir = path.join(projectRoot, 'openspec', 'blueprints', 'schemas', 'reviewed-flow');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'), 'name: reviewed-flow\nversion: 1\nartifacts: []');

      const dir = getSchemaDir('reviewed-flow', projectRoot);
      expect(dir).toBe(bpDir);
    });

    it('should prefer project schema over project blueprint', () => {
      const projectRoot = path.join(tempDir, 'project');
      const bpDir = path.join(projectRoot, 'openspec', 'blueprints', 'schemas', 'my-flow');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'), 'name: bp\nversion: 1\nartifacts: []');

      const schemaDir = path.join(projectRoot, 'openspec', 'schemas', 'my-flow');
      fs.mkdirSync(schemaDir, { recursive: true });
      fs.writeFileSync(path.join(schemaDir, 'schema.yaml'), 'name: schema\nversion: 2\nartifacts: []');

      const dir = getSchemaDir('my-flow', projectRoot);
      expect(dir).toBe(schemaDir);
    });

    it('should resolve user blueprint when no user schema exists', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const bpDir = path.join(tempDir, 'openspec', 'blueprints', 'schemas', 'curated-flow');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'), 'name: curated\nversion: 1\nartifacts: []');

      const dir = getSchemaDir('curated-flow');
      expect(dir).toBe(bpDir);
    });

    it('should prefer user schema over user blueprint', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const bpDir = path.join(tempDir, 'openspec', 'blueprints', 'schemas', 'my-flow');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'), 'name: bp\nversion: 1\nartifacts: []');

      const schemaDir = path.join(tempDir, 'openspec', 'schemas', 'my-flow');
      fs.mkdirSync(schemaDir, { recursive: true });
      fs.writeFileSync(path.join(schemaDir, 'schema.yaml'), 'name: schema\nversion: 2\nartifacts: []');

      const dir = getSchemaDir('my-flow');
      expect(dir).toBe(schemaDir);
    });
  });

  describe('listBlueprintSchemas', () => {
    it('should list only blueprint schemas', () => {
      const projectRoot = path.join(tempDir, 'project');
      const bpDir = path.join(projectRoot, 'openspec', 'blueprints', 'schemas', 'reviewed');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'), 'name: reviewed\nversion: 1\nartifacts: []');

      const schemaDir = path.join(projectRoot, 'openspec', 'schemas', 'custom');
      fs.mkdirSync(schemaDir, { recursive: true });
      fs.writeFileSync(path.join(schemaDir, 'schema.yaml'), 'name: custom\nversion: 1\nartifacts: []');

      const blueprints = listBlueprintSchemas(projectRoot);
      expect(blueprints).toContain('reviewed');
      expect(blueprints).not.toContain('custom');
    });
  });

  describe('listAllSchemas', () => {
    it('should include both schemas and blueprints', () => {
      const projectRoot = path.join(tempDir, 'project');
      const bpDir = path.join(projectRoot, 'openspec', 'blueprints', 'schemas', 'reviewed');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'), 'name: reviewed\nversion: 1\nartifacts: []');

      const schemaDir = path.join(projectRoot, 'openspec', 'schemas', 'custom');
      fs.mkdirSync(schemaDir, { recursive: true });
      fs.writeFileSync(path.join(schemaDir, 'schema.yaml'), 'name: custom\nversion: 1\nartifacts: []');

      const all = listAllSchemas(projectRoot);
      expect(all).toContain('reviewed');
      expect(all).toContain('custom');
      expect(all).toContain('spec-driven');
    });

    it('should deduplicate same-name schemas', () => {
      const projectRoot = path.join(tempDir, 'project');
      const bpDir = path.join(projectRoot, 'openspec', 'blueprints', 'schemas', 'shared');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'), 'name: shared\nversion: 1\nartifacts: []');

      const schemaDir = path.join(projectRoot, 'openspec', 'schemas', 'shared');
      fs.mkdirSync(schemaDir, { recursive: true });
      fs.writeFileSync(path.join(schemaDir, 'schema.yaml'), 'name: shared\nversion: 2\nartifacts: []');

      const all = listAllSchemas(projectRoot);
      expect(all.filter(s => s === 'shared').length).toBe(1);
    });
  });

  describe('listSchemasWithInfo with blueprints', () => {
    it('should return correct source for blueprint schemas', () => {
      const projectRoot = path.join(tempDir, 'project');
      const bpDir = path.join(projectRoot, 'openspec', 'blueprints', 'schemas', 'reviewed');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'),
        `name: reviewed\nversion: 1\ndescription: Expert-reviewed\nartifacts:\n  - id: spec\n    generates: spec.md\n    instruction: Create\n    description: Spec\n    template: spec.md\n`);

      const schemas = listSchemasWithInfo(projectRoot);
      const reviewed = schemas.find(s => s.name === 'reviewed');
      expect(reviewed).toBeDefined();
      expect(reviewed!.source).toBe('project-blueprint');
    });

    it('should shadow blueprint with same-name schema', () => {
      const projectRoot = path.join(tempDir, 'project');
      const bpDir = path.join(projectRoot, 'openspec', 'blueprints', 'schemas', 'flow');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'),
        `name: flow-bp\nversion: 1\ndescription: Blueprint\nartifacts:\n  - id: a\n    generates: a.md\n    instruction: Create\n    description: A\n    template: a.md\n`);

      const schemaDir = path.join(projectRoot, 'openspec', 'schemas', 'flow');
      fs.mkdirSync(schemaDir, { recursive: true });
      fs.writeFileSync(path.join(schemaDir, 'schema.yaml'),
        `name: flow-schema\nversion: 2\ndescription: Schema version\nartifacts:\n  - id: b\n    generates: b.md\n    instruction: Create\n    description: B\n    template: b.md\n`);

      const schemas = listSchemasWithInfo(projectRoot);
      const flow = schemas.find(s => s.name === 'flow');
      expect(flow).toBeDefined();
      expect(flow!.source).toBe('project');
      expect(flow!.description).toBe('Schema version');
    });

    it('should show user-blueprint source', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const bpDir = path.join(tempDir, 'openspec', 'blueprints', 'schemas', 'user-curated');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(path.join(bpDir, 'schema.yaml'),
        `name: user-curated\nversion: 1\ndescription: User curated\nartifacts:\n  - id: x\n    generates: x.md\n    instruction: Create\n    description: X\n    template: x.md\n`);

      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });

      const schemas = listSchemasWithInfo(projectRoot);
      const curated = schemas.find(s => s.name === 'user-curated');
      expect(curated).toBeDefined();
      expect(curated!.source).toBe('user-blueprint');
    });
  });
});
