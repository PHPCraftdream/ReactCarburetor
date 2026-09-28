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
            installed: void 0,
            attemptTag: void 0,
            attemptSource: void 0,
            attemptEntry: void 0
        };
        this.recorder = this.recordPath.bind(this);
    }
    tagAttempt(attempt) {
        const connection = this.connection;
        if (connection.attemptTag !== attempt) {
            connection.attemptTag = attempt;
            connection.attemptSource = void 0;
            connection.attemptEntry = void 0;
        }
    }
    resolveAttemptSource() {
        const attempt = this.getAttempt();
        if (!attempt) return this.getCarburetor();
        this.tagAttempt(attempt);
        const connection = this.connection;
        if (void 0 !== connection.attemptSource) return connection.attemptSource;
        const carburetor = this.getCarburetor();
        connection.attemptSource = carburetor;
        return carburetor;
    }
    recordPath(path) {
        const attempt = this.getAttempt();
        if (!attempt) return;
        this.tagAttempt(attempt);
        const connection = this.connection;
        let entry = connection.attemptEntry;
        if (!entry) {
            const carburetor = this.resolveAttemptSource();
            entry = {
                source: carburetor,
                baselineVersion: carburetor.getVersion(),
                reads: new Set()
            };
            connection.attemptEntry = entry;
            if (void 0 === attempt.connections) attempt.connections = [];
            attempt.connections.push(connection);
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
