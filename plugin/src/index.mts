import type {IPlugin} from "./Models.mts";
import {RECOMMENDED} from "./recommended.mts";
import {NO_HOOKS} from "./noHooks.mts";
import {HOUSE_STYLE} from "./Rules/Style/HouseStyle/houseStyle.mts";
import {noFunctionInRender} from "./Rules/Lifecycle/noFunctionInRender.mts";
import {noReactHooksInComponents} from "./Rules/Allocations/noReactHooksInComponents.mts";
import {requireMethodForClosure} from "./Rules/Allocations/requireMethodForClosure.mts";
import {requireModuleFunction} from "./Rules/Allocations/requireModuleFunction.mts";
import {noAsyncTransaction} from "./Rules/Boundaries/noAsyncTransaction.mts";
import {noModuleLevelStore} from "./Rules/Boundaries/noModuleLevelStore.mts";
import {noUntrackableStoreData} from "./Rules/Boundaries/noUntrackableStoreData.mts";
import {oneExportPerFile} from "./Rules/Boundaries/oneExportPerFile.mts";
import {requireSubscriptionDisposal} from "./Rules/Boundaries/requireSubscriptionDisposal.mts";
import {noAsyncEffect} from "./Rules/Effects/noAsyncEffect.mts";
import {noClosureInUpdate} from "./Rules/Allocations/noClosureInUpdate.mts";
import {noDuplicateEffectName} from "./Rules/Effects/noDuplicateEffectName.mts";
import {requireEffectDeps} from "./Rules/Effects/requireEffectDeps.mts";
import {noComputedGetInComputed} from "./Rules/Reads/noComputedGetInComputed.mts";
import {noComputedGetInRender} from "./Rules/Reads/noComputedGetInRender.mts";
import {noEscapingTrackedData} from "./Rules/Reads/noEscapingTrackedData.mts";
import {noGetDataInRender} from "./Rules/Reads/noGetDataInRender.mts";
import {noMemoOverStoreRead} from "./Rules/Reads/noMemoOverStoreRead.mts";
import {noCapturingHookSelector} from "./Rules/Reads/noCapturingHookSelector.mts";
import {noHandlerCreatedInRender} from "./Rules/Lifecycle/noHandlerCreatedInRender.mts";
import {maxRenderDepth} from "./Rules/Lifecycle/maxRenderDepth.mts";
import {maxLineLength} from "./Rules/Style/maxLineLength.mts";
import {noBlankLineAfterTsdoc} from "./Rules/Style/noBlankLineAfterTsdoc.mts";
import {noParentImport} from "./Rules/Style/noParentImport.mts";
import {requireTsdoc} from "./Rules/Style/requireTsdoc.mts";
import {preferReadonlyArrayParam} from "./Rules/Style/preferReadonlyArrayParam.mts";
import {tsdocBlankLineBeforeTags} from "./Rules/Style/tsdocBlankLineBeforeTags.mts";
import {noLifecycleClassProperty} from "./Rules/Lifecycle/noLifecycleClassProperty.mts";
import {requireBindForPassedMethod} from "./Rules/Lifecycle/requireBindForPassedMethod.mts";
import {requireSuperInLifecycle} from "./Rules/Lifecycle/requireSuperInLifecycle.mts";
import {noUseCarburetorOutsideRender} from "./Rules/Reads/noUseCarburetorOutsideRender.mts";
import {noDirectDataWrite} from "./Rules/Writes/noDirectDataWrite.mts";
import {noExternalDataMutation} from "./Rules/Writes/noExternalDataMutation.mts";
import {noStoreWriteInRender} from "./Rules/Writes/noStoreWriteInRender.mts";
import {noTrackedDataMutation} from "./Rules/Writes/noTrackedDataMutation.mts";
import {noUntrackableDraftMutation} from "./Rules/Writes/noUntrackableDraftMutation.mts";
import {requireEmitAfterDraftWrite} from "./Rules/Writes/requireEmitAfterDraftWrite.mts";

/**
 * The lint plugin for consumers of React Carburetor.
 *
 * One implementation serves both hosts: oxlint loads it through `jsPlugins` and ESLint v9
 * flat config imports it as a plugin, because oxlint's JS plugin API is ESLint's. Rules are
 * specified in docs/hazards.md, which records for each one what it matches, why the mistake
 * is silent at runtime, and where it can produce a false positive.
 */
const plugin: IPlugin = {
    meta: {
        name: 'carburetor',
    },
    rules: {
        'no-async-effect': noAsyncEffect,
        'no-async-transaction': noAsyncTransaction,
        'no-closure-in-update': noClosureInUpdate,
        'no-computed-get-in-computed': noComputedGetInComputed,
        'no-computed-get-in-render': noComputedGetInRender,
        'no-capturing-hook-selector': noCapturingHookSelector,
        'no-memo-over-store-read': noMemoOverStoreRead,
        'no-get-data-in-render': noGetDataInRender,
        'no-direct-data-write': noDirectDataWrite,
        'no-duplicate-effect-name': noDuplicateEffectName,
        'no-escaping-tracked-data': noEscapingTrackedData,
        'no-external-data-mutation': noExternalDataMutation,
        'no-function-in-render': noFunctionInRender,
        'no-handler-created-in-render': noHandlerCreatedInRender,
        'max-render-depth': maxRenderDepth,
        'max-line-length': maxLineLength,
        'no-blank-line-after-tsdoc': noBlankLineAfterTsdoc,
        'no-parent-import': noParentImport,
        'prefer-readonly-array-param': preferReadonlyArrayParam,
        'require-tsdoc': requireTsdoc,
        'tsdoc-blank-line-before-tags': tsdocBlankLineBeforeTags,
        'no-lifecycle-class-property': noLifecycleClassProperty,
        'no-module-level-store': noModuleLevelStore,
        'no-react-hooks-in-components': noReactHooksInComponents,
        'no-store-write-in-render': noStoreWriteInRender,
        'no-tracked-data-mutation': noTrackedDataMutation,
        'no-untrackable-draft-mutation': noUntrackableDraftMutation,
        'no-untrackable-store-data': noUntrackableStoreData,
        'one-export-per-file': oneExportPerFile,
        'no-use-carburetor-outside-render': noUseCarburetorOutsideRender,
        'require-bind-for-passed-method': requireBindForPassedMethod,
        'require-effect-deps': requireEffectDeps,
        'require-emit-after-draft-write': requireEmitAfterDraftWrite,
        'require-method-for-closure': requireMethodForClosure,
        'require-module-function': requireModuleFunction,
        'require-subscription-disposal': requireSubscriptionDisposal,
        'require-super-in-lifecycle': requireSuperInLifecycle,
    },
};

// Assigned after the object exists, because a shareable config has to name the plugin it belongs to.
plugin.configs = {
    recommended: {
        plugins: {carburetor: plugin},
        rules: RECOMMENDED,
    },
    'no-hooks': {
        plugins: {carburetor: plugin},
        rules: NO_HOOKS,
    },
    'house-style': {
        plugins: {carburetor: plugin},
        rules: HOUSE_STYLE,
    },
};

export default plugin;
