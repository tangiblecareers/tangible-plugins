import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../config.js';

export type Step =
  | 'context' | 'skills' | 'problems' | 'outline'
  | 'detail' | 'publish' | 'invite' | 'done';

export interface SessionState {
  id: string;
  env: Env;
  courseId: string;
  businessId: string;
  businessName: string;
  brief: string;
  sourceUrl?: string;
  step: Step;
  awaitingApproval: boolean;
  history: string[];
}

const assertSafeId = (id: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid session id "${id}".`);
  }
  return id;
};

/**
 * Holds only pointers and progress. Course content is always re-read from the
 * API, so this file can never disagree with the backend.
 */
export class SessionStore {
  constructor(private readonly root = join(homedir(), '.tangible-pbl-mcp', 'sessions')) {}

  #dir(env: Env) {
    return join(this.root, env);
  }

  #file(env: Env, id: string) {
    return join(this.#dir(env), `${assertSafeId(id)}.json`);
  }

  async save(s: SessionState): Promise<void> {
    await mkdir(this.#dir(s.env), { recursive: true });
    await writeFile(this.#file(s.env, s.id), JSON.stringify(s, null, 2), 'utf8');
  }

  async load(env: Env, id: string): Promise<SessionState> {
    try {
      return JSON.parse(await readFile(this.#file(env, id), 'utf8')) as SessionState;
    } catch (err) {
      // Re-throw validation errors as-is
      if (err instanceof Error && err.message.includes('Invalid session id')) {
        throw err;
      }
      throw new Error(
        `No session "${id}" in ${env}. Run pbl_status to see open sessions.`,
      );
    }
  }

  async list(env: Env): Promise<SessionState[]> {
    let names: string[];
    try {
      names = await readdir(this.#dir(env));
    } catch {
      return [];
    }
    const out: SessionState[] = [];
    for (const n of names.filter((n) => n.endsWith('.json'))) {
      try {
        out.push(JSON.parse(await readFile(join(this.#dir(env), n), 'utf8')));
      } catch {
        // Skip unreadable session files rather than failing the whole listing.
      }
    }
    return out;
  }

  async delete(env: Env, id: string): Promise<void> {
    await rm(this.#file(env, id), { force: true });
  }
}
