import { promises as fs } from 'fs';
import path from 'path';
import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { MarkdownParser } from './parsers/markdown-parser.js';
import { readChangeMetadata } from '../utils/change-metadata.js';

interface ChangeInfo {
  name: string;
  completedTasks: number;
  totalTasks: number;
  lastModified: Date;
  created: string | undefined;
  changeStatus: 'active' | 'complete' | 'no-tasks';
}

interface ListOptions {
  sort?: 'recent' | 'name' | 'created';
  status?: 'active' | 'complete' | 'archived';
  json?: boolean;
}

/**
 * Get the most recent modification time of any file in a directory (recursive).
 * Falls back to the directory's own mtime if no files are found.
 */
async function getLastModified(dirPath: string): Promise<Date> {
  let latest: Date | null = null;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        if (latest === null || stat.mtime > latest) {
          latest = stat.mtime;
        }
      }
    }
  }

  await walk(dirPath);

  // If no files found, use the directory's own modification time
  if (latest === null) {
    const dirStat = await fs.stat(dirPath);
    return dirStat.mtime;
  }

  return latest;
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "3 days ago")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) {
    return date.toLocaleDateString();
  } else if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return 'just now';
  }
}

export class ListCommand {
  async execute(targetPath: string = '.', mode: 'changes' | 'specs' = 'changes', options: ListOptions = {}): Promise<void> {
    const { sort = 'recent', json = false } = options;

    if (mode === 'changes') {
      const changesDir = path.join(targetPath, 'openspec', 'changes');

      // Check if changes directory exists
      try {
        await fs.access(changesDir);
      } catch {
        throw new Error("No OpenSpec changes directory found. Run 'openspec init' first.");
      }

      // Get all directories in changes (excluding archive)
      const entries = await fs.readdir(changesDir, { withFileTypes: true });
      const changeDirs = entries
        .filter(entry => entry.isDirectory() && entry.name !== 'archive')
        .map(entry => entry.name);

      if (changeDirs.length === 0) {
        if (json) {
          console.log(JSON.stringify({ changes: [] }));
        } else {
          console.log('No active changes found.');
        }
        return;
      }

      // Collect information about each change
      let changes: ChangeInfo[] = [];

      for (const changeDir of changeDirs) {
        const progress = await getTaskProgressForChange(changesDir, changeDir);
        const changePath = path.join(changesDir, changeDir);
        const lastModified = await getLastModified(changePath);

        // Read created timestamp from metadata
        let created: string | undefined;
        try {
          const metadata = readChangeMetadata(changePath, targetPath);
          created = metadata?.created;
        } catch {
          // Ignore metadata read errors
        }

        const changeStatus: 'active' | 'complete' | 'no-tasks' =
          progress.total === 0 ? 'no-tasks' :
          progress.completed === progress.total ? 'complete' : 'active';

        changes.push({
          name: changeDir,
          completedTasks: progress.completed,
          totalTasks: progress.total,
          lastModified,
          created,
          changeStatus,
        });
      }

      // Filter by status if specified
      if (options.status) {
        if (options.status === 'archived') {
          // Show archived changes instead
          const archiveDir = path.join(targetPath, 'openspec', 'changes', 'archive');
          if (existsSync(archiveDir)) {
            const archiveEntries = await fs.readdir(archiveDir, { withFileTypes: true });
            const archivedNames = archiveEntries
              .filter(entry => entry.isDirectory())
              .map(entry => entry.name);
            if (archivedNames.length === 0) {
              if (json) {
                console.log(JSON.stringify({ changes: [] }));
              } else {
                console.log('No archived changes found.');
              }
              return;
            }
            if (json) {
              console.log(JSON.stringify({ changes: archivedNames.map(n => ({ name: n, status: 'archived' })) }, null, 2));
            } else {
              console.log('Archived Changes:');
              for (const name of archivedNames.sort()) {
                console.log(`  ${name}     archived`);
              }
            }
            return;
          } else {
            if (json) {
              console.log(JSON.stringify({ changes: [] }));
            } else {
              console.log('No archived changes found.');
            }
            return;
          }
        }
        changes = changes.filter(c => c.changeStatus === options.status);
        if (changes.length === 0) {
          if (json) {
            console.log(JSON.stringify({ changes: [] }));
          } else {
            console.log(`No ${options.status} changes found.`);
          }
          return;
        }
      }

      // Sort by preference (default: recent first)
      if (sort === 'created') {
        changes.sort((a, b) => {
          const aTime = a.created ?? '';
          const bTime = b.created ?? '';
          return bTime.localeCompare(aTime); // newest first
        });
      } else if (sort === 'recent') {
        changes.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      } else {
        changes.sort((a, b) => a.name.localeCompare(b.name));
      }

      // JSON output for programmatic use
      if (json) {
        const jsonOutput = changes.map(c => ({
          name: c.name,
          completedTasks: c.completedTasks,
          totalTasks: c.totalTasks,
          lastModified: c.lastModified.toISOString(),
          created: c.created,
          status: c.changeStatus === 'no-tasks' ? 'no-tasks' : c.changeStatus === 'complete' ? 'complete' : 'in-progress',
        }));
        console.log(JSON.stringify({ changes: jsonOutput }, null, 2));
        return;
      }

      // Display results
      console.log('Changes:');
      const padding = '  ';
      const nameWidth = Math.max(...changes.map(c => c.name.length));
      for (const change of changes) {
        const paddedName = change.name.padEnd(nameWidth);
        const created = change.created ? change.created.substring(0, 16).padEnd(18) : ''.padEnd(18);
        const statusLabel = change.changeStatus === 'complete' ? 'complete' :
                            change.changeStatus === 'active' ? 'active' : '';
        const taskInfo = change.totalTasks > 0
          ? `${change.completedTasks}/${change.totalTasks} artifacts done`
          : '';
        console.log(`${padding}${paddedName}  ${created}${statusLabel.padEnd(10)}  ${taskInfo}`);
      }
      return;
    }

    // specs mode
    const specsDir = path.join(targetPath, 'openspec', 'specs');
    try {
      await fs.access(specsDir);
    } catch {
      console.log('No specs found.');
      return;
    }

    const entries = await fs.readdir(specsDir, { withFileTypes: true });
    const specDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    if (specDirs.length === 0) {
      console.log('No specs found.');
      return;
    }

    type SpecInfo = { id: string; requirementCount: number };
    const specs: SpecInfo[] = [];
    for (const id of specDirs) {
      const specPath = join(specsDir, id, 'spec.md');
      try {
        const content = readFileSync(specPath, 'utf-8');
        const parser = new MarkdownParser(content);
        const spec = parser.parseSpec(id);
        specs.push({ id, requirementCount: spec.requirements.length });
      } catch {
        // If spec cannot be read or parsed, include with 0 count
        specs.push({ id, requirementCount: 0 });
      }
    }

    specs.sort((a, b) => a.id.localeCompare(b.id));
    console.log('Specs:');
    const padding = '  ';
    const nameWidth = Math.max(...specs.map(s => s.id.length));
    for (const spec of specs) {
      const padded = spec.id.padEnd(nameWidth);
      console.log(`${padding}${padded}     requirements ${spec.requirementCount}`);
    }
  }
}