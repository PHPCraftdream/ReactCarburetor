import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { AntiHookComponentReads } from "./Reads.mjs";
import { shallowEqual } from "../shallowEqual.mjs";
const describeFailure = (error)=>error instanceof Error ? error.message : String(error);
class AntiHookComponentEffects extends AntiHookComponentReads {
    useEffects() {}
    unUseEffects(_prevProps) {}
    reportTeardownFailure = (failure)=>{
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV) diagnostics.report(failure);
    };
    runTeardownStage = (what, stage, failures)=>{
        try {
            stage();
        } catch (error) {
            failures.push(what + ': ' + describeFailure(error) + '. The teardown completed anyway.');
        }
    };
    useEffect = (callBack, name, deps)=>{
        const known = this.effects[name];
        if (known && shallowEqual(known.deps, deps)) return;
        const failures = [];
        if (known && known.cleanup) try {
            known.cleanup();
        } catch (error) {
            failures.push(error);
        }
        const record = {
            deps,
            cleanup: void 0
        };
        this.effects[name] = record;
        try {
            const cleanup = callBack();
            record.cleanup = 'function' == typeof cleanup ? cleanup : void 0;
        } finally{
            failures.forEach((error)=>this.reportTeardownFailure('an effect cleanup threw while an effect was replaced: ' + describeFailure(error) + '. The new effect ran anyway.'));
        }
    };
    releaseEffects() {
        const records = this.effects;
        this.effects = {};
        const failures = [];
        Object.keys(records).forEach((name)=>{
            const cleanup = records[name].cleanup;
            if (cleanup) try {
                cleanup();
            } catch (error) {
                failures.push(error);
            }
        });
        failures.forEach((error)=>this.reportTeardownFailure('an effect cleanup threw while a component unmounted: ' + describeFailure(error) + '. The teardown completed anyway.'));
    }
}
export { AntiHookComponentEffects };
