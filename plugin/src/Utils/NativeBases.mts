import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {writeAtomic} from "#src/Utils/atomicWrite.mts";

/** Where the bridge keeps its config files, separate from its swept lock/result directory. */
const BRIDGE_CONFIG_DIR = path.join(os.tmpdir(), 'carburetor-lint-bridge');

/** The settings key the host's own config carries the base lists under. */
const SETTINGS_NAMESPACE = 'carburetor';

/** Both base-list keys in one pass; the only `.carburetorrc.json` keys the bridge ever honors. */
const BASE_KEYS = ['componentBases', 'storeBases'] as const;

type TBaseKey = (typeof BASE_KEYS)[number];

/** The exact names the binary adds to its built-in lists, plus the key naming this set. */
interface IBases {
    config: string;
    key: string;
}

/** Validates one host-supplied base list; a malformed shape is a loud setup error, not a fallback.
 *
 * @param value - the raw value from settings or the project rc
 * @param prefix - where the value came from, named in the error (`settings.carburetor.x` or rc path)
 * @returns the validated list, unchanged
 */
const baseList = (value: unknown, prefix: string): readonly string[] => {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
        throw new Error(`react-carburetor/lint: ${prefix} must be an array of non-empty base class names.`);
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

        throw new Error(`react-carburetor/lint: ${rcPath} could not be read: ${(error as Error).message}`);
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`react-carburetor/lint: ${rcPath} is not valid JSON: ${(error as Error).message}`);
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`react-carburetor/lint: ${rcPath} must hold a JSON object at the top level.`);
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
 * Resolves the base-class configuration the bridge runs the native binary with.
 *
 * The lists come from `settings.carburetor` when the host provides them, otherwise from the
 * project's `.carburetorrc.json` — but only its two base keys, so per-rule options can never
 * narrow the one result every rule filters its own slice from. Both lists empty yields the
 * shared neutral config; any other set yields its own file, content-stable by name.
 *
 * @param cwd - the project being linted; its `.carburetorrc.json` is the fallback source
 * @param settings - the host's settings object, carrying an optional `carburetor` namespace
 * @returns the config file path for the binary and the key identifying this set of bases
 */
export const basesConfig = (cwd: string, settings?: Record<string, unknown>): IBases => {
    const namespace = settings?.[SETTINGS_NAMESPACE];
    const source = namespace !== undefined && namespace !== null && typeof namespace === 'object'
        ? {
            componentBases: canonize(settingList(
                (namespace as Record<string, unknown>).componentBases, 'componentBases')),
            storeBases: canonize(settingList((namespace as Record<string, unknown>).storeBases, 'storeBases')),
        }
        : (() => {
            const rc = rcLists(cwd);

            return {componentBases: canonize(rc.componentBases), storeBases: canonize(rc.storeBases)};
        })();

    mkdirSync(BRIDGE_CONFIG_DIR, {recursive: true});

    const key = JSON.stringify(source) === JSON.stringify({componentBases: [], storeBases: []})
        ? ''
        : createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16);
    const config = path.join(BRIDGE_CONFIG_DIR, key === '' ? 'bridge.carburetorrc.json' : `bases-${key}.json`);

    // Content-stable, so a torn write from a racing first run is impossible: either it is already
    // there or one writer's atomic rename publishes it.
    // Config files are content-addressed and shared between processes, so they are never deleted
    // at exit: a racing run may be reading or about to write the very same name.
    if (!existsSync(config)) {
        writeAtomic(config, key === '' ? '{}' : JSON.stringify(source));
    }

    return {config, key};
};
