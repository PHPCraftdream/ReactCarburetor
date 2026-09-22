/**
 * Binds a method to its instance, once, at construction time.
 *
 * ```tsx
 * class TodoRow extends AntiHookComponent<IProps> {
 *     @bind
 *     protected onToggle(): void {
 *         todoCarburetor.toggle(this.props.id);
 *     }
 *
 *     public render() {
 *         return <button onClick={this.onToggle}>toggle</button>;
 *     }
 * }
 * ```
 *
 * Two reasons this exists rather than an arrow class property:
 *
 * The method stays on the prototype. An arrow property replaces it on the instance, so
 * `super.method()` and overriding in a subclass stop working — which is how declaring a
 * lifecycle method as a property silently disables effects.
 *
 * The bound reference is stable for the lifetime of the instance. `this.onToggle.bind(this)`
 * or `() => this.onToggle()` written in render produces a new function every render, so a
 * child's props always compare as changed and the props gate in `shouldComponentUpdate`
 * stops bailing out — the re-render this engine exists to avoid comes back.
 *
 * Requires standard (Stage 3) decorators, supported by TypeScript 5+, SWC, Babel 7.20+ and
 * esbuild 0.21+. This is not the legacy `experimentalDecorators` flavour.
 *
 * @param method - the decorated method; bound to the instance once, while the original stays
 * on the prototype so `super.method()` still resolves
 * @param context - supplied by the runtime; its initializer installs the bound own property
 * at construction, and a `kind` other than 'method' is rejected
 */
export declare const bind: <This, TArgs extends unknown[], TReturn>(method: (this: This, ...args: TArgs) => TReturn, context: ClassMethodDecoratorContext<This, (this: This, ...args: TArgs) => TReturn>) => void;
