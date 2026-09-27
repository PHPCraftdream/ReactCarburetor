import {carburetorToken} from "@/Carburetor";
import {FilterCarburetor} from "@/ToDo/Carburetors/FilterCarburetor";

/** The list filter, one instance per scope. */
export const filterToken = carburetorToken(() => new FilterCarburetor(), 'filter');
