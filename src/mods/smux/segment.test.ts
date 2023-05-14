import { Opaque, Readable, Writable } from "@hazae41/binary";
import { Bytes } from "@hazae41/bytes";
import { assert, test } from "@hazae41/phobos";
import { webcrypto } from "crypto";
import { relative, resolve } from "path";
import { SmuxSegment } from "./segment.js";

const directory = resolve("./dist/test/")
const { pathname } = new URL(import.meta.url)
console.log(relative(directory, pathname.replace(".mjs", ".ts")))

globalThis.crypto = webcrypto as any

test("kcp segment", async ({ test }) => {
  const version = 2
  const command = SmuxSegment.commands.psh
  const stream = 12345
  const fragment = Opaque.random(130)

  const segment = SmuxSegment.tryNew({ version, command, stream, fragment }).unwrap()
  const bytes = Writable.tryWriteToBytes(segment).unwrap()
  const frame2 = Readable.tryReadFromBytes(SmuxSegment, bytes).unwrap()

  assert(Bytes.equals2(segment.fragment.bytes, frame2.fragment.bytes))
})