import carburetor from 'react-carburetor/lint';

export default [
    {...carburetor.configs.recommended, files: ['src/**/*.{ts,tsx}']},
];