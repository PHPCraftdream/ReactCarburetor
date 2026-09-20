import * as React from "react";
import {AntiHookComponent} from "./AntiHookComponent";
import {getUid} from "./Utils/getUid";

/**
 * Identifies a carburetor inside a scope and knows how to build it.
 * A token is a module-level constant; the instances it produces are not.
 */
export interface ICarburetorToken<T> {
    id: string;
    create: () => T;
}

export const carburetorToken = <T extends unknown>(create: () => T): ICarburetorToken<T> => {
    return {id: getUid(), create};
};

/**
 * One set of carburetor instances. Create a scope per server request instead of keeping
 * module-level singletons: a singleton on the server is shared by every request, which
 * leaks one user's state into another's render.
 */
export class CarburetorScope {
    protected instances: Map<string, unknown> = new Map<string, unknown>();

    public get = <T extends unknown>(token: ICarburetorToken<T>): T => {
        const known = this.instances.get(token.id);

        if (known !== undefined) {
            return known as T;
        }

        const created = token.create();
        this.instances.set(token.id, created);

        return created;
    };

    /** Replaces an instance — useful for tests and for hydrating a prepared store. */
    public set = <T extends unknown>(token: ICarburetorToken<T>, instance: T): void => {
        this.instances.set(token.id, instance);
    };

    public has = <T extends unknown>(token: ICarburetorToken<T>): boolean => {
        return this.instances.has(token.id);
    };
}

export const CarburetorContext: React.Context<CarburetorScope | null> =
    React.createContext<CarburetorScope | null>(null);

interface ICarburetorProviderProps {
    scope: CarburetorScope;
    children?: React.ReactNode;
}

export class CarburetorProvider extends React.Component<ICarburetorProviderProps> {
    public render() {
        return (
            <CarburetorContext.Provider value={this.props.scope}>
                {this.props.children}
            </CarburetorContext.Provider>
        );
    }
}

/**
 * A component that resolves its carburetors from the surrounding scope rather than from
 * module-level singletons. Uses `contextType`, so no hooks are involved.
 */
export class ScopedAntiHookComponent<P = {}, S = {}> extends AntiHookComponent<P, S> {
    public static contextType = CarburetorContext;

    declare public context: CarburetorScope | null;

    protected scope(): CarburetorScope {
        if (!this.context) {
            throw new Error(
                'Carburetor: no scope found. Wrap the tree in <CarburetorProvider scope={...}> ' +
                'before using a scoped component.'
            );
        }

        return this.context;
    }

    protected resolve<T extends unknown>(token: ICarburetorToken<T>): T {
        return this.scope().get(token);
    }
}
