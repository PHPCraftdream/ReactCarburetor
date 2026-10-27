import carburetor from '@react-carburetor/core/lint';

export default [
    {...carburetor.configs.recommended, files: ['src/**/*.{ts,tsx}']},
];