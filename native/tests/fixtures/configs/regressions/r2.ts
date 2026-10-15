class Store extends Carburetor<{ value: number }> {
    set(value: number): void {
        this.update(draft => { draft.value = arguments[0]; });
    }
}
