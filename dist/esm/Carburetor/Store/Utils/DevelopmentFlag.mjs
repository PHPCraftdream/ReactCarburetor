const IS_DEVELOPMENT = "u" > typeof process && 'production' !== process.env.NODE_ENV;
export { IS_DEVELOPMENT };
