class Widget extends AntiHookComponent {
    // oxlint-disable-next-line carburetor/no-lifecycle-class-property
    componentDidMount = (): void => {};

    render() {
        // oxlint-disable-next-line carburetor/require-method-for-closure, carburetor/no-function-in-render
        return <button onClick={() => this.handle()}/>;
    }

    // oxlint-disable-next-line carburetor/require-module-function
    sync(): void {
        store.getData();
    }
}
