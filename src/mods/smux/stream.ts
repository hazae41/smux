import { Opaque, Writable } from "@hazae41/binary"
import { Bytes } from "@hazae41/bytes"
import { Cursor } from "@hazae41/cursor"
import { Console } from "mods/console/index.js"
import { SecretSmuxReader } from "./reader.js"
import { SecretSmuxWriter } from "./writer.js"

export class SmuxDuplex {

  readonly #secret: SecretSmuxDuplex

  constructor(
    readonly stream: ReadableWritablePair<Opaque, Writable>
  ) {
    this.#secret = new SecretSmuxDuplex(stream)
  }

  get inner() {
    return this.#secret.inner
  }

  get outer() {
    return this.#secret.outer
  }

}

export class SecretSmuxDuplex {
  readonly #class = SecretSmuxDuplex

  selfRead = 0
  selfWrite = 0
  selfIncrement = 0

  peerConsumed = 0
  peerWindow = 65_535

  readonly reader: SecretSmuxReader
  readonly writer: SecretSmuxWriter

  readonly inner: ReadableWritablePair<Writable, Opaque>
  readonly outer: ReadableWritablePair<Opaque, Writable>

  readonly buffer: Cursor<Bytes<65_535>> = new Cursor(Bytes.alloc(65_535))

  readonly streamID = 3

  constructor(
    readonly stream: ReadableWritablePair<Opaque, Writable>
  ) {
    this.reader = new SecretSmuxReader(this)
    this.writer = new SecretSmuxWriter(this)

    const preInputer = this.reader.stream.start()
    const preOutputer = this.writer.stream.start()

    const postInputer = new TransformStream<Opaque, Opaque>({})
    const postOutputer = new TransformStream<Writable, Writable>({})

    /**
     * Inner protocol (UDP?)
     */
    this.inner = {
      readable: postOutputer.readable,
      writable: preInputer.writable
    }

    /**
     * Outer protocol (SMUX?)
     */
    this.outer = {
      readable: postInputer.readable,
      writable: preOutputer.writable
    }

    preInputer.readable
      .pipeTo(postInputer.writable)
      .then(() => this.#onInputClose())
      .catch(e => this.#onInputError(e))
      .catch(() => { })

    preOutputer.readable
      .pipeTo(postOutputer.writable)
      .then(() => this.#onOutputClose())
      .catch(e => this.#onOutputError(e))
      .catch(() => { })
  }

  get selfWindow() {
    return this.buffer.bytes.length
  }

  async #onInputClose() {
    Console.debug(`${this.#class.name}.onReadClose`)

    this.reader.stream.closed = {}

    await this.reader.events.emit("close", [undefined])
  }

  async #onOutputClose() {
    Console.debug(`${this.#class.name}.onWriteClose`)

    this.writer.stream.closed = {}

    await this.writer.events.emit("close", [undefined])
  }

  async #onInputError(reason?: unknown) {
    Console.debug(`${this.#class.name}.onReadError`, { reason })

    this.reader.stream.closed = { reason }
    this.writer.stream.error(reason)

    await this.reader.events.emit("error", [reason])
  }

  async #onOutputError(reason?: unknown) {
    Console.debug(`${this.#class.name}.onWriteError`, { reason })

    this.writer.stream.closed = { reason }
    this.reader.stream.error(reason)

    await this.writer.events.emit("error", [reason])
  }

}