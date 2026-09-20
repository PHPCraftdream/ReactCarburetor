import {ITodo} from "../API/Models";

export type TUpdateTodo = (data: ITodo) => void;

export type TDeleteTodo = (id: string) => void;

export interface ISomeCarburetor {
    emittedMessage: string;
}
