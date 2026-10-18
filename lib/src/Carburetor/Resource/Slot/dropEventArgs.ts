/** A DOM event (or React's synthetic wrapper) in the first position is not loader arguments. */
export const dropEventArgs = <TArgs extends readonly unknown[]>(args: TArgs): TArgs => {
    const first: unknown = args[0];
    // The runtime cannot know the tuple length, so an event means "no real arguments".
    if (typeof Event !== 'undefined' && first instanceof Event) return [] as unknown as TArgs;
    if (first !== null && typeof first === 'object') {
        const nativeEvent = (first as {nativeEvent?: unknown}).nativeEvent;
        if (typeof Event !== 'undefined' && nativeEvent instanceof Event) return [] as unknown as TArgs;
        // DOM-less runtimes (React Native): a plain-object wrapper is still an event.
        if (typeof Event === 'undefined' && nativeEvent !== null && typeof nativeEvent === 'object'
            && typeof (first as {isDefaultPrevented?: unknown}).isDefaultPrevented === 'function') {
            return [] as unknown as TArgs;
        }
    }
    return args;
};
