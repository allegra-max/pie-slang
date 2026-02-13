import { runWithLib } from './lib_runner.js';

const testCode = `
(claim test-vec (Vec Nat 2))
(define test-vec
  (vec:: 1 (vec:: 2 vecnil)))

(claim len-2 Nat)
(define len-2 2)

(first Nat 1 test-vec)
`;

console.log("Running test with library...");
try {
  const result = runWithLib(testCode);
  console.log("Result:", result);
} catch (e) {
  console.error("Error running library test:", e);
}
