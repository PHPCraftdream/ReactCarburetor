import type {IPlugin} from "./Models.mts";
import {RECOMMENDED} from "./recommended.mts";
import {noAsyncTransaction} from "./Rules/Boundaries/noAsyncTransaction.mts";
import {noModuleLevelStore} from "./Rules/Boundaries/noModuleLevelStore.mts";
import {noUntrackableStoreData} from "./Rules/Boundaries/noUntrackableStoreData.mts";
import {requireSubscriptionDisposal} from "./Rules/Boundaries/requireSubscriptionDisposal.mts";
import {noAsyncEffect} from "./Rules/Effects/noAsyncEffect.mts";
import {noDuplicateEffectName} from "./Rules/Effects/noDuplicateEffectName.mts";
import {requireEffectDeps} from "./Rules/Effects/requireEffectDeps.mts";
import {noComputedGetInComputed} from "./Rules/Reads/noComputedGetInComputed.mts";
import {noComputedGetInRender} from "./Rules/Reads/noComputedGetInRender.mts";
import {noEscapingTrackedData} from "./Rules/Reads/noEscapingTrackedData.mts";
import {noGetDataInRender} from "./Rules/Reads/noGetDataInRender.mts";
import {noHandlerCreatedInRender} from "./Rules/Lifecycle/noHandlerCreatedInRender.mts";
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
        'no-computed-get-in-computed': noComputedGetInComputed,
        'no-computed-get-in-render': noComputedGetInRender,
        'no-direct-data-write': noDirectDataWrite,
        'no-duplicate-effect-name': noDuplicateEffectName,
        'no-escaping-tracked-data': noEscapingTrackedData,
        'no-external-data-mutation': noExternalDataMutation,
        'no-get-data-in-render': noGetDataInRender,
        'no-handler-created-in-render': noHandlerCreatedInRender,
        'no-lifecycle-class-property': noLifecycleClassProperty,
        'no-module-level-store': noModuleLevelStore,
        'no-store-write-in-render': noStoreWriteInRender,
        'no-tracked-data-mutation': noTrackedDataMutation,
        'no-untrackable-draft-mutation': noUntrackableDraftMutation,
        'no-untrackable-store-data': noUntrackableStoreData,
        'no-use-carburetor-outside-render': noUseCarburetorOutsideRender,
        'require-bind-for-passed-method': requireBindForPassedMethod,
        'require-effect-deps': requireEffectDeps,
        'require-emit-after-draft-write': requireEmitAfterDraftWrite,
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
};

export default plugin;
