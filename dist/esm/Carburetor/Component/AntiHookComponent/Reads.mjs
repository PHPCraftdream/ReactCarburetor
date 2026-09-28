"use client";
import { EResourceStatus } from "../../Models/Enums/EResourceStatus.mjs";
import { WILDCARD_PATH } from "../../Store/Paths/WildcardPath.mjs";
import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { IS_DEVELOPMENT } from "../../Store/Utils/DevelopmentFlag.mjs";
import { buildTrackedView } from "./buildTrackedView.mjs";
import { buildPersistentView } from "../Connection/buildPersistentView.mjs";
import { declareConnection } from "../Connection/declareConnection.mjs";
import { detachSelection } from "../Connection/detachSelection.mjs";
import { reportLiveViewEscape } from "../Connection/reportLiveViewEscape.mjs";
import { sameSelection } from "../Connection/sameSelection.mjs";
import { AntiHookComponentFoundation } from "./Foundation.mjs";
class AntiHookComponentReads extends AntiHookComponentFoundation {
    trackedViews;
    getRenderAttempt = ()=>this.renderAttempt;
    useCarburetor(carburetor) {
        const attempt = this.renderAttempt;
        const entry = this.track(carburetor);
        if (void 0 === this.trackedViews) this.trackedViews = new WeakMap();
        return buildTrackedView(this.trackedViews, carburetor, this.getRenderAttempt, attempt, entry);
    }
    declareConnection(source) {
        return declareConnection(this.connections, this.getRenderAttempt, source);
    }
    connect(source) {
        const declared = this.declareConnection(source);
        return buildPersistentView(declared);
    }
    connectSelection(source, select) {
        const declared = this.declareConnection(source);
        const view = buildPersistentView(declared);
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
    }
    useComputed(computed) {
        this.track(computed).reads.add(WILDCARD_PATH);
        return computed.get();
    }
    useResource(source, args) {
        const { path, view } = source.resolve(args);
        this.track(source).reads.add(path);
        const worthFetching = view.stale && !view.refreshing && view.status !== EResourceStatus.Error && !view.failed;
        const attempt = this.renderAttempt;
        if (worthFetching) {
            if (attempt) {
                if (void 0 === attempt.deferredLoads) attempt.deferredLoads = [];
                attempt.deferredLoads.push(()=>{
                    source.load(args);
                });
            } else if (IS_DEVELOPMENT) diagnostics.report('useResource() skipped the deferred load for entry ' + path + " because it ran outside a render attempt. That is the only place a deferred load can be attributed to a commit: run useResource() inside render(), the way every other read API is meant to run, or refresh the entry from an effect.");
        }
        return view;
    }
    loadStaleResources() {
        const attempt = this.pendingAttempt;
        if (void 0 === attempt || attempt.abandoned || attempt !== this.committedAttempt) return;
        const queued = attempt.deferredLoads;
        if (void 0 === queued) return;
        attempt.deferredLoads = void 0;
        queued.forEach((load)=>load());
    }
    track(source) {
        const attempt = this.renderAttempt;
        if (!attempt) return {
            source,
            baselineVersion: source.getVersion(),
            reads: new Set()
        };
        let tracked = attempt.tracked;
        if (void 0 === tracked) {
            tracked = new Map();
            attempt.tracked = tracked;
        }
        let entry = tracked.get(source);
        if (!entry) {
            entry = {
                source,
                baselineVersion: source.getVersion(),
                reads: new Set()
            };
            tracked.set(source, entry);
        }
        return entry;
    }
}
export { AntiHookComponentReads };
