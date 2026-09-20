/** Path to a data field, e.g. `items.workTodo1.title`. */
export type TPath = string;

export type TPathSet = Set<TPath>;

/** Records a path that has been read or written. */
export type TPathRecorder = (path: TPath) => void;
