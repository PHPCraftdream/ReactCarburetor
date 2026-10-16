/** A DOM event (or React's synthetic wrapper) in the first position is not loader arguments. */
export const dropEventArgs = <TArgs extends readonly unknown[]>(args: TArgs): TArgs => {
    const first: unknown = args[0];
    // Runtimes without DOM events (React Native, bare workers) have no Event to test against.
    if (typeof Event === 'undefined') return args;
    // The runtime cannot know the tuple length, so an event means "no real arguments".
    if (first instanceof Event) return [] as unknown as TArgs;
    if (first !== null && typeof first === 'object'
        && (first as {nativeEvent?: unknown}).nativeEvent instanceof Event) return [] as unknown as TArgs;
    return args;
};
