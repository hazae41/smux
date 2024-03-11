import { Opaque, Writable } from "@hazae41/binary"
import { Bytes } from "@hazae41/bytes"
import { CloseEvents, ErrorEvents, FullDuplex, HalfDuplexEvents } from "@hazae41/cascade"
import { Cursor } from "@hazae41/cursor"
import { SuperEventTarget } from "@hazae41/plume"
import { SecretSmuxReader } from "./reader.js"
import { SecretSmuxWriter } from "./writer.js"

export interface SmuxDuplexParams {
  readonly stream?: number
}

export class SmuxDuplex {

  readonly #secret: SecretSmuxDuplex

  readonly events = new SuperEventTarget<HalfDuplexEvents>()

  constructor(
    readonly params: SmuxDuplexParams = {}
  ) {
    this.#secret = new SecretSmuxDuplex(params)

    this.#secret.events.on("close", () => this.events.emit("close"))
    this.#secret.events.on("error", e => this.events.emit("error", e))
  }

  [Symbol.dispose]() {
    this.close().catch(console.error)
  }

  async [Symbol.asyncDispose]() {
    await this.close()
  }

  get stream() {
    return this.#secret.stream
  }

  get inner() {
    return this.#secret.inner
  }

  get outer() {
    return this.#secret.outer
  }

  get closing() {
    return this.#secret.closing
  }

  get closed() {
    return this.#secret.closed
  }

  async error(reason?: unknown) {
    await this.#secret.error(reason)
  }

  async close() {
    await this.#secret.close()
  }

}

export type SecretSmuxDuplexEvents =
  & CloseEvents
  & ErrorEvents

export class SecretSmuxDuplex {

  readonly smux = new FullDuplex<Opaque, Writable>()

  readonly events = new SuperEventTarget<SecretSmuxDuplexEvents>()

  readonly reader: SecretSmuxReader
  readonly writer: SecretSmuxWriter

  readonly buffer = new Cursor(Bytes.alloc(65_535))

  readonly stream: number

  selfRead = 0
  selfWrite = 0
  selfIncrement = 0

  peerConsumed = 0
  peerWindow = 65_535

  constructor(
    readonly params: SmuxDuplexParams = {}
  ) {
    this.smux.events.on("close", () => this.events.emit("close"))
    this.smux.events.on("error", e => this.events.emit("error", e))

    const { stream: streamID = 3 } = params

    this.stream = streamID

    this.reader = new SecretSmuxReader(this)
    this.writer = new SecretSmuxWriter(this)
  }

  [Symbol.dispose]() {
    this.close().catch(console.error)
  }

  async [Symbol.asyncDispose]() {
    await this.close()
  }

  get selfWindow() {
    return this.buffer.bytes.length
  }

  get inner() {
    return this.smux.inner
  }

  get outer() {
    return this.smux.outer
  }

  get input() {
    return this.smux.input
  }

  get output() {
    return this.smux.output
  }

  get closing() {
    return this.smux.closing
  }

  get closed() {
    return this.smux.closed
  }

  async error(reason?: unknown) {
    await this.smux.error(reason)
  }

  async close() {
    await this.smux.close()
  }

}