const describeError = (error)=>{
    if (error instanceof Error) return error.message;
    return String(error);
};
export { describeError };
