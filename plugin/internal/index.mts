import type {IPlugin} from "#src/Models.mts";
import {maxLineLength} from "#internal/Rules/maxLineLength.mts";
import {noBlankLineAfterTsdoc} from "#internal/Rules/noBlankLineAfterTsdoc.mts";
import {noParentImport} from "#internal/Rules/noParentImport.mts";
import {requireTsdoc} from "#internal/Rules/requireTsdoc.mts";

/**
 * Rules for this repository's own code, which are deliberately **not** published.
 *
 * The split follows what a rule is about. The shipped plugin (`plugin/src`, exposed as
 * `react-carburetor/lint`) is about the safety of carburetor logic: a write nobody hears, a
 * component that never subscribes, an effect whose cleanup is dropped — mistakes that are the
 * library's business wherever they happen. This plugin is about how *this* repository is written:
 * import direction, line length, documentation. Those are house style, and shipping them would
 * impose this project's taste on consumers who only asked for a state engine.
 *
 * It is loaded from source by `.oxlintrc.json` and never enters `dist`.
 */
const plugin: IPlugin = {
    meta: {
        name: 'carburetor-internal',
    },
    rules: {
        'max-line-length': maxLineLength,
        'no-blank-line-after-tsdoc': noBlankLineAfterTsdoc,
        'no-parent-import': noParentImport,
        'require-tsdoc': requireTsdoc,
    },
};

export default plugin;
