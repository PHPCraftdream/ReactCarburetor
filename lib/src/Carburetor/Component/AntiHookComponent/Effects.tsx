"use client";

import {C} from "@/Carburetor/Component/Models/ComponentSymbols";

import {IDict, TEffect, TEffectDeps, TDisposer} from "@/Carburetor/Models/Base";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";
import {AntiHookComponentReads} from "./Reads";
import {shallowEqual} from "@/Carburetor/Component/shallowEqual";
import {ICarburetorEvents} from "@/Carburetor/Models/Store";

declare const process: {env: {NODE_ENV?: string}};

interface IEffectRecord {
    deps: TEffectDeps;
    cleanup: (() => void) | undefined;
}

const describeFailure = (error: unknown): string =>
    (error instanceof Error ? error.message : String(error));
export abstract class AntiHookComponentEffects<P = {}, S = {}> extends AntiHookComponentReads<P, S> {
    /**
     * Where a subclass declares its effects; called after every commit.
     */
    protected useEffects(): void {
    }

    // noinspection JSUnusedLocalSymbols
    /** Where a subclass tears down what the previous props' effects set up. */
    protected unUseEffects(_prevProps: P): void {
    }

    /**
     * Reports one failure a teardown or an effect replacement collected, dev only.
     *
     * Reporting is the last thing these paths do with a failure: a callback that failed must be
     * heard about, but never at the cost of the work queued behind it or of React's lifecycle
     * seeing the error. The guard is the one the store's delivery paths use, so a production
     * build reports nothing.
     *
     * @param failure - the message to report, already naming what ran and what it cost
     */
    public [C.reportTeardownFailure](failure: string): void {
        if (process.env.NODE_ENV !== 'production') {
            diagnostics.report(failure);
        }
    }

    /**
     * Records of effects keyed by the effect function itself; allocated lazily.
     */
    private [C.functionEffects]: Map<TEffect, IEffectRecord> | undefined = undefined;

    /** Event registrations are stored under an internal symbol to avoid subclass field collisions. */
    private [C.eventSubscriptions]?: Array<{
        store: object;
        name: PropertyKey;
        handler: (payload: never) => void;
        dispose: TDisposer;
    }>;

    /**
     * Subscribes a stable handler to a typed store event for this component's lifetime.
     * One registration is kept per handler; changing its store or event replaces that registration.
     *
     * @param store - the event-capable carburetor
     * @param name - the event to receive
     * @param handler - a stable (normally `@bind`) event handler
     */
    protected useEvent<TEvents extends object, K extends keyof TEvents>(
        store: ICarburetorEvents<TEvents>,
        name: K,
        handler: (payload: TEvents[K]) => void
    ): void {
        let registrations = this[C.eventSubscriptions];

        if (registrations === undefined) {
            registrations = [];
            this[C.eventSubscriptions] = registrations;
        }

        const current = registrations.find(record => record.handler === handler);

        if (current && current.store === store && current.name === name) return;
        if (current) {
            current.dispose();
            registrations.splice(registrations.indexOf(current), 1);
        }
        const dispose = store.on(name, handler);
        registrations.push({
            store: store as object,
            name: name as PropertyKey,
            handler: handler as (payload: never) => void,
            dispose,
        });
    }

    /**
     * Runs `callBack` when its dependencies changed since the last run, keyed by name.
     *
     * Two effects sharing one name would overwrite each other's deps and cleanup — see the
     * no-duplicate-effect-name rule. For a stable effect function (module-level or a `@bind`
     * method), prefer the function-keyed overload below: the function itself is the key, so
     * no collision is possible.
     *
     * @param name - the key in the per-effect record
     * @param callBack - the effect body
     * @param deps - compared shallowly with the last run's
     */
    protected useEffect(name: string, callBack: TEffect, deps: TEffectDeps): void;
    /**
     * Runs a stable effect function when its dependencies changed since the last run.
     *
     * The effect function itself is the key, so two different functions never collide, however
     * they are named. Intended for module-level functions and `@bind` methods; an inline
     * closure is a new function every render and would re-run every time — use the name-keyed
     * overload for those.
     *
     * Whatever the effect returns is treated as its cleanup, exactly as in the name-keyed form.
     *
     * @param effect - the stable effect function, used as its own key
     * @param deps - compared shallowly with the last run's
     */
    protected useEffect(effect: TEffect, deps: TEffectDeps): void;
    /**
     * Implementation of both overloads: a string first argument keys the effect by name, a function by itself.
     *
     * @param nameOrEffect - the effect name, or the stable effect function used as its own key
     * @param callBackOrDeps - the effect body in the name-keyed form, the dependencies in the function-keyed one
     * @param deps - the dependencies in the name-keyed form
     */
    protected useEffect(
        nameOrEffect: string | TEffect,
        callBackOrDeps?: TEffect | TEffectDeps,
        deps?: TEffectDeps
    ): void {
        if (typeof nameOrEffect === 'string') {
            const callBack = callBackOrDeps as TEffect;

            const records = this[C.effects];
            const known = records && Object.prototype.hasOwnProperty.call(records, nameOrEffect)
                ? records[nameOrEffect] : undefined;

            if (known && shallowEqual(known.deps, deps!)) {
                return;
            }

            const record: IEffectRecord = {deps: deps!, cleanup: undefined};

            this[C.ensureEffects]()[nameOrEffect] = record;
            this[C.runEffect](known, record, callBack!);

            return;
        }

        const depsOrNone = deps === undefined ? callBackOrDeps as TEffectDeps : deps;
        const records = this[C.functionEffects];
        const known = records && records.get(nameOrEffect);

        if (known && shallowEqual(known.deps, depsOrNone)) {
            return;
        }

        let functionRecords = records;

        if (functionRecords === undefined) {
            functionRecords = new Map<TEffect, IEffectRecord>();
            this[C.functionEffects] = functionRecords;
        }

        const record: IEffectRecord = {deps: depsOrNone, cleanup: undefined};

        functionRecords.set(nameOrEffect, record);
        this[C.runEffect](known, record, nameOrEffect);
    }

