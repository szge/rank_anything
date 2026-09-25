#!/usr/bin/env node
import { main } from "./cli.ts";

// Exit quietly when output is piped into something that stops reading (e.g. `| head`).
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(0);
    throw e;
  });
}

process.exitCode = main(process.argv.slice(2));
