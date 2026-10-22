import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveFromUser } from '../src/cli.js';

describe('command line paths', () => {
  it('resolves relative paths from where the user typed the command, not from server/', () => {
    expect(resolveFromUser('samples/a.xlsx', { INIT_CWD: '/home/me/ddd' })).toBe('/home/me/ddd/samples/a.xlsx');
    expect(resolveFromUser('/abs/b.yaml', { INIT_CWD: '/home/me/ddd' })).toBe('/abs/b.yaml');
    expect(resolveFromUser('x.xlsx', {})).toBe(path.resolve(process.cwd(), 'x.xlsx'));
  });
});
