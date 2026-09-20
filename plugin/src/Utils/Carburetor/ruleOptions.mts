import {CARBURETOR_BASES} from "#src/Utils/Carburetor/carburetorBases.mts";
import {COMPONENT_BASES} from "#src/Utils/Carburetor/componentBases.mts";
import type {IRuleContext} from "#src/Models.mts";

interface IOptions {
    componentBases?: readonly string[];
    carburetorBases?: readonly string[];
    renderMethods?: readonly string[];
}

interface IResolvedOptions {
    componentBases: readonly string[];
    carburetorBases: readonly string[];
    renderMethods: readonly string[];
}

const DEFAULT_RENDER_METHODS: readonly string[] = ['render'];

const NAME_LIST = {
    type: 'array',
    items: {type: 'string'},
} as const;

/**
 * The options every rule in this plugin shares, and their JSON schema.
 *
 * They exist because detection is syntactic: a project with its own component base class, its own
 * store base class or its own render helpers is invisible to the rules until it names them here.
 * Kept in one place so the schema a consumer reads and the defaults a rule applies cannot drift
 * apart. A rule with an option of its own passes it to `schema`.
 */
export const ruleOptions = {
    schema: (extra: Record<string, unknown> = {}): readonly unknown[] => [
        {
            type: 'object',
            properties: {
                componentBases: NAME_LIST,
                carburetorBases: NAME_LIST,
                renderMethods: NAME_LIST,
                ...extra,
            },
            additionalProperties: false,
        },
    ],

    read: (context: IRuleContext): IResolvedOptions => {
        const given: IOptions = (context.options[0] as IOptions) || {};

        return {
            componentBases: given.componentBases || COMPONENT_BASES,
            carburetorBases: given.carburetorBases || CARBURETOR_BASES,
            renderMethods: given.renderMethods || DEFAULT_RENDER_METHODS,
        };
    },
};
