import {carburetorToken, ComponentUpdateThrottle} from "@/Carburetor";
import {getInitialStatus} from "@/ToDo/Carburetors/getInitialStatus";
import {StatusCarburetor} from "@/ToDo/Carburetors/StatusCarburetor";

/**
 * The footer's emit status, one instance per scope. It changes on every list write, so its
 * updates are coalesced: at most one delivery per 250 ms.
 */
export const statusToken = carburetorToken(
    () => new StatusCarburetor(getInitialStatus(), new ComponentUpdateThrottle(250)),
    'status'
);
