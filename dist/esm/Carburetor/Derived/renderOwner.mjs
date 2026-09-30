class RenderOwner {
    current = void 0;
    get() {
        return this.current;
    }
    set(owner) {
        this.current = owner;
    }
}
const renderOwner = new RenderOwner();
export { renderOwner };
