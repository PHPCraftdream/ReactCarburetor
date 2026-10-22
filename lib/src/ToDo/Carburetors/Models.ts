import {ITodo} from "../API/Models";
import {ETodoFilter} from "../Models/Enums/ETodoFilter";

export type TUpdateTodo = (data: ITodo) => void;

export type TDeleteTodo = (id: string) => void;

export interface IStatusData {
    emittedMessage: string;
}

export interface IFilterData {
    filter: ETodoFilter;
}

export interface IUndoData {
    canUndo: boolean;
    canRedo: boolean;
}
