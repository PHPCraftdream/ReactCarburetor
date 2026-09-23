class Widget extends AntiHookComponent {
    // carburetor-disable-next-line carburetor/no-lifecycle-class-property
    componentDidMount = (): void => {};

    render() {
        // carburetor-disable-next-line carburetor/require-method-for-closure
        return <button onClick={() => this.handle()}/>;
    }

    // carburetor-disable-next-line carburetor/require-module-function
    sync(): void {
        store.getData();
    }
}
