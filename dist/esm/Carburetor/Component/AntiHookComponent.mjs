import { EResourceStatus } from "../Models/Enums/EResourceStatus.mjs";
import { getUid } from "../Store/Utils/getUid.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
import { shallowEqual } from "./shallowEqual.mjs";
import * as __rspack_external_react from "react";
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
const CONNECTION_ATTEMPT_KEY = 'c:';
const TRACKED_ATTEMPT_KEY = 't:';
const renderBoundaries = new WeakSet();
class AntiHookComponent extends __rspack_external_react.Component {
    uid = getUid();
    effects = {};
    tracked = {};
    connections = [];
    renderAttempt = void 0;
    pendingAttempt = void 0;
    committedAttempt = void 0;
    staleResources = [];
    constructor(props){
        super(props);
        this.wrapRender();
    }
    UNSAFE_componentWillMount() {
        this.wrapRender();
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
        this.unUseEffects(this.props);
        this.releaseEffects();
        this.releaseSubscriptions();
    }
    useCarburetor = (carburetor)=>{
        const attempt = this.renderAttempt;
        const entry = this.track(carburetor);
        return carburetor.read((path)=>{
            if (void 0 !== attempt && this.renderAttempt === attempt) entry.reads.add(path);
        });
    };
    connect = (source)=>{
        const getCarburetor = 'function' == typeof source ? source : ()=>source;
        const connection = {
            uid: getUid(),
            getCarburetor,
            committed: void 0,
            installed: void 0
        };
        this.connections.push(connection);
        const recorder = (path)=>{
            const attempt = this.renderAttempt;
            if (!attempt) return;
            let entry = attempt.entries.get(CONNECTION_ATTEMPT_KEY + connection.uid);
            if (!entry) {
                const carburetor = getCarburetor();
                entry = {
                    connection,
                    source: carburetor,
                    baselineVersion: carburetor.getVersion(),
                    reads: new Set()
                };
                attempt.entries.set(CONNECTION_ATTEMPT_KEY + connection.uid, entry);
            }
            entry.reads.add(path);
        };
        let cachedTarget;
        let cachedView;
        const resolveView = ()=>{
            const carburetor = getCarburetor();
            const data = carburetor.getData();
            if (cachedTarget !== data) {
                cachedTarget = data;
                cachedView = carburetor.read(recorder);
            }
            return cachedView;
        };
        const forbidWrite = ()=>{
            throw new Error("Carburetor: data read through connect() is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
        };
        return new Proxy({}, {
            get: (_target, key)=>Reflect.get(resolveView(), key),
            has: (_target, key)=>Reflect.has(resolveView(), key),
            ownKeys: (_target)=>Reflect.ownKeys(resolveView()),
            getOwnPropertyDescriptor: (_target, key)=>Reflect.getOwnPropertyDescriptor(resolveView(), key),
            set: forbidWrite,
            deleteProperty: forbidWrite,
            defineProperty: forbidWrite
        });
    };
    useComputed = (computed)=>{
        this.track(computed).reads.add(WILDCARD_PATH);
        return computed.get();
    };
    useResource = (source, args)=>{
        this.track(source).reads.add(source.pathOf(args));
        const view = source.getEntry(args);
        const worthFetching = view.stale && !view.refreshing && view.status !== EResourceStatus.Error && !view.failed;
        if (worthFetching) this.staleResources.push(()=>{
            source.load(args);
        });
        return view;
    };
    loadStaleResources() {
        const queued = this.staleResources;
        this.staleResources = [];
        queued.forEach((load)=>load());
    }
    wrapRender() {
        const realRender = this.render;
        if ('function' != typeof realRender || renderBoundaries.has(realRender)) return;
        const boundary = ()=>{
            const attempt = this.openRenderAttempt();
            try {
                return realRender.call(this);
            } catch (error) {
                attempt.abandoned = true;
                throw error;
            } finally{
                this.closeRenderAttempt(attempt);
            }
        };
        renderBoundaries.add(boundary);
        this.render = boundary;
    }
    openRenderAttempt() {
        const attempt = {
            entries: new Map(),
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
        let entry = attempt.entries.get(TRACKED_ATTEMPT_KEY + source.getUID());
        if (!entry) {
            entry = {
                connection: void 0,
                source,
                baselineVersion: source.getVersion(),
                reads: new Set()
            };
            attempt.entries.set(TRACKED_ATTEMPT_KEY + source.getUID(), entry);
        }
        return entry;
    }
    useEffects() {}
    unUseEffects(_prevProps) {}
    useEffect = (callBack, name, deps)=>{
        const known = this.effects[name];
        if (known && shallowEqual(known.deps, deps)) return;
        if (known && known.cleanup) known.cleanup();
        const cleanup = callBack();
        this.effects[name] = {
            deps,
            cleanup: 'function' == typeof cleanup ? cleanup : void 0
        };
    };
    releaseEffects() {
        Object.keys(this.effects).forEach((name)=>{
            const cleanup = this.effects[name].cleanup;
            if (cleanup) cleanup();
        });
        this.effects = {};
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
}
export { AntiHookComponent };
