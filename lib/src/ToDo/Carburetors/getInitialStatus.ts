import {IStatusData} from "./Models";

/** The status store's starting state. */
export const getInitialStatus = (): IStatusData => {
    return {
        emittedMessage: ''
    };
};
