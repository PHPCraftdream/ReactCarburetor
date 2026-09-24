import { EResourceStatus } from "../../Models/Enums/EResourceStatus.mjs";
import { WILDCARD_PATH } from "../../Store/Paths/WildcardPath.mjs";
import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { IS_DEVELOPMENT } from "../../Store/Utils/DevelopmentFlag.mjs";
import { buildPersistentView } from "../Connection/buildPersistentView.mjs";
import { declareConnection } from "../Connection/declareConnection.mjs";
import { detachSelection } from "../Connection/detachSelection.mjs";
import { reportLiveViewEscape } from "../Connection/reportLiveViewEscape.mjs";
import { sameSelection } from "../Connection/sameSelection.mjs";
import { AntiHookComponentFoundation } from "./Foundation.mjs";
const CONNECTION_ATTEMPT_KEY = "c:";
const TRACKED_ATTEMPT_KEY = "t:";
class AntiHookComponentReads extends AntiHookComponentFoundation {
    useCarburetor = (carburetor)=>{
        const attempt = this.renderAttempt;
        const entry = this.track(carburetor);
        return carburetor.read((path)=>{
            if (void 0 !== attempt && this.renderAttempt === attempt) entry.reads.add(path);
        });
    };
    declareConnection = (source)=>declareConnection(this.connections, CONNECTION_ATTEMPT_KEY, ()=>this.renderAttempt, source);
    connect = (source)=>{
        const declared = this.declareConnection(source);
        const view = buildPersistentView(declared);
        declared.connection.view = view;
        return view;
    };
    connectSelection = (source, select)=>{
        const declared = this.declareConnection(source);
        const view = buildPersistentView(declared);
        declared.connection.view = view;
        let snapshot;
        let escapeReported = false;
        return ()=>{
            const next = select(view);
            if (IS_DEVELOPMENT && !escapeReported) escapeReported = reportLiveViewEscape(next);
            if (void 0 !== snapshot && sameSelection(snapshot.value, next)) return snapshot.value;
            snapshot = {
                value: detachSelection(next)
            };
            return snapshot.value;
        };
    };
    useComputed = (computed)=>{
        this.track(computed).reads.add(WILDCARD_PATH);
        return computed.get();
    };
    useResource = (source, args)=>{
        this.track(source).reads.add(source.pathOf(args));
        const view = source.getEntry(args);
        const worthFetching = view.stale && !view.refreshing && view.status !== EResourceStatus.Error && !view.failed;
        const attempt = this.renderAttempt;
        if (worthFetching) {
            if (attempt) attempt.deferredLoads.push(()=>{
                source.load(args);
            });
            else if (IS_DEVELOPMENT) diagnostics.report('useResource() skipped the deferred load for entry ' + source.pathOf(args) + " because it ran outside a render attempt. That is the only place a deferred load can be attributed to a commit: run useResource() inside render(), the way every other read API is meant to run, or refresh the entry from an effect.");
        }
        return view;
    };
    loadStaleResources() {
        const attempt = this.pendingAttempt;
        if (void 0 === attempt || attempt.abandoned || attempt !== this.committedAttempt) return;
        const queued = attempt.deferredLoads;
        attempt.deferredLoads = [];
        queued.forEach((load)=>load());
    }
    track(source) {
        const attempt = this.renderAttempt;
        if (!attempt) return {
            connection: void 0,
            source,
            baselineVersion: source.getVersion(),
            reads: new Set()
        };
        const cuid = source.getUID();
        let entry = attempt.entries.get(TRACKED_ATTEMPT_KEY + cuid);
        if (!entry) {
            entry = {
                connection: void 0,
                source,
                baselineVersion: source.getVersion(),
                reads: new Set()
            };
            attempt.entries.set(TRACKED_ATTEMPT_KEY + cuid, entry);
        }
        return entry;
    }
}
export { AntiHookComponentReads };
