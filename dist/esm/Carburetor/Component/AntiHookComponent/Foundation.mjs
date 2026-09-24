import { getUid } from "../../Store/Utils/getUid.mjs";
import { shallowEqual } from "../shallowEqual.mjs";
import * as __rspack_external_react from "react";
const RENDER_KEY = "render";
class AntiHookComponentFoundation extends __rspack_external_react.Component {
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
}
export { AntiHookComponentFoundation };
