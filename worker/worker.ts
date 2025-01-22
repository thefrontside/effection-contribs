import { assert } from "https://deno.land/std@0.158.0/testing/asserts.ts";
import {
  createSignal,
  each,
  Err,
  main,
  Ok,
  on,
  once,
  type Operation,
  resource,
  type Result,
  scoped,
  spawn,
  withResolvers,
} from "npm:effection@4.0.0-alpha.4";

export interface WorkerResource<TSend, TRecv, TReturn>
  extends Operation<TReturn> {
  send(data: TSend): Operation<TRecv>;
}

export interface WorkerMessages<TSend, TRecv> {
  forEach(fn: (message: TSend) => Operation<TRecv>): Operation<void>;
}

export interface WorkerMainOptions<TSend, TRecv, TData> {
  messages: WorkerMessages<TSend, TRecv>;
  data: TData;
}

export type WorkerControl<TSend, TData> = {
  type: "init";
  data: TData;
} | {
  type: "send";
  value: TSend;
  response: MessagePort;
} | {
  type: "close";
};

export async function workerMain<TSend, TRecv, TReturn, TData>(
  body: (options: WorkerMainOptions<TSend, TRecv, TData>) => Operation<TReturn>,
): Promise<void> {
  await main(function* () {
    let sent = createSignal<{ value: TSend; response: MessagePort }>();
    let controls = yield* on(self, "message");
    let outcome = withResolvers<Result<TReturn>>();

    self.postMessage({ type: "open" });

    let result = yield* scoped(function* () {
      yield* spawn(function* () {
        let next = yield* controls.next();
        while (true) {
          let control: WorkerControl<TSend, TData> = next.value.data;
          if (control.type === "init") {
            yield* spawn(function* () {
              try {
                let value = yield* body({
                  data: control.data,
                  messages: {
                    *forEach(fn: (value: TSend) => Operation<TRecv>) {
                      for (let { value, response } of yield* each(sent)) {
                        yield* spawn(function* () {
                          try {
                            let result = yield* fn(value);
                            response.postMessage(Ok(result));
                          } catch (error) {
                            response.postMessage(Err(error as Error));
                          }
                        });
                        yield* each.next();
                      }
                    },
                  },
                });

                outcome.resolve(Ok(value));
              } catch (error) {
                outcome.resolve(Err(error as Error));
              }
            });
          } else if (control.type === "send") {
            let { value, response } = control;
            sent.send({ value, response });
          } else if (control.type === "close") {
            outcome.resolve(Err(new Error(`worker terminated`)));
          }
          next = yield* controls.next();
        }
      });

      return yield* outcome.operation;
    });
    self.postMessage({ type: "close", result });
  });
}

/**
 * Use on the main thread to create a well behaved web worker.
 *
 * ```ts
 * import { run } from "effection";
 * import { useWorker } from "@effection-contrib/worker"
 *
 * await run(function*() {
 *    const worker = yield* useWorker("script.js", { type: "module" })
 * });
 * ```
 *
 * @param url {URL} or {string} of script
 * @param options {WorkerOptions}
 * @typeparam {TSend} messages that can be sent to worker
 * @typeparam {TRecv} messages that can be received from worker
 * @returns {Operation<WorkerResource<TSend, TRecv>>}
 */
export function useWorker<TSend, TRecv, TReturn, TData>(
  url: string | URL,
  options?: WorkerOptions & { data?: TData },
): Operation<WorkerResource<TSend, TRecv, TReturn>> {
  return resource(function* (provide) {
    let outcome = withResolvers<TReturn>();

    let worker = new Worker(url, options);
    let subscription = yield* on(worker, "message");

    let onclose = (event: MessageEvent) => {
      if (event.data.type === "close") {
        let { result } = event.data as { result: Result<TReturn> };
        if (result.ok) {
          outcome.resolve(result.value);
        } else {
          outcome.reject(result.error);
        }
      }
    };

    worker.addEventListener("message", onclose);

    let first = yield* subscription.next();

    assert(
      first.value.data.type === "open",
      `expected first message to arrive from worker to be of type "open", but was: ${first.value.data.type}`,
    );

    yield* spawn(function* () {
      let event = yield* once(worker, "error");
      event.preventDefault();
      throw event.error;
    });

    try {
      worker.postMessage({
        type: "init",
        data: options?.data,
      });

      yield* provide({
        *send(value) {
          let channel = yield* useMessageChannel();
          worker.postMessage({
            type: "send",
            value,
            response: channel.port2,
          }, [channel.port2]);
          channel.port1.start();
          let event = yield* once(channel.port1, "message");
          let result = event.data;
          if (result.ok) {
            return result.value;
          } else {
            throw result.error;
          }
        },
        [Symbol.iterator]: outcome.operation[Symbol.iterator],
      });
    } finally {
      worker.postMessage({ type: "close" });
      yield* settled(outcome.operation);
      worker.removeEventListener("message", onclose);
    }
  });
}

function useMessageChannel(): Operation<MessageChannel> {
  return resource(function* (provide) {
    let channel = new MessageChannel();
    try {
      yield* provide(channel);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });
}

function settled<T>(operation: Operation<T>): Operation<Result<void>> {
  return {
    *[Symbol.iterator]() {
      try {
        yield* operation;
        return Ok();
      } catch (error) {
        return Err(error as Error);
      }
    },
  };
}
