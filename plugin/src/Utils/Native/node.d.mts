/**
 * Minimal ambient declarations for the Node APIs the bridge uses.
 *
 * `plugin/tsconfig.json` deliberately carries `"types": []` — the plugin ships to consumers and
 * has never needed Node's own types before this file. Pulling in `@types/node` for a handful of
 * functions would be a real dependency for a handful of signatures; declaring exactly what is
 * used here costs nothing at runtime (erased like every other type) and nothing to a consumer.
 */

declare const process: {
    readonly platform: string;
    readonly arch: string;
    readonly pid: number;
    readonly env: Readonly<Record<string, string | undefined>>;
    cwd(): string;
    /** Present unless Node runs with reports disabled; read only to pick the glibc or musl
     * platform package. */
    readonly report?: {getReport(): {header: {glibcVersionRuntime?: string}}};
};

declare const Buffer: {
    from(input: string): {toString(encoding: string): string};
};

interface ImportMeta {
    readonly url: string;
}

declare module "node:child_process" {
    export interface ISpawnResult {
        status: number | null;
        stdout: string;
        stderr: string;
        error?: {message: string};
    }

    export function spawnSync(
        command: string,
        args: readonly string[],
        options: {cwd?: string; encoding: 'utf8'}
    ): ISpawnResult;
}

declare module "node:fs" {
    export function existsSync(path: string): boolean;
    export function mkdirSync(path: string, options?: {recursive?: boolean}): void;
    export function openSync(path: string, flags: string): number;
    export function closeSync(fd: number): void;
    export function unlinkSync(path: string): void;
    export function readFileSync(path: string, encoding: 'utf8'): string;
    export function writeFileSync(path: string, data: string): void;
}

declare module "node:os" {
    export function tmpdir(): string;
}

declare module "node:path" {
    export function join(...segments: string[]): string;
    export function dirname(path: string): string;
    export function relative(from: string, to: string): string;
    export function resolve(...segments: string[]): string;
}

declare module "node:module" {
    export function createRequire(url: string): {resolve(specifier: string): string};
}

declare module "node:url" {
    export function fileURLToPath(url: string): string;
}
