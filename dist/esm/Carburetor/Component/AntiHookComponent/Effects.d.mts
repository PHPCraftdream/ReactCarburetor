import { TEffect, TEffectDeps } from "../../Models/Base.mjs";
import { AntiHookComponentReads } from "./Reads.mjs";
export declare abstract class AntiHookComponentEffects<P = {}, S = {}> extends AntiHookComponentReads<P, S> {
    /**
     * Where a subclass declares its effects; called after every commit.
     */
    protected useEffects(): void;
    /** Where a subclass tears down what the previous props' effects set up. */
    protected unUseEffects(_prevProps: P): void;
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
    protected reportTeardownFailure: (failure: string) => void;
    /**
     * Runs one stage of the unmount teardown, isolated so a failure there costs the stages after
     * it nothing.
     *
     * The failure is filed as the message its report will use and the caller moves on: nothing
     * here throws, whatever the stage does.
     *
     * @param what - the sentence fragment naming the stage, for the failure message
     * @param stage - the stage itself
     * @param failures - the messages collected so far, appended to when the stage throws
     */
    protected runTeardownStage: (what: string, stage: () => void, failures: string[]) => void;
    /**
     * Runs `callBack` when its dependencies changed since the last run.
     *
     * Whatever the effect returns is treated as its cleanup and is run before the effect runs
     * again, and on unmount — so setup and teardown stay paired per effect rather than being
     * one global hook for the whole component.
     *
     * A replaced cleanup is teardown work, so it runs isolated: its failure is reported once the
     * replacement finished, never thrown at the new run. The record moves to the new deps before
     * the setup runs and holds no cleanup until the setup returns one, so a setup that throws
     * leaves the record consistent — new deps, no cleanup — instead of a stale cleanup a later
     * unmount would run a second time.
     *
     * @param callBack - the effect body; a function it returns becomes the cleanup, run before
     * the next run and on unmount
     * @param name - the key in the per-effect record, so two effects sharing one name would
     * overwrite each other's deps and cleanup
     * @param deps - compared shallowly with the last run's; an equal set skips the run and
     * leaves the existing cleanup standing
     */
    protected useEffect: (callBack: TEffect, name: string, deps: TEffectDeps) => void;
    /**
     * Runs every effect's cleanup once, on unmount, and forgets them.
     *
     * Each cleanup is isolated, so one that throws costs the cleanups after it neither their
     * turn nor their record: the whole set is dropped once every cleanup has had its turn, and
     * what they collected is reported instead of thrown into the unmount that called this.
     */
    protected releaseEffects(): void;
}
