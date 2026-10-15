class Store extends Carburetor<{ value: unknown }> {
    set<T>(): void {
        this.update((draft: { value: T | undefined }) => { draft.value = undefined; });
    }
}
