import { Opaque, Writable } from "@hazae41/binary"
import { Bytes } from "@hazae41/bytes"
import { HalfDuplex } from "@hazae41/cascade"
import { Cursor } from "@hazae41/cursor"
import { SecretSmuxReader } from "./reader.js"
import { SecretSmuxWriter } from "./writer.js"

export interface SmuxDuplexParams {
  readonly streamID?: number
}

export class SmuxDuplex {

  readonly #secret: SecretSmuxDuplex

  constructor(
    readonly params: SmuxDuplexParams
  ) {
    this.#secret = new SecretSmuxDuplex(params)
  }

  get inner() {
    return this.#secret.inner
  }

  get outer() {
    return this.#secret.outer
  }

}

export class SecretSmuxDuplex extends HalfDuplex<Opaque, Writable>{
  readonly #class = SecretSmuxDuplex

  selfRead = 0
  selfWrite = 0
  selfIncrement = 0

  peerConsumed = 0
  peerWindow = 65_535

  readonly reader: SecretSmuxReader
  readonly writer: SecretSmuxWriter

  readonly buffer = new Cursor(Bytes.alloc(65_535))

  readonly streamID: number

  constructor(
    readonly params: SmuxDuplexParams
  ) {
    super()

    const { streamID = 3 } = params

    this.streamID = streamID

    this.reader = new SecretSmuxReader(this)
    this.writer = new SecretSmuxWriter(this)
  }

  get selfWindow() {
    return this.buffer.bytes.length
  }

}