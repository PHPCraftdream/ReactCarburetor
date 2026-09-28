import { diagnostics } from "../Store/Diagnostics/DiagnosticsInstance.mjs";
import { renderOwner } from "./renderOwner.mjs";
const reported = new WeakSet();
const reportComputedEscape = (source, isSubscriber)=>{
    if (reported.has(source)) return;
    const owner = renderOwner.get();
    if (void 0 === owner || isSubscriber(owner.uid) || owner.hasTracked(source)) return;
    reported.add(source);
    diagnostics.report("a component rendered through a computed's live result without subscribing to it: the value reached it through props instead of its own useComputed() call. A write inside the result then re-renders the whole tree that produced it, not just this component. Return ids or plain values from the computed and read the store in the row, or pass {equals} so an unaffected recompute does not re-announce.");
};
export { reportComputedEscape };
