export type Env = 'staging' | 'production';

export interface EnvConfig {
  env: Env;
  apiUrl: string;
  appUrl: string;
  email: string;
  password: string;
}

export interface Config {
  active: Env;
  envs: Record<Env, Partial<EnvConfig>>;
}

const ENVS: Env[] = ['staging', 'production'];

const readEnv = (
  src: Record<string, string | undefined>,
  env: Env,
): Partial<EnvConfig> => {
  const p = `TANGIBLE_${env.toUpperCase()}`;
  return {
    env,
    apiUrl: src[`${p}_API_URL`],
    appUrl: src[`${p}_APP_URL`],
    email: src[`${p}_EMAIL`],
    password: src[`${p}_PASSWORD`],
  };
};

export const loadConfig = (
  source: Record<string, string | undefined> = process.env,
): Config => {
  const active = (source.TANGIBLE_ENV ?? 'production') as Env;
  if (!ENVS.includes(active)) {
    throw new Error(
      `TANGIBLE_ENV must be "staging" or "production", got "${active}"`,
    );
  }
  return {
    active,
    envs: {
      staging: readEnv(source, 'staging'),
      production: readEnv(source, 'production'),
    },
  };
};

export const configFor = (cfg: Config, env: Env = cfg.active): EnvConfig => {
  const partial = cfg.envs[env];
  const prefix = `TANGIBLE_${env.toUpperCase()}`;
  const missing = (['apiUrl', 'appUrl', 'email', 'password'] as const)
    .filter((k) => !partial[k])
    .map((k) =>
      ({
        apiUrl: `${prefix}_API_URL`,
        appUrl: `${prefix}_APP_URL`,
        email: `${prefix}_EMAIL`,
        password: `${prefix}_PASSWORD`,
      })[k],
    );
  if (missing.length > 0) {
    throw new Error(
      `Missing configuration for ${env}: ${missing.join(', ')}. ` +
        `Add them to the env block of your MCP config.`,
    );
  }
  return partial as EnvConfig;
};
