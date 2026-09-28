import { getUid } from "../../Store/Utils/getUid.mjs";
class ConnectionSource {
    getAttempt;
    connection;
    getCarburetor;
    recorder;
    arrayFacade = false;
    probeError = void 0;
    cachedTarget = void 0;
    cachedView = void 0;
    constructor(getAttempt, source){
        this.getAttempt = getAttempt;
        this.getCarburetor = 'function' == typeof source ? source : ()=>source;
        this.connection = {
            uid: getUid(),
            getCarburetor: this.getCarburetor,
            committed: void 0,
            installed: void 0
        };
        this.recorder = this.recordPath.bind(this);
    }
    resolveAttemptSource() {
        var _attempt_sources;
        const attempt = this.getAttempt();
        if (!attempt) return this.getCarburetor();
        const resolved = null == (_attempt_sources = attempt.sources) ? void 0 : _attempt_sources.get(this.connection);
        if (void 0 !== resolved) return resolved;
        const carburetor = this.getCarburetor();
        if (void 0 === attempt.sources) attempt.sources = new Map();
        attempt.sources.set(this.connection, carburetor);
        return carburetor;
    }
    recordPath(path) {
        const attempt = this.getAttempt();
        if (!attempt) return;
        if (void 0 === attempt.connections) attempt.connections = new Map();
        let entry = attempt.connections.get(this.connection);
        if (!entry) {
            const carburetor = this.resolveAttemptSource();
            entry = {
                source: carburetor,
                baselineVersion: carburetor.getVersion(),
                reads: new Set()
            };
            attempt.connections.set(this.connection, entry);
        }
        entry.reads.add(path);
    }
}
const declareConnection = (connections, getAttempt, source)=>{
    const state = new ConnectionSource(getAttempt, source);
    connections.push(state.connection);
    return state;
};
export { declareConnection };
