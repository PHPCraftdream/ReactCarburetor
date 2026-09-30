"use client";
import { getUid } from "../../Store/Utils/getUid.mjs";
import { shallowEqual } from "../shallowEqual.mjs";
import { renderOwner } from "../../Derived/renderOwner.mjs";
import * as __rspack_external_react from "react";
const RENDER_KEY = "render";
const RENDER_RAW = Symbol('carburetor.antiHookComponent.renderRaw');
const RENDER_BOUNDARY = Symbol('carburetor.antiHookComponent.renderBoundary');
const RENDER_ASSIGNED = Symbol('carburetor.antiHookComponent.renderAssigned');
const describeUnmountFailure = (error)=>error instanceof Error ? error.message : String(error);
class AntiHookComponentFoundation extends __rspack_external_react.Component {
    uid = getUid();
    effects = void 0;
    tracked = void 0;
    connections = [];
    renderAttempt = void 0;
    pendingAttempt = void 0;
    committedAttempt = void 0;
    [RENDER_RAW] = void 0;
    [RENDER_BOUNDARY] = void 0;
    [RENDER_ASSIGNED] = false;
    installRenderBoundary() {
        Object.defineProperty(this, RENDER_KEY, {
            configurable: false,
            enumerable: false,
            get: AntiHookComponentFoundation.renderGetter,
            set: AntiHookComponentFoundation.renderSetter
        });
    }
    static renderGetter() {
        const raw = this[RENDER_ASSIGNED] ? this[RENDER_RAW] : Reflect.get(Object.getPrototypeOf(this), RENDER_KEY, this);
        if ('function' != typeof raw) return raw;
        if (void 0 === this[RENDER_BOUNDARY] || raw !== this[RENDER_RAW]) {
            this[RENDER_RAW] = raw;
            this[RENDER_BOUNDARY] = this.buildRenderBoundary(raw);
        }
        return this[RENDER_BOUNDARY];
    }
    static renderSetter(value) {
        this[RENDER_ASSIGNED] = 'function' == typeof value;
        this[RENDER_RAW] = value;
        this[RENDER_BOUNDARY] = this[RENDER_ASSIGNED] ? this.buildRenderBoundary(value) : void 0;
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
        try {
            this.unUseEffects(this.props);
        } catch (error) {
            failures.push("the component-wide unUseEffects callback threw while a component unmounted: " + describeUnmountFailure(error) + '. The teardown completed anyway.');
        }
        try {
            this.releaseEffects();
        } catch (error) {
            failures.push('an effect cleanup threw while a component unmounted: ' + describeUnmountFailure(error) + '. The teardown completed anyway.');
        }
        try {
            this.releaseSubscriptions();
        } catch (error) {
            failures.push("releasing subscriptions threw while a component unmounted: " + describeUnmountFailure(error) + '. The teardown completed anyway.');
        }
        for(let i = 0; i < failures.length; i++)this.reportTeardownFailure(failures[i]);
    }
    buildRenderBoundary(realRender) {
        return ()=>{
            const attempt = this.openRenderAttempt();
            const development = "u" > typeof process && 'production' !== process.env.NODE_ENV;
            const previousOwner = development ? renderOwner.get() : void 0;
            if (development) renderOwner.set({
                uid: this.uid,
                hasTracked: (source)=>void 0 !== attempt.tracked && attempt.tracked.has(source)
            });
            try {
                return realRender.call(this);
            } catch (error) {
                attempt.abandoned = true;
                throw error;
            } finally{
                if (development) renderOwner.set(previousOwner);
                this.closeRenderAttempt(attempt);
            }
        };
    }
    openRenderAttempt() {
        const attempt = {
            tracked: void 0,
            connections: void 0,
            deferredLoads: void 0,
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
