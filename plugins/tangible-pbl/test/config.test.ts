import { describe, it, expect } from 'vitest';
import { loadConfig, configFor } from '../src/config.js';

const FULL = {
  TANGIBLE_ENV: 'staging',
  TANGIBLE_STAGING_API_URL: 'https://tg-dev.arbyte.solutions/tangible/v1',
  TANGIBLE_STAGING_APP_URL: 'https://tg-dev.netlify.app',
  TANGIBLE_STAGING_EMAIL: 'stage@example.com',
  TANGIBLE_STAGING_PASSWORD: 'stagepw',
  TANGIBLE_PRODUCTION_API_URL: 'https://api.tangible.careers/tangible/v1',
  TANGIBLE_PRODUCTION_APP_URL: 'https://app.tangible.careers',
  TANGIBLE_PRODUCTION_EMAIL: 'prod@example.com',
  TANGIBLE_PRODUCTION_PASSWORD: 'prodpw',
};

describe('loadConfig', () => {
  it('selects the active environment and keeps both credential sets', () => {
    const cfg = loadConfig(FULL);
    expect(cfg.active).toBe('staging');
    expect(configFor(cfg).email).toBe('stage@example.com');
    expect(configFor(cfg, 'production').email).toBe('prod@example.com');
  });

  it('defaults to production when TANGIBLE_ENV is unset', () => {
    const { TANGIBLE_ENV: _drop, ...rest } = FULL;
    expect(loadConfig(rest).active).toBe('production');
  });

  it('rejects an unknown environment name', () => {
    expect(() => loadConfig({ ...FULL, TANGIBLE_ENV: 'dev' })).toThrow(
      /TANGIBLE_ENV must be "staging" or "production"/,
    );
  });

  it('reports every missing key for the active environment at once', () => {
    expect(() =>
      configFor(
        loadConfig({ TANGIBLE_ENV: 'staging', ...{} as Record<string, string> }),
      ),
    ).toThrow(/TANGIBLE_STAGING_API_URL.*TANGIBLE_STAGING_EMAIL/s);
  });

  it('does not require the inactive environment to be configured', () => {
    const stagingOnly = {
      TANGIBLE_ENV: 'staging',
      TANGIBLE_STAGING_API_URL: FULL.TANGIBLE_STAGING_API_URL,
      TANGIBLE_STAGING_APP_URL: FULL.TANGIBLE_STAGING_APP_URL,
      TANGIBLE_STAGING_EMAIL: FULL.TANGIBLE_STAGING_EMAIL,
      TANGIBLE_STAGING_PASSWORD: FULL.TANGIBLE_STAGING_PASSWORD,
    };
    expect(() => configFor(loadConfig(stagingOnly))).not.toThrow();
  });
});
