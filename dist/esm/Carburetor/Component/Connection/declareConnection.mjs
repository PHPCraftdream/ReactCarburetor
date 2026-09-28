import { getUid } from "../../Store/Utils/getUid.mjs";
const declareConnection = (connections, attemptKeyPrefix, getAttempt, source)=>{
    const getCarburetor = 'function' == typeof source ? source : ()=>source;
    const connection = {
        uid: getUid(),
        getCarburetor,
        committed: void 0,
        installed: void 0
    };
    const attemptKey = attemptKeyPrefix + connection.uid;
    connections.push(connection);
    const resolveAttemptSource = ()=>{
        const attempt = getAttempt();
        if (!attempt) return getCarburetor();
        const resolved = attempt.sources.get(attemptKey);
        if (void 0 !== resolved) return resolved;
        const carburetor = getCarburetor();
        attempt.sources.set(attemptKey, carburetor);
        return carburetor;
    };
    const recorder = (path)=>{
        const attempt = getAttempt();
        if (!attempt) return;
        let entry = attempt.entries.get(attemptKey);
        if (!entry) {
            const carburetor = resolveAttemptSource();
            entry = {
                connection,
                source: carburetor,
                baselineVersion: carburetor.getVersion(),
                reads: new Set()
            };
            attempt.entries.set(attemptKey, entry);
        }
        entry.reads.add(path);
    };
    return {
        connection,
        getCarburetor,
        resolveAttemptSource,
        recorder
    };
};
export { declareConnection };
