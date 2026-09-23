import { EResourceStatus } from "../Models/Enums/EResourceStatus.mjs";
import { getUid } from "../Store/Utils/getUid.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
import { diagnostics } from "../Store/Diagnostics/DiagnosticsInstance.mjs";
import { PROXY_CACHE } from "../Store/Tracking/Models.mjs";
import { IS_DEVELOPMENT } from "../Store/Utils/DevelopmentFlag.mjs";
import { buildPersistentView } from "./Connection/buildPersistentView.mjs";
import { declareConnection } from "./Connection/declareConnection.mjs";
import { detachSelection } from "./Connection/detachSelection.mjs";
import { reportLiveViewEscape } from "./Connection/reportLiveViewEscape.mjs";
import { sameSelection } from "./Connection/sameSelection.mjs";
import { shallowEqual } from "./shallowEqual.mjs";
import * as __rspack_external_react from "react";
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
const describeFailure = (error)=>error instanceof Error ? error.message : String(error);
const CONNECTION_ATTEMPT_KEY = 'c:';
const TRACKED_ATTEMPT_KEY = 't:';
const RENDER_KEY = 'render';
class AntiHookComponent extends __rspack_external_react.Component {
    uid = getUid();
    effects = {};
    tracked = {};
    connections = [];
    renderAttempt = void 0;
    pendingAttempt = void 0;
    committedAttempt = void 0;
    constructor(props){
        super(props);
        return this.withRenderBoundary();
    }
    shouldComponentUpdate(nextProps, nextState) {
        return !shallowEqual(this.props, nextProps) || !shallowEqual(this.state, nextState);
    }
    componentDidMount() {
        this.commitSubscriptions();
        this.loadStaleResources();
        this.useEffects();
    }
    componentDidUpdate(prevProps) {
        this.commitSubscriptions();
        this.loadStaleResources();
        this.unUseEffects(prevProps);
        this.useEffects();
    }
    componentWillUnmount() {
        const failures = [];
        this.runTeardownStage("the component-wide unUseEffects callback threw while a component unmounted", ()=>this.unUseEffects(this.props), failures);
        this.runTeardownStage('an effect cleanup threw while a component unmounted', ()=>this.releaseEffects(), failures);
        this.runTeardownStage("releasing subscriptions threw while a component unmounted", ()=>this.releaseSubscriptions(), failures);
        this.runTeardownStage("releasing a connect() view's cache threw while a component unmounted", ()=>this.releaseConnectionViews(), failures);
        failures.forEach((failure)=>this.reportTeardownFailure(failure));
    }
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
    withRenderBoundary() {
        let rawRender;
        let boundary;
        let wrapped = false;
        let receiver;
        const proxy = new Proxy(this, {
            get: (target, key)=>{
                if (key !== RENDER_KEY) return Reflect.get(target, key, receiver);
                const raw = wrapped ? rawRender : Reflect.get(target, RENDER_KEY, receiver);
                if ('function' != typeof raw) return raw;
                if (void 0 === boundary || rawRender !== raw) {
                    rawRender = raw;
                    boundary = this.buildRenderBoundary(raw, receiver);
                }
                return boundary;
            },
            set: (target, key, value)=>{
                if (key !== RENDER_KEY) return Reflect.set(target, key, value, receiver);
                rawRender = value;
                wrapped = 'function' == typeof value;
                boundary = wrapped ? this.buildRenderBoundary(value, receiver) : void 0;
                return true;
            },
            defineProperty: (target, key, descriptor)=>{
                if (key !== RENDER_KEY) return Reflect.defineProperty(target, key, descriptor);
                rawRender = descriptor.value;
                wrapped = 'function' == typeof descriptor.value;
                boundary = wrapped ? this.buildRenderBoundary(descriptor.value, receiver) : void 0;
                return true;
            },
            deleteProperty: (target, key)=>{
                if (key === RENDER_KEY) {
                    rawRender = void 0;
                    boundary = void 0;
                    wrapped = false;
                }
                return Reflect.deleteProperty(target, key);
            },
            has: (target, key)=>key === RENDER_KEY ? wrapped || Reflect.has(target, RENDER_KEY) : Reflect.has(target, key)
        });
        receiver = proxy;
        return proxy;
    }
    buildRenderBoundary(realRender, receiver) {
        return ()=>{
            const attempt = this.openRenderAttempt();
            try {
                return realRender.call(receiver);
            } catch (error) {
                attempt.abandoned = true;
                throw error;
            } finally{
                this.closeRenderAttempt(attempt);
            }
        };
    }
    openRenderAttempt() {
        const attempt = {
            entries: new Map(),
            sources: new Map(),
            deferredLoads: [],
            abandoned: false
        };
        this.renderAttempt = attempt;
        return attempt;
    }
    closeRenderAttempt(attempt) {
        this.pendingAttempt = attempt;
        this.renderAttempt = void 0;
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
    onCarburetorUpdate = ()=>{
        this.forceUpdate();
    };
    commitSubscriptions() {
        const attempt = this.pendingAttempt;
        const fresh = void 0 !== attempt && !attempt.abandoned && attempt !== this.committedAttempt;
        if (fresh) {
            this.committedAttempt = attempt;
            Object.keys(this.tracked).forEach((cuid)=>{
                if (attempt.entries.has(TRACKED_ATTEMPT_KEY + cuid)) return;
                this.releaseSlot(this.uid, this.tracked[cuid]);
                delete this.tracked[cuid];
            });
            this.connections.forEach((connection)=>{
                if (!attempt.entries.has(CONNECTION_ATTEMPT_KEY + connection.uid)) connection.committed = void 0;
            });
            attempt.entries.forEach((entry, key)=>{
                const description = {
                    carburetor: entry.source,
                    baselineVersion: entry.baselineVersion,
                    reads: new Set(entry.reads)
                };
                if (entry.connection) {
                    entry.connection.committed = description;
                    return;
                }
                const cuid = key.slice(TRACKED_ATTEMPT_KEY.length);
                const known = this.tracked[cuid];
                this.tracked[cuid] = {
                    committed: description,
                    installed: known ? known.installed : void 0
                };
            });
        }
        let changedDuringRender = false;
        Object.keys(this.tracked).forEach((cuid)=>{
            if (this.alignSubscription(this.uid, this.tracked[cuid])) changedDuringRender = true;
        });
        this.connections.forEach((connection)=>{
            if (this.alignSubscription(connection.uid, connection)) changedDuringRender = true;
        });
        if (changedDuringRender) this.forceUpdate();
    }
    alignSubscription(uid, slot) {
        const committed = slot.committed;
        const installed = slot.installed;
        if (!committed) {
            if (installed) {
                installed.carburetor.unsubscribe(uid);
                slot.installed = void 0;
            }
            return false;
        }
        if (installed && installed.carburetor !== committed.carburetor) {
            installed.carburetor.unsubscribe(uid);
            slot.installed = void 0;
        }
        if (void 0 === slot.installed || !sameReads(slot.installed.reads, committed.reads)) {
            committed.carburetor.subscribe(this.onCarburetorUpdate, {
                id: uid,
                reads: committed.reads
            });
            slot.installed = {
                carburetor: committed.carburetor,
                reads: new Set(committed.reads)
            };
        }
        return committed.carburetor.getVersion() !== committed.baselineVersion;
    }
    releaseSlot(uid, slot) {
        if (slot.installed) {
            slot.installed.carburetor.unsubscribe(uid);
            slot.installed = void 0;
        }
    }
    releaseSubscriptions() {
        Object.keys(this.tracked).forEach((cuid)=>{
            this.releaseSlot(this.uid, this.tracked[cuid]);
        });
        this.connections.forEach((connection)=>{
            this.releaseSlot(connection.uid, connection);
        });
        this.renderAttempt = void 0;
    }
    releaseConnectionViews() {
        const failures = [];
        this.connections.forEach((connection)=>{
            const view = connection.view;
            if (void 0 === view) return;
            try {
                var _cache_release;
                const cache = view[PROXY_CACHE];
                null == cache || null == (_cache_release = cache.release) || _cache_release.call(cache);
            } catch (error) {
                failures.push(error);
            }
        });
        failures.forEach((error)=>this.reportTeardownFailure("releasing a connect() view's cache threw while a component unmounted: " + describeFailure(error) + '. The teardown completed anyway.'));
    }
}
export { AntiHookComponent };
