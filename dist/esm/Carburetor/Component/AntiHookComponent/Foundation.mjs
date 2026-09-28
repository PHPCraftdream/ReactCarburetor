"use client";
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
    installRenderBoundary() {
        let rawRender;
        let boundary;
        let assigned = false;
        Object.defineProperty(this, RENDER_KEY, {
            configurable: false,
            enumerable: false,
            get: ()=>{
                const raw = assigned ? rawRender : Reflect.get(Object.getPrototypeOf(this), RENDER_KEY, this);
                if ('function' != typeof raw) return raw;
                if (void 0 === boundary || raw !== rawRender) {
                    rawRender = raw;
                    boundary = this.buildRenderBoundary(raw);
                }
                return boundary;
            },
            set: (value)=>{
                assigned = 'function' == typeof value;
                rawRender = value;
                boundary = assigned ? this.buildRenderBoundary(value) : void 0;
            }
        });
    }
    constructor(props){
        super(props);
        this.installRenderBoundary();
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
        failures.forEach((failure)=>this.reportTeardownFailure(failure));
    }
    buildRenderBoundary(realRender) {
        return ()=>{
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
