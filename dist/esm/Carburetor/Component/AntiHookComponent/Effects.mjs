"use client";
import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { AntiHookComponentReads } from "./Reads.mjs";
import { shallowEqual } from "../shallowEqual.mjs";
const describeFailure = (error)=>error instanceof Error ? error.message : String(error);
class AntiHookComponentEffects extends AntiHookComponentReads {
    useEffects() {}
    unUseEffects(_prevProps) {}
    reportTeardownFailure(failure) {
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV) diagnostics.report(failure);
    }
    useEffect(name, callBack, deps) {
        var _this_effects;
        const known = null == (_this_effects = this.effects) ? void 0 : _this_effects[name];
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
        this.ensureEffects()[name] = record;
        try {
            const cleanup = callBack();
            record.cleanup = 'function' == typeof cleanup ? cleanup : void 0;
        } finally{
            failures.forEach((error)=>this.reportTeardownFailure('an effect cleanup threw while an effect was replaced: ' + describeFailure(error) + '. The new effect ran anyway.'));
        }
    }
    ensureEffects() {
        if (void 0 === this.effects) this.effects = {};
        return this.effects;
    }
    releaseEffects() {
        const records = this.effects;
        if (void 0 === records) return;
        this.effects = void 0;
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
