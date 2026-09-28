import { IRenderOwner } from "./Models.js";
/**
 * Holds whichever component's render is on the stack right now, so a computed's live-read
 * recorder can tell a legitimate subscriber's read from one that escaped through props into
 * some other component's render (see Computed.recordDependencyRead).
 *
 * Set by `AntiHookComponentFoundation.buildRenderBoundary` around the subclass's own render,
 * and restored to the previous owner in a `finally` — a rare synchronously nested render
 * leaves the outer owner intact once it returns. Consulted only by a development diagnostic:
 * a stale or absent owner only weakens that diagnostic, never tracking or notification.
 */
declare class RenderOwner {
    /** The owner currently on the stack, or undefined between renders. */
    protected current: IRenderOwner | undefined;
    /** The component whose render is on the stack right now, if any. */
    get(): IRenderOwner | undefined;
    /**
     * Replaces the current owner: the render boundary calls this with the new owner on entry,
     * and again with whatever owner was on the stack before it on exit.
     *
     * @param owner - the owner to make current; undefined between renders
     */
    set(owner: IRenderOwner | undefined): void;
}
/** The single render-owner pointer every component's render boundary shares. */
export declare const renderOwner: RenderOwner;
export {};
