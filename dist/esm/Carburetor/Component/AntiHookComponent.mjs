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
class AntiHookComponent extends __rspack_external_react.Component {
    uid = getUid();
    effects = {};
    tracked = {};
    connections = [];
    renderGeneration = 0;
    staleResources = [];
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
        const tracked = this.track(carburetor);
        return carburetor.read((path)=>{
            tracked.reads.add(path);
        });
    };
    connect = (source)=>{
        const getCarburetor = 'function' == typeof source ? source : ()=>source;
        const connection = {
            uid: getUid(),
            getCarburetor,
            subscribedTo: void 0,
            reads: new Set(),
            generation: -1,
            committed: void 0,
            lastSeenVersion: void 0
        };
        this.connections.push(connection);
        const recorder = (path)=>{
            if (connection.generation !== this.renderGeneration) {
                connection.reads = new Set();
                connection.generation = this.renderGeneration;
            }
            connection.reads.add(path);
            connection.lastSeenVersion = getCarburetor().getVersion();
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
    track(source) {
        const cuid = source.getUID();
        const known = this.tracked[cuid];
        const tracked = known && known.generation === this.renderGeneration ? known : {
            carburetor: source,
            reads: new Set(),
            version: source.getVersion(),
            generation: this.renderGeneration,
            committed: known ? known.committed : void 0
        };
        this.tracked[cuid] = tracked;
        return tracked;
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
        const generation = this.renderGeneration;
        let changedDuringRender = false;
        Object.keys(this.tracked).forEach((cuid)=>{
            const tracked = this.tracked[cuid];
            if (tracked.generation !== generation) {
                tracked.carburetor.unsubscribe(this.uid);
                delete this.tracked[cuid];
                return;
            }
            if (void 0 === tracked.committed || !sameReads(tracked.committed, tracked.reads)) {
                tracked.carburetor.subscribe(this.onCarburetorUpdate, {
                    id: this.uid,
                    reads: tracked.reads
                });
                tracked.committed = new Set(tracked.reads);
            }
            if (tracked.carburetor.getVersion() !== tracked.version) changedDuringRender = true;
        });
        this.connections.forEach((connection)=>{
            const carburetor = connection.getCarburetor();
            if (connection.subscribedTo !== carburetor) {
                if (connection.subscribedTo) connection.subscribedTo.unsubscribe(connection.uid);
                connection.committed = void 0;
                connection.subscribedTo = carburetor;
            }
            if (void 0 === connection.committed || !sameReads(connection.committed, connection.reads)) {
                carburetor.subscribe(this.onCarburetorUpdate, {
                    id: connection.uid,
                    reads: connection.reads
                });
                connection.committed = new Set(connection.reads);
            }
            if (void 0 !== connection.lastSeenVersion && carburetor.getVersion() !== connection.lastSeenVersion) changedDuringRender = true;
        });
        this.renderGeneration = generation + 1;
        if (changedDuringRender) this.forceUpdate();
    }
    releaseSubscriptions() {
        Object.keys(this.tracked).forEach((cuid)=>{
            this.tracked[cuid].carburetor.unsubscribe(this.uid);
            this.tracked[cuid].generation = this.renderGeneration;
            this.tracked[cuid].committed = void 0;
        });
        this.connections.forEach((connection)=>{
            if (connection.subscribedTo) connection.subscribedTo.unsubscribe(connection.uid);
            connection.subscribedTo = void 0;
            connection.committed = void 0;
        });
    }
}
export { AntiHookComponent };
