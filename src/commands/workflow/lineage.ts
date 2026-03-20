/**
 * Lineage Command
 *
 * Displays the iteration chain (lineage) of a change, showing parent-child relationships.
 */

import ora from 'ora';
import chalk from 'chalk';
import path from 'path';
import * as fs from 'fs';
import { readChangeMetadata } from '../../utils/change-metadata.js';
import { isColorDisabled } from './shared.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface LineageOptions {
  json?: boolean;
}

interface LineageNode {
  name: string;
  created: string | undefined;
  from: string | undefined;
  children: LineageNode[];
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

export async function lineageCommand(changeName: string | undefined, options: LineageOptions): Promise<void> {
  if (!changeName) {
    throw new Error('Missing required argument <change-name>');
  }

  const spinner = ora('Building lineage tree...').start();

  try {
    const projectRoot = process.cwd();
    const changesDir = path.join(projectRoot, 'openspec', 'changes');

    if (!fs.existsSync(changesDir)) {
      throw new Error('No changes directory found. Run "openspec init" first.');
    }

    // Read all changes and their metadata
    const entries = fs.readdirSync(changesDir, { withFileTypes: true });
    const changeMetadataMap = new Map<string, { created?: string; parent?: string; from?: string }>();

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.')) continue;
      const changeDir = path.join(changesDir, entry.name);
      try {
        const metadata = readChangeMetadata(changeDir, projectRoot);
        if (metadata) {
          changeMetadataMap.set(entry.name, {
            created: metadata.created,
            parent: metadata.parent,
            from: metadata.from,
          });
        } else {
          changeMetadataMap.set(entry.name, {});
        }
      } catch {
        changeMetadataMap.set(entry.name, {});
      }
    }

    // Verify the target change exists
    if (!changeMetadataMap.has(changeName)) {
      throw new Error(`Change '${changeName}' not found.`);
    }

    // Find the root of the lineage chain (walk up parents)
    let rootName = changeName;
    const visited = new Set<string>();
    while (true) {
      if (visited.has(rootName)) break; // Avoid infinite loops
      visited.add(rootName);
      const meta = changeMetadataMap.get(rootName);
      if (meta?.parent && changeMetadataMap.has(meta.parent)) {
        rootName = meta.parent;
      } else {
        break;
      }
    }

    // Build the tree from root downward
    const childrenMap = new Map<string, string[]>();
    for (const [name, meta] of changeMetadataMap) {
      if (meta.parent) {
        const existing = childrenMap.get(meta.parent) ?? [];
        existing.push(name);
        childrenMap.set(meta.parent, existing);
      }
    }

    function buildTree(name: string): LineageNode {
      const meta = changeMetadataMap.get(name);
      const children = (childrenMap.get(name) ?? []).sort();
      return {
        name,
        created: meta?.created,
        from: meta?.from,
        children: children.map(c => buildTree(c)),
      };
    }

    const tree = buildTree(rootName);

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(tree, null, 2));
      return;
    }

    // Print the tree
    printLineageTree(tree, '', true, changeName);
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

function printLineageTree(node: LineageNode, prefix: string, isLast: boolean, highlight?: string): void {
  const connector = prefix === '' ? '' : isLast ? '└── ' : '├── ';
  const useColor = !isColorDisabled();

  let line = `${prefix}${connector}${node.name}`;
  if (node.created) {
    line += ` (${node.created})`;
  }
  if (node.from) {
    line += useColor ? chalk.dim(` ← from ${node.from}`) : ` ← from ${node.from}`;
  }

  // Highlight the target change
  if (highlight && node.name === highlight && useColor) {
    line = chalk.bold(line);
  }

  console.log(line);

  const newPrefix = prefix + (prefix === '' ? '' : isLast ? '    ' : '│   ');
  for (let i = 0; i < node.children.length; i++) {
    printLineageTree(node.children[i], newPrefix, i === node.children.length - 1, highlight);
  }
}
