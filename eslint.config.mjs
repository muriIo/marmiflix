import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  // sw/**: separate service-worker global scope (webworker lib), not part of
  // the app's tsconfig project - see sw/tsconfig.json. public/sw.js is its
  // compiled output (npm run build:sw), not hand-edited source.
  { ignores: [".next/**", "next-env.d.ts", "sw/**", "public/sw.js"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
