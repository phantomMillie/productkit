import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { SKILLS_ROOT } from '../src/clarification/skills.js';

function frontmatter(text: string): Record<string, unknown> | undefined {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return match ? (parseYaml(match[1] ?? '') as Record<string, unknown>) : undefined;
}

describe('entry Skill', () => {
  it('has Agent Skills frontmatter whose name matches its folder', async () => {
    const meta = frontmatter(await readFile(path.join(SKILLS_ROOT, 'productkit', 'SKILL.md'), 'utf8'));
    expect(meta?.name).toBe('productkit');
    expect(typeof meta?.description).toBe('string');
    const description = String(meta?.description);
    expect(description.length).toBeGreaterThan(80);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).toContain('intake');
    expect(description).toMatch(/bug fix/i);
  });

  it('tells the Agent to keep the original words and to ask before init', async () => {
    const text = await readFile(path.join(SKILLS_ROOT, 'productkit', 'SKILL.md'), 'utf8');
    expect(text).toContain('productkit intake --file');
    expect(text).toContain('productkit init');
    expect(text).toContain('요약·번역');
  });
});

describe('stage Skills', () => {
  it('no longer rely on import("productkit"), which fails for a global install', async () => {
    for (const dir of await readdir(SKILLS_ROOT)) {
      const text = await readFile(path.join(SKILLS_ROOT, dir, 'SKILL.md'), 'utf8');
      expect(text, dir).not.toMatch(/import\('productkit'\)\.then/);
    }
  });

  it('clarify example binds the Prompt on both the Clarification and the confirmation', async () => {
    const text = await readFile(path.join(SKILLS_ROOT, 'clarify', 'SKILL.md'), 'utf8');
    expect(text.match(/prompt_content_hash:/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(text).toContain('productkit compute entry-hash');
    expect(text).not.toContain('id 제외');
  });
});
