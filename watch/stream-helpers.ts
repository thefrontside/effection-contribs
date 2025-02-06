import { race, sleep, type Stream } from "effection";

export function debounce<T, R>(
  ms: number,
): (stream: Stream<T, R>) => Stream<T, R> {
  return (stream) => ({
    *[Symbol.iterator]() {
      let subscription = yield* stream;
      return {
        *next() {
          let next = yield* subscription.next();
          while (true) {
            let result = yield* race([sleep(ms), subscription.next()]);
            if (!result) {
              return next;
            } else {
              next = result;
            }
          }
        },
      };
    },
  });
}

export function filter<T, R>(
  predicate: (item: T) => boolean,
): (stream: Stream<T, R>) => Stream<T, R> {
  return (stream) => ({
    *[Symbol.iterator]() {
      let subscription = yield* stream;
      return {
        *next() {
          let next = yield* subscription.next();
          while (!next.done && !predicate(next.value)) {
            next = yield* subscription.next();
          }
          return next;
        },
      };
    },
  });
}
