type PromiseResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const ensurePromiseWithResolvers = (): void => {
  const promiseConstructor = Promise as typeof Promise & {
    withResolvers?: <T>() => PromiseResolvers<T>;
  };

  if (typeof promiseConstructor.withResolvers === 'function') {
    return;
  }

  promiseConstructor.withResolvers = <T>() => {
    let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
    let reject: (reason?: unknown) => void = () => undefined;
    const promise = new Promise<T>((resolveFn, rejectFn) => {
      resolve = resolveFn;
      reject = rejectFn;
    });
    return { promise, resolve, reject };
  };
};

ensurePromiseWithResolvers();
