/**
 * The own enumerable property keys of `value` — strings and symbols alike — in the order
 * `Reflect.ownKeys` reports them.
 *
 * This is the one set the selection comparison and the detachment agree on: a shallow spread
 * (`{...value}`) copies exactly these keys and nothing else, so comparing them is comparing
 * what a child can actually see.
 */
export const ownEnumerableKeys = (value: object): Array<string | symbol> =>
    Reflect.ownKeys(value).filter((key: string | symbol): boolean =>
        Object.prototype.propertyIsEnumerable.call(value, key));
