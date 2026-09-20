import { WILDCARD_PATH } from "./Paths.mjs";
import { getUid } from "./Utils/getUid.mjs";
import * as __rspack_external_react from "react";
class AntiHookComponent extends __rspack_external_react.Component {
    uid = getUid();
    lastValues = {};
    tracked = {};
    renderGeneration = 0;
    componentDidMount() {
        this.commitSubscriptions();
        this.useEffects();
    }
    componentDidUpdate(prevProps) {
        this.commitSubscriptions();
        this.unUseEffects(prevProps);
        this.useEffects();
    }
    componentWillUnmount() {
        this.unUseEffects(this.props);
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
    useEffect = (callBack, name, lastValue)=>{
        if (name in this.lastValues) {
            if (this.lastValues[name] === lastValue) return;
        }
        this.lastValues[name] = lastValue;
        callBack();
    };
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
            tracked.carburetor.subscribe(this.onCarburetorUpdate, this.uid, new Set(tracked.reads));
            if (tracked.carburetor.getVersion() !== tracked.version) changedDuringRender = true;
        });
        this.renderGeneration = generation + 1;
        if (changedDuringRender) this.forceUpdate();
    }
    releaseSubscriptions() {
        Object.keys(this.tracked).forEach((cuid)=>{
            this.tracked[cuid].carburetor.unsubscribe(this.uid);
        });
        this.tracked = {};
    }
}
export { AntiHookComponent };
