const ENVS = ['staging', 'production'];
const readEnv = (src, env) => {
    const p = `TANGIBLE_${env.toUpperCase()}`;
    return {
        env,
        apiUrl: src[`${p}_API_URL`],
        appUrl: src[`${p}_APP_URL`],
        email: src[`${p}_EMAIL`],
        password: src[`${p}_PASSWORD`],
    };
};
export const loadConfig = (source = process.env) => {
    const active = (source.TANGIBLE_ENV ?? 'production');
    if (!ENVS.includes(active)) {
        throw new Error(`TANGIBLE_ENV must be "staging" or "production", got "${active}"`);
    }
    return {
        active,
        envs: {
            staging: readEnv(source, 'staging'),
            production: readEnv(source, 'production'),
        },
    };
};
export const configFor = (cfg, env = cfg.active) => {
    const partial = cfg.envs[env];
    const prefix = `TANGIBLE_${env.toUpperCase()}`;
    const missing = ['apiUrl', 'appUrl', 'email', 'password']
        .filter((k) => !partial[k])
        .map((k) => ({
        apiUrl: `${prefix}_API_URL`,
        appUrl: `${prefix}_APP_URL`,
        email: `${prefix}_EMAIL`,
        password: `${prefix}_PASSWORD`,
    })[k]);
    if (missing.length > 0) {
        throw new Error(`Missing configuration for ${env}: ${missing.join(', ')}. ` +
            `Add them to the env block of your MCP config.`);
    }
    return partial;
};
