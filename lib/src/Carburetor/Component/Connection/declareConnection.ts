import {ICarburetor} from "@/Carburetor/Models/Store";
import {TPath, TPathRecorder} from "@/Carburetor/Models/Paths";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {IConnection, IConnectionSource, IRenderAttempt} from "@/Carburetor/Component/Models/Connection";

/**
 * Declares one connect()-family connection into its owner's persistent list and builds the
 * closures its view is read through, so both declarations share one piece of machinery.
 *
 * The declaration only ever pushes a connection and closes over it: React can construct an
 * instance and later decide never to commit it, so any subscription taken here would leak one
 * for a component that never mounted. Everything the recorder captures stays tentative until
 * the commit that consumes the attempt.
 *
 * @param connections - the owner's persistent declaration list, appended to and never pruned
 * @param attemptKeyPrefix - the attempt-map key prefix marking entries that publish to a connection
 * @param getAttempt - reads the render attempt currently open on the owner, if any
 * @param source - the carburetor to read, or a function resolving it at each attempt's first read
 */
export const declareConnection = <T extends object>(
    connections: IConnection[],
    attemptKeyPrefix: string,
    getAttempt: () => IRenderAttempt | undefined,
    source: ICarburetor<T> | (() => ICarburetor<T>)
): IConnectionSource<T> => {
    const getCarburetor: () => ICarburetor<T> = typeof source === 'function' ? source : () => source;

    const connection: IConnection = {uid: getUid(), getCarburetor, committed: undefined, installed: undefined};

    connections.push(connection);

    // The connection's source, resolved at most once per render attempt: the attempt's
    // first read resolves it into the attempt's collection, and every later read of the
    // same attempt — the recorder's baseline capture included — reuses that instance. The
    // memo lives and dies with the attempt, so no source selection is carried across
    // renders, and outside an attempt (an event read, the declaration-time shape probe)
    // nothing is cached: the resolver runs again, so a handler read still sees current
    // data. The underlying root is not part of this memo: view resolution re-reads
    // getData() on every access, so a setData() root replacement stays visible.
    const resolveAttemptSource = (): ICarburetor<T> => {
        const attempt = getAttempt();

        if (!attempt) {
            return getCarburetor();
        }

        const key = attemptKeyPrefix + connection.uid;
        // The key is this connection's alone and only this closure writes it, so the value
        // it names is always the ICarburetor<T> this declaration resolved.
        const resolved = attempt.sources.get(key) as ICarburetor<T> | undefined;

        if (resolved !== undefined) {
            return resolved;
        }

        const carburetor = getCarburetor();

        attempt.sources.set(key, carburetor);

        return carburetor;
    };

    const recorder: TPathRecorder = (path: TPath): void => {
        const attempt = getAttempt();

        // Outside a render attempt the read still gets current data, but records nothing:
        // a handler, effect or child callback can never alter a render's dependency set.
        if (!attempt) {
            return;
        }

        let entry = attempt.entries.get(attemptKeyPrefix + connection.uid);

        if (!entry) {
            // The source and its baseline version are captured once, at the beginning of
            // this attempt's consumption — not refreshed after every property access — so
            // a write landing mid-render or mid-commit stays detectable at commit time.
            // The source is not resolved again here: this read is arriving through the
            // view, whose resolution already fixed this attempt's source.
            const carburetor = resolveAttemptSource();

            entry = {
                connection,
                source: carburetor,
                baselineVersion: carburetor.getVersion(),
                reads: new Set<TPath>(),
            };
            attempt.entries.set(attemptKeyPrefix + connection.uid, entry);
        }

        entry.reads.add(path);
    };

    return {connection, getCarburetor, resolveAttemptSource, recorder};
};
