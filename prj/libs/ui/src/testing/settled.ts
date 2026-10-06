/** Lets every pending promise chain run to completion: a macrotask drains the microtasks. */
export function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