    /**
     * Runs the replaced cleanup isolated, then the new setup into `record`.
     *
     * Shared by both keying forms, which store `record` before calling this: a setup that
     * throws leaves the new deps standing with no cleanup, and nothing still points at the
     * cleanup that already ran. A replaced cleanup is teardown work, so its failure is
     * reported once the replacement finished, never thrown at the new run.
     *
     * @param known - the record being replaced, if the effect ran before
     * @param record - the new record, already stored under its key
     * @param callBack - the effect body to run
     */
    private [C.runEffect](
        known: IEffectRecord | undefined,
        record: IEffectRecord,
        callBack: TEffect
    ): void {
        // The replaced cleanup is teardown work: it must not cost us the new run, so its
        // failure waits for the report until the replacement finished.
        const failures: unknown[] = [];

        if (known && known.cleanup) {
            try {
                known.cleanup();
            } catch (error: unknown) {
                failures.push(error);
            }
        }

        try {
            const cleanup = callBack();

            record.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
        } finally {
            failures.forEach((error: unknown) => this[C.reportTeardownFailure](
                'an effect cleanup threw while an effect was replaced: ' +
                describeFailure(error) + '. The new effect ran anyway.'
            ));
        }
    }

    /**
     * Returns the effects dictionary, allocating it on first use.
     *
     * A component that never calls `useEffect` never needs this dictionary; allocating it here,
     * rather than as a class field default, keeps that component from paying for it.
     */
    private [C.ensureEffects](): IDict<IEffectRecord> {
        if (this[C.effects] !== undefined) {
            return this[C.effects]!;
        }

        const records: IDict<IEffectRecord> = Object.create(null);
        this[C.effects] = records;

        return records;
    }

    /**
     * Runs every effect's cleanup once, on unmount, and forgets them.
     *
     * Each cleanup is isolated, so one that throws costs the cleanups after it neither their
     * turn nor their record: the whole set is dropped once every cleanup has had its turn, and
     * what they collected is reported instead of thrown into the unmount that called this.
     *
     * Absent effects (never allocated) skip straight past: nothing ran, nothing to release.
     */
    public [C.releaseEffects](): void {
        const records = this[C.effects];

        this[C.effects] = undefined;

        const functionRecords = this[C.functionEffects];

        this[C.functionEffects] = undefined;

        const eventSubscriptions = this[C.eventSubscriptions];
        this[C.eventSubscriptions] = undefined;

        if (records === undefined && functionRecords === undefined && eventSubscriptions === undefined) {
            return;
        }

        const failures: unknown[] = [];

        if (records !== undefined) {
            Object.keys(records).forEach((name: string) => {
                const cleanup = records[name].cleanup;

                if (cleanup) {
                    try {
                        cleanup();
                    } catch (error: unknown) {
                        failures.push(error);
                    }
                }
            });
        }

        if (functionRecords !== undefined) {
            functionRecords.forEach((record: IEffectRecord) => {
                const cleanup = record.cleanup;

                if (cleanup) {
                    try {
                        cleanup();
                    } catch (error: unknown) {
                        failures.push(error);
                    }
                }
            });
        }

        eventSubscriptions?.forEach(record => {
            try {
                record.dispose();
            } catch (error: unknown) {
                failures.push(error);
            }
        });

        // One report per teardown, covering both string-keyed and function-keyed cleanups.
        failures.forEach((error: unknown) => this[C.reportTeardownFailure](
            'an effect cleanup threw while a component unmounted: ' +
            describeFailure(error) + '. The teardown completed anyway.'
        ));
    }
}
