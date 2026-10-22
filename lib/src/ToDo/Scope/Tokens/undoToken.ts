import {carburetorToken} from "../../../Carburetor/index";
import {ITodoList} from "../../API/Models";
import {UndoCarburetor} from "../../Carburetors/UndoCarburetor";

/** Undo/redo over one scope's list; createTodoScope seeds it. */
export const undoToken = carburetorToken<UndoCarburetor<ITodoList>>(() => {
    throw new Error('undoToken is seeded by createTodoScope: it needs that scope\'s own list.');
}, 'undo');
