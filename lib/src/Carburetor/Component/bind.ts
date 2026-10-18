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
 * The bound reference is resolved at construction time from the most-derived override:
 * base-class initializers run before subclass initializers and subclass prototypes already
 * exist, so an override in a subclass is picked up even without its own `@bind`. Applying
 * `@bind` to a `#private` method throws: a private name is not reachable as a property, so
 * no bound reference can be installed.
 *
 * Requires standard (Stage 3) decorators, supported by TypeScript 5+, SWC, Babel 7.20+ and
 * esbuild 0.21+. This is not the legacy `experimentalDecorators` flavour.
 *
 * @param method - the decorated method; bound to the instance once, while the original stays
 * on the prototype so `super.method()` still resolves
 * @param context - supplied by the runtime; its initializer installs the bound own property
 * at construction, and a `kind` other than 'method' is rejected
 */
export const bind = <This, TArgs extends unknown[], TReturn>(
    method: (this: This, ...args: TArgs) => TReturn,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: TArgs) => TReturn>
): void => {
    if (context.kind !== 'method') {
        throw new Error(
            'Carburetor: @bind applies to methods. A class property is already bound to its ' +
            'instance, and a getter has nothing to bind.'
        );
    }

    if (context.private === true) {
        throw new Error(
            'Carburetor: @bind cannot bind a private method. A private name is not reachable ' +
            'as a property, so no bound reference can be installed for it. Use a public or ' +
            'protected method, or an arrow class property, instead.'
        );
    }

    context.addInitializer(function (this: This) {
        // Initializers run in class order and subclass prototypes already exist, so the
        // lookup resolves the most-derived override; without one it resolves `method`.
        const target = (this as unknown as Record<string | symbol, unknown>)[context.name];
        const bound = (typeof target === 'function' ? target : method).bind(this);

        // Own property shadowing the prototype method for calls through the instance, while
        // the prototype keeps the original so `super` still resolves.
        Object.defineProperty(this, context.name, {
            value: bound,
            writable: true,
            configurable: true,
            enumerable: false,
        });
    });
};
