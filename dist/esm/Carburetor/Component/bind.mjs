const bind = (method, context)=>{
    if ('method' !== context.kind) throw new Error("Carburetor: @bind applies to methods. A class property is already bound to its instance, and a getter has nothing to bind.");
    context.addInitializer(function() {
        Object.defineProperty(this, context.name, {
            value: method.bind(this),
            writable: true,
            configurable: true,
            enumerable: false
        });
    });
};
export { bind };
