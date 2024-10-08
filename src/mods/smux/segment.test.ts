import { Opaque, Readable, Writable } from "@hazae41/binary";
import { Bytes } from "@hazae41/bytes";
import { assert, test } from "@hazae41/phobos";
import { relative, resolve } from "path";
import { SmuxSegment } from "./segment.js";

const directory = resolve("./dist/test/")
const { pathname } = new URL(import.meta.url)
console.log(relative(directory, pathname.replace(".mjs", ".ts")))

test("kcp segment", async ({ test }) => {
  const version = 2
  const command = SmuxSegment.commands.psh
  const stream = 12345
  const fragment = new Opaque(Bytes.random(130))

  const segment = SmuxSegment.newOrThrow({ version, command, stream, fragment })
  const bytes = Writable.writeToBytesOrThrow(segment)
  const frame2 = Readable.readFromBytesOrThrow(SmuxSegment, bytes)

  assert(Bytes.equals2(segment.fragment.bytes, frame2.fragment.bytes))
})