import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {writeAtomic} from "#src/Utils/atomicWrite.mts";

/** Where the bridge keeps its config files, separate from its swept lock/result directory. */
const BRIDGE_CONFIG_DIR = path.join(os.tmpdir(), 'carburetor-lint-bridge');

/** The settings key the host's own config carries the base lists under. */
const SETTINGS_NAMESPACE = 'carburetor';

/** The settings key carrying per-rule options for the bridge's generated config. */
const RULE_OPTIONS_KEY = 'ruleOptions';

/** Both base-list keys in one pass; the only `.carburetorrc.json` keys the bridge ever honors. */
const BASE_KEYS = ['componentBases', 'storeBases'] as const;

type TBaseKey = (typeof BASE_KEYS)[number];

/** The exact names the binary adds to its built-in lists, plus the key naming this set. */
interface IBases {
    config: string;
    key: string;
}

/**
 * Validates one host-supplied per-rule options map: a plain object whose keys are bare rule
 * names (without the `carburetor/` prefix) and whose values are plain option objects, e.g.
 * `{"no-parent-import": {"roots": [{"path": "lib/src", "prefix": "@/"}]}}`. A malformed shape is
 * a loud setup error, not a fallback — the same contract the base lists keep.
 *
 * @param value - the raw `settings.carburetor.ruleOptions` value
 * @returns the validated map, unchanged; empty when absent
 */
const ruleOptionsMap = (value: unknown): Record<string, Record<string, unknown>> => {
    if (value === undefined) {
        return {};
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(
            '@react-carburetor/core/lint: settings.carburetor.ruleOptions must be an object mapping ' +
            'rule names (without the "carburetor/" prefix) to option objects.'
        );
    }

    const map = value as Record<string, unknown>;

    for (const name of Object.keys(map)) {
        const options = map[name];

        if (options === null || typeof options !== 'object' || Array.isArray(options)) {
            throw new Error(
                `@react-carburetor/core/lint: settings.carburetor.ruleOptions["${name}"] must be an ` +
                'options object.'
            );
        }
    }

    return map as Record<string, Record<string, unknown>>;
};

/** Validates one host-supplied base list; a malformed shape is a loud setup error, not a fallback.
 *
 * @param value - the raw value from settings or the project rc
 * @param prefix - where the value came from, named in the error (`settings.carburetor.x` or rc path)
 * @returns the validated list, unchanged
 */
const baseList = (value: unknown, prefix: string): readonly string[] => {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
        throw new Error(`@react-carburetor/core/lint: ${prefix} must be an array of non-empty base class names.`);
    }

    return value;
};

/** Same contract as the settings key: absent means empty, present means a valid list. */
const settingList = (value: unknown, name: TBaseKey): readonly string[] =>
    value === undefined ? [] : baseList(value, `settings.carburetor.${name}`);

/** The lists from `<cwd>/.carburetorrc.json`, reading only the two base keys and nothing else —
 * per-rule options from a project rc must not narrow the shared result, only these may pass. A
 * missing file is neutral; anything unreadable or malformed is the same loud error the CLI gives.
 *
 * @param cwd - the project whose `.carburetorrc.json` is read
 * @returns the two base lists, empty when no rc exists
 */
const rcLists = (cwd: string): Record<TBaseKey, readonly string[]> => {
    const lists: Record<TBaseKey, readonly string[]> = {componentBases: [], storeBases: []};
    const rcPath = path.join(cwd, '.carburetorrc.json');
    let text: string;

    try {
        text = readFileSync(rcPath, 'utf8');
    } catch (error) {
        if ((error as {code?: string}).code === 'ENOENT') {
            return lists;
        }

        throw new Error(`@react-carburetor/core/lint: ${rcPath} could not be read: ${(error as Error).message}`);
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`@react-carburetor/core/lint: ${rcPath} is not valid JSON: ${(error as Error).message}`);
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`@react-carburetor/core/lint: ${rcPath} must hold a JSON object at the top level.`);
    }

    for (const key of BASE_KEYS) {
        const value = (parsed as Record<string, unknown>)[key];

        if (value !== undefined) {
            lists[key] = baseList(value, `${rcPath} "${key}"`);
        }
    }

    return lists;
};

/** Base lists are sets: order and duplicates never change which classes are recognized. */
const canonize = (list: readonly string[]): readonly string[] => [...new Set(list)].sort();

/**
 * Resolves the configuration file the bridge runs the native binary with.
 *
 * The base lists come from `settings.carburetor` when the host provides them, otherwise from
 * the project's `.carburetorrc.json` — but only its two base keys: a project rc cannot narrow
 * the one result every rule filters its own slice from. Per-rule options take the other
 * direction: `settings.carburetor.ruleOptions` maps a bare rule name (no `carburetor/` prefix)
 * to its options object, and lands in the generated config as
 * `{"rules": {"carburetor/<name>": ["error", {…}]}}` — the severity there is overwritten by the
 * bridge's `--rule id=error` flags, the options are what survive. A project rc's per-rule
 * options never reach this run; only the host's settings do.
 *
 * Both lists empty and no rule options yields the shared neutral config, exactly `{}`; any
 * other set yields its own file, content-stable by name, with `ruleOptions` part of the
 * content hash.
 *
 * @param cwd - the project being linted; its `.carburetorrc.json` is the fallback source
 * @param settings - the host's settings object, carrying an optional `carburetor` namespace
 * @returns the config file path for the binary and the key identifying this configuration
 */
export const basesConfig = (cwd: string, settings?: Record<string, unknown>): IBases => {
    const namespace = settings?.[SETTINGS_NAMESPACE];
    const fromSettings = namespace !== undefined && namespace !== null && typeof namespace === 'object';
    const namespaced = fromSettings ? (namespace as Record<string, unknown>) : {};
    const rc = fromSettings ? undefined : rcLists(cwd);
    const source = {
        componentBases: canonize(fromSettings
            ? settingList(namespaced.componentBases, 'componentBases')
            : rc!.componentBases),
        storeBases: canonize(fromSettings
            ? settingList(namespaced.storeBases, 'storeBases')
            : rc!.storeBases),
    };

    // Rule options come from the host's settings only, never from the project rc.
    const ruleOptions = fromSettings ? ruleOptionsMap(namespaced[RULE_OPTIONS_KEY]) : {};

    // Severity in the generated config is decorative — the bridge forces `--rule id=error` —
    // the options object is what the binary actually reads.
    const rules = Object.keys(ruleOptions).length === 0
        ? undefined
        : Object.fromEntries(Object.entries(ruleOptions)
            .map(([name, options]) => [`carburetor/${name}`, ['error', options]]));
    const content = rules === undefined ? source : {...source, rules};

    mkdirSync(BRIDGE_CONFIG_DIR, {recursive: true});

    const neutral = rules === undefined &&
        JSON.stringify(source) === JSON.stringify({componentBases: [], storeBases: []});
    const key = neutral ? '' : createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
    const config = path.join(BRIDGE_CONFIG_DIR, key === '' ? 'bridge.carburetorrc.json' : `bases-${key}.json`);

    // Content-stable, so a torn write from a racing first run is impossible: either it is already
    // there or one writer's atomic rename publishes it.
    // Config files are content-addressed and shared between processes, so they are never deleted
    // at exit: a racing run may be reading or about to write the very same name.
    if (!existsSync(config)) {
        writeAtomic(config, key === '' ? '{}' : JSON.stringify(content));
    }

    return {config, key};
};
