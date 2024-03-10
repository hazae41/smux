import { Opaque, Writable } from "@hazae41/binary"
import { Bytes } from "@hazae41/bytes"
import { HalfDuplex } from "@hazae41/cascade"
import { Cursor } from "@hazae41/cursor"
import { None } from "@hazae41/option"
import { CloseEvents, ErrorEvents, SuperEventTarget } from "@hazae41/plume"
import { SecretSmuxReader } from "./reader.js"
import { SecretSmuxWriter } from "./writer.js"

export interface SmuxDuplexParams {
  readonly stream?: number
}

export class SmuxDuplex {

  readonly #secret: SecretSmuxDuplex

  constructor(
    readonly params: SmuxDuplexParams
  ) {
    this.#secret = new SecretSmuxDuplex(params)
  }

  get events() {
    return this.#secret.events
  }

  get inner() {
    return this.#secret.subduplex.inner
  }

  get outer() {
    return this.#secret.subduplex.outer
  }

  get stream() {
    return this.#secret.stream
  }

}

export class SecretSmuxDuplex {
  readonly #class = SecretSmuxDuplex

  selfRead = 0
  selfWrite = 0
  selfIncrement = 0

  peerConsumed = 0
  peerWindow = 65_535

  readonly subduplex = new HalfDuplex<Opaque, Writable>()

  readonly events = new SuperEventTarget<CloseEvents & ErrorEvents>()

  readonly reader: SecretSmuxReader
  readonly writer: SecretSmuxWriter

  readonly buffer = new Cursor(Bytes.alloc(65_535))

  readonly stream: number

  constructor(
    readonly params: SmuxDuplexParams
  ) {
    const { stream: streamID = 3 } = params

    this.stream = streamID

    this.reader = new SecretSmuxReader(this)
    this.writer = new SecretSmuxWriter(this)

    this.subduplex.events.on("close", async () => {
      await this.events.emit("close", [undefined])
      return new None()
    })

    this.subduplex.events.on("error", async (reason) => {
      await this.events.emit("error", [reason])
      return new None()
    })
  }

  get selfWindow() {
    return this.buffer.bytes.length
  }

}