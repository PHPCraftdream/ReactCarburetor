import {RuleTester} from "oxlint/plugins-dev";
import {noParentImport} from "@plugin-internal/Rules/noParentImport.mts";

/**
 * The fix is the point of this rule, so every invalid case asserts the rewritten source rather than
 * only the report: a rule that names the right alias in its message but writes the wrong one would
 * otherwise pass.
 */
const rule = noParentImport as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-parent-import', rule, {
    valid: [
        {
            name: 'a sibling import stays relative',
            filename: 'lib/src/Carburetor/Store/Paths/joinPath.ts',
            code: `import {PATH_SEPARATOR} from "./PathSeparator";`,
        },
        {
            name: 'a downward import stays relative',
            filename: 'lib/src/Carburetor/index.ts',
            code: `export * from './Store/Carburetor';`,
        },
        {
            name: 'an import already written through the alias',
            filename: 'lib/src/Carburetor/Store/Tracking/createWriteProxy.ts',
            code: `import {joinPath} from "@/Carburetor/Store/Paths/joinPath";`,
        },
        {
            name: 'a package import',
            filename: 'lib/src/Carburetor/Component/AntiHookComponent.tsx',
            code: `import * as React from "react";`,
        },
        {
            name: 'an import that leaves the source tree has no aliased form',
            filename: 'benchmarks/pathsIntersect.mjs',
            code: `import {pathsIntersect} from "../dist/esm/Carburetor/index.mjs";`,
        },
    ],
    invalid: [
        {
            name: 'one level up, inside the library',
            filename: 'lib/src/Carburetor/Store/Tracking/createWriteProxy.ts',
            code: `import {joinPath} from "../Paths/joinPath";`,
            output: `import {joinPath} from "@/Carburetor/Store/Paths/joinPath";`,
            errors: [{message: /reaches up out of this directory/}],
        },
        {
            name: 'two levels up',
            filename: 'lib/src/Carburetor/Store/Tracking/createWriteProxy.ts',
            code: `import {TPath} from "../../Models/Paths";`,
            output: `import {TPath} from "@/Carburetor/Models/Paths";`,
            errors: 1,
        },
        {
            name: 'a re-export',
            filename: 'lib/src/Carburetor/Store/Paths/index.ts',
            code: `export * from "../../Models/Paths";`,
            output: `export * from "@/Carburetor/Models/Paths";`,
            errors: 1,
        },
        {
            name: 'a named re-export',
            filename: 'lib/src/Carburetor/Store/Paths/index.ts',
            code: `export {TPath} from "../../Models/Paths";`,
            output: `export {TPath} from "@/Carburetor/Models/Paths";`,
            errors: 1,
        },
        {
            name: 'the plugin tree gets its own alias',
            filename: 'plugin/src/Rules/Writes/noDirectDataWrite.mts',
            code: `import {describeChainRoot} from "../../Utils/Ast/describeChainRoot.mts";`,
            output: `import {describeChainRoot} from "@plugin/Utils/Ast/describeChainRoot.mts";`,
            errors: 1,
        },
        {
            name: 'a test reaching into the library',
            filename: '__tests__/Engine/Store/Carburetor.test.ts',
            code: `import {Carburetor} from "../../../lib/src/Carburetor";`,
            output: `import {Carburetor} from "@/Carburetor";`,
            errors: 1,
        },
        {
            name: 'every offending import in the file is fixed',
            filename: 'lib/src/Carburetor/Store/Tracking/createWriteProxy.ts',
            code: `import {TPath} from "../../Models/Paths";\nimport {joinPath} from "../Paths/joinPath";`,
            output: `import {TPath} from "@/Carburetor/Models/Paths";\nimport {joinPath} from "@/Carburetor/Store/Paths/joinPath";`,
            errors: 2,
        },
        {
            name: 'roots can be renamed through options',
            filename: 'app/source/Feature/Row.ts',
            code: `import {store} from "../Stores/store";`,
            output: `import {store} from "~/Stores/store";`,
            options: [{roots: [{path: 'app/source', prefix: '~/'}]}],
            errors: 1,
        },
    ],
});
