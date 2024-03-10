import { Opaque, Writable } from "@hazae41/binary"
import { Bytes } from "@hazae41/bytes"
import { HalfDuplex, HalfDuplexEvents } from "@hazae41/cascade"
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

    this.#secret.events.on("open", () => this.events.emit("open"))
    this.#secret.events.on("close", () => this.events.emit("close"))
    this.#secret.events.on("error", e => this.events.emit("error", e))
  }

  get inner() {
    return this.#secret.inner
  }

  get outer() {
    return this.#secret.outer
  }

  get stream() {
    return this.#secret.stream
  }

}

export class SecretSmuxDuplex extends HalfDuplex<Opaque, Writable> {

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
    super()

    const { stream: streamID = 3 } = params

    this.stream = streamID

    this.reader = new SecretSmuxReader(this)
    this.writer = new SecretSmuxWriter(this)
  }

  get selfWindow() {
    return this.buffer.bytes.length
  }

}