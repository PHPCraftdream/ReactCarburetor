import {carburetorToken} from "@/Carburetor";
import {TodoViews} from "@/ToDo/Derived/TodoViews";

/** The derived values over one scope's list and filter; createTodoScope seeds it. */
export const viewsToken = carburetorToken<TodoViews>(() => {
    throw new Error('viewsToken is seeded by createTodoScope: it needs that scope\'s own list and filter.');
}, 'views');
