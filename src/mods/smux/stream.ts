import { Opaque, Writable } from "@hazae41/binary"
import { Bytes } from "@hazae41/bytes"
import { Cursor } from "@hazae41/cursor"
import { Ok, Result } from "@hazae41/result"
import { SecretSmuxReader } from "./reader.js"
import { SecretSmuxWriter } from "./writer.js"

export class SmuxDuplex {

  readonly #secret: SecretSmuxDuplex

  constructor(
    readonly stream: ReadableWritablePair<Opaque, Writable>
  ) {
    this.#secret = new SecretSmuxDuplex(stream)
  }

  get readable() {
    return this.#secret.readable
  }

  get writable() {
    return this.#secret.writable
  }

}

export class SecretSmuxDuplex {
  readonly #class = SecretSmuxDuplex

  selfRead = 0
  selfWrite = 0
  selfIncrement = 0

  peerConsumed = 0
  peerWindow = 65535

  readonly reader: SecretSmuxReader
  readonly writer: SecretSmuxWriter

  readonly readable: ReadableStream<Opaque>
  readonly writable: WritableStream<Writable>

  readonly buffer: Cursor<Bytes<65_535>> = Cursor.allocUnsafe(65_535)

  readonly streamID = 3

  constructor(
    readonly stream: ReadableWritablePair<Opaque, Writable>
  ) {
    this.reader = new SecretSmuxReader(this)
    this.writer = new SecretSmuxWriter(this)

    const read = this.reader.stream.start()
    const write = this.writer.stream.start()

    this.readable = read.readable
    this.writable = write.writable

    stream.readable
      .pipeTo(read.writable)
      .then(this.#onReadClose.bind(this))
      .catch(this.#onReadError.bind(this))
      .then(r => r.ignore())
      .catch(console.error)

    write.readable
      .pipeTo(stream.writable)
      .then(this.#onWriteClose.bind(this))
      .catch(this.#onWriteError.bind(this))
      .then(r => r.ignore())
      .catch(console.error)
  }

  get selfWindow() {
    return this.buffer.bytes.length
  }

  async #onReadClose() {
    console.debug(`${this.#class.name}.onReadClose`)

    this.reader.stream.closed = {}

    await this.reader.events.emit("close", undefined)

    return Ok.void()
  }

  async #onWriteClose() {
    console.debug(`${this.#class.name}.onWriteClose`)

    this.writer.stream.closed = {}

    await this.writer.events.emit("close", undefined)

    return Ok.void()
  }

  async #onReadError(reason?: unknown) {
    console.debug(`${this.#class.name}.onReadError`, { reason })

    this.reader.stream.closed = { reason }
    this.writer.stream.error(reason)

    await this.reader.events.emit("error", reason)

    return Result.rethrow(reason)
  }

  async #onWriteError(reason?: unknown) {
    console.debug(`${this.#class.name}.onWriteError`, { reason })

    this.writer.stream.closed = { reason }
    this.reader.stream.error(reason)

    await this.writer.events.emit("error", reason)

    return Result.rethrow(reason)
  }

}