import {IReadableCarburetor} from "@/Carburetor/Models/Store";
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
    public readonly getCarburetor: () => IReadableCarburetor<T>;
    /** The read recorder every read through the persistent view reports to; bound once. */
    public readonly recorder: TPathRecorder;

    /** Reads record here instead of into an attempt while a notification-time run owns the view. */
    public scratch: Set<TPath> | undefined = undefined;
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
        source: IReadableCarburetor<T> | (() => IReadableCarburetor<T>)
    ) {
        this.getCarburetor = typeof source === 'function' ? source : () => source;
        this.connection = {
            uid: getUid(), getCarburetor: this.getCarburetor, committed: undefined, installed: undefined,
            attemptTag: undefined, attemptSource: undefined, attemptEntry: undefined,
        };
        // The one detached function this declaration hands off: carburetor.read() calls it
        // later, off this instance's own call stack, so it has to carry `this` along with it.
        this.recorder = this.recordPath.bind(this);
    }

    /**
     * Drops this connection's per-attempt memo once the attempt currently open stops matching
     * the one it was captured for.
     *
     * R16-09: `attemptSource`/`attemptEntry` live on the connection itself, tagged by the
     * attempt they belong to, instead of a `Map` the render attempt allocated fresh every time.
     *
     * @param attempt - the attempt currently open, or undefined outside one
     */
    private tagAttempt(attempt: IRenderAttempt): void {
        const connection = this.connection;

        if (connection.attemptTag !== attempt) {
            connection.attemptTag = attempt;
            connection.attemptSource = undefined;
            connection.attemptEntry = undefined;
        }
    }

    /**
     * The source resolved for the attempt currently open, memoized per attempt.
     *
     * The attempt's first read resolves it and tags the connection with it, and every later
     * read of the same attempt reuses that instance. Outside an attempt nothing is cached, so a
     * handler read or the declaration-time shape probe always sees the resolver's current answer.
     */
    public resolveAttemptSource(): IReadableCarburetor<T> {
        const attempt = this.getAttempt();

        if (!attempt) {
            return this.getCarburetor();
        }

        this.tagAttempt(attempt);

        const connection = this.connection;

        if (connection.attemptSource !== undefined) {
            return connection.attemptSource as IReadableCarburetor<T>;
        }

        const carburetor = this.getCarburetor();

        connection.attemptSource = carburetor;

        return carburetor;
    }

    /**
     * Records one read path against the attempt currently open, opening this connection's entry
     * on the first read and appending it to the attempt's touched list at that same moment.
     *
     * Outside an attempt nothing is recorded: a handler, effect or child callback read can
     * never alter a render's dependency set.
     *
     * @param path - the path a read through the persistent view touched
     */
    private recordPath(path: TPath): void {
        if (this.scratch !== undefined) {
            this.scratch.add(path);

            return;
        }

        const attempt = this.getAttempt();

        if (!attempt) {
            return;
        }

        this.tagAttempt(attempt);

        const connection = this.connection;
        let entry = connection.attemptEntry;

        if (!entry) {
            // The source and its baseline version are captured once, at the beginning of this
            // attempt's consumption — not refreshed after every property access — so a write
            // landing mid-render or mid-commit stays detectable at commit time. The source is
            // not resolved again here: this read is arriving through the view, whose resolution
            // already fixed this attempt's source.
            const carburetor = this.resolveAttemptSource();

            entry = {source: carburetor, baselineVersion: carburetor.getVersion(), reads: new Set<TPath>()};
            connection.attemptEntry = entry;

            if (attempt.connections === undefined) {
                attempt.connections = [];
            }

            attempt.connections.push(connection);
        }

        if (entry.sharedReads === true && !entry.reads.has(path)) {
            entry.reads = new Set<TPath>(entry.reads);
            entry.sharedReads = false;
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
    source: IReadableCarburetor<T> | (() => IReadableCarburetor<T>)
): IConnectionSource<T> => {
    const state = new ConnectionSource<T>(getAttempt, source);

    connections.push(state.connection);

    return state;
};
