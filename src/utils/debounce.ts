// utilities: debounce wrapper for promise-based actions (optional)
export function debouncePromise<T extends (...args: any[]) => Promise<any>>(fn: T, wait = 2000) {
  let locked = false;
  return async function (...args: Parameters<T>): Promise<ReturnType<T>> {
    if (locked) {
      return Promise.reject(new Error("debounced"));
    }
    locked = true;
    try {
      const res = await fn(...args);
      return res;
    } finally {
      setTimeout(() => {
        locked = false;
      }, wait);
    }
  };
}
