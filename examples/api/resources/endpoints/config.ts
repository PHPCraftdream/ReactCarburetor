let loader = (): Promise<{theme: string}> => Promise.resolve({theme: 'dark'});

/** The application's config endpoint; `fetchConfig.use` swaps the transport in tests. */
export const fetchConfig = Object.assign((): Promise<{theme: string}> => loader(), {
    use(next: () => Promise<{theme: string}>): void {
        loader = next;
    },
});
