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
export declare const loadConfig: (source?: Record<string, string | undefined>) => Config;
export declare const configFor: (cfg: Config, env?: Env) => EnvConfig;
