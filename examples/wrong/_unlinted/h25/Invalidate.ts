interface IApi {renameUser(id: string, name: string): Promise<void>}

declare const api: IApi;

export async function demo(id: string, name: string): Promise<void> {
    // #region doc
    await api.renameUser(id, name);
    // nothing else
    // #endregion doc
}
