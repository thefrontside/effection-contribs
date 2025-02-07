import { main, suspend } from "effection";

await main(function* () {
  try {
    yield* suspend();
  } finally {
    console.log("done");
  }
});
