const takenNames = new Set();
const carburetorToken = (create, name)=>{
    if ('' === name) throw new Error('Carburetor: a token needs a non-empty name: it is the key the client hydrates from.');
    if (takenNames.has(name)) throw new Error('Carburetor: a token named "' + name + '" already exists. Two tokens under one name would overwrite each other in a scope and in a dehydrate() payload; give one of them its own name.');
    takenNames.add(name);
    return {
        id: name,
        create
    };
};
export { carburetorToken };
