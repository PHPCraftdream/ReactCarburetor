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

/** Validates one host-supplied base list; a malformed shape is a loud setup error, not a fallback. */
const settingList = (value: unknown, name: TBaseKey): readonly string[] => {
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new Error(
            `react-carburetor/lint: settings.carburetor.${name} must be an array of non-empty ` +
            'base class names.'
        );
    }

    return value.map((entry): string => {
        if (typeof entry !== 'string' || entry === '') {
            throw new Error(
                `react-carburetor/lint: settings.carburetor.${name} must be an array of non-empty ` +
                'base class names.'
            );
        }

        return entry;
    });
};

/** The lists from `<cwd>/.carburetorrc.json`, reading only the two base keys and nothing else —
 * per-rule options from a project rc must not narrow the shared result, only these may pass. */
const rcLists = (cwd: string): Record<TBaseKey, readonly string[]> => {
    const lists: Record<TBaseKey, readonly string[]> = {componentBases: [], storeBases: []};

    let parsed: unknown;

    try {
        parsed = JSON.parse(readFileSync(path.join(cwd, '.carburetorrc.json'), 'utf8'));
    } catch {
        return lists; // Absent or broken rc: the built-in base names stand alone.
    }

    if (parsed === null || typeof parsed !== 'object') {
        return lists;
    }

    for (const key of BASE_KEYS) {
        const value = (parsed as Record<string, unknown>)[key];

        lists[key] = Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
            : [];
    }

    return lists;
};

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
            componentBases: settingList(
                (namespace as Record<string, unknown>).componentBases, 'componentBases'),
            storeBases: settingList((namespace as Record<string, unknown>).storeBases, 'storeBases'),
        }
        : rcLists(cwd);

    mkdirSync(BRIDGE_CONFIG_DIR, {recursive: true});

    const key = JSON.stringify(source) === JSON.stringify({componentBases: [], storeBases: []})
        ? ''
        : createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16);
    const config = path.join(BRIDGE_CONFIG_DIR, key === '' ? 'bridge.carburetorrc.json' : `bases-${key}.json`);

    // Content-stable, so a torn write from a racing first run is impossible: either it is already
    // there or one writer's atomic rename publishes it.
    if (!existsSync(config)) {
        writeAtomic(config, key === '' ? '{}' : JSON.stringify(source));
    }

    return {config, key};
};
