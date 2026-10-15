let loader = (id: string): Promise<{id: string; title: string}> => Promise.resolve({id, title: `Post ${id}`});

/** The application's post endpoint; `fetchPost.use` swaps the transport in tests. */
export const fetchPost = Object.assign((id: string): Promise<{id: string; title: string}> => loader(id), {
    use(next: (id: string) => Promise<{id: string; title: string}>): void {
        loader = next;
    },
});
