let loader = (id: string): Promise<{name: string}> => Promise.resolve({name: `User ${id}`});

/** The application's user endpoint; `fetchUser.use` swaps the transport in tests. */
export const fetchUser = Object.assign((id: string): Promise<{name: string}> => loader(id), {
    use(next: (id: string) => Promise<{name: string}>): void {
        loader = next;
    },
});
