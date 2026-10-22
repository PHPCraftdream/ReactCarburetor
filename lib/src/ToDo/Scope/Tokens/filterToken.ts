import {carburetorToken} from "../../../Carburetor/index";
import {FilterCarburetor} from "../../Carburetors/FilterCarburetor";

/** The list filter, one instance per scope. */
export const filterToken = carburetorToken(() => new FilterCarburetor(), 'filter');
