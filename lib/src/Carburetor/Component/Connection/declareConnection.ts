import {ICarburetor} from "@/Carburetor/Models/Store";
import {TPath, TPathRecorder} from "@/Carburetor/Models/Paths";
import {TReadonly} from "@/Carburetor/Models/Base";
import {getUid} from "@/Carburetor/Store/Utils/getUid";
import {IConnection, IConnectionSource, IRenderAttempt} from "@/Carburetor/Component/Models/Connection";

/**
 * One connect()-family declaration's whole state: the registered connection, the source
 * resolver, the recorder, and the facade fields `ConnectionFacadeHandler` reads and writes —
 * one object instead of the closures per declaration that R14-07 already removed from the read
 * and write proxies. Only `recorder` is handed off detached, so it is the one bound function.
 *
 * The declaration only ever pushes a connection and closes over it: React can construct an
 * instance and later decide never to commit it, so any subscription taken here would leak one
 * for a component that never mounted. Everything the recorder captures stays tentative until
 * the commit that consumes the attempt.
 */
class ConnectionSource<T extends object> implements IConnectionSource<T> {
    /** The connection this declaration registered. */
    public readonly connection: IConnection;
    /** The carburetor resolver this declaration was created with, normalized to a function. */
    public readonly getCarburetor: () => ICarburetor<T>;
    /** The read recorder every read through the persistent view reports to; bound once. */
    public readonly recorder: TPathRecorder;

    /** Whether the facade is array-shaped; set once by buildPersistentView's shape probe. */
    public arrayFacade = false;
    /** The shape probe's own error, when it threw; kept as a later kind-mismatch's cause. */
    public probeError: unknown = undefined;
    /** The data object the persistent view was last built for. */
    public cachedTarget: T | undefined = undefined;
    /** The persistent view built over `cachedTarget`. */
    public cachedView: TReadonly<T> | undefined = undefined;

    /**
     * Normalizes the source into `getCarburetor` and registers the connection.
     *
     * @param getAttempt - reads the render attempt currently open on the owner, if any
     * @param source - the carburetor to read, or a function resolving it at each attempt's
     * first read
     */
    constructor(
        private readonly getAttempt: () => IRenderAttempt | undefined,
        source: ICarburetor<T> | (() => ICarburetor<T>)
    ) {
        this.getCarburetor = typeof source === 'function' ? source : () => source;
        this.connection = {
            uid: getUid(), getCarburetor: this.getCarburetor, committed: undefined, installed: undefined,
        };
        // The one detached function this declaration hands off: carburetor.read() calls it
        // later, off this instance's own call stack, so it has to carry `this` along with it.
        this.recorder = this.recordPath.bind(this);
    }

    /**
     * The source resolved for the attempt currently open, memoized per attempt.
     *
     * The attempt's first read resolves it into the attempt's map, keyed by this connection, and
     * every later read of the same attempt reuses that instance. Outside an attempt nothing is
     * cached, so a handler read or the declaration-time shape probe always sees the resolver's
     * current answer.
     */
    public resolveAttemptSource(): ICarburetor<T> {
        const attempt = this.getAttempt();

        if (!attempt) {
            return this.getCarburetor();
        }

        // The key is this connection itself and only this class writes it, so the value it
        // names is always the ICarburetor<T> this declaration resolved.
        const resolved = attempt.sources?.get(this.connection) as ICarburetor<T> | undefined;

        if (resolved !== undefined) {
            return resolved;
        }

        const carburetor = this.getCarburetor();

        if (attempt.sources === undefined) {
            attempt.sources = new Map();
        }

        attempt.sources.set(this.connection, carburetor);

        return carburetor;
    }

    /**
     * Records one read path against the attempt currently open, opening this connection's entry
     * — with its baseline version — on the first read. Outside an attempt nothing is recorded: a
     * handler, effect or child callback read can never alter a render's dependency set.
     *
     * @param path - the path a read through the persistent view touched
     */
    private recordPath(path: TPath): void {
        const attempt = this.getAttempt();

        if (!attempt) {
            return;
        }

        if (attempt.connections === undefined) {
            attempt.connections = new Map();
        }

        let entry = attempt.connections.get(this.connection);

        if (!entry) {
            // The source and its baseline version are captured once, at the beginning of this
            // attempt's consumption — not refreshed after every property access — so a write
            // landing mid-render or mid-commit stays detectable at commit time. The source is
            // not resolved again here: this read is arriving through the view, whose resolution
            // already fixed this attempt's source.
            const carburetor = this.resolveAttemptSource();

            entry = {source: carburetor, baselineVersion: carburetor.getVersion(), reads: new Set<TPath>()};
            attempt.connections.set(this.connection, entry);
        }

        entry.reads.add(path);
    }
}

/**
 * Declares one connect()-family connection into its owner's persistent list and builds the one
 * state object both its view and its recorder are read through.
 *
 * @param connections - the owner's persistent declaration list, appended to and never pruned
 * @param getAttempt - reads the render attempt currently open on the owner, if any
 * @param source - the carburetor to read, or a function resolving it at each attempt's first read
 */
export const declareConnection = <T extends object>(
    connections: IConnection[],
    getAttempt: () => IRenderAttempt | undefined,
    source: ICarburetor<T> | (() => ICarburetor<T>)
): IConnectionSource<T> => {
    const state = new ConnectionSource<T>(getAttempt, source);

    connections.push(state.connection);

    return state;
};
