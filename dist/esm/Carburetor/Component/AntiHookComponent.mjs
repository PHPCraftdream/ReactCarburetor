import { EResourceStatus } from "../Models/Enums/EResourceStatus.mjs";
import { getUid } from "../Store/Utils/getUid.mjs";
import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
import { shallowEqual } from "./shallowEqual.mjs";
import * as __rspack_external_react from "react";
class AntiHookComponent extends __rspack_external_react.Component {
    uid = getUid();
    effects = {};
    tracked = {};
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
    useComputed = (computed)=>{
        this.track(computed).reads.add(WILDCARD_PATH);
        return computed.get();
    };
    useResource = (source, args)=>{
        this.track(source).reads.add(source.pathOf(args));
        const view = source.getEntry(args);
        const worthFetching = view.stale && !view.refreshing && view.status !== EResourceStatus.Error;
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
            generation: this.renderGeneration
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
            tracked.carburetor.subscribe(this.onCarburetorUpdate, {
                id: this.uid,
                reads: tracked.reads
            });
            if (tracked.carburetor.getVersion() !== tracked.version) changedDuringRender = true;
        });
        this.renderGeneration = generation + 1;
        if (changedDuringRender) this.forceUpdate();
    }
    releaseSubscriptions() {
        Object.keys(this.tracked).forEach((cuid)=>{
            this.tracked[cuid].carburetor.unsubscribe(this.uid);
            this.tracked[cuid].generation = this.renderGeneration;
        });
    }
}
export { AntiHookComponent };
